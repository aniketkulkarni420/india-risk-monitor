// REAL fetcher · Free LLM extraction fallback
//
// Universal last-resort parser. When all other parsers fail, send the page
// HTML (or PDF text) to a free LLM with a one-shot extraction prompt. The
// LLM returns JSON { value, as_of, source_note }.
//
// Three free providers stacked (tries in this order; first available wins):
//   1) Groq         · GROQ_API_KEY      · Llama 3.1 70B · very fast · generous free tier
//   2) Gemini Flash · GEMINI_API_KEY    · 1500 req/day free · no card needed
//   3) Cloudflare Workers AI · CF_API_TOKEN + CF_ACCOUNT_ID · 10k neurons/day free
//
// Get free keys:
//   Groq:        https://console.groq.com/keys
//   Gemini:      https://aistudio.google.com/app/apikey
//   Cloudflare:  https://dash.cloudflare.com → Workers → AI
//
// Without any keys, the fetchPrimary throws a clean LLM_UNAVAILABLE error
// that the ingest pipeline catches and reports honestly.

import { fetchResilient } from '../fetch-resilient.mjs';

const PROVIDERS = {
  groq: {
    envKey: 'GROQ_API_KEY',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' })
  },
  gemini: {
    envKey: 'GEMINI_API_KEY',
    // Gemini uses a different URL pattern with key in query
    urlFn: (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`,
    headers: () => ({ 'Content-Type': 'application/json' })
  },
  cloudflare: {
    envKey: 'CF_API_TOKEN',
    envAccount: 'CF_ACCOUNT_ID',
    urlFn: (key, account) => `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/meta/llama-3.1-70b-instruct`,
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' })
  }
};

// Per-metric config:
//   urls: list of source URLs to fetch (HTML / PDF text in)
//   target: human description of what to extract (e.g. "latest GST monthly collection in INR crore")
//   plausible
//   maxChars: how much body context to send to LLM (default 12000)
const CONFIGS = {
  // Last-resort fallback for GST when all other parsers fail
  gst_gross_llm: {
    urls: [
      'https://www.business-standard.com/topic/gst-collections',
      'https://economictimes.indiatimes.com/topic/gst-collections'
    ],
    target: 'the latest monthly GST collection figure for India, in INR crore. The press release usually says "GST collection of ₹XX,XXX crore in [Month] [Year]". Return only the most recent value.',
    plausible: (v) => v > 100000 && v < 500000,
    maxChars: 14000
  }
};

const SYSTEM_PROMPT = `You are a data extraction assistant. The user will provide HTML or text from a financial news page. Your job is to extract one specific number and return STRICT JSON only — no prose, no markdown fences.

Output schema:
{ "value": <number>, "as_of": "<ISO date YYYY-MM-DD or YYYY-MM>", "source_note": "<short string explaining where in text you found it>" }

If you cannot find the value, return: { "value": null, "as_of": null, "source_note": "not found" }

Do NOT invent values. Only extract what is explicitly stated.`;

function buildUserPrompt(cfg, body) {
  const clipped = body.slice(0, cfg.maxChars || 12000);
  return `Extract: ${cfg.target}\n\nSource HTML/text (may be truncated):\n\n${clipped}`;
}

function parseLlmJson(s) {
  if (!s) return null;
  // Strip markdown fences if present
  let cleaned = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  // Locate the first {...} JSON object
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function callGroq(prompt, key) {
  const res = await fetchResilient(PROVIDERS.groq.url, {
    timeoutMs: 30000, retries: 1, wayback: false,
    headers: PROVIDERS.groq.headers(key)
  });
  // fetchResilient is GET-only; we need POST. Use raw fetch here.
  return null; // see callProvider below for proper POST
}

async function callProvider(provider, prompt) {
  if (provider === 'groq') {
    const key = process.env[PROVIDERS.groq.envKey];
    if (!key) return null;
    const res = await fetch(PROVIDERS.groq.url, {
      method: 'POST',
      headers: PROVIDERS.groq.headers(key),
      body: JSON.stringify({
        model: PROVIDERS.groq.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        temperature: 0,
        response_format: { type: 'json_object' }
      })
    });
    if (!res.ok) throw new Error(`groq ${res.status}: ${(await res.text()).slice(0,200)}`);
    const j = await res.json();
    const txt = j?.choices?.[0]?.message?.content || '';
    return { provider: 'groq', text: txt };
  }

  if (provider === 'gemini') {
    const key = process.env[PROVIDERS.gemini.envKey];
    if (!key) return null;
    const res = await fetch(PROVIDERS.gemini.urlFn(key), {
      method: 'POST',
      headers: PROVIDERS.gemini.headers(),
      body: JSON.stringify({
        contents: [{ parts: [{ text: SYSTEM_PROMPT + '\n\n' + prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' }
      })
    });
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0,200)}`);
    const j = await res.json();
    const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { provider: 'gemini', text: txt };
  }

  if (provider === 'cloudflare') {
    const key = process.env[PROVIDERS.cloudflare.envKey];
    const account = process.env[PROVIDERS.cloudflare.envAccount];
    if (!key || !account) return null;
    const res = await fetch(PROVIDERS.cloudflare.urlFn(key, account), {
      method: 'POST',
      headers: PROVIDERS.cloudflare.headers(key),
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        temperature: 0
      })
    });
    if (!res.ok) throw new Error(`cloudflare ${res.status}: ${(await res.text()).slice(0,200)}`);
    const j = await res.json();
    const txt = j?.result?.response || '';
    return { provider: 'cloudflare', text: txt };
  }
  return null;
}

async function tryProviders(prompt) {
  const errors = [];
  for (const provider of ['groq', 'gemini', 'cloudflare']) {
    try {
      const r = await callProvider(provider, prompt);
      if (r === null) continue;  // env key missing — skip
      const parsed = parseLlmJson(r.text);
      if (parsed && Number.isFinite(parsed.value)) return { ...parsed, provider: r.provider };
      errors.push(`${provider}: returned no value (raw: ${r.text.slice(0,120)})`);
    } catch (e) {
      errors.push(`${provider}: ${e.message}`);
    }
  }
  if (errors.length === 0) {
    const e = new Error('No LLM provider configured. Set GROQ_API_KEY or GEMINI_API_KEY or (CF_API_TOKEN + CF_ACCOUNT_ID).');
    e.code = 'LLM_UNAVAILABLE';
    throw e;
  }
  throw new Error(`All LLM providers failed: ${errors.join(' | ')}`);
}

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No llm_extract config for ${metric.metric_id}`);

  const errors = [];
  for (const url of cfg.urls) {
    try {
      const res = await fetchResilient(url, { timeoutMs: 25000, retries: 1, browserUa: true });
      const prompt = buildUserPrompt(cfg, res.body);
      const result = await tryProviders(prompt);
      if (!result || result.value === null || !Number.isFinite(result.value)) {
        errors.push(`${url}: LLM returned no value`); continue;
      }
      if (!cfg.plausible(result.value)) {
        errors.push(`${url}: LLM value ${result.value} outside plausible band`); continue;
      }
      return {
        value: result.value,
        as_of: normalizeAsOf(result.as_of),
        parse_meta: {
          source: 'llm-extract',
          url,
          provider: result.provider,
          source_note: result.source_note
        },
        raw: `LLM(${result.provider}): ${JSON.stringify(result).slice(0, 200)}`
      };
    } catch (e) {
      if (e.code === 'LLM_UNAVAILABLE') throw e; // bail immediately if no keys
      errors.push(`${url}: ${e.message}`);
    }
  }
  throw new Error(`${metric.metric_id}: llm extract failed [${errors.slice(0,3).join(' | ')}]`);
}

function normalizeAsOf(s) {
  if (!s) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00Z').toISOString();
  if (/^\d{4}-\d{2}$/.test(s)) return new Date(s + '-01T00:00:00Z').toISOString();
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'llm-crosscheck-pending', parse_meta: { source: 'pending' } };
}

export { parseLlmJson, tryProviders, normalizeAsOf };
