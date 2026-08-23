# App Store

A standalone store front for the APK archive — the section that used to live
inside elite-v2 at `/store`, rebuilt as its own app.

**The catalog is read off disk. There is still no database, no auth and no
importer.** Apps come from the library at `/srv/appstore/library`: the APKs
decide which versions exist, `meta/<slug>.json` supplies the words, and the
images come out of `icons/`, `banners/` and `screenshots/`. Nothing writes to
the library yet — files get there by hand.

## Running it

```
npm install
npm run dev      # http://localhost:3030
```

Point `STORE_ROOT` at a directory to run against a different library.
`STORE_ADMIN_TOKEN` gates the import routes — see below.

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
└── _state/       bookkeeping, not content: the Telegram cursor
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

Discard moves the file to `_import/_discarded/` rather than deleting it, as
does a version folder's previous binary when one is replaced. A wrong click on
a 200 MB APK should not be final; the folder is trivial to empty by hand.

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

There is no login yet, and the store answers on a public hostname, so the write
routes — the import scan, the review decisions and the Telegram sync — are
gated on a shared `STORE_ADMIN_TOKEN` (`x-store-admin-token` header). **Unset
means closed**, not open — a missing variable must not read as "no gate
configured, let it through". Manage keeps the token in `localStorage`; a host
timer can post to `/api/import/scan` or `/api/telegram` with the same header.
`lib/admin.ts` is the only file that changes when the auth question is
answered.

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
| `/manage`, `/saved`, `/settings` | sketch (top bar, all three empty) |
| `/app/[slug]` | not drawn; the sketch describes what tapping a cover opens |
| `/category/[cat]` | not drawn; the Categories tiles have to land somewhere |

Installed is no longer a nav destination — it is the "Up to date" section of
Updates.

Search works: it is a plain GET form over the in-memory catalog, so the query
lives in the URL. Every other chip row is still a shape.

## Deploying

Built on the host and bind-mounted into a bare `node:20-slim` — the app has no
native modules, so nothing needs compiling in Docker. Compose lives in
`compose/appstore/`.

```
npm run build && docker restart appstore
```

The library is mounted at `/store` (`STORE_ROOT=/store`), writable since the
importer landed, and the container runs as uid 1000 so imported files keep the
same ownership as the rest of the tree. A compose change — a volume, or
`STORE_ADMIN_TOKEN` in the `.env` beside it — needs `docker compose up -d` from
the compose dir instead of a restart.

## What is deliberately missing

Auth is the open design question, and everything below waits on it or on the
importer:

- **Per-user state.** Installed, Saved and Updates are facts about a person.
  Off a real library they are empty, and the screens say so. The Install,
  Save and Share buttons are still shapes — Install on the detail page is not:
  it is a link to the APK.
- **A scheduler.** The scan and the Telegram sync run when someone asks for
  one. elite-v2 ran them as jobs every 300 s and 15 min; here they want a host
  timer posting to `/api/import/scan` and `/api/telegram`.
- **The external sources.** GitHub, F-Droid, Play, APKPure and the mod sites —
  metadata, auto-update and downloads — all still live in elite-v2. Manage's
  "Add an app" form and the source toggles are the layout for them.
- **Editorial metadata on import.** A created app gets a name, a package id and
  a pinned signer. Category, tagline, description, icon and screenshots are
  still hand-written into `meta/<slug>.json` and the media folders. Note too
  that the manifest's `versionName` is the version, so two builds of one
  release — elitev3 kept Instagram Piko as `439.0.0.37.89-1` and `-3` — land
  as the same version and the second is a `duplicate` decision.
- **Reviews, ratings and the 18+ gate.** `rating` and `ratingCount` are read
  from meta and shown; nothing collects them.
- **The update checker and the Telegram feed.**
