# One-time setup on Windows. Right-click this file > "Run with PowerShell".
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

Write-Host "`n=== Homework notifier: Windows setup ===`n"

# 1. Node.js
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-Host "Node.js is not installed. Install the LTS version from https://nodejs.org, then run this again." -ForegroundColor Yellow
  Read-Host "Press Enter to close"; exit 1
}
Write-Host "Node.js found: $(node --version)"

# 2. Dependencies + browser
Write-Host "`nInstalling (takes a few minutes the first time)..."
npm install --no-audit --no-fund
npx playwright install chromium

# 3. Settings (school login + Telegram)
node src/setup.js
if ($LASTEXITCODE -ne 0) { Read-Host "Press Enter to close"; exit 1 }

# 4. Test against a past date without sending
Write-Host "`nTesting the school login (nothing is sent)..."
node src/notify.js 05-11-2026 --test

# 5. Schedule: Mon-Fri every hour 2-8 PM and Sat/Sun 10 PM. Runs late if the PC was asleep/off at that time.
$log = Join-Path $PSScriptRoot 'run.log'
# conhost --headless runs the command without opening a window, so it never interrupts your work.
$action = New-ScheduledTaskAction -Execute 'conhost.exe' `
  -Argument "--headless cmd.exe /c `"`"$node`" src\notify.js >> `"$log`" 2>&1`"" -WorkingDirectory $PSScriptRoot
$triggers = @(foreach ($h in 14..20) {
  New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At ("{0}:00" -f $h)
})
$triggers += New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday,Sunday -At '22:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Homework notifier' -Action $action -Trigger $triggers -Settings $settings `
  -Description 'Checks school homework and sends it to Telegram' -Force | Out-Null

Write-Host "`nDone! It will run Mon-Fri every hour from 2 to 8 PM and Sat/Sun at 10 PM while you're logged in to this PC." -ForegroundColor Green
Write-Host "You get a message when homework appears, and a summary at 8 PM (weekends 10 PM) even if there is none."
Write-Host "Log file: $log"
Write-Host "To run it now: open Task Scheduler, find 'Homework notifier', click Run."
Read-Host "`nPress Enter to close"
