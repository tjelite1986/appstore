import { BASE_PATH } from "@/lib/base-path";

/**
 * The address this repository tells clients it lives at.
 *
 * A signed index carries exactly one `address`, baked in when the signing job
 * runs — a phone that subscribed months ago is still holding the URL it was
 * given. So where the repository answers is a deployment decision, not
 * something to derive from whichever hostname a page happened to be served
 * on: the store's pages can move (behind a path prefix, onto another host)
 * without every subscribed phone having to be re-added by hand.
 *
 * `FDROID_PUBLIC_URL` pins it. Unset — the default, and what a single-host
 * install wants — it is derived exactly as before: the origin the request
 * came in on, plus the mount prefix.
 */
export function repoBaseUrl(derivedOrigin: string): string {
  const pinned = process.env.FDROID_PUBLIC_URL?.trim();
  if (pinned) return pinned.replace(/\/+$/, "");
  return `${derivedOrigin}${BASE_PATH}`;
}

/**
 * The origin a request arrived on, as the client saw it.
 *
 * Behind Traefik the URL Next parsed names the container; the forwarded
 * headers name the host the phone actually asked. The first value of each is
 * the edge's — a proxy appends, it does not prepend.
 */
export function publicOrigin(req: Request, url: URL): string {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim();
  return `${proto || url.protocol.replace(":", "")}://${host || url.host}`;
}
