# RESUME · for the next agent picking this up cold

You are continuing work on India Risk Monitor — a static-site market risk dashboard for India, built by Aniket Kulkarni for KamayaKya. **Read this file in 60 seconds, then read `PROGRESS.md`, then start.**

## Identity

- **Audience:** RA / RIA / MFD / PMS / AIF / HNI / pro & semi-pro investors
- **Promise:** show what matters first, what changed, what it means, how to verify it
- **Voice:** institutional, concise, investor-grade — never "startup cute"

## Hard rules (non-negotiable)

1. **No paid sources for displayed data.** Free sources only. Each metric needs primary + ≥1 cross-check.
2. **Every metric shows MoM + YoY + 12m sparkline.** Single values are forbidden.
3. **8 components max.** See `app/components/`. To add one, retire one.
4. **No `npm install` of new dependencies without asking.** Currently only `playwright` is installed.
5. **No deployment without `gh auth login` from Aniket first.** Don't accept credentials in chat.
6. **No commits unless Aniket asks.** Build/audit/test freely; commit only on instruction.

## Current state in 5 lines

- **LIVE** at https://india-risk-monitor.pages.dev/ (Cloudflare Pages, auto-deploys on push to main)
- Repo: `aniketkulkarni420/india-risk-monitor` (private) — `gh` CLI authed locally
- Phase 1–10 complete. Tabs working. 9 metrics live, 60+ on seed (Phase 9 selector tuning ongoing)
- GH Actions: build.yml + ingest.yml. Cron has 6 IST slots. Manual: `gh workflow run ingest.yml -f slot=all`
- Topbar shows honest `Live X/Y · others seed data` count — read `last_verified_at` per metric, don't trust "looks updated"

## What needs doing next (priority order)

1. **Selector tune the 12 failing parsers** — INR (RBI homepage regex), POSOCO power (PDF or alt endpoint), Hormuz (MarineTraffic), GST/IIP/WPI/CPI (PIB search), 5 FADA auto metrics. Pattern: open `scripts/ingest/parsers/{name}.mjs`, view-source the actual page, update regex, push, run `gh workflow run ingest.yml -f slot=all` to verify.
2. **Add real parsers for the 36 skipped** — every other metric_id in `data/manifest.json` not yet in `scripts/ingest/registry.mjs`. Each is ~50 lines following the pattern in `parsers/nse_fii_dii_v1.mjs` (real reference impl).
3. **Phase 11 monitoring** — UptimeRobot (free, sign up + add 2 monitors for `/` and `/sources/`), GitHub Actions failure email (already on if you have notifications enabled), optional Sentry.
4. **Custom domain** — `irm.kamayakya.com` via Cloudflare Pages → Custom domains → add CNAME record at kamayakya.com DNS provider.

## How to resume

```bash
cd C:\Users\anike\Downloads\IRM_Build

# Sanity check — should pass clean
npm run validate    # Gate 2 · 69/69 metrics
npm run audit       # Gates 1+3
npm run audit:visual # Gate 4 · 5 viewports

# Run the dev server
npm run serve       # http://localhost:8080/

# Re-bundle data (if you change any metric JSON)
npm run bundle

# Re-build standalone preview
npm run preview     # writes C:/Users/anike/Downloads/IRM_Preview.html

# Backfill history (mock by default — switch via --live when parsers registered)
npm run backfill
```

## File map

See `PROGRESS.md` for the complete file index. Critical:

- `app/main.mjs` — desktop assembly (~570 lines). All section composition.
- `app/m/main.mjs` — mobile assembly. Reuses charts.mjs.
- `app/components/charts.mjs` — 16 chart-builder helpers (locked viz vocabulary)
- `app/components/CmdKPalette.mjs` — ⌘K global search · uses unique-prefixed `_kBackdrop` etc. to avoid bundle collisions
- `data/manifest.json` — master list of all 70 metrics
- `scripts/ingest/parsers/nse_fii_dii_v1.mjs` — reference real parser pattern
- `scripts/ingest/registry.mjs` — register new real parsers here

## Decision docs (in `C:\Users\anike\Downloads`)

Read these only if making a structural decision:
- `IRM_Tech_Architecture.html` — hosting + CI/CD + cadence (locked)
- `IRM_Build_Spec.html` — engineering contract
- `IRM_Design_Audit.html` + `IRM_DataViz_Audit_v2.html` — redesign rationale
- `India_Risk_Monitor_Handoff_Summary.md` — original V40-V60 lessons

## What Aniket actually values

- Honest critique > sycophancy
- Visual mockups he can pick from > prose options
- Ruthless on bloat (the 8-component cap exists because V40-V60 grew 240% CSS)
- "Every section answers a fund manager's question" > generic dashboard
- Free sources, free hosting, audit-trail commits

## Open questions when you arrive

If Phase 9 in progress: which parser to prioritise next (see priority queue in `PROGRESS.md` §"Phase 9 — what to do").

If Phase 10 in progress: did Aniket run `gh auth login`? If yes, proceed with `gh repo create` etc. If no, wait.
