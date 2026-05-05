# India Risk Monitor — Phase 1 Scaffold

Data contract scaffold. **No product HTML yet** — that begins at Phase 6 of the build sequence.

This repo implements the contract defined in `IRM_Build_Spec.html` §04 (data contract) and §06 (audit gates).

## Layout

```
IRM_Build/
├── data/
│   ├── metrics/
│   │   ├── flows/        ← 10 flow metrics
│   │   ├── macro/        ← 16 macro metrics
│   │   ├── economy/      ← 18 real economy metrics
│   │   ├── freight/      ← 7 freight + oil metrics
│   │   └── market/       ← 8 market context metrics
│   ├── composites/       ← 4 hero composites + 6 driver scores
│   ├── sectors/          ← sectors.json (15 sectors × matrix)
│   ├── history/          ← {metric_id}.csv (12m raw, populated by ingest)
│   └── manifest.json     ← master list of all 70 metrics
├── schema/
│   └── metric.schema.json   ← the locked contract (Draft-07)
├── scripts/
│   └── validate.mjs         ← schema + custom-rule validator
├── package.json
└── README.md
```

## Run the validator

```bash
cd IRM_Build
npm run validate
```

Or strict mode (treats warnings as errors):

```bash
npm run validate:strict
```

No dependencies — pure Node 18+ built-ins.

The validator runs:
- **Schema check** — every required field, every enum, every type
- **Gate 2 (data contract)** — required fields + `source_crosscheck` ≥ 1 entry + non-null trends on verified metrics
- **Gate 5 (trust)** — `shock_eligible` requires `trigger_thresholds`; derived metrics require `formula`
- **Stale-metric warning** — `last_verified_at` older than 30d on a `live` metric

Output is one line per file (✓ green or ✗ red), then a list of errors and warnings, then a summary count.

## Phase status

**Phase 1 — Data contract scaffold** ✅ Complete
- 69 metric JSON files + 1 sectors.json — every required field populated
- Schema (`schema/metric.schema.json`) · Validator (`scripts/validate.mjs`)
- Manifest (`data/manifest.json`) of all 70 metrics

**Phase 2 — Ingest pipeline (daily metrics)** ✅ Complete
- Orchestrator at `scripts/ingest.mjs`
- 5 fetcher patterns (csv_download, html_scrape, json_api, press_release, manual) via `scripts/ingest/`
- Cross-check verification engine (5% divergence threshold; renders lower value on dispute)
- Atomic JSON writes + history CSV accumulator (`data/history/{metric_id}.csv`)
- Schedule definitions for 7 cron slots (IST) — daily_06, weekday_close, weekday_evening, fri_17, monthly_1, monthly_5, policy_event
- JSONL audit log at `logs/ingest-YYYY-MM-DD.jsonl`
- 1 real reference parser (NSE FII/DII csv_download) · all others run in mock mode
- 26 daily-cadence metrics covered. Run `npm run ingest` (mock) or `npm run ingest:live` (after registering more real parsers).

**Phase 3 — Atomic components** ✅ Complete
- 4 atomic components: DisplayTile · TableRow · Sparkline · Band
- All states: default · loading · error · history-pending · shock
- Locked design tokens (Manrope + JetBrains Mono · warm institutional palette)
- Storybook at `app/storybook.html` showing every state with real metric data

**Phase 4 — Composite components** ✅ Complete
- 4 composites: SectionFrame · MetricDrawer · HeatmapCell · StickyTOC
- MetricDrawer: singleton, URL deep-link via `#metric=<id>`, full schema rendering, Esc/click-outside close
- StickyTOC: IntersectionObserver-driven highlighting, engages at scrollY > 720
- HeatmapCell: 15 sectors × 7 driver cols + 4 quant cols, click → drawer

**Phase 5 — Desktop page assembly** ✅ Complete
- `app/index.html` (7.9 KB) — page shell, single nav band, hero auto-promotion rule wired
- `app/main.mjs` — composes hero → flows → macro → economy → freight → market → sectors → footer
- `app/dist/data.json` — bundled metric + sector data, fetched once
- Hormuz primary renders inline as Pattern 4 (full chart) when in shock state
- Real Economy split into 5 sub-clusters (Tax/demand · Movement · Production · Auto · Discretionary)
- All audit gates pass: Gate 1 (build), Gate 3 (information hierarchy)
- Run: `npm run build && npm run serve` then open http://localhost:8080/

**Audit gate results (`npm run audit`):**
- ✅ JS syntax · 22 files clean
- ✅ Component count: 8 / 8 cap
- ✅ No legacy component names
- ✅ No quick-find / command-strip / tabs-row
- ✅ Exactly 1 topbar before hero
- ✅ Sources entry surfaces: 3 / 3 (topbar, section_footers, page_footer)
- ✅ "Stress" appears 1× above the fold (≤ 2)
- ✅ H1 close to body start (408 chars before)
- ⚠ Gate 4 (visual / Chromium screenshots) deferred to Phase 8

**Phase 6 — Single-HTML preview gate** ✅ Complete
- Playwright-based visual audit at 5 viewports (360 / 390 / 430 / 1366 / 1440)
- Caught 3 real bugs: `el()` not coercing numbers, Hormuz SVG not responsive, drawer transform causing horizontal scroll
- All fixed; final result: **5/5 viewports clean, 0 failures, 0 warnings**
- Run: `npm run audit:visual` → screenshots + JSON + Markdown report in `audit-output/`

**Phase 7 — Mobile tree at /m/** ✅ Complete
- `app/m/index.html` — minimal mobile shell (sticky topbar + hero + collapsible section pills)
- `app/m/main.mjs` — composes mobile hero (1 primary tile + Stress pill + Today line) + 6 SectionPills (collapsible `<details>`) + 5 sub-cluster split inside Real Economy
- Reuses existing atomics — no new components added (component cap stays at 8)
- Drawer goes full-screen on mobile via existing CSS media query
- Verified clean at 360 / 390 / 430

**Standalone preview** (NEW)
- `npm run preview` → writes `C:\Users\anike\Downloads\IRM_Preview.html`
- Self-contained HTML (no server, no internet for data) — 183 KB
- Toggle bar at top: **Desktop / Mobile · 390** (mobile shown in a phone frame)
- Bundles all components, all data, all CSS into one file
- Smoke-tested: 4 hero decks render, 6 section frames, mobile toggle works, 6 section pills, 0 errors

**Phase 5.5 — Redesign rebuild** ✅ Complete
- Hero: vital signs panel (score band + 6 sorted driver bars + w/w delta)
- Today: bullet rows replace lead paragraph + thin amber strip
- Flows: 5 lenses (regime banner + 4 horizon cards + persistence chips + cumulative chart + sectoral diverging bars)
- Macro: 5 panels (yield curve · inflation 4-bar · currency strip · fiscal progress · leading gauges) — all overlap/scale bugs from v1 audit fixed
- Real Economy: 5 cluster cards click-to-expand (Auto opens default → small multiples sorted by YoY %; Movement → indexed overlay)
- Freight: Hormuz cliff + Brent/India paired line + 3-up freight indices small multiples
- Market context: indexed equity overlay + valuation band + sentiment pair + IND-US 10Y spread
- Sectors: ranked list sorted by overall pressure, click row to expand 6-driver pressure bars
- Trust band above footer (4 cards: Verified / Crosscheck pending / History pending / Free sources %)
- Per-row source pill (small "RBI" / "NSE" tag on every TableRow)
- Sticky TOC upgraded with metric counts + shock badges per section
- Cmd-K palette (⌘K / Ctrl+K from anywhere) — searches metrics + sections + filters; replaces V55 search input
- HeatmapCell retired; CmdKPalette added — component cap stays 8/8
- Mobile rebuild applied (vital signs condensed + Today bullets + cluster summary cards + auto small multiples in flows section)
- Standalone preview (`IRM_Preview.html`) rebuilt with all collisions resolved

**Phase 8 — /sources/ route + 5Y backfill + drawer period selector** ✅ Complete
- `app/sources/index.html` + `main.mjs` — every metric × source × cross-check × verification × last-verified, with filter pills (all / verified / crosscheck_pending / history_pending) and search, plus trust band (4 cards) and source directory (110 unique sources sorted by usage)
- `scripts/backfill.mjs` — pluggable orchestrator: mock by default, real-fetcher registry via `--live`; bounded multiplicative random walk for plausible series; writes `data/history/{metric_id}.csv` (~1826 daily points per metric for 5 years)
- `MetricDrawer.mjs` period selector wired — lazy-loads CSV on drawer open, filters to selected period (1M/3M/6M/1Y/5Y), renders chart with min/pts/max range strip
- 59 metric history files written (composites/drivers correctly skipped as derived)
- All `/sources/` links converted to relative paths (work on file:// + any host)
- Run: `npm run backfill && npm run build && npm run serve` → http://localhost:8080/app/sources/

**Phase 9 (next) — real ingest implementations**
- Replace mock parsers with real ones, one source at a time
- Reference impl already in `scripts/ingest/parsers/nse_fii_dii_v1.mjs`
- Each new parser registers in `registry.mjs`; falls back to mock if not registered
- Per-metric backfillers in `REAL_BACKFILLERS` map at top of `scripts/backfill.mjs`

**Phase 10 — production hosting**
- Cloudflare Pages + GitHub Actions cron (per `IRM_Tech_Architecture.html` D1)
- 9-slot ingest schedule, every commit signed by github-actions[bot]
- Free tier indefinitely

## The 8 exemplars

Each exemplar demonstrates one shape; the rest of the metrics in their section follow the same pattern:

| File | Shape demonstrated |
| --- | --- |
| `composites/india_risk_score.json` | Hero composite · derived · formula · 4-tier triggers |
| `composites/driver_oil_physical.json` | Driver score · derived · auto-shock from input |
| `flows/fii_equity_daily.json` | Daily csv_download · NSE bhavcopy · no shock |
| `macro/inr_usd.json` | Live json_api · RBI · shock_eligible with trigger |
| `macro/pmi_combined.json` | Monthly press_release · S&P Global headline + 3 cross-checks |
| `economy/auto_2w.json` | Monthly press_release · sub_cluster=auto · FADA + Vahan crosscheck |
| `economy/gst_gross.json` | Monthly press_release · 5Y vs avg populated · drawer split inside notes |
| `freight/hormuz_throughput.json` | Shock state · html_scrape · linked_metrics + watch_next + trigger_thresholds |
| `market/nifty_50.json` | Daily csv_download · live indices · drawdown-based shock rule |

## Audit-addendum from Phase 1

Two metrics added that were missing from `IRM_Design_Options.html` §12:
- `brent_crude` — referenced everywhere (Hormuz linked moves, oil & physical driver) but not in §12 inventory
- `india_crude_basket` — daily PPAC release, the actual price India pays

Both placed in `freight` section; section grew from 5 → 7 metrics. Total stays ~70.

## Free-source verification rule

Every metric must have **≥ 2 free sources** — one primary, one cross-check. The validator fails the build if `source_crosscheck` is empty.

When primary and cross-check disagree by >5%, the metric publishes with `verification_state: crosscheck_pending` and renders the lower-of-two value. The renderer must respect this — Phase 5 work.

## Next steps

1. You review the 8 exemplars + schema + manifest.
2. Confirm shape with **"shape good"** or flag any field you want renamed/added/removed.
3. I generate the remaining 61 files from the manifest in Phase 1b.
4. We move to Phase 2 (ingest jobs for daily metrics).

No product HTML until Phase 6.
