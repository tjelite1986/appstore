/**
 * The outbound half of a source: bytes fetched from somewhere that is not this
 * machine.
 *
 * Every source needs the same two things — a picture for the shelf and, when
 * the upstream serves binaries, the APK itself — and both have the same two
 * hazards. A remote host can serve far more than it announced, and it can
 * answer 200 with a login page. So size is counted as it arrives rather than
 * read off `content-length`, and a downloaded file is judged by its first
 * bytes rather than by the name it was requested under.
 */
import { createWriteStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

/** Named so a repo owner reading their traffic knows who this is. */
export const USER_AGENT = "astore/1.0 (+https://store.example.com)";

const IMAGE_TIMEOUT_MS = 15_000;
// A store listing image is a few hundred KB. Anything past this is not one,
// and the library is not the place to find out what it is instead.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Room above the biggest thing the library holds — a 244 MB patched client. */
export const MAX_APK_BYTES = 900 * 1024 * 1024;
// A 400 MB release over a home line, with the far end setting the rate.
const APK_TIMEOUT_MS = 30 * 60_000;

const IMAGE_EXT_BY_TYPE: Record<string, string> = {
  "image/webp": ".webp",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

/**
 * One image into the library, or nothing.
 *
 * A listing that arrives without its screenshots is worth having; a create
 * that fails halfway because the far end rate-limited the fourth thumbnail is
 * not. So every image failure is logged and swallowed — the meta file is the
 * part that has to land.
 */
export async function saveImage(
  url: string,
  destNoExt: string,
  tag: string
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    const ext = IMAGE_EXT_BY_TYPE[type];
    // The extension is what the catalog indexes on, so a body of unknown type
    // has nowhere to go — better absent than saved under a guessed name.
    if (!ext) throw new Error(`unexpected content-type ${type || "(none)"}`);

    const body = Buffer.from(await res.arrayBuffer());
    if (body.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`${body.byteLength} bytes is not a listing image`);
    }

    await fs.mkdir(path.dirname(destNoExt), { recursive: true });
    await fs.writeFile(`${destNoExt}${ext}`, body);
    return true;
  } catch (err) {
    console.error(`[${tag}] could not save ${url}:`, err);
    return false;
  }
}

/**
 * Stream a URL to a path, and leave nothing behind if it goes wrong.
 *
 * `content-length` is a claim by the far end, so it only earns an early
 * refusal; the running count is what actually stops a body that keeps coming.
 */
export async function downloadFile(
  url: string,
  dest: string,
  opts: { tag: string; maxBytes?: number }
): Promise<number> {
  const max = opts.maxBytes ?? MAX_APK_BYTES;
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "*/*" },
    signal: AbortSignal.timeout(APK_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`the download answered HTTP ${res.status}`);
  if (!res.body) throw new Error("the download answered with no body");

  const announced = Number(res.headers.get("content-length") ?? 0);
  if (announced > max) {
    throw new Error(`${announced} bytes is more than this store will fetch`);
  }

  await fs.mkdir(path.dirname(dest), { recursive: true });
  let bytes = 0;
  try {
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          bytes += chunk.length;
          if (bytes > max) throw new Error(`the body passed ${max} bytes`);
          yield chunk;
        }
      },
      createWriteStream(dest)
    );
  } catch (err) {
    // A half-written file under _import/ is worse than no file: the importer
    // would find it later and try to make sense of it.
    await fs.unlink(dest).catch(() => {});
    throw err;
  }
  console.log(`[${opts.tag}] ${bytes} bytes from ${url}`);
  return bytes;
}

/**
 * True when the file starts with a zip signature.
 *
 * Every APK is a zip. A host that has decided this request needs a login, and
 * a mirror that has moved, both still answer 200 — with HTML — and the name
 * the file was saved under says nothing about that.
 */
export async function looksLikeApk(abs: string): Promise<boolean> {
  let fh: fs.FileHandle | undefined;
  try {
    fh = await fs.open(abs, "r");
    const head = Buffer.alloc(2);
    const { bytesRead } = await fh.read(head, 0, 2, 0);
    return bytesRead === 2 && head.toString("latin1") === "PK";
  } catch {
    return false;
  } finally {
    await fh?.close().catch(() => {});
  }
}
