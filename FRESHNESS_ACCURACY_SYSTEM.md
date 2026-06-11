# IRM · Freshness + Accuracy Guarantee System

How the dashboard stays fresh and accurate **without daily babysitting** — so the showcase is safe to view any time in the next 5 days (or any day after).

The honest framing: **you cannot guarantee every parser always works** (upstream govt sites change, rate-limit, go down). What you CAN guarantee is that the system always *knows* its own state, *self-heals* what it can, *honestly degrades* what it can't, and *escalates to you only when human action is genuinely needed*. That's what's now built.

---

## The 4 guarantees (all now live)

### Guarantee 1 · Autonomous freshness
Scheduled ingest runs keep refreshing data on their own.
- **Cadence-aware staleness** — Monthly metrics aren't falsely flagged stale after 7 days; each metric judged against its real cadence (Daily 2d, Weekly 10d, Monthly 45d, Quarterly 120d).
- **No more run cancellation** — the concurrency block that cancelled 88% of runs is removed; the rebase-retry handles the push race so concurrent runs merge instead of cancelling.
- **fri_17 cron fixed** — was colliding with weekday_close and never firing; moved to its own slot.

### Guarantee 2 · Self-awareness (the system knows when it's stale)
The May-15 incident happened because the health tracker showed "green" while data silently rotted. Fixed:
- **`last_attempted_at` tracking** — a parser that stops being *attempted* (not just one that fails) now degrades to amber/red.
- **Freshness gate in `bundle.mjs`** — the build *refuses to ship* if >15% of metrics are stale-by-cadence. Fail-loud over ship-stale. (It fired correctly this week, blocking a 45%-stale build.)
- **Daily `freshness-audit.yml`** — reads the LIVE deployed data.json, independent of the ingest pipeline, and Telegram-alerts + opens a GitHub issue if anything is stale. (It fired correctly — auto-opened issue #13.)

### Guarantee 3 · Accuracy gates (catch wrong-but-fresh values)
Freshness ≠ accuracy. A value can be just-fetched but wrong (decimal slip, unit drift, parser grabbing the wrong number).
- **Plausibility bounds** — headline metrics checked against sane ranges. INR 95 passes [75,105] (it's real — cross-verified); a decimal error (9.5 or 950) fails.
- **Cross-source validation** — INR checked against an independent forex API every readiness check. This is how we *proved* INR 95.26 is correct (independent feed says 95.78).
- **Unit-consistency** — the GST lakh-crore/crore mix-up is fixed; the metric unit now matches what parsers emit.

### Guarantee 4 · On-demand readiness gate
**`npm run showcase:ready`** — one command, GO/NO-GO, before any demo. Runs all 6 checks (bundle recency, cadence freshness, IRS computed, plausibility bounds, cross-source sanity, null scan) and tells you exactly what's wrong if anything. This is the "is it safe to show right now?" button.

---

## What to actually do (operationally)

**Before any showcase:**
```
npm run showcase:ready
```
GREEN → show it. RED → it lists the exact blockers.

**Passive (no action needed):**
- `freshness-audit.yml` runs daily at 09:00 UTC and pings Telegram if anything goes stale.
- If you get a Telegram alert, that's the only time you need to look.

**That's it.** No daily checking. The system watches itself and pings you only on a real problem.

---

## Honest residual risks (and mitigations)

| Risk | Likelihood | Mitigation in place | Residual |
|---|---|---|---|
| GitHub free-tier cron drift/delay | Medium | Multiple redundant cron times per slot | Data could be a few hours late occasionally — within cadence tolerance |
| A parser breaks upstream | Medium-High | Tiered fallback + source cache + freshness alert | You get a Telegram ping; data shows last-good until fixed |
| Self-hosted India runner offline | Medium | Cloud runners cover most metrics via CF Worker proxy | India-IP-only metrics stall until runner back; alert fires |
| Chronically-broken parsers (fno_oi, rail_freight, GST source) | Active now | Tracked; being fixed in P1 | These specific metrics may lag until parser rebuilds land |
| Cloudflare deploy pipeline stuck | Low | freshness-audit checks bundle age, alerts >24h | Telegram ping |

---

## Productization roadmap (post-showcase)

The current architecture (GitHub Actions cron → git commit → Cloudflare Pages redeploy) works but has inherent fragility for a real-time data product. Recommended evolution:

### Tier 1 · Harden (1-2 weeks)
- Fix the 3 chronically-broken parsers properly (fno_oi_buildup via NSE option-chain through CF Worker; rail_freight + GST via verified PIB email pipeline).
- Move accuracy gates *upstream* — reject implausible values at ingest-write time, not just at read time. A bad value never enters the data at all.
- Ship UI staleness badges — every metric shows "as of <date>"; stale ones visually marked. Then even a bad day is showcase-safe because nothing looks confidently-current when it isn't.

### Tier 2 · Re-architect (the real productization, 2-4 weeks)
- Migrate ingestion from GitHub Actions to a **Cloudflare Worker on cron triggers, writing to KV or D1**. This eliminates: the git-as-database push races, the self-hosted-runner dependency, and the redeploy churn. Sub-minute freshness becomes possible. (The Hormuz V2 worker already proves this pattern works in your stack.)
- Static site reads from a Worker endpoint instead of a committed JSON blob.

### Tier 3 · Scale (when there are real users)
- Per-metric SLA dashboard (uptime, freshness %, accuracy vs revisions).
- Historical accuracy backtest (did our value match the final revised official number?).
- Budget paid feeds for the genuinely-hard metrics (corporate bond spreads, port dwell time).

---

## Bottom line for the showcase

After the P0 fixes + one fresh ingest, run `npm run showcase:ready`. When it's GREEN, the dashboard is fresh, accurate (cross-verified), and the system will keep it that way autonomously — pinging you on Telegram only if something genuinely breaks. You don't need to check daily.
