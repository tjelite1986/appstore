/**
 * POST /api/me/saved — keep an app, or stop keeping it.
 *
 * Takes the state to end in (`{ slug, saved }`) rather than "toggle": two taps
 * racing each other, or a retry after a dropped response, must not land the
 * button on the opposite of what it shows.
 */
import { requireUser } from "@/lib/admin";
import { appFor, setSaved } from "@/lib/user-state";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof Response) return gate;

  const body = (await req.json().catch(() => null)) as {
    slug?: unknown;
    saved?: unknown;
  } | null;

  if (typeof body?.slug !== "string" || typeof body.saved !== "boolean") {
    return Response.json(
      { error: "Expected { slug: string, saved: boolean }" },
      { status: 400 }
    );
  }

  // Unsaving is allowed for any slug — an app removed from the library leaves
  // rows behind, and refusing to delete them would strand them forever.
  // Saving goes through `appFor`, the same gate as installing and
  // downloading: an app behind the 18+ gate is "no such app" to an account
  // that has not opened it, and must not be keepable by slug alone.
  if (body.saved && !(await appFor(gate.user.id, body.slug))) {
    return Response.json({ error: "No such app" }, { status: 404 });
  }

  setSaved(gate.user.id, body.slug, body.saved);
  return Response.json({ ok: true, slug: body.slug, saved: body.saved });
}
