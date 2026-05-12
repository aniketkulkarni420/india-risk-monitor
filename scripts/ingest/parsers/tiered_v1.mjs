// REAL fetcher · TIERED ORCHESTRATOR · tries multiple sub-parsers in priority order.
//
// Configure metric.source_primary.parser = "tiered:tiered_v1" plus a sibling
// field `tier_chain` in the metric JSON listing parser_ids to try in sequence:
//
//   "source_primary": {
//     "parser": "tiered:tiered_v1",
//     "tier_chain": [
//       "html_render:moneycontrol_v1",
//       "html_render:bse_v1",
//       "rss:nitter_v1",
//       "llm:google_news_llm_v1"
//     ]
//   }
//
// Each tier is tried in order. First one that returns a plausible value wins.
// On failure, falls through to next tier. Final failure throws with summary.
//
// Manual override layer in ingest.mjs runs BEFORE tiered, so user-pasted JSON
// always wins. After all tiers fail, ingest falls back to last-known-good.

import { resolve as resolveParser } from '../registry.mjs';

export async function fetchPrimary(metric) {
  const chain = metric?.source_primary?.tier_chain;
  if (!Array.isArray(chain) || chain.length === 0) {
    throw new Error(`tiered_v1: metric ${metric.metric_id} missing tier_chain`);
  }
  const errors = [];
  for (const parser_id of chain) {
    try {
      const { mode, parser } = resolveParser(parser_id, { live: true });
      if (mode !== 'live' || !parser) { errors.push(`${parser_id}: not registered`); continue; }
      const r = await parser.fetchPrimary(metric);
      if (r && typeof r.value === 'number' && Number.isFinite(r.value)) {
        return { ...r, parse_meta: { ...(r.parse_meta || {}), tier_used: parser_id, tier_index: chain.indexOf(parser_id) } };
      }
      errors.push(`${parser_id}: no value`);
    } catch (e) {
      errors.push(`${parser_id}: ${(e.message || '').slice(0, 100)}`);
    }
  }
  throw new Error(`tiered: all ${chain.length} tiers failed · ${errors.slice(0,3).join(' | ')}`);
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'tiered-crosscheck-pending', parse_meta: { source: 'pending' } };
}
