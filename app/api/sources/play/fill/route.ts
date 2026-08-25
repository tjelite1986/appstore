/**
 * POST /api/sources/play/fill  { slug, packageId, overwrite? }
 *
 * Put a Play listing's words and pictures on an app that already exists.
 *
 * The app is the one the store already holds — a shelf built from a dropped
 * APK, which knows its name, its package id and its signer and nothing else.
 * This is the other half: the description, the category, the icon and the
 * screenshots that nobody was going to type in by hand.
 *
 * `packageId` is taken from the request rather than read off the app, and that
 * is deliberate. Whoever posts here has just been shown that listing by the
 * lookup, so the request carries a decision — "these words belong on this
 * app" — which the package id cannot make on its own. A patched client keeps
 * the id of the app it was built from, so the store's Instagram Piko resolves
 * to Meta's listing; a wrapper-built app carries its wrapper's id.
 *
 * `overwrite` is refused here on purpose. Gaps-only is what makes this safe to
 * click: a hand-written tagline, or a name like "Instagram Piko" that says
 * which build this is, survives a fill. Replacing those is an edit, and an
 * edit belongs in the meta file.
 */
import { requireAdmin } from "@/lib/admin";
import { fetchPlayListing, fillFromPlay } from "@/lib/sources/play";
import { getApps } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const { slug, packageId } = (body ?? {}) as {
    slug?: string;
    packageId?: string;
  };
  if (typeof slug !== "string" || !slug) {
    return Response.json({ error: "slug is required" }, { status: 400 });
  }
  if (typeof packageId !== "string" || !packageId) {
    return Response.json({ error: "packageId is required" }, { status: 400 });
  }

  // Only an app the catalog actually lists. Writing a meta file for a slug
  // from nowhere would conjure a row named after whatever was posted, and the
  // fill would be the thing that created it.
  const app = (await getApps()).find((a) => a.slug === slug);
  if (!app) {
    return Response.json({ error: "No app with that slug" }, { status: 404 });
  }

  try {
    const listing = await fetchPlayListing(packageId);
    const fill = await fillFromPlay(slug, listing);
    return Response.json({ slug, name: app.name, listing, ...fill });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[play] fill of ${slug} failed:`, message);
    return Response.json({ error: message }, { status: 400 });
  }
}
