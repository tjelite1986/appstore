# Host timers

Three jobs, all HTTP calls into the running container (see `../cron.sh`):

| Unit | Every | What |
|------|-------|------|
| `appstore-sync.timer` | 30 min | pull new APKs from the Telegram channel |
| `appstore-scan.timer` | 15 min | import whatever was dropped into `_import/` by hand |
| `appstore-sources.timer` | 6 h | fetch newer releases for apps added from GitHub or F-Droid |

A Telegram run scans by itself once it has downloaded something, so the scan
timer only matters for files that arrive some other way.

The source check does nothing at all until an app carries a GitHub or F-Droid
address, and `GITHUB_TOKEN` in the compose env file is worth setting before it
watches more than a handful of repositories — anonymous GitHub requests are 60
an hour for the whole machine.

Install:

    sudo install -m 0644 -o root -g root scripts/systemd/appstore-*.{service,timer} /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now appstore-sync.timer appstore-scan.timer appstore-sources.timer

The units run as `thomas` and read `STORE_ADMIN_TOKEN` out of
`/srv/compose/appstore/.env`, so rotating the token needs no
change here. Watch them with `journalctl -u appstore-sync -f`.
