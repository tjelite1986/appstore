/**
 * POST /api/apps/prune
 *   { slug?, dryRun? }
 *
 * Delete every version but the newest — of one listing, or of the whole
 * library when no slug is given. See `lib/prune.ts` for what "newest" means
 * and which listings are left alone.
 *
 * `dryRun` answers with the plan and deletes nothing. The panel always asks
 * for that first: unlike every other write here there is no `_discarded/` to
 * fish a mistake out of, so the list is on screen before the button is.
 *
 * POST for the preview as well, for the reason the merge route gives — the
 * plan names listings, and `requireAdmin` checks the Origin only on an unsafe
 * method. The listings are read through the same 18+ gate Manage applies:
 * a token-only caller has no account and so no open gate, and what it cannot
 * see it cannot prune. The app page reaches its own listing by slug, which is
 * already the gated page.
 */
import { requireAdmin } from "@/lib/admin";
import { currentUserId } from "@/lib/current-user";
import { getCatalog, withoutAdults } from "@/lib/store";
import { adultsAllowed } from "@/lib/user-state";
import { planPrune, pruneOld } from "@/lib/prune";

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
  const { slug, dryRun } = (body ?? {}) as { slug?: unknown; dryRun?: unknown };
  if (slug !== undefined && (typeof slug !== "string" || !slug)) {
    return Response.json({ error: "slug must be a non-empty string" }, { status: 400 });
  }

  const { apps: all, placeholder } = await getCatalog();
  // The placeholder rows are not folders — there is nothing to delete, and a
  // plan that named them would describe a library that does not exist.
  if (placeholder) {
    return Response.json({ error: "The library is empty" }, { status: 409 });
  }
  const visible = adultsAllowed(await currentUserId()) ? all : withoutAdults(all);
  const apps = slug === undefined ? visible : visible.filter((a) => a.slug === slug);
  if (slug !== undefined && !apps.length) {
    return Response.json({ error: "No such app" }, { status: 404 });
  }

  try {
    if (dryRun === true) {
      return Response.json({ ok: true, plan: planPrune(apps) });
    }
    return Response.json({ ok: true, result: await pruneOld(apps) });
  } catch (err) {
    console.error("[prune] failed:", err);
    return Response.json({ error: "Prune failed" }, { status: 500 });
  }
}
