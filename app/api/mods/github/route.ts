/**
 * GET /api/mods/github?url=…   read one GitHub repository as a mod, writing nothing
 *
 * The read half of adding a mod that is only on GitHub, shown before anything
 * is written — the same as the Nexus lookup. Admin-gated: it is an outbound
 * request made in this server's name.
 */
import { requireAdmin } from "@/lib/admin";
import { parseRepoRef, previewGithubMod } from "@/lib/sources/github-mod";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const ref = parseRepoRef(new URL(req.url).searchParams.get("url") ?? "");
  if (!ref) {
    return Response.json({ error: "Expected a github.com/<owner>/<repo> address" }, { status: 400 });
  }
  try {
    return Response.json({ mod: await previewGithubMod(ref) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[github] mod lookup failed:", message);
    return Response.json({ error: message }, { status: 502 });
  }
}
