#!/usr/bin/env bash
#
# Sign the Telegram feed in again after its session has been revoked
# ("TELEGRAM_SESSION is not authorized"), in one command:
#
#   1. scripts/telegram-login.mjs asks for phone number and login code and
#      writes the new TELEGRAM_SESSION into the compose env file,
#   2. the container is recreated so it reads the new value,
#   3. one sync is run so the result shows straight away.
#
# The compose env file comes from cron.env (APPSTORE_ENV), like scripts/cron.sh.
# Needs an interactive terminal.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${APPSTORE_CRON_ENV:-$HERE/cron.env}"
if [ -r "$CONFIG" ]; then
  # shellcheck disable=SC1090  # a per-machine file, by definition not in the repo
  . "$CONFIG"
fi

ENV_FILE="${APPSTORE_ENV:-}"
if [ -z "$ENV_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  echo "Compose env file not found (APPSTORE_ENV in $CONFIG): '${ENV_FILE}'" >&2
  exit 1
fi

cd "$HERE/.."
TELEGRAM_ENV_FILE="$ENV_FILE" node scripts/telegram-login.mjs

echo
echo "Recreating the container..."
(cd "$(dirname "$ENV_FILE")" && docker compose up -d)

echo
echo "Waiting for the app to come up..."
sleep 15

echo "Running one sync (this can take a few minutes)..."
if "$HERE/cron.sh" sync; then
  echo "Done: the Telegram sync works again."
else
  echo "The sync still failed — see the output above." >&2
  exit 1
fi
