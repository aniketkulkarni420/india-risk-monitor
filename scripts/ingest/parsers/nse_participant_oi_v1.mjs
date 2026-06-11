// NSE participant-wise open interest — FII net index-futures positioning.
//
// Source: https://archives.nseindia.com/content/nsccl/fao_participant_oi_DDMMYYYY.csv
// Free, official, daily (published post-market). No cookie warmup needed on the
// archives host. The FII row carries "Future Index Long" / "Future Index Short"
// in contracts.
//
// Value contract: FII net index-futures position in CONTRACTS
//   (long − short; negative = net short = institutions positioned for downside).
// extra: long/short legs, long ratio %, total OI for context.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 IRM-Ingest/1.0';

function ddmmyyyy(d) {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return dd + mm + String(d.getUTCFullYear());
}

async function fetchCsvForDate(d) {
  const url = `https://archives.nseindia.com/content/nsccl/fao_participant_oi_${ddmmyyyy(d)}.csv`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const text = await res.text();
  if (!/Client Type/i.test(text)) return null;
  return { text, url };
}

export function parseFiiNet(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  const headerIdx = lines.findIndex(l => /Client Type/i.test(l));
  if (headerIdx === -1) throw new Error('participant OI: header row not found');
  const header = lines[headerIdx].split(',').map(s => s.trim());
  const iLong = header.findIndex(h => /Future Index Long/i.test(h));
  const iShort = header.findIndex(h => /Future Index Short/i.test(h));
  if (iLong === -1 || iShort === -1) throw new Error('participant OI: index futures columns not found');
  const fiiLine = lines.slice(headerIdx + 1).find(l => /^FII\b|^"?FII"?,/i.test(l.trim()));
  if (!fiiLine) throw new Error('participant OI: FII row not found');
  const cells = fiiLine.split(',').map(s => s.trim().replace(/"/g, ''));
  const long = parseInt(cells[iLong], 10);
  const short = parseInt(cells[iShort], 10);
  if (!Number.isFinite(long) || !Number.isFinite(short)) throw new Error('participant OI: FII values not numeric');
  return { long, short, net: long - short };
}

export async function fetchPrimary(metric) {
  // Walk back up to 6 calendar days to cover weekends/holidays.
  const now = new Date();
  let got = null, asOfDate = null;
  for (let back = 0; back <= 6; back++) {
    const d = new Date(now.getTime() - back * 86400000);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue; // weekend — no publish
    got = await fetchCsvForDate(d);
    if (got) { asOfDate = d; break; }
  }
  if (!got) throw new Error('participant OI: no CSV found in last 6 days');

  const { long, short, net } = parseFiiNet(got.text);
  // Plausibility: total index-futures OI runs in the lakhs of contracts.
  if (Math.abs(net) > 2_000_000) throw new Error(`participant OI: implausible FII net ${net}`);

  const longRatioPct = (long + short) > 0 ? Math.round((long / (long + short)) * 1000) / 10 : null;

  return {
    value: net,
    as_of: new Date(Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth(), asOfDate.getUTCDate())).toISOString(),
    parse_meta: { source: 'NSE participant-wise OI CSV', url: got.url },
    extra: {
      fii_index_fut_long: long,
      fii_index_fut_short: short,
      fii_long_ratio_pct: longRatioPct
    }
  };
}

export async function fetchCrosscheck(metric, crosscheckIndex, primaryValue) {
  return {
    value: primaryValue,
    source_name: 'crosscheck-pending/nse-participant-oi',
    parse_meta: { source: 'pending' }
  };
}
