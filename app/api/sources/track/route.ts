/**
 * POST /api/sources/track  { slug, track }
 *
 * Whether a Play app's version is supposed to keep up with Play's.
 *
 * `track: false` marks the listing `untracked`: the source check skips it and
 * the Behind card lists it under "not tracked" instead of among the apps that
 * are behind. It exists for modified builds, which carry their modifier's
 * version number and would otherwise read as behind on every run. `track: true`
 * takes the mark off again.
 *
 * Play only. A GitHub or F-Droid app that is behind is fetched by the timer,
 * so there is nothing to stop looking at.
 */
import { requireAdmin } from "@/lib/admin";
import { writeMeta } from "@/lib/import";
import { getApps, invalidateCatalog, type AppSource } from "@/lib/store";

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
  const { slug, track } = (body ?? {}) as { slug?: string; track?: boolean };
  if (typeof slug !== "string" || !slug) {
    return Response.json({ error: "slug is required" }, { status: 400 });
  }
  if (typeof track !== "boolean") {
    return Response.json(
      { error: "track must be true or false" },
      { status: 400 },
    );
  }

  const app = (await getApps()).find((a) => a.slug === slug);
  if (!app) {
    return Response.json({ error: "No app with that slug" }, { status: 404 });
  }
  if (app.source?.kind !== "play") {
    return Response.json(
      { error: "Only an app added from Play can be untracked" },
      { status: 400 },
    );
  }

  // The whole `source` object is written back, not patched: `untracked` is
  // either on it or not, and a false value would be a third state nothing reads.
  const source: AppSource = { ...app.source };
  if (track) delete source.untracked;
  else source.untracked = true;
  await writeMeta(slug, { source });
  invalidateCatalog();

  return Response.json({ slug, name: app.name, tracked: track });
}
