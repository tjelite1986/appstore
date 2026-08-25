/**
 * The shelf, projected onto what a repository index needs from it.
 *
 * Two index formats are published — `index-v1.json` and `index-v2.json` — and
 * they disagree about almost everything in shape while agreeing completely
 * about facts: which listings have a package id and an APK on this host, what
 * each file hashes to, which key signed it, what version code it carries.
 * That agreement is the whole point of this file. Two copies of it would
 * eventually publish two different catalogs under one signature, and the one
 * that drifted would be the one nobody was reading that week.
 *
 * The expensive half is `lib/apk-facts.ts`, which opens an APK once and then
 * caches on (path, size, mtime). Both documents are built in the same job, so
 * the second one costs a stat per file.
 */
import { apkFacts, apkFactsKey } from "./apk-facts";
import { apkFileName } from "./fdroid-index";
import { resolveInStore } from "./serve";
import { STORE_DIRS } from "./storage";
import type { AppVersion, StoreApp } from "./store";

/** One APK, as far as any index format is concerned. */
export type PackageEntry = {
  packageName: string;
  apkName: string;
  versionName: string;
  versionCode: number;
  /** SHA-256 of the file, lower-case hex. */
  hash: string;
  /** SHA-256 of the signing certificate, lower-case hex. */
  signer: string;
  size: number;
  added: number;
};

/** One package id, the listing that describes it, and its files. */
export type ShelfPackage = {
  id: string;
  app: StoreApp;
  /** Deduplicated on version code, newest first. */
  entries: PackageEntry[];
};

export type Shelf = {
  packages: ShelfPackage[];
  /**
   * Listings and files left out, with the reason. Not an error — a listing
   * that links to Play has nothing to serve — but the job that builds an
   * index prints it, so a missing app has an answer without anyone opening a
   * database.
   */
  skipped: { slug: string; reason: string }[];
  /** Library-relative paths of every APK that was read or cached this build. */
  seen: Set<string>;
};

/** F-Droid timestamps are milliseconds; the catalog keeps ISO strings. */
export function ms(iso: string): number {
  return Date.parse(iso) || 0;
}

/**
 * The icon's file name, as a client will ask for it — or null.
 *
 * The catalog carries the icon as a ready-made URL into `/api/media`, because
 * that is what a browser needs; a repository index needs the bare name, and
 * the client puts it together with an address of its own choosing. Rather
 * than reach into the library a second time and risk disagreeing with the
 * catalog about which file an app's icon is, the name is taken back out of
 * that URL — it is the last segment, before the cache-busting query.
 */
export function iconName(app: StoreApp): string | null {
  if (!app.icon) return null;
  const withoutQuery = app.icon.split("?")[0];
  const last = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
  // The catalog percent-encodes each segment on the way in.
  const decoded = (() => {
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  })();
  // A name a client cannot ask for cleanly is no name at all: the route looks
  // it up against the library, so anything with a separator in it would be a
  // path rather than a file.
  return decoded && !decoded.includes("/") ? decoded : null;
}

/**
 * One APK, read from its bytes — or null, with why.
 *
 * Three of the four reasons to drop a file are the same shape: the bytes did
 * not answer. An APK with no v2/v3 signing block is dropped rather than listed
 * without a signer, because a client that installed it would have nothing to
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
      signer: facts.signer,
      size: version.bytes,
      added: ms(version.added),
    },
  };
}

/**
 * Read the shelf.
 *
 * Both index formats key on the package id, and nothing in this store promises
 * two listings do not share one. So the id is the unit here, not the slug: the
 * first listing to claim an id describes the app, later ones only add their
 * files. Merging beats dropping — two listings for one id are usually the same
 * app twice, and a client keys on the id either way.
 */
export async function collectShelf(apps: StoreApp[]): Promise<Shelf> {
  const skipped: { slug: string; reason: string }[] = [];
  const seen = new Set<string>();

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

  const packages: ShelfPackage[] = order.map((id) => {
    // Newest first, which is the order a client shows and the order it picks
    // a suggestion from. A version code repeated across two listings would be
    // one entry too many, so the first one to claim it wins.
    const byCode = new Map<number, PackageEntry>();
    for (const entry of files.get(id)!) {
      if (!byCode.has(entry.versionCode)) byCode.set(entry.versionCode, entry);
    }
    return {
      id,
      app: meta.get(id)!,
      entries: [...byCode.values()].sort(
        (a, b) => b.versionCode - a.versionCode
      ),
    };
  });

  return { packages, skipped, seen };
}
