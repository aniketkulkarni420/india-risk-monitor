# IRM architecture · current state (2026-05-12)

This doc describes the India Risk Monitor data-ingestion system as it stands after the Tier S/A/B reliability overhaul. Use this to onboard or to plan changes.

---

## High-level

```
                         ┌─────────────────────────────────────┐
                         │     GitHub Actions cron triggers     │
                         │  ingest.yml  ·  ingest-india-runner  │
                         │  self-heal  ·  prune-snapshots       │
                         └────────────────┬────────────────────┘
                                          │
                  ┌───────────────────────┴────────────────────┐
                  │                                            │
       Cloud runners (US/EU IP)              Self-hosted runner (India IP)
       runs-on: ubuntu-latest                runs-on: [self-hosted, india]
                  │                                            │
                  └─────────────────────┬──────────────────────┘
                                        │
                              scripts/ingest.mjs
                                        │
                                        ▼
                              For each target metric:
                                        │
                  ┌─────────────────────┴───────────────────────┐
                  │                                             │
            Layer 0: manual override                  Layer 1: parser
            data/manual-overrides/{id}.json           registry resolves to:
                                                       - tiered_v1 (orchestrator) ─┐
                                                       - or direct parser_id      │
                                                                                  ▼
                                                          ┌──────────────────────────────────────┐
                                                          │   Tiered chain (priority-ordered)     │
                                                          │   [parser_id_A, parser_id_B, ...]    │
                                                          │                                       │
                                                          │   For each tier:                      │
                                                          │   - Skip if in cooldown               │
                                                          │   - Try fetchPrimary()                │
                                                          │   - If value plausible: anomaly check │
                                                          │     - If suspicious: shadow-verify    │
                                                          │   - Return first success              │
                                                          └──────────────────────────────────────┘
                                                                          │
                                                                          ▼
                                                          plausibility-guard + sparkline rotation
                                                          → write data/metrics/{id}.json
                                                          → append data/history/{id}.csv
                                                          → save data/snapshots/{id}/...
                                                          → record parser-health.json + telemetry
                                                                          │
                                                                          ▼
                                                            scripts/bundle.mjs
                                                            (incl. composite recompute,
                                                             freshness propagation,
                                                             system_state banner)
                                                                          │
                                                                          ▼
                                                            app/dist/data.json
                                                            (Cloudflare Pages serves to /)
```

---

## Layers explained

### Layer 0 · Manual override (highest priority)
- Drop a JSON file at `data/manual-overrides/{metric_id}.json`
- Auto-expires after 60 days (or explicit `expires_at`)
- Bypasses all parsers — value goes straight to history
- Use case: stuck upstream, urgent fix, manual data entry

### Layer 1 · Parser registry
- `scripts/ingest/registry.mjs` maps `parser_id → parser module`
- Each parser exports `fetchPrimary(metric)` returning `{ value, as_of, parse_meta, raw }`

### Layer 2 · Tiered orchestrator
- For metrics using `tiered:tiered_v1` parser_id
- Sibling field `source_primary.tier_chain` is an array of fallback parser_ids
- Tries each in order; first plausible value wins
- Source cooldown: 3 consecutive failures → 6h skip
- Anomaly check: z-score >4 vs sparkline → shadow-verify with next tier

### Layer 3 · Parser modules

| Parser kind | When to use | Examples |
|---|---|---|
| `csv_download:*` | Direct CSV with known schema | `nse_fii_dii_v1`, `nse_rbi_direct_v1` |
| `json_api:*` | Structured JSON endpoint | `dbnomics_v1`, `yahoo_finance_v1` |
| `html_scrape:*` | Static HTML + regex | `india_govt_v1`, `tradingeconomics_v1` |
| `html_render:*` | JS-rendered, needs Playwright | `playwright_render_v1`, `moneycontrol_v1`, `web_llm_v1` |
| `rss:*` | RSS/Atom feed | `pib_rss_v1`, `google_news_rss_v1`, `publisher_rss_v1` |
| `pdf:*` | PDF document | `pdf_v1`, `ppac_v1`, `eaindustry_ieci_v1` |
| `llm:*` | Free LLM extraction | `llm_extract_v1`, `google_news_llm_v1`, `pib_search_v1` |
| `tiered:*` | Orchestrator | `tiered_v1` |
| `press_release:*` | Aliases routed by registry | various |

### Layer 4 · Resilient fetch
- `fetch-resilient.mjs` provides `fetchResilient(url, opts)` and `fetchSmart(url, opts)`
- `fetchResilient`: retry × backoff, UA spoof, Wayback fallback, optional Google Cache
- `fetchSmart` (two-stage): cheap fetch first, escalate to Playwright if response looks JS-rendered

### Layer 5 · Shared browser pool
- `browser-pool.mjs` exports `getSharedBrowser()` — single chromium instance
- All Playwright parsers reuse this. Saves 2-3s × N parsers per metric.

### Layer 6 · Observability
- `parser-health.json` · per-parser status (green/amber/red), consecutive_failures
- `source-cooldown.json` · per-source skip state
- `llm-telemetry.json` · per-provider call count + success rate + daily limits headroom
- `data/self-heal-reports/*.md` · auto-generated diagnostic reports for chronically-failing parsers

---

## Files / directories at a glance

| Path | Purpose |
|---|---|
| `data/metrics/<section>/<id>.json` | Per-metric current value + metadata |
| `data/history/<id>.csv` | Daily history (used for trends + anomaly detection) |
| `data/composites/<id>.json` | Driver scores + India Risk Score |
| `data/sectors/*.json` | Sector composites |
| `data/manual-overrides/<id>.json` | Layer 0 override (user-managed) |
| `data/snapshots/<id>/YYYY-MM-DD.{html.gz,json}` | Successful-fetch snapshots for self-heal |
| `data/parser-health.json` | Per-parser status |
| `data/source-cooldown.json` | Per-source cooldown state |
| `data/llm-telemetry.json` | LLM call telemetry |
| `data/self-heal-reports/*.md` | Self-heal diagnostic reports |
| `app/dist/data.json` | Bundled output for dashboard |
| `scripts/ingest.mjs` | Single-metric ingest |
| `scripts/ingest-india-loop.mjs` | India runner loop (parallel + skip-if-fresh) |
| `scripts/bundle.mjs` | Bundle all metrics + composites for dashboard |
| `scripts/validate.mjs` | Schema validation gate |
| `scripts/self-heal.mjs` | Generate diagnostic reports for red parsers |
| `scripts/ingest/registry.mjs` | parser_id → module mapping |
| `scripts/ingest/parsers/*.mjs` | Parser implementations |
| `scripts/ingest/browser-pool.mjs` | Shared Playwright singleton |
| `scripts/ingest/observability.mjs` | Source cooldown + LLM telemetry + anomaly |
| `scripts/ingest/fetch-resilient.mjs` | Retry/backoff/Wayback + `fetchSmart` two-stage |
| `scripts/ingest/manual-override.mjs` | Layer 0 lookup |
| `scripts/ingest/snapshot-store.mjs` | Snapshot writer + auto-prune |
| `scripts/ingest/schedule.mjs` | Cron slot membership |
| `schema/metric.schema.json` | Per-metric JSON schema |
| `.github/workflows/ingest.yml` | Cloud-runner scheduled ingest |
| `.github/workflows/ingest-india-runner.yml` | India-IP scheduled ingest |
| `.github/workflows/self-heal.yml` | Daily diagnostic for red parsers |
| `.github/workflows/parser-health-alert.yml` | Auto-issue when parsers go red |
| `.github/workflows/prune-snapshots.yml` | Monthly snapshot retention |

---

## Adding a new metric

1. Create `data/metrics/<section>/<id>.json` matching schema. Include `source_primary.parser` and (if tiered) `source_primary.tier_chain`.
2. If a new parser kind is needed: add to `scripts/ingest/parsers/<name>_v1.mjs` exporting `fetchPrimary` + `fetchCrosscheck`.
3. Register the parser in `scripts/ingest/registry.mjs`.
4. Add to `scripts/ingest/schedule.mjs` slot membership.
5. Update `CADENCE_DAYS` in `scripts/parser-health.mjs` if cadence differs.
6. If India-IP needed: add to `METRICS` array in `scripts/ingest-india-loop.mjs`.
7. Run `npm run validate` then `npm run ingest -- --live --metric=<id>` to verify.

---

## Future architecture · YAML config-as-data (deferred)

Currently each metric requires touching 4+ `.mjs` files to add. A config-as-data refactor would let you define a metric in pure YAML:

```yaml
metric: pol_demand
section: economy
unit: Mn tonnes
cadence_days: 30
plausibility: [15, 30]
sources:
  - kind: pdf
    url: https://www.ppac.gov.in/consumption/petroleum-products
    pdf_finder: 'href="[^"]+PT_Consumption[^"]+\.pdf"'
    extract: 'TOTAL\s+(\d+)'
    value_transform: 'v / 1000'
  - kind: webpage_llm
    url: https://en.wikipedia.org/wiki/Petroleum_in_India
    target: 'most recent monthly petroleum consumption in MMT'
  - kind: news_search_llm
    query: 'India fuel consumption monthly'
    target: '...'
```

Then a single `yaml_engine_v1.mjs` parser dispatches per `kind`. **No code changes to add a metric.** Estimated effort: 2 days. Deferred until scaling beyond personal use.

---

## Operational runbook

### India runner died / laptop off
- Cron triggers queue up · no data corruption
- When laptop comes back: runner auto-starts (Task Scheduler), picks up next cron
- For urgent backfill: `gh workflow run ingest-india-runner.yml`

### Parser stuck red for >5 runs
- Self-heal opens GitHub issue with diagnosis
- Manual override drops in 60 seconds
- Or check `data/source-cooldown.json` — host may be in 6h cooldown

### LLM quota exhausted
- Check `data/llm-telemetry.json` for headroom_pct
- If Groq exhausted: ingest falls through to Gemini, then Cloudflare
- Rotate API keys: settings.json → GROQ_API_KEY etc

### Repo bloat from snapshots
- `prune-snapshots.yml` runs 1st of month, drops files >30 days
- Can run manually via `gh workflow run prune-snapshots.yml`

---

## Cost

- GitHub Actions: free tier (2000 min/month, India runner is unlimited)
- Cloudflare Pages: free tier
- Groq API: free tier (14400 req/day)
- Gemini API: free tier (1500 req/day)
- Cloudflare Workers AI: free tier (10000 neurons/day)
- DBnomics, data.gov.in, Wayback Machine: free, no quotas

**Total monthly cost: $0.** Self-hosted runner uses your existing PC + power.
