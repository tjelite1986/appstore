/**
 * Where the store's files live. Nothing reads from disk yet — this is the
 * layout-only build — but the paths are pinned here so the feature work has a
 * single file to open, and so nothing hard-codes a path inline later.
 *
 * Host root: /srv/appstore/library
 *
 *   apks/         <slug>/<version>/<file>.apk|.xapk   the served binaries
 *   icons/        <slug>.png                          app icon
 *   banners/      <slug>.jpg                          wide header image
 *   screenshots/  <slug>/<n>.jpg                      detail-page gallery
 *   meta/         <slug>.json                         catalog entry (name,
 *                                                     tagline, description,
 *                                                     category, versions)
 *   _import/                                          drop zone: new APKs
 *   _import/_review/                                  parked, needs a decision
 *
 * In a container this is one bind mount at STORE_ROOT, so the subdirectories
 * stay relative to it and nothing outside this file needs to know the host
 * path.
 */
export const STORE_ROOT = process.env.STORE_ROOT ?? "/srv/appstore/library";

export const STORE_DIRS = {
  apks: "apks",
  icons: "icons",
  banners: "banners",
  screenshots: "screenshots",
  meta: "meta",
  import: "_import",
  review: "_import/_review",
} as const;
