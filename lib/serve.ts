/**
 * Serving files out of the library.
 *
 * The store's files live at STORE_ROOT, outside the repo, so `public/` cannot
 * reach them — every icon, banner, screenshot and APK goes through a route
 * handler instead. Both handlers share this module so the path check that
 * keeps a request inside the library is written once.
 */
import { createReadStream } from "node:fs";
import { promises as fs, type Stats } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { STORE_ROOT } from "./storage";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".apk": "application/vnd.android.package-archive",
  ".xapk": "application/octet-stream",
  ".apks": "application/octet-stream",
  ".apkm": "application/octet-stream",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * An absolute path inside the library, or null.
 *
 * Null for anything that escapes STORE_ROOT — `..`, an absolute segment, a
 * symlink pointing out of the tree. The check is on the *resolved* path, so it
 * holds however the caller spelled the request.
 */
export async function resolveInStore(
  ...segments: string[]
): Promise<string | null> {
  if (segments.some((s) => !s || s.includes("\0"))) return null;

  const root = path.resolve(STORE_ROOT);
  const abs = path.resolve(root, ...segments);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;

  // A symlink inside the library could still point outside it.
  let real: string;
  try {
    real = await fs.realpath(abs);
  } catch {
    return null;
  }
  const realRoot = await fs.realpath(root).catch(() => root);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;

  return real;
}

function parseRange(
  header: string | null,
  size: number
): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;

  let start: number;
  let end: number;
  if (rawStart === "") {
    // "bytes=-500" — the last 500 bytes.
    const len = Number(rawEnd);
    if (!Number.isFinite(len) || len <= 0) return null;
    start = Math.max(0, size - len);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

/**
 * Stream a file, honouring `Range` so an interrupted APK download resumes
 * instead of starting over — which matters on a phone at 200 MB.
 */
export function fileResponse(
  abs: string,
  stat: Stats,
  req: Request,
  opts: {
    contentType?: string;
    /** Sends Content-Disposition: attachment with this name. */
    download?: string;
    /** For URLs that carry a version in the query string. */
    immutable?: boolean;
  } = {}
): Response {
  const etag = `"${stat.size.toString(36)}-${Math.round(stat.mtimeMs).toString(36)}"`;
  const headers = new Headers({
    "Content-Type": opts.contentType ?? contentTypeFor(abs),
    "Accept-Ranges": "bytes",
    "Last-Modified": new Date(stat.mtimeMs).toUTCString(),
    ETag: etag,
    "Cache-Control": opts.immutable
      ? "public, max-age=31536000, immutable"
      : "public, max-age=60, must-revalidate",
  });
  if (opts.download) {
    // The name can hold anything a file name can; quote it and strip what
    // would break the header.
    const safe = opts.download.replace(/["\\\r\n]/g, "_");
    headers.set(
      "Content-Disposition",
      `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(opts.download)}`
    );
  }

  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  const range = parseRange(req.headers.get("range"), stat.size);
  if (range) {
    const { start, end } = range;
    headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    headers.set("Content-Length", String(end - start + 1));
    const stream = Readable.toWeb(
      createReadStream(abs, { start, end })
    ) as ReadableStream;
    return new Response(stream, { status: 206, headers });
  }

  headers.set("Content-Length", String(stat.size));
  const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream;
  return new Response(stream, { status: 200, headers });
}

export { fs as serveFs };
