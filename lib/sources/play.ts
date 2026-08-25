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
import { promises as fs } from "node:fs";
import path from "node:path";
import { STORE_DIRS, STORE_ROOT } from "@/lib/storage";
import { readMetaRaw, uniqueSlug, writeMeta } from "@/lib/import";
import {
  getApps,
  invalidateCatalog,
  type AppSource,
  type Category,
} from "@/lib/store";
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

/**
 * The entities Play's own listing text arrives with.
 *
 * `summary` comes back HTML-escaped — "lyrics &amp; videos" — while
 * `description` does not, so a listing written straight to disk gives an app a
 * tagline reading `&amp;` on the shelf. React escapes what it renders, so
 * nothing downstream was ever going to undo it.
 *
 * One pass, not repeated: `&amp;lt;` is text that says `&lt;` and decoding it
 * twice would invent a tag that was never there.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] !== "#") return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    const code =
      body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : whole;
  });
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
    name: decodeEntities(String(r.title ?? r.appId)),
    developer: typeof r.developer === "string" ? decodeEntities(r.developer) : null,
    summary: typeof r.summary === "string" ? decodeEntities(r.summary) : null,
    iconUrl: typeof r.icon === "string" ? r.icon : null,
    score: typeof r.score === "number" ? r.score : 0,
    url:
      typeof r.url === "string"
        ? r.url
        : `https://play.google.com/store/apps/details?id=${r.appId}`,
    existingSlug: byPackage.get(String(r.appId).toLowerCase()),
  }));
}

/**
 * A Play listing, read but not yet written anywhere.
 *
 * Split out from the write so the same lookup can be shown to a person before
 * anything lands on disk. That matters more than it sounds: a package id says
 * which app a build *is a build of*, not which build it is. The store holds
 * Instagram Piko, a patched client under `com.instagram.android` — the id
 * Play answers for with Meta's own listing, screenshots and all. Some of that
 * describes the patched build fairly and some of it does not, and only a
 * person looking at the two can say which.
 */
export type PlayListing = {
  packageId: string;
  name: string;
  developer: string | null;
  category: Category;
  tagline: string | null;
  description: string | null;
  rating: number | null;
  ratingCount: number | null;
  /** What Play showed, which is upstream's version and not this library's. */
  playVersion: string | null;
  url: string;
  iconUrl: string | null;
  bannerUrl: string | null;
  screenshotUrls: string[];
};

export async function fetchPlayListing(packageId: string): Promise<PlayListing> {
  const pkg = packageId.trim();
  if (!/^[a-zA-Z0-9._]+$/.test(pkg)) {
    throw new Error("That does not look like a package id");
  }

  const gp = await gplay();
  let app: any;
  try {
    app = await gp.app({ appId: pkg });
  } catch {
    throw new Error("Play has no listing for that package id");
  }

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? decodeEntities(v) : null;

  return {
    packageId: pkg,
    name: decodeEntities(String(app.title ?? pkg)),
    developer: str(app.developer),
    category: categoryFor(app.genreId),
    tagline: str(app.summary),
    description: str(app.description),
    rating: typeof app.score === "number" ? Number(app.score.toFixed(2)) : null,
    ratingCount: typeof app.ratings === "number" ? app.ratings : null,
    playVersion: realVersion(app.version),
    url: str(app.url) ?? `https://play.google.com/store/apps/details?id=${pkg}`,
    iconUrl: str(app.icon),
    bannerUrl: str(app.headerImage),
    screenshotUrls: (Array.isArray(app.screenshots) ? app.screenshots : [])
      .filter((s: unknown): s is string => typeof s === "string")
      .slice(0, MAX_SCREENSHOTS),
  };
}

/* -------------------------------------------------------------------- fill */

/** What a fill did, field by field, so the answer can be shown rather than assumed. */
export type PlayFill = {
  /** Meta keys this fill wrote. */
  written: string[];
  /** Keys the app already carried, left exactly as they were. */
  kept: string[];
  images: { icon: boolean; banner: boolean; screenshots: number };
};

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif"];

/** True when `<dir>/<slug>.<some image extension>` is already there. */
async function hasImage(dir: string, slug: string): Promise<boolean> {
  const files = await fs.readdir(path.join(STORE_ROOT, dir)).catch(() => []);
  return files.some((f) => {
    const ext = path.extname(f).toLowerCase();
    return IMAGE_EXTENSIONS.includes(ext) && f.slice(0, -ext.length) === slug;
  });
}

async function hasScreenshots(slug: string): Promise<boolean> {
  const dir = path.join(STORE_ROOT, STORE_DIRS.screenshots, slug);
  const files = await fs.readdir(dir).catch(() => []);
  return files.some((f) => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()));
}

/**
 * Write a listing's words and pictures onto an app that already exists.
 *
 * **Gaps only, unless told otherwise.** An app created from a dropped APK has
 * a name worked out from the file — "Instagram Piko", not "Instagram" — and
 * that name is the whole reason someone can find the modified build in a
 * library that also holds the stock one. The same goes for a category or a
 * tagline written by hand. So an existing value is reported as kept, never
 * replaced; `overwrite` exists for the one caller that just created the slug
 * itself and knows there is nothing to protect.
 *
 * `source` is only written when the caller passes one. Filling in metadata
 * does not make Play the app's source: an APK that came from Telegram or a
 * GitHub release still came from there, and rewriting that field would lose
 * the release tag the update check compares against.
 */
export async function fillFromPlay(
  slug: string,
  listing: PlayListing,
  opts: { overwrite?: boolean; source?: AppSource } = {}
): Promise<PlayFill> {
  const meta = await readMetaRaw(slug);
  const patch: Record<string, unknown> = {};
  const written: string[] = [];
  const kept: string[] = [];

  const put = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;
    const current = meta[key];
    const filled = current !== undefined && current !== null && current !== "";
    if (filled && !opts.overwrite) {
      kept.push(key);
      return;
    }
    patch[key] = value;
    written.push(key);
  };

  put("name", listing.name);
  put("developer", listing.developer);
  put("category", listing.category);
  put("tagline", listing.tagline);
  put("description", listing.description);
  put("rating", listing.rating);
  put("ratingCount", listing.ratingCount);
  if (opts.source) patch.source = opts.source;

  const wantIcon =
    listing.iconUrl && (opts.overwrite || !(await hasImage(STORE_DIRS.icons, slug)));
  const icon = wantIcon
    ? await saveImage(
        listing.iconUrl!,
        path.join(STORE_ROOT, STORE_DIRS.icons, slug),
        "play"
      )
    : false;

  const wantBanner =
    listing.bannerUrl &&
    (opts.overwrite || !(await hasImage(STORE_DIRS.banners, slug)));
  const banner = wantBanner
    ? await saveImage(
        listing.bannerUrl!,
        path.join(STORE_ROOT, STORE_DIRS.banners, slug),
        "play"
      )
    : false;

  // All or nothing: a folder holding two of someone's screenshots and six of
  // this listing's would be worse than either, and the numbering is what the
  // gallery sorts on.
  let saved = 0;
  if (opts.overwrite || !(await hasScreenshots(slug))) {
    for (const [i, url] of listing.screenshotUrls.entries()) {
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
  }

  // Where the words came from, kept beside them. `source` answers this for an
  // app added from Play, but not for one whose text was filled in afterwards
  // — and that is exactly the app where someone later reads a description
  // that does not sound like the build they installed and needs to know why.
  //
  // Only stamped when this fill actually put something there. Running it a
  // second time finds every field already filled, and re-stamping would
  // replace a true record of what came from Play with an empty one.
  const did = written.length > 0 || icon || banner || saved > 0;
  if (did) {
    patch.playMeta = {
      packageId: listing.packageId,
      url: listing.url,
      fetchedAt: new Date().toISOString(),
      fields: written,
      images: { icon: !!icon, banner: !!banner, screenshots: saved },
    };
  }
  // A patch of nothing still means nothing to write: `writeMeta` merges and
  // rewrites the file, and rewriting it identically is only a chance to lose it.
  if (Object.keys(patch).length) await writeMeta(slug, patch);

  invalidateCatalog();
  return { written, kept, images: { icon: !!icon, banner: !!banner, screenshots: saved } };
}

/* --------------------------------------------------------------------- add */

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
  const listing = await fetchPlayListing(packageId);

  const clash = (await getApps()).find(
    (a) => a.packageName?.toLowerCase() === listing.packageId.toLowerCase()
  );
  if (clash) {
    throw new Error(`${clash.name} is already in the catalog as "${clash.slug}"`);
  }

  const slug = await uniqueSlug(listing.name);
  // Nothing is on this slug yet, so there is no hand-written value to protect
  // and the package id has to be written even though `fillFromPlay` does not
  // deal in it — that field belongs to the binary everywhere else.
  await writeMeta(slug, { packageName: listing.packageId });
  const fill = await fillFromPlay(slug, listing, {
    overwrite: true,
    source: {
      kind: "play",
      url: listing.url,
      playVersion: listing.playVersion ?? undefined,
      addedFrom: "manage/add",
    },
  });

  return {
    slug,
    name: listing.name,
    packageId: listing.packageId,
    images: fill.images,
  };
}
