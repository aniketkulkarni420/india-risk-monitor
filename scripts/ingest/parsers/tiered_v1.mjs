// REAL fetcher · TIERED ORCHESTRATOR · tries multiple sub-parsers in priority order.
//
// Tier A enhancements (2026-05-12):
//   - Source cooldown: if a tier has failed N runs in a row, skip for K hours
//   - Anomaly detection: post-extraction, check z-score vs sparkline_12m;
//     if suspicious, run the NEXT tier and compare (shadow verification)
//
// Configure metric.source_primary.parser = "tiered:tiered_v1" plus a sibling
// field `tier_chain` in the metric JSON listing parser_ids to try in sequence.

import { resolve as resolveParser } from '../registry.mjs';
import { isInCooldown, recordSourceOutcome, checkAnomaly } from '../observability.mjs';
import { chainDiversity, classOfParser } from '../source-origin.mjs';

export async function fetchPrimary(metric) {
  const chain = metric?.source_primary?.tier_chain;
  if (!Array.isArray(chain) || chain.length === 0) {
    throw new Error(`tiered_v1: metric ${metric.metric_id} missing tier_chain`);
  }

  const sparkline = Array.isArray(metric?.sparkline_12m) ? metric.sparkline_12m : [];
  const errors = [];
  let primaryResult = null;
  let primaryTier = null;

  // Independence diversity check (Phase 4)
  const diversity = chainDiversity(chain);

  for (let i = 0; i < chain.length; i++) {
    const parser_id = chain[i];
    const cooldownKey = `${metric.metric_id}:${parser_id}`;

    // Skip if this metric+tier combo is in cooldown
    if (isInCooldown(cooldownKey)) {
      errors.push(`${parser_id}: in cooldown`); continue;
    }

    try {
      const { mode, parser } = resolveParser(parser_id, { live: true });
      if (mode !== 'live' || !parser) { errors.push(`${parser_id}: not registered`); continue; }

      const r = await parser.fetchPrimary(metric);
      if (r && typeof r.value === 'number' && Number.isFinite(r.value)) {
        try { recordSourceOutcome(cooldownKey, true); } catch {}
        primaryResult = {
          ...r,
          parse_meta: {
            ...(r.parse_meta || {}),
            tier_used: parser_id,
            tier_index: i,
            tier_origin_class: classOfParser(parser_id),
            chain_diversity_distinct: diversity.distinct,
            chain_all_same_class: diversity.allSameClass
          }
        };
        primaryTier = i;
        break;
      }
      try { recordSourceOutcome(cooldownKey, false); } catch {}
      errors.push(`${parser_id}: no value`);
    } catch (e) {
      try { recordSourceOutcome(cooldownKey, false); } catch {}
      errors.push(`${parser_id}: ${(e.message || '').slice(0, 100)}`);
    }
  }

  if (!primaryResult) {
    throw new Error(`tiered: all ${chain.length} tiers failed · ${errors.slice(0,3).join(' | ')}`);
  }

  // Anomaly check vs metric's own history
  const anomaly = checkAnomaly(primaryResult.value, sparkline);
  if (anomaly.suspicious && primaryTier !== null && primaryTier < chain.length - 1) {
    // Shadow verify with next tier
    const shadowParserId = chain[primaryTier + 1];
    try {
      const { mode, parser } = resolveParser(shadowParserId, { live: true });
      if (mode === 'live' && parser) {
        const sr = await parser.fetchPrimary(metric);
        if (sr && Number.isFinite(sr.value)) {
          const divergencePct = Math.abs((sr.value - primaryResult.value) / primaryResult.value) * 100;
          primaryResult.parse_meta = {
            ...primaryResult.parse_meta,
            anomaly: anomaly,
            shadow_tier: shadowParserId,
            shadow_value: sr.value,
            shadow_divergence_pct: +divergencePct.toFixed(2)
          };
          // If divergence >10%, prefer shadow (less likely to be a transient corruption)
          if (divergencePct > 10) {
            primaryResult.value = sr.value;
            primaryResult.parse_meta.tier_used = shadowParserId + ' (shadow override)';
          }
        }
      }
    } catch {}
  } else if (sparkline.length >= 5) {
    primaryResult.parse_meta = { ...primaryResult.parse_meta, anomaly_check: 'passed' };
  }

  return primaryResult;
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'tiered-crosscheck-pending', parse_meta: { source: 'pending' } };
}
