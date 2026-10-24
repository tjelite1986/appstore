/**
 * GET /api/mods/nexus?url=…   read one Nexus Mods listing, writing nothing
 *
 * The read half of adding a mod: whoever is about to put these words on the
 * shelf sees them first. Admin-gated, the GET included — it is an outbound
 * request made in this server's name.
 */
import { requireAdmin } from "@/lib/admin";
import { parseNexusUrl, previewNexusMod } from "@/lib/sources/nexus";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const ref = parseNexusUrl(new URL(req.url).searchParams.get("url") ?? "");
  if (!ref) {
    return Response.json(
      { error: "Expected a nexusmods.com/<game>/mods/<id> address" },
      { status: 400 }
    );
  }
  try {
    return Response.json({ mod: await previewNexusMod(ref) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[nexus] lookup failed:", message);
    return Response.json({ error: message }, { status: 502 });
  }
}
