# Finish runner setup AFTER config.cmd has succeeded.
# Schedules run.cmd to auto-start at Windows login using Task Scheduler.
# Works on any runner version. No Admin required.
#
# Usage (from C:\Users\anike\Downloads\IRM_Build):
#   powershell -ExecutionPolicy Bypass -File scripts\finish-runner-setup.ps1

param(
  [string]$RunnerDir = "$env:USERPROFILE\actions-runner",
  [string]$TaskName = 'IRM-GitHub-Runner'
)

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "IRM runner finisher - Task Scheduler approach" -ForegroundColor Cyan
Write-Host "---------------------------------------------" -ForegroundColor Cyan

# Sanity checks
if (-not (Test-Path "$RunnerDir\run.cmd")) {
  Write-Host "ERROR: $RunnerDir\run.cmd not found." -ForegroundColor Red
  Write-Host "Did the earlier install-self-hosted-runner.ps1 step complete?"
  exit 1
}
if (-not (Test-Path "$RunnerDir\.runner")) {
  Write-Host "ERROR: $RunnerDir\.runner not found - runner not configured." -ForegroundColor Red
  Write-Host "Re-run install-self-hosted-runner.ps1 first."
  exit 1
}
Write-Host "[1/4] Runner files OK at $RunnerDir"

# Remove existing task if present (idempotent)
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "[2/4] Removing existing scheduled task: $TaskName"
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
} else {
  Write-Host "[2/4] No existing task to clean up"
}

# Create the scheduled task
Write-Host "[3/4] Registering Task Scheduler entry..."
$action = New-ScheduledTaskAction -Execute "$RunnerDir\run.cmd" -WorkingDirectory $RunnerDir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 365) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'GitHub Actions self-hosted runner for IRM ingest' | Out-Null

Write-Host "[4/4] Starting runner now..."
Start-ScheduledTask -TaskName $TaskName

Start-Sleep -Seconds 3
$state = (Get-ScheduledTask -TaskName $TaskName).State
$lastRun = (Get-ScheduledTaskInfo -TaskName $TaskName).LastRunTime

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Task name:  $TaskName"
Write-Host "  Task state: $state"
Write-Host "  Last run:   $lastRun"
Write-Host ""
Write-Host "The runner will now run in the background, auto-start at login,"
Write-Host "and auto-restart on failure (3 retries, 2 min apart)."
Write-Host ""
Write-Host "Verify online at:"
Write-Host "  https://github.com/aniketkulkarni420/india-risk-monitor/settings/actions/runners"
Write-Host "  (status should be Idle with a green dot)"
Write-Host ""
Write-Host "Manage later via PowerShell:"
Write-Host "  Start  :  Start-ScheduledTask -TaskName $TaskName"
Write-Host "  Stop   :  Stop-ScheduledTask  -TaskName $TaskName"
Write-Host "  Status :  Get-ScheduledTask   -TaskName $TaskName"
Write-Host "  Remove :  Unregister-ScheduledTask -TaskName $TaskName -Confirm:0"
Write-Host ""
