/**
 * Asking every source whether it has something newer than the library holds.
 *
 * "Newer" is answered by the upstream's own name for the release — a GitHub
 * tag, an F-Droid version code — and not by the version string on disk. The
 * two disagree often (a tag `v1.4` ships a manifest that says `1.4.0-rc2`),
 * and comparing them would either miss releases or fetch the same 200 MB file
 * every six hours. So each install records what it took, and the check
 * compares against that.
 *
 * Play listings are checked but never fetched: Google serves APKs to the Play
 * client and to nobody else. What Play's page says its version is gets
 * compared against the newest build the library holds, and an app behind it
 * is reported as `behind` — a fact for a person, since the build has to come
 * from somewhere else — rather than `available`, which names what the next
 * fetch will take.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { compareVersions, getApps, invalidateCatalog, type StoreApp } from "@/lib/store";
import { STORE_DIRS, STORE_ROOT } from "@/lib/storage";
import { writeMeta } from "@/lib/import";
import { RefusedRelease, alreadyHeld, installFromUrl } from "@/lib/sources/install";
import { checkGitHub, isLinked, relinkGitHub } from "@/lib/sources/github";
import { apkUrl, buildToInstall, checkFdroid } from "@/lib/sources/fdroid";
import { PlayNoListing, fetchPlayListing } from "@/lib/sources/play";
import { isCheckableModSource, modSiteName, modSourceVersion } from "@/lib/sources/mod-sites";

export type SourceStatus =
  | "current"
  /** Upstream has a newer release and a fetch would take it. */
  | "available"
  /** Upstream has a newer release and nothing here can take it — Play. */
  | "behind"
  | "installed"
  | "unavailable"
  | "error";

export type SourceCheck = {
  slug: string;
  name: string;
  kind: string;
  /** What upstream calls its newest release. */
  upstream: string | null;
  /** The newest version the library serves. */
  held: string | null;
  status: SourceStatus;
  detail?: string;
  /**
   * The release upstream offers is one the importer already turned down —
   * a different signer than the pin. It stays `available` because it is, but
   * nothing will fetch it again; a person decides in the review queue.
   */
  refused?: true;
};

export type SourceReport = {
  /** When the run finished, ISO. */
  at: string;
  /** Whether the run was allowed to take what was newer. */
  fetched: boolean;
  checked: number;
  available: number;
  /** Apps newer upstream that no fetch can bring in — see `SourceStatus`. */
  behind: number;
  installed: number;
  errors: number;
  apps: SourceCheck[];
};

// One check at a time. The timer and the button both land here, and two runs
// would fetch the same release twice into the same staging folder.
let inFlight: Promise<SourceReport> | null = null;

/**
 * Where the last report is kept.
 *
 * A check used to leave nothing behind: the timer's result went to the
 * journal and the button's to the browser that pressed it, so "what is behind
 * upstream right now" could only be answered by running another check. Now
 * every run writes its report here and Manage reads it back.
 */
const REPORT_FILE = path.join(STORE_ROOT, STORE_DIRS.state, "sources.json");

/**
 * `checkSources`, with a second caller joining the run in flight instead of
 * starting its own. The joiner gets that run's report, install flag included —
 * a check that arrives while an install is running has its answer either way.
 */
export function runSourceCheck(opts: { install?: boolean } = {}): Promise<SourceReport> {
  if (!inFlight) {
    inFlight = checkSources(opts)
      .then(async (report) => {
        await saveReport(report);
        return report;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/**
 * Write the report down. One writer at a time is already guaranteed by the
 * single flight above; the temp name guards against a crash mid-write
 * leaving half a file where the reader looks.
 *
 * A report that cannot be written is logged, not thrown: the check itself
 * succeeded and its caller is still owed the answer.
 */
async function saveReport(report: SourceReport): Promise<void> {
  const tmp = `${REPORT_FILE}.${process.pid}.tmp`;
  try {
    await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(report, null, 2) + "\n", "utf8");
    await fs.rename(tmp, REPORT_FILE);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    console.error("[sources] could not save the report:", err);
  }
}

/** The report of the last run, or null when none has finished yet. */
export async function lastSourceReport(): Promise<SourceReport | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(REPORT_FILE, "utf8")) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as SourceReport).at !== "string" ||
      !Array.isArray((parsed as SourceReport).apps)
    ) {
      return null;
    }
    const report = parsed as SourceReport;
    // Reports written before Play was checked carry no `behind` count.
    return { ...report, behind: report.behind ?? 0 };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[sources] could not read the last report:", err);
    }
    return null;
  }
}

/**
 * The same report, with only the listed apps in it and the counts redone.
 *
 * The file holds every sourced app; a reader that shows a gated subset of the
 * library (Manage, under the 18+ gate) has to cut the report to match, or an
 * app it does not list is named in the panel anyway.
 */
export function restrictReport(report: SourceReport, slugs: Set<string>): SourceReport {
  const apps = report.apps.filter((a) => slugs.has(a.slug));
  return {
    ...report,
    apps,
    checked: apps.length,
    available: apps.filter((a) => a.status === "available").length,
    behind: apps.filter((a) => a.status === "behind").length,
    installed: apps.filter((a) => a.status === "installed").length,
    errors: apps.filter((a) => a.status === "error").length,
  };
}

/** True while a check is running. */
export function sourceCheckRunning(): boolean {
  return inFlight !== null;
}

/**
 * The apps a check has anything to ask about.
 *
 * A Play app marked `untracked` is left out: somebody has said its version is
 * not supposed to follow Play's, and asking anyway would only put it back on
 * the Behind card they took it off.
 */
export function sourcedApps(apps: StoreApp[]): StoreApp[] {
  return apps.filter(
    (a) =>
      a.source?.kind === "github" ||
      a.source?.kind === "fdroid" ||
      isCheckableModSource(a.modSource) ||
      (a.source?.kind === "play" && !a.source.untracked)
  );
}

/**
 * Check every sourced app, and optionally install what is new.
 *
 * One app at a time: the far ends are public services being asked a favour,
 * and two 200 MB downloads at once on a home line is how the timer starts
 * overlapping itself.
 */
export async function checkSources(
  opts: { install?: boolean } = {}
): Promise<SourceReport> {
  const report: SourceReport = {
    at: new Date().toISOString(),
    fetched: Boolean(opts.install),
    checked: 0,
    available: 0,
    behind: 0,
    installed: 0,
    errors: 0,
    apps: [],
  };

  for (const app of sourcedApps(await getApps())) {
    report.checked++;
    try {
      const check = await checkOne(app, Boolean(opts.install));
      report.apps.push(check);
      if (check.status === "available") report.available++;
      if (check.status === "behind") report.behind++;
      if (check.status === "installed") report.installed++;
    } catch (err) {
      report.errors++;
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[sources] ${app.slug}:`, detail);
      report.apps.push({
        slug: app.slug,
        name: app.name,
        kind: app.source?.kind ?? "none",
        upstream: null,
        held: app.versions[0]?.version ?? app.source?.assetVersion ?? null,
        status: "error",
        detail,
      });
    }
  }

  if (report.installed > 0) invalidateCatalog();
  report.at = new Date().toISOString();
  return report;
}

async function checkOne(app: StoreApp, install: boolean): Promise<SourceCheck> {
  // A linked app has nothing on disk, so what it "holds" is the version of the
  // release it currently points at.
  const held = app.versions[0]?.version ?? app.source?.assetVersion ?? null;
  const base = { slug: app.slug, name: app.name, held };

  if (app.source?.kind === "github") {
    const release = await checkGitHub(app);
    if (!release) {
      return {
        ...base,
        kind: "github",
        upstream: null,
        status: "unavailable",
        detail: "no recent release carries an APK",
      };
    }
    // The tag is the release's identity upstream; the version on disk is what
    // the binary said about itself. Either one matching means this release is
    // already here.
    const known =
      release.tag === app.source.releaseTag ||
      alreadyHeld(app.versions, release.tag);
    if (known) {
      return { ...base, kind: "github", upstream: release.tag, status: "current" };
    }
    if (release.tag === app.source.refusedTag) {
      return {
        ...base,
        kind: "github",
        upstream: release.tag,
        status: "available",
        detail: REFUSED,
        refused: true,
      };
    }
    if (!install) {
      return { ...base, kind: "github", upstream: release.tag, status: "available" };
    }

    // Two shapes live side by side on purpose. An app added before linking
    // existed keeps its mirrored file — dropping the binary out from under
    // someone who installed from it is not an update — while a linked app is
    // repointed at the new asset.
    if (isLinked(app)) {
      const linked = await refusable(app, release.tag, () => relinkGitHub(app, release));
      return {
        ...base,
        kind: "github",
        upstream: release.tag,
        status: "installed",
        detail: `${linked.version} (linked)`,
      };
    }

    const installed = await refusable(app, release.tag, () =>
      installFromUrl(app.slug, release.asset.url, {
        fileName: release.asset.name,
        tag: "github",
        fallbackVersion: release.tag.replace(/^v/i, ""),
      })
    );
    await rememberRelease(app, { releaseTag: release.tag });
    return {
      ...base,
      kind: "github",
      upstream: release.tag,
      status: "installed",
      detail: `${installed.version}${installed.promoted ? "" : " (older than what is served)"}`,
    };
  }

  // A mod is compared with the page it came from, not with Play: Play's
  // number belongs to the original, and the next build with this signer can
  // only come from where this one did.
  if (isCheckableModSource(app.modSource)) {
    return checkMod(app, app.modSource, base);
  }

  if (app.source?.kind === "play") {
    return checkPlay(app, base);
  }

  const fdroid = await checkFdroid(app);
  if (!fdroid) {
    return { ...base, kind: "none", upstream: null, status: "unavailable" };
  }
  const build = buildToInstall(fdroid);
  const known =
    String(build.versionCode) === app.source?.releaseTag ||
    alreadyHeld(app.versions, build.versionName);
  if (known) {
    return {
      ...base,
      kind: "fdroid",
      upstream: build.versionName || String(build.versionCode),
      status: "current",
    };
  }
  if (String(build.versionCode) === app.source?.refusedTag) {
    return {
      ...base,
      kind: "fdroid",
      upstream: build.versionName || String(build.versionCode),
      status: "available",
      detail: REFUSED,
      refused: true,
    };
  }
  if (!install) {
    return {
      ...base,
      kind: "fdroid",
      upstream: build.versionName || String(build.versionCode),
      status: "available",
    };
  }

  const installed = await refusable(app, String(build.versionCode), () =>
    installFromUrl(app.slug, apkUrl(fdroid.packageId, build.versionCode), {
      fileName: `${fdroid.packageId}_${build.versionCode}.apk`,
      tag: "fdroid",
      fallbackVersion: build.versionName || null,
    })
  );
  await rememberRelease(app, { releaseTag: String(build.versionCode) });
  return {
    ...base,
    kind: "fdroid",
    upstream: build.versionName || String(build.versionCode),
    status: "installed",
    detail: installed.version,
  };
}

/**
 * Play, asked what version it shows — and nothing taken from the answer but
 * the number.
 *
 * The library's own builds are compared to it rather than `source.playVersion`:
 * that field is what Play said on the day the shelf was made, and the shelf
 * has usually been filled since. `held` newer than Play is `current`, not an
 * error — a build can reach the store before Play rolls it out everywhere, and
 * a modified build is numbered by its own author. Play's "varies with device"
 * is `unavailable`: there is no number to compare, and saying so is more
 * useful than guessing.
 */
async function checkPlay(
  app: StoreApp,
  base: { slug: string; name: string; held: string | null }
): Promise<SourceCheck> {
  const kind = "play";
  const packageId = app.packageName ?? playPackageId(app.source?.url);
  if (!packageId) {
    return {
      ...base,
      kind,
      upstream: null,
      status: "unavailable",
      detail: "no package id to ask Play about",
    };
  }

  let upstream: string | null;
  try {
    upstream = (await fetchPlayListing(packageId)).playVersion;
  } catch (err) {
    if (err instanceof PlayNoListing) {
      return {
        ...base,
        kind,
        upstream: null,
        status: "unavailable",
        detail: "Play no longer lists this package",
      };
    }
    throw err;
  }
  if (!upstream) {
    return {
      ...base,
      kind,
      upstream: null,
      status: "unavailable",
      detail: "Play says the version varies with device",
    };
  }
  if (!base.held) {
    return {
      ...base,
      kind,
      upstream,
      status: "behind",
      detail: "no build in the library yet",
    };
  }
  // compareVersions sorts newest first: at most zero means `held` is Play's
  // version or past it.
  if (alreadyHeld(app.versions, upstream) || compareVersions(base.held, upstream) <= 0) {
    return { ...base, kind, upstream, status: "current" };
  }
  return {
    ...base,
    kind,
    upstream,
    status: "behind",
    detail: "Play has a newer build than the library holds; it has to come from elsewhere",
  };
}

/** The `id` a Play listing address carries, for a shelf that has no package name yet. */
async function checkMod(
  app: StoreApp,
  url: string,
  base: { slug: string; name: string; held: string | null }
): Promise<SourceCheck> {
  const kind = modSiteName(url);
  const upstream = await modSourceVersion(url);
  if (!upstream) {
    return {
      ...base,
      kind,
      upstream: null,
      status: "unavailable",
      detail: "the mod page names no version",
    };
  }
  if (!base.held) {
    return { ...base, kind, upstream, status: "behind", detail: "no build in the library yet" };
  }
  if (alreadyHeld(app.versions, upstream) || compareVersions(base.held, upstream) <= 0) {
    return { ...base, kind, upstream, status: "current" };
  }
  return {
    ...base,
    kind,
    upstream,
    status: "behind",
    detail: `${kind} offers a newer build than the library holds; fetch it from the mod page`,
  };
}

function playPackageId(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const id = new URL(url).searchParams.get("id");
    return id && /^[a-zA-Z0-9._]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** What the check says about a release it will not fetch again. */
const REFUSED =
  "signed with a different key than the pin — decide in the review queue; not fetched again until upstream moves on";

/**
 * Run a fetch, and if the importer refuses the release, remember which one.
 *
 * The refusal is rethrown so this run reports it — a person has something to
 * decide — but the next run finds the tag in `refusedTag` and leaves the
 * release alone instead of downloading it again to be refused again.
 */
async function refusable<T>(
  app: StoreApp,
  tag: string,
  work: () => Promise<T>
): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof RefusedRelease) {
      await rememberRelease(app, { refusedTag: tag });
    }
    throw err;
  }
}

/**
 * Write back which upstream release this app now holds.
 *
 * Without it the next check has nothing but the version string to go on and
 * would fetch the same file again — the whole point of recording it.
 */
async function rememberRelease(
  app: StoreApp,
  patch: { releaseTag?: string; refusedTag?: string }
): Promise<void> {
  if (!app.source) return;
  await writeMeta(app.slug, { source: { ...app.source, ...patch } });
}
