/**
 * GET  /api/sources/play?q=…   search Google Play
 * POST /api/sources/play       { packageId } — add that listing to the catalog
 *
 * Admin-gated like the rest of the write surface, the GET included: it is an
 * outbound request to Google made in this server's name, and leaving it open
 * would let anyone use the store as a scraping proxy.
 */
import { requireAdmin } from "@/lib/admin";
import { addFromPlay, searchPlay } from "@/lib/sources/play";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const term = new URL(req.url).searchParams.get("q") ?? "";
  if (!term.trim()) return Response.json({ results: [] });

  try {
    return Response.json({ results: await searchPlay(term) });
  } catch (err) {
    console.error("[play] search failed:", err);
    return Response.json(
      { error: "Play did not answer — try again in a moment" },
      { status: 502 }
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const { packageId } = (body ?? {}) as { packageId?: string };
  if (typeof packageId !== "string" || !packageId) {
    return Response.json({ error: "packageId is required" }, { status: 400 });
  }

  try {
    return Response.json(await addFromPlay(packageId));
  } catch (err) {
    // Everything addFromPlay throws is a sentence for the person who clicked:
    // already in the catalog, no such listing, not a package id.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[play] add failed:", message);
    return Response.json({ error: message }, { status: 400 });
  }
}
