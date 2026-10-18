/**
 * POST /api/sources/fdroid   { packageId, separate? } — add an F-Droid
 *                              package and install its recommended build;
 *                              409 with the existing slug when the id is
 *                              already here, unless `separate` asks for a
 *                              second listing
 *
 * Admin-gated like the rest of the write surface. `packageId` is the package
 * id, or the F-Droid page URL that carries one.
 */
import { requireAdmin } from "@/lib/admin";
import { AlreadyHere, alreadyHereResponse } from "@/lib/sources/already-here";
import { addFromFdroid } from "@/lib/sources/fdroid";

export const dynamic = "force-dynamic";
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
  const { packageId, separate } = (body ?? {}) as {
    packageId?: string;
    separate?: boolean;
  };
  if (typeof packageId !== "string" || !packageId.trim()) {
    return Response.json({ error: "packageId is required" }, { status: 400 });
  }

  try {
    return Response.json(
      await addFromFdroid(packageId, { separate: separate === true }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[fdroid] add failed:", message);
    // "Already here" is an offer, not a fault: the panel asks again with
    // `separate` once the person has said a second listing is what they want.
    if (err instanceof AlreadyHere) return alreadyHereResponse(err);
    return Response.json({ error: message }, { status: 400 });
  }
}
