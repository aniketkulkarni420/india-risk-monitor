// Cross-check verification engine.
// Rule (locked, IRM_Build_Spec §05): if cross-check disagrees with primary by > 5%,
// metric flips to verification_state: crosscheck_pending and renders the LOWER value
// with a warning badge.

const DEFAULT_THRESHOLD = 0.05; // 5%

export function divergencePct(a, b) {
  if (a === b) return 0;
  if (a === 0 || b === 0) return Infinity;
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  return Math.abs(a - b) / Math.abs(a);
}

/**
 * @param {{ value: number|string, as_of: string }} primary
 * @param {Array<{ value: number|string, source_name: string }>} crosschecks
 * @param {{ threshold?: number, lowerOfTwo?: boolean }} opts
 * @returns {{
 *   value, verification_state, divergence_pct, used_value_source, notes
 * }}
 */
export function verify(primary, crosschecks = [], opts = {}) {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;

  // No cross-checks? source_pending — Gate 2 should have caught this earlier.
  if (!crosschecks || crosschecks.length === 0) {
    return {
      value: primary.value,
      verification_state: 'source_pending',
      divergence_pct: null,
      used_value_source: 'primary',
      notes: 'no cross-check sources defined'
    };
  }

  // Label-type metrics (regime, state) — no numeric divergence; trust primary.
  if (typeof primary.value !== 'number') {
    return {
      value: primary.value,
      verification_state: 'verified',
      divergence_pct: null,
      used_value_source: 'primary',
      notes: 'label metric — divergence check skipped'
    };
  }

  // Find max divergence across all cross-checks.
  let maxDiv = 0;
  let worstSource = null;
  let lowerValue = primary.value;
  for (const cc of crosschecks) {
    if (typeof cc.value !== 'number') continue; // can't compare
    const d = divergencePct(primary.value, cc.value);
    if (d > maxDiv) { maxDiv = d; worstSource = cc.source_name; }
    if (Math.abs(cc.value) < Math.abs(lowerValue)) lowerValue = cc.value;
  }

  if (maxDiv > threshold) {
    return {
      value: lowerValue, // render the lower value when in dispute
      verification_state: 'crosscheck_pending',
      divergence_pct: +(maxDiv * 100).toFixed(2),
      used_value_source: 'lower_of_two',
      notes: `divergence ${(maxDiv*100).toFixed(2)}% > ${(threshold*100).toFixed(0)}% threshold (vs ${worstSource})`
    };
  }

  return {
    value: primary.value,
    verification_state: 'verified',
    divergence_pct: +(maxDiv * 100).toFixed(2),
    used_value_source: 'primary',
    notes: null
  };
}
