/**
 * POST /api/apps/bulk-category
 *   { slugs: string[], category?: "<built-in>", leave?: string[],
 *     add?: string[], remove?: string[] }
 *
 * File many apps at once, from a long-press selection on a list. A built-in
 * category *sets* `category` — an app has exactly one, and it is the 18+ gate
 * and the App/Game kind. `leave` names built-in categories to take apps out
 * of: an app in one of them moves to Other, or Other games for a game, and
 * the rest stay where they are. Custom ones (`add`, one slug or a list) are *added*
 * beside whatever the app is already filed under, and `remove` takes them out.
 * At least one of them must be given; `category` and `leave` not together.
 *
 * Every app goes through `editApp`, the same validation as the edit form, one
 * at a time; a refusal for one app is reported and does not stop the rest.
 */
import { requireAdmin } from "@/lib/admin";
import { editApp, EditError, storedText } from "@/lib/edit";
import { findApp, readCollectionDefs } from "@/lib/store";
import { DEFAULT_GAME_CATEGORY, findCategory, kindOf } from "@/lib/categories";

export const dynamic = "force-dynamic";

/** More than a library holds today; a cap so one request cannot run forever. */
const MAX_SLUGS = 500;

export async function POST(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object") throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const { slugs, category, leave, add, remove } = body;
  if (
    !Array.isArray(slugs) ||
    slugs.length === 0 ||
    slugs.length > MAX_SLUGS ||
    !slugs.every((s) => typeof s === "string" && s.length > 0)
  ) {
    return Response.json(
      { error: `slugs must be 1 to ${MAX_SLUGS} app slugs` },
      { status: 400 }
    );
  }
  const setCategory = typeof category === "string" && category.trim() !== "";
  const addTo = slugList(add);
  const takeOut = slugList(remove);
  const leaving = slugList(leave);
  if (!leaving || leaving.some((c) => !findCategory(c))) {
    return Response.json(
      { error: "leave must be a list of built-in categories" },
      { status: 400 }
    );
  }
  const leaveSet = new Set(leaving.map((c) => findCategory(c)));
  if (setCategory && leaveSet.size > 0) {
    return Response.json(
      { error: "Give either category or leave, not both" },
      { status: 400 }
    );
  }
  if (!addTo || !takeOut) {
    return Response.json(
      { error: "add and remove must be a custom category slug or a list of them" },
      { status: 400 }
    );
  }
  if (!setCategory && leaveSet.size === 0 && addTo.length === 0 && takeOut.length === 0) {
    return Response.json(
      { error: "Give a category, custom categories to add or remove, or several" },
      { status: 400 }
    );
  }
  if (addTo.some((s) => takeOut.includes(s))) {
    return Response.json(
      { error: "A category cannot be both added and removed" },
      { status: 400 }
    );
  }
  // Refused once here rather than once per app further down.
  const defs = await readCollectionDefs();
  const unknown = addTo.filter((s) => !defs.some((c) => c.slug === s));
  if (unknown.length > 0) {
    return Response.json(
      { error: `Not a custom category: ${unknown.join(", ")}` },
      { status: 400 }
    );
  }

  let changed = 0;
  const failed: { slug: string; error: string }[] = [];
  for (const slug of new Set(slugs as string[])) {
    try {
      // A slug names a file under meta/, so it is looked up in the catalog
      // before anything reads by it — the same first step `editApp` takes.
      const app = await findApp(slug);
      if (!app) throw new EditError("No such app");
      const patch: Record<string, string> = {};
      if (setCategory) patch.category = category as string;
      if (leaveSet.has(app.category)) {
        patch.category = kindOf(app.category) === "game" ? DEFAULT_GAME_CATEGORY : "Other";
      }
      if (addTo.length > 0 || takeOut.length > 0) {
        const held = (await storedText(slug)).collections
          .split(/[,\s]+/)
          .filter(Boolean);
        const kept = held.filter((s) => !takeOut.includes(s));
        const missing = addTo.filter((s) => !kept.includes(s));
        if (missing.length > 0 || kept.length < held.length) {
          patch.collections = [...kept, ...missing].join(", ");
        }
      }
      if (Object.keys(patch).length === 0) continue;
      await editApp(slug, patch);
      changed++;
    } catch (err) {
      if (!(err instanceof EditError)) {
        console.error(`[bulk-category] ${slug} failed:`, err);
      }
      failed.push({
        slug,
        error: err instanceof EditError ? err.message : "Could not save",
      });
    }
  }

  return Response.json({ ok: failed.length === 0, changed, failed });
}

/** A slug or a list of them, trimmed and unique; nothing for absent; null if malformed. */
function slugList(raw: unknown): string[] | null {
  const list = typeof raw === "string" ? [raw] : raw ?? [];
  if (!Array.isArray(list) || !list.every((s) => typeof s === "string" && s.trim() !== "")) {
    return null;
  }
  return [...new Set((list as string[]).map((s) => s.trim()))];
}
