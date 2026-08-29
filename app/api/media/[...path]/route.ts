/**
 * Icons, banners and screenshots, straight off the library.
 *
 * URLs are minted by `lib/store.ts` and carry `?v=<mtime>`, so the response is
 * cached immutably: replacing an icon changes its URL, and nothing serves the
 * old bytes under the new name.
 */
import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import { STORE_DIRS } from "@/lib/storage";
import { contentTypeFor, fileResponse, resolveInStore } from "@/lib/serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only the three image directories are reachable — not meta/, not apks/. */
const SERVABLE: string[] = [
  STORE_DIRS.icons,
  STORE_DIRS.banners,
  STORE_DIRS.screenshots,
];

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  if (!segments?.length || !SERVABLE.includes(segments[0])) {
    return new NextResponse("Not found", { status: 404 });
  }

  const abs = await resolveInStore(segments[0], ...segments.slice(1));
  if (!abs) return new NextResponse("Not found", { status: 404 });

  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!stat.isFile()) return new NextResponse("Not found", { status: 404 });

  const type = contentTypeFor(abs);
  if (!type.startsWith("image/")) {
    return new NextResponse("Not found", { status: 404 });
  }

  return fileResponse(abs, stat, req, {
    contentType: type,
    // Safe because the URL carries the file's mtime.
    immutable: new URL(req.url).searchParams.has("v"),
  });
}
