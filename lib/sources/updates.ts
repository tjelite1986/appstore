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
 * Play listings are skipped: Google serves APKs to the Play client and to
 * nobody else, so there is never anything here to fetch.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getApps, invalidateCatalog, type StoreApp } from "@/lib/store";
import { STORE_DIRS, STORE_ROOT } from "@/lib/storage";
import { writeMeta } from "@/lib/import";
import { RefusedRelease, alreadyHeld, installFromUrl } from "@/lib/sources/install";
import { checkGitHub, isLinked, relinkGitHub } from "@/lib/sources/github";
import { apkUrl, buildToInstall, checkFdroid } from "@/lib/sources/fdroid";

export type SourceStatus =
  | "current"
  | "available"
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
    return parsed as SourceReport;
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
    installed: apps.filter((a) => a.status === "installed").length,
    errors: apps.filter((a) => a.status === "error").length,
  };
}

/** True while a check is running. */
export function sourceCheckRunning(): boolean {
  return inFlight !== null;
}

/** The apps a check has anything to ask about. */
export function sourcedApps(apps: StoreApp[]): StoreApp[] {
  return apps.filter(
    (a) => a.source?.kind === "github" || a.source?.kind === "fdroid"
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
