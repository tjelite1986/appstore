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

## The library

```
/srv/appstore/library
├── apks/         <slug>/<version>/<file>.apk|.xapk
├── icons/        <slug>.png
├── banners/      <slug>.jpg
├── screenshots/  <slug>/<n>.jpg
├── meta/         <slug>.json
└── _import/      drop zone; _review/ holds what needs a decision
```

`lib/storage.ts` is the only place those paths are named; `lib/store.ts` is the
only thing that reads them. Override the root with `STORE_ROOT`.

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

The library is mounted read-only at `/store` (`STORE_ROOT=/store`). The
importer will need that `:ro` dropped.

## What is deliberately missing

Auth is the open design question, and everything below waits on it or on the
importer:

- **Per-user state.** Installed, Saved and Updates are facts about a person.
  Off a real library they are empty, and the screens say so. The Install,
  Save and Share buttons are still shapes — Install on the detail page is not:
  it is a link to the APK.
- **The importer.** `_import/` is counted on Manage and otherwise untouched.
  Manifest parsing, signature verification and the external sources
  (GitHub / F-Droid / Play / APKPure / mod sites) all still live in elite-v2.
- **Reviews, ratings and the 18+ gate.** `rating` and `ratingCount` are read
  from meta and shown; nothing collects them.
- **The update checker and the Telegram feed.**
