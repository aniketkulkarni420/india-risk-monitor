# Resilience patterns · cross-section applicability

The reliability primitives built for parser ingestion apply to every other moving part of the IRM stack. This doc lists the patterns and how to extend them.

---

## Core resilience primitives (now in scripts/ingest/)

| Primitive | Module | What it does |
|---|---|---|
| **Tiered fallback chain** | `parsers/tiered_v1.mjs` | Try multiple sources in priority order; first plausible wins |
| **Source cooldown** | `observability.mjs` | After N failures, skip a source for K hours |
| **Anomaly detection** | `observability.mjs` | Z-score vs sparkline → flag suspicious values |
| **Shadow verification** | `tiered_v1.mjs` | Suspicious value? Cross-check next tier |
| **Source independence** | `source-origin.mjs` | Classify parsers, flag same-class chains |
| **Two-stage fetch** | `fetch-resilient.mjs:fetchSmart()` | Cheap fetch first, escalate to Playwright |
| **Retry with backoff** | `fetch-resilient.mjs:fetchResilient()` | Exponential + jitter |
| **Wayback fallback** | `fetch-resilient.mjs` | Falls back to archive.org snapshot |
| **CF Worker proxy** | `cf-proxy.mjs` | Routes through India edge when needed |
| **Local content cache** | `source-cache.mjs` | 14-day gzipped HTML cache; falls back on live failure |
| **LLM telemetry** | `observability.mjs` | Tracks per-provider call count + headroom |
| **Manual override** | `manual-override.mjs` | Layer 0 emergency lever |
| **Shared browser pool** | `browser-pool.mjs` | Single chromium instance · ~3s per-parser saving |
| **Multi-runner** | runner labels + workflows | India primary + Linux backup auto-distribution |
| **Email pipeline** | `parsers/email_pipeline_v1.mjs` | Govt email subscriptions as parser tier |
| **Daily content mirror** | `scripts/mirror-sources.mjs` | Backs up every critical URL nightly |

---

## How these apply to OTHER segments

### 1. Dashboard rendering (frontend)
Currently relies on a single bundle `app/dist/data.json` served by Cloudflare Pages. CF Pages already has CDN + edge caching globally.

**Apply tier_chain pattern:**
- **Tier A:** CF Pages serving from edge (current)
- **Tier B:** GitHub raw content URL as fallback (free, CORS-allowed)
  - `https://raw.githubusercontent.com/aniketkulkarni420/india-risk-monitor/main/app/dist/data.json`
- **Tier C:** Service worker cache (offline-capable)
- **Tier D:** localStorage of last good bundle

**Build effort:** ~2h to wire SW + multi-source fetch in `app/index.html`.

### 2. Composite score computation
Currently computed at bundle time from latest metric statuses. No fallback if a feeder is stale.

**Already applied:** `composite-recompute.mjs` now propagates `feeder_freshness` and `freshness_state: fresh|partial` (2026-05-12 Tier B).

**Could extend:**
- Composite anomaly detection (z-score vs `india_risk_score` history)
- Multi-formula composite (try formula A, if missing inputs try formula B)

### 3. Self-heal bot
Currently runs daily, generates one report per stuck parser.

**Apply tier_chain pattern:**
- **Tier A:** Compare last good snapshot vs current HTML (current)
- **Tier B:** Compare against last good of OTHER tier sources
- **Tier C:** Ask LLM "what likely changed" via prompt with current HTML

### 4. Validation pipeline
Currently `validate.mjs` only checks JSON schema. No semantic checks.

**Apply anomaly detection:**
- For each metric, also check `value` is within 3σ of `sparkline_12m`
- For each composite, check `value` is within 5σ of history
- Block bundle if any metric fails anomaly check

**Build effort:** ~30 min.

### 5. CI deployment pipeline
Currently single workflow (`build.yml` runs validate + bundle on push). No redundancy.

**Apply multi-runner:**
- Build on ubuntu-latest (current)
- Backup: build on macos-latest (free for public repos) — different OS, different network egress
- If both build successfully, deploy. If divergent, alert.

**Build effort:** ~30 min.

### 6. Secret management
Currently single set of API keys in GitHub Secrets. If revoked/leaked, ALL parsers fail.

**Apply tiered fallback for LLM:**
- Already done · `llm_extract_v1.mjs` tries Groq → Gemini → CF Workers in order
- Could extend: monitor `llm-telemetry.json`, auto-disable provider when headroom < 5%

**Apply rotation:**
- Quarterly auto-reminder via GitHub Action (`secret-rotation-reminder.yml`)

**Build effort:** ~30 min for reminder workflow.

### 7. Disaster recovery
Currently relies on GitHub repo. If GitHub deletes/corrupts the repo, history is gone.

**Apply external mirror:**
- Daily push to Cloudflare R2 bucket (free 10GB tier)
- Or daily push to a second git remote (e.g. GitLab as mirror)
- Recovery: clone from mirror, restore

**Build effort:** ~1h. Needs user to set up R2 or second remote.

### 8. Monitoring + alerting
Currently `parser-health-alert.yml` opens a GitHub issue when red parsers persist.

**Apply tiered notification:**
- Tier A: GitHub issue (current)
- Tier B: Telegram bot (if user adds bot token)
- Tier C: Email via SendGrid free tier (100/day)

**Build effort:** ~1h. Needs Telegram bot token from user.

### 9. Cost monitoring
Currently no telemetry on LLM token usage. Could quietly blow past free tier.

**Already applied:** `llm-telemetry.json` per-provider counts + `headroom_pct`.

**Could extend:** workflow that fails build if telemetry shows red headroom.

### 10. Schema evolution
Currently changing metric schema requires editing `schema/metric.schema.json` + all metric JSONs.

**Apply versioning:**
- Schema has `version` field
- Migration scripts in `schema/migrations/v1-to-v2.mjs` etc
- Bundle reads version, applies migrations on the fly

**Build effort:** ~2h.

---

## The unifying principle

**Every external dependency should have ≥2 independent paths, ≥1 cache fallback, and ≥1 manual override.**

| Component | Path 1 | Path 2 | Cache | Manual |
|---|---|---|---|---|
| Metric ingestion | Primary parser | Tier B/C/D | source-cache (14d) | manual-overrides JSON |
| Dashboard rendering | CF Pages | raw.githubusercontent | SW + localStorage | Static fallback `index.html` |
| Composite scoring | derived_v1 | composite-recompute | bundled in `data.json` | Manual JSON edit |
| Self-heal | snapshot diff | LLM analysis | parser-health.json | GitHub issue + human |
| Validation | schema check | anomaly check | last-good `data.json` | Force-deploy via gh CLI |
| Deployment | GitHub Actions | self-hosted runner | CF Pages cached previous | `gh workflow run` |
| Secrets | active key | rotated backup key | (none) | `gh secret set` |
| Storage | GitHub repo | Cloudflare R2 mirror | (none) | Local working tree |
| Alerting | GitHub issues | Telegram bot | email digest | Manual GitHub watch |

---

## Priority for next session

If applying these cross-section, the highest-value additions are:

1. **Validation anomaly checks** · 30 min · catches data corruption before deploy
2. **Composite anomaly check** · 30 min · same for scoring
3. **R2 disaster-recovery mirror** · 1h · history insurance
4. **Telegram bot notifier** · 1h · faster alerts than GitHub issues
5. **Secret rotation reminder** · 30 min · prevents silent expiry

Total: ~3.5h for full cross-section resilience.
