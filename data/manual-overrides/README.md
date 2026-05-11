# Manual Overrides — Emergency Lever

When a parser is stuck (red for days, upstream lag, format changed and not yet fixed), drop a JSON file here and the next ingest run will use your value INSTEAD of running the parser.

## How to use

1. Find the value from any trusted source (PIB release, RBI bulletin, news article, Trading Economics, etc.)
2. Create `data/manual-overrides/{metric_id}.json` with this shape:

```json
{
  "value": 1234.56,
  "as_of": "2026-05-08",
  "source_url": "https://pib.gov.in/PressReleasePage.aspx?PRID=XXXXXXX",
  "source_name": "PIB India press release",
  "note": "Optional · why this override exists",
  "expires_at": "2026-06-01"
}
```

3. Commit + push. Next CI ingest run picks it up automatically.

## Fields

| Field | Required | What it does |
|---|---|---|
| `value` | yes | The number to write into the metric |
| `as_of` | yes | ISO date — when the reading is from |
| `source_url` | yes | Where you got it (audit trail) |
| `source_name` | recommended | Human-readable source name |
| `note` | optional | Why you're overriding (for future-you) |
| `expires_at` | optional | After this date, override is ignored. Defaults to 60 days from `as_of`. |

## How priority works

Override is tried BEFORE any parser. If override is valid (within `expires_at`), ingest uses it and skips the parser entirely. Parser health is still logged so you can see when the underlying parser recovers.

When the parser recovers AND the new parsed value matches the override (within 5%), the override can safely be deleted. The next ingest will use the live parser.

## Auto-expire

If `expires_at` is in the past, the override is ignored and the parser runs normally. This prevents stale overrides from silently masking parser recovery.

## Example — GST stuck for 70 days

```json
{
  "value": 215000,
  "as_of": "2026-04-01",
  "source_url": "https://pib.gov.in/PressReleasePage.aspx?PRID=2014412",
  "source_name": "PIB · GST collection April 2026",
  "note": "GSTN xlsx upstream stuck since Feb. Manual until PIB fallback parser ships.",
  "expires_at": "2026-06-30"
}
```
