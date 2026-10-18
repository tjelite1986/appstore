/**
 * POST   /api/apps/<slug>/comments — `{ version, body }` adds a comment.
 * DELETE /api/apps/<slug>/comments — `{ id }` removes one: the author's own,
 *                                    or any for an admin.
 *
 * Comments are per build, like the working/broken answer, and are shown to
 * everyone who can see the app. Writing needs an account; there is no
 * anonymous box on a store that answers on a public hostname.
 */
import { requireUser } from "@/lib/admin";
import { COMMENT_MAX, addComment, deleteComment } from "@/lib/file-feedback";
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
    body?: unknown;
  } | null;

  if (typeof body?.version !== "string" || typeof body.body !== "string") {
    return Response.json(
      { error: "Expected { version: string, body: string }" },
      { status: 400 },
    );
  }

  const text = body.body.trim();
  if (!text) {
    return Response.json({ error: "The comment is empty" }, { status: 400 });
  }
  if (text.length > COMMENT_MAX) {
    return Response.json(
      { error: `A comment is at most ${COMMENT_MAX} characters` },
      { status: 400 },
    );
  }

  const app = await appFor(gate.user.id, slug);
  if (!app) return Response.json({ error: "No such app" }, { status: 404 });

  const known =
    app.versions.some((v) => v.version === body.version) ||
    app.version === body.version;
  if (!known) {
    return Response.json(
      { error: "That version is not in the library" },
      { status: 400 },
    );
  }

  const id = addComment(gate.user.id, slug, body.version, text);
  return Response.json({ ok: true, id });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof Response) return gate;

  const { slug } = await params;
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  if (!Number.isInteger(body?.id)) {
    return Response.json({ error: "Expected { id: number }" }, { status: 400 });
  }

  // No app lookup: a comment on a listing that has since been pruned should
  // still be removable, and the row itself is scoped to the slug.
  if (!deleteComment(gate.user, slug, body!.id as number)) {
    return Response.json({ error: "No such comment" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
