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
import { getApps, invalidateCatalog, type StoreApp } from "@/lib/store";
import { writeMeta } from "@/lib/import";
import { alreadyHeld, installFromUrl } from "@/lib/sources/install";
import { checkGitHub } from "@/lib/sources/github";
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
};

export type SourceReport = {
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
 * `checkSources`, with a second caller joining the run in flight instead of
 * starting its own. The joiner gets that run's report, install flag included —
 * a check that arrives while an install is running has its answer either way.
 */
export function runSourceCheck(opts: { install?: boolean } = {}): Promise<SourceReport> {
  if (!inFlight) {
    inFlight = checkSources(opts).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
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
        held: app.versions[0]?.version ?? null,
        status: "error",
        detail,
      });
    }
  }

  if (report.installed > 0) invalidateCatalog();
  return report;
}

async function checkOne(app: StoreApp, install: boolean): Promise<SourceCheck> {
  const held = app.versions[0]?.version ?? null;
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
    if (!install) {
      return { ...base, kind: "github", upstream: release.tag, status: "available" };
    }

    const installed = await installFromUrl(app.slug, release.asset.url, {
      fileName: release.asset.name,
      tag: "github",
      fallbackVersion: release.tag.replace(/^v/i, ""),
    });
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
  if (!install) {
    return {
      ...base,
      kind: "fdroid",
      upstream: build.versionName || String(build.versionCode),
      status: "available",
    };
  }

  const installed = await installFromUrl(
    app.slug,
    apkUrl(fdroid.packageId, build.versionCode),
    {
      fileName: `${fdroid.packageId}_${build.versionCode}.apk`,
      tag: "fdroid",
      fallbackVersion: build.versionName || null,
    }
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
 * Write back which upstream release this app now holds.
 *
 * Without it the next check has nothing but the version string to go on and
 * would fetch the same file again — the whole point of recording it.
 */
async function rememberRelease(
  app: StoreApp,
  patch: { releaseTag: string }
): Promise<void> {
  if (!app.source) return;
  await writeMeta(app.slug, { source: { ...app.source, ...patch } });
}
