/**
 * The catalog, read off disk.
 *
 * Two things decide what the store contains, and neither of them is a
 * database:
 *
 *   apks/<slug>/<version>/<file>.apk   the binaries — the source of truth for
 *                                      which versions exist and how big they are
 *   meta/<slug>.json                   the editorial half: name, developer,
 *                                      category, tagline, description
 *
 * An app needs only one of the two. A folder of APKs with no meta file still
 * appears (named after its slug), so a fresh drop into `_import/` is visible
 * before anyone has written a description for it.
 *
 * Components never see any of this: they take `StoreApp`, exactly as they did
 * when the catalog was hand-written, so the layout build and this one render
 * the same blocks.
 *
 * When the library is empty the placeholder catalog stands in — see
 * `getCatalog`.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { STORE_DIRS, STORE_ROOT } from "./storage";
import { withBasePath } from "./base-path";
import { abiLabel, abiRank, apkAbis } from "./apk-abi";
import { PLACEHOLDER_APPS, PLACEHOLDER_CHANGELOG } from "./catalog";

export type Category =
  | "Editor"
  | "Media"
  | "Entertainment"
  | "Communication"
  | "Games"
  | "Adults"
  | "Other";

/**
 * One binary. A version usually has exactly one; an app published as separate
 * per-ABI builds has several, and they are the same version — same features,
 * same number on the page — differing only in which phone can install them.
 */
export type AppVersionFile = {
  /** File name inside apks/<slug>/<version>/. */
  file: string;
  bytes: number;
  /** `bytes`, rendered the way the UI shows it ("48 MB"). */
  size: string;
  /** ISO date the file landed — its mtime. */
  added: string;
  /** ABIs read out of the APK itself. Empty means it runs anywhere. */
  abis: string[];
  /** What to call this build on a button: "arm64-v8a", "universal". */
  abi: string;
  /** Ready-to-use href for this exact file. */
  href: string;
};

export type AppVersion = {
  version: string;
  /**
   * Every binary under this version, best default first — see `abiRank`.
   * Never empty: a version directory with no APK in it is not a version.
   */
  files: AppVersionFile[];
  /**
   * The default build, `files[0]` flattened. It is repeated here rather than
   * reached through `files` because most of this app only ever wants the one
   * download — and because before per-ABI builds existed, this was the whole
   * type. A caller that does not care which build it gets still reads right.
   */
  file: string;
  bytes: number;
  size: string;
  added: string;
  /** Ready-to-use href for this version, letting the store pick the build. */
  href: string;
};

/**
 * Where the listing came from. Written by `lib/sources/*` when an app is put
 * on the shelf from an upstream store; absent for an app that arrived as a
 * dropped APK.
 */
export const SOURCE_KINDS = ["play", "github", "fdroid"] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export type AppSource = {
  kind: SourceKind;
  url: string;
  /** What upstream showed when the listing was added — not a claim about this library. */
  playVersion?: string;
  /** GitHub: `owner/name`, and the tag the release carried when it was added. */
  repo?: string;
  releaseTag?: string;
  /**
   * A release this store checked but does not mirror.
   *
   * GitHub already hosts the file and keeps hosting it, so a linked app is
   * downloaded once when it is added — long enough to read the version out of
   * its manifest and pin the signer — and then served as a link to that same
   * asset. `assetVersion` is what the binary said about itself, not the tag.
   */
  assetUrl?: string;
  assetName?: string;
  assetBytes?: number;
  assetVersion?: string;
  /** F-Droid: the package id the repository is addressed by. */
  package?: string;
  addedFrom?: string;
};

function readSource(raw: unknown): AppSource | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as AppSource;
  return typeof source.url === "string" &&
    (SOURCE_KINDS as readonly string[]).includes(source.kind)
    ? source
    : undefined;
}

export const ICON_FITS = ["cover", "contain"] as const;

export type IconFit = (typeof ICON_FITS)[number];

export type StoreApp = {
  slug: string;
  name: string;
  developer: string;
  category: Category;
  /** One line under the name on the detail page. */
  tagline: string;
  /** The long text on the detail page. Absent until someone writes one. */
  description?: string;
  packageName?: string;
  /** Set when the listing came from an upstream store rather than a dropped APK. */
  source?: AppSource;
  /**
   * The SHA-256 of the signer certificate the importer pinned on the first
   * APK it saw for this app. A later drop signed with a different key is
   * refused rather than served — see `lib/import.ts`.
   */
  signingCert?: string;
  /** The newest version, and its size — what every list row shows. */
  version: string;
  size: string;
  rating: number;
  ratingCount: number;
  /** Seeds the fallback artwork, so an app without an icon keeps its colours. */
  seed: number;
  /** Per-user state. Nothing sets these until there is a user — see README. */
  installed?: boolean;
  saved?: boolean;
  updateTo?: string;
  /** Media hrefs, already cache-busted. Absent when the file is not on disk. */
  icon?: string;
  /**
   * A flat colour to put behind the icon, `#rgb`/`#rrggbb`/`#rrggbbaa`.
   *
   * Plenty of icons are drawn as a transparent logo with no plate of their own
   * (ytdlnis, Obtainium), and the fallback gradient — which exists to stand in
   * for a missing icon — then shows through one that is present. Absent means
   * the gradient, which is right for every icon that brings its own square.
   */
  iconBackground?: string;
  /**
   * How the icon meets its box. "cover" — the default — fills the square and
   * crops what does not fit; "contain" fits the whole image inside it with a
   * little air, which is what a wordmark or a non-square logo needs.
   */
  iconFit?: IconFit;
  banner?: string;
  screenshots: string[];
  /**
   * The family this listing belongs to, named by the slug of its head — the
   * one listing that stands for the whole family on the shelf.
   *
   * Several listings can be the same app in a different wrapper: five
   * Instagram mods, each a real app with its own package id, its own signer
   * and its own reasons to prefer it. Five cards say the shelf holds five
   * apps, which is not what a person browsing it is looking at. One card and
   * a picker inside says what is actually true.
   *
   * Set on every member including the head, whose family is its own slug — so
   * `app.family === app.slug` is the test for "this is the card the shelf
   * shows". Absent for a listing in no family, which is nearly all of them.
   */
  family?: string;
  /**
   * The listings this one is a companion to — the host apps it installs
   * beside and does nothing without.
   *
   * A plugin is a real app: its own package id, its own signer, its own
   * release cadence, so it is a listing like any other rather than a second
   * file under the host's version. What it is not is a thing to browse for.
   * Nobody goes looking for microG; they go looking for the YouTube mod that
   * needs it, and the companion belongs on that page. So a listing with hosts
   * is kept off the shelf (see `withoutCompanions`) while staying findable by
   * name in search, exactly like a family member.
   *
   * Several hosts on purpose: one microG serves every YouTube mod here. Empty
   * — not absent — for the listings that are nobody's companion, which is
   * nearly all of them. Settled against the catalog in `resolvePlugins`.
   */
  requires: string[];
  /**
   * Set by hand on the one listing that speaks for its package id in the
   * F-Droid repository.
   *
   * A repository index holds one app per package id — that is Android's own
   * unit, not a choice this store gets to make — so where two listings share
   * an id only one of them can be published. `collectShelf` picks by rule and
   * says in `skipped` which listing lost; this is how a person overrules that
   * pick. Absent on nearly every listing, and meaningless on an id only one
   * listing claims.
   */
  repoHead?: boolean;
  /** Newest first. Empty when the app has meta but no APK yet. */
  versions: AppVersion[];
  /** ISO date the app was first seen. Empty for placeholder rows. */
  added: string;
};

/** What `lib/catalog.ts` holds — the same app, minus everything disk-derived. */
export type PlaceholderApp = Omit<
  StoreApp,
  "screenshots" | "versions" | "added" | "requires"
>;

/** The category tiles the sketch draws, in its order. */
export const CATEGORIES: { label: Category; icon: string }[] = [
  { label: "Editor", icon: "images" },
  { label: "Media", icon: "clapperboard" },
  { label: "Entertainment", icon: "users" },
  { label: "Communication", icon: "message" },
  { label: "Adults", icon: "store" },
];

/**
 * The one category this store keeps behind a gate.
 *
 * Filing an app here is what hides it — there is no second flag to forget. The
 * gate itself is per account and lives in `lib/user-state.ts`, because who may
 * see this shelf is a fact about a person and this module knows only disk.
 */
export const ADULT_CATEGORY: Category = "Adults";

/** Everything but the gated shelf. The default answer for every reader. */
export function withoutAdults<T extends { category: Category }>(apps: T[]): T[] {
  return apps.filter((a) => a.category !== ADULT_CATEGORY);
}

const KNOWN_CATEGORIES: Category[] = [
  "Editor",
  "Media",
  "Entertainment",
  "Communication",
  "Games",
  "Adults",
  "Other",
];

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif"];
const APK_EXTENSIONS = [".apk", ".xapk", ".apks", ".apkm"];

/** What a meta/<slug>.json may carry. Every field is optional on purpose. */
type MetaFile = {
  name?: string;
  developer?: string;
  category?: string;
  tagline?: string;
  description?: string;
  packageName?: string;
  /** Written by the source that added the listing, not by hand. */
  source?: AppSource;
  /** Written by the importer, not by hand. */
  signingCert?: string;
  rating?: number;
  ratingCount?: number;
  /** Overrides the date derived from the files. */
  added?: string;
  /** Keeps the app out of the catalog without deleting it. */
  hidden?: boolean;
  /** Set by hand: what to put behind a transparent icon. */
  iconBackground?: string;
  /** Set by hand: "contain" to fit the whole icon instead of filling the box. */
  iconFit?: string;
  /**
   * Set by hand: the slug of the listing that stands for this app's family on
   * the shelf. See `family` on StoreApp.
   */
  family?: string;
  /**
   * Set by hand: the slug — or slugs — of the host listings this app is a
   * companion to. See `requires` on StoreApp. A single string is accepted
   * because that is what a person writes when there is only one host.
   */
  requires?: string | string[];
  /**
   * Set by hand: publish this listing for its package id rather than the one
   * the rule would pick. See `repoHead` on StoreApp.
   */
  repoHead?: boolean;
};

/* ------------------------------------------------------------------ utils */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / 1024 / 1024;
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * A stable colour for an app with no icon. The hand-written catalog set these
 * by hand; a slug has to produce its own, and the same slug must always
 * produce the same one or the app changes colour between screens.
 */
function seedFrom(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

/** "photo-editor-pro" -> "Photo Editor Pro", for an app with no meta file. */
function titleFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** Newest first. Numeric where both sides are numeric, text otherwise. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-+_]/);
  const pb = b.split(/[.\-+_]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny) && x !== "" && y !== "") {
      if (nx !== ny) return ny - nx;
    } else if (x !== y) {
      return y.localeCompare(x);
    }
  }
  return 0;
}

/**
 * A CSS colour this app is willing to put in a style attribute, or nothing.
 *
 * Meta files are hand-editable, so what comes out of one is input like any
 * other. Hex is the whole of the vocabulary — it is what the colour picker in
 * the edit form produces, and `#rrggbbaa` covers "no plate at all" (alpha 00)
 * without a second spelling for it.
 */
export function normaliseHexColor(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toLowerCase();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(value)
    ? value
    : undefined;
}

/** "cover" is the default, so only "contain" is worth carrying. */
export function normaliseIconFit(raw: unknown): IconFit | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toLowerCase();
  return value === "contain" ? "contain" : undefined;
}

function normaliseCategory(raw: string | undefined): Category {
  if (!raw) return "Other";
  const hit = KNOWN_CATEGORIES.find(
    (c) => c.toLowerCase() === raw.trim().toLowerCase()
  );
  return hit ?? "Other";
}

/** Directory entries, or nothing at all if the directory is missing. */
async function listDir(abs: string): Promise<string[]> {
  try {
    return await fs.readdir(abs);
  } catch {
    return [];
  }
}

/**
 * Media goes through the route handler, not /public — the library lives
 * outside the repo. `?v=` is the file's mtime, so a replaced icon gets a new
 * URL and the immutable cache on the route stays safe.
 *
 * The prefix has to be written in: these end up in `src` attributes and CSS
 * `url()`, neither of which Next rewrites, and a mounted store would ask the
 * host site for them instead. `iconName()` in fdroid-shelf.ts reads only the
 * last segment, so the repository index is unaffected either way.
 */
function mediaHref(rel: string, mtimeMs: number): string {
  const encoded = rel.split("/").map(encodeURIComponent).join("/");
  return withBasePath(`/api/media/${encoded}?v=${Math.round(mtimeMs).toString(36)}`);
}

/* ------------------------------------------------------------------- read */

/** slug -> file name, for a flat directory of `<slug>.<ext>` images. */
async function indexImageDir(
  dir: string
): Promise<Map<string, { file: string; mtimeMs: number }>> {
  const abs = path.join(STORE_ROOT, dir);
  const out = new Map<string, { file: string; mtimeMs: number }>();
  for (const file of await listDir(abs)) {
    const ext = path.extname(file).toLowerCase();
    if (!IMAGE_EXTENSIONS.includes(ext)) continue;
    const slug = path.basename(file, ext);
    if (out.has(slug)) continue; // first extension wins, deterministically
    try {
      const st = await fs.stat(path.join(abs, file));
      out.set(slug, { file, mtimeMs: st.mtimeMs });
    } catch {
      /* vanished between readdir and stat */
    }
  }
  return out;
}

async function readScreenshots(slug: string): Promise<string[]> {
  const rel = `${STORE_DIRS.screenshots}/${slug}`;
  const abs = path.join(STORE_ROOT, STORE_DIRS.screenshots, slug);
  const files = (await listDir(abs))
    .filter((f) => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    // "2.jpg" before "10.jpg" — a plain sort puts them the other way round.
    .sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );
  const out: string[] = [];
  for (const file of files) {
    try {
      const st = await fs.stat(path.join(abs, file));
      out.push(mediaHref(`${rel}/${file}`, st.mtimeMs));
    } catch {
      /* vanished */
    }
  }
  return out;
}

/**
 * One directory per version, every binary inside it.
 *
 * A second APK in a version directory used to be invisible — the reader took
 * whichever one `readdir` returned first — so the importer moved it out of the
 * way to keep the answer stable. Both halves of that are gone: the files are
 * all listed, ordered so that `files[0]` is the one to hand someone who just
 * pressed Install.
 */
async function readVersions(slug: string): Promise<AppVersion[]> {
  const base = path.join(STORE_ROOT, STORE_DIRS.apks, slug);
  const out: AppVersion[] = [];
  for (const version of await listDir(base)) {
    if (version.startsWith(".")) continue;
    const dir = path.join(base, version);
    let names: string[];
    try {
      if (!(await fs.stat(dir)).isDirectory()) continue;
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    const apks = names
      .filter((f) => APK_EXTENSIONS.includes(path.extname(f).toLowerCase()))
      .sort();
    if (!apks.length) continue;

    const files: AppVersionFile[] = [];
    for (const file of apks) {
      let st;
      try {
        st = await fs.stat(path.join(dir, file));
      } catch {
        continue; /* vanished between readdir and stat */
      }
      const abis = await apkAbis(path.join(dir, file));
      files.push({
        file,
        bytes: st.size,
        size: formatBytes(st.size),
        added: new Date(st.mtimeMs).toISOString(),
        abis,
        abi: abiLabel(abis),
        // Through withBasePath, because this ends up in a plain `<a href>`.
        // Next rewrites `<Link>` and `next/image` for a mount prefix and
        // nothing else, so an app-absolute path written here lands on the
        // host's root — which, where the store is mounted as a section of a
        // larger site, is a different application entirely.
        href: withBasePath(
          `/api/download/${encodeURIComponent(slug)}?v=${encodeURIComponent(version)}&f=${encodeURIComponent(file)}`
        ),
      });
    }
    if (!files.length) continue;

    // Best build first, and by file name within a tie so that two files the
    // ranking cannot separate still order the same way on every read.
    files.sort(
      (a, b) => abiRank(b.abis) - abiRank(a.abis) || a.file.localeCompare(b.file)
    );

    const [best] = files;
    out.push({
      version,
      files,
      file: best.file,
      bytes: best.bytes,
      size: best.size,
      // The version arrived when its first file did, not when the last build
      // was dropped beside it.
      added: files.reduce((a, f) => (f.added < a ? f.added : a), best.added),
      // No `f=`: this is the link that lets the store choose, which is what
      // the Install button wants and what every older link already says.
      href: withBasePath(
        `/api/download/${encodeURIComponent(slug)}?v=${encodeURIComponent(version)}`
      ),
    });
  }
  return out.sort((a, b) => compareVersions(a.version, b.version));
}

async function readMeta(slug: string): Promise<MetaFile | null> {
  const abs = path.join(STORE_ROOT, STORE_DIRS.meta, `${slug}.json`);
  let raw: string;
  try {
    raw = await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as MetaFile) : null;
  } catch (err) {
    // A hand-edited meta file with a trailing comma must not take the whole
    // catalog down — drop this one app and say so in the log.
    console.error(`[store] ${slug}.json is not valid JSON:`, err);
    return null;
  }
}

async function readFromDisk(): Promise<StoreApp[]> {
  const [metaFiles, apkDirs, icons, banners] = await Promise.all([
    listDir(path.join(STORE_ROOT, STORE_DIRS.meta)),
    listDir(path.join(STORE_ROOT, STORE_DIRS.apks)),
    indexImageDir(STORE_DIRS.icons),
    indexImageDir(STORE_DIRS.banners),
  ]);

  const slugs = new Set<string>();
  for (const f of metaFiles) {
    if (f.endsWith(".json")) slugs.add(path.basename(f, ".json"));
  }
  for (const d of apkDirs) {
    if (!d.startsWith(".")) slugs.add(d);
  }

  const apps = await Promise.all(
    [...slugs].map(async (slug): Promise<StoreApp | null> => {
      const meta = await readMeta(slug);
      if (meta?.hidden) return null;

      const [versions, screenshots] = await Promise.all([
        readVersions(slug),
        readScreenshots(slug),
      ]);

      // Nothing to describe it and nothing to download: this slug came from a
      // meta file that would not parse. Listing it would put a row named after
      // the file name in the catalog.
      if (!meta && versions.length === 0) return null;
      const latest = versions[0];
      const source = readSource(meta?.source);
      const icon = icons.get(slug);
      const banner = banners.get(slug);

      const firstSeen =
        meta?.added ??
        versions.map((v) => v.added).sort()[0] ??
        "";

      return {
        slug,
        name: meta?.name?.trim() || titleFromSlug(slug),
        developer: meta?.developer?.trim() || "Unknown",
        category: normaliseCategory(meta?.category),
        tagline: meta?.tagline?.trim() || "",
        description: meta?.description?.trim() || undefined,
        packageName: meta?.packageName,
        // Unresolved: a slug that names nothing, or points through another
        // member, is settled once for the whole catalog in `resolveFamilies`.
        family: meta?.family?.trim() || undefined,
        // Likewise unresolved — `resolvePlugins` drops what names nothing.
        requires: readSlugList(meta?.requires),
        repoHead: meta?.repoHead === true ? true : undefined,
        source,
        signingCert: meta?.signingCert,
        // A linked app holds no file, so the newest version and its size are
        // what the release carried when it was last checked. Falling back here
        // rather than in each caller keeps tiles, search and the detail page
        // from each having to know that a source can stand in for a binary.
        version: latest?.version ?? source?.assetVersion ?? "—",
        size:
          latest?.size ??
          (typeof source?.assetBytes === "number"
            ? formatBytes(source.assetBytes)
            : "—"),
        rating: typeof meta?.rating === "number" ? meta.rating : 0,
        ratingCount:
          typeof meta?.ratingCount === "number" ? meta.ratingCount : 0,
        seed: seedFrom(slug),
        icon: icon
          ? mediaHref(`${STORE_DIRS.icons}/${icon.file}`, icon.mtimeMs)
          : undefined,
        iconBackground: normaliseHexColor(meta?.iconBackground),
        iconFit: normaliseIconFit(meta?.iconFit),
        banner: banner
          ? mediaHref(`${STORE_DIRS.banners}/${banner.file}`, banner.mtimeMs)
          : undefined,
        screenshots,
        versions,
        added: firstSeen,
      };
    })
  );

  return resolvePlugins(
    resolveFamilies(apps.filter((a): a is StoreApp => a !== null))
  ).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * One hand-written field, however it was written: `"microg"`, `"a, b"`,
 * `["a", "b"]`. Order is kept, blanks and repeats are not.
 */
function readSlugList(raw: unknown): string[] {
  const parts = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,\s]+/)
      : [];
  const out: string[] = [];
  for (const part of parts) {
    if (typeof part !== "string") continue;
    const slug = part.trim();
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

/**
 * Settle what each meta file's `family` was pointing at.
 *
 * The field is written by hand, so it can name a slug that is not there, and
 * it can point at another member rather than at the head — someone tagging a
 * new mod naturally points it at the one they were looking at. Following the
 * chain is what they meant; a slug that leads nowhere is dropped, because the
 * alternative is a listing that vanishes off the shelf into a family that does
 * not exist.
 *
 * The head is the end of the chain and is given the family too, so that every
 * member answers the same question the same way and `app.family === app.slug`
 * identifies the card.
 */
function resolveFamilies(apps: StoreApp[]): StoreApp[] {
  const bySlug = new Map(apps.map((a) => [a.slug, a]));
  const heads = new Set<string>();

  for (const app of apps) {
    if (!app.family) continue;
    // A head may say so itself. That claim is not what makes it one — being
    // pointed at is — so it is cleared here and given back below if any member
    // actually arrived. A family of one is not a family.
    if (app.family === app.slug) {
      app.family = undefined;
      continue;
    }
    // Four hops is more chain than anyone will write by hand, and it is also
    // the loop guard: a cycle runs out of hops and is dropped as unresolvable
    // rather than hanging the catalog read.
    const seen = new Set<string>([app.slug]);
    let at: string | undefined = app.family;
    let head: string | undefined;
    for (let hop = 0; at && hop < 4; hop++) {
      const next: StoreApp | undefined = bySlug.get(at);
      if (!next || seen.has(at)) break;
      seen.add(at);
      if (!next.family || next.family === next.slug) {
        head = next.slug;
        break;
      }
      at = next.family;
    }
    if (head && head !== app.slug) {
      app.family = head;
      heads.add(head);
    } else {
      // Includes a listing whose family names itself while nothing points at
      // it: a family of one is not a family, and the card is its own.
      console.error(
        `[store] ${app.slug}.json: family "${app.family}" names no listing`
      );
      app.family = undefined;
    }
  }

  for (const head of heads) bySlug.get(head)!.family = head;
  return apps;
}

/**
 * Settle what each meta file's `requires` was pointing at.
 *
 * Written by hand like `family`, so it carries the same failure: a slug that
 * names nothing. The cost is worse here, though — an unresolvable host would
 * take the listing off the shelf as a companion to an app that does not
 * exist, leaving it reachable by search alone and nothing to say why. So a
 * slug that names no listing is dropped and logged, and a listing whose hosts
 * all vanish goes back to being an ordinary card.
 *
 * No chain to follow, unlike a family: a companion names its hosts outright.
 * A host that is itself somebody's companion is left alone — a plugin for a
 * plugin is odd but it is not wrong, and nothing here reads through it.
 */
function resolvePlugins(apps: StoreApp[]): StoreApp[] {
  const slugs = new Set(apps.map((a) => a.slug));
  for (const app of apps) {
    if (app.requires.length === 0) continue;
    app.requires = app.requires.filter((host) => {
      // Its own companion is a listing that would hide itself from the shelf
      // and offer itself as the reason.
      if (host === app.slug) {
        console.error(`[store] ${app.slug}.json: requires names itself`);
        return false;
      }
      if (!slugs.has(host)) {
        console.error(
          `[store] ${app.slug}.json: requires "${host}" names no listing`
        );
        return false;
      }
      return true;
    });
  }
  return apps;
}

/**
 * The companions of an app: every listing that names it as a host.
 *
 * Sorted by name, and empty for an app nothing is a companion to — so a caller
 * can render the section on "not empty" alone.
 */
export function companionsOf<T extends { slug: string; name: string; requires: string[] }>(
  apps: T[],
  app: T
): T[] {
  return apps
    .filter((a) => a.requires.includes(app.slug))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The hosts of a companion: the apps it installs beside, in the order its meta
 * file names them. Empty for everything that is not a companion.
 */
export function hostsOf<T extends { slug: string; requires: string[] }>(
  apps: T[],
  app: T
): T[] {
  return app.requires
    .map((slug) => apps.find((a) => a.slug === slug))
    .filter((a): a is T => a !== undefined);
}

/**
 * The shelf, minus the companions.
 *
 * A companion is a real listing with a page, a download and an index entry —
 * it is browsing it is kept out of, because a shelf that offers microG next to
 * a photo editor is describing something that is not an app you go and get.
 * Search still finds it, and its host's page names it, which is where a person
 * is when the question comes up.
 */
export function withoutCompanions<T extends { requires: string[] }>(
  apps: T[]
): T[] {
  return apps.filter((a) => a.requires.length === 0);
}

/**
 * One card per family: the members that are not the head are left out.
 *
 * The browse screens read through here — home, search, the category pages —
 * and nothing else does. A member is still a listing with a page, a download
 * and an index entry; it is only the shelf that shows the family instead.
 */
export function onlyHeads<T extends { slug: string; family?: string }>(
  apps: T[]
): T[] {
  return apps.filter((a) => !a.family || a.family === a.slug);
}

/**
 * A family, head first, then by name — the order the picker lists them in.
 *
 * Empty for an app in no family, and for a head whose members have all gone,
 * so a caller can render the section on "not empty" alone.
 */
export function familyMembers<T extends { slug: string; family?: string; name: string }>(
  apps: T[],
  app: T
): T[] {
  if (!app.family) return [];
  const members = apps.filter((a) => a.family === app.family);
  if (members.length < 2) return [];
  return members.sort((a, b) =>
    a.slug === app.family ? -1 : b.slug === app.family ? 1 : a.name.localeCompare(b.name)
  );
}

/* ------------------------------------------------------------------ cache */

export type Catalog = {
  apps: StoreApp[];
  /** True when nothing is on disk and the hand-written stand-in is showing. */
  placeholder: boolean;
};

const CACHE_MS = Number(process.env.STORE_CACHE_MS ?? 10_000);
let cache: { at: number; value: Catalog } | null = null;

function fromPlaceholder(p: PlaceholderApp): StoreApp {
  // Nothing hand-written is anybody's companion: the placeholder catalog is
  // there to show a layout, and a listing it hid from the shelf would show the
  // wrong one.
  return { ...p, screenshots: [], versions: [], added: "", requires: [] };
}

/**
 * The catalog, at most `STORE_CACHE_MS` old.
 *
 * With an empty library every screen would be blank, which says nothing about
 * whether the layout works — so the placeholder catalog stands in until the
 * first app lands on disk, and `placeholder` says which of the two is showing.
 */
export async function getCatalog(): Promise<Catalog> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.value;

  let apps: StoreApp[] = [];
  try {
    apps = await readFromDisk();
  } catch (err) {
    console.error("[store] could not read the library:", err);
  }

  const value: Catalog =
    apps.length > 0
      ? { apps, placeholder: false }
      : { apps: PLACEHOLDER_APPS.map(fromPlaceholder), placeholder: true };

  cache = { at: now, value };
  return value;
}

/** Drops the cache — for whatever writes to the library next. */
export function invalidateCatalog(): void {
  cache = null;
}

/* ---------------------------------------------------------------- queries */

export async function getApps(): Promise<StoreApp[]> {
  return (await getCatalog()).apps;
}

export async function findApp(slug: string): Promise<StoreApp | undefined> {
  return (await getApps()).find((a) => a.slug === slug);
}

export async function byCategory(category: Category): Promise<StoreApp[]> {
  return (await getApps()).filter((a) => a.category === category);
}

/**
 * The five tiles the sketch draws, plus "Other" only when something is in it —
 * an imported APK with no category lands there and needs somewhere to be found.
 */
export async function categoryTiles(
  opts: { adults?: boolean } = {}
): Promise<{ label: Category; icon: string }[]> {
  const apps = await getApps();
  const hasOther = apps.some((a) => a.category === "Other");
  const tiles = opts.adults
    ? CATEGORIES
    : CATEGORIES.filter((c) => c.label !== ADULT_CATEGORY);
  return hasOther
    ? [...tiles, { label: "Other" as Category, icon: "package" }]
    : tiles;
}

/** Newest first by the date the app was first seen. */
export async function recentlyAdded(
  limit = 6,
  opts: { adults?: boolean } = {}
): Promise<StoreApp[]> {
  const { apps: all, placeholder } = await getCatalog();
  // Gated by default: a caller that forgets to ask is a caller that should not
  // be showing the shelf.
  // A browse row like every other: the family shows as its head. What arrived
  // was a member's file, and the head is where a person is sent to choose.
  // A companion's arrival is news about its host, so it is not a row here.
  const apps = withoutCompanions(
    onlyHeads(opts.adults ? all : withoutAdults(all))
  );
  if (placeholder) return apps.slice(0, limit);
  return [...apps]
    .sort((a, b) => (b.added ?? "").localeCompare(a.added ?? ""))
    .slice(0, limit);
}

/**
 * Per-user state. Which apps are installed, saved or due an update is a fact
 * about a person, and there is no login yet — so off disk these are empty and
 * the screens show their empty state. The placeholder rows keep their flags so
 * the layout can still be judged.
 */
export async function updates(): Promise<StoreApp[]> {
  return (await getApps()).filter((a) => a.updateTo);
}

export async function installed(): Promise<StoreApp[]> {
  return (await getApps()).filter((a) => a.installed);
}

export async function saved(): Promise<StoreApp[]> {
  return (await getApps()).filter((a) => a.saved);
}

/** "v9.4.1 | 20 August | Photo Editor Pro, new update" */
export async function changelog(
  limit = 3,
  opts: { adults?: boolean } = {}
): Promise<string[]> {
  const { apps: all, placeholder } = await getCatalog();
  if (placeholder) return PLACEHOLDER_CHANGELOG.slice(0, limit);

  // A line here names an app, so an ungated changelog would announce every
  // arrival on the shelf it is meant to hide.
  return (opts.adults ? all : withoutAdults(all))
    .flatMap((app) => app.versions.map((v) => ({ app, v })))
    .sort((a, b) => b.v.added.localeCompare(a.v.added))
    .slice(0, limit)
    .map(({ app, v }) => {
      const date = new Date(v.added).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        timeZone: "Europe/Stockholm",
      });
      return `v${v.version} | ${date} | ${app.name}, new update`;
    });
}

/** How many files are sitting in `_import/`, waiting for the importer. */
export async function pendingImports(): Promise<number> {
  const files = await listDir(path.join(STORE_ROOT, STORE_DIRS.import));
  return files.filter((f) =>
    APK_EXTENSIONS.includes(path.extname(f).toLowerCase())
  ).length;
}
