/**
 * POST   /api/mods/<game>/<mod>/picture   multipart: file
 *                                         or JSON: { url }
 * DELETE /api/mods/<game>/<mod>/picture   the next refresh brings the source's back
 *
 * The mod's own picture, set by hand. It stays through a Nexus or GitHub
 * refresh until it is let go of here.
 */
import { requireAdmin } from "@/lib/admin";
import { ModError, releaseModPicture, setModPicture, setModPictureFromUrl } from "@/lib/mods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ game: string; mod: string }> };

function failed(err: unknown): Response {
  if (err instanceof ModError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  throw err;
}

export async function POST(req: Request, { params }: Params): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const { game, mod } = await params;
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  try {
    if (type === "application/json") {
      const body = await req.json().catch(() => null);
      await setModPictureFromUrl(game, mod, body?.url);
      return Response.json({ ok: true });
    }
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new ModError("Expected a picture file");
    await setModPicture(game, mod, Buffer.from(await file.arrayBuffer()));
    return Response.json({ ok: true });
  } catch (err) {
    return failed(err);
  }
}

export async function DELETE(req: Request, { params }: Params): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const { game, mod } = await params;
  try {
    await releaseModPicture(game, mod);
    return Response.json({ ok: true });
  } catch (err) {
    return failed(err);
  }
}
