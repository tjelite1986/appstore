/**
 * Nexus Mods as a source of words and pictures for a mod.
 *
 * The mod pages themselves sit behind a Cloudflare challenge that answers a
 * server with a 403, but Nexus also runs a public GraphQL API that needs no
 * key for a mod's listing. That is what this reads: the address somebody
 * pasted is only parsed for its game domain and mod id, and the request goes
 * to one fixed host — so nothing typed into a form ever becomes a URL this
 * server opens.
 *
 * Like Play, Nexus is metadata only. The download on Nexus needs an account
 * (and, for a server, a premium API key), so the file itself is uploaded by
 * hand onto the listing this creates.
 */
import { fetchImageDataUrl, USER_AGENT } from "./net";

const GRAPHQL = "https://api.nexusmods.com/v2/graphql";
const TIMEOUT_MS = 15_000;

export type NexusRef = { domain: string; modId: number };

export type NexusMod = {
  ref: NexusRef;
  /** The canonical page, rebuilt from the ref rather than echoed back. */
  url: string;
  name: string;
  summary: string;
  /** Nexus BBCode, as written — see `lib/bbcode.ts`. */
  description: string;
  version: string;
  author: string;
  category: string;
  endorsements: number;
  downloads: number;
  createdAt: string;
  updatedAt: string;
  adult: boolean;
  pictureUrl: string | null;
  game: { name: string; domain: string; id: number; coverUrl: string };
};

/**
 * `https://www.nexusmods.com/<game>/mods/<id>`, with or without `www.`, a
 * query or a `?tab=files` — anything else is null.
 */
export function parseNexusUrl(raw: string): NexusRef | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname !== "nexusmods.com" && url.hostname !== "www.nexusmods.com") {
    return null;
  }
  const match = /^\/([a-z0-9]+)\/mods\/(\d+)\/?$/i.exec(url.pathname);
  if (!match) return null;
  const modId = Number(match[2]);
  if (!Number.isSafeInteger(modId) || modId <= 0) return null;
  return { domain: match[1].toLowerCase(), modId };
}

export function nexusModUrl(ref: NexusRef): string {
  return `https://www.nexusmods.com/${ref.domain}/mods/${ref.modId}`;
}

const QUERY = `query ($ids: [CompositeDomainWithIdInput!]!) {
  legacyModsByDomain(ids: $ids) {
    nodes {
      name summary description version author
      uploader { name }
      modCategory { name }
      endorsements downloads createdAt updatedAt adultContent pictureUrl
      game { name domainName id }
    }
  }
}`;

type Node = {
  name?: string;
  summary?: string;
  description?: string;
  version?: string;
  author?: string;
  uploader?: { name?: string } | null;
  modCategory?: { name?: string } | null;
  endorsements?: number;
  downloads?: number;
  createdAt?: string;
  updatedAt?: string;
  adultContent?: boolean;
  pictureUrl?: string | null;
  game?: { name?: string; domainName?: string; id?: number } | null;
};

/** The mod a ref names, or a sentence saying why not. */
export async function lookupNexusMod(ref: NexusRef): Promise<NexusMod> {
  let res: Response;
  try {
    res = await fetch(GRAPHQL, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": USER_AGENT },
      body: JSON.stringify({
        query: QUERY,
        variables: { ids: [{ gameDomain: ref.domain, modId: ref.modId }] },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(`Nexus Mods did not answer: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`Nexus Mods answered HTTP ${res.status}`);

  const data = (await res.json().catch(() => null)) as {
    data?: { legacyModsByDomain?: { nodes?: Node[] } };
    errors?: { message?: string }[];
  } | null;
  if (data?.errors?.length) {
    throw new Error(`Nexus Mods refused the lookup: ${data.errors[0].message ?? "unknown error"}`);
  }
  const node = data?.data?.legacyModsByDomain?.nodes?.[0];
  // A hidden or removed mod comes back as no node, or as a node without a name.
  if (!node?.name || !node.game?.domainName || typeof node.game.id !== "number") {
    throw new Error("Nexus Mods has no public mod at that address");
  }

  return {
    ref,
    url: nexusModUrl(ref),
    name: node.name,
    summary: node.summary ?? "",
    description: node.description ?? "",
    version: node.version ?? "",
    author: node.author || node.uploader?.name || "",
    category: node.modCategory?.name ?? "",
    endorsements: node.endorsements ?? 0,
    downloads: node.downloads ?? 0,
    createdAt: node.createdAt ?? "",
    updatedAt: node.updatedAt ?? "",
    adult: node.adultContent === true,
    pictureUrl: node.pictureUrl || null,
    game: {
      name: node.game.name ?? ref.domain,
      domain: node.game.domainName,
      id: node.game.id,
      coverUrl: `https://images.nexusmods.com/images/games/v2/${node.game.id}/tile.jpg`,
    },
  };
}

/**
 * The lookup as the add panel shows it, before anything is written. The
 * picture is inlined: it is on Nexus's CDN and the page's CSP is
 * `img-src 'self'`.
 */
export async function previewNexusMod(
  ref: NexusRef
): Promise<NexusMod & { pictureDataUrl: string | null }> {
  const mod = await lookupNexusMod(ref);
  const pictureDataUrl = mod.pictureUrl
    ? await fetchImageDataUrl(mod.pictureUrl, "nexus")
    : null;
  return { ...mod, pictureDataUrl };
}
