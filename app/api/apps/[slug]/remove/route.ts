/**
 * POST /api/apps/<slug>/remove
 *   { dryRun?, confirm? }
 *
 * Delete a whole listing: its versions, meta file, artwork and per-account
 * rows. See `lib/remove.ts` — nothing is archived.
 *
 * `dryRun` answers with the plan and deletes nothing. A real run needs
 * `confirm` set to the slug, so a replayed or mistyped request cannot take
 * the wrong app. POST for the preview too, for the reason the prune route
 * gives: `requireAdmin` checks the Origin only on an unsafe method. The app is
 * looked up through the 18+ gate like every other slug route.
 */
import { requireAdmin } from "@/lib/admin";
import { currentUserId } from "@/lib/current-user";
import { getCatalog } from "@/lib/store";
import { appFor } from "@/lib/user-state";
import { planRemove, removeApp } from "@/lib/remove";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const { dryRun, confirm } = (body ?? {}) as { dryRun?: unknown; confirm?: unknown };

  // The placeholder rows are not folders, and a removal planned against them
  // would describe a library that does not exist.
  if ((await getCatalog()).placeholder) {
    return Response.json({ error: "The library is empty" }, { status: 409 });
  }
  const { slug } = await params;
  const app = await appFor(await currentUserId(), slug);
  if (!app) return Response.json({ error: "No such app" }, { status: 404 });

  try {
    if (dryRun === true) {
      return Response.json({ ok: true, plan: await planRemove(app) });
    }
    if (confirm !== app.slug) {
      return Response.json({ error: "confirm must be the app's slug" }, { status: 400 });
    }
    return Response.json({ ok: true, result: await removeApp(app) });
  } catch (err) {
    console.error("[remove] failed:", err);
    return Response.json({ error: "Remove failed" }, { status: 500 });
  }
}
