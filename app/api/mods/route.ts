/**
 * POST /api/mods   { nexusUrl }            add a mod from Nexus Mods, game and all
 * POST /api/mods   { game, name }          add a mod by hand to a game already here
 * POST /api/mods   { newGame }             add a game with no mods yet
 *
 * The Nexus listing is read again here rather than taken from the browser:
 * the preview was for a person to look at, not something to trust.
 * A Nexus mod already in the store answers 409 with where it is.
 */
import { requireAdmin } from "@/lib/admin";
import { addGame, addMod, ModAlreadyHere, ModError } from "@/lib/mods";
import { lookupNexusMod, parseNexusUrl } from "@/lib/sources/nexus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  try {
    if ("newGame" in body) {
      return Response.json({ ok: true, game: await addGame(body.newGame) });
    }
    if ("nexusUrl" in body) {
      const ref = parseNexusUrl(typeof body.nexusUrl === "string" ? body.nexusUrl : "");
      if (!ref) {
        return Response.json(
          { error: "Expected a nexusmods.com/<game>/mods/<id> address" },
          { status: 400 }
        );
      }
      let nexus;
      try {
        nexus = await lookupNexusMod(ref);
      } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 502 });
      }
      return Response.json({ ok: true, ...(await addMod({ nexus })) });
    }
    return Response.json({ ok: true, ...(await addMod({ game: body.game, name: body.name })) });
  } catch (err) {
    if (err instanceof ModAlreadyHere) {
      return Response.json({ error: err.message, ...err.at }, { status: 409 });
    }
    if (err instanceof ModError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
