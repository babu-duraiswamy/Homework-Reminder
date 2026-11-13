#!/bin/bash
# One-time setup on macOS. In Terminal:  bash setup-mac.sh
set -e
cd "$(dirname "$0")"
DIR="$(pwd)"

echo; echo "=== Homework notifier: Mac setup ==="; echo

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org, then run this again."
  exit 1
fi
echo "Node.js found: $(node --version)"

echo; echo "Installing (takes a few minutes the first time)..."
npm install --no-audit --no-fund
npx playwright install chromium

node src/setup.js

echo; echo "Testing the school login (nothing is sent)..."
node src/notify.js 05-11-2026 --test

# Schedule: Mon-Fri every hour 2-8 PM and Sat/Sun at 10 PM. If the Mac was asleep, it runs once when it wakes.
PLIST="$HOME/Library/LaunchAgents/com.homework.notifier.plist"
mkdir -p "$HOME/Library/LaunchAgents"
{
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
  echo '<plist version="1.0"><dict>'
  echo '  <key>Label</key><string>com.homework.notifier</string>'
  echo "  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/src/notify.js</string></array>"
  echo "  <key>WorkingDirectory</key><string>$DIR</string>"
  echo "  <key>StandardOutPath</key><string>$DIR/run.log</string>"
  echo "  <key>StandardErrorPath</key><string>$DIR/run.log</string>"
  echo '  <key>StartCalendarInterval</key><array>'
  for d in 1 2 3 4 5; do for h in 14 15 16 17 18 19 20; do
    echo "    <dict><key>Weekday</key><integer>$d</integer><key>Hour</key><integer>$h</integer><key>Minute</key><integer>0</integer></dict>"
  done; done
  for d in 6 0; do  # Saturday, Sunday
    echo "    <dict><key>Weekday</key><integer>$d</integer><key>Hour</key><integer>22</integer><key>Minute</key><integer>0</integer></dict>"
  done
  echo '  </array>'
  echo '</dict></plist>'
} > "$PLIST"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo
echo "Done! It will run Mon-Fri every hour from 2 to 8 PM and Sat/Sun at 10 PM while you're logged in to this Mac."
echo "You get a message when homework appears, and a summary at 8 PM (weekends 10 PM) even if there is none."
echo "Log file: $DIR/run.log"
echo "To run it now:  launchctl start com.homework.notifier"
