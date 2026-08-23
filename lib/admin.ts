/**
 * Who is allowed to change the library.
 *
 * There is no login yet — that decision is still open (own accounts vs SSO
 * against elitev3), and browsing and downloading never needed one. The
 * importer does: it moves files around inside the library and can discard
 * them, and the store answers on a public hostname.
 *
 * So until there is a real session, the write routes are gated on a shared
 * token from the environment. Two properties matter more than elegance here:
 *
 *   - **Unset means closed.** With no `STORE_ADMIN_TOKEN` the routes refuse
 *     everything. A missing variable must not read as "no gate configured,
 *     let it through", which is how this kind of stopgap usually fails.
 *   - **It decides nothing.** When the auth question is answered this file is
 *     the only thing that changes.
 */
import { timingSafeEqual } from "node:crypto";

const HEADER = "x-store-admin-token";

export function adminConfigured(): boolean {
  return !!process.env.STORE_ADMIN_TOKEN;
}

function tokenMatches(given: string): boolean {
  const expected = process.env.STORE_ADMIN_TOKEN ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would leak the length
  // through the error path — compare lengths first and still run the check.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A refusal to return, or null when the request may proceed.
 *
 * 503 rather than 401 when the token is unset: nothing the caller can send
 * would work, and saying so is more useful than a challenge they cannot meet.
 */
export function requireAdmin(req: Request): Response | null {
  if (!adminConfigured()) {
    return Response.json(
      { error: "STORE_ADMIN_TOKEN is not set — the write routes are closed" },
      { status: 503 }
    );
  }
  const given = req.headers.get(HEADER);
  if (!given || !tokenMatches(given)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
