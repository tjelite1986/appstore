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
import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

/** Named so a repo owner reading their traffic knows who this is. */
export const USER_AGENT =
  "astore/1.0 (+https://github.com/tjelite1986/appstore)";

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
 * One listing image, fetched and checked, or nothing.
 *
 * A listing that arrives without its screenshots is worth having; a create
 * that fails halfway because the far end rate-limited the fourth thumbnail is
 * not. So every image failure is logged and swallowed — the meta file is the
 * part that has to land.
 *
 * The URL always comes from an upstream listing this server just read, never
 * from a request — which is what makes fetching it without a host allowlist
 * reasonable. `/api/sources/play/icon` takes one from the browser and has an
 * allowlist for exactly that reason.
 */
async function fetchImage(
  url: string,
  tag: string
): Promise<{ ext: string; type: string; body: Buffer } | null> {
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
    return { ext, type, body };
  } catch (err) {
    console.error(`[${tag}] could not fetch ${url}:`, err);
    return null;
  }
}

/** One image into the library, or nothing. */
export async function saveImage(
  url: string,
  destNoExt: string,
  tag: string
): Promise<boolean> {
  const image = await fetchImage(url, tag);
  if (!image) return false;
  try {
    await fs.mkdir(path.dirname(destNoExt), { recursive: true });
    await fs.writeFile(`${destNoExt}${image.ext}`, image.body);
    return true;
  } catch (err) {
    console.error(`[${tag}] could not save ${url}:`, err);
    return false;
  }
}

/**
 * The same image, inlined for a page rather than written to the library.
 *
 * A preview of something not added yet has nowhere on disk to live, and the
 * obvious alternative — pointing an `<img>` at the icon proxy — only works for
 * whoever is signed in by cookie. The proxy is admin-gated, and an `<img>`
 * carries no header, so the person holding the shared token instead sees a
 * broken image exactly where they are being asked to recognise an app.
 */
export async function fetchImageDataUrl(
  url: string,
  tag: string
): Promise<string | null> {
  const image = await fetchImage(url, tag);
  return image ? `data:${image.type};base64,${image.body.toString("base64")}` : null;
}

/* ------------------------------------------- an image somebody typed in */

/**
 * True when an address is on a network this machine can reach but the
 * internet cannot.
 *
 * `fetchImageBytes` is the one function here whose URL comes from a form, so
 * it is the one that can be pointed at the docker network, at the host, or at
 * a cloud metadata service. Every other fetch in this module reads a URL that
 * an upstream listing just handed us.
 */
function isInternalAddress(ip: string): boolean {
  // An IPv4-mapped IPv6 address is the same address wearing a hat.
  const v4 = ip.toLowerCase().startsWith("::ffff:") ? ip.slice(7) : ip;
  const quad = v4.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (quad) {
    const [a, b] = quad.slice(1).map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local, metadata included
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    return false;
  }
  const low = ip.toLowerCase();
  if (low === "::" || low === "::1") return true;
  // fc00::/7 unique-local, fe80::/10 link-local.
  return /^f[cd]/.test(low) || /^fe[89ab]/.test(low);
}

/** How far a chain of redirects may run before it is just a loop. */
const MAX_REDIRECTS = 5;

/**
 * The address the socket will actually use, checked before it is used.
 *
 * Resolving the name first and then handing the *name* to a fetcher that
 * resolves it again is not a check — the second answer can differ from the
 * one that passed, and a host that controls its own DNS can arrange exactly
 * that. Validating inside the lookup closes it: what this function returns is
 * what the connection is made to, and there is no second resolution to
 * disagree with it.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, options as never, (err, address, family) => {
    if (err) return (callback as (e: Error | null) => void)(err);

    // With autoSelectFamily the caller asks for every address at once, so this
    // is handed either one address or a list of them.
    if (Array.isArray(address)) {
      const usable = address.filter((a) => !isInternalAddress(a.address));
      if (usable.length === 0) {
        return (callback as (e: Error | null) => void)(
          new Error(`${hostname} is ${address[0]?.address}, on this machine's own network`)
        );
      }
      return (callback as (e: Error | null, a: unknown) => void)(null, usable);
    }

    if (isInternalAddress(String(address))) {
      return (callback as (e: Error | null) => void)(
        new Error(`${hostname} is ${address}, on this machine's own network`)
      );
    }
    callback(null, String(address), family);
  });
};

/**
 * Refuse an address written as digits.
 *
 * `guardedLookup` never sees one: `net.connect` uses a literal as it stands
 * rather than resolving it, so an IP in the URL would walk straight past the
 * only check there is. Called per hop, before the request is made.
 */
function refuseInternalLiteral(target: URL): void {
  const host = target.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isInternalAddress(host)) {
    throw new Error(`${host} is on this machine's own network`);
  }
}

/** One request, connected only to an address `guardedLookup` allowed. */
function requestOnce(
  target: URL,
  timeoutMs: number
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const mod = target.protocol === "https:" ? https : http;
    const req = mod.get(
      target,
      {
        headers: { "user-agent": USER_AGENT, accept: "image/*,*/*" },
        lookup: guardedLookup,
        timeout: timeoutMs,
      },
      resolve
    );
    req.on("timeout", () =>
      req.destroy(new Error("that address did not answer in time"))
    );
    req.on("error", reject);
  });
}

/**
 * A remote image as bytes, for a URL that came from a request.
 *
 * Unlike `fetchImage` this throws rather than swallowing: the person typing
 * the address is waiting to hear whether it worked, and a silent null would
 * read as "saved". It also asks nothing of `content-type` — the caller hands
 * the bytes to `saveUpload`, which decides what they are by reading them.
 *
 * Redirects are followed by hand rather than by the fetcher, because a
 * followed redirect is a request that already happened: by the time a
 * response object can be examined, the hop into the docker network has been
 * made and answered. Here every hop is a fresh `requestOnce`, so each one is
 * gated by the lookup before a socket opens.
 */
export async function fetchImageBytes(
  raw: string,
  opts: { tag: string; maxBytes?: number }
): Promise<Buffer> {
  const max = opts.maxBytes ?? MAX_IMAGE_BYTES;

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new Error("that is not a URL");
  }

  let res: http.IncomingMessage;
  let hops = 0;
  for (;;) {
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      throw new Error(
        `${target.protocol.replace(":", "")} is not a URL this store will fetch`
      );
    }
    refuseInternalLiteral(target);
    res = await requestOnce(target, IMAGE_TIMEOUT_MS);
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (status >= 300 && status < 400 && location) {
      res.resume(); // let the socket go before opening the next one
      if (++hops > MAX_REDIRECTS) {
        throw new Error("that address redirects further than this store follows");
      }
      target = new URL(location, target);
      continue;
    }
    if (status !== 200) {
      res.resume();
      throw new Error(`that address answered HTTP ${status}`);
    }
    break;
  }

  const announced = Number(res.headers["content-length"] ?? 0);
  if (announced > max) {
    res.resume();
    throw new Error(`${announced} bytes is not a listing image`);
  }

  // Counted as it arrives: content-length is the far end's claim about a body
  // it has not sent yet.
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of res as AsyncIterable<Buffer>) {
    bytes += chunk.length;
    if (bytes > max) {
      res.destroy();
      throw new Error(`the body passed ${max} bytes`);
    }
    chunks.push(chunk);
  }
  console.log(`[${opts.tag}] ${bytes} bytes from ${target.href}`);
  return Buffer.concat(chunks);
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
