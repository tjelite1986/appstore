/**
 * POST /api/collections
 *   { action: "create", name }
 *   { action: "rename", slug, name }
 *   { action: "move", slug, step: -1 | 1 }
 *   { action: "delete", slug }
 *
 * Admin-defined collections — see `lib/collections.ts`. One route with an
 * action rather than four, because Manage's panel is the only caller and each
 * action is one line of it. Which apps belong to a collection is edited on the
 * app page, through the ordinary edit route.
 */
import { requireAdmin } from "@/lib/admin";
import {
  CollectionError,
  createCollection,
  deleteCollection,
  moveCollection,
  renameCollection,
} from "@/lib/collections";

export const dynamic = "force-dynamic";

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

  try {
    switch (body.action) {
      case "create":
        return Response.json({ ok: true, collection: await createCollection(body.name) });
      case "rename":
        await renameCollection(body.slug, body.name);
        return Response.json({ ok: true });
      case "move":
        await moveCollection(body.slug, body.step);
        return Response.json({ ok: true });
      case "delete":
        return Response.json({ ok: true, ...(await deleteCollection(body.slug)) });
      default:
        return Response.json(
          { error: "action must be create, rename, move or delete" },
          { status: 400 }
        );
    }
  } catch (err) {
    if (err instanceof CollectionError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("[collections] failed:", err);
    return Response.json({ error: "Could not save the collections" }, { status: 500 });
  }
}
