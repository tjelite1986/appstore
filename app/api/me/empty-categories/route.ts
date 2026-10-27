/**
 * POST /api/me/empty-categories — { on: boolean }
 *
 * Whether this account sees custom categories that hold nothing it can see.
 * A display preference, kept per account beside the 18+ answer — see
 * `showEmptyCategories` in `lib/user-state.ts`.
 */
import { requireUser } from "@/lib/admin";
import { setShowEmptyCategories } from "@/lib/user-state";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof Response) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const on = (body as { on?: unknown } | null)?.on;
  if (typeof on !== "boolean") {
    return Response.json({ error: "Expected { on: boolean }" }, { status: 400 });
  }

  setShowEmptyCategories(gate.user.id, on);
  return Response.json({ ok: true, on });
}
