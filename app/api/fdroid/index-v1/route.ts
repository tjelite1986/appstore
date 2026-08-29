/**
 * GET /api/fdroid/index-v1   the unsigned document a host job seals into a jar
 *
 * The signing key does not live here, and cannot: `jarsigner` and `keytool`
 * ship with a JDK that this container has no reason to carry, and a repository
 * key inside an image is a key inside every copy of that image. So the split
 * is the same one the timers already use — the app owns what goes in the
 * index, the host owns the key — and this endpoint is the seam.
 *
 *     ?adults=1   the whole shelf; without it, the signed-out one
 *     ?prune=1    also drop cache rows for APKs that are no longer there
 *
 * The body is the document itself, byte for byte what goes into the jar, so
 * the job can write it to a file without reading it. What the job wants to
 * *print* travels in headers instead — an `x-index-…` line is a summary, and
 * mixing a summary into the payload would mean the payload is not the payload.
 *
 * Admin-gated like the rest of the machinery: the full shelf is behind an
 * account everywhere else, and this hands it over in one request.
 */
import { requireAdmin } from "@/lib/admin";
import { forgetApkFacts } from "@/lib/apk-facts";
import { forgetApkAbis } from "@/lib/apk-abi";
import { buildIndexV1 } from "@/lib/fdroid-index-v1";
import { getCatalog, withoutAdults } from "@/lib/store";
import { repoBaseUrl } from "@/lib/fdroid-url";

export const dynamic = "force-dynamic";
// A first build hashes the whole shelf; after that it is a stat per file.
export const maxDuration = 3600;

/** Same reasoning as the repository route: the proxy knows the real scheme. */
function publicOrigin(req: Request, url: URL): string {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim();
  return `${proto || url.protocol.replace(":", "")}://${host || url.host}`;
}

export async function GET(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const url = new URL(req.url);
  const adults = url.searchParams.get("adults") === "1";

  // The placeholder catalog is what stands in when nothing could be read
  // from disk — an unmounted library, most likely. Signing an index built
  // from it would publish an empty repository that every subscribed phone
  // then takes as the truth: not "come back later" but "everything is gone".
  // 503 leaves the last good index in place; fdroid-sign.sh dies on it.
  const catalog = await getCatalog();
  if (catalog.placeholder) {
    return new Response("the library could not be read — nothing to sign", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const all = catalog.apps;
  const apps = adults ? all : withoutAdults(all);

  const result = await buildIndexV1(apps, {
    // The address a client was configured with is the one it downloads from,
    // so this field is documentation rather than routing — and it has to name
    // a single URL, which for a per-account token cannot be that account's.
    // The signed-out directory is the honest answer.
    repoUrl: `${repoBaseUrl(publicOrigin(req, url))}/fdroid/repo`,
    repoName: "App Store",
    description:
      "A self-hosted shelf. Add this URL to an F-Droid client to be told about new apps.",
    // Wall clock, not the newest file: a client skips an index whose timestamp
    // it has already seen, and an edit to an app's name changes the document
    // without touching a single APK. Every build is therefore a new index —
    // it is tens of kilobytes, and the alternative is edits that never arrive.
    timestamp: Date.now(),
  });

  // Only the full shelf has seen every file; pruning off the filtered build
  // would delete the cache rows for exactly the APKs it was told to leave out.
  // Both caches are swept, because both are keyed on the same paths — the
  // count below is rows dropped, not files.
  const pruned =
    adults && url.searchParams.get("prune") === "1"
      ? forgetApkFacts(result.seen) + forgetApkAbis(result.seen)
      : 0;

  return new Response(result.json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "x-index-apps": String(result.apps),
      "x-index-packages": String(result.packages),
      "x-index-pruned": String(pruned),
      // One line per left-out listing, semicolon-separated: a header cannot
      // hold newlines and this is short enough to read on one.
      "x-index-skipped": result.skipped
        .map((s) => `${s.slug} (${s.reason})`)
        .join("; ")
        // A header value is latin-1; an app name never reaches here, but a
        // slug is free-form enough that assuming ASCII would be a guess.
        .replace(/[^\x20-\x7e]/g, "?"),
    },
  });
}
