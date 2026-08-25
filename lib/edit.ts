/**
 * Editing a listing by hand.
 *
 * Everything a source writes is a guess at what an app should be called and
 * how it should be described — a repository name, a Play blurb, a filename.
 * This is where a person overrules that. `lib/sources/play.ts` fills gaps and
 * refuses to overwrite on purpose; the note it leaves ("replacing those is an
 * edit, and an edit belongs in the meta file") is what this module is.
 *
 * The split it enforces is the same one `attachApk` uses: the package id, the
 * pinned signer and the source block are facts read out of a binary or an
 * upstream API, and no form may touch them. Renaming an app is an opinion;
 * repointing its signer is a lie.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { STORE_DIRS, STORE_ROOT } from "@/lib/storage";
import { readMetaRaw, writeMeta } from "@/lib/import";
import {
  findApp,
  invalidateCatalog,
  normaliseHexColor,
  normaliseIconFit,
  type Category,
} from "@/lib/store";
import { fetchImageBytes } from "@/lib/sources/net";

/** What a person owns. Anything not in here is refused, not ignored. */
export const EDITABLE_FIELDS = [
  "name",
  "developer",
  "category",
  "tagline",
  "description",
  "iconBackground",
  "iconFit",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

/**
 * Refused outright rather than silently dropped.
 *
 * A form that quietly discards `signingCert` looks like it worked, and the
 * next person to read the meta file finds the old value and assumes nobody
 * tried. Saying no is the honest answer.
 */
const PROTECTED_FIELDS = ["packageName", "signingCert", "source", "hidden"];

export const CATEGORIES: Category[] = [
  "Editor",
  "Media",
  "Entertainment",
  "Communication",
  "Games",
  "Adults",
  "Other",
];

/** Long enough for a real store description, short enough to stay a file. */
const MAX_LENGTHS: Record<EditableField, number> = {
  name: 120,
  developer: 120,
  category: 40,
  tagline: 300,
  description: 20_000,
  iconBackground: 9,
  iconFit: 8,
};

/** The five text fields, as a form deals with them. */
export const TEXT_FIELDS = [
  "name",
  "developer",
  "category",
  "tagline",
  "description",
] as const;

export type TextField = (typeof TEXT_FIELDS)[number];
export type StoredText = Record<TextField, string>;

/**
 * What the meta file holds, not what the catalog renders.
 *
 * A form seeded from a `StoreApp` is seeded with the read-time fallbacks —
 * "Unknown" for a developer nobody has named, "Other" for a category nobody
 * has chosen — and saving it writes those into the file. That turns a gap the
 * sources are still allowed to fill into a value that outranks them, forever.
 * So the form is seeded from here instead, and shows the fallbacks as
 * placeholder text.
 */
export async function storedText(slug: string): Promise<StoredText> {
  const meta = await readMetaRaw(slug);
  const out = {} as StoredText;
  for (const field of TEXT_FIELDS) {
    const value = meta[field];
    out[field] = typeof value === "string" ? value.trim() : "";
  }
  return out;
}

export type EditPatch = Partial<Record<EditableField, string>>;

export class EditError extends Error {}

/**
 * Validate a patch and write it.
 *
 * An empty string is a deletion, not a value: clearing the tagline should take
 * the key out of the meta file rather than leave `""` behind, so that the
 * catalog's own fallbacks (a title made from the slug, "Unknown" for a
 * developer) come back instead of a blank line.
 */
export async function editApp(slug: string, patch: unknown): Promise<void> {
  const app = await findApp(slug);
  if (!app) throw new EditError("No such app");
  if (!patch || typeof patch !== "object") {
    throw new EditError("Expected an object of fields to change");
  }

  const raw = patch as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (PROTECTED_FIELDS.includes(key)) {
      throw new EditError(
        `${key} is read from the app itself and cannot be edited here`
      );
    }
    if (!(EDITABLE_FIELDS as readonly string[]).includes(key)) {
      throw new EditError(`${key} is not an editable field`);
    }
  }

  const write: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in raw)) continue;
    const value = raw[field];
    if (typeof value !== "string") {
      throw new EditError(`${field} must be a string`);
    }
    const trimmed = value.trim();
    if (trimmed.length > MAX_LENGTHS[field]) {
      throw new EditError(
        `${field} is longer than ${MAX_LENGTHS[field]} characters`
      );
    }
    // An icon drawn as a transparent logo has no plate of its own, and the
    // gradient behind it is the *missing artwork* fallback rather than a
    // choice anyone made. This is where that choice is made. Hex only: the
    // form sends what its colour input produced, and a value that reaches a
    // style attribute is not the place to be generous about spelling.
    if (field === "iconBackground" && trimmed) {
      const colour = normaliseHexColor(trimmed);
      if (!colour) {
        throw new EditError(
          `${trimmed} is not a hex colour like #1b1b1b or #00000000`
        );
      }
      write.iconBackground = colour;
      continue;
    }
    // Two values, and only one of them is worth a key in the file: "cover" is
    // what every icon does without being told, so choosing it is the deletion.
    if (field === "iconFit" && trimmed) {
      if (trimmed.toLowerCase() !== "cover" && !normaliseIconFit(trimmed)) {
        throw new EditError(`${trimmed} is not "cover" or "contain"`);
      }
      write.iconFit = normaliseIconFit(trimmed);
      continue;
    }
    if (field === "category" && trimmed) {
      const hit = CATEGORIES.find(
        (c) => c.toLowerCase() === trimmed.toLowerCase()
      );
      if (!hit) throw new EditError(`${trimmed} is not one of the categories`);
      write.category = hit;
      continue;
    }
    // undefined, not "": writeMeta merges, and JSON.stringify drops undefined,
    // so this is what takes the key out of the file.
    write[field] = trimmed || undefined;
  }

  if (Object.keys(write).length === 0) {
    throw new EditError("Nothing to change");
  }

  await writeMeta(slug, write);
  invalidateCatalog();
}

/* ------------------------------------------------------------------ images */

export type ImageKind = "icon" | "banner" | "screenshot";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * What the bytes actually are.
 *
 * The browser's `File.type` is whatever the operating system guessed from the
 * extension, so it is a claim about the file and not a reading of it. The
 * catalog indexes on the extension, which means a mislabelled upload lands
 * under a name that will never render.
 */
function sniffExtension(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString("latin1", 1, 4) === "PNG") return ".png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.toString("latin1", 0, 6) === "GIF87a") return ".gif";
  if (buf.toString("latin1", 0, 6) === "GIF89a") return ".gif";
  if (
    buf.toString("latin1", 0, 4) === "RIFF" &&
    buf.toString("latin1", 8, 12) === "WEBP"
  ) {
    return ".webp";
  }
  // ISO-BMFF: "ftyp" at byte 4, with an AVIF brand.
  if (buf.toString("latin1", 4, 8) === "ftyp") {
    const brand = buf.toString("latin1", 8, 12);
    if (brand === "avif" || brand === "avis") return ".avif";
  }
  return null;
}

/** Every file the library holds for this app under one image kind. */
async function existingFiles(slug: string, kind: ImageKind): Promise<string[]> {
  if (kind === "screenshot") {
    const dir = path.join(STORE_ROOT, STORE_DIRS.screenshots, slug);
    return (await fs.readdir(dir).catch(() => [])).map((f) =>
      path.join(dir, f)
    );
  }
  const dir = path.join(
    STORE_ROOT,
    kind === "icon" ? STORE_DIRS.icons : STORE_DIRS.banners
  );
  const files = await fs.readdir(dir).catch(() => []);
  return files
    .filter((f) => f.slice(0, -path.extname(f).length) === slug)
    .map((f) => path.join(dir, f));
}

export type SavedImage = { kind: ImageKind; file: string; bytes: number };

/**
 * Put one uploaded image on an app.
 *
 * An icon and a banner are singular, so a new one replaces whatever was there
 * — including under a different extension, which is why the old files are
 * cleared rather than overwritten. Screenshots are a list and append.
 */
export async function saveUpload(
  slug: string,
  kind: ImageKind,
  bytes: Buffer
): Promise<SavedImage> {
  const app = await findApp(slug);
  if (!app) throw new EditError("No such app");
  if (bytes.byteLength === 0) throw new EditError("That file is empty");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new EditError(
      `${Math.round(bytes.byteLength / 1024 / 1024)} MB is larger than the 8 MB limit`
    );
  }

  const ext = sniffExtension(bytes);
  if (!ext) {
    throw new EditError(
      "that file is not a PNG, JPEG, WebP, GIF or AVIF — whatever it is named"
    );
  }

  if (kind === "screenshot") {
    const dir = path.join(STORE_ROOT, STORE_DIRS.screenshots, slug);
    await fs.mkdir(dir, { recursive: true });
    // Numbered so the catalog's numeric sort keeps the order they arrived in.
    const taken = (await fs.readdir(dir).catch(() => []))
      .map((f) => Number(path.basename(f, path.extname(f))))
      .filter((n) => Number.isFinite(n));
    const next = (taken.length ? Math.max(...taken) : 0) + 1;
    const file = `${next}${ext}`;
    await fs.writeFile(path.join(dir, file), bytes);
    invalidateCatalog();
    return { kind, file, bytes: bytes.byteLength };
  }

  const dir = path.join(
    STORE_ROOT,
    kind === "icon" ? STORE_DIRS.icons : STORE_DIRS.banners
  );
  await fs.mkdir(dir, { recursive: true });
  // Write the new one first: a crash between the two leaves two icons, which
  // the catalog resolves by extension order, rather than none at all.
  await fs.writeFile(path.join(dir, `${slug}${ext}`), bytes);
  for (const old of await existingFiles(slug, kind)) {
    if (path.basename(old) !== `${slug}${ext}`) await fs.rm(old).catch(() => {});
  }
  invalidateCatalog();
  return { kind, file: `${slug}${ext}`, bytes: bytes.byteLength };
}

/**
 * The same, for an image that lives somewhere else.
 *
 * Most artwork worth having is already on the internet — a repo's avatar, a
 * screenshot in a README — and saving it to disk first only to pick it out of
 * a file dialog is a detour. The bytes still go through `saveUpload`, so a
 * URL and an upload are judged by exactly the same reading of the file.
 *
 * A typed URL is the one address this server fetches that did not come from
 * an upstream it just read, which is why `fetchImageBytes` refuses a host on
 * this machine's own network. Admin-gated is not the same as harmless: the
 * container can reach services that the internet cannot.
 */
export async function saveFromUrl(
  slug: string,
  kind: ImageKind,
  url: unknown
): Promise<SavedImage> {
  const app = await findApp(slug);
  if (!app) throw new EditError("No such app");
  if (typeof url !== "string" || !url.trim()) {
    throw new EditError("url is required");
  }

  let bytes: Buffer;
  try {
    bytes = await fetchImageBytes(url.trim(), {
      tag: `edit:${slug}`,
      maxBytes: MAX_UPLOAD_BYTES,
    });
  } catch (err) {
    // The person is looking at the field they typed it into, so the reason
    // has to reach them — a generic failure sends them hunting the wrong bug.
    throw new EditError(
      `could not fetch that image: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return saveUpload(slug, kind, bytes);
}

/**
 * Take an image off an app.
 *
 * `file` names one screenshot; without it every image of that kind goes. The
 * name is compared against what the directory actually holds rather than
 * joined onto a path, so a traversal has nothing to match.
 */
export async function removeImage(
  slug: string,
  kind: ImageKind,
  file?: string
): Promise<number> {
  const app = await findApp(slug);
  if (!app) throw new EditError("No such app");

  const held = await existingFiles(slug, kind);
  const targets = file
    ? held.filter((p) => path.basename(p) === file)
    : held;
  if (file && targets.length === 0) {
    throw new EditError("That app has no such image");
  }
  for (const target of targets) await fs.rm(target).catch(() => {});
  invalidateCatalog();
  return targets.length;
}
