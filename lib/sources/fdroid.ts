/**
 * F-Droid, as a source of words, pictures and binaries.
 *
 * The repository publishes a full index, and it is tens of megabytes — far
 * too much to fetch to answer one question about one app. Two smaller doors
 * do the job instead: `/api/v1/packages/<id>` lists the versions of a single
 * package, and the app's own page carries the name, the summary, the long
 * description and the icon in its markup. Neither is a documented contract,
 * so everything except the version list is best-effort: an app that arrives
 * with no description is still worth having.
 *
 * The APK URL is a convention rather than an API — `<repo>/<package>_<code>.apk`
 * — which is why the download is checked for being a zip before anything
 * trusts it.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { STORE_DIRS, STORE_ROOT } from "@/lib/storage";
import { uniqueSlug, writeMeta } from "@/lib/import";
import { getApps, invalidateCatalog, type StoreApp } from "@/lib/store";
import { saveImage, USER_AGENT } from "@/lib/sources/net";
import { installFromUrl, type InstalledVersion } from "@/lib/sources/install";

const REPO_URL = process.env.FDROID_REPO_URL ?? "https://f-droid.org/repo";
const SITE_URL = REPO_URL.replace(/\/repo\/?$/, "");
const TIMEOUT_MS = 20_000;

export type FdroidVersion = { versionName: string; versionCode: number };

export type FdroidApp = {
  packageId: string;
  name: string;
  summary: string | null;
  description: string | null;
  iconUrl: string | null;
  /** The developer's own phone screenshots, in the order the page lists them. */
  screenshotUrls: string[];
  /** The build the repository recommends — not always the highest one. */
  suggestedVersionCode: number;
  versions: FdroidVersion[];
};

/** A package id, or the F-Droid page URL that carries one. */
export function parsePackageId(input: string): string | null {
  const s = input.trim();
  const fromUrl = s.match(/packages\/([a-zA-Z0-9._]+)/);
  const id = fromUrl ? fromUrl[1] : s;
  // A java package id needs at least one dot and no path left in it.
  return /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(id) ? id : null;
}

export function pageUrl(packageId: string): string {
  return `${SITE_URL}/en/packages/${packageId}/`;
}

export function apkUrl(packageId: string, versionCode: number): string {
  return `${REPO_URL}/${packageId}_${versionCode}.apk`;
}

async function fetchVersions(packageId: string): Promise<{
  suggested: number;
  versions: FdroidVersion[];
}> {
  const res = await fetch(`${SITE_URL}/api/v1/packages/${packageId}`, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (res.status === 404) throw new Error("F-Droid has no such package");
  if (!res.ok) throw new Error(`F-Droid answered HTTP ${res.status}`);

  const body = (await res.json()) as {
    suggestedVersionCode?: number;
    packages?: { versionName?: string; versionCode?: number }[];
  };
  const versions = (body.packages ?? [])
    .filter((p) => typeof p.versionCode === "number")
    .map((p) => ({
      versionName: String(p.versionName ?? ""),
      versionCode: Number(p.versionCode),
    }))
    .sort((a, b) => b.versionCode - a.versionCode);

  if (versions.length === 0) throw new Error("That package has no builds");
  return { suggested: Number(body.suggestedVersionCode ?? 0), versions };
}

function ogTag(html: string, property: string): string | null {
  const m = html.match(
    new RegExp(
      `<meta[^>]+property=["']og:${property}["'][^>]+content=["']([^"']+)["']`,
      "i"
    )
  );
  return m ? decodeEntities(m[1]) : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

/**
 * The screenshots off a package page.
 *
 * F-Droid serves what the app's own repository put in
 * `fastlane/metadata/android/<locale>/images/phoneScreenshots`, under a URL
 * that says so. Matching on that path rather than on the carousel's markup is
 * the stabler half of the page: the class names are a theme, the repo layout
 * is the format every Android project publishes in.
 */
function readScreenshots(html: string): string[] {
  const found = html.matchAll(
    /src=["'](https:\/\/[^"']*\/phoneScreenshots\/[^"']+)["']/gi
  );
  const urls = [...found].map((m) => decodeEntities(m[1]));
  return [...new Set(urls)];
}

/**
 * The description block, as text.
 *
 * F-Droid writes it as HTML with links and lists in it. Bullets are kept as
 * "* " because the detail page renders the description as plain text and a
 * list that has lost its markers reads as one run-on sentence.
 */
function readDescription(html: string): string | null {
  const m = html.match(/<div class="package-description"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return null;
  const text = decodeEntities(
    m[1]
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "* ")
      .replace(/<\/(p|div|li|ul|ol)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

/** Versions from the API, everything else from the page — page failures are fine. */
export async function fetchApp(packageId: string): Promise<FdroidApp> {
  const { suggested, versions } = await fetchVersions(packageId);

  let name = packageId;
  let summary: string | null = null;
  let description: string | null = null;
  let iconUrl: string | null = null;
  let screenshotUrls: string[] = [];
  try {
    const res = await fetch(pageUrl(packageId), {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) {
      const html = await res.text();
      name = (ogTag(html, "title") ?? packageId).replace(/\s*\|\s*F-Droid.*$/i, "");
      summary = ogTag(html, "description");
      description = readDescription(html);
      iconUrl = ogTag(html, "image");
      screenshotUrls = readScreenshots(html);
    }
  } catch (err) {
    console.error(`[fdroid] no page for ${packageId}:`, err);
  }

  return {
    packageId,
    name: name.trim() || packageId,
    summary,
    description,
    iconUrl,
    screenshotUrls,
    suggestedVersionCode: suggested,
    versions,
  };
}

/** The build to install: the repository's own recommendation, else the newest. */
export function buildToInstall(app: FdroidApp): FdroidVersion {
  return (
    app.versions.find((v) => v.versionCode === app.suggestedVersionCode) ??
    app.versions[0]
  );
}

export type FdroidAddResult = {
  slug: string;
  name: string;
  packageId: string;
  icon: boolean;
  installed: InstalledVersion;
};

/**
 * Add an F-Droid package to the catalog and install its recommended build.
 *
 * Refuses a package the catalog already carries, for the same reason the Play
 * source does: the importer matches a dropped file on the package id, and two
 * entries claiming one id make every later drop ambiguous.
 */
export async function addFromFdroid(input: string): Promise<FdroidAddResult> {
  const packageId = parsePackageId(input);
  if (!packageId) {
    throw new Error("Enter a package id, or paste the F-Droid page URL");
  }

  const clash = (await getApps()).find(
    (a) => a.packageName?.toLowerCase() === packageId.toLowerCase()
  );
  if (clash) {
    throw new Error(`${clash.name} is already in the catalog as "${clash.slug}"`);
  }

  const app = await fetchApp(packageId);
  const build = buildToInstall(app);
  const slug = await uniqueSlug(app.name);

  await writeMeta(slug, {
    name: app.name,
    packageName: packageId,
    category: "Other",
    tagline: app.summary ?? undefined,
    description: app.description ?? undefined,
    source: {
      kind: "fdroid",
      url: pageUrl(packageId),
      package: packageId,
      // The build that was taken, so an update check can tell "nothing new"
      // from "the same file under a different version string".
      releaseTag: String(build.versionCode),
      addedFrom: "manage/add",
    },
  });
  invalidateCatalog();

  const icon = app.iconUrl
    ? await saveImage(
        app.iconUrl,
        path.join(STORE_ROOT, STORE_DIRS.icons, slug),
        "fdroid"
      )
    : false;

  let installed: InstalledVersion;
  try {
    installed = await installFromUrl(slug, apkUrl(packageId, build.versionCode), {
      fileName: `${packageId}_${build.versionCode}.apk`,
      tag: "fdroid",
      fallbackVersion: build.versionName || null,
    });
  } catch (err) {
    // Nothing arrived, so nothing should be left claiming it did.
    await fs
      .unlink(path.join(STORE_ROOT, STORE_DIRS.meta, `${slug}.json`))
      .catch(() => {});
    invalidateCatalog();
    throw err;
  }

  invalidateCatalog();
  return { slug, name: app.name, packageId, icon, installed };
}

/** What the repository has now. Null when the app is not from F-Droid. */
export async function checkFdroid(app: StoreApp): Promise<FdroidApp | null> {
  const packageId = app.source?.kind === "fdroid" ? app.source.package : null;
  if (!packageId) return null;
  return fetchApp(packageId);
}
