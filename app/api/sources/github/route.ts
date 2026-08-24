/**
 * POST /api/sources/github   { ref } — add a repository and install its
 *                                      newest release
 *
 * Admin-gated like the rest of the write surface. `ref` is "owner/name" or any
 * github.com URL pointing at one.
 */
import { requireAdmin } from "@/lib/admin";
import { addFromGitHub } from "@/lib/sources/github";

export const dynamic = "force-dynamic";
// A release is a few hundred megabytes over whatever line the far end gives
// us, and the response is the answer to "did it land".
export const maxDuration = 1800;

export async function POST(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const { ref } = (body ?? {}) as { ref?: string };
  if (typeof ref !== "string" || !ref.trim()) {
    return Response.json({ error: "ref is required" }, { status: 400 });
  }

  try {
    return Response.json(await addFromGitHub(ref));
  } catch (err) {
    // Everything addFromGitHub throws is a sentence for the person who
    // clicked: no such repo, no APK in the releases, already in the catalog.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[github] add failed:", message);
    return Response.json({ error: message }, { status: 400 });
  }
}
