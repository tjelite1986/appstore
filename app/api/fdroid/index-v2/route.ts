/**
 * GET /api/fdroid/index-v2   the document `entry.jar` will vouch for
 *
 * The other half of the seam `/api/fdroid/index-v1` opens: the app owns what
 * is in the index, the host owns the key. Index-v2 splits the signing in two —
 * the signature covers a tiny `entry.json` that carries this document's
 * SHA-256 and size, and this document is then fetched unsigned and checked
 * against it.
 *
 * That makes the *bytes* the contract. `scripts/fdroid-sign.sh` writes this
 * response to disk verbatim and hashes the file; anything that reformatted it
 * on the way — a pretty-printer, a proxy that recompresses — would publish an
 * entry that no longer describes the file beside it, and every client would
 * refuse the repository. So there is no formatting option here, and the job
 * does not parse what it is given.
 *
 *     ?adults=1   the whole shelf; without it, the signed-out one
 *
 * `x-index-timestamp` is echoed back because the entry has to carry the same
 * value the document does: a client compares the entry's timestamp with the
 * one it already has and skips the download when they match, so an entry that
 * disagreed with its index would re-download the shelf forever or never again.
 *
 * Pruning stale cache rows is deliberately *not* offered here — index-v1 does
 * it, on the same run, and doing it twice would only mean the second pass
 * deleting rows the first one just wrote.
 */
import { requireAdmin } from "@/lib/admin";
import { buildIndexV2 } from "@/lib/fdroid-index-v2";
import { getApps, withoutAdults } from "@/lib/store";

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

  const all = await getApps();
  const apps = adults ? all : withoutAdults(all);

  // Wall clock, not the newest file: a client skips an index whose timestamp
  // it has already seen, and an edit to an app's name changes the document
  // without touching a single APK.
  const timestamp = Date.now();

  const result = await buildIndexV2(apps, {
    // The address a client was configured with is the one it downloads from,
    // so this field is documentation rather than routing — and it has to name
    // a single URL, which for a per-account token cannot be that account's.
    // The signed-out directory is the honest answer.
    repoUrl: `${publicOrigin(req, url)}/fdroid/repo`,
    repoName: "App Store",
    description:
      "A self-hosted shelf. Add this URL to an F-Droid client to be told about new apps.",
    timestamp,
  });

  return new Response(result.json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "x-index-timestamp": String(timestamp),
      "x-index-apps": String(result.apps),
      "x-index-packages": String(result.packages),
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
