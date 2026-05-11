# Self-hosted GitHub Actions runner — setup guide

## Why bother

Some Indian government sites (NPCI, NSE, DGCA, RBI internal pages, GST portal) block or rate-limit GitHub Actions cloud runners because they originate from US/EU IPs. Running the ingest job from your own machine — which has an Indian IP — bypasses geo-blocks entirely.

**Result:** ~5 of the 15 currently-red parsers go green without any code changes.

## What it costs

- $0 in money
- ~50 MB disk space for the runner
- ~5 minutes of CPU + ~50 MB of bandwidth per scheduled run (negligible)
- Your PC must be on when the cron fires (or you skip that run — failures just get logged, no data loss)

## Setup · 15 minutes total

### 1. Create a runner registration token in GitHub

1. Go to `https://github.com/aniketkulkarni420/india-risk-monitor/settings/actions/runners`
2. Click "New self-hosted runner"
3. Pick: **Windows · x64**
4. GitHub will show a registration token (copy it; expires in 1 hour)

### 2. Install the runner on your PC

Open PowerShell as Admin in `C:\Users\anike\actions-runner` (create the dir first):

```powershell
mkdir C:\Users\anike\actions-runner
cd C:\Users\anike\actions-runner

# Download (version may have bumped; check GitHub's setup screen for current URL)
Invoke-WebRequest -Uri https://github.com/actions/runner/releases/download/v2.319.1/actions-runner-win-x64-2.319.1.zip -OutFile actions-runner.zip

# Extract
Add-Type -AssemblyName System.IO.Compression.FileSystem ; [System.IO.Compression.ZipFile]::ExtractToDirectory("$PWD/actions-runner.zip", "$PWD")

# Configure with the token from step 1
./config.cmd --url https://github.com/aniketkulkarni420/india-risk-monitor --token YOUR_REGISTRATION_TOKEN --labels self-hosted,windows,india

# Install as Windows service so it runs in background
./svc.cmd install
./svc.cmd start
```

### 3. Add the workflow to use it

Create `.github/workflows/ingest-india-runner.yml`:

```yaml
name: Ingest (India runner)
on:
  schedule:
    - cron: '0 */6 * * *'  # every 6h
  workflow_dispatch:

jobs:
  ingest-india-geo:
    runs-on: [self-hosted, windows, india]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run ingest -- --live --slot=india_only
      - name: Commit data
        run: |
          git config user.name "IRM India Runner"
          git config user.email "irm-india@bot.local"
          git add data/
          git diff --staged --quiet || git commit -m "ingest(india): scheduled run"
          git push
```

### 4. Tag metrics that should run on the India runner

In each metric JSON that needs an Indian IP, add:

```json
{
  "metric_id": "upi_value",
  "ingest_slot": "india_only",
  ...
}
```

The default scheduled job (cloud runner) will skip these; the self-hosted runner will pick them up.

## Operations

### When your PC is off

The cron simply skips — the next time your PC is on and the cron fires, ingest runs. Parser health badge will show "amber" if a metric hasn't been ingested in 2× its cadence. This is honest behavior.

### Stopping / restarting the runner

```powershell
cd C:\Users\anike\actions-runner
./svc.cmd stop
./svc.cmd start
```

### Updating the runner

GitHub auto-updates the runner when there's a new version (the service handles it).

### Removing the runner

```powershell
cd C:\Users\anike\actions-runner
./svc.cmd uninstall
./config.cmd remove --token YOUR_REMOVAL_TOKEN
```

## Security

- The runner has access to whatever your GitHub repo grants. Since the IRM repo is data-publishing only, the blast radius is limited.
- Never run the runner with admin privileges. The service installs at standard user level.
- If you ever leave Anthropic / sell the PC: run the removal steps above first.

## Alternative · Old Android phone

If you have an old Android phone gathering dust, install **Termux** + GitHub Actions ARM64 runner. Same effect, runs on phone power, doesn't tie up your main PC.

```bash
pkg install nodejs git
# then follow GitHub's Linux ARM64 setup
```
