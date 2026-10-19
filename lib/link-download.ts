/**
 * Fetching an APK that was handed over as an address.
 *
 * Two callers: the Telegram feed, for links posted to a channel, and the admin
 * panel, for an apkmb page pasted into "Add an app". Both drop the file into
 * `_import/` and leave the rest to the importer — nothing here knows about the
 * catalog.
 *
 * The one rule is that the response has to prove it is an APK. A login wall
 * or a "click here to download" page answers 200 with HTML, so the bytes go
 * through the same manifest reader the importer uses. No package name, no file.
 */
import { promises as fs, statfsSync } from "node:fs";
import path from "node:path";
import { STORE_DIRS, STORE_ROOT } from "./storage";
import { readApkInfo } from "./apk-manifest";
import { BROWSER_USER_AGENT, openGuarded } from "./sources/net";
import { apkmbDownloadLinks } from "./sources/apkmb";

export const DROP_DIR = path.join(STORE_ROOT, STORE_DIRS.import);

export const APK_EXT = /\.(apk|xapk|apks|apkm)$/i;
/** Path separators and control characters — nothing else is touched. */
const UNSAFE_NAME = new RegExp("[/\\\\]|[\\u0000-\\u001f]", "g");

/** Links followed per message or page. A post is not a link farm. */
export const MAX_LINKS = 3;
/** A transfer that has not moved a byte for this long is abandoned. */
const LINK_IDLE_MS = 60_000;
/**
 * And a ceiling on top of the idle timer: a mirror that trickles bytes just
 * often enough never trips idle, and one link must not eat the whole run —
 * the Telegram timer gives up on the run itself at forty minutes.
 */
export const LINK_DEADLINE_MS = 15 * 60_000;

/** A verdict, not a failure: these bytes are not an APK, so retrying is pointless. */
export class NotAnApk extends Error {}

/** Room left on the disk the drop folder sits on. Unknown counts as plenty. */
export function freeBytes(dir: string): number {
  try {
    const st = statfsSync(dir);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const mb = (bytes: number) => (bytes / 1048576).toFixed(1);

function msgOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The rest of the upload name — version, mod-site credit — is exactly what the
 * import parser reads, so only what could escape the directory is removed.
 */
export function safeName(name: string): string {
  return name.replace(UNSAFE_NAME, "_").trim();
}

/**
 * A free name in the drop folder — a repost must not overwrite the first copy.
 * `suffix` tells the two copies apart: `tg<message id>` from the feed.
 */
export async function claimName(raw: string, suffix: string): Promise<string> {
  const fileName = safeName(raw);
  const taken = await fs
    .stat(path.join(DROP_DIR, fileName))
    .then(() => true, () => false);
  if (!taken) return fileName;
  const ext = path.extname(fileName);
  return `${path.basename(fileName, ext)}-${suffix}${ext}`;
}

/**
 * What to call a fetched file.
 *
 * The import parser reads the name for the app's name and version, so the
 * server's own name is kept whenever it gives one. A name is invented only
 * when there is nothing to keep — and it must carry an APK extension, because
 * the importer skips every file that does not.
 */
function linkFileName(
  requested: string,
  finalUrl: string,
  disposition: string,
  info: { packageName: string | null; versionName: string | null }
): string {
  const star = /filename\*=\s*(?:UTF-8'')?([^;]+)/i.exec(disposition);
  const plain = /filename=\s*"?([^";]+)"?/i.exec(disposition);
  const fallback = (plain?.[1] ?? "").trim().replace(/^"|"$/g, "");
  let name = fallback;
  if (star) {
    try {
      name = decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      name = fallback;
    }
  }
  if (!name) {
    try {
      name = decodeURIComponent(path.basename(new URL(finalUrl || requested).pathname));
    } catch {
      name = "";
    }
  }
  if (APK_EXT.test(name)) return name;
  const stem = name.replace(/\.[a-z0-9]{1,5}$/i, "").trim() || info.packageName || "telegram-link";
  return `${stem}${info.versionName ? `_v${info.versionName}` : ""}.apk`;
}

let linkSeq = 0;

export type LinkDownload = { name: string; size: number };

/**
 * Fetch an APK from an address into the drop folder.
 *
 * The address came from a channel post or a pasted page, not from an upstream
 * listing, so it goes through `openGuarded`: every hop is refused if it
 * resolves onto this machine's own network, and no fetcher follows a redirect
 * before that check has run.
 */
export async function downloadApkLink(
  url: string,
  opts: { suffix: string; maxBytes: number }
): Promise<LinkDownload> {
  await fs.mkdir(DROP_DIR, { recursive: true });
  const tmp = path.join(DROP_DIR, `.link-${opts.suffix}-${linkSeq++}.part`);
  const deadlineAt = Date.now() + LINK_DEADLINE_MS;

  // The idle timer lives on the socket (see `requestOnce`): a 200 MB file
  // over a slow mirror is not a hung transfer, but one that has stopped
  // sending is. The deadline is checked as bytes arrive.
  const { res, url: finalUrl } = await openGuarded(url, {
    idleMs: LINK_IDLE_MS,
    headers: { "user-agent": BROWSER_USER_AGENT },
  });

  try {
    const declared = Number(res.headers["content-length"]);
    if (Number.isFinite(declared) && declared > opts.maxBytes) {
      throw new NotAnApk(`over size cap (${mb(declared)} MB)`);
    }

    let written = 0;
    const handle = await fs.open(tmp, "w");
    try {
      for await (const chunk of res as AsyncIterable<Buffer>) {
        if (Date.now() > deadlineAt) {
          throw new Error(`still downloading after ${LINK_DEADLINE_MS / 60_000} min — gave up`);
        }
        written += chunk.byteLength;
        // The cap again, on the bytes: a server may declare no length at all.
        if (written > opts.maxBytes) {
          throw new NotAnApk(`over size cap (>${mb(opts.maxBytes)} MB)`);
        }
        await handle.write(chunk);
      }
    } finally {
      await handle.close();
    }

    const info = await readApkInfo(tmp);
    if (!info.packageName) {
      const type = res.headers["content-type"] || "no content-type";
      throw new NotAnApk(`not an APK (${written} bytes, ${type})`);
    }

    const disposition = res.headers["content-disposition"] ?? "";
    const fileName = await claimName(
      linkFileName(url, finalUrl, disposition, info),
      opts.suffix
    );
    await fs.rename(tmp, path.join(DROP_DIR, fileName));
    return { name: fileName, size: written };
  } catch (err) {
    // A throw mid-body leaves the socket open until it is destroyed.
    res.destroy();
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Fetch the APK an apkmb product page offers.
 *
 * The page is HTML; the build sits one step further, on its download page.
 * Each address listed there is tried in order until one proves to be an
 * APK — the list is usually a single file, and a second entry is a variant
 * of the same app, not a different one.
 */
export async function downloadApkmbBuild(
  pageUrl: string,
  opts: { suffix: string; maxBytes: number; onFail?: (link: string, why: string) => void }
): Promise<LinkDownload> {
  const links = (await apkmbDownloadLinks(pageUrl)).slice(0, MAX_LINKS);
  if (!links.length) throw new NotAnApk("no download link on the page");
  let lastError: unknown;
  for (const link of links) {
    try {
      return await downloadApkLink(link, opts);
    } catch (err) {
      lastError = err;
      opts.onFail?.(link, msgOf(err));
    }
  }
  throw lastError;
}
