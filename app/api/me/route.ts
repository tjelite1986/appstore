/**
 * GET /api/me — who this browser is here, and what it kept.
 *
 * One request rather than three: a client component that needs to know whether
 * the bookmark is filled already needs to know whether there is anyone to fill
 * it for, and asking twice would let the two answers disagree for a moment.
 *
 * DELETE /api/me forgets everything about the account. Settings offers it, and
 * it is the reason the saved list is not something a person has to prune row by
 * row to be rid of.
 */
import { requireUser } from "@/lib/admin";
import { eliteUser } from "@/lib/sso";
import { clearState, readState } from "@/lib/user-state";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  // A read, so a signed-out visitor gets an answer rather than a challenge —
  // "nobody is signed in" is the normal case on a store anyone can browse.
  const user = await eliteUser(req);
  if (!user) return Response.json({ signedIn: false });

  const state = readState(user.id);
  return Response.json({
    signedIn: true,
    user: { id: user.id, email: user.email, role: user.role },
    saved: [...state.saved],
    installed: Object.fromEntries(state.installed),
  });
}

export async function DELETE(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof Response) return gate;

  clearState(gate.user.id);
  return Response.json({ ok: true });
}
