/**
 * Finding the pictures an app already has somewhere else.
 *
 * Every app in this catalog arrived with its artwork missing, and the artwork
 * exists — an Android project that publishes releases almost always carries
 * `fastlane/metadata/android/<locale>/images/` in the same repository, because
 * that is the directory F-Droid reads to build a listing. It holds `icon.png`,
 * `featureGraphic.png` and a folder of phone screenshots, drawn by the people
 * who wrote the app. The store was ignoring all of it and asking a person to
 * upload files by hand.
 *
 * The icon inside the APK would be the truest source, and it is out of reach:
 * a linked app keeps no binary, and even with one the icon is a resource id
 * that has to be resolved through `resources.arsc` — where a modern adaptive
 * icon turns out to be an XML drawable that nothing here can render. The
 * fastlane PNG is what the developer publishes *as* the icon, which is the
 * better answer anyway.
 *
 * Nothing here writes. A lookup returns candidates and says where each came
 * from; applying them is a separate decision, the same split
 * `/api/sources/play/fill` makes.
 */
import type { ImageKind } from "@/lib/edit";
import type { StoreApp } from "@/lib/store";
import { fetchApp as fetchFdroidApp } from "@/lib/sources/fdroid";
import {
  parseRepoRef,
  repoContents,
  repoInfo,
  type RepoFile,
  type RepoRef,
} from "@/lib/sources/github";

/** Enough for a listing; past this it is a gallery, not a store page. */
const MAX_SCREENSHOTS = 8;

/** Where the roots live, in the order projects actually use them. */
const METADATA_ROOTS = [
  "fastlane/metadata/android",
  "metadata/android",
  "metadata",
];

const LOCALE_ORDER = ["en-US", "en_US", "en-GB", "en"];

const IMAGE_NAME = /\.(png|jpe?g|webp)$/i;

export type ArtworkCandidate = {
  kind: ImageKind;
  url: string;
  /** Which upstream this came out of, so a person can weigh it. */
  from: "fastlane" | "fdroid" | "github";
  /** What it is called where it lives — `en-US/images/icon.png`. */
  label: string;
};

export type ArtworkFind = {
  slug: string;
  /** What the listing already holds, so a caller can offer only the gaps. */
  has: { icon: boolean; banner: boolean; screenshots: number };
  candidates: ArtworkCandidate[];
  /** Every place that was asked, whether or not it answered. */
  looked: string[];
};

function pickLocale(dirs: RepoFile[]): RepoFile | null {
  const locales = dirs.filter((d) => d.type === "dir");
  for (const want of LOCALE_ORDER) {
    const hit = locales.find((d) => d.name.toLowerCase() === want.toLowerCase());
    if (hit) return hit;
  }
  // Any English at all before falling back to whatever is first: a listing in
  // the developer's own language is still better than no pictures.
  return locales.find((d) => /^en/i.test(d.name)) ?? locales[0] ?? null;
}

function named(files: RepoFile[], base: string): RepoFile | null {
  return (
    files.find(
      (f) =>
        f.type === "file" &&
        IMAGE_NAME.test(f.name) &&
        f.name.slice(0, f.name.lastIndexOf(".")).toLowerCase() === base
    ) ?? null
  );
}

/**
 * The images a repository publishes for its own listing.
 *
 * Three requests at most: the locales, that locale's images, and the phone
 * screenshots. A repository without the directory answers the first one with
 * nothing and costs no more than that.
 */
async function fastlaneArtwork(
  ref: RepoRef,
  looked: string[]
): Promise<ArtworkCandidate[]> {
  let root: string | null = null;
  let locales: RepoFile[] | null = null;
  for (const candidate of METADATA_ROOTS) {
    locales = await repoContents(ref, candidate);
    if (locales) {
      root = candidate;
      break;
    }
  }
  looked.push(
    root
      ? `${ref.owner}/${ref.repo} ${root}`
      : `${ref.owner}/${ref.repo} (no fastlane metadata)`
  );
  if (!root || !locales) return [];

  const locale = pickLocale(locales);
  if (!locale) return [];

  const images = await repoContents(ref, `${locale.path}/images`);
  if (!images) return [];

  const out: ArtworkCandidate[] = [];
  const where = `${locale.name}/images`;

  const icon = named(images, "icon");
  if (icon?.downloadUrl) {
    out.push({
      kind: "icon",
      url: icon.downloadUrl,
      from: "fastlane",
      label: `${where}/${icon.name}`,
    });
  }

  const banner = named(images, "featuregraphic");
  if (banner?.downloadUrl) {
    out.push({
      kind: "banner",
      url: banner.downloadUrl,
      from: "fastlane",
      label: `${where}/${banner.name}`,
    });
  }

  const shots = images.find(
    (f) => f.type === "dir" && f.name.toLowerCase() === "phonescreenshots"
  );
  if (shots) {
    const files = (await repoContents(ref, shots.path)) ?? [];
    // Named 00.png, 01.png… by convention, and that order is the tour the
    // developer meant — sorted by name rather than by whatever the API returns.
    const sorted = files
      .filter((f) => f.type === "file" && IMAGE_NAME.test(f.name) && f.downloadUrl)
      .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
      .slice(0, MAX_SCREENSHOTS);
    for (const file of sorted) {
      out.push({
        kind: "screenshot",
        url: file.downloadUrl!,
        from: "fastlane",
        label: `${where}/${shots.name}/${file.name}`,
      });
    }
  }

  return out;
}

/**
 * The same pictures, as F-Droid already serves them.
 *
 * Worth asking even for an app that came from GitHub: a project that publishes
 * on F-Droid has had its fastlane directory rendered into a listing already,
 * and a package whose repository keeps no metadata may still be on there.
 * Matched on the package id, which is why this only works once an app has one
 * — linked apps read theirs out of the release.
 */
async function fdroidArtwork(
  packageId: string,
  looked: string[]
): Promise<ArtworkCandidate[]> {
  try {
    const app = await fetchFdroidApp(packageId);
    looked.push(`f-droid.org ${packageId}`);
    const out: ArtworkCandidate[] = [];
    if (app.iconUrl) {
      out.push({
        kind: "icon",
        url: app.iconUrl,
        from: "fdroid",
        label: "F-Droid listing icon",
      });
    }
    app.screenshotUrls.slice(0, MAX_SCREENSHOTS).forEach((url, i) => {
      out.push({
        kind: "screenshot",
        url,
        from: "fdroid",
        label: `F-Droid screenshot ${i + 1}`,
      });
    });
    return out;
  } catch (err) {
    // Not being on F-Droid is the common case, not a fault.
    looked.push(`f-droid.org ${packageId} (nothing)`);
    console.error(`[artwork] no f-droid listing for ${packageId}:`, err);
    return [];
  }
}

/**
 * Everything this app's upstreams hold, best first.
 *
 * The owner's avatar is offered last and only when nothing else produced an
 * icon. It is a picture of a person or an organisation rather than of the app,
 * which is why `addFromGitHub` refuses to apply it on its own — but a person
 * looking at the repository can tell the difference between an octocat and a
 * logo, and for a one-app developer it is usually the logo.
 */
export async function findArtwork(app: StoreApp): Promise<ArtworkFind> {
  const looked: string[] = [];
  const candidates: ArtworkCandidate[] = [];

  const ref =
    app.source?.kind === "github" ? parseRepoRef(app.source.repo ?? "") : null;
  if (ref) candidates.push(...(await fastlaneArtwork(ref, looked)));

  if (app.packageName) {
    candidates.push(...(await fdroidArtwork(app.packageName, looked)));
  }

  if (ref && !candidates.some((c) => c.kind === "icon")) {
    try {
      const repo = await repoInfo(ref);
      const avatar = repo?.owner?.avatar_url;
      if (typeof avatar === "string" && avatar) {
        candidates.push({
          kind: "icon",
          // The default is 420px and this is a shelf icon.
          url: `${avatar}${avatar.includes("?") ? "&" : "?"}s=256`,
          from: "github",
          label: `${repo?.owner?.login ?? ref.owner} avatar — a person, not the app`,
        });
      }
    } catch (err) {
      console.error(`[artwork] no repo info for ${ref.owner}/${ref.repo}:`, err);
    }
  }

  return {
    slug: app.slug,
    has: {
      icon: Boolean(app.icon),
      banner: Boolean(app.banner),
      screenshots: app.screenshots?.length ?? 0,
    },
    candidates,
    looked,
  };
}
