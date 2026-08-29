/**
 * POST /api/telegram/candidate  { url }
 *
 * Answer one offered page, so the feed stops offering it.
 *
 * Both answers land here — a fill that was written and a page that describes
 * nothing this store wants — because the ledger records the same thing either
 * way: somebody looked. What was written, if anything, is the fill route's
 * business, and doing that work here would be a second copy of it.
 *
 * A fill whose clear never arrives leaves the row offered on the next poll.
 * That is the harmless direction: filling gaps twice writes nothing the second
 * time, and the row can be dismissed by hand.
 */
import { requireAdmin } from "@/lib/admin";
import { clearCandidate } from "@/lib/telegram";

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
  const { url } = (body ?? {}) as { url?: string };
  if (typeof url !== "string" || !url) {
    return Response.json({ error: "url is required" }, { status: 400 });
  }

  // Not an error: the same page offered from two channels is one row here, and
  // a second click on a row already answered is a no-op, not a fault.
  return Response.json({ ok: true, cleared: await clearCandidate(url) });
}
