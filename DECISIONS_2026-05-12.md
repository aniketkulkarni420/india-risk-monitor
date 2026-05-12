# IRM · approved design decisions · 2026-05-12

Locked by Aniket after reviewing `IRM_Master_AllSections_Compare.html` v2 fully-integrated. These supersede any prior conflicting structure in `IRM_Synthesis_Canonical.html`.

## Section structure (final)

| # | Section | Decision | Replaces |
|---|---------|----------|----------|
| 1 | **Hero** | 1A+1B merge · score + 6 vital-sign tiles + Today bullets always-visible | V60 compact-with-toggle |
| 2 | **Flows** | V60 hybrid · 4-lens + cards-as-tabs + 3-cell + ★ bar trio + narrative | pre-V60 banner + 4 horizon cards |
| 3 | **Macro** | V60 compact-first + "Detailed view →" toggle + 4 nuance chips (WPI-CPI gap · INR 5Y range · FXR streak · liquidity regime) | always-detailed current |
| 4 | **Real Economy** | V60 + 2 quick chips (rural-led softness · tractor seasonal context) · sacred bar trio kept · 9D cluster expand | already mostly shipped |
| 5 | **Freight** | **DEFERRED · keep current table** · Stress Map v2 moves to P2 | n/a |
| 6 | **Market** | Big Nifty + 30-day path overlay on PE band + 4 chips (VIX zone · Bank Nifty +7.9pp · DXY trigger · IND-US band) · 9D Bank Nifty | current valuation band only |
| 7 | **Sectors** | 4D color grid (treemap-like) + "Show as table" toggle for V60 row view · 9D row drawer | 15-row ranked list |
| 8 | **Peer Compare** | NEW · 6 countries (India · USA · China · Indonesia · Vietnam · Brazil) · 7 metric rows · 2E heatmap on every cell · ★ peer-row follow · 9D row expand | n/a |
| 9 | **Supporting metrics** | Composite primitive across all sections · auto-promote (anomalies + ★ followed) + summary label + change-event hint | accordion at bottom |

## Cross-section primitives (apply everywhere)

| Pick | What | Where |
|------|------|-------|
| **2E** | Bloomberg heatmap cells | MoM/YoY only (shipped) |
| **3A** | Range tick · qualitative labels | Macro INR/DXY/FXR (shipped) · extend to Hero score · Market PE |
| **5A** | Inline event markers on sparklines | Vertical dashed lines on 12m sparks |
| **5C** | Timeline strip · 30-day events | Top of every section header |
| **6A** | ★ Star follow · localStorage | Every metric · topbar "N followed" pill |
| **6C** | Saved tab layouts | Topbar tabs: All · Pre-market · FX deep · Risk regime |
| **9D** | Inline expand (replaces drawer) | All metric rows · click to expand inline |
| **10B** | Status pill with direction (`HIGH ↑5d`) | Every pill (shipped) |
| **11A** | Mobile cards · responsive | All sections on phone |
| **12A** | Sparse color overall | Only trend cells get heatmap (shipped via 2E) |

## Sub-section forks (Aniket delegated)

| Item | Pick | Why |
|------|------|-----|
| Macro toggle default | compact-first | CLAUDE.md rule "Compact-first default · Aniket explicit" |
| Sectors default view | 4D color grid (with "Show as table" toggle) | Compact-first + power-user fallback |
| Peer Compare mobile pivot | per-country cards · country tabs at top | 6-col table doesn't fit phone |
| Flows sectoral diverging bars | **REMOVE** | Currently mock data · no NSDL parser yet |
| 24h Feed | **P1 build** | Primary anomaly surface · pairs with supporting composite |
| Stress Map v2 (Freight) | **P2 defer** | Aniket pick · 1-2d build deferred |

## Build phases

### Phase 1 · Primitives (cross-section)
1. 5C timeline strip component · ~3h
2. 9D inline expand · drawer refactor · ~3h
3. Supporting metrics composite · ~1h
4. 6A star (localStorage) + 6C saved tabs · ~4h

### Phase 2 · Core sections
5. V60 Flows + 3 nuance chips · ~6h
6. 1A+1B Hero merge · ~5h
7. Remove Flows sectoral diverging bars · ~10m

### Phase 3 · Remaining sections
8. Sectors 4D color grid + table toggle · ~5h
9. V60 Macro compact + toggle + 4 chips · ~7h
10. Market path overlay + 4 chips · ~3h
11. Real Economy 2 quick chips + 9D cluster · ~2h

### Phase 4 · Net-new + responsive
12. 11A mobile cards · all sections · ~6h
13. 24h Feed panel + bell · ~8h

### Phase 5 · Heaviest
14. Peer Compare (5-7 new parsers + UI) · ~12h
15. Stress Map v2 (Freight) · ~12h (deferred per Aniket)

## What's NOT changing

- 7A/7D current is fine · no work
- Auto bar trio in Real Economy · sacred · sorted-by-MoM · DO NOT TOUCH
- DoD always Tier 1 visible · cannot be hidden
- Single-sentence dynamic narrative max
- No SEBI RA registration line (per request)
- "Built by Aniket Kulkarni" footer

## Test requirements per commit

For every UI-touching commit:
1. `npm run validate` clean
2. `npm run bundle` clean
3. Playwright smoke test (script: `scripts/qa-smoke-*.mjs`) confirms zero console errors + key selectors render
4. Git commit + push (permission `Bash(git push:*)` active in `.claude/settings.local.json` from next session)
5. Live verify on https://india-risk-monitor.pages.dev/ (~90s after push)

## Open data dependencies (block Phase 3 chip work)

- Reservoir 10Y weekly norms · for Real Econ chip
- Tractor 5Y FADA monthly history · for Real Econ chip
- Power demand weather correlation API · for Real Econ chip
- NSDL sectoral FII flows · for Flows sectoral bars revival

## Files referenced

- `IRM_Master_AllSections_Compare.html` · single source of design truth
- `IRM_Flows_AllOptions_Compare.html` · Flows-specific drill-down
- `IRM_Synthesis_Canonical.html` · prior locked inventory (some entries superseded by this doc)
