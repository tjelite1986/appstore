/**
 * Who is browsing, according to elite-v2.
 *
 * The two apps sit on the same parent domain and elite-v2 scopes its session
 * cookie to it, so a browser that is logged in there sends the same cookie
 * here. That gets the token to us; it does not tell us whether it is still
 * good. Verifying the signature locally would need elite-v2's `JWT_SECRET`,
 * and would still accept a session that has been revoked — the row proving it
 * exists is in elite-v2's database, and a revoked token stays signed for a
 * week. So the token goes back to elite-v2 to be resolved, and the signing
 * secret stays in the one app that needs it.
 *
 * The cost is a round trip on the write paths. It is paid over the internal
 * docker network (`ELITE_VERIFY_URL` points at the container, not the public
 * hostname), and answers are cached briefly, so a burst of Manage requests
 * asks once. Browsing and downloading never come through here at all.
 */
const SESSION_COOKIE = "elite_session";
const TTL_MS = 30_000;
const TIMEOUT_MS = 5_000;

export interface EliteUser {
  id: number;
  email: string;
  role: "user" | "admin";
}

type Entry = { at: number; user: EliteUser | null };
const cache = new Map<string, Entry>();

export function ssoConfigured(): boolean {
  return !!process.env.ELITE_VERIFY_URL;
}

/**
 * The named cookie out of a raw `Cookie` header.
 *
 * Split on the separator rather than searching for the name: `elite_session`
 * is a suffix of any cookie ending in it, and a substring match would read the
 * wrong value.
 */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim()) || null;
  }
  return null;
}

/**
 * Failures are cached alongside successes, and for the same short window: a
 * revoked session has to stop working promptly, and a token that is simply
 * junk must not turn every request into a round trip.
 */
function remember(token: string, user: EliteUser | null): EliteUser | null {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.at >= TTL_MS) cache.delete(key);
  }
  cache.set(token, { at: now, user });
  return user;
}

export async function eliteUser(req: Request): Promise<EliteUser | null> {
  const url = process.env.ELITE_VERIFY_URL;
  if (!url) return null;

  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;

  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.user;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    // elite-v2 being unreachable is not the same as a bad session, and must
    // not be cached as one — say so in the log, and let the next request try.
    console.error("[sso] could not reach elite-v2 to verify a session:", err);
    return null;
  }

  if (res.status === 401) return remember(token, null);
  if (!res.ok) {
    console.error("[sso] verify answered HTTP", res.status);
    return null;
  }

  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    user?: { id?: unknown; email?: unknown; role?: unknown };
  } | null;
  const user = body?.ok ? body.user : undefined;
  if (
    typeof user?.id !== "number" ||
    typeof user.email !== "string" ||
    (user.role !== "user" && user.role !== "admin")
  ) {
    console.error("[sso] verify returned a body this app does not understand");
    return null;
  }
  return remember(token, { id: user.id, email: user.email, role: user.role });
}
