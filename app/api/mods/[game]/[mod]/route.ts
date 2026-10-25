/**
 * POST   /api/mods/<game>/<mod>   { refresh: true }   Nexus's (or GitHub's) current words over the old
 * POST   /api/mods/<game>/<mod>   { nexusUrl }        point the listing at another Nexus mod
 * POST   /api/mods/<game>/<mod>   { requirement, to } link a requirement to a mod of the game ("" unlinks)
 * DELETE /api/mods/<game>/<mod>                       move the mod to _discarded
 */
import { requireAdmin } from "@/lib/admin";
import {
  findMod,
  linkRequirement,
  ModAlreadyHere,
  ModError,
  refreshGithubMod,
  refreshMod,
  relinkMod,
  removeMod,
} from "@/lib/mods";
import { lookupGithubMod } from "@/lib/sources/github-mod";
import { lookupNexusMod, parseNexusUrl } from "@/lib/sources/nexus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ game: string; mod: string }> };

function failed(err: unknown): Response {
  if (err instanceof ModAlreadyHere) {
    return Response.json({ error: err.message, ...err.at }, { status: 409 });
  }
  if (err instanceof ModError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  throw err;
}

export async function POST(req: Request, { params }: Params): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const { game, mod } = await params;
  const body = await req.json().catch(() => null);
  if (body && typeof body === "object" && "requirement" in body) {
    try {
      await linkRequirement(game, body.requirement, body.to);
      return Response.json({ ok: true });
    } catch (err) {
      return failed(err);
    }
  }
  if (body && typeof body === "object" && "nexusUrl" in body) {
    const ref = parseNexusUrl(typeof body.nexusUrl === "string" ? body.nexusUrl : "");
    if (!ref) {
      return Response.json(
        { error: "Expected a nexusmods.com/<game>/mods/<id> address" },
        { status: 400 }
      );
    }
    try {
      let nexus;
      try {
        nexus = await lookupNexusMod(ref);
      } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 502 });
      }
      return Response.json({ ok: true, ...(await relinkMod(game, mod, nexus)) });
    } catch (err) {
      return failed(err);
    }
  }
  if (body?.refresh !== true) {
    return Response.json({ error: "Expected { refresh: true } or { nexusUrl }" }, { status: 400 });
  }
  try {
    const current = await findMod(game, mod, true);
    if (!current) return Response.json({ error: "No such mod" }, { status: 404 });
    if (current.github) {
      let github;
      try {
        github = await lookupGithubMod({ owner: current.github.owner, repo: current.github.repo });
      } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 502 });
      }
      return Response.json({ ok: true, added: await refreshGithubMod(game, mod, github) });
    }
    if (!current.nexus) {
      return Response.json({ error: "This mod was not added from Nexus Mods" }, { status: 400 });
    }
    let nexus;
    try {
      nexus = await lookupNexusMod({ domain: current.nexus.domain, modId: current.nexus.modId });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 502 });
    }
    await refreshMod(game, mod, nexus);
    return Response.json({ ok: true });
  } catch (err) {
    return failed(err);
  }
}

export async function DELETE(req: Request, { params }: Params): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  const { game, mod } = await params;
  try {
    await removeMod(game, mod);
    return Response.json({ ok: true });
  } catch (err) {
    return failed(err);
  }
}
