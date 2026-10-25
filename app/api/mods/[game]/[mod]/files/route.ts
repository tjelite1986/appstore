/**
 * POST   /api/mods/<game>/<mod>/files             { file, bytes, name, version, section, nexus, source } → { id, received, chunkBytes }
 * PATCH  /api/mods/<game>/<mod>/files             { file, name, version, section, nexus, source } relabel an uploaded file
 * GET    /api/mods/<game>/<mod>/files?id=         → { received, bytes }, to resume
 * PUT    /api/mods/<game>/<mod>/files?id=&offset= raw chunk               → { received, done, file? }
 * DELETE /api/mods/<game>/<mod>/files?id=         give up on an upload
 * DELETE /api/mods/<game>/<mod>/files?file=       take a file off the mod
 *
 * The same chunked upload as OBB files — see `lib/chunks.ts`. A chunk at the
 * wrong offset answers 409 with `received`, the offset to send next.
 */
import { requireAdmin } from "@/lib/admin";
import {
  appendModChunk,
  cancelModUpload,
  labelModFile,
  ModError,
  modUploadStatus,
  removeModFile,
  startModUpload,
} from "@/lib/mods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ game: string; mod: string }> };

function failed(err: unknown): Response {
  if (err instanceof ModError) {
    return Response.json(
      { error: err.message, ...(err.received !== undefined ? { received: err.received } : {}) },
      { status: err.status }
    );
  }
  throw err;
}

export async function GET(req: Request, { params }: Params) {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const { game, mod } = await params;
  try {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    return Response.json({ ok: true, ...(await modUploadStatus(game, mod, id)) });
  } catch (err) {
    return failed(err);
  }
}

export async function POST(req: Request, { params }: Params) {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const { game, mod } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  try {
    return Response.json({ ok: true, ...(await startModUpload(game, mod, body)) });
  } catch (err) {
    return failed(err);
  }
}

export async function PUT(req: Request, { params }: Params) {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const { game, mod } = await params;
  const query = new URL(req.url).searchParams;
  const offset = Number(query.get("offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return Response.json({ error: "offset is required" }, { status: 400 });
  }
  try {
    const result = await appendModChunk(game, mod, query.get("id") ?? "", offset, req.body);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return failed(err);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const { game, mod } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  try {
    await labelModFile(game, mod, body);
    return Response.json({ ok: true });
  } catch (err) {
    return failed(err);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const { game, mod } = await params;
  const query = new URL(req.url).searchParams;
  try {
    const id = query.get("id");
    if (id) await cancelModUpload(game, mod, id);
    else await removeModFile(game, mod, query.get("file") ?? "");
    return Response.json({ ok: true });
  } catch (err) {
    return failed(err);
  }
}
