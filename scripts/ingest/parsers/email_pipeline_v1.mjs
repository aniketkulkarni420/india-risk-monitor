// REAL fetcher · Gmail IMAP email pipeline.
//
// India govt agencies (PIB, MoSPI, RBI, NHAI, etc) offer email subscription
// to press releases. This parser reads them via IMAP using a Gmail app password
// (simpler than the prior OAuth path — no Google Cloud Console setup needed).
//
// Setup (one-time, ~10 min):
//   1) Subscribe Aniket's Gmail at pib.gov.in/SubscribeRelease/SubscribeReleaseForm.aspx
//      (and equivalent for MoSPI/RBI/NHAI subscription pages)
//   2) Enable 2FA on the Gmail account
//   3) Generate a Gmail app password at https://myaccount.google.com/apppasswords
//   4) Set GitHub secrets:
//        GMAIL_ADDRESS        (the subscribed Gmail address)
//        GMAIL_APP_PASSWORD   (the 16-char app password)
//
// Until first PIB email arrives, parser throws GMAIL_NO_EMAILS which the
// tiered orchestrator treats as a soft-skip (next tier tries).

import { ImapFlow } from 'imapflow';
import { recordSnapshot } from '../snapshot-store.mjs';
import { tryProviders } from './llm_extract_v1.mjs';

const GMAIL_ADDRESS = process.env.GMAIL_ADDRESS;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

function isAvailable() {
  return !!(GMAIL_ADDRESS && GMAIL_APP_PASSWORD);
}

// Per-metric: imapQuery → IMAP SEARCH criteria object
//             extractTarget → instruction for LLM extraction from email body
//             plausible → numeric sanity guardrail
const CONFIGS = {
  gst_gross: {
    imapQuery: { from: 'pib.gov.in', subject: 'GST', since: daysAgo(60) },
    extractTarget: 'Monthly gross GST collection in INR crore from the PIB press release email body.',
    plausible: (v) => v > 100000 && v < 500000
  },
  cement_dispatches: {
    imapQuery: { from: 'pib.gov.in', subject: 'cement', since: daysAgo(60) },
    extractTarget: 'All-India monthly cement production or dispatches in million tonnes from the IECI / DPIIT email.',
    plausible: (v) => v > 25 && v < 60
  },
  rail_freight: {
    imapQuery: { from: 'pib.gov.in', subject: 'rail', since: daysAgo(60) },
    extractTarget: 'Monthly all-India freight loading by Indian Railways in million tonnes (MT) from the MoR email.',
    plausible: (v) => v > 100 && v < 200
  },
  fastag_toll: {
    imapQuery: { from: 'pib.gov.in', subject: 'toll', since: daysAgo(60) },
    extractTarget: 'Monthly FASTag toll collection in India in INR crore from the MoRTH/NHAI email.',
    plausible: (v) => v > 4000 && v < 12000
  },
  iip_index: {
    imapQuery: { from: 'pib.gov.in', subject: 'IIP', since: daysAgo(90) },
    extractTarget: 'Index of Industrial Production (IIP) headline index value or YoY growth in percent from the MoSPI email.',
    plausible: (v) => Math.abs(v) < 500
  },
  cpi_yoy: {
    imapQuery: { from: 'pib.gov.in', subject: 'CPI', since: daysAgo(60) },
    extractTarget: 'Headline CPI inflation YoY percent from the MoSPI release email.',
    plausible: (v) => v > -2 && v < 20
  },
  wpi_yoy: {
    imapQuery: { from: 'pib.gov.in', subject: 'WPI', since: daysAgo(60) },
    extractTarget: 'WPI inflation YoY percent from the eaindustry / Commerce Ministry email.',
    plausible: (v) => v > -5 && v < 25
  },
  port_cargo: {
    imapQuery: { from: 'pib.gov.in', subject: 'port', since: daysAgo(60) },
    extractTarget: 'Monthly major ports cargo traffic in million tonnes from the Ministry of Ports email.',
    plausible: (v) => v > 40 && v < 120
  },
  pol_demand: {
    imapQuery: { from: 'pib.gov.in', subject: 'petroleum', since: daysAgo(60) },
    extractTarget: 'Monthly all-India petroleum products consumption in MMT from the PPAC / Petroleum Ministry email.',
    plausible: (v) => v > 12 && v < 30
  }
};

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

async function withClient(fn) {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: GMAIL_ADDRESS, pass: GMAIL_APP_PASSWORD },
    logger: false
  });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    return await fn(client);
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
}

async function fetchLatestMatching(client, imapQuery, limit = 5) {
  const results = [];
  for await (const msg of client.fetch(imapQuery, { envelope: true, source: true, internalDate: true })) {
    let body = '';
    try { body = msg.source ? msg.source.toString('utf8') : ''; } catch { body = ''; }
    body = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 8000);
    results.push({
      uid: msg.uid,
      subject: msg.envelope?.subject || '',
      date: msg.internalDate || msg.envelope?.date || new Date(),
      body
    });
  }
  results.sort((a, b) => new Date(b.date) - new Date(a.date));
  return results.slice(0, limit);
}

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No email_pipeline_v1 config for ${metric.metric_id}`);
  if (!isAvailable()) {
    const e = new Error('Gmail IMAP not configured · set GMAIL_ADDRESS + GMAIL_APP_PASSWORD');
    e.code = 'GMAIL_UNAVAILABLE';
    throw e;
  }

  const emails = await withClient((c) => fetchLatestMatching(c, cfg.imapQuery, 5));
  if (!emails.length) {
    const e = new Error(`email_pipeline: no matching emails for ${metric.metric_id} (subscription may not have delivered yet)`);
    e.code = 'GMAIL_NO_EMAILS';
    throw e;
  }

  const errors = [];
  for (const em of emails) {
    if (em.body.length < 100) { errors.push(`uid${em.uid}: empty body`); continue; }
    const prompt = 'Extract: ' + cfg.extractTarget +
      `\n\nEmail subject: ${em.subject}\nEmail date: ${em.date}\n\nEmail text:\n\n${em.body}`;
    try {
      const r = await tryProviders(prompt);
      if (!r || r.value === null || !Number.isFinite(r.value)) {
        errors.push(`uid${em.uid}: LLM no value`); continue;
      }
      if (!cfg.plausible(r.value)) { errors.push(`uid${em.uid}: ${r.value} out of band`); continue; }
      try { recordSnapshot(metric.metric_id, `gmail:${em.uid}`, em.body, r.value, 'email_pipeline_v1'); } catch {}
      return {
        value: r.value,
        as_of: new Date(em.date).toISOString(),
        parse_meta: { source: 'gmail-imap', uid: em.uid, subject: em.subject.slice(0, 200), provider: r.provider },
        raw: `Email: "${em.subject.slice(0, 100)}" → ${r.value}`
      };
    } catch (e) {
      if (e.code === 'LLM_UNAVAILABLE') throw e;
      errors.push(`uid${em.uid}: ${(e.message || '').slice(0, 80)}`);
    }
  }
  throw new Error(`email_pipeline_v1: ${emails.length} emails tried · ${errors.slice(0, 2).join(' | ')}`);
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'email-crosscheck-pending', parse_meta: { source: 'pending' } };
}

export { isAvailable };
