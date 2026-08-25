# Host timers

Four jobs. Three are HTTP calls into the running container (see `../cron.sh`);
the fourth signs an index and so has to be more than that (see
`../fdroid-sign.sh`):

| Unit | Every | What |
|------|-------|------|
| `appstore-sync.timer` | 30 min | pull new APKs from the Telegram channel |
| `appstore-scan.timer` | 15 min | import whatever was dropped into `_import/` by hand |
| `appstore-sources.timer` | 6 h | fetch newer releases for apps added from GitHub or F-Droid |
| `appstore-fdroid.timer` | 6 h | rebuild and sign `index-v1.jar` |

A Telegram run scans by itself once it has downloaded something, so the scan
timer only matters for files that arrive some other way.

The source check does nothing at all until an app carries a GitHub or F-Droid
address, and `GITHUB_TOKEN` in the compose env file is worth setting before it
watches more than a handful of repositories — anonymous GitHub requests are 60
an hour for the whole machine.

`appstore-fdroid` is the only one with requirements of its own. It needs a JDK
on the host — `jar`, `jarsigner` and `keytool` — because signing is the one
thing that cannot happen inside the container without putting the repository
key inside the image. It also needs to read and write the library directly, so
`APPSTORE_STORE_ROOT` in `scripts/cron.env` has to name the library as the
*host* sees it, and the unit's user has to own it. Everything else it needs it
asks the app for.

The key it generates lives in `_state/fdroid/`, beside its password in plain
text, and never leaves. Whether that belongs in whatever backs up the library
is worth a decision rather than a default — a key in a versioned backup cannot
be taken back out of it, and losing the key costs exactly one thing: a client
pins the fingerprint, so every subscribed phone has to remove the repository
and add it again.

Install:

    sudo install -m 0644 -o root -g root scripts/systemd/appstore-*.{service,timer} /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now appstore-sync.timer appstore-scan.timer \
                               appstore-sources.timer appstore-fdroid.timer

The units here are examples: `User`, `Group` and the `ExecStart` path are facts
about one machine, so set them to yours before installing. The same goes for
the two values `../cron.sh` needs — the store's URL and the compose env file it
reads `STORE_ADMIN_TOKEN` out of — which live in `scripts/cron.env` beside the
script rather than in a unit, so rotating the token needs no change here. Copy
`scripts/cron.env.example` to start one. Watch the timers with
`journalctl -u appstore-sync -f`.
