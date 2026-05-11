# IRM - Self-hosted GitHub Actions runner installer
# ---------------------------------------------------
# One-time setup script. Run in PowerShell as your normal user.
#
# Usage:
#   1. Get a registration token:
#        https://github.com/aniketkulkarni420/india-risk-monitor/settings/actions/runners/new
#      Click "Windows x64". GitHub shows a token in the "Configure" box.
#      Copy it (starts with letters/digits, ~28 chars).
#   2. Run:
#        powershell -ExecutionPolicy Bypass -File scripts\install-self-hosted-runner.ps1 -Token YOUR_TOKEN

param(
  [Parameter(Mandatory=$true)][string]$Token,
  [string]$RepoUrl = 'https://github.com/aniketkulkarni420/india-risk-monitor',
  [string]$RunnerName = "$env:COMPUTERNAME-irm",
  [string]$RunnerVersion = '2.319.1'
)

$ErrorActionPreference = 'Stop'
$RunnerDir = "$env:USERPROFILE\actions-runner"

Write-Host ""
Write-Host "IRM self-hosted runner installer" -ForegroundColor Cyan
Write-Host "----------------------------------" -ForegroundColor Cyan
Write-Host "Repo:    $RepoUrl"
Write-Host "Name:    $RunnerName"
Write-Host "Dir:     $RunnerDir"
Write-Host "Version: $RunnerVersion"
Write-Host ""

if (-not (Test-Path $RunnerDir)) {
  New-Item -ItemType Directory -Path $RunnerDir | Out-Null
}
Set-Location $RunnerDir

$Zip = "actions-runner-win-x64-$RunnerVersion.zip"
$Url = "https://github.com/actions/runner/releases/download/v$RunnerVersion/$Zip"

if (-not (Test-Path $Zip)) {
  Write-Host "[1/4] Downloading runner..."
  Invoke-WebRequest -Uri $Url -OutFile $Zip
} else {
  Write-Host "[1/4] Runner zip already downloaded, skipping"
}

if (-not (Test-Path './config.cmd')) {
  Write-Host "[2/4] Extracting..."
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory("$RunnerDir\$Zip", $RunnerDir)
} else {
  Write-Host "[2/4] Already extracted, skipping"
}

Write-Host "[3/4] Configuring runner..."
& "$RunnerDir\config.cmd" --unattended --url $RepoUrl --token $Token --name $RunnerName --labels "self-hosted,windows,india" --replace

Write-Host "[4/4] Registering as a scheduled task (auto-starts at login)..."
# Newer runner versions do not ship svc.cmd. Task Scheduler is more reliable
# and does not require Admin.
& "$PSScriptRoot\finish-runner-setup.ps1" -RunnerDir $RunnerDir

Write-Host ""
Write-Host "Done. Runner '$RunnerName' is registered and auto-starts at every login."
Write-Host "Verify at: $RepoUrl/settings/actions/runners"
Write-Host ""
Write-Host "Next step: in GitHub Actions, set runs-on: [self-hosted, windows, india]"
Write-Host "          for any workflow that needs an India IP."
