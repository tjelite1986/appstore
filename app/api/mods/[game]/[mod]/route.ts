/**
 * POST   /api/mods/<game>/<mod>   { refresh: true }   Nexus's current words over the old
 * DELETE /api/mods/<game>/<mod>                       move the mod to _discarded
 */
import { requireAdmin } from "@/lib/admin";
import { findMod, ModError, refreshMod, removeMod } from "@/lib/mods";
import { lookupNexusMod } from "@/lib/sources/nexus";

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
  const body = await req.json().catch(() => null);
  if (body?.refresh !== true) {
    return Response.json({ error: "Expected { refresh: true }" }, { status: 400 });
  }
  try {
    const current = await findMod(game, mod, true);
    if (!current) return Response.json({ error: "No such mod" }, { status: 404 });
    if (!current.nexus) {
      return Response.json({ error: "This mod was not added from Nexus Mods" }, { status: 400 });
    }
    let nexus;
    try {
      nexus = await lookupNexusMod({ domain: current.nexus.domain, modId: current.nexus.modId });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 502 });
    }
    await refreshMod(game, mod, nexus);
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
    await removeMod(game, mod);
    return Response.json({ ok: true });
  } catch (err) {
    return failed(err);
  }
}
