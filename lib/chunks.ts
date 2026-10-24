/**
 * Big files arriving in pieces — the part of an upload that does not care
 * what the file is for.
 *
 * Two features take gigabyte uploads from a browser: OBB/cache archives on a
 * version (`lib/extras.ts`) and mod archives (`lib/mods.ts`). The store sits
 * behind a proxy that refuses a request body over 100 MB, so both send
 * `CHUNK_BYTES` at a time, each one appended at the offset it names. A chunk
 * whose offset is not where the file ends is refused with the offset the store
 * does have, which is how an interrupted upload picks up again instead of
 * starting over or, worse, appending the same piece twice.
 *
 *   _import/_uploads/<id>.part   the bytes so far
 *   _import/_uploads/<id>.json   what they are meant to become
 *
 * The sidecar is the record, and each feature writes its own shape into it.
 * Where the finished file goes is the feature's business, not this module's.
 */
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { STORE_DIRS, STORE_ROOT } from "./storage";

/** Under the proxy's 100 MB body limit with room to spare. */
export const CHUNK_BYTES = 32 * 1024 * 1024;

/** The largest file accepted. A big game's data is a few GB, not tens. */
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024 * 1024;

/** An unfinished upload older than this is abandoned and cleared away. */
const STALE_MS = 2 * 24 * 60 * 60 * 1000;

export const UPLOAD_DIR = path.join(STORE_ROOT, STORE_DIRS.uploads);

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly received?: number
  ) {
    super(message);
  }
}

/** True for one file name: no separators, not `.` or `..`, not hidden. */
export function isFileName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 200 &&
    !name.startsWith(".") &&
    !/[\0/\\]/.test(name)
  );
}

/** A uuid and nothing else, so an id can never become a path. */
export function isUploadId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
}

export function partPath(id: string): string {
  return path.join(UPLOAD_DIR, `${id}.part`);
}

function sidecarPath(id: string): string {
  return path.join(UPLOAD_DIR, `${id}.json`);
}

/** The sidecar as written, or a 404 — the caller checks that it is its own. */
export async function readSidecar<T>(id: string): Promise<T> {
  if (!isUploadId(id)) throw new UploadError("No such upload", 404);
  try {
    return JSON.parse(await fs.readFile(sidecarPath(id), "utf8")) as T;
  } catch {
    throw new UploadError("No such upload", 404);
  }
}

export async function partSize(id: string): Promise<number> {
  try {
    return (await fs.stat(partPath(id))).size;
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

/** A fresh, empty upload with `sidecar` as its record. */
export async function openPart(id: string, sidecar: object): Promise<void> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await clearStale();
  await fs.writeFile(partPath(id), "");
  await fs.writeFile(sidecarPath(id), JSON.stringify(sidecar, null, 2));
}

/** Both temp files of an upload. */
export async function dropPart(id: string): Promise<void> {
  await fs.unlink(partPath(id)).catch(() => undefined);
  await fs.unlink(sidecarPath(id)).catch(() => undefined);
}

/** The sidecar alone, once the part file has been moved to where it belongs. */
export async function dropSidecar(id: string): Promise<void> {
  await fs.unlink(sidecarPath(id)).catch(() => undefined);
}

// One writer per upload. The page sends chunks one after another, but a retry
// fired while the first attempt is still draining would otherwise interleave
// two appends into one file.
const busy = new Set<string>();

/**
 * Append one chunk at `offset` to a file meant to reach `total` bytes.
 * Returns how much the store now holds.
 */
export async function appendPart(
  id: string,
  offset: number,
  total: number,
  body: ReadableStream<Uint8Array> | null
): Promise<number> {
  if (!body) throw new UploadError("The chunk is empty");
  if (busy.has(id)) throw new UploadError("A chunk for this upload is still arriving", 409);

  busy.add(id);
  const part = partPath(id);
  try {
    const have = await partSize(id);
    if (offset !== have) {
      throw new UploadError("The store has a different amount of this file", 409, have);
    }

    let written = 0;
    const limit = Math.min(CHUNK_BYTES, total - have);
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        written += chunk.length;
        if (written > limit) done(new UploadError("The chunk is larger than allowed"));
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
      if (err instanceof UploadError) throw err;
      throw new UploadError("The chunk did not arrive whole", 400, have);
    }
    return have + written;
  } finally {
    busy.delete(id);
  }
}

/** What the first bytes of a file say it is. */
export async function head(abs: string): Promise<Buffer> {
  const fh = await fs.open(abs, "r");
  try {
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fh.read(buf, 0, 4, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** A zip by its bytes — local file header, or the end record of an empty one. */
export async function isZip(abs: string): Promise<boolean> {
  const magic = (await head(abs)).toString("hex");
  return magic === "504b0304" || magic === "504b0506";
}

export async function moveInto(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.rename(src, dest);
  } catch {
    await fs.cp(src, dest, { recursive: true });
    await fs.rm(src, { recursive: true });
  }
}

/** `dir/name`, with " (2)", " (3)" … appended until nothing is there. */
export async function freeName(dir: string, name: string): Promise<string> {
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
