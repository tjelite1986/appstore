/**
 * PATCH /api/apps/<slug>
 *   { name?, developer?, category?, tagline?, description?, iconBackground?,
 *     iconFit? }
 *
 * The words on a listing, set by hand. Sources write what they can guess and
 * refuse to overwrite; this is the other half — see `lib/edit.ts` for which
 * fields a person owns and which are read off the binary.
 */
import { requireAdmin } from "@/lib/admin";
import { editApp, EditError } from "@/lib/edit";
import { findApp } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const { slug } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  try {
    await editApp(slug, body);
  } catch (err) {
    if (err instanceof EditError) {
      return Response.json(
        { error: err.message },
        { status: err.message === "No such app" ? 404 : 400 }
      );
    }
    throw err;
  }

  // The saved app back, so the form shows what the library actually holds
  // rather than what was typed — a trimmed name and a dropped empty field
  // both differ from the request body.
  const app = await findApp(slug);
  return Response.json({
    ok: true,
    app: app && {
      slug: app.slug,
      name: app.name,
      developer: app.developer,
      category: app.category,
      tagline: app.tagline,
      description: app.description ?? "",
      iconBackground: app.iconBackground ?? "",
      iconFit: app.iconFit ?? "cover",
    },
  });
}
