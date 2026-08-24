/**
 * Google Play, as a source of *words and pictures* — never of binaries.
 *
 * The store's problem is not finding APKs; the Telegram feed brings in more
 * than anyone can describe by hand. The problem is that a downloaded file has
 * a name like `FreeReels Premium v2.4.40 - androforever.com.apk` and nothing
 * to attach itself to, so every drop parks as "no matching app". Adding the
 * app from Play first gives the importer something to match: it keys on the
 * package id, which is exactly what a Play listing is addressed by.
 *
 * So this creates a catalog entry with no versions in it — a shelf with the
 * label already printed. The APK arrives later, from wherever it comes from,
 * and lands on the right shelf.
 *
 * Play APKs are never fetched. Google does not serve them to anyone but the
 * Play client, and the store hosts what it was given, not what it scraped.
 */
import path from "node:path";
import { STORE_DIRS, STORE_ROOT } from "@/lib/storage";
import { uniqueSlug, writeMeta } from "@/lib/import";
import { getApps, invalidateCatalog, type Category } from "@/lib/store";
import { saveImage } from "@/lib/sources/net";

const SEARCH_LIMIT = 12;
const MAX_SCREENSHOTS = 8;

export type PlayHit = {
  packageId: string;
  name: string;
  developer: string | null;
  summary: string | null;
  iconUrl: string | null;
  score: number;
  url: string;
  /** The slug this app already has here, when it is in the catalog. */
  existingSlug?: string;
};

// google-play-scraper v10 is ESM; load it dynamically so it works whichever
// module system Next compiles this file into.
async function gplay(): Promise<any> {
  const mod: any = await import("google-play-scraper");
  return mod.default ?? mod;
}

/**
 * Play's genres against this store's own categories.
 *
 * A starting point, not a translation — the two vocabularies were written for
 * different purposes, and `meta/<slug>.json` is hand-editable precisely so a
 * wrong guess costs one line. Nothing maps to Adults: Play has no such
 * listings, and the shelf is filled from elsewhere.
 */
const CATEGORY_BY_GENRE: Record<string, Category> = {
  VIDEO_PLAYERS: "Media",
  MUSIC_AND_AUDIO: "Media",
  PHOTOGRAPHY: "Media",
  ENTERTAINMENT: "Entertainment",
  COMICS: "Entertainment",
  SPORTS: "Entertainment",
  COMMUNICATION: "Communication",
  SOCIAL: "Communication",
  DATING: "Communication",
  ART_AND_DESIGN: "Editor",
  PRODUCTIVITY: "Editor",
  BUSINESS: "Editor",
};

function categoryFor(genreId: unknown): Category {
  if (typeof genreId !== "string") return "Other";
  // Every game genre is GAME_SOMETHING, and there are dozens of them.
  if (genreId.startsWith("GAME")) return "Games";
  return CATEGORY_BY_GENRE[genreId] ?? "Other";
}

/** Play reports "VARY" for apps whose version differs per device. */
function realVersion(raw: unknown): string | null {
  return typeof raw === "string" && raw && raw !== "VARY" ? raw : null;
}

/**
 * Search Play, and say which hits are already here.
 *
 * The already-here flag is the point of doing the lookup against the catalog
 * rather than leaving it to the write: someone searching "vlc" wants to see
 * that they added it last week, before they click.
 */
export async function searchPlay(term: string): Promise<PlayHit[]> {
  const query = term.trim();
  if (!query) return [];

  const gp = await gplay();
  const results: any[] = await gp.search({ term: query, num: SEARCH_LIMIT });

  const byPackage = new Map<string, string>();
  for (const app of await getApps()) {
    if (app.packageName) byPackage.set(app.packageName.toLowerCase(), app.slug);
  }

  return results.map((r) => ({
    packageId: String(r.appId),
    name: String(r.title ?? r.appId),
    developer: typeof r.developer === "string" ? r.developer : null,
    summary: typeof r.summary === "string" ? r.summary : null,
    iconUrl: typeof r.icon === "string" ? r.icon : null,
    score: typeof r.score === "number" ? r.score : 0,
    url:
      typeof r.url === "string"
        ? r.url
        : `https://play.google.com/store/apps/details?id=${r.appId}`,
    existingSlug: byPackage.get(String(r.appId).toLowerCase()),
  }));
}

export type PlayAddResult = {
  slug: string;
  name: string;
  packageId: string;
  images: { icon: boolean; banner: boolean; screenshots: number };
};

/**
 * Create a catalog entry from a Play listing.
 *
 * Refuses a package the catalog already carries. Two entries for one package
 * id do not merely duplicate a row — the importer matches on that id and
 * treats more than one hit as ambiguous, so a duplicate would silently stop
 * every future drop of that app from attaching itself.
 */
export async function addFromPlay(packageId: string): Promise<PlayAddResult> {
  const pkg = packageId.trim();
  if (!/^[a-zA-Z0-9._]+$/.test(pkg)) {
    throw new Error("That does not look like a package id");
  }

  const clash = (await getApps()).find(
    (a) => a.packageName?.toLowerCase() === pkg.toLowerCase()
  );
  if (clash) {
    throw new Error(`${clash.name} is already in the catalog as "${clash.slug}"`);
  }

  const gp = await gplay();
  let app: any;
  try {
    app = await gp.app({ appId: pkg });
  } catch {
    throw new Error("Play has no listing for that package id");
  }

  const name = String(app.title ?? pkg);
  const slug = await uniqueSlug(name);

  await writeMeta(slug, {
    name,
    packageName: pkg,
    developer: typeof app.developer === "string" ? app.developer : undefined,
    category: categoryFor(app.genreId),
    tagline: typeof app.summary === "string" ? app.summary : undefined,
    description: typeof app.description === "string" ? app.description : undefined,
    rating: typeof app.score === "number" ? Number(app.score.toFixed(2)) : undefined,
    ratingCount: typeof app.ratings === "number" ? app.ratings : undefined,
    source: {
      kind: "play",
      url: String(app.url ?? `https://play.google.com/store/apps/details?id=${pkg}`),
      // What Play showed at the time. The versions the store actually holds
      // come from the APKs, so this is a note about upstream, not a claim
      // about this library.
      playVersion: realVersion(app.version),
      addedFrom: "manage/add",
    },
  });

  const icon =
    typeof app.icon === "string" &&
    (await saveImage(
      app.icon,
      path.join(STORE_ROOT, STORE_DIRS.icons, slug),
      "play"
    ));
  const banner =
    typeof app.headerImage === "string" &&
    (await saveImage(
      app.headerImage,
      path.join(STORE_ROOT, STORE_DIRS.banners, slug),
      "play"
    ));

  const shots: string[] = Array.isArray(app.screenshots)
    ? app.screenshots.filter((s: unknown) => typeof s === "string")
    : [];
  let saved = 0;
  for (const [i, url] of shots.slice(0, MAX_SCREENSHOTS).entries()) {
    // Zero-padded: the catalog sorts these numerically, but a plain reader
    // listing the folder should see them in order too.
    const dest = path.join(
      STORE_ROOT,
      STORE_DIRS.screenshots,
      slug,
      String(i + 1).padStart(2, "0")
    );
    if (await saveImage(url, dest, "play")) saved++;
  }

  invalidateCatalog();
  return {
    slug,
    name,
    packageId: pkg,
    images: { icon: !!icon, banner: !!banner, screenshots: saved },
  };
}
