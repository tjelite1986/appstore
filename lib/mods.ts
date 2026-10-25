/**
 * Game mods: the library's second shelf, beside the apps and apart from them.
 *
 * A mod is not an app. It has no package id, no signer and no APK, and it
 * never goes into an F-Droid index — so it does not live in `meta/` or pass
 * through `lib/store.ts`, where every rule is about those things. It has its
 * own tree instead (see `lib/storage.ts`):
 *
 *   mods/<game>/game.json              { name, nexusDomain?, requirementLinks? }
 *   mods/<game>/<mod>/mod.json         the mod's words, and a label per file
 *   mods/<game>/<mod>/files/<file>     the archives people download
 *   mod-images/<game>.<ext>            the game's cover
 *   mod-images/<game>/<mod>.<ext>      the mod's picture
 *   mod-images/<game>/<mod>/<hash>.<ext>  the pictures its description shows
 *
 * The same split as the apps: the files on disk say which downloads exist and
 * how big they are, the JSON only supplies words. A file whose label is
 * missing from `mod.json` is still offered.
 *
 * Words usually come from Nexus Mods (`lib/sources/nexus.ts`) and are Nexus's
 * own — nothing here edits them by hand — so a refresh overwrites them rather
 * than filling gaps.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { STORE_DIRS, STORE_ROOT } from "./storage";
import { DISCARD_DIR, slugify } from "./import";
import { formatBytes, mediaHref, seedFrom } from "./store";
import { withBasePath } from "./base-path";
import { fetchImageBytes, saveImage } from "./sources/net";
import { sniffExtension } from "./edit";
import {
  nexusModUrl,
  parseNexusUrl,
  type NexusMod,
  type NexusRef,
  type NexusRequirement,
} from "./sources/nexus";
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

const ZIP = ["504b0304", "504b0506"];

/**
 * What a mod can ship as, and how its first bytes must look. Most mods are an
 * archive, but on Android a game is often modded through a launcher — an APK
 * installed beside the game, with the mod archive imported into it — so the
 * launcher sits on the same listing. An OBB is opaque game data: no magic.
 */
const MOD_FORMATS: Record<string, { kind: ModFileKind; magic: string[] | null }> = {
  ".zip": { kind: "archive", magic: ZIP },
  ".7z": { kind: "archive", magic: ["377abcaf"] },
  ".rar": { kind: "archive", magic: ["52617221"] },
  ".jar": { kind: "archive", magic: ZIP },
  ".apk": { kind: "app", magic: ZIP },
  ".apks": { kind: "app", magic: ZIP },
  ".xapk": { kind: "app", magic: ZIP },
  ".apkm": { kind: "app", magic: ZIP },
  ".obb": { kind: "data", magic: null },
};
export const MOD_EXTENSIONS = Object.keys(MOD_FORMATS);

/** A mod archive, an app (a launcher, a patched game) or game data. */
export type ModFileKind = "archive" | "app" | "data";

/** Nexus's own split of a mod page's files: what most people want, and the rest. */
export const MOD_FILE_SECTIONS = ["main", "optional"] as const;
export type ModFileSection = (typeof MOD_FILE_SECTIONS)[number];

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
  /**
   * What the file is, as the page names it. One Nexus page often holds
   * several mods, so the mod's own name does not say which one this is;
   * without a label the file name stands in.
   */
  name: string;
  /** Unset in mod.json means main. */
  section: ModFileSection;
  size: string;
  bytes: number;
  /** The label given at upload — usually the mod's version then. */
  version: string;
  added: string;
  href: string;
  kind: ModFileKind;
  /** The Nexus page this file's name and version were taken from. */
  nexus?: string;
  /** Where the file was downloaded from when it is not Nexus — a GitHub release, say. */
  source?: string;
};

/**
 * One thing a mod needs, as the page shows it: where to get it — this store's
 * own page when the mod is here, Nexus or the off-site address otherwise.
 */
export type ModRequirement = {
  /** What a hand-made link is stored under — see `requirementKey`. */
  key: string;
  kind: NexusRequirement["kind"];
  name: string;
  notes: string;
  /** This store's page for it. */
  here?: string;
  /** Where else it is found. */
  url?: string;
  /** The Nexus mod it is, when it is one this store could also hold. */
  nexus?: NexusRef;
  /** `here` was chosen by hand rather than found by Nexus id. */
  linked?: boolean;
};

/** A requirement's identity across refreshes: its Nexus mod, else its name. */
function requirementKey(r: { kind: string; name: string; ref?: NexusRef | null }): string {
  return r.kind === "mod" && r.ref
    ? `nexus:${r.ref.domain}/${r.ref.modId}`
    : `${r.kind}:${r.name.trim().toLowerCase()}`;
}

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
  requirements: ModRequirement[];
  /** The description's `[img]` addresses, each to its copy in this library. */
  images: Record<string, string>;
  files: ModFile[];
};

type GameJson = {
  name?: string;
  nexusDomain?: string;
  /**
   * Requirement key → a mod of this game that stands in for it. Per game, not
   * per mod: SMAPI on Nexus is SMAPI for Android here for every mod that
   * needs it.
   */
  requirementLinks?: Record<string, string>;
};

type FileJson = {
  name?: string;
  version?: string;
  section?: ModFileSection;
  nexus?: string;
  source?: string;
};

type ModJson = {
  name?: string;
  summary?: string;
  description?: string;
  author?: string;
  version?: string;
  category?: string;
  adult?: boolean;
  nexus?: StoreMod["nexus"];
  requirements?: NexusRequirement[];
  /** `[img]` address → path under mod-images/. */
  images?: Record<string, string>;
  files?: Record<string, FileJson>;
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

/** `Better Chests-9791-2-1-0.zip` → `Better Chests-9791-2-1-0`. */
function fileStem(file: string): string {
  return file.slice(0, file.length - path.extname(file).length);
}

/**
 * What a Nexus download's own name says: they are saved as
 * `<name>-<mod id>-<version, dashes for dots>-<unix time>`, often with the
 * version in the name as well. Anything else is only its stem.
 */
export function nameFromFile(file: string): { name: string; version: string } {
  const stem = fileStem(file);
  const m = /^(.+?)-\d+-(\d+(?:-\d+)*)-\d{9,11}$/.exec(stem);
  if (!m) return { name: stem, version: "" };
  const version = m[2].replace(/-/g, ".");
  const name = m[1].replace(new RegExp(`[ _-]v?${version.replace(/\./g, "\\.")}$`, "i"), "");
  return { name: name.trim() || stem, version };
}

/** A file's name label as given: trimmed and capped, empty for none. */
function fileSection(value: unknown): ModFileSection {
  return value === "optional" ? "optional" : "main";
}

function fileLabel(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** An address pasted without its scheme — `github.com/…` — is taken as https. */
function withScheme(raw: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
}

/** A file's Nexus page, written the one way Nexus links are; empty for none. */
function fileNexus(value: unknown): string {
  const raw = fileLabel(value, 300);
  if (!raw) return "";
  const ref = parseNexusUrl(withScheme(raw));
  if (!ref) throw new ModError("Expected a nexusmods.com/<game>/mods/<id> address");
  return nexusModUrl(ref);
}

/** Where a file came from: an http(s) address the page links to; empty for none. */
function fileSource(value: unknown): string {
  const raw = fileLabel(value, 500);
  if (!raw) return "";
  let url: URL;
  try {
    url = new URL(withScheme(raw));
  } catch {
    throw new ModError("The source must be a web address");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ModError("The source must be an http or https address");
  }
  return url.toString();
}

/** One file's entry in mod.json, leaving out what is empty. */
function fileJson(f: {
  name: string;
  version: string;
  section: ModFileSection;
  nexus: string;
  source: string;
}): FileJson {
  return {
    ...(f.name ? { name: f.name } : {}),
    version: f.version,
    section: f.section,
    ...(f.nexus ? { nexus: f.nexus } : {}),
    ...(f.source ? { source: f.source } : {}),
  };
}

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
        name: meta.files?.[file]?.name || nameFromFile(file).name,
        section: fileSection(meta.files?.[file]?.section),
        version: meta.files?.[file]?.version || nameFromFile(file).version,
        kind: MOD_FORMATS[path.extname(file).toLowerCase()].kind,
        ...(meta.files?.[file]?.nexus ? { nexus: meta.files[file].nexus } : {}),
        ...(meta.files?.[file]?.source ? { source: meta.files[file].source } : {}),
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
    requirements: (Array.isArray(meta.requirements) ? meta.requirements : []).map((r) => ({
      key: requirementKey(r),
      kind: r.kind,
      name: r.name,
      notes: r.notes ?? "",
      ...(r.kind === "mod" && r.ref ? { url: nexusModUrl(r.ref), nexus: r.ref } : {}),
      ...(r.kind === "external" && r.url ? { url: r.url } : {}),
    })),
    images: await descriptionImageHrefs(meta.images),
    files,
  };
}

async function descriptionImageHrefs(
  images: Record<string, string> | undefined
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!images || typeof images !== "object") return out;
  for (const [url, rel] of Object.entries(images)) {
    if (typeof rel !== "string") continue;
    try {
      const stat = await fs.stat(path.join(IMAGES_DIR, rel));
      if (stat.isFile()) out[url] = mediaHref(`${STORE_DIRS.modImages}/${rel}`, stat.mtimeMs);
    } catch {
      /* not fetched, or gone: the page shows nothing for it */
    }
  }
  return out;
}

/**
 * Points each Nexus requirement that is also in this library at its page here,
 * so "needs SMAPI" leads to the SMAPI download rather than off to Nexus.
 */
async function linkRequirementsHere(mod: StoreMod, adults: boolean): Promise<StoreMod> {
  if (mod.requirements.length === 0) return mod;

  // A link made by hand wins over a match by Nexus id: it is somebody saying
  // which build is the right one here.
  const links =
    (await readJson<GameJson>(path.join(MODS_DIR, mod.game, "game.json")))?.requirementLinks ?? {};
  const linked = new Map<string, string>();
  for (const [key, slug] of Object.entries(links)) {
    if (!isSlug(slug)) continue;
    const other = await readJson<ModJson>(path.join(MODS_DIR, mod.game, slug, "mod.json"));
    if (other && (other.adult !== true || adults)) linked.set(key, `/mods/${mod.game}/${slug}`);
  }

  const here = new Map<string, string>();
  for (const game of await dirs(MODS_DIR)) {
    for (const slug of await dirs(path.join(MODS_DIR, game))) {
      const other = await readJson<ModJson>(path.join(MODS_DIR, game, slug, "mod.json"));
      if (!other?.nexus || (other.adult === true && !adults)) continue;
      here.set(`${other.nexus.domain}/${other.nexus.modId}`, `/mods/${game}/${slug}`);
    }
  }
  return {
    ...mod,
    requirements: mod.requirements.map((r) => {
      const byHand = linked.get(r.key);
      if (byHand) return { ...r, here: byHand, linked: true };
      const at = r.nexus && here.get(`${r.nexus.domain}/${r.nexus.modId}`);
      return at ? { ...r, here: at } : r;
    }),
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
  return mod && (adults || !mod.adult) ? linkRequirementsHere(mod, adults) : null;
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

const MAX_DESCRIPTION_IMAGES = 30;
const MAX_SVG_BYTES = 1024 * 1024;
const MAX_SVG_PIXELS = 4096 * 4096;

/** The addresses a description's `[img]` tags show, in order, once each. */
export function descriptionImageUrls(description: string): string[] {
  const urls = new Set<string>();
  for (const m of description.matchAll(/\[img(?:[= ][^\]]*)?\]\s*([^\[\s]+)\s*\[\/img\]/gi)) {
    // Keyed as the page's BBCode reader sees it, entities decoded.
    const raw = m[1].replace(/&amp;/g, "&");
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" || url.protocol === "http:") urls.add(raw);
    } catch {
      /* not an address */
    }
    if (urls.size >= MAX_DESCRIPTION_IMAGES) break;
  }
  return [...urls];
}

/**
 * An SVG drawn to a PNG. Served from this origin as itself, an SVG is a
 * document that can run script when opened on its own; a PNG is only pixels.
 */
async function rasterizeSvg(bytes: Buffer): Promise<Buffer | null> {
  const head = bytes.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  if (!head.startsWith("<svg") && !(head.startsWith("<?xml") && head.includes("<svg"))) {
    return null;
  }
  if (bytes.byteLength > MAX_SVG_BYTES) return null;
  // A few bytes can declare a canvas of any size; check it before drawing.
  const image = sharp(bytes, { density: 192, limitInputPixels: MAX_SVG_PIXELS });
  const { width, height } = await image.metadata();
  if (!width || !height || width * height > MAX_SVG_PIXELS) return null;
  return image.png().toBuffer();
}

/**
 * Copies the pictures a description shows into the library, because the page
 * only loads images from itself. The addresses are the mod author's, not
 * Nexus's, so every fetch goes through the guarded opener. One that fails is
 * left out — a description is worth having without its pictures.
 */
async function localizeDescriptionImages(
  game: string,
  slug: string,
  description: string
): Promise<Record<string, string>> {
  const dir = path.join(IMAGES_DIR, game, slug);
  const images: Record<string, string> = {};
  for (const url of descriptionImageUrls(description)) {
    try {
      let bytes = await fetchImageBytes(url, { tag: "nexus" });
      let ext = sniffExtension(bytes);
      if (!ext) {
        const png = await rasterizeSvg(bytes);
        if (!png) throw new Error("not an image");
        bytes = png;
        ext = ".png";
      }
      const name = createHash("sha256").update(url).digest("hex").slice(0, 16) + ext;
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, name), bytes);
      images[url] = `${game}/${slug}/${name}`;
    } catch (err) {
      console.error(`[nexus] description image ${url}:`, (err as Error).message);
    }
  }
  // Pictures the description no longer shows go with it.
  const keep = new Set(Object.values(images).map((rel) => path.basename(rel)));
  for (const file of await fs.readdir(dir).catch(() => [] as string[])) {
    if (!keep.has(file)) await fs.unlink(path.join(dir, file)).catch(() => undefined);
  }
  return images;
}

/**
 * Point a requirement at one of this game's mods, for every mod of the game
 * that needs it — or, with no mod, back to finding it by Nexus id.
 */
export async function linkRequirement(game: string, key: unknown, to: unknown): Promise<void> {
  if (!isSlug(game) || !(await exists(path.join(MODS_DIR, game, "game.json")))) {
    throw new ModError("No such game", 404);
  }
  if (typeof key !== "string" || !/^(nexus|mod|external|dlc):.{1,200}$/.test(key)) {
    throw new ModError("A requirement key is required");
  }
  const slug = typeof to === "string" ? to : "";
  if (slug && (!isSlug(slug) || !(await exists(path.join(MODS_DIR, game, slug, "mod.json"))))) {
    throw new ModError("That mod is not in this game", 404);
  }
  await updateJson<GameJson>(path.join(MODS_DIR, game, "game.json"), (meta) => {
    const links = { ...meta.requirementLinks };
    if (slug) links[key] = slug;
    else delete links[key];
    return { ...meta, requirementLinks: links };
  });
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
    requirements: mod.requirements,
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
    const images = await localizeDescriptionImages(game, slug, input.nexus.description);
    await updateJson<ModJson>(path.join(MODS_DIR, game, slug, "mod.json"), (meta) => ({
      ...meta,
      images,
    }));
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
  const images = await localizeDescriptionImages(game, slug, mod.description);
  await updateJson<ModJson>(path.join(dir, "mod.json"), (meta) => ({
    ...meta,
    ...nexusWords(mod),
    images,
  }));
  if (mod.pictureUrl) await replaceImage(mod.pictureUrl, `${game}/${slug}`);
}

/**
 * Point a listing at another Nexus mod — the one it should have been. The
 * uploaded files stay; the words, picture and requirements become the new
 * mod's, and the folder takes the new name. Answers where the listing is now.
 */
export async function relinkMod(
  game: string,
  slug: string,
  mod: NexusMod
): Promise<{ game: string; mod: string }> {
  const dir = await modDir(game, slug);
  const gameMeta = await readJson<GameJson>(path.join(MODS_DIR, game, "game.json"));
  if (gameMeta?.nexusDomain && gameMeta.nexusDomain !== mod.ref.domain) {
    throw new ModError(`That Nexus mod is for ${mod.game.name}, not this game`);
  }
  const here = await nexusModHere(mod);
  if (here && (here.game !== game || here.mod !== slug)) throw new ModAlreadyHere(here);

  let to = slug;
  if (slugify(mod.name) !== slug) {
    to = await uniqueDir(path.join(MODS_DIR, game), mod.name, "mod");
    await fs.rename(dir, path.join(MODS_DIR, game, to));
    for (const ext of IMAGE_EXTS) {
      const old = path.join(IMAGES_DIR, game, `${slug}${ext}`);
      if (await exists(old)) await fs.rename(old, path.join(IMAGES_DIR, game, `${to}${ext}`));
    }
    // The old description's pictures; the new ones are fetched below.
    await fs.rm(path.join(IMAGES_DIR, game, slug), { recursive: true, force: true });
  }

  const images = await localizeDescriptionImages(game, to, mod.description);
  await updateJson<ModJson>(path.join(MODS_DIR, game, to, "mod.json"), (meta) => ({
    ...meta,
    ...nexusWords(mod),
    images,
  }));
  if (mod.pictureUrl) {
    await replaceImage(mod.pictureUrl, `${game}/${to}`);
  } else {
    // The other mod's picture would say this is still that mod.
    for (const ext of IMAGE_EXTS) {
      await fs.unlink(path.join(IMAGES_DIR, game, `${to}${ext}`)).catch(() => undefined);
    }
  }
  return { game, mod: to };
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
  // Copies of the description's pictures; a refresh fetches them again.
  await fs.rm(path.join(IMAGES_DIR, game, slug), { recursive: true, force: true });
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

/** A file's name, version and links, set again without uploading it again. */
export async function labelModFile(
  game: string,
  slug: string,
  input: {
    file?: unknown;
    name?: unknown;
    version?: unknown;
    section?: unknown;
    nexus?: unknown;
    source?: unknown;
  }
): Promise<void> {
  const dir = await modDir(game, slug);
  const file = typeof input.file === "string" ? input.file : "";
  if (!isFileName(file) || !(await exists(path.join(dir, "files", file)))) {
    throw new ModError("No such file", 404);
  }
  const name = fileLabel(input.name, 120);
  const version = fileLabel(input.version, 40);
  const section = fileSection(input.section);
  const nexus = fileNexus(input.nexus);
  const source = fileSource(input.source);
  await updateJson<ModJson>(path.join(dir, "mod.json"), (meta) => ({
    ...meta,
    files: { ...meta.files, [file]: fileJson({ name, version, section, nexus, source }) },
  }));
}

/* ----------------------------------------------------------------- upload */

type Pending = {
  kind: "mod";
  game: string;
  mod: string;
  file: string;
  /** Absent in uploads started before files had names. */
  name?: string;
  version: string;
  /** Absent in uploads started before files had sections. */
  section?: ModFileSection;
  /** Absent in uploads started before files had links. */
  nexus?: string;
  source?: string;
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
  input: {
    file?: unknown;
    bytes?: unknown;
    name?: unknown;
    version?: unknown;
    section?: unknown;
    nexus?: unknown;
    source?: unknown;
  }
): Promise<{ id: string; received: number; chunkBytes: number }> {
  await modDir(game, slug);
  const file = typeof input.file === "string" ? input.file.trim() : "";
  if (!isFileName(file)) throw new ModError("A plain file name is required");
  if (!MOD_EXTENSIONS.includes(path.extname(file).toLowerCase())) {
    throw new ModError(`Only ${MOD_EXTENSIONS.join(", ")} files can be added`);
  }
  const bytes = input.bytes;
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new ModError("bytes must be the file's size");
  }
  if (bytes > MAX_UPLOAD_BYTES) throw new ModError("That file is larger than the store accepts");
  const name = fileLabel(input.name, 120);
  const version = fileLabel(input.version, 40);
  const section = fileSection(input.section);
  // Checked before any byte is sent, not after the last one.
  const nexus = fileNexus(input.nexus);
  const source = fileSource(input.source);

  const id = randomUUID();
  const pending: Pending = {
    kind: "mod",
    game,
    mod: slug,
    file,
    name,
    version,
    section,
    nexus,
    source,
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
  // A file is opened by whatever its name says it is, so it has to be that —
  // decided by its bytes, never its name.
  const format = MOD_FORMATS[path.extname(pending.file).toLowerCase()];
  const magic = (await head(part)).toString("hex");
  if (!format || (format.magic && !format.magic.includes(magic))) {
    await dropPart(id);
    throw new ModError(`That file is not a ${path.extname(pending.file)} file`);
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
    files: {
      ...meta.files,
      [pending.file]: fileJson({
        name: pending.name ?? "",
        version: pending.version,
        section: fileSection(pending.section),
        nexus: pending.nexus ?? "",
        source: pending.source ?? "",
      }),
    },
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
