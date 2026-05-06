// Auto-evaluate metric.status against trigger_thresholds + value/trends.
// Replaces the prior behavior where data.status was a stamped field that
// never recomputed when the underlying value changed (causing false SHOCK
// pills on metrics that no longer qualified — e.g. Brent dropping below
// the $95 shock line but still flagged shock).
//
// Conservative principles:
//   1. If trigger_thresholds exist, evaluate them in order [shock, high, med].
//      The highest-severity rule that fires wins.
//   2. If no rule fires AND triggers exist → status = 'low'.
//   3. If no triggers (composites, narrative metrics) → use score-band fallback
//      (driver_* + composites have a 0-100 score; band by 30/50/70).
//   4. If we cannot interpret a rule (seasonal, IMD-dependent, drawdown from
//      rolling-window high), we SKIP that rule rather than guess.
//   5. Never crash — always return a valid status.

const SEVERITY = ['shock', 'high', 'med', 'low'];

// Try to evaluate a single trigger rule against the metric's current state.
// Returns true (fires), false (doesn't fire), or null (cannot evaluate).
function evalRule(rule, value, dod, mom, baseline_30d) {
  if (!rule || typeof rule !== 'string' || value == null) return null;
  const r = rule.trim();

  // Rules we can't safely evaluate — skip rather than guess
  if (/\bIMD\b/.test(r)) return null;                     // monsoon forecast
  if (/\bdrawdown\b/i.test(r)) return null;               // needs rolling-window high
  if (/\bWoW\b/.test(r)) return null;                     // needs week-over-week
  if (/\bin\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)/i.test(r)) {
    return null;                                          // seasonal
  }
  if (/\bintraday\b/i.test(r)) return null;               // intraday move

  // Compound: "X OR Y" → fire if either side fires
  if (/\bOR\b/i.test(r)) {
    const parts = r.split(/\s+OR\s+/i);
    let anyFired = false;
    let allUnknown = true;
    for (const p of parts) {
      const sub = evalRule(p, value, dod, mom, baseline_30d);
      if (sub === true) anyFired = true;
      if (sub != null) allUnknown = false;
    }
    if (anyFired) return true;
    if (allUnknown) return null;
    return false;
  }

  // Compound: "X AND Y" → fire only if both fire (skip if any sub is unknown)
  if (/\bAND\b/i.test(r)) {
    const parts = r.split(/\s+AND\s+/i);
    let allFired = true;
    for (const p of parts) {
      const sub = evalRule(p, value, dod, mom, baseline_30d);
      if (sub === null) return null;     // can't evaluate compound
      if (sub === false) allFired = false;
    }
    return allFired;
  }

  // value < N% baseline_30d  (Hormuz pattern)
  let m;
  if ((m = r.match(/value\s*<\s*([\d.]+)\s*%\s*baseline_30d/i))) {
    if (baseline_30d == null) return null;
    return value < (parseFloat(m[1]) / 100) * baseline_30d;
  }

  // MoM / daily move on percent fields
  if ((m = r.match(/MoM\s*[<>]\s*([\d.]+)\s*%?/i))) {
    if (mom == null) return null;
    return r.includes('>') ? mom > parseFloat(m[1]) : mom < parseFloat(m[1]);
  }
  if ((m = r.match(/daily\s+move\s*>\s*([\d.]+)\s*%/i))) {
    if (dod == null) return null;
    return Math.abs(dod) > parseFloat(m[1]);
  }

  // value > $N  /  value > N  /  value > N%
  if ((m = r.match(/value\s*>\s*\$?([\d.]+)\s*%?/i))) {
    return value > parseFloat(m[1]);
  }
  if ((m = r.match(/value\s*<\s*\$?([\d.]+)\s*%?/i))) {
    return value < parseFloat(m[1]);
  }

  // MTD < -₹N Cr  (FII flow pattern; use raw value since MTD is the value)
  if ((m = r.match(/MTD\s*<\s*-?₹?([\d,]+)/i))) {
    const threshold = -parseFloat(m[1].replace(/,/g, ''));
    return value < threshold;
  }
  if ((m = r.match(/MTD\s*>\s*₹?([\d,]+)/i))) {
    return value > parseFloat(m[1].replace(/,/g, ''));
  }

  return null;  // unknown rule shape
}

// Score band fallback for composite metrics (driver_*, india_risk_score)
// where the value IS a 0-100 score. No trigger_thresholds defined for these
// in the data files; we band by score.
function scoreBandStatus(value) {
  if (value >= 70) return 'shock';
  if (value >= 50) return 'high';
  if (value >= 30) return 'med';
  return 'low';
}

const COMPOSITE_PREFIXES = ['driver_', 'india_risk_score'];

function isComposite(metricId) {
  return COMPOSITE_PREFIXES.some(p => metricId === p || metricId.startsWith(p));
}

export function evaluateStatus(metric) {
  if (!metric) return null;
  const value = metric.value;

  // Composites: score-band fallback (no per-metric trigger rules)
  if (isComposite(metric.metric_id) && typeof value === 'number') {
    return scoreBandStatus(value);
  }

  // Trigger-based evaluation
  const triggers = Array.isArray(metric.trigger_thresholds) ? metric.trigger_thresholds : [];
  if (triggers.length === 0) {
    // No triggers, no composite → keep whatever the data file said
    return metric.status || 'low';
  }

  // Walk severity high→low, return first that fires
  for (const level of SEVERITY) {
    const trigsAtLevel = triggers.filter(t => t.level === level);
    for (const t of trigsAtLevel) {
      const fired = evalRule(t.rule, value, metric.dod_pct, metric.mom_pct, metric.baseline_30d);
      if (fired === true) return level;
    }
  }

  // Triggers exist but none fired → 'low' (the system's "all clear" default)
  return 'low';
}

// Sanity-check helper for tests / debugging
export { evalRule, scoreBandStatus };
