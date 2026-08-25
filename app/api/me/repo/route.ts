/**
 * POST /api/me/repo — a new repository token for the signed-in account.
 *
 * Rotation is the only thing this route does. Reading the token needs no route
 * at all: the settings page is server-rendered and mints it there. Rotation
 * has to be a request because it is a write, and it is a POST because it
 * invalidates whatever Android client is already pointed at the old URL —
 * which is exactly what makes it worth the same-origin gate every other write
 * here goes through.
 */
import { requireUser } from "@/lib/admin";
import { rotateRepoToken } from "@/lib/repo-token";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof Response) return gate;

  return Response.json({ token: rotateRepoToken(gate.user.id) });
}
