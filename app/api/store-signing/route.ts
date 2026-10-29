/**
 * The work list for scripts/apk-resign.sh — see lib/store-signing.ts.
 *
 *   GET   the files of `storeSigned` listings that do not carry the store's
 *         key yet, with where the served copy is and where its original goes
 *   POST  the script has replaced files: drop the catalog cache so the new
 *         sizes and signers are read now rather than on its next expiry
 *
 * Admin token only. The script does the signing; the app only says what and
 * where, so the rules about which file is served stay in one place.
 */
import { requireAdmin } from "@/lib/admin";
import { getCatalog, invalidateCatalog } from "@/lib/store";
import { pendingStoreSigning, storeSigner } from "@/lib/store-signing";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  // Never sign the placeholder catalog: its slugs are not folders.
  const { apps, placeholder } = await getCatalog();
  if (placeholder) {
    return Response.json({ error: "The library could not be read" }, { status: 503 });
  }
  try {
    return Response.json({
      signer: await storeSigner(),
      files: await pendingStoreSigning(apps),
    });
  } catch (err) {
    console.error("[store-signing] listing pending files failed:", err);
    return Response.json({ error: "Listing pending files failed" }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;
  invalidateCatalog();
  return Response.json({ ok: true });
}
