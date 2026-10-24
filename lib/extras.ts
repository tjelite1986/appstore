/**
 * OBB and cache archives: the files a large game needs beside its APK.
 *
 * They live in the version folder next to the APK (see `AppExtraFile` in
 * `lib/store.ts`), so the reader, the merge and the prune all carry them along
 * with the build they belong to. This module is how one gets there from a
 * browser.
 *
 * **Uploads arrive in pieces** — see `lib/chunks.ts` for why and how.
 *
 * The sidecar is the record, as it is in the review queue. When the last byte
 * lands the part file is checked and moved into `apks/<slug>/<version>/`; a
 * file already there under that name goes to `_import/_discarded/` first.
 */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { STORE_DIRS, STORE_ROOT } from "./storage";
import { DISCARD_DIR } from "./import";
import { EXTRA_EXTENSIONS, getCatalog, invalidateCatalog, type StoreApp } from "./store";
import {
  appendPart,
  CHUNK_BYTES,
  dropPart,
  dropSidecar,
  freeName,
  isFileName,
  isZip,
  MAX_UPLOAD_BYTES,
  moveInto,
  openPart,
  partPath,
  partSize,
  readSidecar,
  UploadError,
} from "./chunks";

export { CHUNK_BYTES };

/** The shared upload error, under the name this module's route catches. */
export const ExtraError = UploadError;

type Pending = {
  slug: string;
  version: string;
  file: string;
  bytes: number;
  started: string;
};

async function realApp(slug: string): Promise<StoreApp> {
  const catalog = await getCatalog();
  // Never the placeholder catalog: a file uploaded to an example slug would
  // land in a folder that then makes the example look real.
  const app = catalog.placeholder
    ? undefined
    : catalog.apps.find((a) => a.slug === slug);
  if (!app) throw new ExtraError("No such app", 404);
  return app;
}

async function versionDir(slug: string, version: string): Promise<string> {
  const app = await realApp(slug);
  // A version folder only counts as one with an APK in it, and that is the
  // folder this goes into — never one invented from the request.
  const hit = app.versions.find((v) => v.version === version);
  if (!hit) throw new ExtraError("That version has no APK in this store");
  return path.join(STORE_ROOT, STORE_DIRS.apks, app.slug, hit.version);
}

function checkName(file: unknown): string {
  if (typeof file !== "string" || !isFileName(file.trim())) {
    throw new ExtraError("A plain file name is required");
  }
  const name = file.trim();
  if (!EXTRA_EXTENSIONS.includes(path.extname(name).toLowerCase())) {
    throw new ExtraError(`Only ${EXTRA_EXTENSIONS.join(" and ")} files can be added`);
  }
  return name;
}

async function readPending(id: string): Promise<Pending> {
  return readSidecar<Pending>(id);
}

/**
 * Open an upload. The answer carries the id every chunk names.
 *
 * Starting the same file again is a new upload; resuming one is the page's
 * job, by sending the next chunk to the id it already has.
 */
export async function startUpload(
  slug: string,
  input: { version?: unknown; file?: unknown; bytes?: unknown }
): Promise<{ id: string; received: number; chunkBytes: number }> {
  if (typeof input.version !== "string") throw new ExtraError("version is required");
  await versionDir(slug, input.version);
  const file = checkName(input.file);
  const bytes = input.bytes;
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new ExtraError("bytes must be the file's size");
  }
  if (bytes > MAX_UPLOAD_BYTES) throw new ExtraError("That file is larger than the store accepts");

  const id = randomUUID();
  const pending: Pending = {
    slug,
    version: input.version,
    file,
    bytes,
    started: new Date().toISOString(),
  };
  await openPart(id, pending);
  return { id, received: 0, chunkBytes: CHUNK_BYTES };
}

/**
 * Append one chunk at `offset`. Returns how much the store now holds, and the
 * finished file's name once the last byte is in.
 */
export async function appendChunk(
  slug: string,
  id: string,
  offset: number,
  body: ReadableStream<Uint8Array> | null
): Promise<{ received: number; done: boolean; file?: string }> {
  const pending = await readPending(id);
  if (pending.slug !== slug) throw new ExtraError("No such upload", 404);
  const received = await appendPart(id, offset, pending.bytes, body);
  if (received < pending.bytes) return { received, done: false };
  return { received, done: true, file: await finish(id, pending) };
}

async function finish(id: string, pending: Pending): Promise<string> {
  const part = partPath(id);
  // A .zip is read by whoever unpacks it, so it has to be one — decided by
  // its bytes, never its name. An .obb has no fixed header (some are zips,
  // some are a game's own format), so its name is all there is to go on.
  if (path.extname(pending.file).toLowerCase() === ".zip") {
    if (!(await isZip(part))) {
      await dropPart(id);
      throw new ExtraError("That file is not a zip archive");
    }
  }

  const dir = await versionDir(pending.slug, pending.version);
  const dest = path.join(dir, pending.file);
  try {
    await fs.stat(dest);
    await moveInto(
      dest,
      await freeName(path.join(DISCARD_DIR, pending.slug, pending.version), pending.file)
    );
  } catch {
    /* nothing there to replace */
  }
  await moveInto(part, dest);
  await dropSidecar(id);
  invalidateCatalog();
  return pending.file;
}

/** How much of an upload the store holds — where a resumed page carries on. */
export async function uploadStatus(
  slug: string,
  id: string
): Promise<{ received: number; bytes: number }> {
  const pending = await readPending(id);
  if (pending.slug !== slug) throw new ExtraError("No such upload", 404);
  return { received: await partSize(id), bytes: pending.bytes };
}

/** Give up on an upload. Only its own temp files go. */
export async function cancelUpload(slug: string, id: string): Promise<void> {
  const pending = await readPending(id);
  if (pending.slug !== slug) throw new ExtraError("No such upload", 404);
  await dropPart(id);
}

/**
 * Take an extra off a version. Moved to `_import/_discarded/`, not deleted —
 * a gigabyte someone uploaded over an evening is not undone by one click.
 */
export async function removeExtra(
  slug: string,
  version: string,
  file: string
): Promise<void> {
  const app = await realApp(slug);
  const hit = app.versions
    .find((v) => v.version === version)
    ?.extras.find((x) => x.file === file);
  if (!hit) throw new ExtraError("No such file", 404);
  await moveInto(
    path.join(STORE_ROOT, STORE_DIRS.apks, app.slug, version, hit.file),
    await freeName(path.join(DISCARD_DIR, app.slug, version), hit.file)
  );
  invalidateCatalog();
}
