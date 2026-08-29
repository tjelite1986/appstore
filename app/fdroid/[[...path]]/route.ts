/**
 * The store as a repository an Android client can subscribe to.
 *
 * One handler for the whole tree, because the shapes it has to answer are
 * fixed by what Obtainium asks for rather than by anything here:
 *
 *     /fdroid/repo/index.xml            the shelf a signed-out browser sees
 *     /fdroid/repo/entry.jar            the signed pointer a current F-Droid
 *                                       client asks for first
 *     /fdroid/repo/index-v2.json        what that pointer vouches for
 *     /fdroid/repo/index-v1.jar         the same shelf in the older format,
 *                                       signed, for a client that wants it
 *     /fdroid/repo/<name>.apk           a file from it
 *     /fdroid/repo/icons-<dpi>/<name>   an app's icon, for a client that
 *     /fdroid/repo/<pkg>/en-US/<name>   builds one address or the other
 *     /fdroid/repo/obtainium.json       the same shelf, as an import file
 *     /fdroid/t/<token>/repo/index.xml  the shelf that account sees
 *     /fdroid/t/<token>/repo/entry.jar
 *     /fdroid/t/<token>/repo/index-v2.json
 *     /fdroid/t/<token>/repo/index-v1.jar
 *     /fdroid/t/<token>/repo/<name>.apk
 *     /fdroid/t/<token>/repo/obtainium.json
 *
 * Obtainium is given the directory — `…/fdroid/repo` — and appends
 * `index.xml` itself; it then builds every APK URL by replacing that last
 * segment with the `<apkname>` out of the index. So the file has to be a
 * sibling of the index, under the token when there is one, which is why this
 * is a catch-all rather than three routes.
 *
 * Entering the bare hostname works too: Obtainium falls back to
 * `<host>/fdroid/repo/index.xml` on its own after trying `/index.xml` and
 * `/repo/index.xml`. That path is the signed-out one, with no Adults — see
 * `lib/repo-token.ts` for why identity travels in the path at all.
 */
import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import {
  buildIndexXml,
  buildObtainiumImport,
  findByApkFileName,
} from "@/lib/fdroid-index";
import {
  FDROID_STATE_DIR,
  PUBLISHED_FILES,
  type IndexVariant,
} from "@/lib/fdroid-published";
import { userForRepoToken } from "@/lib/repo-token";
import { contentTypeFor, fileResponse, resolveInStore } from "@/lib/serve";
import { STORE_DIRS } from "@/lib/storage";
import { adultsAllowed, catalogFor } from "@/lib/user-state";
import { repoBaseUrl } from "@/lib/fdroid-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INDEX_FILE = "index.xml";
const IMPORT_FILE = "obtainium.json";

function notFound(): NextResponse {
  return new NextResponse("Not found", { status: 404 });
}

/**
 * The origin a client outside the container sees.
 *
 * Next reconstructs `req.url` from the Host header, which behind the proxy is
 * right about the host and wrong about the scheme. Only the `<repo url>`
 * attribute is written from this — Obtainium builds its own URLs off the one
 * it fetched — so a proxy that sets no forwarded headers still gets a working
 * index, just one that names itself over http.
 */
function publicOrigin(req: Request, url: URL): string {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim();
  return `${proto || url.protocol.replace(":", "")}://${host || url.host}`;
}

/**
 * The request split into "who" and "what".
 *
 * Null for a path this repository does not serve, including a token-shaped
 * segment that belongs to nobody — a wrong token reads the same as a wrong
 * URL, so probing one tells the prober nothing.
 */
function route(
  segments: string[]
): { userId: number | null; rest: string[] } | null {
  let rest = segments;
  let userId: number | null = null;

  if (rest[0] === "t") {
    if (rest.length < 2) return null;
    userId = userForRepoToken(rest[1]);
    if (userId === null) return null;
    rest = rest.slice(2);
  }
  // The directory segment is optional so that both `…/fdroid` and
  // `…/fdroid/repo` work as the URL someone pastes into the client.
  if (rest[0] === "repo") rest = rest.slice(1);

  return rest.length && rest.every(Boolean) ? { userId, rest } : null;
}

/**
 * The icon file an address is asking for, or null.
 *
 * A client does not follow a URL out of the index — it composes one, and
 * which one depends on which field it read the name from. Both shapes end at
 * the same file, because this library keeps one icon per app and no density
 * buckets at all:
 *
 *     icons-640/<name>       from the flat `icon` field, any bucket
 *     icons/<name>           the bucketless form older tools use
 *     <packageName>/en-US/<name>   from `localized["en-US"].icon`
 *
 * The package id in the third shape is decoration: the name identifies the
 * file on its own, and the lookup is against the library rather than a path
 * built from what was sent. Nothing here reaches the filesystem unchecked —
 * `resolveInStore` refuses anything landing outside the icons directory.
 */
function iconRequest(rest: string[]): string | null {
  if (rest.length === 2 && /^icons(-\d{2,4})?$/.test(rest[0])) return rest[1];
  if (rest.length === 3 && rest[1] === "en-US") return rest[2];
  return null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await params;
  const target = route(path ?? []);
  if (!target) return notFound();

  // An icon, which like the jar needs no catalog: the file name is the whole
  // request, and an icon is not something this repository hides from anyone —
  // the website serves the same directory to a signed-out browser.
  const icon = iconRequest(target.rest);
  if (icon) {
    const abs = await resolveInStore(STORE_DIRS.icons, icon);
    if (!abs) return notFound();
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      return notFound();
    }
    if (!stat.isFile()) return notFound();
    return fileResponse(abs, stat, req, {
      contentType: contentTypeFor(icon),
    });
  }

  if (target.rest.length !== 1) return notFound();
  const file = target.rest[0];

  // A signed index, which is a file on disk rather than a document built
  // here: a signature cannot be produced per request, and the key that makes
  // it is deliberately outside this container (see scripts/fdroid-sign.sh).
  //
  // There are two of every one of them, and which one this URL gets is the
  // same decision the unsigned index makes — the token says who is asking,
  // and only an account that has confirmed its age is shown Adults. A format
  // this repository has never signed answers 404, which is exactly what a
  // probing client expects: it asks for index-v2 first and falls back.
  //
  // Answered before the catalog is read, because none of it needs one.
  const published = PUBLISHED_FILES[file];
  if (published) {
    const variant: IndexVariant = adultsAllowed(target.userId) ? "all" : "clean";
    const abs = await resolveInStore(FDROID_STATE_DIR, variant, file);
    if (!abs) return notFound();

    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      return notFound();
    }
    if (!stat.isFile()) return notFound();

    return fileResponse(abs, stat, req, { contentType: published });
  }

  const apps = await catalogFor(target.userId);
  const url = new URL(req.url);
  const dir = url.pathname.slice(0, url.pathname.lastIndexOf("/"));
  const repoUrl = `${repoBaseUrl(publicOrigin(req, url))}${dir}`;

  // Every app at once, which the index cannot do — see buildObtainiumImport.
  if (file === IMPORT_FILE) {
    return new NextResponse(buildObtainiumImport(apps, repoUrl), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // A phone browser renders JSON instead of saving it, and the file has
        // to reach a file picker to be imported.
        "Content-Disposition": 'attachment; filename="obtainium.json"',
        "Cache-Control": "no-store",
      },
    });
  }

  if (file === INDEX_FILE) {
    const xml = buildIndexXml(apps, {
      repoUrl,
      repoName: "App Store",
      description:
        "A self-hosted shelf. Add this URL to Obtainium as a third-party F-Droid repository.",
      // The newest file on the shelf, so an index that has not changed does
      // not claim it has. Empty shelf, no claim: zero.
      timestamp: apps.reduce(
        (newest, app) =>
          app.versions.reduce(
            (acc, v) => Math.max(acc, Date.parse(v.added) || 0),
            newest
          ),
        0
      ),
    });
    return new NextResponse(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        // Short: the client re-reads this on every update check, and a new
        // APK landing on the shelf should show up on the next one.
        "Cache-Control": "public, max-age=60, must-revalidate",
      },
    });
  }

  // An APK. The name is matched against the ones the index generated rather
  // than taken apart, so nothing a client sends reaches the filesystem.
  const found = findByApkFileName(apps, file);
  if (!found) return notFound();

  const abs = await resolveInStore(
    STORE_DIRS.apks,
    found.app.slug,
    found.version.version,
    found.build.file
  );
  if (!abs) return notFound();

  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return notFound();
  }
  if (!stat.isFile()) return notFound();

  return fileResponse(abs, stat, req, {
    contentType: contentTypeFor(found.build.file),
    download: file,
  });
}
