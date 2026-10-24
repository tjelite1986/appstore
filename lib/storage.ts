/**
 * Where the store's files live. Nothing reads from disk yet — this is the
 * layout-only build — but the paths are pinned here so the feature work has a
 * single file to open, and so nothing hard-codes a path inline later.
 *
 * Host root: wherever `STORE_ROOT` points — a directory outside this
 * repository, bind-mounted at /store in the container.
 *
 *   apks/         <slug>/<version>/<file>.apk|.xapk   the served binaries, and
 *                                                     any .obb/.zip game data
 *                                                     beside them
 *   icons/        <slug>.png                          app icon
 *   banners/      <slug>.jpg                          wide header image
 *   screenshots/  <slug>/<n>.jpg                      detail-page gallery
 *   meta/         <slug>.json                         catalog entry (name,
 *                                                     tagline, description,
 *                                                     category, versions)
 *   mods/         <game>/game.json                    a game mods are for
 *                 <game>/<mod>/mod.json               one mod's words
 *                 <game>/<mod>/files/<file>.zip       its downloads
 *   mod-images/   <game>.<ext>, <game>/<mod>.<ext>    game cover, mod picture
 *   _import/                                          drop zone: new APKs
 *   _import/_review/                                  parked, needs a decision
 *   _import/_uploads/                                 OBB/cache and mod
 *                                                     uploads in progress
 *   _state/                                           bookkeeping, not content
 *                                                     (the Telegram cursor)
 *
 * In a container this is one bind mount at STORE_ROOT, so the subdirectories
 * stay relative to it and nothing outside this file needs to know the host
 * path.
 */
export const STORE_ROOT = process.env.STORE_ROOT ?? "/store";

/**
 * The same library as the machine outside the container sees it.
 *
 * Manage tells people where to drop APKs, and inside Docker `STORE_ROOT` is
 * `/store` — a path that does not exist on the host doing the dropping. Only
 * for display; nothing reads or writes through it.
 */
export const STORE_HOST_ROOT = process.env.STORE_HOST_ROOT ?? STORE_ROOT;

export const STORE_DIRS = {
  apks: "apks",
  icons: "icons",
  banners: "banners",
  screenshots: "screenshots",
  meta: "meta",
  /** Game mods — kept apart from apps, and never in an F-Droid index. */
  mods: "mods",
  modImages: "mod-images",
  import: "_import",
  review: "_import/_review",
  /** Uploads still arriving in chunks — see lib/chunks.ts. */
  uploads: "_import/_uploads",
  /** Not content — where a feature keeps its own bookkeeping. */
  state: "_state",
} as const;
