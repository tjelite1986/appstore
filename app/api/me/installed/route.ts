/**
 * POST /api/me/installed — record which version of an app this account has.
 *
 * `{ slug, version }` writes it; `{ slug, version: null }` forgets it. The
 * version is the point: without it Updates cannot tell an app that is current
 * from one with a newer file sitting in the library, which is the only thing
 * that screen exists to answer.
 *
 * Nothing here can see the device, so this is a claim the person makes. The
 * download button offers to make it for them once the file has been handed
 * over, which is as close to "installed" as a web page gets.
 */
import { requireUser } from "@/lib/admin";
import { appFor } from "@/lib/user-state";
import { setInstalled } from "@/lib/user-state";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof Response) return gate;

  const body = (await req.json().catch(() => null)) as {
    slug?: unknown;
    version?: unknown;
  } | null;

  if (
    typeof body?.slug !== "string" ||
    (body.version !== null && typeof body.version !== "string")
  ) {
    return Response.json(
      { error: "Expected { slug: string, version: string | null }" },
      { status: 400 }
    );
  }

  if (body.version !== null) {
    const app = await appFor(gate.user.id, body.slug);
    if (!app) return Response.json({ error: "No such app" }, { status: 404 });
    // The version has to be one the library actually has. A free-text version
    // would compare against the shelf however it liked, and an app could sit
    // on Updates forever claiming an update that is already installed.
    const known =
      app.versions.some((v) => v.version === body.version) ||
      app.version === body.version;
    if (!known) {
      return Response.json(
        { error: "That version is not in the library" },
        { status: 400 }
      );
    }
  }

  setInstalled(gate.user.id, body.slug, body.version);
  return Response.json({ ok: true, slug: body.slug, version: body.version });
}
