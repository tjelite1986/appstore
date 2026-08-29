/**
 * The library as an F-Droid repository index.
 *
 * This is the machine-readable face of the store, and it exists for exactly
 * one reader: Obtainium's "third-party F-Droid repo" source. That source is
 * worth designing for because it costs no client — a phone installs stock
 * Obtainium, adds one URL, and gets search, per-app version tracking,
 * background update checks and the session installer, none of which we then
 * have to write or keep working.
 *
 * It reads the *old* index format — `index.xml`, F-Droid's v0 — not
 * `index-v1.json`, and it reads it with an HTML parser rather than an XML one
 * (`lib/app_sources/fdroidrepo.dart` calls `html.parse`). Two consequences
 * shape what is written below:
 *
 *   - No void HTML elements. `<source>` is one, and F-Droid's v0 uses it at
 *     application level; an HTML parser would close it immediately and the
 *     nesting after it would be wrong. Nothing here needs it, so it is gone,
 *     along with the other tags v0 fills in with nothing.
 *   - Everything is escaped as XML anyway, because a real F-Droid tool may
 *     read this later and because an app name is not trusted markup.
 *
 * What is deliberately *not* here: `<hash>`, `<versioncode>` and `<sig>`.
 * Obtainium reads none of them, and each would mean *hashing* every APK on the
 * shelf on every index request. The catalog knows a file's name, size, date
 * and ABIs without that — the last of those is read from the zip's central
 * directory and cached — so this endpoint stays cheap. A signed
 * `index-v1.jar`, which is what the official F-Droid client and Droid-ify
 * need, would want all three; that is the day to add them.
 */
import { abiKey } from "./apk-abi";
import type { AppVersion, AppVersionFile, StoreApp } from "./store";

/** The one repository-format version this file claims to speak. */
const INDEX_VERSION = 18;

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** `<tag>escaped</tag>`, or nothing at all when there is no value. */
function tag(name: string, value: string | undefined | null): string {
  return value ? `    <${name}>${xml(value)}</${name}>` : "";
}

/**
 * The file name a client will ask for.
 *
 * F-Droid names an APK `<packageId>_<versionCode>.apk`; this store has neither
 * a version code it stores nor a guarantee that two apps carry different
 * package ids, so it names the file after the two things that *do* identify a
 * download here — the slug and the version, which is exactly the pair
 * `/api/download/<slug>?v=` takes.
 *
 * The name is never parsed back apart. The route looks it up against the same
 * generated names, so a slug or version holding a character this strips can
 * only ever collide with itself, and the newest matching version wins.
 */
export function apkFileName(
  app: StoreApp,
  version: AppVersion,
  build: AppVersionFile = version.files[0]
): string {
  const ext = build.file.slice(build.file.lastIndexOf("."));
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-");
  // A version with one build keeps the name it has always had — a client that
  // cached the old one still resolves it. A version with several needs the
  // builds told apart, and the ABI set is what tells them apart: it is what
  // the index calls them and the one thing that is different about them.
  const variant =
    version.files.length > 1 ? `_${safe(abiKey(build.abis))}` : "";
  return `${safe(app.slug)}_${safe(version.version)}${variant}${safe(ext)}`;
}

/** The app, version and build a requested file name stands for, or null. */
export function findByApkFileName(
  apps: StoreApp[],
  wanted: string
): { app: StoreApp; version: AppVersion; build: AppVersionFile } | null {
  for (const app of apps) {
    for (const version of app.versions) {
      for (const build of version.files) {
        if (apkFileName(app, version, build) === wanted) {
          return { app, version, build };
        }
      }
    }
  }
  return null;
}

/** F-Droid dates are plain days; the catalog keeps full ISO timestamps. */
function day(iso: string): string {
  return iso.slice(0, 10);
}

export type IndexOptions = {
  /** Absolute URL of the directory this index is served from. */
  repoUrl: string;
  repoName: string;
  description: string;
  /** Milliseconds. F-Droid clients use it to skip an unchanged index. */
  timestamp: number;
};

/**
 * One `<application>` per app that can actually be installed from here.
 *
 * An app with no APK on the shelf is skipped — a listing linked to Play or to
 * a GitHub release has nothing for a client to download from this host. So is
 * an app with no package id: Obtainium keys the app it tracks on that id and
 * matches it against what is installed on the phone, so an entry identified by
 * anything else would install once and then never notice its own updates.
 */
function application(app: StoreApp, latest: AppVersion): string {
  // One entry per file, not per version: a release published as separate
  // arm64 and arm32 APKs is two downloads under one version number. The
  // store's own order is kept, so the build a client takes when it reads no
  // further — Obtainium takes the first — is the one this store would hand a
  // phone anyway. `nativecode` is the one field here that costs nothing to
  // fill and changes what a careful client installs, so it is filled.
  const packages = app.versions
    .flatMap((v) => v.files.map((f) => ({ v, f })))
    .map(
      ({ v, f }) => `    <package>
      <version>${xml(v.version)}</version>
      <apkname>${xml(apkFileName(app, v, f))}</apkname>
      <size>${f.bytes}</size>
      <added>${xml(day(f.added))}</added>${
        f.abis.length
          ? `\n      <nativecode>${xml(f.abis.join(","))}</nativecode>`
          : ""
      }
    </package>`
    )
    .join("\n");

  return [
    `  <application id="${xml(app.packageName!)}">`,
    tag("id", app.packageName),
    tag("name", app.name),
    tag("summary", app.tagline),
    tag("desc", app.description || app.tagline),
    tag("license", "Unknown"),
    tag("category", app.category),
    tag("categories", app.category),
    tag("author", app.developer),
    tag("added", day(app.added)),
    tag("lastupdated", day(latest.added)),
    tag("marketversion", latest.version),
    packages,
    `  </application>`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildIndexXml(apps: StoreApp[], opts: IndexOptions): string {
  const applications = apps
    .filter((app) => app.packageName && app.versions.length > 0)
    .map((app) => application(app, app.versions[0]))
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<fdroid>
  <repo name="${xml(opts.repoName)}" icon="" url="${xml(opts.repoUrl)}" version="${INDEX_VERSION}" timestamp="${opts.timestamp}">
    <description>${xml(opts.description)}</description>
  </repo>
${applications}
</fdroid>
`;
}

/* --------------------------------------------------- the Obtainium import */

/**
 * The shelf as an Obtainium export file.
 *
 * Adding apps one at a time is fine for one app and absurd for thirty: the
 * client's search dialog is hardcoded to `onlyOneSelectionAllowed`, so a
 * repository cannot hand it a batch no matter what the index says. Its
 * import/export file can, and it is the only route in that names the source
 * explicitly — which this one has to, because Obtainium's F-Droid repo source
 * sets `neverAutoSelect`: hand it a bare URL list and it picks the generic
 * HTML scraper instead, which would try to read `index.xml` as a web page.
 * `overrideSource` is what skips that guess.
 *
 * Written to the oldest shape the importer still accepts — a bare array of
 * apps, no `schemaVersion` — so it does not claim a schema version whose
 * migrations this file has never seen. Two fields are JSON *inside* JSON
 * (`apkUrls`, `additionalSettings`); that is the format, not a mistake.
 */
export function buildObtainiumImport(
  apps: StoreApp[],
  repoUrl: string
): string {
  const entries = apps
    .filter((app) => app.packageName && app.versions.length > 0)
    .map((app) => {
      const latest = app.versions[0];
      const id = app.packageName!;
      return {
        id,
        // The `appId` query parameter is the one Obtainium's F-Droid source
        // keeps; everything else it strips before it looks the app up.
        url: `${repoUrl}?appId=${encodeURIComponent(id)}`,
        author: app.developer,
        name: app.name,
        // What is on the phone is the phone's business — the importer fills
        // this in from the installed package before it saves anything.
        installedVersion: null,
        latestVersion: latest.version,
        apkUrls: JSON.stringify([
          [apkFileName(app, latest), `${repoUrl}/${apkFileName(app, latest)}`],
        ]),
        preferredApkIndex: 0,
        additionalSettings: JSON.stringify({
          appIdOrName: id,
          trySelectingSuggestedVersionCode: true,
        }),
        lastUpdateCheck: null,
        pinned: false,
        categories: ["App Store"],
        overrideSource: "FDroidRepo",
        allowIdChange: false,
      };
    });

  return JSON.stringify(entries, null, 2);
}
