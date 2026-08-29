/**
 * Dropping every version of an app but the newest.
 *
 * The library keeps every build it was ever handed — that is what makes it an
 * archive — and a mod that ships a gigabyte a week fills a disk on that
 * promise. This is the one place the promise is broken on purpose: an admin
 * asks, sees the list, and the older version folders go.
 *
 * **These files are deleted, not archived.** Everything else that takes a
 * binary off the shelf moves it under `_import/_discarded/`, because the
 * losing half of a decision might turn out to have been the right one. A
 * prune has no losing half — the point is the space — and moving a gigabyte
 * to a folder nobody reads would free none of it.
 *
 * What "newest" means is the catalog's own answer: `versions[0]` as
 * `readVersions` orders them, which is what the Install button already hands
 * out and what the F-Droid index publishes. Where that answer cannot be
 * trusted the app is skipped rather than guessed at — a mod whose manifest
 * says `9.9.9` so it never looks outdated, or a drop whose version could not
 * be read at all, would otherwise keep the placeholder and lose the real
 * releases.
 *
 * Nothing here reads the catalog for itself: the caller passes the listings
 * it may act on, so the 18+ gate is whatever the caller's already was.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { STORE_DIRS, STORE_ROOT } from "./storage";
import { formatBytes, invalidateCatalog, type StoreApp } from "./store";
import { isPlaceholderVersion } from "./import";

export type PruneVersion = {
  version: string;
  files: string[];
  bytes: number;
};

// Sizes travel formatted as well as counted: the panel is a client component
// and `lib/store` — where the formatter lives — opens with `node:fs`.

export type PruneApp = {
  slug: string;
  name: string;
  /** The version that stays. */
  keep: string;
  /** Oldest last, as the page lists them. */
  drop: PruneVersion[];
  bytes: number;
  size: string;
};

export type PrunePlan = {
  apps: PruneApp[];
  /** Listings with older versions this will not touch, and why. */
  skipped: { slug: string; name: string; reason: string }[];
  versions: number;
  files: number;
  bytes: number;
  size: string;
};

export type PruneResult = PrunePlan & {
  /** `apks/<slug>/<version>` for every folder that is gone. */
  removed: string[];
};

/**
 * Why an app's newest version is not one to trust — or nothing, when it is.
 *
 * "unknown" is what the importer writes when neither the manifest nor the
 * file name said, and it sorts as text, ahead of every number. A placeholder
 * sorts ahead of every real release by design. Both would keep the wrong one.
 */
function untrustedLatest(version: string): string | null {
  if (isPlaceholderVersion(version)) {
    return `newest version is the placeholder ${version}`;
  }
  if (!/\d/.test(version)) {
    return `newest version "${version}" cannot be ranked`;
  }
  return null;
}

/** What a prune of these listings would remove. Reads nothing off disk. */
export function planPrune(apps: StoreApp[]): PrunePlan {
  const plan: PrunePlan = { apps: [], skipped: [], versions: 0, files: 0, bytes: 0, size: "" };
  for (const app of apps) {
    if (app.versions.length < 2) continue;
    const [latest, ...older] = app.versions;
    const reason = untrustedLatest(latest.version);
    if (reason) {
      plan.skipped.push({ slug: app.slug, name: app.name, reason });
      continue;
    }
    const drop = older.map((v) => ({
      version: v.version,
      files: v.files.map((f) => f.file),
      bytes: v.files.reduce((sum, f) => sum + f.bytes, 0),
    }));
    const bytes = drop.reduce((sum, v) => sum + v.bytes, 0);
    plan.apps.push({
      slug: app.slug,
      name: app.name,
      keep: latest.version,
      drop,
      bytes,
      size: formatBytes(bytes),
    });
    plan.versions += drop.length;
    plan.files += drop.reduce((sum, v) => sum + v.files.length, 0);
    plan.bytes += bytes;
  }
  plan.size = formatBytes(plan.bytes);
  return plan;
}

/**
 * Do it.
 *
 * The binaries go one by one and the folder after them, with a plain `rmdir`:
 * a version folder holding something the reader never listed — a stray
 * sidecar, a half-uploaded drop — keeps that thing and stays, which is what
 * `ls` will show whoever wonders. A file that vanished between the plan and
 * the unlink is not an error; it is gone, which was the aim.
 */
export async function pruneOld(apps: StoreApp[]): Promise<PruneResult> {
  const plan = planPrune(apps);
  const removed: string[] = [];
  try {
    for (const app of plan.apps) {
      for (const v of app.drop) {
        const dir = path.join(STORE_ROOT, STORE_DIRS.apks, app.slug, v.version);
        for (const file of v.files) {
          await fs.unlink(path.join(dir, file)).catch((err: NodeJS.ErrnoException) => {
            if (err.code !== "ENOENT") throw err;
          });
        }
        await fs.rmdir(dir).catch(() => undefined);
        removed.push(path.join(STORE_DIRS.apks, app.slug, v.version));
      }
    }
  } finally {
    // Whatever happened, the catalog is describing files that may not exist.
    if (removed.length) invalidateCatalog();
  }
  return { ...plan, removed };
}
