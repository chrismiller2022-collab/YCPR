# Running the bot on the tower

The tower runs every bot job, so Vercel only serves the dashboard (Hobby plan, far under its CPU limit). Setup takes about 15 minutes, all copy and paste.

What runs, via `tower/run-loops.sh` under systemd:

| Job | How often | Was on |
|---|---|---|
| Paper cycle (`bot/runner/paper.ts`) | every ~90 s | Vercel, every 5 min |
| Market recorder (`bot/runner/record.ts`) | every ~5 min | Vercel, every 5 min |
| ProphetX trade listener (`bot/runner/pxtape.ts`) | continuously (back-to-back ~4¾ min runs) | Vercel, every 5 min |
| Hypotheticals replays (`bot/hypo/run.ts`) | hourly | Vercel, hourly |

The hourly GitHub Actions backup (`.github/workflows/bot-paper.yml`) keeps running for free. Each job has its own lock, so nothing runs twice; if the tower is off, the backup still trades hourly.

## 1. Get the latest code (Ubuntu terminal)

```bash
cd ~/YCPR && git pull && npm install
```

## 2. Create `.env` with the keys (on the tower only)

```bash
cp tower/env.example .env
chmod 600 .env
nano .env
```

Fill in:
- **SUPABASE_SERVICE_ROLE_KEY**: Supabase dashboard → project → Project Settings → API Keys → the **service_role / secret** key. (Vercel hides saved values, so copy it from Supabase.)
- **PROPHETX_ACCESS_KEY / PROPHETX_SECRET_KEY**: from ProphetX's API Integration page. If you no longer have the secret, generate a new pair, and also update the two GitHub repo secrets (Settings → Secrets and variables → Actions) so the backup keeps working.

Save with Ctrl+O, Enter, then exit with Ctrl+X. Never paste these values into a chat.

Quick check (runs one paper cycle, prints counts):

```bash
set -a; . ./.env; set +a; npx tsx bot/runner/paper.ts
```

## 3. Install it as a service (starts on boot, restarts if it crashes)

```bash
sudo tee /etc/systemd/system/ycpr-bot.service >/dev/null <<EOF
[Unit]
Description=YCPR bot jobs (paper, recorder, ProphetX tape, Hypotheticals)
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$HOME/YCPR
ExecStart=$HOME/YCPR/tower/run-loops.sh
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now ycpr-bot
systemctl status ycpr-bot --no-pager
```

Watch it live with `journalctl -u ycpr-bot -f` (Ctrl+C to stop watching; the bot keeps running).

## 4. Keep WSL running when no Ubuntu window is open (Windows PowerShell, as admin)

WSL stops Ubuntu when nothing is attached to it. This scheduled task keeps it up from login:

```powershell
$a = New-ScheduledTaskAction -Execute "wsl.exe" -Argument "-d Ubuntu --exec sleep infinity"
$t = New-ScheduledTaskTrigger -AtLogOn
$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "WSL keep-alive" -Action $a -Trigger $t -Settings $s -RunLevel Highest
Start-ScheduledTask -TaskName "WSL keep-alive"
```

Check: close every Ubuntu window, wait a minute, then run `wsl -l -v` in PowerShell. Ubuntu should still say **Running**. After a Windows restart, it starts once you log in. Turn on automatic sign-in if you want it to come back without you.

Also keep Windows awake: Settings → System → Power → Sleep when plugged in → **Never**.

## 5. Turn off the Vercel trigger

In **cron-job.org**, pause or disable the job that calls `https://ycpr-bot.vercel.app/api/cycle`. Vercel then only serves the dashboard.

### ESPN backup + failover (recommended)

Point a cron-job.org job at `https://ycpr-bot.vercel.app/api/espn` (header `Authorization: Bearer <CRON_SECRET>`, the same
secret as `/api/cycle`), every 10 minutes. Saturday noon to Sunday 2 am Eastern is enough; running it all week is fine too.
While the tower is cycling it only saves ESPN finals (the tower does that as well, so it's a cheap double check). If no
paper cycle has finished for 10 minutes, it runs a full cycle on Vercel instead and starts the recorder, so trading and
grading carry on until the tower is back. Each run shows up in Run history as "ESPN backup".

## 6. Confirm

Dashboard → **Settings → Run history → Everything**. Within a few minutes you should see paper runs about every 90 s, recorder runs every ~5 min, ProphetX listener runs back to back, and no errors.

## Day to day

- Update the code: `cd ~/YCPR && git pull && npm install && sudo systemctl restart ycpr-bot`
- Stop the bot: `sudo systemctl stop ycpr-bot` (the dashboard's kill switch also works)
- The status pill at the top of the dashboard says whether the bot is running: **Live** (a cycle finished in the last 3 min),
  **Slow** (3–6 min), **Down** (6+ min, with the likely cause: "Tower offline" when every job stopped at once, or the paper
  cycle's own error). An amber ⚠ names a venue or job with a problem. Click it for every job in Settings → Health.
- If the tower is down, `/api/espn` (above) takes over trading every 10 minutes; re-enable the `/api/cycle` job for 5-minute cycles.
- Tower stopped overnight? In Windows check restarts and sleep: `Get-WinEvent -FilterHashtable @{LogName='System'; Id=1074,6006,6008,42,107} -MaxEvents 10`.
  Set Windows Update active hours to cover the night, turn sleep off, and make the WSL keep-alive task run at startup.

The always-on worker (handoff doc) will later replace `run-loops.sh` with one process that reacts within seconds; this service setup stays the same.
