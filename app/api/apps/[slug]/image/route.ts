/**
 * POST   /api/apps/<slug>/image   multipart: kind=icon|banner|screenshot, file
 *                                 or JSON: { kind, url }
 * DELETE /api/apps/<slug>/image?kind=…&file=…
 *
 * The pictures on a listing. An icon and a banner are singular and replace;
 * screenshots append. What the bytes are is decided by reading them, not by
 * the name or the type the browser attached — see `sniffExtension`. A URL and
 * an upload land in the same place through the same check; the fetch itself is
 * the part that differs, and `fetchImageBytes` carries that difference.
 */
import { requireAdmin } from "@/lib/admin";
import {
  EditError,
  removeImage,
  saveFromUrl,
  saveUpload,
  type ImageKind,
} from "@/lib/edit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: ImageKind[] = ["icon", "banner", "screenshot"];

function kindFrom(raw: unknown): ImageKind {
  const hit = KINDS.find((k) => k === raw);
  if (!hit) throw new EditError("kind must be icon, banner or screenshot");
  return hit;
}

function failed(err: unknown): Response {
  if (err instanceof EditError) {
    return Response.json(
      { error: err.message },
      { status: err.message === "No such app" ? 404 : 400 }
    );
  }
  throw err;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const { slug } = await params;
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  try {
    if (type === "application/json") {
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object") {
        throw new EditError("Expected a JSON body");
      }
      const { kind: rawKind, url } = body as Record<string, unknown>;
      const saved = await saveFromUrl(slug, kindFrom(rawKind), url);
      return Response.json({ ok: true, ...saved });
    }

    const form = await req.formData().catch(() => null);
    if (!form) throw new EditError("Expected a multipart form");

    const kind = kindFrom(form.get("kind"));
    const file = form.get("file");
    if (!(file instanceof File)) throw new EditError("file is required");

    const saved = await saveUpload(
      slug,
      kind,
      Buffer.from(await file.arrayBuffer())
    );
    return Response.json({ ok: true, ...saved });
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
    const kind = kindFrom(query.get("kind"));
    const removed = await removeImage(
      slug,
      kind,
      query.get("file") ?? undefined
    );
    return Response.json({ ok: true, removed });
  } catch (err) {
    return failed(err);
  }
}
