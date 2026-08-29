/**
 * The APK itself.
 *
 * `/api/download/<slug>` serves the newest version; `?v=<version>` picks one.
 * The version is looked up in the catalog rather than trusted from the query
 * string, so only a version the store actually lists can be requested.
 *
 * A version can hold several builds — an arm64 and an arm32 APK of the same
 * release. `?f=<file name>` asks for one exactly, which is what the buttons on
 * the app page link to, and `?abi=<abi>` asks for one by what it runs on,
 * which is what a script or a phone can work out for itself. Both are looked
 * up the same way the version is: matched against what the catalog lists, so
 * neither can name a file the store does not already serve. With neither, the
 * store picks — arm64 over universal over arm32, because a 32-bit-only APK on
 * a 64-bit phone fails at install time and says nothing useful about why.
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

  const query = new URL(req.url).searchParams;
  const wanted = query.get("v");
  const version = wanted
    ? app.versions.find((v) => v.version === wanted)
    : app.versions[0];
  if (!version) {
    return new NextResponse("No such version", { status: 404 });
  }

  const wantedFile = query.get("f");
  const wantedAbi = query.get("abi");
  // files[0] is the store's own pick; the catalog has already ranked them.
  const build = wantedFile
    ? version.files.find((f) => f.file === wantedFile)
    : wantedAbi
      ? version.files.find(
          (f) => f.abi === wantedAbi || f.abis.includes(wantedAbi)
        )
      : version.files[0];
  // A named build that this version does not have is a 404 rather than a
  // silent fall back to another one: a link asking for arm32 must never
  // answer with an arm64 file that will not install.
  if (!build) return new NextResponse("No such build", { status: 404 });

  const abs = await resolveInStore(
    STORE_DIRS.apks,
    app.slug,
    version.version,
    build.file
  );
  if (!abs) return new NextResponse("Not found", { status: 404 });

  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!stat.isFile()) return new NextResponse("Not found", { status: 404 });

  // The ABI belongs in the saved name when there is a choice to remember —
  // two files called tiktok-46.7.5.apk in a downloads folder are one file as
  // far as the person looking at them is concerned.
  const suffix = version.files.length > 1 ? `-${build.abi}` : "";
  return fileResponse(abs, stat, req, {
    contentType: contentTypeFor(build.file),
    download: `${app.slug}-${version.version}${suffix}${build.file.slice(build.file.lastIndexOf("."))}`,
  });
}
