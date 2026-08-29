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
import { compareVersions } from "./store";
import type { AppVersion, AppVersionFile, StoreApp } from "./store";

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
  /**
   * The ABIs this file carries native code for. Empty means it runs on any
   * phone, which is what both index formats mean by an absent list — so an
   * empty array is written as no field at all rather than as `[]`.
   */
  nativecode: string[];
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
  build: AppVersionFile,
  seen: Set<string>
): Promise<{ entry: PackageEntry | null; reason?: string }> {
  // Which build a reason is about, when a version has more than one — "46.7.5:
  // unreadable" would otherwise name a version that is half on the shelf.
  const where =
    version.files.length > 1
      ? `${version.version} (${build.abi})`
      : version.version;

  const abs = await resolveInStore(
    STORE_DIRS.apks,
    app.slug,
    version.version,
    build.file
  );
  if (!abs) return { entry: null, reason: `${where}: file missing` };

  const facts = await apkFacts(abs);
  if (!facts) return { entry: null, reason: `${where}: unreadable` };
  seen.add(apkFactsKey(abs));

  if (facts.versionCode === null) {
    return { entry: null, reason: `${where}: no versionCode` };
  }
  if (!facts.signer) {
    return { entry: null, reason: `${where}: not v2/v3-signed` };
  }

  return {
    entry: {
      packageName: app.packageName!,
      apkName: apkFileName(app, version, build),
      versionName: version.version,
      versionCode: facts.versionCode,
      hash: facts.sha256,
      signer: facts.signer,
      size: build.bytes,
      added: ms(build.added),
      nativecode: build.abis,
    },
  };
}

/**
 * Which of several listings speaks for a package id.
 *
 * Lowest wins. Being told (`repoHead`) beats being the family's head, which
 * beats holding the newer version, which beats being the fuller archive; the
 * slug is the tiebreak, so the same shelf always publishes the same choice —
 * an index that reshuffled itself between builds would offer a client an
 * "update" that is only a different listing's turn.
 */
function byRepoClaim(a: StoreApp, b: StoreApp): number {
  if (Boolean(a.repoHead) !== Boolean(b.repoHead)) return a.repoHead ? -1 : 1;
  // `family === slug` is the catalog's own "this is the card the shelf shows".
  const aHead = a.family === a.slug;
  const bHead = b.family === b.slug;
  if (aHead !== bHead) return aHead ? -1 : 1;
  const version = compareVersions(a.version, b.version);
  if (version !== 0) return version;
  if (a.versions.length !== b.versions.length) {
    return b.versions.length - a.versions.length;
  }
  return a.slug.localeCompare(b.slug);
}

/**
 * Read the shelf.
 *
 * Both index formats key on the package id, and nothing in this store promises
 * two listings do not share one — the review queue hands a second signer of an
 * id its own slug rather than refusing the file, and a modded build repacked a
 * second time keeps the id it was repacked from. Android's unit is the id, so
 * **a repository publishes one listing per id and this picks which.**
 *
 * The rejected alternative was to merge them: describe the id with whichever
 * listing came first and serve every listing's files under it. It reads as
 * generous and it lies. A person subscribed to this repo sees one name, one
 * icon and one description, and is offered binaries that belong to a different
 * listing behind them — installing "Elitogram" and getting a Piko build. Worse,
 * the modded builds this shelf holds all pin their versionCode to the same
 * near-INT_MAX sentinel to stop Play updating them, so the merged list would
 * silently drop every collision anyway: the losing half was never published,
 * it just was not reported either.
 *
 * So every listing that does not win its id is named in `skipped`, with the
 * winner and the way to overrule it. Where two listings really are the same
 * app twice, the answer is `lib/merge.ts` — fold them, and the id has one
 * claimant again.
 */
export async function collectShelf(apps: StoreApp[]): Promise<Shelf> {
  const skipped: { slug: string; reason: string }[] = [];
  const seen = new Set<string>();

  const order: string[] = [];
  const claimants = new Map<string, StoreApp[]>();

  for (const app of apps) {
    if (!app.packageName) {
      skipped.push({ slug: app.slug, reason: "no package id" });
      continue;
    }
    if (!app.versions.length) {
      skipped.push({ slug: app.slug, reason: "nothing on the shelf" });
      continue;
    }
    const id = app.packageName;
    if (!claimants.has(id)) {
      order.push(id);
      claimants.set(id, []);
    }
    claimants.get(id)!.push(app);
  }

  const packages: ShelfPackage[] = [];

  for (const id of order) {
    const [chosen, ...rest] = [...claimants.get(id)!].sort(byRepoClaim);
    for (const other of rest) {
      skipped.push({
        slug: other.slug,
        reason: `${id} is published as ${chosen.slug} (repoHead overrules)`,
      });
    }

    // Newest first, which is the order a client shows and the order it picks a
    // suggestion from. One listing can still repeat a version code across two
    // of its own versions — the same sentinel on every build of a mod — and a
    // client cannot hold two of those, so the first wins and the loss is said
    // out loud. The key is the code *and* the ABIs, because per-ABI builds of
    // one release commonly share a code, and dropping one of those would leave
    // half the phones that asked with nothing to install.
    const byBuild = new Map<string, PackageEntry>();
    const entries: PackageEntry[] = [];
    for (const version of chosen.versions) {
      // Every build, in the order the catalog ranked them, so a client that
      // reads no further than the first entry for a version gets the one this
      // store would have handed it.
      for (const build of version.files) {
        const { entry, reason } = await packageFor(chosen, version, build, seen);
        if (!entry) {
          if (reason) skipped.push({ slug: chosen.slug, reason });
          continue;
        }
        const key = `${entry.versionCode}|${entry.nativecode.join(",")}`;
        const held = byBuild.get(key);
        if (held) {
          skipped.push({
            slug: chosen.slug,
            reason: `${version.version} (${build.abi}): versionCode ${entry.versionCode} is already published as ${held.versionName}`,
          });
          continue;
        }
        byBuild.set(key, entry);
        entries.push(entry);
      }
    }
    if (!entries.length) continue;

    // A stable sort, so builds of one version keep the order they went in.
    packages.push({
      id,
      app: chosen,
      entries: entries.sort((a, b) => b.versionCode - a.versionCode),
    });
  }

  return { packages, skipped, seen };
}
