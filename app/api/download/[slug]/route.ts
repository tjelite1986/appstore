/**
 * The APK itself.
 *
 * `/api/download/<slug>` serves the newest version; `?v=<version>` picks one.
 * The version is looked up in the catalog rather than trusted from the query
 * string, so only a version the store actually lists can be requested.
 */
import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import { STORE_DIRS } from "@/lib/storage";
import { contentTypeFor, fileResponse, resolveInStore } from "@/lib/serve";
import { appFor } from "@/lib/user-state";
import { currentUserId } from "@/lib/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  // Gated the same way the page is: a slug read off someone else's screen is
  // the obvious way around a hidden shelf.
  const app = await appFor(await currentUserId(), slug);
  if (!app) return new NextResponse("Not found", { status: 404 });

  const wanted = new URL(req.url).searchParams.get("v");
  const version = wanted
    ? app.versions.find((v) => v.version === wanted)
    : app.versions[0];
  if (!version) {
    return new NextResponse("No such version", { status: 404 });
  }

  const abs = await resolveInStore(
    STORE_DIRS.apks,
    app.slug,
    version.version,
    version.file
  );
  if (!abs) return new NextResponse("Not found", { status: 404 });

  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!stat.isFile()) return new NextResponse("Not found", { status: 404 });

  return fileResponse(abs, stat, req, {
    contentType: contentTypeFor(version.file),
    download: `${app.slug}-${version.version}${version.file.slice(version.file.lastIndexOf("."))}`,
  });
}
