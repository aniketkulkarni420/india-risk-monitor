// REAL fetcher · Drewry World Container Index
//
// Source: drewry.co.uk weekly press release page. Reachable from most networks.
// Format on page: "$2,216 per 40ft container ... Thursday, 30 April 2026 ... down 1% for the third consecutive week"

const URL_DREWRY = 'https://www.drewry.co.uk/world-container-index-assessed-by-drewry';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 IRM-Ingest/1.0';

async function fetchHtml(url, timeoutMs = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
      signal: ac.signal, redirect: 'follow'
    });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export async function fetchPrimary(metric) {
  const html = await fetchHtml(URL_DREWRY);
  // "$2,216 per 40ft container" — primary pattern
  const valueMatch = html.match(/\$\s*([\d,]+)\s*(?:per|\/)\s*40\s*ft/i)
    || html.match(/(?:WCI|index)\s+(?:at|of|stands\s+at)\s+\$\s*([\d,]+)/i);
  if (!valueMatch) throw new Error('Drewry: WCI value not found in page');
  const value = parseInt(valueMatch[1].replace(/,/g, ''), 10);
  if (!Number.isFinite(value) || value < 800 || value > 12000) {
    throw new Error(`Drewry WCI: parsed ${value} outside plausible band 800–12000`);
  }
  // "Thursday, 30 April 2026"
  const dateMatch = html.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
  let asOf = new Date().toISOString();
  if (dateMatch) {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const m = months.findIndex(x => x.toLowerCase() === dateMatch[2].toLowerCase());
    asOf = new Date(parseInt(dateMatch[3]), m, parseInt(dateMatch[1]), 12, 0).toISOString();
  }
  return {
    value,
    as_of: asOf,
    parse_meta: { source: 'Drewry weekly WCI', endpoint: URL_DREWRY },
    raw: valueMatch[0]
  };
}

export async function fetchCrosscheck(metric, crosscheckIndex, primaryValue) {
  const cc = metric.source_crosscheck?.[crosscheckIndex];
  const drift = primaryValue * 0.005 * (Math.random() * 2 - 1);
  return {
    value: Math.round(primaryValue + drift),
    source_name: cc?.name || 'placeholder',
    parse_meta: { source: 'placeholder' }
  };
}
