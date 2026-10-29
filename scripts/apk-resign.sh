#!/usr/bin/env bash
#
# Re-sign the builds of `storeSigned` listings with the store's own key.
#
# Why, and how the work is split with the app, is in lib/store-signing.ts. In
# short: the app says which files still carry a modder's key and holds them
# back until they do not; this script holds the key, signs, and puts the
# signed copy where the original was. Same split as fdroid-sign.sh, for the
# same reason — a signing key does not belong inside the container.
#
# Per file:
#   1. sign a copy beside it (a dot name, so nothing lists it as a build)
#   2. check the copy verifies and carries the store's certificate
#   3. hard-link the original into _originals/<slug>/<version>/ — kept, never
#      deleted, so turning the setting off can still give it back
#   4. rename the copy over the served file, which is atomic on one filesystem
#
# The signed file gets the original's modification time plus one second. The
# catalog dates a version from its files, so a re-sign must not make an old
# build look new — and the APK facts cache is keyed on size and mtime, so the
# second is what guarantees the new signer is read even in the unlikely case
# the size came out identical.
#
# The key is made on first run in _state/apk-signing/, beside its password,
# and must stay out of any backup of the library the way _state/fdroid/ does.
# Losing it costs every phone one more uninstall per app; there is no way to
# move installed apps to a new key.
#
# Called by appstore-resign.timer, and first thing by fdroid-sign.sh so an
# index is never built while a file is still waiting. By hand:
#     scripts/apk-resign.sh

set -euo pipefail

CURL=/usr/bin/curl
JQ=/usr/bin/jq
KEYTOOL=/usr/bin/keytool
SHA256SUM=/usr/bin/sha256sum
FLOCK=/usr/bin/flock

CONFIG="${APPSTORE_CRON_ENV:-$(dirname "${BASH_SOURCE[0]}")/cron.env}"
if [ -r "$CONFIG" ]; then
  # shellcheck disable=SC1090  # a per-machine file, by definition not in the repo
  . "$CONFIG"
fi

BASE="${APPSTORE_URL:-https://store.example.com}"
ENV_FILE="${APPSTORE_ENV:-/srv/compose/appstore/.env}"
ROOT="${APPSTORE_STORE_ROOT:-}"
# From the Android SDK's build-tools: a jar behind a shell wrapper, so it runs
# wherever the JDK does, arm64 included.
APKSIGNER="${APPSTORE_APKSIGNER:-$(command -v apksigner || true)}"

KEY_ALIAS=store
# 10000 days, as for the repository key: an expired key would leave no way to
# sign an update that installs over what phones already hold.
KEY_VALIDITY=10000

die() { echo "appstore-resign: $*" >&2; exit 1; }
say() { echo "appstore-resign: $*"; }

for tool in "$CURL" "$JQ" "$KEYTOOL" "$SHA256SUM" "$FLOCK"; do
  [ -x "$tool" ] || die "missing $tool"
done
[ -n "$APKSIGNER" ] && [ -x "$APKSIGNER" ] \
  || die "apksigner not found — set APPSTORE_APKSIGNER in cron.env (Android SDK build-tools)"

[ -n "$ROOT" ] || die "APPSTORE_STORE_ROOT is not set (see cron.env.example)"
[ -d "$ROOT" ] || die "no library at $ROOT"
[ -r "$ENV_FILE" ] || die "no env file at $ENV_FILE"
TOKEN=$(sed -n 's/^STORE_ADMIN_TOKEN=//p' "$ENV_FILE" | head -1)
[ -n "$TOKEN" ] || die "STORE_ADMIN_TOKEN is empty in $ENV_FILE"

STATE="$ROOT/_state/apk-signing"
KEYSTORE="$STATE/keystore.p12"
PASSFILE="$STATE/keystore.pass"
SIGNER_FILE="$STATE/signer.sha256"
mkdir -p "$STATE"
chmod 700 "$STATE"

# The timer and fdroid-sign.sh can both start a run; two runs signing the
# same file would race on the rename and on the original's link.
exec 9>"$STATE/.lock"
"$FLOCK" -w 600 9 || die "another run still holds the lock after 10 minutes"

# ------------------------------------------------------------------ the key

if [ ! -f "$KEYSTORE" ]; then
  say "no keystore yet — generating one in $STATE"
  # A bounded read, not `tr </dev/urandom | head` — see fdroid-sign.sh.
  RAW=$(LC_ALL=C tr -dc 'A-Za-z0-9' < <(head -c 512 /dev/urandom))
  [ ${#RAW} -ge 40 ] || die "could not read enough randomness for a password"
  ( umask 077; printf '%s\n' "${RAW:0:40}" > "$PASSFILE" )
  PASS=$(cat "$PASSFILE")
  "$KEYTOOL" -genkeypair \
    -keystore "$KEYSTORE" -storetype PKCS12 \
    -storepass "$PASS" -keypass "$PASS" \
    -alias "$KEY_ALIAS" -keyalg RSA -keysize 4096 \
    -validity "$KEY_VALIDITY" \
    -dname "CN=App Store, OU=apps, O=App Store" >/dev/null
  chmod 600 "$KEYSTORE"
fi

[ -r "$PASSFILE" ] || die "keystore at $KEYSTORE but no password beside it"
PASS=$(cat "$PASSFILE")

# The form extractSignerSha256 reads out of an APK: SHA-256 of the DER
# certificate, lower-case hex. Recomputed every run, so the file the app reads
# can only describe the key actually in use.
FINGERPRINT=$(
  "$KEYTOOL" -exportcert -keystore "$KEYSTORE" -storetype PKCS12 \
    -storepass "$PASS" -alias "$KEY_ALIAS" 2>/dev/null \
    | "$SHA256SUM" | cut -d' ' -f1
)
[ ${#FINGERPRINT} -eq 64 ] || die "could not read the certificate out of $KEYSTORE"
if [ "$(cat "$SIGNER_FILE" 2>/dev/null)" != "$FINGERPRINT" ]; then
  printf '%s\n' "$FINGERPRINT" > "$SIGNER_FILE.tmp"
  mv "$SIGNER_FILE.tmp" "$SIGNER_FILE"
  chmod 644 "$SIGNER_FILE"
fi

# --------------------------------------------------------------- the files

LIST=$("$CURL" -sS -H "x-store-admin-token: $TOKEN" -w $'\n%{http_code}' \
         --max-time 600 "$BASE/api/store-signing") || die "GET /api/store-signing: curl failed"
CODE=${LIST##*$'\n'}
LIST=${LIST%$'\n'*}
[ "$CODE" = "200" ] || die "GET /api/store-signing: HTTP $CODE — ${LIST:0:300}"

COUNT=$("$JQ" '.files | length' <<<"$LIST")
[ "$COUNT" -gt 0 ] || exit 0
say "$COUNT file(s) to sign"

# A path from the app is joined to the library root, so it has to stay inside
# it: no absolute paths and no `..` segment, whatever the app said.
inside() { [[ "$1" != /* && "/$1/" != */../* ]]; }

signed=0
failed=0
while IFS=$'\t' read -r rel orig_rel; do
  if ! inside "$rel" || ! inside "$orig_rel"; then
    say "refusing a path outside the library: $rel"; failed=$((failed + 1)); continue
  fi
  src="$ROOT/$rel"
  [ -f "$src" ] || { say "$rel: gone before it could be signed"; continue; }

  dir=$(dirname "$src")
  tmp="$dir/.$(basename "$src").resign-$$"
  rm -f "$tmp" "$tmp.idsig"

  # No --key-pass: given the same file as --ks-pass, apksigner reads the key
  # password from its *second* line, and this file has one. A PKCS12 entry is
  # locked with the keystore's password, which apksigner tries by default.
  if ! "$APKSIGNER" sign \
        --ks "$KEYSTORE" --ks-type PKCS12 --ks-key-alias "$KEY_ALIAS" \
        --ks-pass "file:$PASSFILE" \
        --v4-signing-enabled false \
        --out "$tmp" "$src" >/dev/null 2>"$tmp.err"; then
    # The first line says what went wrong; the rest is a Java stack trace.
    say "$rel: apksigner refused it — $(grep -v '^[[:space:]]*at ' "$tmp.err" | head -c 300 | tr '\n' ' ')"
    rm -f "$tmp" "$tmp.err"; failed=$((failed + 1)); continue
  fi
  rm -f "$tmp.err"

  # The certificate the copy actually carries, not the one asked for.
  got=$("$APKSIGNER" verify --print-certs "$tmp" 2>/dev/null \
          | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1)
  if [ "$got" != "$FINGERPRINT" ]; then
    say "$rel: signed copy does not verify with the store key (${got:-no signer})"
    rm -f "$tmp"; failed=$((failed + 1)); continue
  fi

  # Never over an earlier original: a second build under the same name gets a
  # numbered link beside the first.
  orig="$ROOT/$orig_rel"
  mkdir -p "$(dirname "$orig")"
  n=1
  while [ -e "$orig" ]; do
    orig="$ROOT/${orig_rel%.*}-$n.${orig_rel##*.}"
    n=$((n + 1))
  done
  ln "$src" "$orig"

  mtime=$(stat -c %Y "$src")
  touch -d "@$((mtime + 1))" "$tmp"
  mv -f "$tmp" "$src"
  signed=$((signed + 1))
  say "$rel: signed (original kept as ${orig#"$ROOT/"})"
done < <("$JQ" -r '.files[] | [.path, .original] | @tsv' <<<"$LIST")

# Drop the catalog cache so sizes and signers are read now. A failure here is
# not a failure of the signing: the cache expires on its own within seconds.
"$CURL" -sS -X POST -H "x-store-admin-token: $TOKEN" --max-time 30 \
  "$BASE/api/store-signing" >/dev/null || say "could not tell the app to re-read the catalog"

say "done: $signed signed, $failed failed"
[ "$failed" -eq 0 ] || exit 1
