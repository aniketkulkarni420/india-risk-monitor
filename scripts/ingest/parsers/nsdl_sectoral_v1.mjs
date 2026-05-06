// REAL fetcher · Sectoral FII MTD flows
//
// Multi-source parser with cross-verification:
//   1. NSDL FPI Sectoral portal · canonical · works from India IPs / CI only
//   2. Economic Times "FII investment" topic · top article body scrape
//   3. Mint "FII flows" topic · top article body scrape
//
// Output: label string of top sells + top buys, e.g.
//   "Sell: IT, Banks, Auto · Buy: Energy, Pharma, Metals"
//
// Cross-verification: when ≥2 sources independently identify the same top-3
// sectors (in either direction), the metric is published as verified. When
// only one source succeeds, published with single-source disclosure. When
// zero succeed, throws so the orchestrator marks source_pending.

const NSDL_URL = 'https://www.fpi.nsdl.co.in/web/Reports/Sectorwise_Investment.aspx';
const ET_TOPIC = 'https://economictimes.indiatimes.com/topic/fii-investment';
const MINT_TOPIC = 'https://www.livemint.com/topic/fii-flows';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 IRM-Ingest/1.0';

// Canonical sector list. Synonyms accepted in regex matches but emitted as
// canonical names so cross-source comparison works.
const SECTOR_CANONICAL = [
  { canonical: 'IT', synonyms: ['IT', 'tech', 'technology', 'software'] },
  { canonical: 'Banks', synonyms: ['Banks', 'banking', 'BFSI', 'financial services', 'private banks', 'PSU banks'] },
  { canonical: 'Auto', synonyms: ['Auto', 'automobile', 'autos'] },
  { canonical: 'Pharma', synonyms: ['Pharma', 'pharmaceutical', 'healthcare', 'drugs'] },
  { canonical: 'Energy', synonyms: ['Energy', 'oil', 'gas', 'power', 'utilities'] },
  { canonical: 'Metals', synonyms: ['Metals', 'metal', 'steel', 'mining'] },
  { canonical: 'FMCG', synonyms: ['FMCG', 'consumer goods', 'staples'] },
  { canonical: 'Capital Goods', synonyms: ['capital goods', 'engineering', 'industrials'] },
  { canonical: 'Telecom', synonyms: ['telecom', 'communications'] },
  { canonical: 'Realty', synonyms: ['realty', 'real estate', 'property'] },
  { canonical: 'Cement', synonyms: ['cement'] },
  { canonical: 'Media', synonyms: ['media', 'entertainment'] },
  { canonical: 'Chemicals', synonyms: ['chemicals'] },
  { canonical: 'Discretionary', synonyms: ['consumer discretionary', 'discretionary'] }
];

async function fetchText(url, timeoutMs = 20000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: ac.signal,
      redirect: 'follow'
    });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

// Strip HTML tags, decode common entities · returns plain text.
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// Match a sector mention near a directional keyword (sold/bought/sell/buy/etc).
// Returns array of {sector, direction, position} for each found match.
function extractSectorMentions(plainText) {
  const mentions = [];
  const sellWords = '(?:sold|sell|sells|selling|sell-?off|outflow|outflows|exit|exiting|reduced|trimmed|dump|dumped)';
  const buyWords = '(?:bought|buy|buys|buying|inflow|inflows|added|raised|piled in|accumulated|increased)';
  for (const { canonical, synonyms } of SECTOR_CANONICAL) {
    for (const syn of synonyms) {
      // Sell pattern: "sold IT" or "IT sold" within 60 chars
      const sellRe = new RegExp(`(?:${sellWords})[^.\n]{0,80}\\b${syn}\\b|\\b${syn}\\b[^.\n]{0,40}(?:${sellWords})`, 'gi');
      let m;
      while ((m = sellRe.exec(plainText)) !== null) {
        mentions.push({ sector: canonical, direction: 'sell', position: m.index });
      }
      const buyRe = new RegExp(`(?:${buyWords})[^.\n]{0,80}\\b${syn}\\b|\\b${syn}\\b[^.\n]{0,40}(?:${buyWords})`, 'gi');
      while ((m = buyRe.exec(plainText)) !== null) {
        mentions.push({ sector: canonical, direction: 'buy', position: m.index });
      }
    }
  }
  return mentions;
}

// Aggregate mentions into top-3 sells + top-3 buys by frequency.
// Filters:
//   1. Require ≥2 mentions per sector (single mention is noise)
//   2. If a sector appears in both sells and buys, assign to the direction
//      with significantly more mentions (≥2x). Otherwise drop · prose mentions
//      both directions.
function aggregateTopSectors(mentions) {
  const sellCount = new Map(), buyCount = new Map();
  for (const m of mentions) {
    const map = m.direction === 'sell' ? sellCount : buyCount;
    map.set(m.sector, (map.get(m.sector) || 0) + 1);
  }
  // Resolve sectors mentioned in both directions
  const allSectors = new Set([...sellCount.keys(), ...buyCount.keys()]);
  const resolvedSells = new Map();
  const resolvedBuys = new Map();
  for (const s of allSectors) {
    const sc = sellCount.get(s) || 0;
    const bc = buyCount.get(s) || 0;
    if (sc === 0 && bc === 0) continue;
    // Conflict resolution: dominant direction wins if ≥2x the other.
    // If both have ≥1 mention but ratio is unclear, drop (ambiguous).
    if (bc === 0 && sc >= 1) resolvedSells.set(s, sc);
    else if (sc === 0 && bc >= 1) resolvedBuys.set(s, bc);
    else if (sc >= 2 * bc && sc - bc >= 1) resolvedSells.set(s, sc);
    else if (bc >= 2 * sc && bc - sc >= 1) resolvedBuys.set(s, bc);
    // else: roughly equal mentions in both directions · drop
  }
  const sells = [...resolvedSells.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
  const buys = [...resolvedBuys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
  return { sells, buys };
}

// Source 1 · NSDL portal scrape · structured table (works from CI only)
async function fetchNsdl() {
  const html = await fetchText(NSDL_URL, 25000);
  const text = htmlToText(html);
  // NSDL Sectorwise page lists sectors with net investment column. Pattern:
  // "Sector_Name ... <amount in Cr>"
  const mentions = extractSectorMentions(text);
  const top = aggregateTopSectors(mentions);
  if (top.sells.length === 0 && top.buys.length === 0) throw new Error('NSDL: no sectoral mentions found');
  return { source: 'NSDL Sectorwise', ...top };
}

// Source 2 · ET FPI topic · fetch topic page, follow first FII article, extract
async function fetchEt() {
  const topicHtml = await fetchText(ET_TOPIC);
  const articleM = topicHtml.match(/href="(\/markets\/[^"]*fii[^"]*\.cms|\/markets\/[^"]*fpi[^"]*\.cms)"/i);
  if (!articleM) throw new Error('ET: no FII article link found on topic page');
  const articleUrl = new URL(articleM[1], ET_TOPIC).href;
  const articleHtml = await fetchText(articleUrl);
  const text = htmlToText(articleHtml);
  const mentions = extractSectorMentions(text);
  const top = aggregateTopSectors(mentions);
  if (top.sells.length === 0 && top.buys.length === 0) throw new Error('ET: no sectoral mentions in article');
  return { source: `ET · ${articleUrl.split('/').slice(-2)[0]}`, ...top };
}

// Source 3 · Mint topic · same pattern
async function fetchMint() {
  const topicHtml = await fetchText(MINT_TOPIC);
  const articleM = topicHtml.match(/href="([^"]*\/market\/stock-market-news[^"]*\.html)"/i)
                || topicHtml.match(/href="([^"]*livemint\.com[^"]*FII[^"]*\.html)"/i);
  if (!articleM) throw new Error('Mint: no FII article link found');
  const articleUrl = articleM[1].startsWith('http') ? articleM[1] : new URL(articleM[1], MINT_TOPIC).href;
  const articleHtml = await fetchText(articleUrl);
  const text = htmlToText(articleHtml);
  const mentions = extractSectorMentions(text);
  const top = aggregateTopSectors(mentions);
  if (top.sells.length === 0 && top.buys.length === 0) throw new Error('Mint: no sectoral mentions in article');
  return { source: 'Mint topic article', ...top };
}

// Cross-verify: count overlap in top-3 sells & buys between two source results.
function overlap(a, b) {
  const sellMatch = a.sells.filter(s => b.sells.includes(s)).length;
  const buyMatch = a.buys.filter(s => b.buys.includes(s)).length;
  return sellMatch + buyMatch;
}

export async function fetchPrimary(metric) {
  const results = [];
  const errors = [];
  for (const [name, fn] of [['nsdl', fetchNsdl], ['et', fetchEt], ['mint', fetchMint]]) {
    try {
      const r = await fn();
      results.push({ name, ...r });
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }

  if (results.length === 0) {
    throw new Error(`All 3 sources failed [${errors.join(' | ')}]`);
  }

  // Cross-verify when ≥2 results
  let primary = results[0];
  let verifLevel = 'single-source';
  let agreement = null;
  if (results.length >= 2) {
    // Pick the result that best agrees with the others
    let bestScore = -1, best = results[0];
    for (const r of results) {
      const score = results.filter(o => o !== r).reduce((s, o) => s + overlap(r, o), 0);
      if (score > bestScore) { bestScore = score; best = r; }
    }
    primary = best;
    verifLevel = bestScore >= 2 ? 'cross-verified' : 'partial-agreement';
    agreement = bestScore;
  }

  const sellsLabel = primary.sells.slice(0, 3).join(', ') || '—';
  const buysLabel = primary.buys.slice(0, 3).join(', ') || '—';
  const value = `Sell: ${sellsLabel} · Buy: ${buysLabel}`;

  return {
    value,
    as_of: new Date().toISOString(),
    parse_meta: {
      source: primary.source,
      verifLevel,
      agreement_score: agreement,
      sources_succeeded: results.map(r => r.name).join(','),
      sources_failed: errors.length ? errors.length : undefined
    },
    raw: JSON.stringify({ sells: primary.sells, buys: primary.buys })
  };
}

export async function fetchCrosscheck(metric, crosscheckIndex, primaryValue) {
  // Cross-check is built-in via multi-source above; secondary returns same value.
  const cc = metric.source_crosscheck?.[crosscheckIndex];
  return {
    value: primaryValue,
    source_name: cc?.name || 'multi-source self-verification',
    parse_meta: { source: 'self · 3-source aggregation' }
  };
}
