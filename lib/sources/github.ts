/**
 * GitHub releases, as a source of both words and binaries.
 *
 * Unlike Play, a repository hands out its APKs — so an app added from here
 * arrives complete: a shelf with a description on it and the newest release
 * already on it. What it cannot supply is artwork; a repository has an owner
 * avatar and nothing else, and that is a picture of a person or an
 * organisation, not of the app. So the icon stays empty until an icon shows
 * up, which reads better than a shelf of identical octocats.
 *
 * `GITHUB_TOKEN` is optional and only raises the rate limit — 60 anonymous
 * requests an hour is enough for adding apps by hand, and not enough for a
 * timer checking twenty of them.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { STORE_DIRS, STORE_ROOT } from "@/lib/storage";
import { uniqueSlug, writeMeta } from "@/lib/import";
import { getApps, invalidateCatalog, type StoreApp } from "@/lib/store";
import { USER_AGENT } from "@/lib/sources/net";
import { installLinked, type LinkedVersion } from "@/lib/sources/install";

/** How far back to look for a release that actually carries an APK. */
const RELEASE_PAGE = 10;
const API_TIMEOUT_MS = 20_000;

export type RepoRef = { owner: string; repo: string };

export type GithubAsset = { name: string; url: string; bytes: number };

export type GithubRelease = {
  tag: string;
  prerelease: boolean;
  publishedAt: string | null;
  asset: GithubAsset;
};

/** `owner/repo`, or any github.com URL pointing at one. */
export function parseRepoRef(input: string): RepoRef | null {
  const s = input.trim();
  const url = s.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (url) return { owner: url[1], repo: url[2].replace(/\.git$/i, "") };
  const bare = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (bare) return { owner: bare[1], repo: bare[2].replace(/\.git$/i, "") };
  return null;
}

export function repoUrl(ref: RepoRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}`;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": USER_AGENT,
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function api(
  pathname: string,
  opts: { missingIsNull?: boolean } = {}
): Promise<any> {
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: headers(),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
    cache: "no-store",
  });
  if (res.status === 404) {
    // Asking for a path that most repositories do not have is a question, not
    // a failure — see `repoContents`.
    if (opts.missingIsNull) return null;
    throw new Error("GitHub has no such repository");
  }
  if (res.status === 403 || res.status === 429) {
    // Anonymous requests are 60 an hour for the whole machine, so this is the
    // failure a timer hits first — say which knob fixes it.
    throw new Error("GitHub is rate-limiting this server (set GITHUB_TOKEN)");
  }
  if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
  return res.json();
}

const APK_ASSET = /\.(apk|xapk|apks|apkm)$/i;

/**
 * The one asset to install out of a release.
 *
 * A project that ships per-ABI builds is publishing the same app several
 * times, and this store serves one file per version — so prefer the build
 * that runs anywhere, then the one this machine's phones use. A debug build
 * is never it.
 */
export function pickAsset(assets: GithubAsset[]): GithubAsset | null {
  const apks = assets.filter(
    (a) => APK_ASSET.test(a.name) && !/debug|unsigned|sources?/i.test(a.name)
  );
  if (apks.length === 0) return null;

  const tiers: ((a: GithubAsset) => boolean)[] = [
    (a) => /universal|all[-_.]?arch/i.test(a.name),
    (a) => /arm64|aarch64/i.test(a.name),
    () => true,
  ];
  for (const tier of tiers) {
    const matching = apks.filter(tier);
    if (matching.length > 0) return plainest(matching);
  }
  return apks[0];
}

/**
 * The least-qualified name in a set of equals.
 *
 * A release that ships several builds of the same architecture distinguishes
 * them by adding words — `app-arm64-v8a-fdroid-release.apk` beside
 * `app-arm64-v8a-release.apk` — and the one with nothing added is the build
 * meant for whoever downloads it straight from the release page. Shortest name
 * is a proxy for that, and a cheap one to be wrong about: it picks a sibling
 * of the same app rather than something else entirely.
 */
function plainest(assets: GithubAsset[]): GithubAsset {
  return [...assets].sort(
    (a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name)
  )[0];
}

/** The newest release carrying an APK, looking past ones that carry none. */
export async function latestRelease(ref: RepoRef): Promise<GithubRelease | null> {
  const list = await api(
    `/repos/${ref.owner}/${ref.repo}/releases?per_page=${RELEASE_PAGE}`
  );
  if (!Array.isArray(list)) return null;

  for (const release of list) {
    if (release?.draft) continue;
    const assets: GithubAsset[] = (release?.assets ?? []).map((a: any) => ({
      name: String(a?.name ?? ""),
      url: String(a?.browser_download_url ?? ""),
      bytes: Number(a?.size ?? 0),
    }));
    const asset = pickAsset(assets.filter((a) => a.url));
    if (!asset) continue;
    return {
      tag: String(release?.tag_name ?? ""),
      prerelease: Boolean(release?.prerelease),
      publishedAt: release?.published_at ? String(release.published_at) : null,
      asset,
    };
  }
  return null;
}

export type RepoFile = {
  name: string;
  type: "file" | "dir";
  path: string;
  /** Where the bytes are, for a file. A directory has none. */
  downloadUrl: string | null;
};

/**
 * One directory of a repository, or null when there is no such path.
 *
 * A 404 is an ordinary answer here. Most repositories carry no fastlane
 * metadata, and `lib/sources/artwork.ts` finds that out by asking — treating
 * the absence as an error would make "this repo has no artwork" read like a
 * broken lookup.
 */
export async function repoContents(
  ref: RepoRef,
  pathname: string
): Promise<RepoFile[] | null> {
  const body = await api(
    `/repos/${ref.owner}/${ref.repo}/contents/${pathname}`,
    { missingIsNull: true }
  );
  // A file path answers with an object; only a directory listing is an array.
  if (!Array.isArray(body)) return null;
  return body.map((f: any) => ({
    name: String(f?.name ?? ""),
    type: f?.type === "dir" ? "dir" : "file",
    path: String(f?.path ?? ""),
    downloadUrl: f?.download_url ? String(f.download_url) : null,
  }));
}

/** The repository itself — its description, its owner, its avatar. */
export async function repoInfo(ref: RepoRef): Promise<any> {
  return api(`/repos/${ref.owner}/${ref.repo}`);
}

export type GithubAddResult = {
  slug: string;
  name: string;
  repo: string;
  linked: LinkedVersion & { assetUrl: string };
};

/**
 * Add a repository to the catalog and link its newest release.
 *
 * The release is fetched once and then thrown away: GitHub goes on hosting the
 * file, so a mirrored copy only adds a second thing to keep current. What the
 * fetch is for is the two facts that exist nowhere else — the version string
 * inside the manifest and the signer of the binary — and those are kept.
 *
 * The clash checks come before the download, not after: a 200 MB release
 * fetched only to be refused at the last step wastes the line and leaves the
 * person waiting for an answer that was knowable at the start.
 */
export async function addFromGitHub(input: string): Promise<GithubAddResult> {
  const ref = parseRepoRef(input);
  if (!ref) {
    throw new Error("Enter a repository as owner/name, or paste its URL");
  }

  const apps = await getApps();
  const existing = apps.find(
    (a) =>
      a.source?.kind === "github" &&
      a.source.repo?.toLowerCase() === `${ref.owner}/${ref.repo}`.toLowerCase()
  );
  if (existing) {
    throw new Error(`${existing.name} is already in the catalog from that repo`);
  }

  const repo = await api(`/repos/${ref.owner}/${ref.repo}`);
  const release = await latestRelease(ref);
  if (!release) {
    throw new Error(
      "None of that repository's recent releases has an APK attached"
    );
  }

  const name = String(repo?.name ?? ref.repo).replace(/[-_]+/g, " ").trim();
  const slug = await uniqueSlug(name);

  // Claim the slug before the download so a second add of the same repo
  // collides here rather than both arriving at the same shelf.
  await writeMeta(slug, {
    name,
    developer: String(repo?.owner?.login ?? ref.owner),
    category: "Other",
    tagline: typeof repo?.description === "string" ? repo.description : undefined,
    source: {
      kind: "github",
      url: repoUrl(ref),
      repo: `${ref.owner}/${ref.repo}`,
      releaseTag: release.tag,
      addedFrom: "manage/add",
    },
  });
  invalidateCatalog();

  let linked: LinkedVersion;
  try {
    linked = await installLinked(slug, release.asset.url, {
      fileName: release.asset.name,
      tag: "github",
      fallbackVersion: release.tag.replace(/^v/i, ""),
    });
  } catch (err) {
    // The shelf was written a moment ago and has nothing on it — leaving it
    // behind would put a row in the catalog for an app that failed to arrive.
    await removeMeta(slug);
    invalidateCatalog();
    throw err;
  }

  await writeMeta(slug, {
    packageName: linked.packageName ?? undefined,
    // The pin a later release is checked against, exactly as the importer
    // would have set it had the file stayed.
    signingCert: linked.signerSha256 ?? undefined,
    source: linkedSource(ref, release, linked),
  });
  invalidateCatalog();

  return {
    slug,
    name,
    repo: `${ref.owner}/${ref.repo}`,
    linked: { ...linked, assetUrl: release.asset.url },
  };
}

/**
 * The source object for a linked release — the whole of it.
 *
 * `writeMeta` merges one level deep, so a patch carrying half a source would
 * drop the other half. Building it in one place keeps the repo and the asset
 * from ever describing different releases.
 */
export function linkedSource(
  ref: RepoRef,
  release: GithubRelease,
  linked: LinkedVersion,
  addedFrom = "manage/add"
): Record<string, unknown> {
  return {
    kind: "github",
    url: repoUrl(ref),
    repo: `${ref.owner}/${ref.repo}`,
    releaseTag: release.tag,
    assetUrl: release.asset.url,
    assetName: release.asset.name,
    assetBytes: release.asset.bytes,
    // What the binary said about itself. The tag is what the author called it;
    // these disagree often enough that showing the tag would file the app under
    // a version the phone never reports.
    assetVersion: linked.version,
    addedFrom,
  };
}

/**
 * Point an already-linked app at a newer release.
 *
 * The same fetch-read-discard as adding one, with the pin this app already
 * carries handed to the check: an app that was linked under one signer does
 * not silently start pointing at a release signed by someone else.
 */
export async function relinkGitHub(
  app: StoreApp,
  release: GithubRelease
): Promise<LinkedVersion> {
  const ref = parseRepoRef(app.source?.repo ?? "");
  if (!ref) throw new Error("that listing has no repository to link to");

  const linked = await installLinked(app.slug, release.asset.url, {
    fileName: release.asset.name,
    tag: "github",
    fallbackVersion: release.tag.replace(/^v/i, ""),
    pinnedSigner: app.signingCert ?? null,
  });

  await writeMeta(app.slug, {
    packageName: app.packageName ?? linked.packageName ?? undefined,
    signingCert: app.signingCert ?? linked.signerSha256 ?? undefined,
    source: linkedSource(ref, release, linked, app.source?.addedFrom),
  });
  return linked;
}

/** True when this app is served as a link upstream rather than from disk. */
export function isLinked(app: StoreApp): boolean {
  return typeof app.source?.assetUrl === "string" && app.source.assetUrl !== "";
}

async function removeMeta(slug: string): Promise<void> {
  await fs
    .unlink(path.join(STORE_ROOT, STORE_DIRS.meta, `${slug}.json`))
    .catch(() => {});
}

/**
 * What the repository has now, against what the app already holds.
 *
 * Returns null when the app is not from GitHub, or when the repository has
 * nothing installable — both are "no update", and neither is an error.
 */
export async function checkGitHub(app: StoreApp): Promise<GithubRelease | null> {
  if (app.source?.kind !== "github" || !app.source.repo) return null;
  const ref = parseRepoRef(app.source.repo);
  if (!ref) return null;
  return latestRelease(ref);
}
