#!/usr/bin/env bash
#
# Publish the store as a signed F-Droid repository.
#
# The other timers are pure HTTP: the work belongs to the app, and the host
# only decides when. This one cannot be, and the reason is the whole design.
# A subscribable F-Droid repository is a *signed* `index-v1.jar`, signing needs
# a JDK, and a repository key baked into a container image is a key inside
# every copy of that image. So the split is:
#
#   the app     decides what is in the index — which apps, which files, their
#               hashes, version codes and signers — and hands it over whole
#               (GET /api/fdroid/index-v1)
#   this script owns the key, seals the document into a jar, and drops it
#               where the app can serve it (_state/fdroid/<variant>/)
#
# Two variants exist because a signature cannot be per request: `all` is the
# whole shelf, `clean` is the shelf without Adults. The repository route picks
# between them from the token in the URL — see app/fdroid/[[...path]]/route.ts.
#
# The keystore is created on first run and never leaves _state/fdroid/. Losing
# it is not fatal but it is not free either: a client pins the fingerprint, so
# a new key means every subscribed phone has to remove the repository and add
# it again.
#
# Called by appstore-fdroid.timer. Run it by hand the same way:
#     scripts/fdroid-sign.sh

set -euo pipefail

CURL=/usr/bin/curl
JAR=/usr/bin/jar
JARSIGNER=/usr/bin/jarsigner
KEYTOOL=/usr/bin/keytool
SHA256SUM=/usr/bin/sha256sum

CONFIG="${APPSTORE_CRON_ENV:-$(dirname "${BASH_SOURCE[0]}")/cron.env}"
if [ -r "$CONFIG" ]; then
  # shellcheck disable=SC1090  # a per-machine file, by definition not in the repo
  . "$CONFIG"
fi

BASE="${APPSTORE_URL:-https://store.example.com}"
ENV_FILE="${APPSTORE_ENV:-/srv/compose/appstore/.env}"
# The library as *this machine* sees it. Inside the container it is /store;
# out here it is wherever the bind mount comes from, which is not a fact about
# the app — so, like the other two, it lives in cron.env.
ROOT="${APPSTORE_STORE_ROOT:-}"

# 10000 days: an expired repository key stops every subscribed phone from
# updating, and there is no renewal story for a key a client has pinned.
KEY_ALIAS=repo
KEY_VALIDITY=10000

die() { echo "appstore-fdroid: $*" >&2; exit 1; }
say() { echo "appstore-fdroid: $*"; }

for tool in "$CURL" "$JAR" "$JARSIGNER" "$KEYTOOL" "$SHA256SUM"; do
  [ -x "$tool" ] || die "missing $tool — a JDK is required on the host"
done

[ -n "$ROOT" ] || die "APPSTORE_STORE_ROOT is not set (see cron.env.example)"
[ -d "$ROOT" ] || die "no library at $ROOT"
[ -r "$ENV_FILE" ] || die "no env file at $ENV_FILE"
TOKEN=$(sed -n 's/^STORE_ADMIN_TOKEN=//p' "$ENV_FILE" | head -1)
# An empty token is not "no auth needed" — the index endpoint is admin-gated,
# so every call would come back 401 and the timer would look healthy.
[ -n "$TOKEN" ] || die "STORE_ADMIN_TOKEN is empty in $ENV_FILE"

STATE="$ROOT/_state/fdroid"
KEYSTORE="$STATE/keystore.p12"
PASSFILE="$STATE/keystore.pass"
mkdir -p "$STATE"
chmod 700 "$STATE"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# ------------------------------------------------------------------ the key

if [ ! -f "$KEYSTORE" ]; then
  say "no keystore yet — generating one in $STATE"
  # A bounded read, not `tr </dev/urandom | head`: `head` closing the pipe
  # kills `tr` with SIGPIPE, and under `set -o pipefail` that is exit 141 —
  # the script would die here, silently, every time it had to make a key.
  # 512 random bytes leave well over 40 usable characters.
  RAW=$(LC_ALL=C tr -dc 'A-Za-z0-9' < <(head -c 512 /dev/urandom))
  [ ${#RAW} -ge 40 ] || die "could not read enough randomness for a password"
  # Written before the keystore, so a run interrupted between the two leaves a
  # password with no key rather than a key with no password.
  ( umask 077; printf '%s\n' "${RAW:0:40}" > "$PASSFILE" )
  PASS=$(cat "$PASSFILE")
  "$KEYTOOL" -genkeypair \
    -keystore "$KEYSTORE" -storetype PKCS12 \
    -storepass "$PASS" -keypass "$PASS" \
    -alias "$KEY_ALIAS" -keyalg RSA -keysize 4096 \
    -validity "$KEY_VALIDITY" \
    -dname "CN=App Store, OU=repo, O=App Store" >/dev/null
  chmod 600 "$KEYSTORE"
fi

[ -r "$PASSFILE" ] || die "keystore at $KEYSTORE but no password beside it"
PASS=$(cat "$PASSFILE")

# What a client pins: the SHA-256 of the signing certificate, DER, upper-case
# hex with no separators. Recomputed every run rather than stored and trusted,
# so the file on disk can only ever describe the key actually being used.
FINGERPRINT=$(
  "$KEYTOOL" -exportcert -keystore "$KEYSTORE" -storetype PKCS12 \
    -storepass "$PASS" -alias "$KEY_ALIAS" 2>/dev/null \
    | "$SHA256SUM" | cut -d' ' -f1 | tr 'a-f' 'A-F'
)
[ ${#FINGERPRINT} -eq 64 ] || die "could not read the certificate out of $KEYSTORE"

# --------------------------------------------------------------- the index

# Prints the document to $1; fails the script on any non-2xx, and prints what
# the app said about the build so the journal has more than a status code.
fetch_index() {
  local out=$1 query=$2 code
  code=$("$CURL" -sS -H "x-store-admin-token: $TOKEN" \
           --max-time 3600 -D "$WORK/headers" -o "$out" \
           -w '%{http_code}' "$BASE/api/fdroid/index-v1$query") \
    || die "index$query: curl failed"
  [ "$code" = "200" ] || die "index$query: HTTP $code — $(head -c 300 "$out")"

  local apps packages skipped pruned
  apps=$(sed -n 's/^[Xx]-[Ii]ndex-[Aa]pps: *//p' "$WORK/headers" | tr -d '\r')
  packages=$(sed -n 's/^[Xx]-[Ii]ndex-[Pp]ackages: *//p' "$WORK/headers" | tr -d '\r')
  pruned=$(sed -n 's/^[Xx]-[Ii]ndex-[Pp]runed: *//p' "$WORK/headers" | tr -d '\r')
  skipped=$(sed -n 's/^[Xx]-[Ii]ndex-[Ss]kipped: *//p' "$WORK/headers" | tr -d '\r')
  say "$3: ${apps:-?} apps, ${packages:-?} files${pruned:+, $pruned stale cache rows dropped}"
  [ -n "$skipped" ] && say "$3: left out — $skipped"
  return 0
}

# One jar: zip the document, sign it, and move it into place in one step.
#
# `jar` writes META-INF/MANIFEST.MF itself and jarsigner adds the digests and
# the signature block beside it — which is exactly what an F-Droid client
# verifies before it reads a byte of the index. SHA-256 throughout: this JDK
# refuses to sign with SHA-1 at all, and every Android version that can run a
# current client has read SHA-256 jar signatures since forever.
build_jar() {
  local variant=$1 doc=$2 dest="$STATE/$1"
  local staged="$WORK/$variant.jar"

  "$JAR" --create --file "$staged" -C "$(dirname "$doc")" index-v1.json
  "$JARSIGNER" -keystore "$KEYSTORE" -storetype PKCS12 \
    -storepass "$PASS" -keypass "$PASS" \
    -digestalg SHA-256 -sigalg SHA256withRSA \
    "$staged" "$KEY_ALIAS" >/dev/null
  # Refuse to publish something a client would reject.
  "$JARSIGNER" -verify -keystore "$KEYSTORE" -storetype PKCS12 \
    -storepass "$PASS" "$staged" >/dev/null \
    || die "$variant: the jar this run produced does not verify"

  mkdir -p "$dest"
  # Same filesystem, so the replacement is atomic: a phone fetching the index
  # at this moment gets the old jar whole or the new one whole, never half.
  mv -f "$staged" "$dest/index-v1.jar"
  chmod 644 "$dest/index-v1.jar"
  say "$variant: published $(stat -c%s "$dest/index-v1.jar") bytes"
}

# The full shelf first, and it is the one that prunes: only this build looks
# at every APK, so only this one can tell which cache rows are for files that
# are gone. The filtered build reuses the cache that one just warmed, which is
# why it is second and why it costs seconds rather than minutes.
mkdir -p "$WORK/all" "$WORK/clean"
fetch_index "$WORK/all/index-v1.json"   "?adults=1&prune=1" all
fetch_index "$WORK/clean/index-v1.json" ""                  clean

build_jar all   "$WORK/all/index-v1.json"
build_jar clean "$WORK/clean/index-v1.json"

# Last, and only once both jars are in place: the fingerprint is what Settings
# shows people to paste into a client, and it should not name a key whose
# repository failed to publish.
printf '%s\n' "$FINGERPRINT" > "$STATE/fingerprint.txt"
chmod 644 "$STATE/fingerprint.txt"
say "fingerprint $FINGERPRINT"
