/**
 * GET  /api/apps/<slug>/artwork          what its upstreams hold
 * POST /api/apps/<slug>/artwork          { picks: [{ kind, url }, …] }
 *
 * The lookup writes nothing and the apply takes explicit URLs, which is the
 * same split `/api/sources/play/fill` makes: the request carries a decision a
 * person made while looking at what was found. Which of the candidates are
 * gaps and which would replace something is decided in front of them, not
 * here — the store has no way to know that the icon already on a listing was
 * put there by hand.
 *
 * Icons and banners come back with the bytes inlined. The CSP is
 * `img-src 'self'`, so a raw.githubusercontent URL in an `<img>` renders as a
 * broken image exactly where somebody is being asked to recognise a logo.
 * Screenshots are listed by name instead: a repository's phone screenshots run
 * to a megabyte each, and inlining eight of them to decide one question is a
 * worse trade than looking at them after they land.
 */
import { requireAdmin } from "@/lib/admin";
import { findArtwork } from "@/lib/sources/artwork";
import { EditError, saveFromUrl, type ImageKind } from "@/lib/edit";
import { fetchImageDataUrl } from "@/lib/sources/net";
import { findApp } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: ImageKind[] = ["icon", "banner", "screenshot"];

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const { slug } = await params;
  const app = await findApp(slug);
  if (!app) return Response.json({ error: "No such app" }, { status: 404 });

  try {
    const found = await findArtwork(app);
    const candidates = await Promise.all(
      found.candidates.map(async (c) => ({
        ...c,
        preview:
          c.kind === "screenshot"
            ? null
            : await fetchImageDataUrl(c.url, `artwork:${slug}`),
      }))
    );
    return Response.json({ ...found, candidates });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[artwork] lookup for ${slug} failed:`, message);
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function POST(
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

  const picks = (body as { picks?: unknown })?.picks;
  if (!Array.isArray(picks) || picks.length === 0) {
    return Response.json({ error: "picks is required" }, { status: 400 });
  }

  // One at a time, in the order they were sent: screenshots are numbered as
  // they arrive, and that numbering is the order of the tour.
  const results: {
    kind: string;
    url: string;
    ok: boolean;
    file?: string;
    error?: string;
  }[] = [];
  for (const pick of picks) {
    const { kind, url } = (pick ?? {}) as Record<string, unknown>;
    const known = KINDS.find((k) => k === kind);
    if (!known) {
      results.push({
        kind: String(kind),
        url: String(url),
        ok: false,
        error: "kind must be icon, banner or screenshot",
      });
      continue;
    }
    try {
      const saved = await saveFromUrl(slug, known, url);
      results.push({ kind: known, url: String(url), ok: true, file: saved.file });
    } catch (err) {
      // One screenshot the far end would not serve should not take the other
      // seven down with it — every pick reports for itself.
      if (!(err instanceof EditError)) throw err;
      results.push({
        kind: known,
        url: String(url),
        ok: false,
        error: err.message,
      });
    }
  }

  const saved = results.filter((r) => r.ok).length;
  if (saved === 0) {
    return Response.json(
      { error: results[0]?.error ?? "Nothing could be saved", results },
      { status: 400 }
    );
  }
  return Response.json({ ok: true, saved, results });
}
