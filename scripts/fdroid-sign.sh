#!/usr/bin/env bash
#
# Publish the store as a signed F-Droid repository.
#
# The other timers are pure HTTP: the work belongs to the app, and the host
# only decides when. This one cannot be, and the reason is the whole design.
# A subscribable F-Droid repository is *signed*, signing needs a JDK, and a
# repository key baked into a container image is a key inside every copy of
# that image. So the split is:
#
#   the app     decides what is in the index — which apps, which files, their
#               hashes, version codes and signers — and hands it over whole
#               (GET /api/fdroid/index-v1, GET /api/fdroid/index-v2)
#   this script owns the key, seals the documents, and drops them where the
#               app can serve them (_state/fdroid/<variant>/)
#
# Both formats are published. A current client — Neo Store, Droid-ify, the
# official one — asks for index-v2's `entry.jar` first and only falls back to
# `index-v1.jar` on a 404, so publishing v2 spares every sync a wasted round
# trip, and keeping v1 costs one document per run and covers the client that
# has not moved.
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

# Inside the library, not /tmp: publishing is a `mv` into $STATE, and a rename
# is only atomic within one filesystem. Here those are two — /tmp is the boot
# device and the library is the 4 TB disk — so a staged file in /tmp would be
# *copied* into place, and a phone fetching the index during that copy would
# read half of it. Under index-v2 that is not even a slow download: the entry
# carries the index's SHA-256, so half a file is a repository the client
# refuses outright.
WORK=$(mktemp -d "$STATE/.build-XXXXXX")
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
#
# Two of those headers are not just for the journal — index-v2's entry has to
# repeat the document's own timestamp and app count — so they are left in
# INDEX_TIMESTAMP and INDEX_APPS for the caller. Globals rather than a return
# value because a function can only hand back a string, and splitting one is
# how a build ends up publishing an entry that describes a different index.
INDEX_TIMESTAMP=
INDEX_APPS=
fetch_index() {
  local out=$1 endpoint=$2 query=$3 label=$4 code
  code=$("$CURL" -sS -H "x-store-admin-token: $TOKEN" \
           --max-time 3600 -D "$WORK/headers" -o "$out" \
           -w '%{http_code}' "$BASE/api/fdroid/$endpoint$query") \
    || die "$endpoint$query: curl failed"
  [ "$code" = "200" ] || die "$endpoint$query: HTTP $code — $(head -c 300 "$out")"

  local packages skipped pruned
  INDEX_APPS=$(sed -n 's/^[Xx]-[Ii]ndex-[Aa]pps: *//p' "$WORK/headers" | tr -d '\r')
  INDEX_TIMESTAMP=$(sed -n 's/^[Xx]-[Ii]ndex-[Tt]imestamp: *//p' "$WORK/headers" | tr -d '\r')
  packages=$(sed -n 's/^[Xx]-[Ii]ndex-[Pp]ackages: *//p' "$WORK/headers" | tr -d '\r')
  pruned=$(sed -n 's/^[Xx]-[Ii]ndex-[Pp]runed: *//p' "$WORK/headers" | tr -d '\r')
  skipped=$(sed -n 's/^[Xx]-[Ii]ndex-[Ss]kipped: *//p' "$WORK/headers" | tr -d '\r')
  say "$label: ${INDEX_APPS:-?} apps, ${packages:-?} files${pruned:+, $pruned stale cache rows dropped}"
  [ -n "$skipped" ] && say "$label: left out — $skipped"
  return 0
}

# Seal one document into a jar under $WORK.
#
# `jar` writes META-INF/MANIFEST.MF itself and jarsigner adds the digests and
# the signature block beside it — which is exactly what an F-Droid client
# verifies before it reads a byte of the index. SHA-256 throughout: this JDK
# refuses to sign with SHA-1 at all, and every Android version that can run a
# current client has read SHA-256 jar signatures since forever.
sign_jar() {
  local staged=$1 doc=$2 label=$3

  "$JAR" --create --file "$staged" -C "$(dirname "$doc")" "$(basename "$doc")"
  "$JARSIGNER" -keystore "$KEYSTORE" -storetype PKCS12 \
    -storepass "$PASS" -keypass "$PASS" \
    -digestalg SHA-256 -sigalg SHA256withRSA \
    "$staged" "$KEY_ALIAS" >/dev/null
  # Refuse to publish something a client would reject.
  "$JARSIGNER" -verify -keystore "$KEYSTORE" -storetype PKCS12 \
    -storepass "$PASS" "$staged" >/dev/null \
    || die "$label: the jar this run produced does not verify"
}

# Move a staged file into the variant's directory. $WORK is inside the library,
# so this is a rename: a phone fetching the file at this moment gets the old
# one whole or the new one whole, never half.
publish() {
  local variant=$1 staged=$2 name=$3 dest="$STATE/$variant"
  mkdir -p "$dest"
  mv -f "$staged" "$dest/$name"
  chmod 644 "$dest/$name"
  say "$variant: published $name, $(stat -c%s "$dest/$name") bytes"
}

# ---------------------------------------------------------------- index-v1

build_v1() {
  local variant=$1 doc=$2
  local staged="$WORK/$variant-index-v1.jar"
  sign_jar "$staged" "$doc" "$variant/v1"
  publish "$variant" "$staged" index-v1.jar
}

# ---------------------------------------------------------------- index-v2
#
# The newer format splits what v1 keeps in one jar: the signature covers a
# small `entry.json` that names the real document and carries its SHA-256 and
# size, and the client fetches that document unsigned and checks it against the
# entry. So this is the one place where the *bytes* the app returned matter and
# not just their meaning — the file is hashed exactly as it arrived and moved
# into place unmodified.
#
# The entry is written here rather than by the app for the same reason the
# signing is: it describes bytes this script produced. It is the only piece of
# index format knowledge out here, and it is four fields.
#
#   timestamp   must equal the one inside index-v2.json — a client compares it
#               with the one it already has to decide whether to download at
#               all, so an entry that disagreed with its index would either
#               re-fetch the shelf forever or never again
#   diffs       empty. A diff is an optimisation for a repository whose index
#               is megabytes; this one is tens of kilobytes, and a client that
#               finds no usable diff simply fetches the whole document.
ENTRY_VERSION=20002

build_v2() {
  local variant=$1 doc=$2 timestamp=$3 apps=$4
  local staged="$WORK/$variant-entry.jar"
  local entry="$WORK/$variant-entry/entry.json"
  local sha size

  [ -n "$timestamp" ] || die "$variant: the index-v2 build reported no timestamp"

  sha=$("$SHA256SUM" "$doc" | cut -d' ' -f1)
  size=$(stat -c%s "$doc")

  mkdir -p "$(dirname "$entry")"
  printf '{"timestamp":%s,"version":%s,"index":{"name":"/index-v2.json","sha256":"%s","size":%s,"numPackages":%s},"diffs":{}}' \
    "$timestamp" "$ENTRY_VERSION" "$sha" "$size" "${apps:-0}" > "$entry"

  sign_jar "$staged" "$entry" "$variant/v2"

  # The index before the entry that vouches for it. Between the two moves a
  # client can read a new index with an old entry, which it rejects on the
  # hash and retries; the other order hands it an entry pointing at bytes that
  # are not there yet, which is the same failure with a worse cache story.
  publish "$variant" "$doc"    index-v2.json
  publish "$variant" "$staged" entry.jar
}

# ------------------------------------------------------------------- build

# The full shelf first, and its v1 build is the one that prunes: only a build
# over every APK can tell which cache rows are for files that are gone, and
# doing it twice would just delete rows the first pass wrote. Every build after
# it reuses the cache that one warmed, which is why they cost seconds.
mkdir -p "$WORK/all" "$WORK/clean"
fetch_index "$WORK/all/index-v1.json"   index-v1 "?adults=1&prune=1" "all/v1"
build_v1 all "$WORK/all/index-v1.json"

fetch_index "$WORK/clean/index-v1.json" index-v1 ""                  "clean/v1"
build_v1 clean "$WORK/clean/index-v1.json"

fetch_index "$WORK/all/index-v2.json"   index-v2 "?adults=1"         "all/v2"
build_v2 all "$WORK/all/index-v2.json" "$INDEX_TIMESTAMP" "$INDEX_APPS"

fetch_index "$WORK/clean/index-v2.json" index-v2 ""                  "clean/v2"
build_v2 clean "$WORK/clean/index-v2.json" "$INDEX_TIMESTAMP" "$INDEX_APPS"

# Last, and only once both jars are in place: the fingerprint is what Settings
# shows people to paste into a client, and it should not name a key whose
# repository failed to publish.
printf '%s\n' "$FINGERPRINT" > "$STATE/fingerprint.txt"
chmod 644 "$STATE/fingerprint.txt"
say "fingerprint $FINGERPRINT"
