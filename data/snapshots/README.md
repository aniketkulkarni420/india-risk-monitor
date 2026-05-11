# HTML snapshots

Every successful parser fetch stores a gzipped copy of the page body here, plus a JSON sidecar with metadata. Kept for the last 14 days per metric (auto-pruned).

## Why

- **Debug:** when a parser breaks tomorrow, `gunzip yesterday's snapshot | diff today's source` shows exactly what HTML changed.
- **Self-healing:** the Step 13 PR bot reads these to propose updated regex/selectors when a parser fails.
- **Regression tests:** new parser changes can be tested against historical snapshots before deployment.

## Layout

```
data/snapshots/
  brent_crude/
    2026-05-09.html.gz
    2026-05-09.json   ← { url, captured_at, extracted_value, bytes_gzipped, ... }
    2026-05-10.html.gz
    2026-05-10.json
    ...
```

## Disk usage

Gzipped HTML averages 5-20 KB. 14 days × 70 metrics × 15 KB ≈ ~15 MB total. Auto-prunes anything older than the last 14 entries per metric.
