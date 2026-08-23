# Host timers

Two jobs, both HTTP calls into the running container (see `../cron.sh`):

| Unit | Every | What |
|------|-------|------|
| `appstore-sync.timer` | 30 min | pull new APKs from the Telegram channel |
| `appstore-scan.timer` | 15 min | import whatever was dropped into `_import/` by hand |

A Telegram run scans by itself once it has downloaded something, so the scan
timer only matters for files that arrive some other way.

Install:

    sudo install -m 0644 -o root -g root scripts/systemd/appstore-*.{service,timer} /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now appstore-sync.timer appstore-scan.timer

The units run as `thomas` and read `STORE_ADMIN_TOKEN` out of
`/srv/compose/appstore/.env`, so rotating the token needs no
change here. Watch them with `journalctl -u appstore-sync -f`.
