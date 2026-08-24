/**
 * Who is browsing, for a page rather than a route handler.
 *
 * `lib/sso.ts` resolves a `Request`, which is what an API route is handed. A
 * server component is not handed anything — it reads the incoming headers out
 * of `next/headers` instead — so this is the same lookup with the cookie
 * carried across by hand. Kept out of `sso.ts` so that module stays usable
 * anywhere a `Request` exists, including outside the request lifecycle.
 */
import { headers } from "next/headers";
import { eliteUser, type EliteUser } from "./sso";

export async function currentUser(): Promise<EliteUser | null> {
  const cookie = (await headers()).get("cookie");
  if (!cookie) return null;
  // eliteUser only reads the Cookie header; the URL and method are filler.
  return eliteUser(new Request("http://store.local/", { headers: { cookie } }));
}

/** The account id alone — what the per-user helpers take. */
export async function currentUserId(): Promise<number | null> {
  return (await currentUser())?.id ?? null;
}
