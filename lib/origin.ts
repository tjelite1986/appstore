/**
 * The origin the browser used to get here.
 *
 * Almost nothing on a page needs this: links and asset URLs are app-absolute
 * and the browser resolves them against the address it is already on, and
 * where the repository answers is pinned by the deployment instead
 * (`lib/fdroid-url.ts`). Open Graph is the exception. Those tags are read by a
 * machine that is not the browser and is not on this site — Telegram fetches
 * the page and then fetches the image named in it — so the image and the
 * canonical address have to be absolute or they are simply dropped.
 *
 * Behind the proxy Next reconstructs `req.url` from the Host header, which is
 * right about the host and wrong about the scheme, so the forwarded headers
 * win where they are set. Same reading as `publicOrigin` in the F-Droid route,
 * taken from `next/headers` rather than a `Request` because a server
 * component is not handed one.
 */
import { headers } from "next/headers";

export async function requestOrigin(): Promise<string | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0].trim() || h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() || "https";
  return `${proto}://${host}`;
}
