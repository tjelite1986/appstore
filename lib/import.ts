/**
 * The APK importer.
 *
 * Files dropped in `_import/` become versions in the catalog. This is the one
 * place in the app that writes to the library, so the mount it runs against
 * cannot be read-only.
 *
 * It is a port of the elite-v2 importer, and the port is not a copy: that one
 * matched against `apps`/`app_versions` rows and parked ambiguous drops in an
 * `app_import_review` table. Here the disk *is* the database — an app is a
 * folder under `apks/` plus a `meta/<slug>.json`, so:
 *
 *   attach   move the file to `apks/<slug>/<version>/`, and fill the gaps in
 *            `meta/<slug>.json` (package id, pinned signer) without touching
 *            anything a person wrote there
 *   park     move the file to `_import/_review/` and drop a `.json` sidecar
 *            beside it holding what the scan worked out — the sidecar is the
 *            review queue, so there is no index to keep in sync
 *
 * What a drop is matched on, strongest first: the package id out of the real
 * binary manifest, then name tokens with release-noise words removed, with the
 * signing certificate as a tiebreak. Anything that does not resolve to exactly
 * one app is parked rather than guessed at.
 */
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { STORE_DIRS, STORE_ROOT } from "./storage";
import {
  ADULT_CATEGORY,
  compareVersions,
  getCatalog,
  invalidateCatalog,
  type Category,
  type StoreApp,
} from "./store";
import { readApkInfo } from "./apk-manifest";
import { computeSha256, extractSignerSha256, verifyApk } from "./apk-verify";

const IMPORT_DIR = path.join(STORE_ROOT, STORE_DIRS.import);
const REVIEW_DIR = path.join(STORE_ROOT, STORE_DIRS.review);
/**
 * Discarded and displaced files land here rather than being unlinked.
 *
 * Exported because a merge displaces the same way an import does — the losing
 * half of a decision keeps existing — and two answers to "where does it go"
 * would be two folders to remember.
 */
export const DISCARD_DIR = path.join(STORE_ROOT, STORE_DIRS.import, "_discarded");

/**
 * A file touched this recently may still be uploading. A Samba or SFTP drop
 * appears in the directory at its first byte, and importing half an APK would
 * park a corrupt file with a plausible-looking review entry.
 */
const QUIET_MS = 60_000;
const APK_EXT = /\.(apk|xapk|apks|apkm)$/i;

/**
 * The apps that actually exist on disk.
 *
 * `getCatalog` stands the hand-written placeholder catalog in when the library
 * is empty, so the screens have something to show. The importer must never see
 * those: matching a real APK against an example would attach it to a slug that
 * is not a folder, and the first drop into an empty library is exactly when
 * that happens.
 */
async function realApps(): Promise<StoreApp[]> {
  const { apps, placeholder } = await getCatalog();
  return placeholder ? [] : apps;
}

/**
 * The category a new listing for an already-known package should start in.
 *
 * A second signer of the same app is a second listing, not a second app: the
 * store cannot offer it as an update, so `create-new` gives it its own slug.
 * Seeding that slug with only a name left it in "Other" — which for an adult
 * app means outside the gate, since `withoutAdults` filters on the category
 * alone. The shelf is an opinion the sibling already carries, so inherit it.
 *
 * Where siblings disagree, Adults wins. Being wrong towards the gate costs a
 * listing that needs re-filing by hand; being wrong away from it publishes an
 * adult app to a signed-out visitor.
 */
async function categoryForNewSibling(
  packageName: string | null | undefined
): Promise<Category | null> {
  if (!packageName) return null;
  const siblings = (await realApps()).filter(
    (a) => a.packageName === packageName
  );
  if (!siblings.length) return null;
  if (siblings.some((a) => a.category === ADULT_CATEGORY)) return ADULT_CATEGORY;
  return siblings[0].category;
}

/* --------------------------------------------------------- filename parsing */

export type ParsedApkName = {
  name: string;
  version: string | null;
  packageName: string | null;
};

/**
 * Mod APKs commonly ship a placeholder versionName — "9999", "9.9.9" — so the
 * app never considers itself outdated. Promoting that makes every later real
 * version compare as older, so the filename's version wins over one of these.
 */
export function isPlaceholderVersion(
  version: string | null | undefined
): boolean {
  if (!version) return false;
  return /^9+(\.9+)*$/.test(version.trim());
}

/**
 * "CCleaner Pro v26.12.1 - androforever.com.apk"
 *   -> { name: "CCleaner Pro", version: "26.12.1", packageName: null }
 * "com.fikfap.app-4.1.0.apk"
 *   -> { name: "com fikfap app", version: "4.1.0", packageName: "com.fikfap.app" }
 */
export function parseApkFilename(fileName: string): ParsedApkName {
  const base = fileName.replace(APK_EXT, "").replace(/[_+]/g, " ");

  // A java-style package id needs at least two dots — matched before domain
  // stripping, so a one-dot domain like androforever.com never qualifies.
  const pkgMatch = base.match(/\b([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2,})\b/i);
  const packageName = pkgMatch ? pkgMatch[1] : null;

  // Strip release-site credits: "- androforever.com", "(modsite.net)", ...
  let cleaned = base;
  if (pkgMatch) cleaned = cleaned.replace(pkgMatch[0], " ");
  cleaned = cleaned.replace(
    /(?:www\.)?[a-z0-9-]{2,}\.(?:com|net|org|io|co|app|win|site|xyz|me|to|cc|dev|info)\b/gi,
    " "
  );

  // Version: prefer an explicit v/version prefix, else a bare dotted number.
  // Suffixes are limited to real prerelease tags so decorations like "-mod1"
  // or "-arm64-v8a" never end up in the version string.
  const VER = /(\d+(?:\.\d+)+(?:[.-](?:beta|alpha|rc)\.?\d*)?)/.source;
  const vm =
    cleaned.match(new RegExp(`\\bv(?:ersion)?[ .:_-]?${VER}`, "i")) ||
    cleaned.match(new RegExp(`\\b${VER}\\b`, "i"));
  const version = vm ? vm[1] : null;
  const versionIndex = vm?.index ?? -1;

  let name = versionIndex > 0 ? cleaned.slice(0, versionIndex) : cleaned;
  if (vm) name = name.replace(vm[0], " ");
  name = name
    .replace(/\((?:[^)]*)\)|\[(?:[^\]]*)\]/g, " ") // bracketed release notes
    .replace(/[-–—.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!name && packageName) name = packageName.replace(/\./g, " ");

  return { name, version, packageName };
}

/* ---------------------------------------------------------------- matching */

/** Release-name decorations that say nothing about WHICH app it is. */
const NOISE_TOKENS = new Set([
  "pro", "mod", "premium", "apk", "xapk", "unlocked", "unlock", "full",
  "paid", "plus", "vip", "adfree", "ads", "ad", "free", "latest", "version",
  "final", "patched", "cracked", "lite", "beta", "android", "edition", "hack",
  "menu", "mega", "original", "official", "update", "updated", "new",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export type Suggestion = {
  slug: string;
  name: string;
  score: number;
  why: string;
};

type MatchResult = {
  auto: StoreApp | null;
  autoWhy: string | null;
  suggestions: Suggestion[];
};

function matchApps(
  parsedName: string,
  packageName: string | null,
  signer: string | null,
  apps: StoreApp[]
): MatchResult {
  // 1) Exact package id. The manifest's own answer to "which app is this", so
  // one hit ends the search.
  if (packageName) {
    const pkg = packageName.toLowerCase();
    const byPkg = apps.filter((a) => a.packageName?.toLowerCase() === pkg);
    if (byPkg.length === 1) {
      return { auto: byPkg[0], autoWhy: "package id", suggestions: [] };
    }
  }

  // 2) Name tokens. Noise words are dropped from the drop's name so
  // "CCleaner Pro" still matches "CCleaner".
  const allDrop = tokenize(parsedName);
  const dropTokens = allDrop.filter((t) => !NOISE_TOKENS.has(t));
  const effective = dropTokens.length ? dropTokens : allDrop;

  const scored = apps
    .map((app) => {
      const appTokens = new Set(tokenize(app.name).concat(tokenize(app.slug)));
      if (!effective.length || !appTokens.size) {
        return { app, coverage: 0, score: 0 };
      }
      const hits = effective.filter((t) => appTokens.has(t)).length;
      const coverage = hits / effective.length;
      const appCoverage = hits / appTokens.size;
      let score = coverage * 0.7 + appCoverage * 0.3;
      if (signer && app.signingCert === signer) score += 0.25;
      return { app, coverage, score };
    })
    .filter((s) => s.score > 0.15)
    .sort((a, b) => b.score - a.score);

  // Auto only when exactly one app contains every non-noise token of the drop.
  const fullCoverage = scored.filter((s) => s.coverage === 1);
  if (fullCoverage.length === 1) {
    return { auto: fullCoverage[0].app, autoWhy: "name match", suggestions: [] };
  }

  return {
    auto: null,
    autoWhy: null,
    suggestions: scored.slice(0, 5).map((s) => ({
      slug: s.app.slug,
      name: s.app.name,
      score: Math.round(s.score * 100) / 100,
      why:
        signer && s.app.signingCert === signer
          ? "same signing key"
          : "name similarity",
    })),
  };
}

/* ------------------------------------------------------------------- files */

/** Anything that could climb out of a directory, flattened. */
function sanitizeSegment(s: string): string {
  return s.replace(/[^\w.-]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "x";
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.stat(abs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move, falling back to copy + unlink.
 *
 * Everything here is under one bind mount so `rename` works, but the drop zone
 * is the folder most likely to be repointed at another disk later, and an
 * EXDEV then would fail the import with nothing to show for it.
 */
async function moveFile(src: string, dest: string): Promise<void> {
  await ensureDir(path.dirname(dest));
  try {
    await fs.rename(src, dest);
  } catch {
    await fs.copyFile(src, dest);
    await fs.unlink(src);
  }
}

/** `dir/name`, with " (2)", " (3)" … appended until nothing is there. */
async function freeName(dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let candidate = path.join(dir, name);
  for (let n = 2; await exists(candidate); n++) {
    candidate = path.join(dir, `${stem} (${n})${ext}`);
  }
  return candidate;
}

/* -------------------------------------------------------------------- meta */

/**
 * `meta/<slug>.json`, parsed, or an empty object.
 *
 * Read as a bag rather than a typed `MetaFile`: the importer only ever fills
 * two fields, and re-serialising a parsed shape would quietly drop any key a
 * person added by hand that this build does not know about.
 *
 * Exported because a source filling in editorial metadata has the same
 * question the importer does — which keys does this app already carry — and
 * has to answer it against the file rather than the catalog, whose reader
 * substitutes defaults for the fields that are missing.
 */
export async function readMetaRaw(slug: string): Promise<Record<string, unknown>> {
  const abs = path.join(STORE_ROOT, STORE_DIRS.meta, `${slug}.json`);
  try {
    const parsed = JSON.parse(await fs.readFile(abs, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function writeMeta(
  slug: string,
  patch: Record<string, unknown>
): Promise<void> {
  const dir = path.join(STORE_ROOT, STORE_DIRS.meta);
  await ensureDir(dir);
  const merged = { ...(await readMetaRaw(slug)), ...patch };
  await fs.writeFile(
    path.join(dir, `${slug}.json`),
    JSON.stringify(merged, null, 2) + "\n",
    "utf8"
  );
}

/** "CCleaner Pro" -> "ccleaner-pro". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** A slug no app is using — checked against both halves of the library. */
export async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || "app";
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken =
      (await exists(path.join(STORE_ROOT, STORE_DIRS.meta, `${slug}.json`))) ||
      (await exists(path.join(STORE_ROOT, STORE_DIRS.apks, slug)));
    if (!taken) return slug;
  }
}

/* ------------------------------------------------------------------ attach */

export type AttachInfo = {
  version: string;
  packageName: string | null;
  fileName: string;
};

export type AttachResult = {
  ok: boolean;
  /** The verify status, or why the attach was refused. */
  status: string;
  slug?: string;
  appName?: string;
  version?: string;
  /** True when this version is now the newest one the app serves. */
  promoted?: boolean;
};

/**
 * Verify, then move the file into `apks/<slug>/<version>/`.
 *
 * The signer check is trust-on-first-use: the first APK to arrive for an app
 * pins its certificate into the meta file, and a later drop signed with a
 * different key is refused rather than served. That is the check that stops a
 * repackaged APK from taking over an app someone already installed — so
 * `force` re-pins only on an explicit decision from the review queue.
 */
export async function attachApk(
  slug: string,
  absPath: string,
  info: AttachInfo,
  opts: { force?: boolean } = {}
): Promise<AttachResult> {
  const apps = await realApps();
  const app = apps.find((a) => a.slug === slug);
  const meta = await readMetaRaw(slug);
  const pinned = typeof meta.signingCert === "string" ? meta.signingCert : null;
  // An app the catalog does not know is only legitimate straight after
  // create-new wrote its meta file; a slug from nowhere is not a target.
  if (!app && !Object.keys(meta).length) {
    return { ok: false, status: "app_not_found" };
  }

  const verify = await verifyApk(absPath, {
    pinnedSigner: opts.force ? null : pinned,
  });
  if (verify.status === "signer_mismatch") {
    return { ok: false, status: "signer_mismatch", slug, appName: app?.name };
  }

  const version = sanitizeSegment(info.version);
  const fileName = sanitizeSegment(path.basename(info.fileName));
  const versionDir = path.join(STORE_ROOT, STORE_DIRS.apks, slug, version);
  await ensureDir(versionDir);

  // One binary per version directory: the catalog reader takes the first APK
  // it finds in there, so leaving a second one behind makes which file the
  // store serves depend on readdir order. Displaced files are kept.
  for (const existing of await fs.readdir(versionDir).catch(() => [])) {
    if (!APK_EXT.test(existing)) continue;
    await moveFile(
      path.join(versionDir, existing),
      await freeName(path.join(DISCARD_DIR, slug, version), existing)
    );
  }
  await moveFile(absPath, path.join(versionDir, fileName));

  // Fill the gaps in the meta file, never overwrite: the package id and the
  // pinned signer are facts about the binary, but a person owns everything
  // else in there.
  const patch: Record<string, unknown> = {};
  if (info.packageName && !meta.packageName) patch.packageName = info.packageName;
  if (verify.signerSha256 && (!pinned || opts.force)) {
    patch.signingCert = verify.signerSha256;
  }
  if (Object.keys(patch).length) await writeMeta(slug, patch);

  invalidateCatalog();

  // "Newest" is a question about the folder, not about a row: compare the new
  // version against the ones already on disk.
  const previous = app?.versions.map((v) => v.version) ?? [];
  const promoted = previous.every((v) => compareVersions(info.version, v) <= 0);

  return {
    ok: true,
    status: verify.status,
    slug,
    appName: app?.name ?? slug,
    version: info.version,
    promoted,
  };
}

/* ------------------------------------------------------------ review queue */

/** What the scan worked out about a file it would not import on its own. */
export type ReviewItem = {
  /** The parked file's name — its identity for a decision. */
  id: string;
  originalName: string;
  parsedName: string | null;
  parsedVersion: string | null;
  packageName: string | null;
  versionCode: number | null;
  signer: string | null;
  fileSize: number;
  /**
   * "no_match" | "ambiguous" | "duplicate" | "signer_mismatch", or
   * "now_matches" — parked when nothing fitted, and something does now.
   */
  reason: string;
  matchedSlug: string | null;
  suggestions: Suggestion[];
  parkedAt: string;
};

type ReviewFields = Omit<ReviewItem, "id" | "parkedAt">;

async function parkForReview(
  absPath: string,
  fields: ReviewFields
): Promise<void> {
  await ensureDir(REVIEW_DIR);
  const dest = await freeName(REVIEW_DIR, path.basename(absPath));
  await moveFile(absPath, dest);
  const item: ReviewItem = {
    ...fields,
    id: path.basename(dest),
    parkedAt: new Date().toISOString(),
  };
  await fs.writeFile(`${dest}.json`, JSON.stringify(item, null, 2) + "\n", "utf8");
}

/**
 * Everything waiting for a decision, newest first.
 *
 * A sidecar whose APK has gone — someone moved it out by hand — is dropped
 * along with its sidecar, so the queue never offers a decision about a file
 * that is not there.
 */
/**
 * The review queue, matched against the catalog as it is now.
 *
 * The sidecar records what the file *is* — name, version, package id, signer,
 * when it landed. It also recorded who it might be, and that part goes stale
 * the moment the catalog changes: almost everything parks as "no matching app"
 * precisely when the catalog is empty, and adding the app afterwards would
 * leave the queue insisting there is still nothing to attach to. So the facts
 * are replayed and the verdict is recomputed.
 *
 * An item that now matches exactly is not attached from here — a read does not
 * move files. It is shown as a match the decision can take in one click.
 */
export async function listReview(): Promise<ReviewItem[]> {
  const files = await fs.readdir(REVIEW_DIR).catch(() => [] as string[]);
  const apps = await realApps();
  const out: ReviewItem[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const apk = path.join(REVIEW_DIR, file.slice(0, -".json".length));
    if (!(await exists(apk))) {
      await fs.unlink(path.join(REVIEW_DIR, file)).catch(() => {});
      continue;
    }
    try {
      const parsed = JSON.parse(
        await fs.readFile(path.join(REVIEW_DIR, file), "utf8")
      ) as ReviewFields & { parkedAt?: string };
      const item: ReviewItem = { ...parsed, id: path.basename(apk) } as ReviewItem;

      // "duplicate" and "signer_mismatch" are statements about the file and
      // the app it already belongs to, not about a search that failed — only
      // the two "we could not place this" verdicts are worth redoing.
      if (item.reason === "no_match" || item.reason === "ambiguous") {
        const match = matchApps(
          item.parsedName ?? "",
          item.packageName,
          item.signer,
          apps
        );
        item.matchedSlug = match.auto?.slug ?? null;
        item.suggestions = match.suggestions;
        if (match.auto) item.reason = "now_matches";
      }
      out.push(item);
    } catch {
      /* an unreadable sidecar hides one file, not the whole queue */
    }
  }
  return out.sort((a, b) => (b.parkedAt ?? "").localeCompare(a.parkedAt ?? ""));
}

/** The parked file for a review id, or null if the id is not one. */
async function reviewPaths(
  id: string
): Promise<{ apk: string; sidecar: string } | null> {
  if (!id || id.includes("/") || id.includes("\\") || id.includes("\0")) {
    return null;
  }
  const apk = path.join(REVIEW_DIR, id);
  if (path.dirname(apk) !== REVIEW_DIR) return null;
  return { apk, sidecar: `${apk}.json` };
}

export type ReviewAction = "attach" | "create-new" | "discard";

export type DecideResult = {
  ok: boolean;
  error?: string;
  /** The caller may offer "attach anyway", which re-pins the signer. */
  signerMismatch?: boolean;
  slug?: string;
  appName?: string;
  version?: string;
};

/**
 * Resolve one parked file.
 *
 * "discard" moves it to `_import/_discarded/` rather than unlinking it — a
 * wrong click on a 200 MB APK that arrived over a slow link should not be
 * final, and the folder is trivial to empty by hand.
 */
export async function decideImport(
  id: string,
  action: ReviewAction,
  opts: { slug?: string; force?: boolean } = {}
): Promise<DecideResult> {
  const paths = await reviewPaths(id);
  if (!paths) return { ok: false, error: "Unknown review item" };

  let item: ReviewItem | null = null;
  try {
    item = JSON.parse(await fs.readFile(paths.sidecar, "utf8")) as ReviewItem;
  } catch {
    return { ok: false, error: "Unknown review item" };
  }

  const dropSidecar = () => fs.unlink(paths.sidecar).catch(() => {});

  if (action === "discard") {
    if (await exists(paths.apk)) {
      await moveFile(paths.apk, await freeName(DISCARD_DIR, id));
    }
    await dropSidecar();
    return { ok: true };
  }

  if (!(await exists(paths.apk))) {
    await dropSidecar();
    return { ok: false, error: "The parked file is gone — item removed" };
  }

  let slug = opts.slug;
  if (action === "create-new") {
    const name = (item.parsedName || item.originalName.replace(APK_EXT, "")).trim();
    slug = await uniqueSlug(name);
    const category = await categoryForNewSibling(item.packageName);
    await writeMeta(slug, {
      name,
      ...(item.packageName ? { packageName: item.packageName } : {}),
      ...(category ? { category } : {}),
    });
    invalidateCatalog();
  }
  if (!slug) return { ok: false, error: "Pick an app to attach to" };

  const attach = await attachApk(
    slug,
    paths.apk,
    {
      version: item.parsedVersion || "unknown",
      packageName: item.packageName,
      fileName: item.originalName,
    },
    { force: opts.force }
  );
  if (!attach.ok) {
    if (attach.status === "signer_mismatch") {
      return {
        ok: false,
        signerMismatch: true,
        appName: attach.appName,
        error: `Signed with a different key than the one pinned for ${attach.appName}`,
      };
    }
    return { ok: false, error: `Attach failed (${attach.status})` };
  }
  await dropSidecar();
  return {
    ok: true,
    slug: attach.slug,
    appName: attach.appName,
    version: attach.version,
  };
}

/* -------------------------------------------------------------------- scan */

export type ImportSummary = {
  scanned: number;
  imported: { file: string; app: string; version: string; promoted: boolean }[];
  parked: { file: string; reason: string }[];
  skipped: { file: string; note: string }[];
};

// One scan at a time. A second trigger — the button pressed twice, or a timer
// landing on top of it — awaits the run in flight instead of racing it into
// the same directory.
let inFlight: Promise<ImportSummary> | null = null;

export function runImportScan(): Promise<ImportSummary> {
  if (!inFlight) {
    inFlight = scan().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function scan(): Promise<ImportSummary> {
  const res: ImportSummary = { scanned: 0, imported: [], parked: [], skipped: [] };
  await ensureDir(IMPORT_DIR);

  const entries = await fs
    .readdir(IMPORT_DIR, { withFileTypes: true })
    .catch(() => [] as Dirent[]);
  // Re-read after every attach: two drops for the same app arrive in one run,
  // and the second one has to see the version the first one just added or the
  // duplicate check compares against a catalog that is one file out of date.
  let apps = await realApps();

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    const abs = path.join(IMPORT_DIR, entry.name);
    res.scanned++;

    if (!APK_EXT.test(entry.name)) {
      res.skipped.push({ file: entry.name, note: "not an APK file" });
      continue;
    }
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat) continue;
    if (Date.now() - stat.mtimeMs < QUIET_MS) {
      res.skipped.push({ file: entry.name, note: "still being written" });
      continue;
    }

    const manifest = await readApkInfo(abs);
    const parsed = parseApkFilename(entry.name);
    const signer = extractSignerSha256(abs);
    const packageName = manifest.packageName || parsed.packageName;
    const version =
      (isPlaceholderVersion(manifest.versionName) ? parsed.version : null) ||
      manifest.versionName ||
      parsed.version ||
      (manifest.versionCode ? `vc${manifest.versionCode}` : null) ||
      `import-${new Date().toISOString().slice(0, 10)}`;

    const fields: ReviewFields = {
      originalName: entry.name,
      parsedName: parsed.name || null,
      parsedVersion: version,
      packageName,
      versionCode: manifest.versionCode,
      signer,
      fileSize: stat.size,
      reason: "no_match",
      matchedSlug: null,
      suggestions: [],
    };

    const match = matchApps(parsed.name, packageName, signer, apps);

    if (!match.auto) {
      await parkForReview(abs, {
        ...fields,
        reason: match.suggestions.length ? "ambiguous" : "no_match",
        suggestions: match.suggestions,
      });
      res.parked.push({
        file: entry.name,
        reason: match.suggestions.length
          ? `ambiguous — ${match.suggestions.length} candidate(s)`
          : "no matching app",
      });
      continue;
    }

    const app = match.auto;
    const matched: Suggestion[] = [
      { slug: app.slug, name: app.name, score: 1, why: match.autoWhy || "match" },
    ];

    // This version is already on disk. Identical bytes means the drop is a
    // re-upload of what is already served and can go; different bytes is a
    // question only a person can answer.
    const existing = app.versions.find((v) => v.version === version);
    if (existing) {
      const [dropSha, servedSha] = await Promise.all([
        computeSha256(abs),
        computeSha256(
          path.join(STORE_ROOT, STORE_DIRS.apks, app.slug, version, existing.file)
        ).catch(() => null),
      ]);
      if (servedSha && servedSha === dropSha) {
        await moveFile(abs, await freeName(DISCARD_DIR, entry.name));
        res.skipped.push({
          file: entry.name,
          note: `already in store (${app.name} ${version})`,
        });
        continue;
      }
      await parkForReview(abs, {
        ...fields,
        reason: "duplicate",
        matchedSlug: app.slug,
        suggestions: matched,
      });
      res.parked.push({
        file: entry.name,
        reason: `version ${version} of ${app.name} already exists with different content`,
      });
      continue;
    }

    const attach = await attachApk(app.slug, abs, {
      version,
      packageName,
      fileName: entry.name,
    });
    if (!attach.ok) {
      await parkForReview(abs, {
        ...fields,
        reason: attach.status,
        matchedSlug: app.slug,
        suggestions: matched,
      });
      res.parked.push({
        file: entry.name,
        reason:
          attach.status === "signer_mismatch"
            ? `signer mismatch against ${app.name} — held for review`
            : `could not attach to ${app.name} (${attach.status})`,
      });
      continue;
    }
    apps = await realApps();
    res.imported.push({
      file: entry.name,
      app: app.name,
      version,
      promoted: !!attach.promoted,
    });
  }

  return res;
}
