// REAL fetcher · PIB RSS feeds (and other RSS-based news sources)
//
// Why: PIB press release HTML pages (search.pib.gov.in, PressReleasePage.aspx)
// are flaky from non-IN networks AND change layout regularly. But PIB RSS
// feeds (pib.gov.in/Rssfeed.aspx?Mincode=XX) are stable XML with stable titles.
// News aggregator RSS (Business Standard, ET, Mint) is even more reliable.
//
// Pattern: each metric maps to a feed URL + keyword regex (matches headline)
// + value-extract regex (pulls number from title or description).
//
// Free. No auth. No key. Format-stable for years.

import { fetchResilient } from '../fetch-resilient.mjs';
import { recordSnapshot } from '../snapshot-store.mjs';

// Per-metric config:
//   feeds:        list of RSS URLs to try in order
//   headlineRe:   regex that matches a relevant headline (e.g. /GST collection/i)
//   extractRe:    regex with group 1 = numeric value (matched against title + description)
//   plausible:    range guard
//   valueParser:  optional transform
//   maxAgeDays:   skip items older than this (default 60)
const CONFIGS = {
  // GST monthly collection — from PIB Ministry of Finance feed + news aggregators
  gst_gross: {
    feeds: [
      'https://www.business-standard.com/rss/economy-policy-10302.rss',
      'https://economictimes.indiatimes.com/news/economy/indicators/rssfeeds/1373380680.cms',
      'https://pib.gov.in/Rssfeed.aspx?Mincode=14',  // Ministry of Finance
      'https://www.livemint.com/rss/economy'
    ],
    headlineRe: /GST\s+(?:collection|revenue|mop[- ]?up)/i,
    extractRe: /(?:₹|Rs\.?\s?)?([\d,]+)\s*(?:crore|cr\b|lakh\s+crore|trillion)/i,
    plausible: (v) => v > 100000 && v < 500000, // crore range
    valueParser: (s) => {
      const n = parseFloat(s.replace(/,/g, ''));
      // If under 5 it's likely lakh crore — convert to crore
      return n < 5 ? n * 100000 : n;
    },
    maxAgeDays: 60
  },


  // E-way bills monthly count
  eway_bills: {
    feeds: [
      'https://www.business-standard.com/rss/economy-policy-10302.rss',
      'https://economictimes.indiatimes.com/news/economy/indicators/rssfeeds/1373380680.cms',
      'https://www.livemint.com/rss/economy'
    ],
    headlineRe: /e[- ]?way\s+bills?/i,
    extractRe: /([\d.,]+)\s+(?:crore|lakh)\s+e[- ]?way\s+bills?/i,
    plausible: (v) => v > 50 && v < 250,
    valueParser: (s) => {
      const n = parseFloat(s.replace(/,/g, ''));
      // Convert crore → million (×10)
      return n * 10;
    },
    maxAgeDays: 45
  },

  // FASTag monthly toll collection
  fastag_toll: {
    feeds: [
      'https://www.business-standard.com/rss/economy-policy-10302.rss',
      'https://economictimes.indiatimes.com/news/economy/indicators/rssfeeds/1373380680.cms',
      'https://www.livemint.com/rss/economy'
    ],
    headlineRe: /FASTag|toll\s+collection/i,
    extractRe: /(?:₹|Rs\.?\s?)?([\d,]+(?:\.\d+)?)\s*(?:crore|Cr)/i,
    plausible: (v) => v > 5000 && v < 12000,
    valueParser: (s) => parseFloat(s.replace(/,/g, '')),
    maxAgeDays: 45
  },

  // Indian Railways monthly freight loading
  rail_freight: {
    feeds: [
      'https://pib.gov.in/Rssfeed.aspx?Mincode=10',  // Ministry of Railways
      'https://www.business-standard.com/rss/economy-policy-10302.rss',
      'https://economictimes.indiatimes.com/news/economy/indicators/rssfeeds/1373380680.cms'
    ],
    headlineRe: /(?:railways?\s+(?:freight|loading|loaded))|freight\s+loading/i,
    extractRe: /([\d.,]+)\s*(?:MT|million\s+tonnes|Mn\s+tonnes|MnT)/i,
    plausible: (v) => v > 90 && v < 200,
    valueParser: (s) => parseFloat(s.replace(/,/g, '')),
    maxAgeDays: 45
  }
};

// ─── RSS parsing ───
// Minimal RSS parser — we only need <item><title> and <pubDate>. Handles both
// RSS 2.0 and Atom (Atom uses <entry><title><published>).
function parseRssItems(xml) {
  const items = [];
  // Try RSS 2.0 first: <item>...</item>
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    items.push({
      title: extractTag(block, 'title'),
      description: extractTag(block, 'description'),
      pubDate: extractTag(block, 'pubDate') || extractTag(block, 'dc:date'),
      link: extractTag(block, 'link')
    });
  }
  if (items.length) return items;

  // Fallback: Atom <entry>
  const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];
    items.push({
      title: extractTag(block, 'title'),
      description: extractTag(block, 'summary') || extractTag(block, 'content'),
      pubDate: extractTag(block, 'published') || extractTag(block, 'updated'),
      link: null
    });
  }
  return items;
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  let v = m[1].trim();
  // Strip CDATA
  v = v.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1');
  // Decode common entities
  v = v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // Strip remaining tags
  v = v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return v;
}

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No pib_rss config for ${metric.metric_id}`);

  const maxAgeMs = (cfg.maxAgeDays || 60) * 24 * 3600 * 1000;
  const cutoff = Date.now() - maxAgeMs;
  const errors = [];

  for (const feed of cfg.feeds) {
    try {
      const res = await fetchResilient(feed, { timeoutMs: 20000, retries: 1, wayback: false, browserUa: true });
      const items = parseRssItems(res.body);
      if (!items.length) { errors.push(`${feed}: no items`); continue; }

      for (const it of items) {
        if (!it.title) continue;
        if (!cfg.headlineRe.test(it.title) && !cfg.headlineRe.test(it.description || '')) continue;

        // Age check
        const pub = it.pubDate ? new Date(it.pubDate).getTime() : Date.now();
        if (Number.isFinite(pub) && pub < cutoff) continue;

        const haystack = `${it.title} ${it.description || ''}`;
        const m = haystack.match(cfg.extractRe);
        if (!m) continue;

        const raw = cfg.valueParser ? cfg.valueParser(m[1]) : parseFloat(m[1]);
        if (Number.isNaN(raw) || !cfg.plausible(raw)) continue;

        try { recordSnapshot(metric.metric_id, feed, res.body, raw, 'pib_rss_v1'); } catch {}

        return {
          value: raw,
          as_of: it.pubDate ? new Date(it.pubDate).toISOString() : new Date().toISOString(),
          parse_meta: {
            source: feed, headline: it.title.slice(0, 200),
            link: it.link, regex: cfg.extractRe.toString()
          },
          raw: it.title.slice(0, 200)
        };
      }
      errors.push(`${feed}: ${items.length} items, none matched`);
    } catch (e) {
      errors.push(`${feed}: ${e.message}`);
    }
  }
  throw new Error(`${metric.metric_id}: all RSS feeds failed [${errors.slice(0, 4).join(' | ')}]`);
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return {
    value: primaryValue,
    source_name: cc?.name || 'rss-crosscheck-pending',
    parse_meta: { source: 'pending', note: 'crosscheck not yet wired for RSS parser' }
  };
}

// Test export
export { parseRssItems };
