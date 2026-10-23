#!/usr/bin/env bash
# Runs the bot's jobs on the tower instead of Vercel's cron (see tower/README.md):
#   paper cycle every ~90 s, market recorder every ~5 min, ProphetX trade listener
#   back to back (each run listens ~4¾ min), Hypotheticals replays hourly.
# Each job has its own lock in bot_runs, so the hourly GitHub backup can't double-run them.
# Output goes to the systemd journal; the jobs print counts only, never prices or positions.
set -u
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then echo "tower: missing $(pwd)/.env (see tower/env.example)"; exit 1; fi
set -a; . ./.env; set +a

# loop <seconds between starts> <script>
loop() {
  local every=$1 script=$2
  while true; do
    local start=$(date +%s)
    timeout 1800 npx tsx "$script" || echo "tower: $script exited with $?"
    local left=$(( every - ($(date +%s) - start) ))
    [ "$left" -gt 0 ] && sleep "$left"
  done
}

loop 90 bot/runner/paper.ts &
loop 300 bot/runner/record.ts &
loop 5 bot/runner/pxtape.ts &
loop 3600 bot/hypo/run.ts &
wait
