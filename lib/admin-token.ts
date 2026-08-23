/**
 * The fallback admin token, as the browser keeps it.
 *
 * Normally nothing on Manage needs this: an admin signed in to elite-v2 is
 * signed in here too, and the cookie travels on its own (see `lib/admin.ts`).
 * The token is what is left when they are not — the same shared secret the
 * host timers use.
 *
 * It lives in localStorage rather than a cookie deliberately. A value the
 * browser never attaches by itself cannot be used by another page to make this
 * store act as whoever is looking at it.
 *
 * No "use client" here on purpose — this is a constant and a try/catch, so it
 * can be pulled into a client component without dragging a module boundary
 * along with it.
 */
export const ADMIN_TOKEN_KEY = "store-admin-token";

export function readAdminToken(): string {
  try {
    return window.localStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
  } catch {
    // Private mode: the token simply does not persist.
    return "";
  }
}

/** The admin-token header, or nothing at all when there is no token. */
export function adminHeaders(token: string): Record<string, string> {
  return token ? { "x-store-admin-token": token } : {};
}
