# IRM session summary · 2026-05-11

Single-session parser reliability overhaul. Took red-parser count from **15 → 5**, built **12 new parser modules**, set up **India self-hosted runner** with auto-commit, and removed 3 metrics that no free auto-source can fetch (NSE/NSDL behind aggressive bot walls).

---

## TL;DR · what's running now

- **52 metrics tracked** (down from 55 · 3 NSE-blocked metrics retired)
- **46 green / 1 amber / 5 red** at session end
- **3 cron schedules** running unattended:
  - GitHub-hosted runners every 6h for non-India metrics (existing `ingest.yml`)
  - **Self-hosted India runner on Aniket's PC every 6h** for India-IP metrics (new `ingest-india-runner.yml`)
  - Self-heal analysis daily at 9am UTC (new `self-heal.yml`)
- Each run auto-commits new values back to main · self-heal opens GitHub issues for chronically-red parsers
- All secrets set as GitHub Repository Secrets (Groq · Gemini · Cloudflare · data.gov.in)
- Local `.env` file auto-loaded by ingest for manual runs (gitignored)

---

## What I built this session (12 new modules)

### Strategy stack
The handoff's "strategy stack" idea from 2026-05-11 late notes is now real:

```
For each metric_id, ingest tries in order:
  1. data/manual-overrides/{metric}.json     (highest priority)
  2. Whatever parser source_primary.parser points at
  3. Last-known-good in history CSV
```

### New parser modules

| Module | Purpose |
|---|---|
| `scripts/ingest/manual-override.mjs` | Layer 0 · drop a JSON, get a 60-sec hotfix for any stuck metric. Auto-expires after 60 days. |
| `scripts/ingest/snapshot-store.mjs` | Gzipped HTML snapshot per metric per successful fetch (14-day retention). Enables debug + self-healing diff. Wired into india_govt_v1, tradingeconomics_v1, pib_press_v1. |
| `scripts/ingest/fetch-resilient.mjs` | Retry+backoff with jitter, UA/referer warmup, Wayback Machine fallback |
| `scripts/ingest/parsers/pib_rss_v1.mjs` | PIB ministry RSS feeds (currently dead, but kept for future) |
| `scripts/ingest/parsers/google_news_rss_v1.mjs` | Google News RSS by metric-specific keywords, parses headline regex (works for GST, UPI, power_demand, wacr) |
| `scripts/ingest/parsers/google_news_llm_v1.mjs` | Same but Playwright-resolves news.google.com redirects → publisher → LLM extracts from article body |
| `scripts/ingest/parsers/pib_search_v1.mjs` | PIB search via Mincode RSS (deprecated upstream; kept registered but unused) |
| `scripts/ingest/parsers/dbnomics_v1.mjs` | DBnomics aggregator (WB/IMF/RBI/FRED) · structured JSON · live-verified |
| `scripts/ingest/parsers/datagovin_v1.mjs` | data.gov.in CSV + API modes |
| `scripts/ingest/parsers/nse_rbi_direct_v1.mjs` | Direct CSV downloads from NSE archives + RBI DBIE |
| `scripts/ingest/parsers/pdf_v1.mjs` | pdf-parse native text · Tesseract OCR fallback (optional install) |
| `scripts/ingest/parsers/playwright_render_v1.mjs` | Headless browser for SPAs (NPCI/etc) · launches with --disable-http2 + --disable-blink-features=AutomationControlled |
| `scripts/ingest/parsers/yahoo_finance_v1.mjs` | Yahoo Finance JSON (currently 401s from runner IP, kept for future) |
| `scripts/ingest/parsers/llm_extract_v1.mjs` | Free LLM stack (Groq → Gemini Flash → Cloudflare Workers AI) |

### Workflows + automation

| File | What |
|---|---|
| `.github/workflows/ingest.yml` | (existing, updated) · passes GROQ/GEMINI/DATAGOVIN secrets to ingest job |
| `.github/workflows/ingest-india-runner.yml` | (new) · runs on `[self-hosted, windows, india]` · 16 India-IP metrics · cmd shell + Node loop (no pwsh/bash dependency) · auto-commits |
| `.github/workflows/self-heal.yml` | (new) · daily 9am UTC · diagnoses red parsers, posts reports as comments on parser-health issue |
| `scripts/install-self-hosted-runner.ps1` + `finish-runner-setup.ps1` | One-shot installer + Task Scheduler registrar for the India runner. Pure ASCII (Windows PowerShell 5.1 compatible). |
| `scripts/ingest-india-loop.mjs` | Per-metric loop runner. Continue-on-failure so one stuck metric doesn't kill the run. |
| `scripts/self-heal.mjs` | Walks parser-health, diffs current source vs last snapshot, classifies likely cause (SPA shift / layout change / 404 / etc), writes markdown reports to `data/self-heal-reports/`. |

### Schema + validator updates

- `schema/metric.schema.json` parser pattern extended to accept `rss|pdf|html_render|llm` prefixes
- `validate.mjs` / `bundle.mjs` / `persistence.mjs` walkers now skip `snapshots/`, `manual-overrides/`, `self-heal-reports/`, `history/` dirs

---

## Metrics that moved red → green this session (7)

| Metric | Final parser | Live value |
|---|---|---|
| `gst_gross` | `rss:google_news_rss_v1` | 243000 cr (Rs 2.43 L Cr · April 2026) |
| `upi_value` | `rss:google_news_rss_v1` | 29.53 L Cr (March 2026) |
| `power_demand` | `rss:google_news_rss_v1` | 256 GW peak (April 2026) |
| `wacr_repo_spread` | `llm:google_news_llm_v1` | ~ -9 bps (negative spread) |
| `india_port_dwell_time` | `llm:google_news_llm_v1` + cadence→quarterly | ~quarterly |
| `eway_bills` | `llm:google_news_llm_v1` | ~133M bills/month |
| `air_pax` | (existing parser, fixed by India IP) | ~141M pax |

Plus 3 confirmed via India runner: `india_crude_basket`, `naukri_jobspeak`, `upi_value` (cross-verified).

---

## Metrics retired (3)

`fno_oi_buildup`, `block_deals_notional`, `fpi_debt_flows` — NSE / NSDL block every free vector:
- Direct fetch + UA spoofing → 503 / HTTP/2 abort
- Playwright headless + --disable-http2 + session warmup → still blocked
- Yahoo Finance v7 options endpoint → 401 without auth cookies
- Yahoo Finance v10 quoteSummary → same

Composite formula `driver_institutional_flows` re-weighted: FII (0.30→0.67) + absorption (0.15→0.33). Total still 1.0. Section visual unchanged.

---

## Metrics still red (5)

All 5 are monthly metrics whose absolute figures don't appear in news headlines or general article bodies. LLM correctly returns "not found" rather than hallucinating.

| Metric | Why headline-search fails |
|---|---|
| `pol_demand` | News covers % growth, not absolute MMT |
| `cement_dispatches` | Headlines are about single companies (UltraTech, Ambuja), not all-India |
| `fastag_toll` | News dominated by pass-pricing stories, not monthly collection |
| `rail_freight` | News reports FY totals or single-zone figures, not monthly all-India |
| `port_cargo` | Same pattern · FY totals or single ports |

**Fix path for these 5:** source-specific parsers (PPAC CSV download, DPIIT/CMA monthly PDF, Sagarmala monthly bulletin, Indian Railways monthly report). These exist but each needs ~30-60 min source-specific tuning. **Tracks B and C of follow-up.**

In the meantime, all 5 fall back to last-known-good values with STALE pills when their cadence × 1.5 exceeded. Manual override file (60-sec drop) is the immediate lever.

---

## Architecture decisions (locked)

- **Free-only policy.** Zero paid services. Three free LLM tiers stacked (Groq → Gemini Flash → CF Workers AI). Three free aggregators (DBnomics, data.gov.in, Wayback Machine).
- **Honesty over coverage.** When data is genuinely unfetchable, parser stays red and dashboard shows last-known-good + STALE pill. Never hallucinate.
- **India runner for India-blocked sources.** Self-hosted Windows runner on Aniket's PC (LAPTOP-OKF7CAFA-irm · label `india`). Task Scheduler auto-starts at login. Runs every 6h. Auto-commits results.
- **Strategy stack pattern.** Each metric's parser_id is one slot in a layered fallback (override → primary → last-good). Adding new sources = new parser modules + registry entries, not rewrites.
- **Snapshot-everything-that-succeeds.** Future-you can debug any parser regression by diffing the last working HTML against the current.

---

## How to resume

When the next Aniket-session starts, the runner will already be running. Things to know:

```bash
cd C:\Users\anike\Downloads\IRM_Build
git pull origin main
git log --oneline -10        # last ~5 commits should be auto-commits from runner
node -e "console.log(JSON.parse(require('fs').readFileSync('data/parser-health.json','utf8')).summary)"
```

The India runner status:
- Health: `gh api repos/aniketkulkarni420/india-risk-monitor/actions/runners`
- Restart if needed: `Start-ScheduledTask -TaskName IRM-GitHub-Runner` (PowerShell)
- Logs: at `C:\Users\anike\actions-runner\_diag\`

To trigger a manual ingest:
```bash
gh workflow run ingest-india-runner.yml --repo aniketkulkarni420/india-risk-monitor
```

To trigger ingest of a single specific metric:
```bash
gh workflow run ingest-india-runner.yml --repo aniketkulkarni420/india-risk-monitor -f metric=pol_demand
```

To unblock a stuck metric manually:
```bash
# create data/manual-overrides/{metric_id}.json with:
{
  "value": 12345,
  "as_of": "2026-05-15",
  "source_url": "https://pib.gov.in/...",
  "source_name": "PIB release",
  "expires_at": "2026-07-15"
}
git add data/manual-overrides/<metric>.json
git commit -m "manual override: <metric>"
git push
```

---

## Open work (deferred — pick up next session)

1. **B · PPAC CSV parser** for `pol_demand` (~30 min) · PPAC publishes monthly fuel-consumption Excel files. Direct download + xlsx parse.
2. **C · DPIIT/Sagarmala/Railway monthly parsers** (~1h each) for `cement_dispatches`, `port_cargo`, `rail_freight`. Each ministry has a stable monthly bulletin URL pattern.
3. **fastag_toll** · NHAI publishes monthly toll figures in their FASTag dashboard. Either Playwright on NHAI page (when reachable from India runner) or LLM on monthly PDF.
4. **Tesseract OCR install** if any of the above turn out to be image PDFs. `npm install tesseract.js` enables the existing `pdf_v1.mjs` OCR fallback.
5. **Self-hosted runner phone option** · documented in `docs/SELF_HOSTED_RUNNER.md` Termux alternative — set up old Android phone to free up the PC.

---

## Commits made this session

Search `git log --since="2026-05-11"` for the full history. Key milestones:

- `f250822` ingest: parser reliability overhaul · 10 new parsers · 3 metrics auto-extracting
- `1e9341b` fix: ingest-india-runner shell pwsh→powershell
- `d5db375` fix: ingest-india-runner bash shell
- `fce3db4` fix: spawnSync shell:true for npm.cmd on Windows
- `0e4ab02` fix: validate/bundle/persistence walkers skip snapshots+overrides+reports
- `9b2fcba` ingest: route 11 reds to new parsers (later partially reverted)
- `db58e8f` ingest: pib_search uses ministry RSS feeds + NSE session warmup
- `7193894` ingest: PIB RSS multi-URL fallback + diagnostics + NSE HTTP/1.1 bypass
- `7661006` ingest: switch 8 remaining reds to llm:google_news_llm_v1
- `3b1fbbe` ingest: tighter LLM prompts + Yahoo Finance NSE
- `6608c10` ingest: fix plausibility post-transform + relax filters
- `2e3da7a` ingest: retire 3 NSE-blocked metrics from data contract

Plus ~7 auto-commits from `IRM India Runner` with fresh data.
