/**
 * "Download the build too" — the admin half of taking an APK from apkmb.
 *
 * Until now only the Telegram feed followed an apkmb page to its file: a page
 * posted to the channel is a request for the build. A page pasted into "Add an
 * app" by an admin is the same request, made by hand, so it gets the same
 * fetch (`downloadApkmbBuild`) into the same drop folder, and the importer
 * decides where the file goes exactly as it does for a channel drop — by
 * package id and signer, parking it for review when it cannot tell.
 *
 * It runs in the background and is polled. A build is tens to hundreds of
 * megabytes, the importer ignores a file younger than its quiet period, and
 * the public hostname sits behind a proxy that gives up on a request after
 * about a hundred seconds; a request held open for all of that would be cut
 * off with the work still going on behind it.
 *
 * Jobs live in memory, keyed by the canonical page. A restart forgets them;
 * the file, if it landed, is still in the drop folder and the next scan
 * imports it.
 */
import { runImportScan } from "@/lib/import";
import { telegramConfig } from "@/lib/telegram";
import { DROP_DIR, downloadApkmbBuild, freeBytes } from "@/lib/link-download";
import { apkmbUrl } from "@/lib/sources/apkmb";

/** The importer's quiet period, plus a margin. See `QUIET_MS` in lib/import.ts. */
const SETTLE_MS = 62_000;
/** A finished job is kept this long for the panel to read, then dropped. */
const KEEP_MS = 60 * 60_000;

export type ApkmbBuildJob = {
  url: string;
  state: "downloading" | "settling" | "importing" | "done" | "failed";
  startedAt: string;
  file?: string;
  size?: number;
  /** Where the importer put it, once it has. */
  imported?: { app: string; version: string };
  /** Why the importer held it back instead. */
  parked?: string;
  /** Why the download or the scan failed. */
  error?: string;
  /** Addresses on the download page that were not the APK, and why. */
  tried: string[];
  finishedAt?: string;
};

const jobs = new Map<string, ApkmbBuildJob>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function forgetOld(): void {
  const cutoff = Date.now() - KEEP_MS;
  for (const [key, job] of jobs) {
    if (job.finishedAt && Date.parse(job.finishedAt) < cutoff) jobs.delete(key);
  }
}

export function apkmbBuildJob(input: string): ApkmbBuildJob | null {
  forgetOld();
  return jobs.get(apkmbUrl(input)) ?? null;
}

/**
 * Start fetching the build a page offers, or return the fetch already under
 * way for it — pressing the button twice must not download the file twice.
 * A finished job is replaced: asking again after a failure is a retry.
 */
export function startApkmbBuild(input: string): ApkmbBuildJob {
  forgetOld();
  const url = apkmbUrl(input);
  const running = jobs.get(url);
  if (running && !running.finishedAt) return running;

  const job: ApkmbBuildJob = {
    url,
    state: "downloading",
    startedAt: new Date().toISOString(),
    tried: [],
  };
  jobs.set(url, job);
  void run(job);
  return job;
}

async function run(job: ApkmbBuildJob): Promise<void> {
  const cfg = telegramConfig();
  try {
    if (freeBytes(DROP_DIR) < cfg.minFreeBytes) {
      throw new Error("not enough free disk space for the drop folder");
    }
    const got = await downloadApkmbBuild(job.url, {
      suffix: `apkmb${Date.now()}`,
      maxBytes: cfg.maxBytes,
      onFail: (link, why) => job.tried.push(`${link}: ${why}`),
    });
    job.file = got.name;
    job.size = got.size;
    console.log(`[apkmb] ${got.name} (${got.size} bytes) from ${job.url} -> import folder`);

    job.state = "settling";
    await sleep(SETTLE_MS);

    job.state = "importing";
    const summary = await runImportScan();
    const imported = summary.imported.find((i) => i.file === got.name);
    const parked = summary.parked.find((p) => p.file === got.name);
    const skipped = summary.skipped.find((s) => s.file === got.name);
    if (imported) job.imported = { app: imported.app, version: imported.version };
    else if (parked) job.parked = parked.reason;
    else if (skipped) job.parked = skipped.note;
    // Absent from all three: another scan — the feed's, or the Scan button —
    // took the file first. It went through the same importer either way.
    job.state = "done";
  } catch (err) {
    job.state = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    console.error(`[apkmb] build fetch failed for ${job.url}:`, job.error);
  } finally {
    job.finishedAt = new Date().toISOString();
  }
}
