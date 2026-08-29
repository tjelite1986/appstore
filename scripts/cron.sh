#!/usr/bin/env bash
#
# The App Store's two scheduled jobs.
#
#   sync     pull new APKs from the Telegram channel, then wait out the run
#   scan     run the importer over the drop folder
#   sources  ask GitHub and F-Droid what they have, and fetch what is newer
#
# Both are HTTP calls into the container: the work belongs to the app, and a
# host script that touched the library directly would be a second implementation
# of the importer's rules. The admin token is read from the compose env file
# rather than copied into a unit, so rotating it is one edit.
#
# Where this machine keeps those two things is not a fact about the app, so it
# lives beside this script in cron.env, which is not in the repository — see
# cron.env.example. Either value can also come from the environment.
#
# Called by appstore-sync.timer / appstore-scan.timer / appstore-sources.timer.

set -euo pipefail

CURL=/usr/bin/curl
JQ=/usr/bin/jq

CONFIG="${APPSTORE_CRON_ENV:-$(dirname "${BASH_SOURCE[0]}")/cron.env}"
if [ -r "$CONFIG" ]; then
  # shellcheck disable=SC1090  # a per-machine file, by definition not in the repo
  . "$CONFIG"
fi

BASE="${APPSTORE_URL:-https://store.example.com}"
ENV_FILE="${APPSTORE_ENV:-/srv/compose/appstore/.env}"
# A 400 MB download over a home line, plus the importer's quiet period.
SYNC_DEADLINE=$((40 * 60))
POLL_EVERY=20

die() { echo "appstore-cron: $*" >&2; exit 1; }

[ -r "$ENV_FILE" ] || die "no env file at $ENV_FILE"
TOKEN=$(sed -n 's/^STORE_ADMIN_TOKEN=//p' "$ENV_FILE" | head -1)
# An empty token is not "no auth needed" — the write routes are shut without
# one, so every call would come back 401 and the timer would look healthy.
[ -n "$TOKEN" ] || die "STORE_ADMIN_TOKEN is empty in $ENV_FILE"

# Prints the body; fails the script on any non-2xx, with the body kept so the
# journal shows what the app said rather than just a status code. A third
# argument overrides the timeout: fetching releases holds the request open for
# as long as the downloads take.
call() {
  local method=$1 path=$2 timeout=${3:-120} body code
  body=$("$CURL" -sS -X "$method" -H "x-store-admin-token: $TOKEN" \
           -w $'\n%{http_code}' --max-time "$timeout" "$BASE$path") || die "$method $path: curl failed"
  code=${body##*$'\n'}
  body=${body%$'\n'*}
  # A substring, not `printf | head -c`: systemd runs this with SIGPIPE
  # ignored, so on a body larger than the pipe buffer head closing early makes
  # printf log "write error: Broken pipe" on top of the real message.
  [ "$code" = "200" ] || die "$method $path: HTTP $code — ${body:0:300}"
  printf '%s' "$body"
}

summarise_import() {
  "$JQ" -r '
    if . == null then "no import scan"
    else "import: \(.imported | length) attached, \(.parked | length) held for review"
       + (if (.skipped | length) > 0 then ", \(.skipped | length) skipped" else "" end)
    end'
}

case "${1:-}" in
  scan)
    call POST /api/import/scan | summarise_import
    ;;

  sources)
    # The app installs what is newer by itself; a POST with no body means
    # "fetch". One request for the whole run, held open until it is done —
    # the store runs one check at a time, so a slow run cannot pile up.
    call POST /api/sources/check 3600 | "$JQ" -r '
      if .error then "sources: \(.error)"
      else "sources: \(.checked) checked, \(.installed) fetched"
         + (if .errors > 0 then ", \(.errors) failed" else "" end)
         + (.apps // [] | map(select(.status == "installed" or .status == "error"))
              | map("\n  \(.name): \(.status) \(.detail // "")") | join(""))
      end'
    ;;

  sync)
    started=$(call POST /api/telegram | "$JQ" -r '.started')
    if [ "$started" != "true" ]; then
      # The app keeps one run at a time; the previous timer's is still going.
      echo "sync already running — nothing started"
      exit 0
    fi

    # Wait it out rather than firing and forgetting: the exit status of this
    # unit should mean something, and systemd will not start a second run of
    # a unit that is still going.
    waited=0
    while [ "$waited" -lt "$SYNC_DEADLINE" ]; do
      sleep "$POLL_EVERY"
      waited=$((waited + POLL_EVERY))
      status=$(call GET /api/telegram)
      [ "$("$JQ" -r '.running' <<<"$status")" = "true" ] || {
        "$JQ" -r '"downloaded: \(.run.downloaded) file(s)"' <<<"$status"
        "$JQ" -r '.run.log[-6:][]? | "  " + .' <<<"$status"
        "$JQ" -r '.run.imported' <<<"$status" | summarise_import
        exit 0
      }
    done
    die "run still going after ${SYNC_DEADLINE}s — left it alone"
    ;;

  *)
    die "usage: $0 sync|scan|sources"
    ;;
esac
