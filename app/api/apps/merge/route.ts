/**
 * POST /api/apps/merge
 *   { from, into, dryRun?, signer? }
 *
 * Fold one listing into another and take the source off the shelf — see
 * `lib/merge.ts` for what moves and what is archived.
 *
 * `dryRun` answers with the plan and writes nothing, which is what the panel
 * shows before its button: a merge moves gigabytes and removes a listing, and
 * neither is worth doing on a guess about which of two slugs is the one with
 * the pictures.
 *
 * POST for both halves. The plan is a read, but the slugs belong in a body
 * rather than a query string, and — more to the point — `requireAdmin` only
 * checks the Origin on an unsafe method. A preview that leaked the catalog's
 * Adults shelf to a cross-site GET would defeat the gate the merge respects.
 */
import { requireAdmin } from "@/lib/admin";
import { mergeApps, MergeError, planMerge, type SignerChoice } from "@/lib/merge";

export const dynamic = "force-dynamic";

const SIGNER_CHOICES: SignerChoice[] = ["keep", "adopt"];

export async function POST(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const { from, into, dryRun, signer } = (body ?? {}) as {
    from?: string;
    into?: string;
    dryRun?: boolean;
    signer?: string;
  };

  if (typeof from !== "string" || !from || typeof into !== "string" || !into) {
    return Response.json(
      { error: "from and into are both required" },
      { status: 400 }
    );
  }
  if (signer !== undefined && !SIGNER_CHOICES.includes(signer as SignerChoice)) {
    return Response.json(
      { error: `signer must be one of ${SIGNER_CHOICES.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    if (dryRun === true) {
      return Response.json({ ok: true, plan: await planMerge(from, into) });
    }
    const result = await mergeApps(from, into, {
      signer: signer as SignerChoice | undefined,
    });
    return Response.json({ ok: true, result });
  } catch (err) {
    // The refusal carries its own status — 409 where the merge is waiting on a
    // decision rather than on a correction. See `MergeError`.
    if (err instanceof MergeError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("[merge] failed:", err);
    return Response.json({ error: "Merge failed" }, { status: 500 });
  }
}
