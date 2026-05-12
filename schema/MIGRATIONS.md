# Schema migrations

Versioned migrations for `metric.schema.json`. Each version bump should land
with a migration script if existing metric files need transformation.

## v1.0.0 → v1.1.0 (2026-05-11)

**Change:** added `rss|pdf|html_render|llm|tiered` parser prefixes + `tier_chain` field on `source_primary`.

**Migration needed:** none. Existing metric JSONs still pass new schema (additive).

## v1.1.0 → v1.2.0 (2026-05-12)

**Change:** added `email:` parser prefix. Cadence-mismatch fixes (CONCOR/IRB dropped from monthly tier chains).

**Migration needed:** none. Existing metric JSONs still pass.

## Pattern for future migrations

When a future schema change is NOT backward-compatible:

1. Bump `x-schema-version`
2. Add to `x-schema-changelog`
3. Add `schema/migrations/v{old}-to-v{new}.mjs` with `migrate(metric)` function
4. Update `validate.mjs` to call migration before validating if `metric.schema_version` is older
5. Run one-shot: `node scripts/migrate-schema.mjs` to rewrite all metric JSONs

## Example migration script template

```js
// schema/migrations/v1.2.0-to-v2.0.0.mjs
export function migrate(m) {
  // Example: rename source_primary.parser to source_primary.parser_id
  if (m.source_primary?.parser && !m.source_primary.parser_id) {
    m.source_primary.parser_id = m.source_primary.parser;
    delete m.source_primary.parser;
  }
  m.schema_version = '2.0.0';
  return m;
}
```
