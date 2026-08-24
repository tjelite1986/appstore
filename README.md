# App Store

A standalone store front for the APK archive — the section that used to live
inside elite-v2 at `/store`, rebuilt as its own app.

**The catalog is read off disk. There is still no database of its own.** Apps come from the library at `/srv/appstore/library`: the APKs
decide which versions exist, `meta/<slug>.json` supplies the words, and the
images come out of `icons/`, `banners/` and `screenshots/`. Nothing writes to
the library yet — files get there by hand.

## Running it

```
npm install
npm run dev      # http://localhost:3030
```

Point `STORE_ROOT` at a directory to run against a different library.
`ELITE_VERIFY_URL` and `STORE_ADMIN_TOKEN` gate the import routes — see below.

## The library

```
/srv/appstore/library
├── apks/         <slug>/<version>/<file>.apk|.xapk
├── icons/        <slug>.png
├── banners/      <slug>.jpg
├── screenshots/  <slug>/<n>.jpg
├── meta/         <slug>.json
├── _import/      drop zone; _review/ holds what needs a decision,
│                 _discarded/ what was rejected
└── _state/       bookkeeping, not content: the Telegram cursor and
                  store.db, the per-account saved/installed rows
```

`lib/storage.ts` is the only place those paths are named; `lib/store.ts` reads
the content half and `lib/import.ts` is the only thing that writes any of it.
Override the root with `STORE_ROOT`; `STORE_HOST_ROOT` is what Manage shows
people, since inside Docker the root is `/store` and that is not a path they
can drop a file into.

**An app is a slug with an `apks/<slug>/` directory, a `meta/<slug>.json`, or
both.** A folder of APKs with no meta file still appears — named after its slug,
developer "Unknown" — so a fresh drop is visible before anyone has written a
description for it. A meta file with no APKs appears too, with no download.

Every field of a meta file is optional:

```json
{
  "name": "Photo Editor Pro",
  "developer": "Lumen Labs",
  "category": "Editor",
  "tagline": "Layers, masks and curves on your phone",
  "description": "The long text on the detail page.",
  "packageName": "com.lumen.photoeditor",
  "rating": 4.6,
  "ratingCount": 128,
  "added": "2026-08-20T09:00:00Z",
  "hidden": false
}
```

`category` is matched case-insensitively against the six the sketch names;
anything else lands in **Other**, whose tile only appears while something is in
it. `added` overrides the date derived from the files. `hidden` keeps an app out
of the catalog without deleting it. A meta file that will not parse is logged
and skipped — the app still appears if it has APKs, and disappears if it does
not.

Sizes, versions and dates are never read from meta: they are the files. The
newest version by numeric comparison is the one the catalog shows, and the rest
stay reachable under "Older versions" on the detail page — that is what an
archive is for.

The catalog is cached in process for 10 seconds (`STORE_CACHE_MS`), so a page
load does not restat the whole library and a new import shows up on its own.

### When the library is empty

Every screen would be blank, which says nothing about whether the layout works,
so `lib/catalog.ts` — the hand-written stand-in from the layout build — takes
over until the first real app lands. Manage says which of the two is showing.

## The importer

Drop `.apk` / `.xapk` files in `_import/` and press **Scan now** on Manage (or
`POST /api/import/scan`). This is the only part of the app that writes to the
library, which is why the mount is no longer read-only.

For each file the scan reads the *real* identity out of the binary
`AndroidManifest.xml` — package id, versionName, versionCode — with no aapt
involved: `lib/apk-manifest.ts` walks the zip's central directory and inflates
only the manifest entry, so a 244 MB APK costs a few windowed reads rather than
244 MB of RAM. `lib/apk-verify.ts` pulls the signer certificate out of the APK
Signing Block (v2/v3) and hashes it — the same fingerprint `apksigner` reports.
The filename is parsed too, as a fallback and as a corrective: a mod APK that
declares `versionName` "9999" so it never looks outdated loses to the version
in its own name.

Then it decides, and the decision is deliberately narrow:

| | |
|---|---|
| package id matches exactly one app | attach |
| every non-noise name token is covered by exactly one app | attach |
| anything else | park it in `_import/_review/` |

"Noise" is the release-name vocabulary that says nothing about *which* app it
is — Pro, Mod, Premium, Unlocked, v2, the site credit in the filename — so
`CCleaner Pro v26.12.1 - androforever.com.apk` still finds CCleaner.

Attaching moves the file to `apks/<slug>/<version>/` and fills the two gaps in
`meta/<slug>.json` that are facts about the binary — `packageName` and
`signingCert` — without touching anything a person wrote there. The signer is
trust-on-first-use: the first APK pins the certificate, and a later drop signed
with a **different key is refused**, because that is how a repackaged APK would
take over an app someone has already installed. Only an explicit *Attach
anyway* from the review queue re-pins it.

A file younger than 60 seconds is left alone — a Samba or SFTP drop appears in
the directory at its first byte, and importing half an APK would park a corrupt
file with a plausible-looking entry.

### The review queue

A parked file gets a `.json` sidecar beside it holding what the scan worked
out. The sidecar *is* the queue — there is no index to drift out of sync with
the folder — and its file name is the item's identity. Manage lists them with
the reasons spelled out (`no_match`, `ambiguous`, `duplicate`,
`signer_mismatch`) and offers: attach to a suggested or chosen app, create a
new app from the drop, or discard.

The sidecar records what the file *is*; who it might be is worked out again on
every read. A verdict of "no app looks like this" is a statement about the
catalog at the moment the file landed, and the catalog is at its emptiest
exactly then — a queue that kept the old answer would insist there is nothing
to attach to long after the app was added. An item that now resolves is listed
as `now_matches` with the target preselected; nothing is moved by a read.

Discard moves the file to `_import/_discarded/` rather than deleting it, as
does a version folder's previous binary when one is replaced. A wrong click on
a 200 MB APK should not be final; the folder is trivial to empty by hand.

### Adding an app from a source

Manage's "Add an app" takes one address and works out who it belongs to
(`lib/sources/detect.ts`): a github.com URL or `owner/name` is GitHub, an
f-droid.org page is F-Droid, and anything else is a Play search. A bare package
id could be either store, so both ways stay one click apart rather than being
guessed at.

The three differ in one way that decides everything else — whether they hand
out binaries.

| Source | Words and pictures | The APK |
|--------|--------------------|---------|
| Google Play | name, description, icon, banner, screenshots | never |
| GitHub releases | repo name and description | newest release with an APK |
| F-Droid | name, summary, full description, icon | the recommended build |

An app added from GitHub or F-Droid therefore arrives complete: the file is
downloaded, checked and on the shelf before the request answers. The download
is staged under `_import/_sources/` and handed to `attachApk` — the importer
owns the signer pin and the layout under `apks/`, and a source may not talk its
way past a signer mismatch any more than a dropped file can. What lands is
named from the manifest inside the APK, not from the release tag: the two
disagree often, and a tag is what the author called the release.

Two hazards get the same treatment in both directions (`lib/sources/net.ts`):
`content-length` is a claim, so bytes are counted as they arrive, and a login
page is served with HTTP 200 like anything else, so a download is checked for
being a zip before anything trusts it.

#### Play, in particular

Play (`google-play-scraper`, `lib/sources/play.ts`) turns a listing into
`meta/<slug>.json` plus `icons/`, `banners/` and up to eight `screenshots/`.
**No APK is ever fetched** — Google does not serve them to anyone but the Play
client, and this store hosts what it was given.

So what it creates is an entry with no versions: a shelf with the label already
printed. That is the useful part. The importer matches a drop on its package
id, and an empty catalog is exactly why every download parks as "no matching
app" — describing the app first is what lets the next one attach itself.

A package already in the catalog is refused rather than added twice: two rows
for one package id read as ambiguous to the matcher, which would quietly stop
*every* future drop of that app from attaching.

Play's genres map onto the store's own categories in a small table, and the
guess is meant to be overridden by hand in the meta file. Nothing maps to
Adults — Play has no such listings.

Search results are admin-gated, the outbound request included: it is made in
this server's name, and an open one is a scraping proxy. Their icons come
through `/api/sources/play/icon`, because the CSP is `img-src 'self'` and
widening it for one admin screen would weaken every page.

A Play listing keeps no download button on its detail page — it links to Play
instead, and the stat cell says "On Play" rather than dressing an upstream
version up as one this library holds.

### Keeping a source up to date

The Sources card on Manage counts the apps each source carries and asks them
what they have now (`lib/sources/updates.ts`, `GET /api/sources/check`).
Fetching is a separate button, named after what the check found: a check is a
handful of API calls, a fetch is every new release downloaded over a home line.

"Newer" is decided by the upstream's own name for a release — a GitHub tag, an
F-Droid version code — which each install records in `source.releaseTag`.
Comparing version strings instead would re-fetch the same 200 MB file every six
hours, because the manifest rarely says what the tag says.

`appstore-sources.timer` runs the same thing with `install` on, every six
hours. `GITHUB_TOKEN` in the compose env file is worth setting once more than a
handful of repositories are watched: anonymous GitHub requests are 60 an hour
for the whole machine, and that limit is the first thing a timer hits.

### The Telegram feed

A public channel posts APKs; `lib/telegram.ts` pulls the new ones into
`_import/` and the importer takes over from there. **Sync now** on Manage, or
`POST /api/telegram`.

MTProto with a *user* session, not the Bot API and not a bot: `getFile` caps a
bot at 20 MB and the channel posts 100–200 MB files. Credentials come from the
environment — `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`,
`TELEGRAM_CHANNELS` — and an empty session makes the sync a no-op rather than
an error. The session string is made once by `scripts/telegram-login.mjs` over
in elite-v2; this app never logs in.

`POST` returns as soon as the run starts. A run downloads up to five files of
up to 400 MB and then sits out the importer's 60-second quiet period before
scanning, which is minutes — no proxy would hold that request open. Progress is
read back with `GET`, and Manage polls it while a run is going.

The cursor and the file ledger live in `_state/telegram.json` (elite-v2 kept
them in two SQLite tables; this is the only thing in the standalone store that
wanted a database). Written through a temp file and renamed, because a
half-written state file reads as *no* state — which would reset every cursor
and re-download the channel. A first sync looks only at the newest 20 posts;
after that the cursor drives it, oldest-first, so a run cut short by the file
cap resumes where it stopped. Failed transfers sit behind the cursor and are
retried by message id for three runs.

**elite-v2 syncs the same channel on its own 15-minute job.** The two carry
independent cursors, so both download the same posts into their own libraries.
That is a decision to make, not a bug here.

### Who may run it

The store answers on a public hostname, and the write routes — the import scan,
the review decisions and the Telegram sync — move and discard files. Browsing
and downloading need nothing; those three need an admin.

**A person signs in to elite-v2.** The store shares that login rather than
keeping accounts of its own: elite-v2 scopes its session cookie to
`.example.com` (`SESSION_COOKIE_DOMAIN` there), so a browser logged in at
accounts.example.com sends the same cookie to store.example.com. Verifying it
locally would take elite-v2's signing secret and would still miss a revoked
session — that row is in elite-v2's database — so the token goes back to
`POST /api/auth/verify` (`ELITE_VERIFY_URL`, the container name over the
traefik network) and comes back as an account. `role === "admin"` opens the
routes; answers are cached 30 s. Manage tries this first and only shows a
token form when it comes back 401.

A cookie is the one credential a browser attaches on its own, so writes
authenticated that way also have to come from this store's own pages: the
`Origin` on an unsafe method must match the host. `SameSite=lax` is not enough
on its own here — every host under `example.com` counts as the same site, so a
sibling service, or a file this store serves back, would otherwise be trusted.
Reads skip the check; a cross-site navigation cannot read what it gets.

**A timer sends a token.** `scripts/cron.sh` has no browser and no session, so
`STORE_ADMIN_TOKEN` stays as the machine credential in the
`x-store-admin-token` header.

**Unset means closed**, not open — with neither configured the routes refuse
everything, because a missing variable must not read as "no gate configured,
let it through". `lib/admin.ts` and `lib/sso.ts` are the whole of it.

## Serving files

The library is outside the repo, so `public/` cannot reach it and two route
handlers do the work instead:

| Route | Serves |
|---|---|
| `/api/media/<dir>/<file>` | icons, banners and screenshots — and nothing else: `meta/` and `apks/` are not reachable through it |
| `/api/download/<slug>?v=<version>` | the APK, `Content-Disposition` set, `Range` honoured so an interrupted phone download resumes |

Media URLs carry `?v=<mtime>` and are served `immutable`: replacing an icon
changes its URL, so nothing serves stale bytes under a fresh name. Both handlers
resolve the path and refuse anything that lands outside `STORE_ROOT`, symlinks
included. The version in a download URL is looked up in the catalog rather than
trusted from the query string.

## What an account keeps

Everything a person can *see* about an app is a file — that is the point of the
library, and it is why the catalog is a directory tree rather than a database.
What a person *did* is not like that. Saving an app and marking one installed
are per-account facts with no natural file to live in, they are written far
more often than the catalog changes, and two tabs can write them at the same
moment. So there is one small SQLite database, `_state/store.db`, holding two
tables keyed on the elite-v2 account id (`lib/db.ts`):

| Table | Row |
|---|---|
| `user_saved` | this account keeps this slug |
| `user_installed` | this account has *this version* of this slug |

The version in `user_installed` is the whole reason that table is not a flag.
An update is derived, never stored: the library knows the newest file, the row
knows what the person took, and Updates lists the apps where the first is newer
than the second (`lib/user-state.ts`). Nothing has to be recomputed when an APK
lands — the next read simply answers differently.

Nothing here can see the phone, so "installed" is a claim the person makes on
the detail page rather than something discovered, and the UI says so. The
routes still check it: a version that is not in the library is refused, or an
app could sit on Updates forever claiming an update it already has.

`user_id` is elite-v2's id with no foreign key to point it at — identity is
resolved over HTTP, so this database cannot enforce it. An account deleted over
there leaves rows nothing will ask for again; Settings offers to drop the ones
belonging to the account that is looking.

The per-user controls are absent for a signed-out visitor rather than present
and inert. Browsing never needed a login and still does not; a bookmark that
silently keeps nothing is a worse answer than no bookmark.

| Route | Does |
|---|---|
| `GET /api/me` | who is here, plus their saved slugs and installed versions |
| `DELETE /api/me` | forget everything about this account |
| `POST /api/me/saved` | `{ slug, saved }` — the state to end in, not a toggle |
| `POST /api/me/installed` | `{ slug, version }`, or `version: null` to forget |

Writes take any signed-in account, not just an admin (`requireUser` in
`lib/admin.ts`), and still require a same-origin `Origin` — `SameSite=lax` does
not separate two hosts under one parent domain. The shared admin token is
deliberately not accepted: it belongs to the timers, and a timer is not a
person.

## Where it comes from

The layout follows `code/docs/elitev3/app-store.json`, a Layout Studio export.
That file is the spec: it fixes the chrome, the screen list, the block order on
Home and the theme (dark, blue `#2563eb`, plum background, 4px radius, roomy
density, system sans). `lib/theme.ts` re-declares those tokens as CSS custom
properties with the same names Layout Studio uses, so a block here and the same
block in the sketch resolve to identical colours and spacing.

`docs/` is not in this repo — it is local working space.

### Where this diverges from the sketch, and why

- **Shelf columns.** The sketch asks for 6 columns (Recently Added) and 4
  (Communication). At 390px with roomy density that is a 40px cover. The sketch
  number is kept as the widescreen column count and the grid steps down on
  narrow screens.
- **Carousel card width.** The sketch sets 80px, which at 16:9 is an 80×45 card
  — narrower than the text under it. 80px is kept as the phone width and the
  card grows from `sm:` up.
- **Changelog heading.** Layout Studio's changelog block has no title field, so
  the sketch could not give it one. "What's new" was added so the section does
  not read as a stray list between two headed sections.
- **Material Symbols.** The sketch names three (`ms.handyman`,
  `ms.videogame_asset`, `ms.deployed_code_update`). Bundling a second icon font
  for three glyphs is not worth a self-hosted font file, so the nearest lucide
  equivalents stand in.
- **App icon in the top bar.** The sketch sets `appIcon: "home"` — a house next
  to the word APPSTORE. Kept as drawn; likely worth a second look.
- **Empty blocks are skipped.** A real library fills up unevenly, and a heading
  over an empty grid reads as a bug, so Home only renders the sections that have
  something in them.

### Screens

The sketch's five tabs and three top-bar destinations, plus two the sketch
implies but does not draw:

| Route | From |
|---|---|
| `/` Home | sketch, block for block |
| `/apps`, `/games`, `/search`, `/updates` | sketch (only Games carried blocks) |
| `/manage`, `/saved`, `/settings` | sketch (top bar; Saved and the Account block are wired) |
| `/app/[slug]` | not drawn; the sketch describes what tapping a cover opens |
| `/category/[cat]` | not drawn; the Categories tiles have to land somewhere |

Installed is no longer a nav destination — it is the "Up to date" section of
Updates.

Search works: it is a plain GET form over the in-memory catalog, so the query
lives in the URL. Every other chip row is still a shape.

## Deploying

Built on the host and bind-mounted into a bare `node:20-slim`. Compose lives in
`compose/appstore/`.

```
npm run build && docker restart appstore
```

**After any `npm install`, run `npm run rebuild:native` before building.**
`better-sqlite3` is a compiled binary and npm builds it against *this* host —
Ubuntu 24.04, glibc 2.39 — while the container is Debian bookworm on glibc
2.36, so the freshly installed module loads here and fails to load there, and
only there. `rebuild:native` compiles it inside a `node:20-slim` instead; the
result needs nothing newer than glibc 2.34 and works in both places. There is
no image build to catch this: the host's `node_modules` *is* what runs in the
container.

The library is mounted at `/store` (`STORE_ROOT=/store`), writable since the
importer landed, and the container runs as uid 1000 so imported files keep the
same ownership as the rest of the tree. A compose change — a volume,
`ELITE_VERIFY_URL`, or `STORE_ADMIN_TOKEN` in the `.env` beside it — needs
`docker compose up -d` from the compose dir instead of a restart.

### The scheduled jobs

There is no scheduler in the app. Three host timers post into it instead —
`appstore-sync.timer` every 30 min, `appstore-scan.timer` every 15 min and
`appstore-sources.timer` every 6 h — all running `scripts/cron.sh`, which reads
`STORE_ADMIN_TOKEN` out of the compose `.env` so rotating it is one edit. Units
and installation in `scripts/systemd/`; follow a run with
`journalctl -u appstore-sync -f`.

## What is deliberately missing

Sign-in and per-user storage are both answered. What is left:

- **Share.** Still a shape. Install on the detail page never was one — it is a
  link to the APK.
- **APKPure and the mod sites.** Play, GitHub and F-Droid are answered; the
  Cloudflare-gated sites elite-v2 reaches through curl-impersonate are not, and
  neither is the split-XAPK merge an APKPure download needs to be
  tap-installable.
- **Editorial metadata on import.** A created app gets a name, a package id and
  a pinned signer. Category, tagline, description, icon and screenshots are
  still hand-written into `meta/<slug>.json` and the media folders. Note too
  that the manifest's `versionName` is the version, so two builds of one
  release — elitev3 kept Instagram Piko as `439.0.0.37.89-1` and `-3` — land
  as the same version and the second is a `duplicate` decision.
- **Reviews, ratings and the 18+ gate.** `rating` and `ratingCount` are read
  from meta and shown; nothing collects them.
- **Per-app update controls.** The source check is all-or-nothing from Manage;
  there is no "fetch just this one" on an app's own page.
