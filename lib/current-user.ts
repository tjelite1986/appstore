/**
 * Who is browsing, for a page rather than a route handler.
 *
 * `lib/auth.ts` resolves a `Request`, which is what an API route is handed. A
 * server component is not handed anything — it reads the incoming headers out
 * of `next/headers` instead — so this is the same lookup with the cookie
 * carried across by hand.
 */
import { headers } from "next/headers";
import { SESSION_COOKIE, readCookie, userForToken, type StoreUser } from "./auth";

export async function currentUser(): Promise<StoreUser | null> {
  const token = readCookie((await headers()).get("cookie"), SESSION_COOKIE);
  return token ? userForToken(token) : null;
}

/** The account id alone — what the per-user helpers take. */
export async function currentUserId(): Promise<number | null> {
  return (await currentUser())?.id ?? null;
}
