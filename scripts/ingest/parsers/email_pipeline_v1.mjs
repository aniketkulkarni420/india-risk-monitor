// REAL fetcher · Gmail-API email pipeline.
//
// India govt agencies (PIB, MoSPI, RBI, NHAI, etc) offer email subscription
// to press releases. Forward those emails to a designated Gmail label and
// this parser reads them via Gmail API.
//
// Setup (one-time, ~10 min):
//   1) Subscribe Aniket's Gmail to PIB at pib.gov.in/EmailSubscription
//      (and equivalent for MoSPI/RBI/NHAI subscription pages)
//   2) Create a Gmail label "IRM-Source" and a filter that routes
//      matching emails to it
//   3) Generate a Google OAuth 2.0 Refresh Token for Gmail API readonly:
//      https://developers.google.com/gmail/api/quickstart/nodejs
//      ~5 min walkthrough
//   4) Set GitHub secret:
//        GMAIL_REFRESH_TOKEN  (the refresh token)
//        GMAIL_CLIENT_ID      (from your Google Cloud project)
//        GMAIL_CLIENT_SECRET  (from your Google Cloud project)
//
// Once setup:
//   - Subscribed emails arrive in Gmail tagged IRM-Source
//   - This parser pulls latest matching emails, extracts numeric values
//     via LLM, writes the metric value
//
// Until setup: parser throws GMAIL_UNAVAILABLE which the tiered orchestrator
// treats as a soft-skip (next tier tries).

import { recordSnapshot } from '../snapshot-store.mjs';
import { tryProviders } from './llm_extract_v1.mjs';

const REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

function isAvailable() {
  return !!(REFRESH_TOKEN && CLIENT_ID && CLIENT_SECRET);
}

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  if (!res.ok) throw new Error(`Gmail OAuth refresh failed: ${res.status}`);
  const j = await res.json();
  return j.access_token;
}

async function gmailFetch(path, accessToken) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`Gmail API ${path}: ${res.status}`);
  return res.json();
}

// Per-metric: query → Gmail search query (e.g. label + subject keyword)
//             extractTarget → instruction for LLM extraction from email body
const CONFIGS = {
  gst_gross: {
    query: 'label:IRM-Source from:pib.gov.in subject:GST newer_than:60d',
    extractTarget: 'Monthly gross GST collection in INR crore from the PIB press release email body.',
    plausible: (v) => v > 100000 && v < 500000
  },
  cement_dispatches: {
    query: 'label:IRM-Source from:pib.gov.in (subject:cement OR subject:IECI) newer_than:60d',
    extractTarget: 'All-India monthly cement production or dispatches in million tonnes from the IECI / DPIIT email.',
    plausible: (v) => v > 25 && v < 60
  },
  rail_freight: {
    query: 'label:IRM-Source from:pib.gov.in subject:railway newer_than:60d',
    extractTarget: 'Monthly all-India freight loading by Indian Railways in million tonnes (MT) from the MoR email.',
    plausible: (v) => v > 100 && v < 200
  },
  fastag_toll: {
    query: 'label:IRM-Source from:pib.gov.in (subject:FASTag OR subject:toll) newer_than:60d',
    extractTarget: 'Monthly FASTag toll collection in India in INR crore from the MoRTH/NHAI email.',
    plausible: (v) => v > 4000 && v < 12000
  }
};

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No email_pipeline_v1 config for ${metric.metric_id}`);
  if (!isAvailable()) {
    const e = new Error('Gmail API not configured · set GMAIL_REFRESH_TOKEN + CLIENT_ID + CLIENT_SECRET');
    e.code = 'GMAIL_UNAVAILABLE';
    throw e;
  }

  const accessToken = await getAccessToken();

  // 1. Search for recent matching emails
  const search = await gmailFetch(`/messages?q=${encodeURIComponent(cfg.query)}&maxResults=5`, accessToken);
  const ids = (search.messages || []).map(m => m.id);
  if (!ids.length) throw new Error(`email_pipeline: no matching emails for "${cfg.query}"`);

  // 2. Fetch latest message body
  const errors = [];
  for (const id of ids) {
    try {
      const msg = await gmailFetch(`/messages/${id}?format=full`, accessToken);
      const headers = (msg.payload?.headers || []);
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const date = headers.find(h => h.name === 'Date')?.value || '';

      // Decode body (could be in payload.body.data or in payload.parts[].body.data)
      let bodyText = '';
      function walkPayload(p) {
        if (!p) return;
        if (p.body?.data) {
          try { bodyText += Buffer.from(p.body.data, 'base64').toString('utf8') + '\n'; } catch {}
        }
        if (Array.isArray(p.parts)) for (const sub of p.parts) walkPayload(sub);
      }
      walkPayload(msg.payload);
      bodyText = bodyText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 8000);

      if (bodyText.length < 100) { errors.push(`${id}: empty body`); continue; }

      const prompt = 'Extract: ' + cfg.extractTarget +
        `\n\nEmail subject: ${subject}\nEmail date: ${date}\n\nEmail text:\n\n${bodyText}`;
      const r = await tryProviders(prompt);
      if (!r || r.value === null || !Number.isFinite(r.value)) {
        errors.push(`${id}: LLM no value`); continue;
      }
      if (!cfg.plausible(r.value)) { errors.push(`${id}: ${r.value} out of band`); continue; }

      try { recordSnapshot(metric.metric_id, `gmail:${id}`, bodyText, r.value, 'email_pipeline_v1'); } catch {}
      return {
        value: r.value,
        as_of: date ? new Date(date).toISOString() : new Date().toISOString(),
        parse_meta: { source: 'gmail', message_id: id, subject: subject.slice(0, 200), provider: r.provider },
        raw: `Email: "${subject.slice(0, 100)}" → ${r.value}`
      };
    } catch (e) {
      if (e.code === 'LLM_UNAVAILABLE') throw e;
      errors.push(`${id}: ${(e.message || '').slice(0, 80)}`);
    }
  }
  throw new Error(`email_pipeline_v1: ${ids.length} emails tried · ${errors.slice(0,2).join(' | ')}`);
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'email-crosscheck-pending', parse_meta: { source: 'pending' } };
}

export { isAvailable };
