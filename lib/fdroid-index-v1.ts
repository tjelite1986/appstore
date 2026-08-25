/**
 * The library as a *signed* F-Droid repository index.
 *
 * `lib/fdroid-index.ts` writes the old `index.xml` for Obtainium, which asks
 * for nothing it cannot answer from the catalog. This file writes the format
 * a real F-Droid client reads — `index-v1.json`, the payload of a signed
 * `index-v1.jar` — and it exists for the one thing Obtainium cannot do:
 * notice an app that was not already on the phone. A subscribed client lists
 * the whole repository, so a new app on the shelf simply appears.
 *
 * Two costs come with that, and both shape what is below.
 *
 * The first is bytes. A client verifies its download against the index's
 * SHA-256 and keys versions on `versionCode`, so every APK has to be opened.
 * That goes through `lib/apk-facts.ts`, which caches on (path, size, mtime);
 * a build after a quiet hour reads no APK at all.
 *
 * The second is that the index is *signed*, and a signature cannot be per
 * request. So this produces a whole document, not a response: the host job
 * that owns the repository key asks for one, seals it, and drops the jar
 * where the route can serve it. Which of the two documents — with Adults or
 * without — a client gets is decided by the URL it fetched, exactly as the
 * unsigned index decides it.
 *
 * What a package entry deliberately omits: `minSdkVersion`, `targetSdkVersion`,
 * `nativecode` and `uses-permission`. A client treats an absent minSdk and an
 * empty nativecode list as "compatible with this phone", which is the right
 * answer for a shelf whose APKs were installed by hand anyway, and reading
 * them would mean parsing every manifest past its root element for a field
 * nothing here gates on.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { apkFacts, apkFactsKey } from "./apk-facts";
import { apkFileName } from "./fdroid-index";
import { resolveInStore } from "./serve";
import { STORE_DIRS } from "./storage";
import type { AppVersion, StoreApp } from "./store";

/**
 * The repository-format version this document claims. 20 is what current
 * `fdroidserver` writes for index-v1 and what the clients that read it expect.
 */
const INDEX_V1_VERSION = 20;

export type IndexV1Options = {
  /** Absolute URL of the directory the index is served from. */
  repoUrl: string;
  repoName: string;
  description: string;
};

export type IndexV1Result = {
  /** The document, ready to be zipped into `index-v1.jar`. */
  json: string;
  /** How many apps made it in. */
  apps: number;
  /** How many APK files are listed across all of them. */
  packages: number;
  /**
   * Apps left out, with the reason. Not an error — a listing that links to
   * Play has nothing to serve — but the job that builds this prints it, so a
   * missing app has an answer without anyone opening a database.
   */
  skipped: { slug: string; reason: string }[];
  /** Library-relative paths of every APK that was read or cached this build. */
  seen: Set<string>;
};

type PackageEntry = {
  packageName: string;
  apkName: string;
  versionName: string;
  versionCode: number;
  hash: string;
  hashType: "sha256";
  signer: string;
  size: number;
  added: number;
};

/** F-Droid timestamps are milliseconds; the catalog keeps ISO strings. */
function ms(iso: string): number {
  return Date.parse(iso) || 0;
}

/**
 * One APK, as far as a client is concerned — or null, with why.
 *
 * Three of the four reasons to drop a file are the same shape: the bytes did
 * not answer. An APK with no v2/v3 signing block is dropped rather than listed
 * without a `signer`, because a client that installed it would have nothing to
 * check the *next* version against, which is the one guarantee a repository is
 * supposed to carry.
 */
async function packageFor(
  app: StoreApp,
  version: AppVersion,
  seen: Set<string>
): Promise<{ entry: PackageEntry | null; reason?: string }> {
  const abs = await resolveInStore(
    STORE_DIRS.apks,
    app.slug,
    version.version,
    version.file
  );
  if (!abs) return { entry: null, reason: `${version.version}: file missing` };

  const facts = await apkFacts(abs);
  if (!facts) return { entry: null, reason: `${version.version}: unreadable` };
  seen.add(apkFactsKey(abs));

  if (facts.versionCode === null) {
    return { entry: null, reason: `${version.version}: no versionCode` };
  }
  if (!facts.signer) {
    return { entry: null, reason: `${version.version}: not v2/v3-signed` };
  }

  return {
    entry: {
      packageName: app.packageName!,
      apkName: apkFileName(app, version),
      versionName: version.version,
      versionCode: facts.versionCode,
      hash: facts.sha256,
      hashType: "sha256",
      signer: facts.signer,
      size: version.bytes,
      added: ms(version.added),
    },
  };
}

/**
 * Build the document.
 *
 * `timestamp` is passed in rather than taken from the clock: a client refuses
 * an index older than the one it already has, so the value has to move forward
 * on every publish, and the caller is the one that knows whether this build is
 * a publish or a dry run.
 */
export async function buildIndexV1(
  apps: StoreApp[],
  opts: IndexV1Options & { timestamp: number }
): Promise<IndexV1Result> {
  const skipped: { slug: string; reason: string }[] = [];
  const seen = new Set<string>();

  /**
   * `packages` is keyed on the package id, and nothing in this store promises
   * two listings do not share one. So the id is the unit here, not the slug:
   * the first listing to claim an id describes the app, later ones only add
   * their files. Merging beats dropping — two listings for one id are usually
   * the same app twice, and a client keys on the id either way.
   */
  const order: string[] = [];
  const meta = new Map<string, StoreApp>();
  const files = new Map<string, PackageEntry[]>();

  for (const app of apps) {
    if (!app.packageName) {
      skipped.push({ slug: app.slug, reason: "no package id" });
      continue;
    }
    if (!app.versions.length) {
      skipped.push({ slug: app.slug, reason: "nothing on the shelf" });
      continue;
    }

    const entries: PackageEntry[] = [];
    for (const version of app.versions) {
      const { entry, reason } = await packageFor(app, version, seen);
      if (entry) entries.push(entry);
      else if (reason) skipped.push({ slug: app.slug, reason });
    }
    if (!entries.length) continue;

    const id = app.packageName;
    if (!meta.has(id)) {
      order.push(id);
      meta.set(id, app);
      files.set(id, []);
    }
    files.get(id)!.push(...entries);
  }

  const appList = [];
  const packages: Record<string, PackageEntry[]> = {};
  let packageCount = 0;

  for (const id of order) {
    const app = meta.get(id)!;
    // Newest first, which is the order a client shows and the order it picks
    // a suggestion from. A version code repeated across two listings would be
    // one entry too many, so the first one to claim it wins.
    const byCode = new Map<number, PackageEntry>();
    for (const entry of files.get(id)!) {
      if (!byCode.has(entry.versionCode)) byCode.set(entry.versionCode, entry);
    }
    const entries = [...byCode.values()].sort(
      (a, b) => b.versionCode - a.versionCode
    );

    packages[id] = entries;
    packageCount += entries.length;

    const description = app.description || app.tagline;
    appList.push({
      packageName: id,
      name: app.name,
      summary: app.tagline,
      description,
      // Unknown rather than absent: this store never asks for a licence, and
      // a client renders the string as-is.
      license: "Unknown",
      categories: [app.category],
      authorName: app.developer,
      added: ms(app.added),
      lastUpdated: Math.max(...entries.map((e) => e.added), ms(app.added)),
      suggestedVersionCode: String(entries[0].versionCode),
      suggestedVersionName: entries[0].versionName,
      // Newer clients read the localised block and fall back to the flat
      // fields; older ones only know the flat ones. Both are written, which
      // is what a repository built by fdroidserver looks like too.
      localized: {
        "en-US": { name: app.name, summary: app.tagline, description },
      },
    });
  }

  const index = {
    repo: {
      timestamp: opts.timestamp,
      version: INDEX_V1_VERSION,
      name: opts.repoName,
      // Conventional, and cosmetic: a client that cannot fetch it shows the
      // repository without a picture.
      icon: "icon.png",
      address: opts.repoUrl,
      description: opts.description,
      mirrors: [] as string[],
    },
    // Part of the format. This repository asks nothing of a phone.
    requests: { install: [] as string[], uninstall: [] as string[] },
    apps: appList,
    packages,
  };

  return {
    json: JSON.stringify(index),
    apps: appList.length,
    packages: packageCount,
    skipped,
    seen,
  };
}

/** Where a built jar lives, relative to the library root. */
export const FDROID_STATE_DIR = path.join(STORE_DIRS.state, "fdroid");

/** The two documents that exist, and the directory each one's jar sits in. */
export const INDEX_VARIANTS = ["all", "clean"] as const;
export type IndexVariant = (typeof INDEX_VARIANTS)[number];

export const SIGNED_INDEX_FILE = "index-v1.jar";

/**
 * The repository key's fingerprint, or null before anything has been signed.
 *
 * An F-Droid client takes it on the URL — `?fingerprint=…` — and refuses an
 * index signed by anything else, which is what makes a repository over a home
 * connection worth trusting at all. The signing job writes the file after both
 * jars are in place, so its presence also answers "is there a signed index
 * yet"; that is why the settings row appears with it and not before.
 */
export async function repoFingerprint(): Promise<string | null> {
  const abs = await resolveInStore(FDROID_STATE_DIR, "fingerprint.txt");
  if (!abs) return null;
  try {
    const raw = (await fs.readFile(abs, "utf8")).trim();
    return /^[0-9A-F]{64}$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}
