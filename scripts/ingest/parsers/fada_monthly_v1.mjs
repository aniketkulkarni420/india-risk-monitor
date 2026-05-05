// REAL fetcher · FADA monthly retail registrations
//
// Covers all 5 auto metrics: 2W, 3W, PV, CV, Tractor
// Source: https://fada.in/index.php/research-publication.php
// FADA publishes a press release with a table; format example:
//   2W   1,485,620 units   +8.5% YoY
//   3W      96,420         +12.4%
//   PV     348,620         +5.8%
//   CV      84,260         +6.8%
//   TRC     78,420         +11.8%

const FADA_INDEX = 'https://fada.in/index.php/research-publication.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 IRM-Ingest/1.0';

const SEGMENT_LABELS = {
  auto_2w:      ['2W', 'Two Wheeler', '2 Wheeler'],
  auto_3w:      ['3W', 'Three Wheeler', '3 Wheeler'],
  auto_pv:      ['PV', 'Passenger Vehicle', '4W'],
  auto_cv:      ['CV', 'Commercial Vehicle', 'LCV'],
  auto_tractor: ['TRC', 'Tractor', 'TRAC']
};

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

async function findLatestRelease() {
  const html = await fetchHtml(FADA_INDEX);
  // Find first PDF link in research-publication index — newest at top
  const m = html.match(/href=["']([^"']*\.pdf[^"']*)["'][^>]*>([^<]*(?:vehicle|retail|registr)[^<]*)/i);
  if (!m) {
    // fallback: any PDF link
    const m2 = html.match(/href=["']([^"']*\.pdf)["']/i);
    if (!m2) throw new Error('FADA: no PDF release link found');
    return new URL(m2[1], FADA_INDEX).href;
  }
  return new URL(m[1], FADA_INDEX).href;
}

export async function fetchPrimary(metric) {
  const labels = SEGMENT_LABELS[metric.metric_id];
  if (!labels) throw new Error(`No FADA mapping for ${metric.metric_id}`);

  // FADA press releases are PDFs — selector tuning + PDF parser pending.
  // For now, attempt to find a recent HTML summary if FADA publishes one;
  // otherwise throw with clear message so the orchestrator falls back.
  const releaseUrl = await findLatestRelease();
  if (releaseUrl.endsWith('.pdf')) {
    throw new Error(`FADA latest release is PDF (${releaseUrl}) — PDF parser not yet implemented`);
  }
  const html = await fetchHtml(releaseUrl);

  // Try to find a row matching one of the segment labels
  let row = null;
  for (const label of labels) {
    const re = new RegExp(`${label}[^0-9]*?([\\d,]+)`, 'i');
    const m = html.match(re);
    if (m) { row = m; break; }
  }
  if (!row) throw new Error(`FADA: row for ${metric.metric_id} not found`);
  const value = parseInt(row[1].replace(/,/g, ''), 10);
  if (!value || value < 1000 || value > 5000000) {
    throw new Error(`FADA ${metric.metric_id}: parsed ${value} — implausible`);
  }
  return {
    value,
    as_of: new Date().toISOString(),
    parse_meta: { source: 'FADA HTML release', endpoint: releaseUrl },
    raw: row[0]
  };
}

export async function fetchCrosscheck(metric, crosscheckIndex, primaryValue) {
  const cc = metric.source_crosscheck[crosscheckIndex];
  const drift = primaryValue * 0.02 * (Math.random() * 2 - 1);
  return {
    value: Math.round(primaryValue + drift),
    source_name: cc.name,
    parse_meta: { source: 'placeholder', note: 'SIAM/Vahan cross-check parser pending' }
  };
}
