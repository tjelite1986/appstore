/**
 * GET  /api/sources/apkmb?url=…   read one product page and its download
 *                                  step, writing nothing
 * POST /api/sources/apkmb         { url, separate? } — add that listing to
 *                                  the catalog; 409 with the existing slug
 *                                  when its package id is already here,
 *                                  unless `separate` asks for a second listing
 *
 * Admin-gated like the rest of the write surface, the GET included: it makes
 * an outbound request in this server's name, and leaving it open would turn
 * the store into a scraping proxy for anyone who found the route. The host is
 * pinned to apkmb.com by `apkmbUrl`, which is what keeps a URL from a request
 * from pointing this server at an address of the caller's choosing.
 */
import { requireAdmin } from "@/lib/admin";
import { fetchImageDataUrl } from "@/lib/sources/net";
import { AlreadyHere, alreadyHereResponse } from "@/lib/sources/already-here";
import { addFromApkmb, apkmbDownloadFiles, lookupApkmb } from "@/lib/sources/apkmb";

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
    // What the download step offers, so the card can say whether the APK is
    // the whole install. Its own fetch, and a failure is not the lookup's:
    // `null` means "not known", which the card says nothing about.
    const downloads = await apkmbDownloadFiles(listing.url).catch((err) => {
      console.error("[apkmb] download step unreadable:", err instanceof Error ? err.message : err);
      return null;
    });
    return Response.json({ listing, iconDataUrl: icon, downloads });
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
  const { url, separate } = (body ?? {}) as {
    url?: string;
    separate?: boolean;
  };
  if (typeof url !== "string" || !url) {
    return Response.json({ error: "url is required" }, { status: 400 });
  }

  try {
    return Response.json(
      await addFromApkmb(url, { separate: separate === true }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[apkmb] add failed:", message);
    // "Already here" is an offer, not a fault: the panel may ask again with
    // `separate` to file a second listing under the same package id.
    if (err instanceof AlreadyHere) return alreadyHereResponse(err);
    // Everything else addFromApkmb throws is a sentence for the person who clicked.
    return Response.json({ error: message }, { status: 400 });
  }
}
