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
 * Obtainium reads none of them, and each would mean opening every APK on the
 * shelf on every index request — the catalog knows a file's name, size and
 * date without touching its bytes, and this endpoint stays that cheap. A
 * signed `index-v1.jar`, which is what the official F-Droid client and
 * Droid-ify need, would want all three; that is the day to add them.
 */
import type { StoreApp, AppVersion } from "./store";

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
export function apkFileName(app: StoreApp, version: AppVersion): string {
  const ext = version.file.slice(version.file.lastIndexOf("."));
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-");
  return `${safe(app.slug)}_${safe(version.version)}${safe(ext)}`;
}

/** The app and version a requested file name stands for, or null. */
export function findByApkFileName(
  apps: StoreApp[],
  wanted: string
): { app: StoreApp; version: AppVersion } | null {
  for (const app of apps) {
    for (const version of app.versions) {
      if (apkFileName(app, version) === wanted) return { app, version };
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
  const packages = app.versions
    .map(
      (v) => `    <package>
      <version>${xml(v.version)}</version>
      <apkname>${xml(apkFileName(app, v))}</apkname>
      <size>${v.bytes}</size>
      <added>${xml(day(v.added))}</added>
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
