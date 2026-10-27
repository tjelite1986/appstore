/**
 * Writing the admin-defined collections.
 *
 * A collection is a named shelf on top of the category — see `CollectionDef`
 * in `lib/store.ts`, which also reads them. The definitions (name, slug,
 * order) are one file in `_state/`; membership is a `collections` list on
 * each app's meta file, edited through `editApp` like any other field.
 *
 * Nothing here touches `category`. That field is the 18+ gate and the
 * App/Game kind, and a collection is deliberately neither.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  COLLECTIONS_FILE,
  invalidateCatalog,
  readCollectionDefs,
  type CollectionDef,
} from "@/lib/store";
import { readMetaRaw, slugify, writeMeta } from "@/lib/import";
import { STORE_DIRS, STORE_ROOT } from "@/lib/storage";

export class CollectionError extends Error {}

const MAX_NAME = 60;
/** More than a shelf page can show; enough that nobody meets it honestly. */
const MAX_COLLECTIONS = 100;

// One writer at a time, the same reason writeMeta has a chain per slug: every
// change is read-modify-write on the one file.
let chain: Promise<unknown> = Promise.resolve();

function serialised<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.catch(() => undefined).then(job);
  chain = run;
  return run;
}

async function save(defs: CollectionDef[]): Promise<void> {
  await fs.mkdir(path.dirname(COLLECTIONS_FILE), { recursive: true });
  const tmp = `${COLLECTIONS_FILE}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(
    tmp,
    JSON.stringify({ collections: defs }, null, 2) + "\n",
    "utf8"
  );
  try {
    await fs.rename(tmp, COLLECTIONS_FILE);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
  invalidateCatalog();
}

function cleanName(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new CollectionError("A collection needs a name");
  }
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length > MAX_NAME) {
    throw new CollectionError(`The name is longer than ${MAX_NAME} characters`);
  }
  return name;
}

function find(defs: CollectionDef[], slug: unknown): number {
  const at = defs.findIndex((c) => c.slug === slug);
  if (at < 0) throw new CollectionError("No such collection");
  return at;
}

/** Add one at the end of the list. Its slug is fixed from the first name. */
export function createCollection(rawName: unknown): Promise<CollectionDef> {
  return serialised(async () => {
    const name = cleanName(rawName);
    const defs = await readCollectionDefs();
    if (defs.length >= MAX_COLLECTIONS) {
      throw new CollectionError(`There are already ${MAX_COLLECTIONS} collections`);
    }
    if (defs.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      throw new CollectionError(`There is already a collection called ${name}`);
    }
    const base = slugify(name) || "collection";
    let slug = base;
    for (let n = 2; defs.some((c) => c.slug === slug); n++) slug = `${base}-${n}`;
    const def = { slug, name };
    await save([...defs, def]);
    return def;
  });
}

/**
 * Change what a collection is called. The slug stays: it is what every meta
 * file holds, and renaming should not mean rewriting the library.
 */
export function renameCollection(slug: unknown, rawName: unknown): Promise<void> {
  return serialised(async () => {
    const name = cleanName(rawName);
    const defs = await readCollectionDefs();
    const at = find(defs, slug);
    if (
      defs.some(
        (c, i) => i !== at && c.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      throw new CollectionError(`There is already a collection called ${name}`);
    }
    defs[at] = { ...defs[at], name };
    await save(defs);
  });
}

/** One step up (-1) or down (+1). The ends are a no-op, not an error. */
export function moveCollection(slug: unknown, step: unknown): Promise<void> {
  return serialised(async () => {
    if (step !== -1 && step !== 1) {
      throw new CollectionError("step must be -1 or 1");
    }
    const defs = await readCollectionDefs();
    const at = find(defs, slug);
    const to = at + step;
    if (to < 0 || to >= defs.length) return;
    [defs[at], defs[to]] = [defs[to], defs[at]];
    await save(defs);
  });
}

/**
 * Delete a collection and take it off every listing that was filed under it.
 *
 * The definition goes first, so a crash halfway leaves only dangling slugs on
 * some meta files — which `resolveCollections` already ignores — rather than a
 * collection that still exists with half its apps. The apps themselves are
 * untouched apart from that one list.
 */
export function deleteCollection(slug: unknown): Promise<{ unfiled: number }> {
  return serialised(async () => {
    const defs = await readCollectionDefs();
    const at = find(defs, slug);
    const gone = defs[at].slug;
    await save(defs.filter((_, i) => i !== at));
    return { unfiled: await dropFromMeta(gone) };
  });
}

/**
 * Remove one collection slug from every meta file that lists it.
 *
 * Read from the files, not the catalog: hidden listings are not in the
 * catalog but their meta files may still carry the slug, and the catalog has
 * already dropped slugs it could not resolve.
 */
async function dropFromMeta(gone: string): Promise<number> {
  const metaDir = path.join(STORE_ROOT, STORE_DIRS.meta);
  const files = await fs.readdir(metaDir).catch(() => [] as string[]);
  let changed = 0;
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const slug = file.slice(0, -".json".length);
    const meta = await readMetaRaw(slug);
    const list = meta.collections;
    if (!Array.isArray(list) && typeof list !== "string") continue;
    const before = Array.isArray(list)
      ? list.filter((c): c is string => typeof c === "string")
      : list.split(/[,\s]+/).filter(Boolean);
    if (!before.includes(gone)) continue;
    const after = before.filter((c) => c !== gone);
    await writeMeta(slug, { collections: after.length > 0 ? after : undefined });
    changed++;
  }
  if (changed > 0) invalidateCatalog();
  return changed;
}
