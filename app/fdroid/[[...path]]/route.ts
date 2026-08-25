/**
 * The store as a repository an Android client can subscribe to.
 *
 * One handler for the whole tree, because the shapes it has to answer are
 * fixed by what Obtainium asks for rather than by anything here:
 *
 *     /fdroid/repo/index.xml            the shelf a signed-out browser sees
 *     /fdroid/repo/<name>.apk           a file from it
 *     /fdroid/t/<token>/repo/index.xml  the shelf that account sees
 *     /fdroid/t/<token>/repo/<name>.apk
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
import { buildIndexXml, findByApkFileName } from "@/lib/fdroid-index";
import { userForRepoToken } from "@/lib/repo-token";
import { contentTypeFor, fileResponse, resolveInStore } from "@/lib/serve";
import { STORE_DIRS } from "@/lib/storage";
import { catalogFor } from "@/lib/user-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INDEX_FILE = "index.xml";

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
): { userId: number | null; file: string } | null {
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

  return rest.length === 1 && rest[0] ? { userId, file: rest[0] } : null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await params;
  const target = route(path ?? []);
  if (!target) return notFound();

  const apps = await catalogFor(target.userId);
  const url = new URL(req.url);

  if (target.file === INDEX_FILE) {
    const dir = url.pathname.slice(0, url.pathname.lastIndexOf("/"));
    const xml = buildIndexXml(apps, {
      repoUrl: `${publicOrigin(req, url)}${dir}`,
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
  const found = findByApkFileName(apps, target.file);
  if (!found) return notFound();

  const abs = await resolveInStore(
    STORE_DIRS.apks,
    found.app.slug,
    found.version.version,
    found.version.file
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
    contentType: contentTypeFor(found.version.file),
    download: target.file,
  });
}
