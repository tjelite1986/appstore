/**
 * Who is allowed to change the library.
 *
 * Browsing and downloading never needed a login. The importer does: it moves
 * files around inside the library and can discard them, and the store answers
 * on a public hostname.
 *
 * Two kinds of caller reach these routes, and they prove themselves
 * differently:
 *
 *   - **A person on Manage.** They are logged in to elite-v2, whose session
 *     cookie is scoped to the shared parent domain, so the browser sends it
 *     here as well. `lib/sso.ts` resolves it; `role === "admin"` opens the
 *     write routes. One account, one password, one place to revoke it.
 *   - **A timer.** `scripts/cron.sh` has no browser and no session, so it
 *     keeps a shared token in a header. Machine credentials are the reason
 *     this did not simply become "check the cookie".
 *
 * Unset still means closed. With neither mechanism configured the routes
 * refuse everything — a missing variable must not read as "no gate here, let
 * it through", which is how this kind of gate usually fails.
 */
import { timingSafeEqual } from "node:crypto";
import { eliteUser, ssoConfigured } from "@/lib/sso";

const HEADER = "x-store-admin-token";

export function tokenConfigured(): boolean {
  return !!process.env.STORE_ADMIN_TOKEN;
}

/** True when any way in is configured at all. */
export function adminConfigured(): boolean {
  return tokenConfigured() || ssoConfigured();
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
 * 503 rather than 401 when nothing is configured: no credential the caller
 * could send would work, and saying so is more useful than a challenge they
 * cannot meet. 403 rather than 401 for a signed-in non-admin, so the browser
 * is not told to try again as somebody else — the answer would be the same.
 */
export async function requireAdmin(req: Request): Promise<Response | null> {
  if (!adminConfigured()) {
    return Response.json(
      { error: "No admin credential is configured — the write routes are closed" },
      { status: 503 }
    );
  }

  const given = req.headers.get(HEADER);
  if (given && tokenConfigured() && tokenMatches(given)) return null;

  const user = await eliteUser(req);
  if (user?.role === "admin") return null;
  if (user) {
    return Response.json(
      { error: "This account is not a store admin" },
      { status: 403 }
    );
  }

  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
