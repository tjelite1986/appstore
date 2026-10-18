/**
 * POST /api/apps/<slug>/feedback — say whether one build worked.
 *
 * `{ version, status: "working" | "broken" | null }`. Null takes the answer
 * back. Any signed-in account; the admin token is refused like every other
 * per-person write, because a timer has no phone to have tried the file on.
 */
import { requireUser } from "@/lib/admin";
import { isFileStatus, setFileStatus } from "@/lib/file-feedback";
import { appFor } from "@/lib/user-state";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof Response) return gate;

  const { slug } = await params;
  const body = (await req.json().catch(() => null)) as {
    version?: unknown;
    status?: unknown;
  } | null;

  if (
    typeof body?.version !== "string" ||
    (body.status !== null && !isFileStatus(body.status))
  ) {
    return Response.json(
      {
        error:
          'Expected { version: string, status: "working" | "broken" | null }',
      },
      { status: 400 },
    );
  }

  // The 18+ gate holds for writes as for reads: a gated app is not there.
  const app = await appFor(gate.user.id, slug);
  if (!app) return Response.json({ error: "No such app" }, { status: 404 });

  // The build has to be one the library has, or the page can never show the
  // answer anywhere.
  const known =
    app.versions.some((v) => v.version === body.version) ||
    app.version === body.version;
  if (!known) {
    return Response.json(
      { error: "That version is not in the library" },
      { status: 400 },
    );
  }

  setFileStatus(gate.user.id, slug, body.version, body.status);
  return Response.json({
    ok: true,
    version: body.version,
    status: body.status,
  });
}
