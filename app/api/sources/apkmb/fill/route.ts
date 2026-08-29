/**
 * POST /api/sources/apkmb/fill  { slug, url }
 *
 * Put an apkmb page's words and pictures on an app that already exists.
 *
 * The app is the one the store already holds — usually a shelf built from a
 * dropped APK, which knows its name, its package id and its signer and nothing
 * else. This is the other half, for the apps Play cannot describe: a modified
 * build, or one on the Adults shelf, which has no Play listing to fill from.
 *
 * `url` is taken from the request rather than guessed from the app, and that
 * is deliberate. Whoever posts here has just been shown that page by the
 * lookup, so the request carries a decision — "these words describe this
 * build" — which a name match cannot make on its own.
 *
 * `overwrite` is refused here on purpose, exactly as it is for Play. Gaps-only
 * is what makes this safe to click: a hand-written tagline, or a name that
 * says which build this is, survives a fill. Replacing those is an edit, and
 * an edit belongs on the app's own page.
 */
import { requireAdmin } from "@/lib/admin";
import { fetchApkmbListing, fillFromApkmb } from "@/lib/sources/apkmb";
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
  const { slug, url } = (body ?? {}) as { slug?: string; url?: string };
  if (typeof slug !== "string" || !slug) {
    return Response.json({ error: "slug is required" }, { status: 400 });
  }
  if (typeof url !== "string" || !url) {
    return Response.json({ error: "url is required" }, { status: 400 });
  }

  // Only an app the catalog actually lists. Writing a meta file for a slug
  // from nowhere would conjure a row named after whatever was posted, and the
  // fill would be the thing that created it.
  const app = (await getApps()).find((a) => a.slug === slug);
  if (!app) {
    return Response.json({ error: "No app with that slug" }, { status: 404 });
  }

  try {
    const listing = await fetchApkmbListing(url);
    const fill = await fillFromApkmb(slug, listing);
    return Response.json({ slug, name: app.name, listing, ...fill });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[apkmb] fill of ${slug} failed:`, message);
    return Response.json({ error: message }, { status: 400 });
  }
}
