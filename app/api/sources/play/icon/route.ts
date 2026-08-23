/**
 * GET /api/sources/play/icon?u=… — one Play listing image, from this origin.
 *
 * The CSP is `img-src 'self'`, and a search result's icon lives on Google's
 * CDN. Widening the policy for one admin screen would weaken every page in the
 * store, so the bytes come through here instead. Nothing is written to the
 * library: these are previews for a list of things not added yet.
 *
 * The host allowlist is the whole security of it — without it this is an open
 * proxy that can reach anything the container can, including services on the
 * docker network that are not on the internet at all.
 */
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

const HOSTS = new Set(["play-lh.googleusercontent.com", "lh3.googleusercontent.com"]);
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export async function GET(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const raw = new URL(req.url).searchParams.get("u") ?? "";
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("Not a URL", { status: 400 });
  }
  if (target.protocol !== "https:" || !HOSTS.has(target.hostname)) {
    return new Response("Not a Play image", { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(target, {
      // A redirect off the allowlisted host would defeat the check above.
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return new Response("Upstream did not answer", { status: 502 });
  }
  if (!res.ok) return new Response("Upstream said no", { status: 502 });

  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!type.startsWith("image/")) {
    return new Response("Not an image", { status: 502 });
  }
  const body = Buffer.from(await res.arrayBuffer());
  if (body.byteLength > MAX_BYTES) {
    return new Response("Too large", { status: 502 });
  }

  return new Response(body, {
    headers: {
      "content-type": type,
      "content-length": String(body.byteLength),
      // A listing icon does not change under its URL — Play mints a new one.
      "cache-control": "private, max-age=86400",
    },
  });
}
