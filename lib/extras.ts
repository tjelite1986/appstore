/**
 * OBB and cache archives: the files a large game needs beside its APK.
 *
 * They live in the version folder next to the APK (see `AppExtraFile` in
 * `lib/store.ts`), so the reader, the merge and the prune all carry them along
 * with the build they belong to. This module is how one gets there from a
 * browser.
 *
 * **Uploads arrive in pieces.** These files run to gigabytes, and the store
 * sits behind a proxy that refuses a request body over 100 MB — so the page
 * sends `CHUNK_BYTES` at a time, each one appended at the offset it names. A
 * chunk whose offset is not where the file ends is refused with the offset the
 * store does have, which is how an interrupted upload picks up again instead
 * of starting over or, worse, appending the same piece twice.
 *
 *   _import/_uploads/<id>.part   the bytes so far
 *   _import/_uploads/<id>.json   what they are meant to become
 *
 * The sidecar is the record, as it is in the review queue. When the last byte
 * lands the part file is checked and moved into `apks/<slug>/<version>/`; a
 * file already there under that name goes to `_import/_discarded/` first.
 */
import { randomUUID } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { STORE_DIRS, STORE_ROOT } from "./storage";
import { DISCARD_DIR } from "./import";
import { EXTRA_EXTENSIONS, getCatalog, invalidateCatalog, type StoreApp } from "./store";

/** Under the proxy's 100 MB body limit with room to spare. */
export const CHUNK_BYTES = 32 * 1024 * 1024;

/** The largest file accepted. A big game's data is a few GB, not tens. */
const MAX_BYTES = 16 * 1024 * 1024 * 1024;

/** An unfinished upload older than this is abandoned and cleared away. */
const STALE_MS = 2 * 24 * 60 * 60 * 1000;

const UPLOAD_DIR = path.join(STORE_ROOT, STORE_DIRS.uploads);

export class ExtraError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly received?: number
  ) {
    super(message);
  }
}

type Pending = {
  slug: string;
  version: string;
  file: string;
  bytes: number;
  started: string;
};

/** True for one file name: no separators, not `.` or `..`, not hidden. */
function isFileName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 200 &&
    !name.startsWith(".") &&
    !/[\0/\\]/.test(name)
  );
}

/** A uuid and nothing else, so an id can never become a path. */
function isUploadId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
}

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
  if (!isUploadId(id)) throw new ExtraError("No such upload", 404);
  try {
    return JSON.parse(await fs.readFile(path.join(UPLOAD_DIR, `${id}.json`), "utf8"));
  } catch {
    throw new ExtraError("No such upload", 404);
  }
}

async function partSize(id: string): Promise<number> {
  try {
    return (await fs.stat(path.join(UPLOAD_DIR, `${id}.part`))).size;
  } catch {
    return 0;
  }
}

/** Unfinished uploads nobody came back for. Only this module's own temp files. */
async function clearStale(): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(UPLOAD_DIR);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of names) {
    if (!/\.(part|json)$/.test(name) || !isUploadId(name.replace(/\.(part|json)$/, ""))) {
      continue;
    }
    const abs = path.join(UPLOAD_DIR, name);
    try {
      if (now - (await fs.stat(abs)).mtimeMs > STALE_MS) await fs.unlink(abs);
    } catch {
      /* gone already */
    }
  }
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
  if (bytes > MAX_BYTES) throw new ExtraError("That file is larger than the store accepts");

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await clearStale();

  const id = randomUUID();
  const pending: Pending = {
    slug,
    version: input.version,
    file,
    bytes,
    started: new Date().toISOString(),
  };
  await fs.writeFile(path.join(UPLOAD_DIR, `${id}.part`), "");
  await fs.writeFile(path.join(UPLOAD_DIR, `${id}.json`), JSON.stringify(pending, null, 2));
  return { id, received: 0, chunkBytes: CHUNK_BYTES };
}

// One writer per upload. The page sends chunks one after another, but a retry
// fired while the first attempt is still draining would otherwise interleave
// two appends into one file.
const busy = new Set<string>();

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
  if (!body) throw new ExtraError("The chunk is empty");
  if (busy.has(id)) throw new ExtraError("A chunk for this upload is still arriving", 409);

  busy.add(id);
  const part = path.join(UPLOAD_DIR, `${id}.part`);
  try {
    const have = await partSize(id);
    if (offset !== have) {
      throw new ExtraError("The store has a different amount of this file", 409, have);
    }

    let written = 0;
    const limit = Math.min(CHUNK_BYTES, pending.bytes - have);
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        written += chunk.length;
        if (written > limit) done(new ExtraError("The chunk is larger than allowed"));
        else done(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(body as WebReadableStream<Uint8Array>),
        counter,
        createWriteStream(part, { flags: "a" })
      );
    } catch (err) {
      // Back to where this chunk started, so the next attempt's offset is
      // right. A half-appended chunk would otherwise be counted as received.
      await fs.truncate(part, have).catch(() => undefined);
      if (err instanceof ExtraError) throw err;
      throw new ExtraError("The chunk did not arrive whole", 400, have);
    }

    const received = have + written;
    if (received < pending.bytes) return { received, done: false };
    return { received, done: true, file: await finish(id, pending) };
  } finally {
    busy.delete(id);
  }
}

/** What the first bytes of a file say it is. */
async function head(abs: string): Promise<Buffer> {
  const fh = await fs.open(abs, "r");
  try {
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fh.read(buf, 0, 4, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function moveInto(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.rename(src, dest);
  } catch {
    await fs.copyFile(src, dest);
    await fs.unlink(src);
  }
}

/** `dir/name`, with " (2)", " (3)" … appended until nothing is there. */
async function freeName(dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let candidate = path.join(dir, name);
  for (let n = 2; ; n++) {
    try {
      await fs.stat(candidate);
    } catch {
      return candidate;
    }
    candidate = path.join(dir, `${stem} (${n})${ext}`);
  }
}

async function finish(id: string, pending: Pending): Promise<string> {
  const part = path.join(UPLOAD_DIR, `${id}.part`);
  // A .zip is read by whoever unpacks it, so it has to be one — decided by
  // its bytes, never its name. An .obb has no fixed header (some are zips,
  // some are a game's own format), so its name is all there is to go on.
  if (path.extname(pending.file).toLowerCase() === ".zip") {
    const magic = (await head(part)).toString("hex");
    if (magic !== "504b0304" && magic !== "504b0506") {
      await fs.unlink(part).catch(() => undefined);
      await fs.unlink(path.join(UPLOAD_DIR, `${id}.json`)).catch(() => undefined);
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
  await fs.unlink(path.join(UPLOAD_DIR, `${id}.json`)).catch(() => undefined);
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
  await fs.unlink(path.join(UPLOAD_DIR, `${id}.part`)).catch(() => undefined);
  await fs.unlink(path.join(UPLOAD_DIR, `${id}.json`)).catch(() => undefined);
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
