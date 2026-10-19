/**
 * POST /api/sources/apkmb/build  { url }  start fetching the APK the page offers
 * GET  /api/sources/apkmb/build?url=…     how that fetch is going
 *
 * The file lands in the drop folder and the importer files it, as it does for
 * a link posted to the Telegram channel; see `lib/sources/apkmb-build.ts`.
 * Admin-gated, both halves: the POST makes this server download a file from
 * another site, and the host is pinned to apkmb.com by `apkmbUrl`.
 */
import { requireAdmin } from "@/lib/admin";
import { apkmbBuildJob, startApkmbBuild } from "@/lib/sources/apkmb-build";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const url = new URL(req.url).searchParams.get("url") ?? "";
  if (!url.trim()) {
    return Response.json({ error: "url is required" }, { status: 400 });
  }
  try {
    return Response.json({ job: apkmbBuildJob(url) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const { url } = (body ?? {}) as { url?: string };
  if (typeof url !== "string" || !url) {
    return Response.json({ error: "url is required" }, { status: 400 });
  }
  try {
    return Response.json({ job: startApkmbBuild(url) }, { status: 202 });
  } catch (err) {
    // `apkmbUrl` refusing the address is the usual one: not an apkmb page.
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 400 });
  }
}
