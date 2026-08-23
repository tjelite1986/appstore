/**
 * The review queue — the drops the scan would not resolve on its own.
 *
 *   GET   list what is waiting
 *   POST  { id, action, slug?, force? } resolve one item
 *
 * `id` is the parked file's name, not a row id: the sidecar beside the file is
 * the record, so there is nothing to keep in sync with the folder.
 */
import { requireAdmin } from "@/lib/admin";
import { decideImport, listReview, type ReviewAction } from "@/lib/import";

export const dynamic = "force-dynamic";

const ACTIONS: ReviewAction[] = ["attach", "create-new", "discard"];

export async function GET(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;
  return Response.json({ items: await listReview() });
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
  const { id, action, slug, force } = (body ?? {}) as {
    id?: string;
    action?: string;
    slug?: string;
    force?: boolean;
  };
  if (typeof id !== "string" || !id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }
  if (!ACTIONS.includes(action as ReviewAction)) {
    return Response.json(
      { error: `action must be one of ${ACTIONS.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const result = await decideImport(id, action as ReviewAction, {
      slug: typeof slug === "string" ? slug : undefined,
      force: force === true,
    });
    // A refused signer is a decision to offer, not a server fault — 409 so the
    // UI can tell it apart from a bad request and show "attach anyway".
    return Response.json(result, { status: result.ok ? 200 : 409 });
  } catch (err) {
    console.error("[import] decision failed:", err);
    return Response.json({ error: "Decision failed" }, { status: 500 });
  }
}
