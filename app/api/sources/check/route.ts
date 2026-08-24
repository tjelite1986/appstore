/**
 * GET  /api/sources/check   ask every source what it has, change nothing
 * POST /api/sources/check   { install } — and take what is newer
 *
 * The timer calls the POST; the button on Manage calls whichever the person
 * asked for. Both go through the same single-flight run, so a timer landing on
 * top of a click joins that run instead of fetching the same release twice.
 */
import { requireAdmin } from "@/lib/admin";
import { runSourceCheck } from "@/lib/sources/updates";

export const dynamic = "force-dynamic";
// Installing means downloading every release that is new, one after another.
export const maxDuration = 3600;

export async function GET(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;
  return run(false);
}

export async function POST(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  // A body is optional: the timer posts nothing and means "install".
  const body = (await req.json().catch(() => ({}))) as { install?: boolean };
  return run(body?.install !== false);
}

async function run(install: boolean): Promise<Response> {
  try {
    return Response.json(await runSourceCheck({ install }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sources] check failed:", message);
    return Response.json({ error: message }, { status: 502 });
  }
}
