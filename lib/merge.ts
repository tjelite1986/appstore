/**
 * Folding one listing into another.
 *
 * The store keys a listing on its slug and an *app* on nothing at all, so the
 * same program can end up on the shelf twice. It happens on purpose: a second
 * signer of one package id cannot be offered as an update to the first, so the
 * review queue gives it its own slug rather than refusing the file — see
 * `create-new` in `lib/import.ts`. What the queue has no way to know is that
 * the two are the same app to a person reading the catalog, and the pair then
 * sits there as `xnxx` and `xnxx-2`, one with the pictures and one with the
 * newer binary.
 *
 * This is the way back. Everything the source listing holds moves to the
 * target — versions, artwork, the words nobody had written on the other side —
 * and the source is taken off the shelf. Nothing is unlinked: what does not
 * move is archived under `_import/_discarded/<slug>/`, because a merge is a
 * judgement call and the losing half of one should still be on disk.
 *
 * Two rules are not negotiable, and both exist because the alternative is
 * silent:
 *
 *   - **The gate wins.** Folding an Adults listing into one filed anywhere
 *     else re-files the target as Adults. `withoutAdults` filters on the
 *     category alone, so the other direction would publish an adult binary to
 *     a signed-out visitor.
 *   - **A signer is never repointed by accident.** Where the two listings
 *     pinned different certificates the merge stops and asks which one the
 *     merged listing keeps. The binaries themselves are unaffected — both stay
 *     downloadable — but a device that installed one cannot update to the
 *     other, and that is a sentence someone has to read before, not after.
 *
 * The F-Droid half of the store already works this way: `collectShelf` keys on
 * the package id and folds several listings into one entry, so the repository
 * has been serving these two as one app the whole time. This makes the catalog
 * agree with it.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { STORE_DIRS, STORE_ROOT } from "./storage";
import { DISCARD_DIR, readMetaRaw, writeMeta } from "./import";
import {
  ADULT_CATEGORY,
  compareVersions,
  getCatalog,
  invalidateCatalog,
  type Category,
  type StoreApp,
} from "./store";
import { db } from "./db";

/**
 * A refusal with the answer's shape already decided.
 *
 * 400 for a request that is wrong — a slug that names nothing, an app merged
 * into itself. 409 for one that is well formed and waiting on a decision, so
 * the panel can tell "you typed something impossible" from "answer the signer
 * question and send it again".
 */
export class MergeError extends Error {
  constructor(message: string, readonly status: 400 | 409 = 400) {
    super(message);
  }
}

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif"];

/**
 * Keys the fill step will not copy, whatever the source holds.
 *
 *   hidden   a source kept off the shelf must not take the target off it
 *   added    the target's first-seen date is derived from its own files, and
 *            an explicit one from the other listing would overwrite that with
 *            a date about different files
 *   category decided by the gate rule below, not by "is it missing"
 *   signingCert  decided by the caller — see `SignerChoice`
 */
const NEVER_FILLED = ["hidden", "added", "category", "signingCert"];

/** What to do when the two listings pinned different certificates. */
export type SignerChoice = "keep" | "adopt";

export type MergeVersion = {
  version: string;
  /** Every binary in the version directory — a release can hold one per ABI. */
  files: string[];
  /** The target already serves this version — the source's copy is archived. */
  taken: boolean;
};

export type MergePlan = {
  from: MergeSide;
  into: MergeSide;
  /** Newest first, the same order the catalog lists them in. */
  versions: MergeVersion[];
  /** What moves across, counting only what the target does not already have. */
  artwork: { icon: boolean; banner: boolean; screenshots: number };
  /** Meta keys the target has no value for that the source can fill. */
  fills: string[];
  /** Set when the two pinned different certificates. Answer it with `signer`. */
  signerConflict: { from: string; into: string } | null;
  /** Set when the merge re-files the target — the gate rule. */
  refiles: Category | null;
  /** Rows in the per-user tables that point at the source slug. */
  users: { saved: number; installed: number };
};

export type MergeSide = {
  slug: string;
  name: string;
  category: Category;
  packageName?: string;
  signingCert?: string;
  versions: number;
};

export type MergeResult = MergePlan & {
  /** The versions that actually moved, newest first. */
  moved: string[];
  /** Archived instead of moved, because the target already had them. */
  archived: string[];
  /** Where the source's leftovers went, relative to the store root. */
  archive: string;
  /** Listings whose `family` or `requires` named the source and now name the target. */
  repointed: string[];
};

/* ------------------------------------------------------------------- disk */

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.stat(abs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move a file or a directory.
 *
 * Everything here is under one bind mount, so `rename` is the whole story in
 * practice — but the fallback covers a library later split across two disks,
 * where a merge that failed halfway would leave an app in two places.
 */
async function move(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.rename(src, dest);
  } catch {
    await fs.cp(src, dest, { recursive: true });
    await fs.rm(src, { recursive: true, force: true });
  }
}

/** `dest`, with "-2", "-3" … before `ext`, until nothing is there. */
async function freePath(dest: string, ext = ""): Promise<string> {
  const stem = ext && dest.endsWith(ext) ? dest.slice(0, -ext.length) : dest;
  let candidate = dest;
  for (let n = 2; await exists(candidate); n++) candidate = `${stem}-${n}${ext}`;
  return candidate;
}

/** `<slug>.<ext>` in a flat image directory, or nothing. */
async function imageFile(dir: string, slug: string): Promise<string | null> {
  for (const ext of IMAGE_EXTENSIONS) {
    if (await exists(path.join(STORE_ROOT, dir, slug + ext))) return slug + ext;
  }
  return null;
}

/** The images in `screenshots/<slug>/`, in the order the catalog reads them. */
async function screenshotFiles(slug: string): Promise<string[]> {
  const abs = path.join(STORE_ROOT, STORE_DIRS.screenshots, slug);
  try {
    return (await fs.readdir(abs))
      .filter((f) => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()))
      .sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
      );
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------- plan */

function side(app: StoreApp): MergeSide {
  return {
    slug: app.slug,
    name: app.name,
    category: app.category,
    packageName: app.packageName,
    signingCert: app.signingCert,
    versions: app.versions.length,
  };
}

/**
 * Both listings, or a refusal saying which half is not there.
 *
 * The catalog is the lookup on purpose: a slug that is not in it is not a
 * folder either, so an admin cannot reach a path outside the library by
 * typing one — the strings never meet `path.join` unless an app answered to
 * them.
 */
async function pair(from: string, into: string): Promise<[StoreApp, StoreApp]> {
  if (from === into) throw new MergeError("An app cannot be merged into itself");

  const { apps, placeholder } = await getCatalog();
  if (placeholder) {
    throw new MergeError("The library is empty — there is nothing to merge");
  }
  const source = apps.find((a) => a.slug === from);
  if (!source) throw new MergeError(`No such app: ${from}`);
  const target = apps.find((a) => a.slug === into);
  if (!target) throw new MergeError(`No such app: ${into}`);
  return [source, target];
}

/** How many per-user rows name a slug. */
function userRows(slug: string): { saved: number; installed: number } {
  const conn = db();
  const count = (table: string) =>
    (
      conn
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE slug = ?`)
        .get(slug) as { n: number }
    ).n;
  return { saved: count("user_saved"), installed: count("user_installed") };
}

/**
 * What a merge would do, without doing any of it.
 *
 * The UI shows this before the button that runs it, and `mergeApps` runs it
 * again for itself — a plan read a minute ago is a claim about a directory
 * anyone could have written to since.
 */
export async function planMerge(from: string, into: string): Promise<MergePlan> {
  const [source, target] = await pair(from, into);

  const held = new Set(target.versions.map((v) => v.version));
  const versions: MergeVersion[] = source.versions.map((v) => ({
    version: v.version,
    files: v.files.map((f) => f.file),
    taken: held.has(v.version),
  }));

  const [fromIcon, intoIcon, fromBanner, intoBanner, fromShots, intoShots] =
    await Promise.all([
      imageFile(STORE_DIRS.icons, from),
      imageFile(STORE_DIRS.icons, into),
      imageFile(STORE_DIRS.banners, from),
      imageFile(STORE_DIRS.banners, into),
      screenshotFiles(from),
      screenshotFiles(into),
    ]);

  const sourceMeta = await readMetaRaw(from);
  const targetMeta = await readMetaRaw(into);
  const fills = Object.keys(sourceMeta).filter((key) => {
    if (NEVER_FILLED.includes(key)) return false;
    const have = targetMeta[key];
    return have === undefined || have === null || have === "";
  });

  const signerConflict =
    source.signingCert && target.signingCert &&
    source.signingCert !== target.signingCert
      ? { from: source.signingCert, into: target.signingCert }
      : null;

  return {
    from: side(source),
    into: side(target),
    versions,
    artwork: {
      icon: Boolean(fromIcon) && !intoIcon,
      banner: Boolean(fromBanner) && !intoBanner,
      screenshots: intoShots.length ? 0 : fromShots.length,
    },
    fills,
    signerConflict,
    refiles:
      source.category === ADULT_CATEGORY && target.category !== ADULT_CATEGORY
        ? ADULT_CATEGORY
        : targetMeta.category === undefined && sourceMeta.category !== undefined
          ? source.category
          : null,
    users: userRows(from),
  };
}

/* ------------------------------------------------------------------ apply */

/**
 * Follow the moved binaries in the fact cache.
 *
 * Both caches keyed on a file — `apk_facts` and `apk_abis` — are keyed on the
 * path relative to the store root, and an `apk_facts` row is a SHA-256 of a
 * file measured in hundreds of megabytes. A rename keeps the size and the
 * mtime the rows are validated against, so re-pointing the key keeps them warm
 * — the alternative is the next index build re-hashing the whole merged app,
 * which on this machine is minutes of disk for an answer that has not changed.
 */
function followFacts(moves: { fromKey: string; toKey: string }[]): void {
  if (!moves.length) return;
  const conn = db();
  const tables = ["apk_facts", "apk_abis"] as const;
  const update = tables.map((t) =>
    conn.prepare(`UPDATE ${t} SET path = ? WHERE path = ?`)
  );
  // A row may already exist for the destination if that exact file was ever
  // there before; the old key is then simply dropped.
  const drop = tables.map((t) =>
    conn.prepare(`DELETE FROM ${t} WHERE path = ?`)
  );
  conn.transaction(() => {
    for (const m of moves) {
      for (let i = 0; i < tables.length; i++) {
        try {
          update[i].run(m.toKey, m.fromKey);
        } catch {
          drop[i].run(m.fromKey);
        }
      }
    }
  })();
}

/**
 * Move what one account did with the source app onto the target.
 *
 * Both tables are keyed `(user_id, slug)`, so a person who had a row for each
 * listing cannot keep both. Saved collapses — it is a yes either way. Installed
 * keeps the newer of the two versions: the row exists to answer "is there an
 * update waiting", and claiming the older one would offer an update the person
 * has already taken.
 */
function moveUserRows(from: string, into: string): void {
  const conn = db();
  conn.transaction(() => {
    conn
      .prepare(
        `INSERT OR IGNORE INTO user_saved (user_id, slug, saved_at)
         SELECT user_id, ?, saved_at FROM user_saved WHERE slug = ?`
      )
      .run(into, from);
    conn.prepare("DELETE FROM user_saved WHERE slug = ?").run(from);

    const rows = conn
      .prepare(
        "SELECT user_id, version, installed_at FROM user_installed WHERE slug = ?"
      )
      .all(from) as { user_id: number; version: string; installed_at: string }[];
    const held = conn.prepare(
      "SELECT version FROM user_installed WHERE user_id = ? AND slug = ?"
    );
    const put = conn.prepare(
      `INSERT INTO user_installed (user_id, slug, version, installed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, slug) DO UPDATE SET version      = excluded.version,
                                                 installed_at = excluded.installed_at`
    );
    for (const row of rows) {
      const mine = held.get(row.user_id, into) as { version: string } | undefined;
      // compareVersions sorts newest first, so < 0 means the incoming one wins.
      if (!mine || compareVersions(row.version, mine.version) < 0) {
        put.run(row.user_id, into, row.version, row.installed_at);
      }
    }
    conn.prepare("DELETE FROM user_installed WHERE slug = ?").run(from);
  })();
}

/**
 * Do it.
 *
 * The order matters in one place: the binaries move before the meta file is
 * written, so a merge that dies halfway leaves the versions on the target with
 * the source's meta file still describing an app whose folder is now empty —
 * recoverable by hand, and visible. The other order would leave a listing
 * claiming files it does not have.
 */
export async function mergeApps(
  from: string,
  into: string,
  opts: { signer?: SignerChoice } = {}
): Promise<MergeResult> {
  const plan = await planMerge(from, into);

  if (plan.signerConflict && !opts.signer) {
    throw new MergeError(
      "These two listings pinned different signing certificates — say which one the merged app keeps",
      409
    );
  }

  const archiveDir = path.join(DISCARD_DIR, from);
  const archiveRel = path.relative(STORE_ROOT, archiveDir);
  const moved: string[] = [];
  const archived: string[] = [];
  const facts: { fromKey: string; toKey: string }[] = [];

  /* ---- binaries */
  for (const v of plan.versions) {
    const src = path.join(STORE_ROOT, STORE_DIRS.apks, from, v.version);
    if (v.taken) {
      await move(src, await freePath(path.join(archiveDir, v.version)));
      archived.push(v.version);
      continue;
    }
    const dest = path.join(STORE_ROOT, STORE_DIRS.apks, into, v.version);
    await move(src, dest);
    // One entry per binary: the directory moves in one call, but the cache is
    // keyed per file, and a version can hold several builds.
    for (const file of v.files) {
      facts.push({
        fromKey: path.join(STORE_DIRS.apks, from, v.version, file),
        toKey: path.join(STORE_DIRS.apks, into, v.version, file),
      });
    }
    moved.push(v.version);
  }
  // Empty now, unless something arrived in it mid-merge — in which case
  // leaving it is the honest answer, and the catalog will keep showing it.
  await fs
    .rmdir(path.join(STORE_ROOT, STORE_DIRS.apks, from))
    .catch(() => undefined);

  /* ---- artwork */
  for (const [dir, kind] of [
    [STORE_DIRS.icons, "icon"],
    [STORE_DIRS.banners, "banner"],
  ] as const) {
    const file = await imageFile(dir, from);
    if (!file) continue;
    const ext = path.extname(file);
    const src = path.join(STORE_ROOT, dir, file);
    const wanted = plan.artwork[kind];
    await move(
      src,
      wanted
        ? path.join(STORE_ROOT, dir, into + ext)
        : await freePath(path.join(archiveDir, kind + ext), ext)
    );
  }

  const shots = await screenshotFiles(from);
  if (shots.length) {
    const src = path.join(STORE_ROOT, STORE_DIRS.screenshots, from);
    await move(
      src,
      plan.artwork.screenshots
        ? path.join(STORE_ROOT, STORE_DIRS.screenshots, into)
        : await freePath(path.join(archiveDir, "screenshots"))
    );
  }

  /* ---- words */
  const sourceMeta = await readMetaRaw(from);
  const patch: Record<string, unknown> = {};
  for (const key of plan.fills) patch[key] = sourceMeta[key];
  if (plan.refiles) patch.category = plan.refiles;
  if (plan.signerConflict && opts.signer === "adopt") {
    patch.signingCert = plan.signerConflict.from;
  } else if (!plan.signerConflict && !plan.into.signingCert && plan.from.signingCert) {
    patch.signingCert = plan.from.signingCert;
  }
  if (Object.keys(patch).length) await writeMeta(into, patch);

  /* ---- the source listing itself */
  const metaFile = path.join(STORE_ROOT, STORE_DIRS.meta, `${from}.json`);
  if (await exists(metaFile)) {
    await move(metaFile, await freePath(path.join(archiveDir, "meta.json"), ".json"));
  }

  const repointed = await repointSlug(from, into);

  followFacts(facts);
  moveUserRows(from, into);
  invalidateCatalog();

  return { ...plan, moved, archived, archive: archiveRel, repointed };
}

/**
 * Every other listing that named the source by slug now names the target.
 *
 * `family` and `requires` are written by hand and point at slugs. Archiving
 * the source's meta file leaves those pointers dangling, and the catalog's
 * answer to a dangling one is to drop it: a family whose head was merged
 * away explodes into one card per member, and a companion whose host was
 * merged away walks back onto the shelf as an ordinary app. So they follow
 * the merge — including the target's own file, which can end up naming
 * itself (a head merged into one of its members makes that member the head,
 * which is what `family === slug` means) or requiring itself (dropped).
 */
async function repointSlug(from: string, into: string): Promise<string[]> {
  const dir = path.join(STORE_ROOT, STORE_DIRS.meta);
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const touched: string[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const slug = path.basename(name, ".json");
    if (slug === from) continue;
    const meta = await readMetaRaw(slug);
    const patch: Record<string, unknown> = {};
    if (meta.family === from) patch.family = into;
    if (Array.isArray(meta.requires) && meta.requires.includes(from)) {
      const requires = [...new Set(meta.requires.map((h) => (h === from ? into : h)))]
        .filter((h) => h !== slug);
      patch.requires = requires;
    }
    if (!Object.keys(patch).length) continue;
    await writeMeta(slug, patch);
    touched.push(slug);
  }
  return touched;
}

/**
 * Listings that describe the same package.
 *
 * The duplicate this feature exists for is invisible until something looks for
 * it: two rows in a catalog of a hundred, alphabetically adjacent only by
 * luck. Groups of one are not returned — the answer is "nothing to merge",
 * not a list of every app.
 */
export function duplicatePackages(
  apps: StoreApp[]
): { packageName: string; apps: StoreApp[] }[] {
  const groups = new Map<string, StoreApp[]>();
  for (const app of apps) {
    if (!app.packageName) continue;
    const list = groups.get(app.packageName);
    if (list) list.push(app);
    else groups.set(app.packageName, [app]);
  }
  return [...groups]
    .filter(([, list]) => list.length > 1)
    .map(([packageName, list]) => ({ packageName, apps: list }))
    .sort((a, b) => a.apps[0].name.localeCompare(b.apps[0].name));
}
