# IRM · Project state · single-glance status

Last updated: 2026-05-05 (post-PDF-pass · 11 parsers added in one session · 20/21 free-source metrics now live)

---

## Phases

| # | Phase | Status |
|---|---|---|
| 1 | Data contract scaffold (70 metric JSONs + schema + validator) | ✅ |
| 2 | Ingest pipeline · daily metrics · mock mode | ✅ |
| 3 | Atomic components | ✅ |
| 4 | Composite components | ✅ |
| 5 | Desktop page assembly | ✅ |
| 5.5 | Redesign rebuild + tabs + clarity fixes | ✅ |
| 6 | Visual audit gate · Playwright at 5 viewports | ✅ |
| 7 | Mobile tree at /m/ | ✅ |
| 8 | /sources/ route + 5Y backfill + drawer period selector | ✅ |
| 9 | Real ingest · 13 parsers registered · 9 fetch live data verified | ✅ framework / 🟡 selector tuning ongoing |
| **10** | **Production deploy · LIVE at https://india-risk-monitor.pages.dev/** | ✅ |
| 11 | Monitoring (UptimeRobot + Sentry) | pending |
| 12 | Selector tuning per-source (Phase 9 follow-up) | 🟡 next |

---

## What just shipped (most recent session)

- **LIVE** at https://india-risk-monitor.pages.dev/ via Cloudflare Pages + GitHub Actions
- Repo: `aniketkulkarni420/india-risk-monitor` (private)
- Tabs UI: Flows / Macro / Economy / Freight / Market / Sectors / All — sticky below hero, URL-hash driven
- Period-aware trend labels: live/24h → `1D`/`1W`, weekly → `1W`/`1M`, monthly → `MoM`/`YoY`, quarterly → `1Q`/`1Y` (utils.mjs `trendLabels()`)
- Value-format suffixes: `₹2.00 L Cr`, `$692.4 Bn`, `−14,305 Cr`, `+256 bps`, `$/40ft` etc.
- Live-mode silent-mock bug FIXED: `registry.resolve(parser_id, {live:true})` returns `mode='unregistered'` when no real parser exists; ingest skips. Reverted commit `8568c66` that mock-poisoned timestamps.
- Honest topbar: shows `⚠ Live X/Y · others seed data` (was: misleading "Updated date")
- 9 metrics now have REAL live data (NSE indices, NSE FII/DII, Brent crude). 60+ metrics still seed because parsers either unregistered OR registered with selectors that don't match real HTML.
- Cloudflare auto-PR for Workers/wrangler config closed (we use Pages, not Workers)

## Live data status (2026-05-05 21:30 UTC · post-Tier-1+2 grind)

```
40 verified live    — covers all free macro + market + flows + freight + econ
 1 crosscheck_pending — brent_crude (xcheck divergent ~8%)
 3 skipped          — no live parser (mock seed only)
14 failed           — registered parsers that regex-missed locally; will
                      retry from CI / next selector tuning pass
```

**Hormuz V1 endpoint shipped to hormuz-watch.pages.dev/api/snapshot.**
Once Cloudflare deploys (~30-60s after push), IRM's hormuz_throughput
flips from failed to verified live on next ingest tick.

V2 (Cloudflare Worker + AISStream + KV live aggregation) deferred until
Aniket approves V1 working. Plan in memory at irm/hormuz_v2_worker_pending.md.

**Verified-live by section (37 total):**

- **Hero / Composites (10):** india_risk_score, institutional_flow_regime, real_economy_state, supply_chain_state, driver_oil_physical, driver_freight, driver_institutional_flows, driver_india_macro, driver_real_economy, driver_sector_breadth — all derived via `derived_v1.mjs`
- **Flows (5):** fii_equity_daily/mtd/cytd, dii_daily/mtd/_, absorption_ratio
- **Macro (10):** inr_usd (RBI), cpi_inflation/iip_growth/wpi_inflation/repo_rate (TE), trade_deficit/cad_pct_gdp/banking_liquidity (TE M3), credit_deposit_growth (TE), real_10y_yield/ind_us_10y_spread (derived), pmi_combined (TE), fiscal_deficit_pct/govt_capex_runrate (TE)
- **Real economy (7):** gst_gross (GSTN xlsx), auto × 5 (FADA PDF), steel_consumption (TE), power_demand (vidyutpravah)
- **Freight (3):** brent_crude (TE), drewry_wci (Drewry direct), baltic_dry_index (TE)
- **Market (5):** nifty_50/bank_nifty/nifty_pe_5y/india_vix (NSE), gold_usd/dxy (TE), high_yield_credit_spread (TE)

**All sources are free. No API keys. No paid tiers.**

## Parser strategy notes

- **PIB endpoints (search.pib.gov.in, AllRelease.aspx) are unreachable from
  non-IN networks / aggressive WAFs.** Pivoted CPI/IIP/WPI to Trading Economics
  India pages — same source data (MoSPI/OEA), much more stable HTML.
  See `scripts/ingest/parsers/pib_press_v1.mjs` (file kept its name for now;
  function changed).
- **FADA = PDF-only**, `pdf-parse` v2 (PDFParse class API) installed and wired.
  Module-scoped 5-min cache: 5 metrics resolve from 1 PDF download.
  All 5 segments verified live within ≤2% cross-check tolerance.
- **POSOCO replaced by `vidyutpravah.in`** (Ministry of Power · National Power Portal).
  Stable selectors `id="CurrentDemandMET"` / `id="PrevDemandMET"`. Source has slow
  TLS handshake; parser uses 45s timeout + 1 retry. Yesterday's reading serves as
  built-in cross-check.
- **GST gross uses GSTN's authoritative `Gross_Net_Tax_collection.xlsx`** (linked
  from gst.gov.in/download/gststatistics). Sheet picker grabs the most-recent
  `MMM-YY` sheet, extracts the "Total Gross GST Revenue" row column C
  (current-month value in crore), converts to lakh crore. `xlsx` (SheetJS) installed.

## Recent UI clarity pass (2026-05-05)

Per `IRM_Movement_Options.html` + `IRM_Cluster_Placement_Options.html` reviews:
- `formatValue()` now honours `unit` arg → bare numbers get suffixes everywhere
- Per-row `as on …` pill in TableRow + viz-title stamps on every chart
- Reference bands on VIX + Gold (5Y range with marker)
- Glossary `?` icon on Regime Banner
- Tooltips on currency strip + freight indices
- New chart helper `renderSeasonalityStrip()` — 12m vs prior 12m paired bars
- A+E pattern shipped to 4 Real-Economy clusters (Tax/Movement/Production/Discretionary)
  Featured cyclical metric per cluster: GST · Rail · Power · Reservoir
- New metric: `foreign_tourist_arrivals` in Discretionary
- Box-office source (BoxOfficeIndia) verified fragile — skipped per "only if verified"

## Context note for next session

Conversation ran out of context after deployment. Files in repo + decision HTMLs in `C:/Users/anike/Downloads/` are source of truth. Read this file + `RESUME.md` first.

---

## Architecture (locked)

- **Frontend:** static HTML + ES modules + CSS, no framework. Bundled metric data in `app/dist/data.json`.
- **Backend:** none in production. Build-time scripts in Node.
- **Hosting:** Cloudflare Pages + GitHub Actions cron (D1 in `IRM_Tech_Architecture.html`).
- **Cadence:** 9 cron slots, IST. 70 metrics × ~1 update/day average.
- **Cost:** $0/month at this scale (within free tiers).
- **Audit:** every data update is a git commit, signed by `github-actions[bot]`.

---

## Component library (locked at 8)

| Component | File | Purpose |
|---|---|---|
| TableRow | `app/components/TableRow.mjs` | Pattern 1 dense row · ≥80% of metric renders |
| DisplayTile | `app/components/DisplayTile.mjs` | Pattern 2 tile (storybook only currently) |
| Sparkline | `app/components/Sparkline.mjs` | Primitive SVG line |
| Band | `app/components/Band.mjs` | Risk-score viz |
| SectionFrame | `app/components/SectionFrame.mjs` | Section wrapper |
| MetricDrawer | `app/components/MetricDrawer.mjs` | Right-slide drawer · URL deep-link |
| StickyTOC | `app/components/StickyTOC.mjs` | Right-rail TOC with counts + shock badges |
| CmdKPalette | `app/components/CmdKPalette.mjs` | ⌘K global navigation surface |

Helpers (not counted as components): `utils.mjs`, `charts.mjs`. **HeatmapCell.mjs retired** in Phase 5.5.

---

## Key files — where things live

| Topic | Path |
|---|---|
| Metric data | `data/metrics/{flows,macro,economy,freight,market}/*.json` (60) + `data/composites/*.json` (10) + `data/sectors/sectors.json` |
| Bundled data (renderer reads this) | `app/dist/data.json` (~95 KB, regenerated by `npm run bundle`) |
| Schema (data contract) | `schema/metric.schema.json` |
| Validator | `scripts/validate.mjs` (Gate 2) |
| Build audit (Gate 1+3) | `scripts/audit.mjs` |
| Visual audit (Gate 4 · Playwright) | `scripts/visual-audit.mjs` |
| Bundler | `scripts/bundle.mjs` |
| Standalone preview builder | `scripts/build-preview.mjs` → `C:/Users/anike/Downloads/IRM_Preview.html` |
| Ingest orchestrator | `scripts/ingest.mjs` |
| Ingest parsers | `scripts/ingest/parsers/*.mjs` (1 real: NSE FII/DII; rest mock) |
| Schedule definitions | `scripts/ingest/schedule.mjs` |
| Cross-check engine | `scripts/ingest/crosscheck.mjs` |
| 5Y backfill orchestrator | `scripts/backfill.mjs` |
| Dev server | `scripts/serve.mjs` (PORT=8080 default) |
| Desktop page | `app/index.html` + `app/main.mjs` |
| Mobile page | `app/m/index.html` + `app/m/main.mjs` |
| /sources/ page | `app/sources/index.html` + `main.mjs` |
| History CSVs | `data/history/{metric_id}.csv` (59 mock-populated) |

---

## Locked design decisions (don't re-litigate)

All from `IRM_Design_Options.html` v1 + `IRM_DataViz_Audit_v2.html` + `IRM_Design_Audit.html`:

- **Layout model:** Editorial cockpit (Option C)
- **Typography:** Manrope + JetBrains Mono
- **Color:** Warm institutional (`#0a0d12` bg + `#d4a574` accent)
- **Section shapes:** 3 types (table-led / chart-led / cluster-led)
- **Hero:** Vital signs panel (band + 6 sorted driver bars) — replaces 4-equal tiles
- **Today line:** Bullet rows replace lead paragraph
- **Sectors:** Ranked list with 6-driver pressure bars in expansion (NOT radar)
- **Tabs:** Killed; replaced by sticky right-rail TOC + Cmd-K
- **Sources:** Per-section footers + dedicated `/sources/` route
- **Trend defaults:** MoM + YoY + 12m sparkline minimum, free sources only, ≥2 cross-checks per metric
- **Component cap:** 8 (locked)
- **Hosting:** Cloudflare Pages + GitHub Actions cron

---

## Decision docs (HTML, in Downloads)

If a new agent picks this up cold, read in this order:
1. `IRM_Tech_Architecture.html` — system diagram, hosting, CI/CD
2. `IRM_Design_Options.html` — original layout/component decisions
3. `IRM_Design_Audit.html` — discoverability + section-shape redesigns
4. `IRM_DataViz_Audit.html` + `_v2.html` — per-section viz patterns
5. `IRM_Build_Spec.html` — engineering contract (data + audit gates)
6. `IRM_Typography_Color_Options.html` — design tokens reference
7. `India_Risk_Monitor_Handoff_Summary.md` (in Downloads, oldest) — V40-V60 history + non-negotiables

---

## Phase 9 — what to do (in order)

Real ingest implementations · replace mocks one parser at a time. Pattern in `scripts/ingest/parsers/nse_fii_dii_v1.mjs` is the reference.

**Priority queue (ordered by signal × effort ratio):**

1. ✅ NSE FII/DII (`csv_download:nse_fii_dii_v1`) — implemented Phase 2 · framework code in place
2. ✅ Public Brent crude (`json_api:public_oil_v1`) — **live tested, fetched $104 from Trading Economics**; cross-check selector tuning pending
3. 🟡 RBI INR reference rate (`json_api:rbi_refrate_v1`) — registered + runs, regex needs tuning vs real RBI HTML
4. 🟡 Grid India power demand (`json_api:gridindia_v1`) — registered + runs; POSOCO daily report is PDF, needs PDF parser OR alternate endpoint
5. ⏭ NSE indices (`csv_download:nse_indices_v1`) — extends NSE FII/DII pattern
6. ⏭ PIB GST press release (`press_release:gst_monthly_v1`) — pattern for all PIB monthly releases
7. ⏭ FADA monthly (`press_release:fada_monthly_v1`) — pattern for all 5 auto metrics
8. ⏭ MoSPI CPI (`press_release:mospi_cpi_v1`) — pattern for IIP/WPI too
9. ⏭ MarineTraffic Hormuz (`html_scrape:hormuz_v1`) — unique-edge metric

**Live test results (2026-05-05):** Brent works end-to-end at $104.39 from Trading Economics. RBI + POSOCO need selector tuning — fetchers run, parse miss is a regex problem not architecture. Failure mode is graceful: pipeline continues, metric flips to `source_pending`, never crashes.

To register a new real parser:
1. Write `scripts/ingest/parsers/{parser_id}.mjs` exporting `fetchPrimary` + `fetchCrosscheck`
2. Add to `REAL` map in `scripts/ingest/registry.mjs`
3. Test: `npm run ingest -- --live --metric={metric_id}`

---

## Phase 10 — deployment checklist (when ready)

- [ ] User: `gh auth login --web --scopes "repo,workflow"`
- [ ] Create private GitHub repo, push code
- [ ] Connect Cloudflare Pages to repo (build cmd: `npm run build`, output: `app/`)
- [ ] Add `.github/workflows/build.yml` (validate + bundle + audit on push)
- [ ] Add `.github/workflows/ingest.yml` (9 cron slots per `IRM_Tech_Architecture.html` §03)
- [ ] Set repo secrets if any parser needs (none currently — all free public sources)
- [ ] Branch protection on `main` (require build pass)
- [ ] First production deploy + verify trust band shows "67/70 verified"
- [ ] Custom domain: `irm.kamayakya.com` (CF DNS proxy on)

---

## Standing audit gate (must always pass before merge)

```bash
npm run validate    # Gate 2: schema + data contract
npm run audit       # Gate 1: build · Gate 3: hierarchy
npm run audit:visual # Gate 4: visual at 5 viewports
```

Currently all green. Last run: 0 failures, 2 warnings (composite-metric history fetches return 404 — expected).

---

## Things future-me should NOT change without re-reading

- The 8-component cap (Build Spec §03)
- The data contract schema (Build Spec §04)
- The 9-slot ingest schedule (`scripts/ingest/schedule.mjs`)
- Cross-check threshold of 5% disagreement
- Free-sources-only rule
- Trend MoM + YoY + sparkline minimum on every metric
