/**
 * apkmb.com, as a source of *words and pictures* — never of binaries.
 *
 * Play is the store's usual filler, and it cannot describe most of what is on
 * these shelves: a modified build has no Play listing, and an adult app has
 * none either — which is why `lib/sources/play.ts` maps nothing to the Adults
 * category and says the shelf is filled from elsewhere. This is elsewhere.
 *
 * A mod mirror is not an API, so this reads a page. What makes that bearable
 * is that apkmb publishes schema.org `SoftwareApplication` JSON-LD on every
 * product page — name, icon, screenshots, version, rating — so the fields that
 * matter come out of a document with a specification behind it rather than out
 * of a div whose class name will change next time the theme does. The prose
 * and the mod-feature list are scraped; everything else is not.
 *
 * The APK is not fetched. The page links to one, and that link is reported so
 * a person can hand it to the Telegram feed, which already knows how to fetch
 * a link and prove it is an APK before the importer sees it. Filling metadata
 * and taking a binary from a mod mirror are different decisions and only one
 * of them is being made here.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { STORE_DIRS, STORE_ROOT } from "@/lib/storage";
import { readMetaRaw, uniqueSlug, writeMeta } from "@/lib/import";
import { getApps, invalidateCatalog, type Category } from "@/lib/store";
import { BROWSER_USER_AGENT, saveImage } from "@/lib/sources/net";
import { categoryForGenre, decodeEntities } from "@/lib/sources/play";

const PAGE_TIMEOUT_MS = 20_000;
/** A product page is ~300 KB. Ten times that is not one. */
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_SCREENSHOTS = 8;
/**
 * The description is prose from a page that also holds a cookie notice, a
 * comment thread and a related-apps rail. A cap is what stops a bad parse from
 * becoming a 400-line listing nobody notices until it is on the shelf.
 *
 * Generous, because it is a guard and not an editorial limit — a real apkmb
 * write-up runs to about 4,000 characters — and applied by whole paragraphs,
 * so what it does cut never ends mid-sentence.
 */
const MAX_DESCRIPTION = 8000;

const HOSTS = /^(www\.)?apkmb\.com$/i;

/**
 * apkmb's own breadcrumb sections against this store's categories.
 *
 * The same rule as Play's table: a section outside it answers `null`, not
 * "Other". Writing "Other" would be a claim that somebody filed the app there,
 * and the fillers only write into gaps, so that claim would outlast every
 * later chance to correct it.
 *
 * Short, because it is only the first half of the answer. The breadcrumb is
 * apkmb's own vocabulary — "Video Players & Editors", "Music Games" — and what
 * it does not cover falls through to the `applicationCategory` in the JSON-LD,
 * which is Play's vocabulary and already has a table in `play.ts`.
 *
 * Nothing here maps to Adults. apkmb files an adult app under Entertainment
 * like any other, so there is no section that means it — see `categoryFor`.
 */
const CATEGORY_BY_SECTION: Record<string, Category> = {
  games: "Games",
  entertainment: "Entertainment",
  "video players & editors": "Media",
  "music & audio": "Media",
  photography: "Media",
  communication: "Communication",
  social: "Communication",
  dating: "Communication",
  "art & design": "Editor",
  productivity: "Editor",
  tools: "Editor",
};

/**
 * The breadcrumb first, then Play's genre.
 *
 * Deepest section first — "Music Games" before "Games" — so a specific
 * section wins over the shelf it hangs under, and the genre only answers what
 * neither covers.
 *
 * **This never answers Adults**, and that is not an omission. apkmb sorts an
 * adult app into Entertainment and marks it nowhere else, so a section name is
 * not evidence, and Adults is the one category in this store that hides a
 * listing from everyone who has not asked to see it. Getting that wrong the
 * quiet way — filing an adult app under Entertainment because a table said so
 * — puts it on the front page. It stays a person's decision, which is why the
 * lookup shows the category it worked out before anything is written.
 */
function categoryFor(sections: string[], genreId: unknown): Category | null {
  for (const raw of [...sections].reverse()) {
    const hit = CATEGORY_BY_SECTION[raw.trim().toLowerCase()];
    if (hit) return hit;
  }
  return categoryForGenre(genreId);
}

/* ------------------------------------------------------------------ markup */

/** Tags out, entities decoded, whitespace collapsed. */
function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * The paragraphs of one block, kept as paragraphs.
 *
 * `text()` on the whole block would run five paragraphs into one line. The
 * description is the longest thing on a listing page and the only one where
 * the breaks carry meaning, so `<p>` and `<li>` are read as the units they are
 * and images — the block is full of them — drop out with every other tag.
 */
function paragraphs(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<(p|li|h[2-4])\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const line = text(m[2]);
    // A paragraph that held only an image leaves an empty string behind.
    if (line) out.push(m[1] === "li" ? `• ${line}` : line);
  }
  return out;
}

/** The contents of the first element carrying `id`, brace-counted by tag. */
function blockById(html: string, id: string): string | null {
  const open = new RegExp(`<div[^>]*\\bid=["']${id}["'][^>]*>`, "i").exec(html);
  if (!open) return null;
  let depth = 1;
  const from = open.index + open[0].length;
  const tags = /<(\/?)div\b[^>]*>/gi;
  tags.lastIndex = from;
  for (let m = tags.exec(html); m; m = tags.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(from, m.index);
  }
  return null;
}

/** The `<div class="da-s"><b>Label</b><br>Value</div>` pairs beside the icon. */
function infoPairs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<div class="da-s"><b>([\s\S]*?)<\/b><br>([\s\S]*?)<\/div>/gi)) {
    const key = text(m[1]).toLowerCase();
    if (key) out[key] = text(m[2]);
  }
  return out;
}

/** The first `SoftwareApplication` in any of the page's JSON-LD blocks. */
/* eslint-disable @typescript-eslint/no-explicit-any */
function softwareApplication(html: string): any | null {
  for (const m of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const found = search(parsed);
    if (found) return found;
  }
  return null;

  function search(node: unknown): any | null {
    if (Array.isArray(node)) {
      for (const v of node) {
        const hit = search(v);
        if (hit) return hit;
      }
      return null;
    }
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      if (o["@type"] === "SoftwareApplication") return o;
      for (const v of Object.values(o)) {
        const hit = search(v);
        if (hit) return hit;
      }
    }
    return null;
  }
}

/** The breadcrumb sections between "Home" and the app itself, outermost first. */
function breadcrumbSections(html: string): string[] {
  for (const m of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    // Home / Apps / Entertainment / XNXX — the first crumb is the site and
    // the last is the app, so what is left in between is the filing.
    const names = crumbs(parsed);
    if (names.length >= 3) return names.slice(1, -1);
  }
  return [];

  function crumbs(node: unknown): string[] {
    if (Array.isArray(node)) {
      for (const v of node) {
        const hit = crumbs(v);
        if (hit.length) return hit;
      }
      return [];
    }
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      if (o["@type"] === "BreadcrumbList" && Array.isArray(o.itemListElement)) {
        const list = (o.itemListElement as any[])
          // The names arrive HTML-escaped even inside JSON-LD — "Video
          // Players &amp; Editors" — and the table is keyed on the real thing.
          .map((i) => ({
            pos: Number(i?.position) || 0,
            name: decodeEntities(String(i?.name ?? "")),
          }))
          .filter((i) => i.name)
          .sort((a, b) => a.pos - b.pos);
        if (list.length >= 3) return list.map((i) => i.name);
      }
      for (const v of Object.values(o)) {
        const hit = crumbs(v);
        if (hit.length) return hit;
      }
    }
    return [];
  }
}

/* ----------------------------------------------------------------- listing */

/**
 * An apkmb page, read but not yet written anywhere.
 *
 * Split from the write for the same reason Play's is: a mod mirror describes
 * the build it hosts, and whether that description belongs on the copy this
 * store holds is a judgement only a person looking at both can make.
 */
export type ApkmbListing = {
  url: string;
  name: string;
  developer: string | null;
  category: Category | null;
  /** apkmb's "Mod Info" line — "Premium Unlocked" — which is the whole point of the build. */
  tagline: string | null;
  description: string | null;
  rating: number | null;
  ratingCount: number | null;
  /** What apkmb says it hosts, which is not a claim about this library. */
  siteVersion: string | null;
  /** Read off the "Get it on" link when the page has one, so it is Play's id or nothing. */
  packageId: string | null;
  iconUrl: string | null;
  screenshotUrls: string[];
  /** apkmb's own download page for this app, not the APK. */
  downloadPageUrl: string | null;
  /** The slug this app already has here, when the catalog carries it. */
  existingSlug?: string;
};

/** A page address this source will read, or a refusal saying why not. */
export function apkmbUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("That is not a URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("That is not a web address");
  }
  if (!HOSTS.test(url.hostname)) {
    throw new Error("That is not an apkmb.com address");
  }
  // The query and fragment are tracking, and keeping them would make two
  // addresses for one page — which the ledger and the source stamp both key on.
  url.search = "";
  url.hash = "";
  url.protocol = "https:";
  return url.href;
}

async function readPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": BROWSER_USER_AGENT, accept: "text/html,*/*" },
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    cache: "no-store",
  });
  if (res.status === 404) throw new Error("apkmb has no page at that address");
  if (!res.ok) throw new Error(`apkmb answered HTTP ${res.status}`);

  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (type && type !== "text/html") {
    throw new Error(`that address is ${type}, not a listing page`);
  }
  const body = Buffer.from(await res.arrayBuffer());
  if (body.byteLength > MAX_PAGE_BYTES) {
    throw new Error(`${body.byteLength} bytes is not a listing page`);
  }
  return body.toString("utf8");
}

export async function fetchApkmbListing(input: string): Promise<ApkmbListing> {
  const url = apkmbUrl(input);
  const html = await readPage(url);

  const app = softwareApplication(html);
  const info = infoPairs(html);

  // The JSON-LD name is the app's, and the <title> is the page's — "XNXX MOD
  // APK v1.60.2 Download (Premium Unlocked)". Only the first is a name.
  const name = app?.name ? text(String(app.name)) : "";
  if (!name) {
    // Every product page carries this block. A page without one is a category
    // listing or a search result, and there is no app on it to describe.
    throw new Error("that page does not describe an app");
  }

  const rating = Number(app?.aggregateRating?.ratingValue);
  const ratingCount = Number(app?.aggregateRating?.ratingCount);

  const screenshots: string[] = (Array.isArray(app?.screenshot) ? app.screenshot : [])
    .map((s: any) => (typeof s === "string" ? s : s?.url))
    .filter((s: unknown): s is string => typeof s === "string" && !!s)
    .slice(0, MAX_SCREENSHOTS);

  // "Get it on" points at Play for an app that has a listing there, and back
  // at apkmb for one that does not. Only the first form carries an id.
  const play = /play\.google\.com\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/i.exec(html);

  const dl = /<a[^>]+href="([^"]*\/download\/?)"/i.exec(html);

  // The block opens with its own "Description" heading, which is furniture
  // rather than prose. The h2s further down are the article's real subheadings
  // and stay.
  const prose = blockById(html, "descripcion")?.replace(
    /<h2[^>]*\bclass="[^"]*box-title[^"]*"[^>]*>[\s\S]*?<\/h2>/gi,
    ""
  );
  const lines: string[] = [];
  let length = 0;
  for (const line of prose ? paragraphs(prose) : []) {
    if (length + line.length > MAX_DESCRIPTION) break;
    lines.push(line);
    length += line.length + 2;
  }
  const description = lines.join("\n\n") || null;

  return {
    url,
    name,
    developer: info.developer || null,
    category: categoryFor(breadcrumbSections(html), app?.applicationCategory),
    tagline: info["mod info"] || null,
    description,
    rating: Number.isFinite(rating) && rating > 0 ? Number(rating.toFixed(2)) : null,
    ratingCount: Number.isFinite(ratingCount) && ratingCount > 0 ? ratingCount : null,
    siteVersion: info.version || (app?.softwareVersion ? String(app.softwareVersion) : null),
    packageId: play?.[1] ?? null,
    iconUrl: typeof app?.image === "string" ? app.image : (app?.image?.url ?? null),
    screenshotUrls: screenshots,
    downloadPageUrl: dl ? new URL(dl[1], url).href : null,
  };
}

/**
 * The same lookup, told which app in the catalog it is already describing.
 *
 * By package id where the page gave one, and by name otherwise — a mod mirror
 * and this store name the same app the same way far more often than not, and
 * the answer is only ever shown to someone about to click.
 */
export async function lookupApkmb(input: string): Promise<ApkmbListing> {
  const listing = await fetchApkmbListing(input);
  const apps = await getApps();
  const match =
    (listing.packageId
      ? apps.find(
          (a) => a.packageName?.toLowerCase() === listing.packageId!.toLowerCase()
        )
      : undefined) ??
    apps.find((a) => a.name.trim().toLowerCase() === listing.name.trim().toLowerCase());
  return match ? { ...listing, existingSlug: match.slug } : listing;
}

/* -------------------------------------------------------------------- fill */

/** What a fill did, field by field, so the answer can be shown rather than assumed. */
export type ApkmbFill = {
  written: string[];
  kept: string[];
  images: { icon: boolean; screenshots: number };
};

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif"];

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
 * **Gaps only, unless told otherwise**, exactly as the Play fill is and for
 * exactly the same reason: an app built from a dropped APK carries a name that
 * says which build it is, and a hand-written tagline or category is a decision
 * somebody made. An existing value is reported as kept, never replaced.
 *
 * `packageName` is filled too, where the page gave one and the app has none —
 * that is the field the importer matches on, so filling it is what makes the
 * next drop of this app attach itself instead of parking for review.
 *
 * `source` is deliberately not written. Reading a description off apkmb does
 * not make apkmb where the binary came from, and that field is what the update
 * check reads.
 */
export async function fillFromApkmb(
  slug: string,
  listing: ApkmbListing,
  opts: { overwrite?: boolean } = {}
): Promise<ApkmbFill> {
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
  put("packageName", listing.packageId);

  const wantIcon =
    listing.iconUrl && (opts.overwrite || !(await hasImage(STORE_DIRS.icons, slug)));
  const icon = wantIcon
    ? await saveImage(
        listing.iconUrl!,
        path.join(STORE_ROOT, STORE_DIRS.icons, slug),
        "apkmb"
      )
    : false;

  // All or nothing, as with Play: a folder holding two of someone else's
  // screenshots and six of these would be worse than either.
  let saved = 0;
  if (opts.overwrite || !(await hasScreenshots(slug))) {
    for (const [i, url] of listing.screenshotUrls.entries()) {
      const dest = path.join(
        STORE_ROOT,
        STORE_DIRS.screenshots,
        slug,
        String(i + 1).padStart(2, "0")
      );
      if (await saveImage(url, dest, "apkmb")) saved++;
    }
  }

  // Where the words came from, kept beside them — and only stamped when this
  // fill actually put something there, so running it twice cannot replace a
  // true record with an empty one.
  if (written.length > 0 || icon || saved > 0) {
    patch.apkmbMeta = {
      url: listing.url,
      siteVersion: listing.siteVersion,
      downloadPageUrl: listing.downloadPageUrl,
      fetchedAt: new Date().toISOString(),
      fields: written,
      images: { icon: !!icon, screenshots: saved },
    };
  }
  if (Object.keys(patch).length) await writeMeta(slug, patch);

  invalidateCatalog();
  return { written, kept, images: { icon: !!icon, screenshots: saved } };
}

/* --------------------------------------------------------------------- add */

export type ApkmbAddResult = {
  slug: string;
  name: string;
  packageId: string | null;
  downloadPageUrl: string | null;
  images: { icon: boolean; screenshots: number };
};

/**
 * Create a catalog entry from an apkmb page.
 *
 * A shelf with the label printed and nothing on it, the same as an app added
 * from Play: the words and pictures land now, the APK arrives later from the
 * Telegram feed or a dropped file and attaches itself. The importer matches on
 * package id where the page gave one and on the name otherwise, which is why
 * the name is taken from the JSON-LD rather than from the page title.
 *
 * Refuses a package the catalog already carries, for the reason the Play add
 * refuses one: two entries for a package id make every future drop of that app
 * ambiguous, so a duplicate would quietly stop the importer instead of
 * duplicating a row.
 */
export async function addFromApkmb(input: string): Promise<ApkmbAddResult> {
  const listing = await fetchApkmbListing(input);
  const apps = await getApps();

  if (listing.packageId) {
    const clash = apps.find(
      (a) => a.packageName?.toLowerCase() === listing.packageId!.toLowerCase()
    );
    if (clash) {
      throw new Error(`${clash.name} is already in the catalog as "${clash.slug}"`);
    }
  }
  const named = apps.find(
    (a) => a.name.trim().toLowerCase() === listing.name.trim().toLowerCase()
  );
  if (named) {
    throw new Error(
      `${named.name} is already in the catalog as "${named.slug}" — fill it instead`
    );
  }

  const slug = await uniqueSlug(listing.name);
  // Nothing is on this slug yet, so there is no hand-written value to protect.
  const fill = await fillFromApkmb(slug, listing, { overwrite: true });

  return {
    slug,
    name: listing.name,
    packageId: listing.packageId,
    downloadPageUrl: listing.downloadPageUrl,
    images: fill.images,
  };
}
