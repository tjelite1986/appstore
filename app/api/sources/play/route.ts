/**
 * GET  /api/sources/play?q=…            search Google Play
 * GET  /api/sources/play?packageId=…    read one listing, writing nothing
 * POST /api/sources/play                { packageId } — add that listing
 *
 * Admin-gated like the rest of the write surface, the GET included: it is an
 * outbound request to Google made in this server's name, and leaving it open
 * would let anyone use the store as a scraping proxy.
 */
import { requireAdmin } from "@/lib/admin";
import { fetchImageDataUrl } from "@/lib/sources/net";
import { addFromPlay, fetchPlayListing, searchPlay } from "@/lib/sources/play";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const params = new URL(req.url).searchParams;

  // A lookup by package id is the read half of a fill: whoever is about to
  // put these words on an app sees them first. Kept here rather than behind
  // the fill route because nothing about it writes, and the answer is worth
  // showing even when the person then decides against it.
  const packageId = params.get("packageId");
  if (packageId) {
    try {
      const listing = await fetchPlayListing(packageId);
      // Inlined rather than proxied: one icon, and the card showing it has to
      // work for a token holder as well as a signed-in admin. See
      // `fetchImageDataUrl`.
      const icon = listing.iconUrl
        ? await fetchImageDataUrl(listing.iconUrl, "play")
        : null;
      return Response.json({ listing, iconDataUrl: icon });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[play] lookup failed:", message);
      // Not a fault of the request: "Play has no listing for that" is the
      // answer, and the panel shows it as one.
      return Response.json({ error: message, listing: null }, { status: 404 });
    }
  }

  const term = params.get("q") ?? "";
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
