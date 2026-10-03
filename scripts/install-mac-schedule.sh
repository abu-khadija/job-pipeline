#!/bin/zsh
# Runs `npm run daily` (generate → send → replies → followup) every hour on this Mac.
# Install:   zsh scripts/install-mac-schedule.sh
# Remove:    launchctl unload ~/Library/LaunchAgents/com.islam.job-pipeline.plist && rm ~/Library/LaunchAgents/com.islam.job-pipeline.plist
# Logs:      out/daily.log
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
NPM="$(command -v npm)"
PLIST="$HOME/Library/LaunchAgents/com.islam.job-pipeline.plist"
mkdir -p "$DIR/out" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.islam.job-pipeline</string>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>-lc</string><string>"$NPM" run daily</string></array>
  <key>StartInterval</key><integer>3600</integer>
  <key>StandardOutPath</key><string>$DIR/out/daily.log</string>
  <key>StandardErrorPath</key><string>$DIR/out/daily.log</string>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed: npm run daily runs every hour. Logs: $DIR/out/daily.log"
