/**
 * Taking a whole listing off the shelf.
 *
 * Every version folder, the meta file, the artwork, and what accounts said
 * about the app: saved, installed, file statuses and comments. Like a prune,
 * **this deletes rather than archives** — the owner asked for exactly that,
 * and the point is the same: an app nobody wants should not keep its
 * gigabytes in `_import/_discarded/`, where nobody reads them either. The
 * panel shows the plan first and asks for the name before the button works.
 *
 * Listings that named this one by slug are fixed rather than left dangling.
 * A companion drops it from `requires`. A family whose head goes gets a new
 * head — the first remaining member by slug — so it stays one card; a family
 * left with one member is no family, and that member loses the key.
 *
 * The slug is never taken from the request on its own: the caller looks the
 * app up through the gated catalog and hands over the `StoreApp`, so a string
 * that names no listing never reaches `path.join`.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { STORE_DIRS, STORE_ROOT } from "./storage";
import { readMetaRaw, writeMeta } from "./import";
import { formatBytes, invalidateCatalog, type StoreApp } from "./store";
import { db } from "./db";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif"];

export type RemovePlan = {
  slug: string;
  name: string;
  versions: string[];
  files: number;
  bytes: number;
  size: string;
  /** Per-account rows that go with it. */
  rows: { saved: number; installed: number; statuses: number; comments: number };
  /** Other listings whose `family` or `requires` names this one. */
  relatives: string[];
};

export type RemoveResult = RemovePlan & {
  /** Paths relative to the store root that are gone. */
  removed: string[];
  /** Listings whose meta was rewritten to stop naming this one. */
  repointed: string[];
};

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.stat(abs);
    return true;
  } catch {
    return false;
  }
}

function countRows(slug: string): RemovePlan["rows"] {
  const conn = db();
  const count = (table: string) =>
    (
      conn.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE slug = ?`).get(slug) as {
        n: number;
      }
    ).n;
  return {
    saved: count("user_saved"),
    installed: count("user_installed"),
    statuses: count("file_status"),
    comments: count("file_comments"),
  };
}

/** Every meta file but this one's, with its slug. */
async function otherMetas(slug: string): Promise<[string, Record<string, unknown>][]> {
  const dir = path.join(STORE_ROOT, STORE_DIRS.meta);
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const out: [string, Record<string, unknown>][] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const other = path.basename(name, ".json");
    if (other === slug) continue;
    out.push([other, await readMetaRaw(other)]);
  }
  return out;
}

function names(meta: Record<string, unknown>, slug: string): boolean {
  if (meta.family === slug) return true;
  const requires = meta.requires;
  return Array.isArray(requires) ? requires.includes(slug) : requires === slug;
}

/** What removing this listing would take with it. Writes nothing. */
export async function planRemove(app: StoreApp): Promise<RemovePlan> {
  const all = app.versions.flatMap((v) => [...v.files, ...v.extras]);
  const bytes = all.reduce((sum, f) => sum + f.bytes, 0);
  const relatives = (await otherMetas(app.slug))
    .filter(([, meta]) => names(meta, app.slug))
    .map(([slug]) => slug);
  return {
    slug: app.slug,
    name: app.name,
    versions: app.versions.map((v) => v.version),
    files: all.length,
    bytes,
    size: formatBytes(bytes),
    rows: countRows(app.slug),
    relatives,
  };
}

/**
 * Stop every other listing from naming this one.
 *
 * `writeMeta` merges, and `JSON.stringify` leaves out a key whose value is
 * `undefined` — that is how a key is deleted through it.
 */
async function unlinkRelatives(slug: string): Promise<string[]> {
  const metas = await otherMetas(slug);
  const touched: string[] = [];

  const members = metas.filter(([, m]) => m.family === slug).map(([s]) => s).sort();
  const head = members.length > 1 ? members[0] : undefined;

  for (const [other, meta] of metas) {
    const patch: Record<string, unknown> = {};
    if (meta.family === slug) patch.family = head;
    const requires = meta.requires;
    if (Array.isArray(requires) ? requires.includes(slug) : requires === slug) {
      const rest = (Array.isArray(requires) ? requires : [requires]).filter((h) => h !== slug);
      patch.requires = rest.length ? rest : undefined;
    }
    if (!Object.keys(patch).length) continue;
    await writeMeta(other, patch);
    touched.push(other);
  }
  return touched;
}

/** Do it. The plan is read again here — the one on screen may be stale. */
export async function removeApp(app: StoreApp): Promise<RemoveResult> {
  const plan = await planRemove(app);
  const removed: string[] = [];
  const slug = app.slug;

  try {
    // Binaries first: a removal that dies halfway leaves a meta file
    // describing an emptied folder, which is visible and finished by pressing
    // the button again, not files nobody lists.
    const apkDir = path.join(STORE_DIRS.apks, slug);
    if (await exists(path.join(STORE_ROOT, apkDir))) {
      await fs.rm(path.join(STORE_ROOT, apkDir), { recursive: true, force: true });
      removed.push(apkDir);
    }

    for (const dir of [STORE_DIRS.icons, STORE_DIRS.banners]) {
      for (const ext of IMAGE_EXTENSIONS) {
        const rel = path.join(dir, slug + ext);
        if (await exists(path.join(STORE_ROOT, rel))) {
          await fs.unlink(path.join(STORE_ROOT, rel));
          removed.push(rel);
        }
      }
    }
    const shots = path.join(STORE_DIRS.screenshots, slug);
    if (await exists(path.join(STORE_ROOT, shots))) {
      await fs.rm(path.join(STORE_ROOT, shots), { recursive: true, force: true });
      removed.push(shots);
    }

    const meta = path.join(STORE_DIRS.meta, `${slug}.json`);
    if (await exists(path.join(STORE_ROOT, meta))) {
      await fs.unlink(path.join(STORE_ROOT, meta));
      removed.push(meta);
    }
  } finally {
    if (removed.length) invalidateCatalog();
  }

  const repointed = await unlinkRelatives(slug);

  const conn = db();
  const prefix = path.join(STORE_DIRS.apks, slug) + "/";
  conn.transaction(() => {
    for (const table of ["user_saved", "user_installed", "file_status", "file_comments"]) {
      conn.prepare(`DELETE FROM ${table} WHERE slug = ?`).run(slug);
    }
    // The hash caches are keyed on the file's path; a later listing reusing
    // the slug would otherwise start out with this app's answers.
    for (const table of ["apk_facts", "apk_abis"]) {
      conn.prepare(`DELETE FROM ${table} WHERE substr(path, 1, ?) = ?`).run(prefix.length, prefix);
    }
  })();
  invalidateCatalog();

  return { ...plan, removed, repointed };
}
