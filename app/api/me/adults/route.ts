/**
 * POST /api/me/adults — { on: boolean }
 *
 * The 18+ gate, as an answer this account gives about itself. It is stored
 * rather than asked per visit: a dialog that appears every time is one people
 * learn to click through, and a store shared with a household needs the answer
 * to survive the tab being closed.
 *
 * Signed-in only, because there is nowhere to keep the answer otherwise — see
 * `adultsAllowed` in `lib/user-state.ts` for why that is also the safe reading.
 */
import { requireUser } from "@/lib/admin";
import { setAdultsAllowed } from "@/lib/user-state";

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

  setAdultsAllowed(gate.user.id, on);
  return Response.json({ ok: true, on });
}
