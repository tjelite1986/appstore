/**
 * A mod that is only on GitHub, read so its page looks like a Nexus one: the
 * repository's name and description, its owner as the author, the README as
 * the description (written over as BBCode, `lib/markdown-bbcode.ts`), and the
 * newest release for the version, the changelog and the files.
 *
 * Nothing here writes; `lib/mods.ts` decides what of it is kept. The release
 * archives are fetched by the store itself — unlike Nexus, GitHub hands them
 * out — so a mod added from here arrives with its download.
 */
import { api, parseRepoRef, repoUrl, type RepoRef } from "@/lib/sources/github";
import { fetchImageDataUrl } from "@/lib/sources/net";
import { markdownToBBCode } from "@/lib/markdown-bbcode";

/** Releases read for the version, the changelog and the download count. */
const RELEASE_PAGE = 30;
/** The archives a release can carry that a mod page offers. */
const MOD_ASSET = /\.(zip|7z|rar)$/i;

export type GithubModAsset = { name: string; url: string; bytes: number };

export type GithubMod = {
  ref: RepoRef;
  url: string;
  name: string;
  summary: string;
  /** BBCode, like a Nexus description. */
  description: string;
  author: string;
  /** The newest release's tag, without a leading v. */
  version: string;
  stars: number;
  /** Every listed release's archives, downloaded — Nexus counts all files too. */
  downloads: number;
  updatedAt: string;
  pictureUrl: string | null;
  /** The release the version and files come from; null when there is none with an archive. */
  release: { tag: string; url: string; publishedAt: string; assets: GithubModAsset[] } | null;
};

type ApiRepo = {
  name?: unknown;
  description?: unknown;
  stargazers_count?: unknown;
  pushed_at?: unknown;
  html_url?: unknown;
  owner?: { login?: unknown };
} | null;
type ApiReadme = { content?: unknown; download_url?: unknown; html_url?: unknown } | null;
type ApiRelease = {
  draft?: boolean;
  prerelease?: boolean;
  tag_name?: unknown;
  html_url?: unknown;
  body?: unknown;
  published_at?: unknown;
  assets?: { name?: unknown; browser_download_url?: unknown; size?: unknown; download_count?: unknown }[];
};

export { parseRepoRef };

/** A release asset GitHub itself serves; anything else is not fetched. */
function githubAsset(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "github.com";
  } catch {
    return false;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The first picture the description shows, as the page's banner. */
function firstImage(bbcode: string): string | null {
  return /\[img\](https?:\/\/[^[\s]+)\[\/img\]/i.exec(bbcode)?.[1] ?? null;
}

export async function lookupGithubMod(ref: RepoRef): Promise<GithubMod> {
  const repo = (await api(`/repos/${ref.owner}/${ref.repo}`)) as ApiRepo;
  // A repository with no README, or no releases, is still a mod page.
  const readme = (await api(`/repos/${ref.owner}/${ref.repo}/readme`, {
    missingIsNull: true,
  })) as ApiReadme;
  const releases = await api(`/repos/${ref.owner}/${ref.repo}/releases?per_page=${RELEASE_PAGE}`);
  // GitHub's own casing, so the listing is not filed under what was typed.
  const owner = text(repo?.owner?.login) || ref.owner;
  const name = text(repo?.name) || ref.repo;
  const canonical: RepoRef = { owner, repo: name };

  let downloads = 0;
  const withArchives: { release: NonNullable<GithubMod["release"]>; prerelease: boolean; notes: string }[] = [];
  for (const r of (Array.isArray(releases) ? releases : []) as ApiRelease[]) {
    if (!r || r.draft) continue;
    for (const a of r.assets ?? []) downloads += Number(a?.download_count ?? 0) || 0;
    const assets = (r.assets ?? [])
      .map((a) => ({
        name: text(a?.name),
        url: text(a?.browser_download_url),
        bytes: Number(a?.size ?? 0) || 0,
      }))
      .filter((a) => MOD_ASSET.test(a.name) && githubAsset(a.url));
    if (!assets.length) continue;
    withArchives.push({
      release: {
        tag: text(r.tag_name),
        url: text(r.html_url) || `${repoUrl(canonical)}/releases`,
        publishedAt: text(r.published_at),
        assets,
      },
      prerelease: Boolean(r.prerelease),
      notes: text(r.body),
    });
  }
  // The newest stable release with an archive; a prerelease only when there is no other.
  const picked = withArchives.find((r) => !r.prerelease) ?? withArchives[0] ?? null;
  const release = picked?.release ?? null;
  const changelog = picked?.notes ?? "";

  const readmeRaw = text(readme?.download_url);
  const readmePage = text(readme?.html_url) || repoUrl(canonical);
  const base = { raw: readmeRaw || `${repoUrl(canonical)}/raw/HEAD/`, page: readmePage };
  let description = readme?.content
    ? markdownToBBCode(Buffer.from(text(readme.content), "base64").toString("utf8"), base)
    : "";
  if (release && changelog.trim()) {
    // Nexus shows a changelog per version; the release notes are GitHub's.
    description += `${description ? "\n\n" : ""}[size=5]What's new in ${release.tag}[/size]\n\n${markdownToBBCode(changelog, base)}`;
  }

  return {
    ref: canonical,
    url: repoUrl(canonical),
    name,
    summary: text(repo?.description),
    description,
    author: owner,
    version: release ? release.tag.replace(/^v(?=\d)/i, "") : "",
    stars: Number(repo?.stargazers_count ?? 0) || 0,
    downloads,
    updatedAt: release?.publishedAt || text(repo?.pushed_at),
    // The README's first picture, else GitHub's own card for the repository.
    pictureUrl:
      firstImage(description) ?? `https://opengraph.githubassets.com/1/${owner}/${name}`,
    release,
  };
}

/** The lookup as the add panel shows it; the picture inlined for the CSP. */
export async function previewGithubMod(
  ref: RepoRef
): Promise<GithubMod & { pictureDataUrl: string | null }> {
  const mod = await lookupGithubMod(ref);
  const pictureDataUrl = mod.pictureUrl ? await fetchImageDataUrl(mod.pictureUrl, "github") : null;
  return { ...mod, pictureDataUrl };
}
