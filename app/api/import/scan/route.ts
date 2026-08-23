/**
 * POST /api/import/scan — run the importer over `_import/` now.
 *
 * There is no scheduler in this app (elite-v2 ran it as a job every 300 s), so
 * a scan happens when someone asks for one, or when a host timer posts here
 * with the same token. The response is the full summary rather than a count:
 * a drop that was skipped for being half-uploaded and one that was parked as
 * ambiguous both leave the folder looking unchanged, and the difference is the
 * whole answer to "why is my APK not in the store".
 */
import { requireAdmin } from "@/lib/admin";
import { runImportScan } from "@/lib/import";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const refusal = requireAdmin(req);
  if (refusal) return refusal;

  try {
    return Response.json(await runImportScan());
  } catch (err) {
    console.error("[import] scan failed:", err);
    return Response.json({ error: "Scan failed" }, { status: 500 });
  }
}
