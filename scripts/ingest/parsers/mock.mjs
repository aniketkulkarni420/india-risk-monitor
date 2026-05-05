// Mock parser — generates plausible canned values for any metric.
// Used when no real fetcher is registered for a parser_id.
//
// Strategy: read the metric's CURRENT value, perturb by a small random delta,
// and return that as the new value. Cross-checks return value within 4% of primary
// (passes verify rule). Output is deterministic if seeded; otherwise random in band.
//
// This simulates a healthy ingest: small daily moves, cross-check agreement.

function jitter(value, pct, valueFormat) {
  if (typeof value !== 'number') return value;
  const delta = value * pct * (Math.random() * 2 - 1);
  const raw = value + delta;
  switch (valueFormat) {
    case 'integer': return Math.round(raw);
    case 'decimal_1': return +raw.toFixed(1);
    case 'decimal_2': return +raw.toFixed(2);
    case 'percent':
    case 'ratio_x': return +raw.toFixed(2);
    case 'bps': return Math.round(raw);
    default:
      return +raw.toFixed(value > 1000 ? 0 : value > 10 ? 2 : 4);
  }
}

export async function fetchPrimary(metric) {
  const newValue = jitter(metric.value, 0.015, metric.value_format); // ±1.5% daily move
  return {
    value: newValue,
    as_of: new Date().toISOString(),
    parse_meta: { source: 'mock', basis: metric.value },
    raw: null
  };
}

export async function fetchCrosscheck(metric, crosscheckIndex, primaryValue) {
  // Cross-check value within 2% of primary — should pass verify
  const cc = metric.source_crosscheck[crosscheckIndex];
  const newValue = jitter(primaryValue, 0.02, metric.value_format);
  return {
    value: newValue,
    source_name: cc.name,
    parse_meta: { source: 'mock', drift_basis: primaryValue }
  };
}
