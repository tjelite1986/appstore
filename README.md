# App Store

A standalone store front for the APK archive — the section that used to live
inside elite-v2 at `/store`, rebuilt as its own app.

**This build is layout only.** There is no database, no auth, no importer and no
API. Every app on screen comes from `lib/catalog.ts`, a hand-written placeholder
catalog, and every button is a shape. The point is to judge the layout before
any of it is wired up.

## Running it

```
npm install
npm run dev      # http://localhost:3030
```

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

## Storage

Files live outside the repo, under one root:

```
/srv/appstore/library
├── apks/         <slug>/<version>/<file>.apk|.xapk
├── icons/        <slug>.png
├── banners/      <slug>.jpg
├── screenshots/  <slug>/<n>.jpg
├── meta/         <slug>.json
└── _import/      drop zone; _review/ holds what needs a decision
```

`lib/storage.ts` is the only place those paths are named. Nothing reads from
disk yet — it exists so the feature work has one file to open, and so no path
gets hard-coded inline later. Override the root with `STORE_ROOT`.

## What is deliberately missing

Auth, a database, the APK importer and manifest parser, signature verification,
the external sources (GitHub / F-Droid / Play / APKPure / mod sites), the update
checker, the Telegram feed, downloads, reviews, and the 18+ gate. All of that
exists in elite-v2 and is the next conversation, not this one.
