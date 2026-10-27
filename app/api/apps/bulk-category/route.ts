/**
 * POST /api/apps/bulk-category
 *   { slugs: string[], category: "<built-in category>" }
 *   { slugs: string[], add: "<custom category slug>" }
 *
 * File many apps at once, from a long-press selection on a list. A built-in
 * category *sets* `category` — an app has exactly one, and it is the 18+ gate
 * and the App/Game kind. A custom one is *added* beside whatever the app is
 * already filed under.
 *
 * Every app goes through `editApp`, the same validation as the edit form, one
 * at a time; a refusal for one app is reported and does not stop the rest.
 */
import { requireAdmin } from "@/lib/admin";
import { editApp, EditError, storedText } from "@/lib/edit";
import { findApp } from "@/lib/store";

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

  const { slugs, category, add } = body;
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
  const addTo = typeof add === "string" && add.trim() !== "";
  if (setCategory === addTo) {
    return Response.json(
      { error: "Give either category or add, not both" },
      { status: 400 }
    );
  }

  let changed = 0;
  const failed: { slug: string; error: string }[] = [];
  for (const slug of new Set(slugs as string[])) {
    try {
      // A slug names a file under meta/, so it is looked up in the catalog
      // before anything reads by it — the same first step `editApp` takes.
      if (!(await findApp(slug))) throw new EditError("No such app");
      if (setCategory) {
        await editApp(slug, { category });
      } else {
        const held = (await storedText(slug)).collections
          .split(/[,\s]+/)
          .filter(Boolean);
        if (held.includes(add as string)) continue;
        await editApp(slug, { collections: [...held, add].join(", ") });
      }
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
