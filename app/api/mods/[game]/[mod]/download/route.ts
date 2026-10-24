/**
 * GET /api/mods/<game>/<mod>/download?f=<file>
 *
 * One of a mod's archives. The name is matched against the files the listing
 * holds, never joined from the query, and an adult mod is a 404 for a viewer
 * who has not opted in — the same answer as a mod that is not there.
 */
import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import { STORE_DIRS } from "@/lib/storage";
import { contentTypeFor, fileResponse, resolveInStore } from "@/lib/serve";
import { findMod } from "@/lib/mods";
import { currentUserId } from "@/lib/current-user";
import { adultsAllowed } from "@/lib/user-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ game: string; mod: string }> }
) {
  const { game, mod: slug } = await params;
  const mod = await findMod(game, slug, adultsAllowed(await currentUserId()));
  if (!mod) return new NextResponse("Not found", { status: 404 });

  const wanted = new URL(req.url).searchParams.get("f");
  const hit = wanted ? mod.files.find((f) => f.file === wanted) : mod.files[0];
  if (!hit) return new NextResponse("No such file", { status: 404 });

  const abs = await resolveInStore(STORE_DIRS.mods, mod.game, mod.slug, "files", hit.file);
  if (!abs) return new NextResponse("Not found", { status: 404 });
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!stat.isFile()) return new NextResponse("Not found", { status: 404 });

  return fileResponse(abs, stat, req, {
    contentType: contentTypeFor(hit.file),
    download: hit.file,
  });
}
