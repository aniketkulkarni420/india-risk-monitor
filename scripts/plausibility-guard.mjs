// Per-metric plausibility band · 2026-05-06
// Catches parser misfires that would put implausible values on the live site
// (e.g. INR/USD jumping +14% in a day = Lehman-grade event = bad data).
//
// When today's value differs from yesterday's history-CSV value by MORE than
// the band, the bundle ROLLS BACK to yesterday's value and tags the metric
// with `value_anomaly: true` (UI can surface a "data check" pill if needed).
//
// Conservative principle: never display a value that would re-write history
// in a single day. Future ingest runs will overwrite the source JSON with
// fresh data; the rollback is purely a render-time safeguard.

export const MAX_DOD_PCT = {
  // FX · daily moves > 3% INR or > 5% DXY are crisis-grade
  inr_usd:                3,
  dxy:                    5,

  // Equity indices · NSE has 10% circuit breaker; cap at 8 for headline
  nifty_50:               8,
  bank_nifty:             8,
  nifty_pe_5y:           12,    // PE moves with index; loose to allow legitimate Nifty swings

  // Commodities · 15% is the historical extreme for daily moves
  brent_crude:           15,
  india_crude_basket:    15,
  gold_usd:              10,

  // Freight / shipping rates · weekly publication, can move 30%+ between updates
  vlcc_tanker_rates:     50,
  baltic_dirty_tanker:      30,
  drewry_wci:            30,

  // Hormuz · NOT capped. Legitimately swings 0-150 ships/day during real disruptions
  // and the canonical source (hormuz-watch tool) writes the real value daily.
  // A plausibility cap here would roll back legitimate fixes to bad seed history.
  // hormuz_throughput: deliberately omitted

  // Macro rates · point moves are small but percent moves can be large
  real_10y_yield:        50,    // small denominators

  // Real economy daily metrics · can swing on weekend / holiday
  power_demand:          30,
  fastag_toll:           25,

  // Real economy monthly metrics · vs prior month (or last sparkline point)
  // these get evaluated against sparkline_12m[-2] when no daily history exists
  steel_consumption:     30,    // catches 12 → 15,300 (1000× scale error)
  cement_dispatches:     25,
  gst_gross:             20,
  auto_2w:               40,    // FADA monthly can swing seasonally
  auto_pv:               40,
  auto_3w:               40,
  auto_cv:               40,
  auto_tractor:          50,
  air_pax:               25,
  rail_freight:          25,
  port_cargo:            25,

  // Notes:
  // - Trade-deficit, fiscal, CAD, GST etc. are monthly — DoD doesn't apply
  // - Flow metrics (FII/DII daily) can sign-flip; no useful % cap
  // - VIX legitimately moves > 50% in a day during regime shifts; no cap
};

// Cleanest "prior" reference for plausibility comparison:
//  · Daily metrics: history-CSV previous day (passed in as prevValue)
//  · Monthly metrics: last DISTINCT value in sparkline_12m (avoids comparing
//    against a flat-line mock-seed tail; e.g. steel sparkline is
//    [12, 12.1, 12.2, 12.3, 12.15, 12.4, 15300, 15300, ...] — we want 12.4)
function priorReference(metric, prevValue) {
  if (typeof prevValue === 'number' && prevValue !== 0) return prevValue;
  const sl = Array.isArray(metric.sparkline_12m) ? metric.sparkline_12m : [];
  if (sl.length < 2) return null;
  // Walk backwards from second-to-last; skip values that equal the current
  // (mock-seed contamination)
  const cur = metric.value;
  for (let i = sl.length - 2; i >= 0; i--) {
    if (typeof sl[i] === 'number' && sl[i] !== cur && sl[i] !== 0) return sl[i];
  }
  return null;
}

// Apply guard. Returns possibly-modified metric (mutates .value if anomalous).
// `prevValue` should be the prior-day value from history CSV (already loaded
// by bundle.mjs via previousDayValue()). For monthly metrics where no daily
// history exists, falls back to the last distinct sparkline_12m value.
export function applyPlausibilityGuard(metric, prevValue) {
  const ref = priorReference(metric, prevValue);
  if (ref == null) return null;
  const cap = MAX_DOD_PCT[metric.metric_id];
  if (cap == null) return null;

  // CONTAMINATED-HISTORY GUARD · 2026-05-11
  // When a parser scale fix drops the value 100× (e.g. steel 15300 → 15.3),
  // the prior CSV value is contaminated by old mis-parsed runs. Don't roll
  // back the GOOD new value to the BAD old value.
  // Heuristic: if ratio between current and prior > 20×, treat prior as
  // contaminated and let the new value pass. (10× is still possible from
  // legitimate scale events; 20× is structurally impossible for any IRM metric.)
  const ratio = Math.max(Math.abs(metric.value), Math.abs(ref)) /
                Math.max(Math.min(Math.abs(metric.value), Math.abs(ref)), 0.0001);
  if (ratio > 20) {
    metric._guard_prior_contaminated = `prior=${ref} too far from current=${metric.value} (ratio ${ratio.toFixed(0)}×) · trusted parser`;
    return null;  // let the new value through; mark for ops visibility
  }

  const dodAbsPct = Math.abs((metric.value - ref) / ref) * 100;
  if (dodAbsPct <= cap) return null;

  // RELEASE-CADENCE EXEMPTION · 2026-06-11
  // For Monthly/Quarterly releases, "rolling back" replaces this period's value
  // with LAST period's value under this period's date — guaranteed wrong, and it
  // blocks legitimate seasonality (GST April→May drops ~20% every year; FASTag
  // Jan-2024→May-2026 gap moves +37%). These metrics are protected by the
  // vintage gate + per-parser plausible() bounds instead. Flag, don't roll back.
  const freq = metric.source_primary?.frequency || '';
  if (/Monthly|Quarterly|Per release|Fortnightly/i.test(freq)) {
    metric._change_review = { move_pct: +dodAbsPct.toFixed(2), cap, ref, note: 'large move on release-cadence metric · kept (no rollback) · review if unexpected' };
    return null;
  }

  // For monthly metrics that fell back to sparkline reference, use that as restoredTo
  prevValue = ref;
  // Anomaly · roll back
  const original = metric.value;
  metric._original_value = original;
  metric._anomaly_pct = +dodAbsPct.toFixed(2);
  metric._anomaly_cap_pct = cap;
  metric.value = prevValue;
  metric.value_anomaly = true;
  // Trends become unreliable when value rolled back — blank dod, keep mom/yoy
  metric.dod_pct = null;
  metric.dod_delta = null;
  return { rolledBack: original, restoredTo: prevValue, dodAbsPct: +dodAbsPct.toFixed(2), cap };
}
