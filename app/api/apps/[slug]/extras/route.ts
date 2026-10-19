/**
 * POST   /api/apps/<slug>/extras             { version, file, bytes } → { id, received, chunkBytes }
 * GET    /api/apps/<slug>/extras?id=         → { received, bytes }, to resume
 * PUT    /api/apps/<slug>/extras?id=&offset= raw chunk               → { received, done, file? }
 * DELETE /api/apps/<slug>/extras?id=         give up on an upload
 * DELETE /api/apps/<slug>/extras?v=&file=    take an extra off a version
 *
 * OBB and cache archives beside a version's APK — see `lib/extras.ts` for why
 * an upload arrives in chunks. A chunk at the wrong offset answers 409 with
 * `received`, the offset to send next.
 */
import { requireAdmin } from "@/lib/admin";
import {
  appendChunk,
  cancelUpload,
  ExtraError,
  removeExtra,
  startUpload,
  uploadStatus,
} from "@/lib/extras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failed(err: unknown): Response {
  if (err instanceof ExtraError) {
    return Response.json(
      { error: err.message, ...(err.received !== undefined ? { received: err.received } : {}) },
      { status: err.status }
    );
  }
  throw err;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const { slug } = await params;
  try {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    return Response.json({ ok: true, ...(await uploadStatus(slug, id)) });
  } catch (err) {
    return failed(err);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const { slug } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  try {
    return Response.json({ ok: true, ...(await startUpload(slug, body)) });
  } catch (err) {
    return failed(err);
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const { slug } = await params;
  const query = new URL(req.url).searchParams;
  const offset = Number(query.get("offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return Response.json({ error: "offset is required" }, { status: 400 });
  }
  try {
    const result = await appendChunk(slug, query.get("id") ?? "", offset, req.body);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return failed(err);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const { slug } = await params;
  const query = new URL(req.url).searchParams;
  try {
    const id = query.get("id");
    if (id) {
      await cancelUpload(slug, id);
    } else {
      await removeExtra(slug, query.get("v") ?? "", query.get("file") ?? "");
    }
    return Response.json({ ok: true });
  } catch (err) {
    return failed(err);
  }
}
