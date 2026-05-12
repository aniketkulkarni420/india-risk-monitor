# IRM · Rules ledger

The durable per-component rule index. Every approved rule (from any chat, in any session) gets one line here, dated, with source. **READ THIS FIRST** at the start of every new session — it overrides anything in handoffs that conflicts.

Rules are append-only. When a rule is replaced or retired, mark it `[SUPERSEDED 2026-XX-XX]` rather than deleting.

---

## Active rules

### Voice & copy
- 2026-05-12 · No em dashes · no AI openers · no hedging · punchy data-first copy · source: CLAUDE.md
- 2026-05-12 · Footer is "Built by Aniket Kulkarni" only · SEBI RA registration line REMOVED per Aniket request · source: prior handoff
- 2026-05-12 · Single-sentence dynamic narrative max · source: HANDOFF_2026-05-12

### Display hierarchy
- 2026-05-12 · Compact-first default · Aniket explicit · source: CLAUDE.md
- 2026-05-12 · DoD always Tier 1 visible · cannot be hidden · source: HANDOFF_2026-05-12
- 2026-05-12 · Show before building · visual mockups before code · source: HANDOFF_2026-05-12
- 2026-05-12 · Multiple options preferred over single recs · source: HANDOFF_2026-05-12
- 2026-05-12 · Honest critique > sycophancy · source: HANDOFF_2026-05-12

### Sections (immutable)
- 2026-05-07 · Auto bar trio in Real Economy · sacred · sorted-by-MoM · DO NOT TOUCH · source: HANDOFF_2026-05-07 + V60 Synthesis
- 2026-05-12 · Sectoral diverging bars in Flows · REMOVE · was mock data, no NSDL parser · source: this chat

### Cross-section primitives
- 2026-05-12 · 2E Bloomberg heatmap on MoM/YoY ONLY · never DoD (intra-day flap = noise) · source: HANDOFF_2026-05-12
- 2026-05-12 · 10B status pill direction derived from sparkline_12m last 3-8 points · NOT user-configurable · source: HANDOFF_2026-05-12
- 2026-05-12 · 3A range tick uses qualitative labels ("Near 12m high") · NOT p82-percentile jargon · source: HANDOFF_2026-05-12
- 2026-05-12 · 12A sparse color overall · only trend cells get heatmap · source: HANDOFF_2026-05-12
- 2026-05-12 · Supporting metrics tier · NO SPARKLINE COLUMN · click row → 9D inline expand reveals chart · source: this chat (was given in prior chat, not captured · now durabilized)

### Data quality
- 2026-05-12 · Plausibility caps on volatile metrics · fastag_toll has 25%, Hormuz +VLCC need 200% with sparkline-unique-count gate · source: this chat
- 2026-05-12 · Sparkline < 4 unique values → suppress MoM/YoY display · show "history accruing" · source: this chat
- 2026-05-12 · Value-stuck detector · if last 7 readings all equal current value AND metric is not slow-moving (repo_rate / cpi etc), flag with STUCK pill · source: this chat
- 2026-05-07 · Plausibility guard on DoD · sparkline tail trim · unit-shift detection · source: HANDOFF_2026-05-07
- 2026-05-12 · verification_state is DERIVED at bundle time · stamped value in metric JSON is informational only · forced to source_pending when `_source_static: true` OR `_source_count_actual < 2` (unless whitelisted single-source authoritative) · source: this chat
- 2026-05-12 · Static-snapshot data sources MUST surface a "PROVISIONAL · static snapshot" pill on the rendered card · MoM/YoY suppressed · expose richer snapshot fields (inbound/outbound/dark_vessels/pct_of_normal) instead · source: this chat
- 2026-05-12 · PROVISIONAL marker propagates everywhere a static-source value appears in user-facing copy · narrative, condensed lead, today bullets, driver expansion · ensures user never sees a static value rendered as if live · source: this chat
- 2026-05-12 · Cross-check parsers must hit a DIFFERENT source than primary · re-fetching the same endpoint = fake crosscheck · source: this chat (Hormuz audit revealed this)
- 2026-05-12 · Schema underscore-prefix metadata fields (`_history_accruing`, `_source_static`, `_snapshot_payload`, `_source_count_actual`, `_verification_state_original`, `_verification_demoted_reason`, `_value_stuck_count`) are bundle/parser-generated · honored by patternProperties in schema · source: this chat

### Operational
- 2026-05-12 · Do NOT push to main without explicit "approve push" · permission rule active in .claude/settings.local.json for this session forward · source: HANDOFF_2026-05-12
- 2026-05-12 · India self-hosted runner = single point of failure until Termux backup · monitor `gh api repos/.../actions/runners` · source: HANDOFF_2026-05-12
- 2026-05-12 · GitHub free-tier cron is best-effort · always add retry triggers for critical schedules · source: HANDOFF_2026-05-12
- 2026-05-12 · Manual override layer is the human-in-the-loop guarantee · always available · 60-second hotfix · source: HANDOFF_2026-05-12

---

## How to use this ledger

**At session start:** read top-to-bottom before touching any code or proposing any design change.

**When Aniket says "remove X" or "do X" or "stop doing Y":** add the rule here in the same commit as the code change. Do NOT defer to next session.

**When in doubt:** ask "this would change rule X, OK?" before changing.

**Format for new entries:**
```
- YYYY-MM-DD · [rule statement] · source: [chat / handoff name / file]
```

Group by category. Append to the relevant section. Never delete — supersede.
