# Phase 3 status audit · 2026-05-12

Audit performed against actual code (`app/main.mjs`, `app/components/styles.css`, parser registry). Supersedes earlier optimistic claims in `HANDOFF_2026-05-12_v2.md` Phase 3 queue.

## Result · 0 of 9 buildable items shipped · 4 deferred

| # | Item | Code evidence | Status |
|---|---|---|---|
| 3.1.1 | Sectors 4D color grid + "Show as table" toggle | `main.mjs:1577` `SECTORS — RANKED LIST` | ❌ not started |
| 3.1.2 | V60 Macro compact + Detailed toggle + 4 chips | `main.mjs:929` `MACRO — 5 PANELS` | ❌ not started |
| 3.1.3 | Market path overlay + 4 chips + 9D Bank Nifty | `main.mjs:1436` `MARKET CONTEXT — 4 PANELS` | ❌ not started |
| 3.1.4 | Real Econ 2 quick chips + 9D cluster expand | Cluster cards present, no rural-led / tractor-seasonal chips | ❌ not started |
| 3.2.1 | 11A mobile cards · responsive pass | 48 legacy `@media` rules exist, no per-section pass | ⚠️ legacy only |
| 3.2.2 | 6C saved tab layouts in topbar | No `savedTab` markers | ❌ not started |
| 3.2.3 | 5A inline event markers on sparklines | No `eventMarker` markers | ❌ not started |
| 3.3.1 | 24h Feed panel + bell | No `feedPanel` markers | ❌ not started |
| 3.3.2 | Peer Compare (5-7 parsers + UI) | No `peerCompare` markers, no peer parsers | ❌ not started |
| 3.4.1 | Stress Map v2 (Freight) | Decision · P2 | ⏸️ deferred |
| 3.4.2 | Reservoir 10Y norm chip | Blocker · 10Y CWC weekly norm data | ⏸️ data-blocked |
| 3.4.3 | Tractor 5Y FADA seasonal context | Blocker · 5Y FADA monthly history | ⏸️ data-blocked |
| 3.4.4 | Power demand weather flag | Blocker · weather correlation API | ⏸️ data-blocked |

## What HAS shipped since Phase 2 closed (post-`9a2f0fb`)
Adjacent work that isn't Phase 3 but improved the system:
- Hormuz V2 cutover · ingest reads `hormuz-watch-2.pages.dev` V2 schema
- Hormuz PROVISIONAL marker propagates to Hero narrative + bullets
- Hormuz source-quality audit γ (Tier 1+2+5)
- RULES_LEDGER + 5 bug fixes + Flows visual gaps + sparkline rule
- Email pipeline · Gmail OAuth → IMAP app-password refactor (committed `e2785a7`)
- 4 ingest workflows wired with `CF_WORKER_URL`/`CF_WORKER_TOKEN`/`GMAIL_*`/`TELEGRAM_*` env vars (PR #3)

## Manual-task infrastructure completed 2026-05-12
- ✅ Cloudflare Worker `irm-india-proxy.aniket-kulkarni.workers.dev` deployed
- ✅ Telegram bot `@irm_alerts_ak420_bot` wired, test ping delivered
- ✅ Gmail IMAP (aniketshevchenko@gmail.com) verified, parser refactored, PIB subscription submitted
- ⏸️ R2 backup · deferred by Aniket
- ⏸️ Termux runner · optional, deferred

## Next-session pickup order (when Aniket says "build Phase 3")
Recommend tackling in this order (highest user-visible lift first):
1. **Sectors 4D color grid + table toggle** · ~5h · replaces 15-row list with treemap-style
2. **Real Econ 2 quick chips + 9D cluster expand** · ~2h · smallest lift, ships fastest
3. **Market path overlay + 4 chips + 9D Bank Nifty** · ~3h
4. **V60 Macro compact + Detailed toggle + 4 chips** · ~7h · biggest scaffold lift
5. **11A mobile responsive pass · all sections** · ~6h
6. **5A inline event markers on sparklines** · ~1h · cheap polish
7. **6C saved tab layouts** · ~3h
8. **24h Feed panel + bell** · ~8h · needs event detection rules first
9. **Peer Compare** · ~12h · needs 5-7 new parsers, biggest single build

## Open decisions parked for next session
1. Macro compact/detailed toggle · global (one button affects all) vs per-section
2. Peer Compare parser priorities · start with FRED + OECD?
3. 24h Feed event detection · rule engine vs LLM summarization
4. V60 Flows mobile · test cards-as-tabs strip on real phone
5. Stress Map v2 timing · slot after 3.1 if it runs short
