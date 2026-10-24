/**
 * Game mods: the library's second shelf, beside the apps and apart from them.
 *
 * A mod is not an app. It has no package id, no signer and no APK, and it
 * never goes into an F-Droid index — so it does not live in `meta/` or pass
 * through `lib/store.ts`, where every rule is about those things. It has its
 * own tree instead (see `lib/storage.ts`):
 *
 *   mods/<game>/game.json              { name, nexusDomain? }
 *   mods/<game>/<mod>/mod.json         the mod's words, and a label per file
 *   mods/<game>/<mod>/files/<file>     the archives people download
 *   mod-images/<game>.<ext>            the game's cover
 *   mod-images/<game>/<mod>.<ext>      the mod's picture
 *
 * The same split as the apps: the files on disk say which downloads exist and
 * how big they are, the JSON only supplies words. A file whose label is
 * missing from `mod.json` is still offered.
 *
 * Words usually come from Nexus Mods (`lib/sources/nexus.ts`) and are Nexus's
 * own — nothing here edits them by hand — so a refresh overwrites them rather
 * than filling gaps.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { STORE_DIRS, STORE_ROOT } from "./storage";
import { DISCARD_DIR, slugify } from "./import";
import { formatBytes, mediaHref, seedFrom } from "./store";
import { withBasePath } from "./base-path";
import { saveImage } from "./sources/net";
import type { NexusMod } from "./sources/nexus";
import {
  appendPart,
  CHUNK_BYTES,
  dropPart,
  dropSidecar,
  freeName,
  head,
  isFileName,
  MAX_UPLOAD_BYTES,
  moveInto,
  openPart,
  partPath,
  partSize,
  readSidecar,
  UploadError,
} from "./chunks";

const MODS_DIR = path.join(STORE_ROOT, STORE_DIRS.mods);
const IMAGES_DIR = path.join(STORE_ROOT, STORE_DIRS.modImages);
const IMAGE_EXTS = [".webp", ".png", ".jpg", ".gif", ".avif"];

/** What a mod archive can be, by the bytes it opens with. */
const ARCHIVE_MAGIC: Record<string, string[]> = {
  ".zip": ["504b0304", "504b0506"],
  ".7z": ["377abcaf"],
  ".rar": ["52617221"],
};
export const MOD_EXTENSIONS = Object.keys(ARCHIVE_MAGIC);

export const ModError = UploadError;

export type ModGame = {
  slug: string;
  name: string;
  nexusDomain?: string;
  cover?: string;
  seed: number;
  /** Mods this viewer can see. */
  modCount: number;
};

export type ModFile = {
  file: string;
  size: string;
  bytes: number;
  /** The label given at upload — usually the mod's version then. */
  version: string;
  added: string;
  href: string;
};

export type StoreMod = {
  game: string;
  slug: string;
  name: string;
  summary: string;
  description: string;
  author: string;
  version: string;
  category: string;
  adult: boolean;
  picture?: string;
  seed: number;
  nexus?: {
    url: string;
    domain: string;
    modId: number;
    endorsements: number;
    downloads: number;
    updatedAt: string;
  };
  files: ModFile[];
};

type GameJson = { name?: string; nexusDomain?: string };

type ModJson = {
  name?: string;
  summary?: string;
  description?: string;
  author?: string;
  version?: string;
  category?: string;
  adult?: boolean;
  nexus?: StoreMod["nexus"];
  files?: Record<string, { version?: string }>;
  added?: string;
};

/** One directory name: a slug, never a path. */
function isSlug(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(name);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

async function dirs(abs: string): Promise<string[]> {
  try {
    return (await fs.readdir(abs, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && isSlug(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/** `mod-images/<rel>.<ext>` as a media URL, whichever extension it was saved with. */
async function imageHref(rel: string): Promise<string | undefined> {
  for (const ext of IMAGE_EXTS) {
    try {
      const stat = await fs.stat(path.join(IMAGES_DIR, `${rel}${ext}`));
      if (stat.isFile()) return mediaHref(`${STORE_DIRS.modImages}/${rel}${ext}`, stat.mtimeMs);
    } catch {
      /* try the next one */
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------- read */

async function readMod(game: string, slug: string): Promise<StoreMod | null> {
  const dir = path.join(MODS_DIR, game, slug);
  const meta = await readJson<ModJson>(path.join(dir, "mod.json"));
  if (!meta) return null;

  const files: ModFile[] = [];
  let names: string[] = [];
  try {
    names = await fs.readdir(path.join(dir, "files"));
  } catch {
    /* nothing uploaded yet */
  }
  for (const file of names) {
    if (!isFileName(file) || !MOD_EXTENSIONS.includes(path.extname(file).toLowerCase())) continue;
    try {
      const stat = await fs.stat(path.join(dir, "files", file));
      if (!stat.isFile()) continue;
      files.push({
        file,
        bytes: stat.size,
        size: formatBytes(stat.size),
        version: meta.files?.[file]?.version ?? "",
        added: stat.mtime.toISOString(),
        href: withBasePath(
          `/api/mods/${game}/${slug}/download?f=${encodeURIComponent(file)}`
        ),
      });
    } catch {
      /* gone between the listing and the stat */
    }
  }
  files.sort((a, b) => b.added.localeCompare(a.added));

  return {
    game,
    slug,
    name: meta.name || slug,
    summary: meta.summary ?? "",
    description: meta.description ?? "",
    author: meta.author ?? "",
    version: meta.version ?? "",
    category: meta.category ?? "",
    adult: meta.adult === true,
    picture: await imageHref(`${game}/${slug}`),
    seed: seedFrom(`${game}/${slug}`),
    nexus: meta.nexus,
    files,
  };
}

/** Every mod of a game, adult ones only for a viewer who opted in. */
export async function gameMods(game: string, adults: boolean): Promise<StoreMod[]> {
  if (!isSlug(game)) return [];
  const mods = await Promise.all(
    (await dirs(path.join(MODS_DIR, game))).map((slug) => readMod(game, slug))
  );
  return mods
    .filter((m): m is StoreMod => m !== null && (adults || !m.adult))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** One mod, or null — the same 404 for a hidden adult mod as for a missing one. */
export async function findMod(
  game: string,
  slug: string,
  adults: boolean
): Promise<StoreMod | null> {
  if (!isSlug(game) || !isSlug(slug)) return null;
  const mod = await readMod(game, slug);
  return mod && (adults || !mod.adult) ? mod : null;
}

export async function findGame(game: string, adults: boolean): Promise<ModGame | null> {
  if (!isSlug(game)) return null;
  const meta = await readJson<GameJson>(path.join(MODS_DIR, game, "game.json"));
  if (!meta) return null;
  return {
    slug: game,
    name: meta.name || game,
    nexusDomain: meta.nexusDomain,
    cover: await imageHref(game),
    seed: seedFrom(game),
    modCount: (await gameMods(game, adults)).length,
  };
}

export async function listGames(adults: boolean): Promise<ModGame[]> {
  const games = await Promise.all(
    (await dirs(MODS_DIR)).map((slug) => findGame(slug, adults))
  );
  return games
    .filter((g): g is ModGame => g !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ write */

// A chain per file serialises writes inside this process: two uploads to one
// mod finishing together would otherwise each write back the files map they
// read, and one label would be lost.
const writes = new Map<string, Promise<void>>();

async function updateJson<T extends object>(
  file: string,
  change: (current: T) => T
): Promise<void> {
  const previous = writes.get(file) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    let current = {} as T;
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not a JSON object");
      }
      current = parsed as T;
    } catch (err) {
      // A file that exists and does not parse is damage, not an empty record.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new ModError(
          `${path.basename(file)} could not be read, refusing to overwrite it`,
          500
        );
      }
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(change(current), null, 2) + "\n", "utf8");
    try {
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.unlink(tmp).catch(() => undefined);
      throw err;
    }
  });
  writes.set(file, run);
  try {
    await run;
  } finally {
    if (writes.get(file) === run) writes.delete(file);
  }
}

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.stat(abs);
    return true;
  } catch {
    return false;
  }
}

async function uniqueDir(parent: string, name: string, fallback: string): Promise<string> {
  const base = slugify(name) || fallback;
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await exists(path.join(parent, slug)))) return slug;
  }
}

/** Replaces whatever picture was there, under the extension the new one has. */
async function replaceImage(url: string, rel: string): Promise<void> {
  const dest = path.join(IMAGES_DIR, rel);
  const before = await Promise.all(
    IMAGE_EXTS.map(async (ext) => ((await exists(dest + ext)) ? dest + ext : null))
  );
  const tmpRel = `${rel}.${randomBytes(4).toString("hex")}`;
  const saved = await saveImage(url, path.join(IMAGES_DIR, tmpRel), "nexus");
  if (!saved) return; // keep the old picture rather than none
  for (const old of before) if (old) await fs.unlink(old).catch(() => undefined);
  for (const ext of IMAGE_EXTS) {
    if (await exists(path.join(IMAGES_DIR, tmpRel + ext))) {
      await fs.rename(path.join(IMAGES_DIR, tmpRel + ext), dest + ext);
    }
  }
}

/** A game to file mods under, by name. */
export async function addGame(name: unknown, nexusDomain?: string): Promise<string> {
  if (typeof name !== "string" || !name.trim()) throw new ModError("A game name is required");
  const slug = await uniqueDir(MODS_DIR, name.trim(), "game");
  await updateJson<GameJson>(path.join(MODS_DIR, slug, "game.json"), () => ({
    name: name.trim().slice(0, 120),
    ...(nexusDomain ? { nexusDomain } : {}),
  }));
  return slug;
}

/** The game Nexus files this mod under — the one already here, or a new one. */
async function gameForNexus(mod: NexusMod): Promise<string> {
  for (const slug of await dirs(MODS_DIR)) {
    const meta = await readJson<GameJson>(path.join(MODS_DIR, slug, "game.json"));
    if (meta?.nexusDomain === mod.game.domain) return slug;
  }
  const slug = await addGame(mod.game.name, mod.game.domain);
  await replaceImage(mod.game.coverUrl, slug);
  return slug;
}

function nexusWords(mod: NexusMod): ModJson {
  return {
    name: mod.name,
    summary: mod.summary,
    description: mod.description,
    author: mod.author,
    version: mod.version,
    category: mod.category,
    adult: mod.adult,
    nexus: {
      url: mod.url,
      domain: mod.ref.domain,
      modId: mod.ref.modId,
      endorsements: mod.endorsements,
      downloads: mod.downloads,
      updatedAt: mod.updatedAt,
    },
  };
}

/** Where a Nexus mod already sits in the library, if it does. */
async function nexusModHere(mod: NexusMod): Promise<{ game: string; mod: string } | null> {
  for (const game of await dirs(MODS_DIR)) {
    for (const slug of await dirs(path.join(MODS_DIR, game))) {
      const meta = await readJson<ModJson>(path.join(MODS_DIR, game, slug, "mod.json"));
      if (meta?.nexus?.domain === mod.ref.domain && meta.nexus.modId === mod.ref.modId) {
        return { game, mod: slug };
      }
    }
  }
  return null;
}

export class ModAlreadyHere extends UploadError {
  constructor(readonly at: { game: string; mod: string }) {
    super("That mod is already in the store", 409);
  }
}

/**
 * A new mod listing. From Nexus, the game comes with it; by hand, `game` is
 * the slug of one already here.
 */
export async function addMod(
  input: { nexus: NexusMod } | { game: unknown; name: unknown }
): Promise<{ game: string; mod: string }> {
  if ("nexus" in input) {
    const here = await nexusModHere(input.nexus);
    if (here) throw new ModAlreadyHere(here);
    const game = await gameForNexus(input.nexus);
    const slug = await uniqueDir(path.join(MODS_DIR, game), input.nexus.name, "mod");
    await updateJson<ModJson>(path.join(MODS_DIR, game, slug, "mod.json"), () => ({
      ...nexusWords(input.nexus),
      files: {},
      added: new Date().toISOString(),
    }));
    if (input.nexus.pictureUrl) await replaceImage(input.nexus.pictureUrl, `${game}/${slug}`);
    return { game, mod: slug };
  }

  const game = typeof input.game === "string" ? input.game : "";
  if (!isSlug(game) || !(await exists(path.join(MODS_DIR, game, "game.json")))) {
    throw new ModError("Pick a game first");
  }
  if (typeof input.name !== "string" || !input.name.trim()) {
    throw new ModError("A mod name is required");
  }
  const name = input.name.trim().slice(0, 120);
  const slug = await uniqueDir(path.join(MODS_DIR, game), name, "mod");
  await updateJson<ModJson>(path.join(MODS_DIR, game, slug, "mod.json"), () => ({
    name,
    files: {},
    added: new Date().toISOString(),
  }));
  return { game, mod: slug };
}

async function modDir(game: string, slug: string): Promise<string> {
  if (!isSlug(game) || !isSlug(slug)) throw new ModError("No such mod", 404);
  const dir = path.join(MODS_DIR, game, slug);
  if (!(await exists(path.join(dir, "mod.json")))) throw new ModError("No such mod", 404);
  return dir;
}

/** Nexus's current words over the old ones; the file labels are kept. */
export async function refreshMod(game: string, slug: string, mod: NexusMod): Promise<void> {
  const dir = await modDir(game, slug);
  const current = await readJson<ModJson>(path.join(dir, "mod.json"));
  if (current?.nexus?.domain !== mod.ref.domain || current.nexus.modId !== mod.ref.modId) {
    throw new ModError("That listing is not this Nexus mod");
  }
  await updateJson<ModJson>(path.join(dir, "mod.json"), (meta) => ({
    ...meta,
    ...nexusWords(mod),
  }));
  if (mod.pictureUrl) await replaceImage(mod.pictureUrl, `${game}/${slug}`);
}

/**
 * Take a mod off the shelf. The folder moves to `_import/_discarded/mods/`,
 * files and all — an evening's uploads are not undone by one click.
 */
export async function removeMod(game: string, slug: string): Promise<void> {
  const dir = await modDir(game, slug);
  await moveInto(dir, await freeName(path.join(DISCARD_DIR, "mods", game), slug));
  for (const ext of IMAGE_EXTS) {
    await fs.unlink(path.join(IMAGES_DIR, game, `${slug}${ext}`)).catch(() => undefined);
  }
}

/** A file off a mod, into `_import/_discarded/` like every other removal. */
export async function removeModFile(game: string, slug: string, file: string): Promise<void> {
  const dir = await modDir(game, slug);
  if (!isFileName(file) || !(await exists(path.join(dir, "files", file)))) {
    throw new ModError("No such file", 404);
  }
  await moveInto(
    path.join(dir, "files", file),
    await freeName(path.join(DISCARD_DIR, "mods", game, slug), file)
  );
  await updateJson<ModJson>(path.join(dir, "mod.json"), (meta) => {
    const files = { ...meta.files };
    delete files[file];
    return { ...meta, files };
  });
}

/* ----------------------------------------------------------------- upload */

type Pending = {
  kind: "mod";
  game: string;
  mod: string;
  file: string;
  version: string;
  bytes: number;
  started: string;
};

async function readPending(game: string, slug: string, id: string): Promise<Pending> {
  const pending = await readSidecar<Pending>(id);
  // The upload directory is shared with OBB uploads; an id from one of those
  // is not an upload to this mod.
  if (pending.kind !== "mod" || pending.game !== game || pending.mod !== slug) {
    throw new ModError("No such upload", 404);
  }
  return pending;
}

export async function startModUpload(
  game: string,
  slug: string,
  input: { file?: unknown; bytes?: unknown; version?: unknown }
): Promise<{ id: string; received: number; chunkBytes: number }> {
  await modDir(game, slug);
  const file = typeof input.file === "string" ? input.file.trim() : "";
  if (!isFileName(file)) throw new ModError("A plain file name is required");
  if (!MOD_EXTENSIONS.includes(path.extname(file).toLowerCase())) {
    throw new ModError(`Only ${MOD_EXTENSIONS.join(", ")} archives can be added`);
  }
  const bytes = input.bytes;
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new ModError("bytes must be the file's size");
  }
  if (bytes > MAX_UPLOAD_BYTES) throw new ModError("That file is larger than the store accepts");
  const version = typeof input.version === "string" ? input.version.trim().slice(0, 40) : "";

  const id = randomUUID();
  const pending: Pending = {
    kind: "mod",
    game,
    mod: slug,
    file,
    version,
    bytes,
    started: new Date().toISOString(),
  };
  await openPart(id, pending);
  return { id, received: 0, chunkBytes: CHUNK_BYTES };
}

export async function appendModChunk(
  game: string,
  slug: string,
  id: string,
  offset: number,
  body: ReadableStream<Uint8Array> | null
): Promise<{ received: number; done: boolean; file?: string }> {
  const pending = await readPending(game, slug, id);
  const received = await appendPart(id, offset, pending.bytes, body);
  if (received < pending.bytes) return { received, done: false };
  return { received, done: true, file: await finish(id, pending) };
}

async function finish(id: string, pending: Pending): Promise<string> {
  const part = partPath(id);
  // An archive is read by whoever unpacks it, so it has to be one — decided
  // by its bytes, never its name.
  const magic = (await head(part)).toString("hex");
  if (!ARCHIVE_MAGIC[path.extname(pending.file).toLowerCase()]?.includes(magic)) {
    await dropPart(id);
    throw new ModError(`That file is not a ${path.extname(pending.file)} archive`);
  }

  const dir = await modDir(pending.game, pending.mod);
  const dest = path.join(dir, "files", pending.file);
  if (await exists(dest)) {
    await moveInto(
      dest,
      await freeName(path.join(DISCARD_DIR, "mods", pending.game, pending.mod), pending.file)
    );
  }
  await moveInto(part, dest);
  await dropSidecar(id);
  await updateJson<ModJson>(path.join(dir, "mod.json"), (meta) => ({
    ...meta,
    files: { ...meta.files, [pending.file]: { version: pending.version } },
  }));
  return pending.file;
}

export async function modUploadStatus(
  game: string,
  slug: string,
  id: string
): Promise<{ received: number; bytes: number }> {
  const pending = await readPending(game, slug, id);
  return { received: await partSize(id), bytes: pending.bytes };
}

export async function cancelModUpload(game: string, slug: string, id: string): Promise<void> {
  await readPending(game, slug, id);
  await dropPart(id);
}
