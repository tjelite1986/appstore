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
import { eliteUser, ssoConfigured, type EliteUser } from "@/lib/sso";

const HEADER = "x-store-admin-token";

// Origin is sent on every request a browser considers unsafe, and on none of
// the safe ones — so a same-origin GET legitimately has no Origin header, and
// requiring one there would break Manage's own reads.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function tokenConfigured(): boolean {
  return !!process.env.STORE_ADMIN_TOKEN;
}

/** True when any way in is configured at all. */
export function adminConfigured(): boolean {
  return tokenConfigured() || ssoConfigured();
}

/**
 * Whether a state-changing request came from this store's own pages.
 *
 * The cookie is the one credential here a browser attaches by itself, which is
 * what makes it worth stealing: any page can make the visitor's browser POST.
 * `SameSite=lax` stops that from another *site*, but every host under one
 * parent domain is the same site, so a page on a sibling service — or a file
 * this store itself serves back — would be trusted without this check.
 *
 * Reads are left alone deliberately. A cross-site navigation can reach one
 * with the cookie attached, but the response is not readable from the page
 * that caused it, and nothing changes.
 */
function sameOrigin(req: Request): boolean {
  if (SAFE_METHODS.has(req.method)) return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
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
  if (user?.role === "admin") {
    if (!sameOrigin(req)) {
      return Response.json(
        { error: "Cross-origin writes are not accepted for a session" },
        { status: 403 }
      );
    }
    return null;
  }
  if (user) {
    return Response.json(
      { error: "This account is not a store admin" },
      { status: 403 }
    );
  }

  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * The gate for the per-user routes: any signed-in account, not just an admin.
 *
 * Different question from `requireAdmin`, so it is a different function rather
 * than a flag. Saving an app changes only that person's own rows, so the bar
 * is a session — but it is still a write, so it still has to come from this
 * store's own pages: `SameSite=lax` does not separate two hosts under one
 * parent domain, and elite-v2's cookie reaches every one of them.
 *
 * The shared admin token is deliberately not accepted here. It belongs to the
 * timers, and a timer is not a person — there is no account for its writes to
 * be about.
 */
export async function requireUser(
  req: Request
): Promise<{ user: EliteUser } | Response> {
  if (!ssoConfigured()) {
    return Response.json(
      { error: "Sign-in is not configured — per-user state is unavailable" },
      { status: 503 }
    );
  }

  const user = await eliteUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOrigin(req)) {
    return Response.json(
      { error: "Cross-origin writes are not accepted for a session" },
      { status: 403 }
    );
  }
  return { user };
}
