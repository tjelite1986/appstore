/**
 * GET  /api/sources/apkmb?url=…   read one product page, writing nothing
 * POST /api/sources/apkmb         { url } — add that listing to the catalog
 *
 * Admin-gated like the rest of the write surface, the GET included: it makes
 * an outbound request in this server's name, and leaving it open would turn
 * the store into a scraping proxy for anyone who found the route. The host is
 * pinned to apkmb.com by `apkmbUrl`, which is what keeps a URL from a request
 * from pointing this server at an address of the caller's choosing.
 */
import { requireAdmin } from "@/lib/admin";
import { fetchImageDataUrl } from "@/lib/sources/net";
import { addFromApkmb, lookupApkmb } from "@/lib/sources/apkmb";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const url = new URL(req.url).searchParams.get("url") ?? "";
  if (!url.trim()) {
    return Response.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const listing = await lookupApkmb(url);
    // Inlined rather than proxied: the card has to draw for whoever holds the
    // shared token as well as for a signed-in admin, and an <img> carries no
    // header. See `fetchImageDataUrl`.
    const icon = listing.iconUrl
      ? await fetchImageDataUrl(listing.iconUrl, "apkmb")
      : null;
    return Response.json({ listing, iconDataUrl: icon });
  } catch (err) {
    // "That page does not describe an app" is the answer, not a fault in the
    // request, and the panel shows it as one.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[apkmb] lookup failed:", message);
    return Response.json({ error: message, listing: null }, { status: 404 });
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
  const { url } = (body ?? {}) as { url?: string };
  if (typeof url !== "string" || !url) {
    return Response.json({ error: "url is required" }, { status: 400 });
  }

  try {
    return Response.json(await addFromApkmb(url));
  } catch (err) {
    // Everything addFromApkmb throws is a sentence for the person who clicked.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[apkmb] add failed:", message);
    return Response.json({ error: message }, { status: 400 });
  }
}
