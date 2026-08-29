/**
 * The Telegram APK feed.
 *
 * A public channel posts `.apk` / `.xapk` files; this pulls the new ones into
 * `_import/` and then the importer takes over. There is no store logic here at
 * all — it is a downloader that feeds the drop folder, which is why it can be
 * this small.
 *
 * MTProto rather than the Bot API, and a *user* session rather than a bot:
 * `getFile` caps a bot at 20 MB and the channel posts 100-200 MB APKs. A user
 * session also reads any public channel without being an admin of it.
 *
 * Ported from elite-v2's `scripts/telegram-appstore-sync.mjs`. What changed is
 * the state: that one kept the cursor and the file ledger in two SQLite tables,
 * this one keeps them in `_state/telegram.json`, because the standalone store
 * has no database and this is the only thing that wanted one.
 *
 * Note that elite-v2 syncs the same channel on its own 15-minute job. The two
 * carry independent cursors, so both will download the same posts into their
 * own libraries — that is fine, and turning one of them off is a decision, not
 * a bug to fix here.
 */
import { promises as fs, statfsSync } from "node:fs";
import path from "node:path";
import { setMaxListeners } from "node:events";
import { createHash } from "node:crypto";
import { STORE_DIRS, STORE_ROOT } from "./storage";
import { runImportScan, type ImportSummary } from "./import";
import { readApkInfo } from "./apk-manifest";
import { BROWSER_USER_AGENT } from "./sources/net";
import { detectSource } from "./sources/detect";
import { apkmbUrl } from "./sources/apkmb";

const DROP_DIR = path.join(STORE_ROOT, STORE_DIRS.import);
const STATE_FILE = path.join(STORE_ROOT, STORE_DIRS.state, "telegram.json");

const APK_EXT = /\.(apk|xapk|apks|apkm)$/i;
/** Path separators and control characters — nothing else is touched. */
const UNSAFE_NAME = new RegExp("[/\\\\]|[\\u0000-\\u001f]", "g");

/**
 * The link path.
 *
 * The channel posts APKs two ways: as an attached document, and as a link to a
 * mirror. Only the first is a Telegram file — the second is an ordinary HTTP
 * download, and it has to prove what it is, because a landing page behind a
 * download button answers 200 just as happily as the file does.
 */
/** Telegram's own domains are navigation, never a download. */
const TELEGRAM_HOST = /(^|\.)(t\.me|telegram\.(me|org|dog))$/i;
/** Links followed per message. A channel post is not a link farm. */
const MAX_LINKS = 3;
/** A transfer that has not moved a byte for this long is abandoned. */
const LINK_IDLE_MS = 60_000;

/** Cross-run download tries per message before it is left alone. */
const MAX_ATTEMPTS = 3;
/** Tries within one run before the message is written off as failed. */
const DOWNLOAD_TRIES = 3;
/**
 * Telegram answers a download with two things that are not failures:
 *
 *   FILE_MIGRATE  the file lives in another data centre and the client has to
 *                 export authorisation for it first — the *normal* opening
 *                 move for a channel whose files sit in DC 2
 *   FLOOD_WAIT    "please wait N seconds", which is a schedule, not a refusal
 *
 * Both arrive as thrown errors, and counting them as attempts is how a healthy
 * transfer gets written off: two redirects and one flood wait spend a budget of
 * three before a byte moves. They get their own budget, and a flood wait is
 * honoured for the time it names.
 *
 * elite-v2 hid all of this — its ledger counted whole runs, so every download
 * there reads as one clean attempt.
 */
const TRANSIENT_TRIES = 8;
const IS_MIGRATE = /stored in DC (\d+)|FILE_MIGRATE_(\d+)/i;
const FLOOD_WAIT = /(?:wait|FLOOD_WAIT_)\s*(\d+)\s*(?:seconds?)?/i;

/** How long to wait and what to call it, or null for a real failure. */
function transient(err: unknown): { seconds: number; what: string } | null {
  const message = err instanceof Error ? err.message : String(err);
  const migrate = IS_MIGRATE.exec(message);
  if (migrate) {
    // Group 1 is the prose form ("stored in DC 5"), group 2 the code form.
    const dc = migrate[1] ?? migrate[2] ?? "?";
    return { seconds: 1, what: `data centre redirect (DC ${dc})` };
  }
  const flood = FLOOD_WAIT.exec(message);
  // A flood wait long enough to be a rate-limit ban is not worth sitting out
  // inside a request-triggered run; let it fail and be retried next run.
  if (flood && Number(flood[1]) <= 60) {
    return { seconds: Number(flood[1]) + 1, what: "rate limited" };
  }
  return null;
}
/** The importer ignores files younger than this — see `lib/import.ts`. */
const QUIET_MS = 60_000;
/** Ledger entries kept. Old ones only matter for deduplicating a repost. */
const LEDGER_CAP = 500;

function num(env: string, fallback: number): number {
  const v = Number(process.env[env]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function telegramConfig() {
  return {
    apiId: Number(process.env.TELEGRAM_API_ID),
    apiHash: process.env.TELEGRAM_API_HASH ?? "",
    session: process.env.TELEGRAM_SESSION ?? "",
    channels: (process.env.TELEGRAM_CHANNELS ?? "")
      .split(",")
      .map((c) => c.trim().replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, ""))
      .filter(Boolean),
    maxFiles: num("TELEGRAM_MAX_FILES_PER_RUN", 5),
    maxBytes: num("TELEGRAM_MAX_FILE_MB", 2048) * 1024 * 1024,
    scanLimit: num("TELEGRAM_SCAN_LIMIT", 100),
    initialLimit: num("TELEGRAM_INITIAL_LIMIT", 20),
    minFreeBytes: num("TELEGRAM_MIN_FREE_GB", 5) * 1024 * 1024 * 1024,
  };
}

export function telegramConfigured(): boolean {
  const c = telegramConfig();
  return !!(c.apiId && c.apiHash && c.session && c.channels.length > 0);
}

/* ------------------------------------------------------------------- state */

type ChannelState = {
  /** Highest message id already considered. 0 means never synced. */
  cursor: number;
  lastSyncedAt?: string;
  lastStatus?: string;
};

type LedgerEntry = {
  channel: string;
  messageId: number;
  documentId: string;
  fileName: string;
  fileSize: number;
  status: "downloaded" | "skipped" | "failed";
  note?: string | null;
  attempts: number;
  at: string;
  /**
   * When somebody answered this row's offered page — filled from it, or said
   * it describes nothing here.
   *
   * Only the answer is stored. Whether a rejected link is worth offering at
   * all is decided by reading it (see `listCandidates`), which means the rows
   * already in the ledger when this arrived are offered too, and a change to
   * what counts as a readable page needs no migration.
   */
  candidateAnsweredAt?: string;
};

export type TelegramRun = {
  running: boolean;
  startedAt?: string;
  finishedAt?: string;
  downloaded: number;
  /** What the run did, in order — the whole reason a UI is useful here. */
  log: string[];
  /** The importer's own summary, when the run went on to trigger a scan. */
  imported?: ImportSummary;
};

export type TelegramState = {
  channels: Record<string, ChannelState>;
  /** Keyed "<channel>#<messageId>". */
  ledger: Record<string, LedgerEntry>;
  /**
   * Which data centre a document really lives in, keyed by document id.
   *
   * Learned once and kept, because it is a property of the file rather than of
   * the run — see `resolveDc()`.
   */
  dcById: Record<string, number>;
  run: TelegramRun;
};

const EMPTY_STATE: TelegramState = {
  channels: {},
  ledger: {},
  dcById: {},
  run: { running: false, downloaded: 0, log: [] },
};

export async function readState(): Promise<TelegramState> {
  try {
    const parsed = JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
    return { ...structuredClone(EMPTY_STATE), ...parsed };
  } catch {
    return structuredClone(EMPTY_STATE);
  }
}

/**
 * Write through a temp file and rename.
 *
 * The state is read by the page while a run is writing it, and a partially
 * written JSON file reads as no state at all — which would reset every cursor
 * and re-download the channel from scratch.
 */
async function writeOnce(state: TelegramState): Promise<void> {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });

  const entries = Object.entries(state.ledger);
  if (entries.length > LEDGER_CAP) {
    entries.sort((a, b) => (b[1].at ?? "").localeCompare(a[1].at ?? ""));
    state = { ...state, ledger: Object.fromEntries(entries.slice(0, LEDGER_CAP)) };
  }

  // Its own temp name, so that two writes in flight cannot rename the same
  // file — see `writeState()`.
  const tmp = `${STATE_FILE}.${process.pid}.${writeSeq++}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
    await fs.rename(tmp, STATE_FILE);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

let writeQueue: Promise<void> = Promise.resolve();
let writeSeq = 0;

/**
 * One writer at a time.
 *
 * The log flush in `say()` runs unawaited beside the ledger write at the end
 * of a download, and both used one temp file name: the second rename found
 * nothing there, and that ENOENT ended a run mid-channel with three healthy
 * downloads already behind it. Queueing them also means the file always holds
 * a whole snapshot rather than whichever writer happened to land last.
 */
function writeState(state: TelegramState): Promise<void> {
  writeQueue = writeQueue.then(
    () => writeOnce(state),
    () => writeOnce(state)
  );
  return writeQueue;
}

/* -------------------------------------------------------------- candidates */

/** One offered page, as the panel deals with it. */
export type TelegramCandidate = {
  kind: "apkmb";
  url: string;
  channel: string;
  messageId: number;
  /** Why the download stopped — "not an APK (4213 bytes, text/html)". */
  note: string | null;
  at: string;
};

/**
 * The address of the page a refused link points at, or null for a link that
 * describes nothing.
 *
 * Only an apkmb product page qualifies. `detectSource` names that kind from an
 * explicit pattern and falls through to a guess of "play" for anything it does
 * not recognise, so asking for `apkmb` by name is what keeps a CDN link, a
 * t.me address and apkmb's own front page out.
 *
 * The answer is canonical, because the ledger is not: one channel posted the
 * same page twice, once with its trailing slash and once without, and two rows
 * for one page would be offered twice and dismissed one at a time.
 */
function listingUrl(url: string): string | null {
  if (detectSource(url).kind !== "apkmb") return null;
  try {
    return apkmbUrl(url);
  } catch {
    return null;
  }
}

function readableAsListing(url: string): boolean {
  return listingUrl(url) !== null;
}

/**
 * The pages waiting to be looked at, worked out from the ledger.
 *
 * Derived rather than stored, so that the links already written off before
 * this existed are offered too — a `skipped` verdict is permanent by design,
 * and those rows would otherwise never come back. Only `skipped` counts: a
 * `failed` row still has tries left, and a `downloaded` one was an APK.
 *
 * Keyed by URL rather than by ledger row: the same mirror posted in two
 * channels is two rows and one page, and offering it twice would mean
 * dismissing it twice. Newest first, because an old link is one already
 * passed over.
 */
export async function listCandidates(): Promise<TelegramCandidate[]> {
  const { ledger } = await readState();
  const byUrl = new Map<string, TelegramCandidate>();

  for (const entry of Object.values(ledger)) {
    if (entry.status !== "skipped" || entry.candidateAnsweredAt) continue;
    const url = listingUrl(entry.documentId);
    if (!url) continue;

    const seen = byUrl.get(url);
    if (seen && seen.at >= entry.at) continue;
    byUrl.set(url, {
      kind: "apkmb",
      url,
      channel: entry.channel,
      messageId: entry.messageId,
      note: entry.note ?? null,
      at: entry.at,
    });
  }

  return [...byUrl.values()].sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Answer a candidate — filled, or refused — so it stops being offered.
 *
 * Every row pointing at that page is answered, not just the one the panel
 * rendered — matched on the canonical address, so the same slug posted with
 * and without its trailing slash is one answer. A "no" that let the twin come
 * back on the next sync would be no answer at all. The ledger entry itself stays, so the link is not fetched
 * again either.
 */
export async function clearCandidate(url: string): Promise<boolean> {
  const state = await readState();
  const at = new Date().toISOString();
  const target = listingUrl(url) ?? url;
  let hit = false;

  for (const entry of Object.values(state.ledger)) {
    const entryUrl = listingUrl(entry.documentId) ?? entry.documentId;
    if (entryUrl === target && !entry.candidateAnsweredAt) {
      entry.candidateAnsweredAt = at;
      hit = true;
    }
  }
  if (hit) await writeState(state);
  return hit;
}

/* --------------------------------------------------------------------- run */

const mb = (bytes: number) => (bytes / 1048576).toFixed(1);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function freeBytes(dir: string): number {
  try {
    const st = statfsSync(dir);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * The rest of the upload name — version, mod-site credit — is exactly what the
 * import parser reads, so only what could escape the directory is removed.
 */
function safeName(name: string): string {
  return name.replace(UNSAFE_NAME, "_").trim();
}

function msgOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A verdict, not a failure: these bytes are not an APK, so retrying is pointless. */
class NotAnApk extends Error {}

/**
 * Every URL a message offers, in the order Telegram gives them.
 *
 * The link is usually not in the visible text: `MessageEntityTextUrl` hides it
 * behind a clickable label, and a message can carry it only in the web-page
 * preview. Entity offsets are UTF-16 code units, which is what a JavaScript
 * string index already is, so they index the text directly.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function messageUrls(message: any): string[] {
  const text: string = typeof message?.message === "string" ? message.message : "";
  const found: string[] = [];

  for (const e of message?.entities ?? []) {
    if (e?.className === "MessageEntityTextUrl" && e.url) found.push(String(e.url));
    else if (e?.className === "MessageEntityUrl") {
      found.push(text.slice(e.offset, e.offset + e.length));
    }
  }
  // Forwards and edits reach us with the entities stripped; the text survives.
  if (!found.length) {
    for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) found.push(m[0]);
  }
  const preview = message?.media?.webpage?.url;
  if (preview) found.push(String(preview));

  const out: string[] = [];
  for (const raw of found) {
    // Prose punctuation clings to the end of a bare URL.
    const trimmed = raw.trim().replace(/[)\].,;:!?]+$/, "");
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (TELEGRAM_HOST.test(url.hostname)) continue;
    if (!out.includes(url.href)) out.push(url.href);
  }
  return out;
}

/**
 * What to call a fetched file.
 *
 * The import parser reads the name for the app's name and version, so the
 * server's own name is kept whenever it gives one. A name is invented only
 * when there is nothing to keep — and it must carry an APK extension, because
 * the importer skips every file that does not.
 */
function linkFileName(
  requested: string,
  finalUrl: string,
  disposition: string,
  info: { packageName: string | null; versionName: string | null }
): string {
  const star = /filename\*=\s*(?:UTF-8'')?([^;]+)/i.exec(disposition);
  const plain = /filename=\s*"?([^";]+)"?/i.exec(disposition);
  const fallback = (plain?.[1] ?? "").trim().replace(/^"|"$/g, "");
  let name = fallback;
  if (star) {
    try {
      name = decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      name = fallback;
    }
  }
  if (!name) {
    try {
      name = decodeURIComponent(path.basename(new URL(finalUrl || requested).pathname));
    } catch {
      name = "";
    }
  }
  if (APK_EXT.test(name)) return name;
  const stem = name.replace(/\.[a-z0-9]{1,5}$/i, "").trim() || info.packageName || "telegram-link";
  return `${stem}${info.versionName ? `_v${info.versionName}` : ""}.apk`;
}

// A run outlives the request that started it, so the promise is the lock: a
// second trigger returns the run in flight instead of racing it.
let inFlight: Promise<void> | null = null;

export function syncRunning(): boolean {
  return inFlight !== null;
}

/**
 * The run, with a killed process accounted for.
 *
 * `running: true` is written to the state file for the duration of a run, and
 * a restart in the middle of one leaves it there with nobody to clear it. One
 * process serves this app, so the in-process flag is the truth: a persisted
 * run that nothing is running is over, and saying so beats a Sync button
 * disabled forever.
 */
export async function readRun(): Promise<TelegramRun> {
  const { run } = await readState();
  if (run.running && !syncRunning()) {
    return {
      ...run,
      running: false,
      log: [...run.log, "interrupted — the server restarted mid-run"],
    };
  }
  return run;
}

/**
 * Start a sync, or do nothing if one is already going.
 *
 * Returns as soon as the run has started. A 200 MB download takes minutes and
 * the caller is an HTTP request — progress is read back from the state file.
 */
export function startTelegramSync(): { started: boolean } {
  if (inFlight) return { started: false };
  inFlight = run().finally(() => {
    inFlight = null;
  });
  // Nothing awaits this, and run() records its own failures in the state file —
  // but an unobserved rejection would still take the process down.
  void inFlight.catch(() => {});
  return { started: true };
}

async function run(): Promise<void> {
  // One abort listener per download chunk worker trips the default cap of 10
  // and prints a bogus leak warning; a 200 MB file uses dozens.
  setMaxListeners(200);

  const cfg = telegramConfig();
  const state = await readState();
  const log: string[] = [];

  // The log is the only thing to look at during a run, and a 200 MB transfer
  // writes no state of its own for minutes — so every line is persisted, at
  // most one write every couple of seconds so a chatty retry loop does not
  // turn into a write loop.
  let lastFlush = 0;
  let flushing: Promise<void> | null = null;
  const say = (msg: string) => {
    log.push(`${new Date().toISOString()} ${msg}`);
    console.log(`[telegram] ${msg}`);
    if (!flushing && Date.now() - lastFlush > 2000) {
      lastFlush = Date.now();
      flushing = writeState(state).catch(() => {}).finally(() => {
        flushing = null;
      });
    }
  };

  state.run = {
    running: true,
    startedAt: new Date().toISOString(),
    downloaded: 0,
    log,
  };
  await writeState(state);

  // A run killed mid-transfer leaves its hidden .part file behind. The
  // importer ignores dotfiles, so nothing else would ever clear them and the
  // drop folder would fill with half-downloads.
  for (const file of await fs.readdir(DROP_DIR).catch(() => [] as string[])) {
    if (file.startsWith(".") && file.endsWith(".part")) {
      await fs.rm(path.join(DROP_DIR, file), { force: true });
      say(`cleared an interrupted download: ${file}`);
    }
  }

  const finish = async (extra?: Partial<TelegramRun>) => {
    state.run = {
      ...state.run,
      ...extra,
      running: false,
      finishedAt: new Date().toISOString(),
      log,
    };
    await writeState(state);
  };

  if (!telegramConfigured()) {
    say("TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION not set — nothing to do");
    return finish();
  }

  // Loaded here, not at module scope: it is a large MTProto stack and every
  // other route in the app would pay for it on a cold start.
  const { TelegramClient, Api } = await import("teleproto");
  const { StringSession } = await import("teleproto/sessions/index.js");
  const bigInt = (await import("big-integer")).default;

  const client = new TelegramClient(
    new StringSession(cfg.session),
    cfg.apiId,
    cfg.apiHash,
    { connectionRetries: 3 }
  );

  let downloaded = 0;
  let linkSeq = 0;

  /** The real upload filename, off the document's attributes. */
  /* eslint-disable @typescript-eslint/no-explicit-any */
  function documentInfo(message: any) {
    const doc = message?.media?.document;
    if (!doc || doc.className !== "Document") return null;
    const nameAttr = (doc.attributes || []).find(
      (a: any) => a.className === "DocumentAttributeFilename"
    );
    if (!nameAttr?.fileName) return null;
    return {
      doc,
      documentId: String(doc.id),
      fileName: nameAttr.fileName as string,
      fileSize: Number(doc.size),
      /** What the *message* claims. `resolveDc()` is the one that knows. */
      homeDc: Number(doc.dcId) || 0,
    };
  }

  /* ------------------------------------------------------- data centres --- */

  /**
   * The location a download reads from, built by hand.
   *
   * `downloadMedia()` builds this itself and takes no `dcId`, and pinning the
   * data centre is the whole point below — so the document is unwrapped here
   * and `downloadFile()` is called directly instead.
   */
  function fileLocation(doc: any) {
    return new Api.InputDocumentFileLocation({
      id: doc.id,
      accessHash: doc.accessHash,
      fileReference: doc.fileReference,
      thumbSize: "",
    });
  }

  /** The data centre a FILE_MIGRATE points at, or null if that is not the error. */
  function migratedDc(err: unknown): number | null {
    const newDc = (err as any)?.newDc;
    if (typeof newDc === "number" && newDc > 0) return newDc;
    const m = IS_MIGRATE.exec(msgOf(err));
    const dc = Number(m?.[1] ?? m?.[2]);
    return Number.isFinite(dc) && dc > 0 ? dc : null;
  }

  /**
   * Where the file actually is, asked once.
   *
   * The document carries a `dcId` and for some of these files it is not where
   * the bytes are: the server answers FILE_MIGRATE. teleproto recovers from
   * that *within a single chunk request* and then throws the answer away — the
   * transfer keeps starting every chunk at the wrong data centre, so a 100 MB
   * file pays the redirect a couple of hundred times, re-exports authorisation
   * for the right one over and over, and any chunk that spends its five
   * internal retries on redirects fails the whole download, which then restarts
   * from zero. That is what wrote off Plague-Inc twice at 11-14 MB in.
   *
   * So: one 4 KB read up front asks the question once, and the answer is
   * pinned for the whole transfer and remembered in the state file, where a
   * later run — or a repost of the same document — picks it up for free.
   */
  async function resolveDc(info: { doc: any; documentId: string; homeDc: number }): Promise<number> {
    const known = state.dcById[info.documentId];
    if (known) return known;

    const home = info.homeDc || client.session.dcId;
    let dc = home;
    try {
      await client.invoke(
        new Api.upload.GetFile({
          location: fileLocation(info.doc),
          offset: bigInt.zero,
          limit: 4096,
          precise: true,
        }),
        home
      );
    } catch (err) {
      const moved = migratedDc(err);
      // Anything else — a flood wait, a dead reference — is the download's
      // problem to report, not the probe's. It falls back to the home DC.
      if (moved) dc = moved;
    }

    state.dcById[info.documentId] = dc;
    if (dc !== home) say(`  ${info.documentId}: file lives in DC ${dc}, not DC ${home}`);
    return dc;
  }

  /** A free name in the drop folder — a repost must not overwrite the first copy. */
  async function claimName(raw: string, messageId: number): Promise<string> {
    const fileName = safeName(raw);
    const taken = await fs
      .stat(path.join(DROP_DIR, fileName))
      .then(() => true, () => false);
    if (!taken) return fileName;
    const ext = path.extname(fileName);
    return `${path.basename(fileName, ext)}-tg${messageId}${ext}`;
  }

  /**
   * Fetch an APK that was posted as a link.
   *
   * None of the MTProto machinery applies here — no data centre, no chunking,
   * no file reference — but one thing has to replace all of it: the response
   * must prove it is an APK. `content-type` is the server's claim about itself,
   * and a login wall or a "click here to download" page answers 200 with HTML,
   * so the bytes are handed to the same manifest reader the importer uses. No
   * package name, no file.
   */
  async function downloadLink(
    url: string,
    messageId: number
  ): Promise<{ name: string; size: number }> {
    await fs.mkdir(DROP_DIR, { recursive: true });
    const tmp = path.join(DROP_DIR, `.link-${messageId}-${linkSeq++}.part`);

    // An idle timer rather than a deadline: a 200 MB file over a slow mirror is
    // not a hung transfer, but one that has stopped sending is.
    const ctl = new AbortController();
    let idle = setTimeout(() => ctl.abort(), LINK_IDLE_MS);
    const bump = () => {
      clearTimeout(idle);
      idle = setTimeout(() => ctl.abort(), LINK_IDLE_MS);
    };

    try {
      const res = await fetch(url, {
        redirect: "follow",
        headers: { "user-agent": BROWSER_USER_AGENT, accept: "*/*" },
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
      if (!res.body) throw new NotAnApk("empty response");

      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > cfg.maxBytes) {
        throw new NotAnApk(`over size cap (${mb(declared)} MB)`);
      }

      let written = 0;
      const handle = await fs.open(tmp, "w");
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          bump();
          written += chunk.byteLength;
          // The cap again, on the bytes: a server may declare no length at all.
          if (written > cfg.maxBytes) {
            throw new NotAnApk(`over size cap (>${mb(cfg.maxBytes)} MB)`);
          }
          await handle.write(chunk);
        }
      } finally {
        await handle.close();
      }

      const info = await readApkInfo(tmp);
      if (!info.packageName) {
        const type = res.headers.get("content-type") || "no content-type";
        throw new NotAnApk(`not an APK (${written} bytes, ${type})`);
      }

      const fileName = await claimName(
        linkFileName(url, res.url, res.headers.get("content-disposition") ?? "", info),
        messageId
      );
      await fs.rename(tmp, path.join(DROP_DIR, fileName));
      return { name: fileName, size: written };
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    } finally {
      clearTimeout(idle);
    }
  }

  /**
   * Download to a hidden `.part` file, then rename into place.
   *
   * The importer must never see a half-written APK, and a rename within one
   * directory is atomic. A dropped sender slot mid-transfer is documented as a
   * retry signal, not a dead file.
   */
  async function download(
    message: any,
    info: { doc: any; documentId: string; homeDc: number; fileName: string; fileSize: number }
  ): Promise<string> {
    await fs.mkdir(DROP_DIR, { recursive: true });
    const fileName = await claimName(info.fileName, message.id);
    const partPath = path.join(DROP_DIR, `.${fileName}.part`);

    // Pinned for the whole transfer: every chunk starts at the right data
    // centre instead of rediscovering the redirect one chunk at a time.
    let dc = await resolveDc(info);

    let lastError: unknown;
    let attempt = 0;
    let waits = 0;
    while (attempt < DOWNLOAD_TRIES && waits < TRANSIENT_TRIES) {
      try {
        await client.downloadFile(fileLocation(info.doc), {
          outputFile: partPath,
          fileSize: info.doc.size,
          dcId: dc,
        });
        const size = (await fs.stat(partPath)).size;
        if (size !== info.fileSize) {
          throw new Error(`size mismatch: got ${size}, expected ${info.fileSize}`);
        }
        await fs.rename(partPath, path.join(DROP_DIR, fileName));
        return fileName;
      } catch (err) {
        lastError = err;
        await fs.rm(partPath, { force: true });

        // A redirect the probe did not see. Take the answer, keep it, and go
        // again pinned there — the transfer restarts, but only this once.
        const moved = migratedDc(err);
        if (moved && moved !== dc) {
          dc = moved;
          state.dcById[info.documentId] = moved;
          waits += 1;
          say(
            `  ${fileName}: redirected to DC ${moved} mid-transfer, retrying pinned there ` +
              `(${waits}/${TRANSIENT_TRIES}, not counted as a try)`
          );
          continue;
        }

        const wait = transient(err);
        if (wait) {
          waits += 1;
          say(
            `  ${fileName}: ${wait.what}, waiting ${wait.seconds}s ` +
              `(${waits}/${TRANSIENT_TRIES}, not counted as a try)`
          );
          await sleep(wait.seconds * 1000);
          continue;
        }

        attempt += 1;
        if (attempt < DOWNLOAD_TRIES) {
          say(`  ${fileName}: ${msgOf(err)} — retry ${attempt + 1}/${DOWNLOAD_TRIES}`);
          await sleep(3000 * attempt);
        }
      }
    }
    throw lastError;
  }

  /**
   * The links in one message, tried in order.
   *
   * The ledger dedups on `documentId`, and a link has none — so the URL takes
   * that slot and becomes the identity. The same mirror posted twice, in one
   * channel or in two, is fetched once.
   */
  async function processLinks(channel: string, message: any): Promise<string> {
    const urls = messageUrls(message).slice(0, MAX_LINKS);
    if (!urls.length) return "ignored";

    let handled = false;
    for (const url of urls) {
      if (downloaded >= cfg.maxFiles) break;

      const key = `${channel}#${message.id}#${createHash("sha1").update(url).digest("hex").slice(0, 8)}`;
      const previous = state.ledger[key];
      // Anything but a failure is a verdict already reached, and a failure that
      // has spent its tries is one too.
      if (previous && (previous.status !== "failed" || previous.attempts >= MAX_ATTEMPTS)) {
        handled = true;
        continue;
      }

      const entry: LedgerEntry = {
        channel,
        messageId: message.id,
        documentId: url,
        fileName: url,
        fileSize: 0,
        status: "skipped",
        note: null,
        attempts: previous?.attempts ?? 0,
        at: new Date().toISOString(),
      };

      const already = Object.values(state.ledger).some(
        (e) => e.documentId === url && e.status === "downloaded"
      );
      if (already) {
        entry.note = "duplicate link";
        state.ledger[key] = entry;
        say(`${key}: ${url} — already downloaded, skipped`);
        handled = true;
        continue;
      }

      // The size is unknown until the response arrives, so this only asks
      // whether there is room to start at all.
      if (freeBytes(DROP_DIR) < cfg.minFreeBytes) {
        say(`${channel}: not enough free disk space — stopping`);
        return "nospace";
      }

      entry.attempts += 1;
      try {
        const got = await downloadLink(url, message.id);
        entry.status = "downloaded";
        entry.fileName = got.name;
        entry.fileSize = got.size;
        entry.note = got.name;
        downloaded += 1;
        say(`${key}: ${got.name} (${mb(got.size)} MB) from ${url} -> import folder`);
      } catch (err) {
        entry.status = err instanceof NotAnApk ? "skipped" : "failed";
        entry.note = msgOf(err).slice(0, 300);
        // Not an APK, but possibly an address a source can read. Nothing is
        // recorded for that here: the ledger already holds the URL, and the
        // offer is worked out from it on read.
        const offered = entry.status === "skipped" && readableAsListing(url);
        say(
          entry.status === "skipped"
            ? `${key}: ${url} — ${entry.note}, skipped${offered ? " (offered as a listing)" : ""}`
            : `${key}: ${url} FAILED (try ${entry.attempts}/${MAX_ATTEMPTS}) — ${entry.note}`
        );
      }
      state.ledger[key] = entry;
      state.run.downloaded = downloaded;
      await writeState(state);
      handled = true;
    }
    return handled ? "handled" : "ignored";
  }

  /** "handled" | "ignored" | "nospace" */
  async function processMessage(channel: string, message: any): Promise<string> {
    const info = documentInfo(message);
    // No attached APK is not the end of it: the same channels post mirrors as
    // links, and those messages carry no document at all.
    if (!info || !APK_EXT.test(info.fileName)) return processLinks(channel, message);

    const key = `${channel}#${message.id}`;
    const previous = state.ledger[key];
    const entry: LedgerEntry = {
      channel,
      messageId: message.id,
      documentId: info.documentId,
      fileName: info.fileName,
      fileSize: info.fileSize,
      status: "skipped",
      note: null,
      attempts: previous?.attempts ?? 0,
      at: new Date().toISOString(),
    };

    // The same file reposted under a new message id.
    const already = Object.values(state.ledger).some(
      (e) => e.documentId === info.documentId && e.status === "downloaded"
    );
    if (already) {
      entry.note = "duplicate document";
      state.ledger[key] = entry;
      say(`${key}: ${info.fileName} — already downloaded, skipped`);
      return "handled";
    }

    if (info.fileSize > cfg.maxBytes) {
      entry.note = `over size cap (${mb(info.fileSize)} MB)`;
      state.ledger[key] = entry;
      say(`${key}: ${info.fileName} — ${entry.note}, skipped`);
      return "handled";
    }

    if (freeBytes(DROP_DIR) - info.fileSize < cfg.minFreeBytes) {
      // The ledger is left untouched so the file is picked up once there is room.
      say(`${channel}: not enough free disk space — stopping`);
      return "nospace";
    }

    entry.attempts += 1;
    try {
      const name = await download(message, info);
      entry.status = "downloaded";
      entry.note = name;
      downloaded += 1;
      say(`${key}: ${name} (${mb(info.fileSize)} MB) -> import folder`);
    } catch (err) {
      entry.status = "failed";
      entry.note = msgOf(err).slice(0, 300);
      say(
        `${key}: ${info.fileName} FAILED (try ${entry.attempts}/${MAX_ATTEMPTS}) — ${entry.note}`
      );
    }
    state.ledger[key] = entry;
    state.run.downloaded = downloaded;
    await writeState(state);
    return "handled";
  }

  async function syncChannel(channel: string): Promise<void> {
    const chan: ChannelState = state.channels[channel] ?? { cursor: 0 };
    state.channels[channel] = chan;
    const entity = await client.getEntity(channel);

    // Earlier failures first: the cursor has already moved past them, so
    // nothing but this list would ever pick them up again.
    // Several links in one message get a ledger row each, but there is only one
    // message to fetch back — hence the Set.
    const retryIds = [
      ...new Set(
        Object.values(state.ledger)
          .filter(
            (e) =>
              e.channel === channel && e.status === "failed" && e.attempts < MAX_ATTEMPTS
          )
          .sort((a, b) => a.messageId - b.messageId)
          .map((e) => e.messageId)
      ),
    ].slice(0, 20);
    if (retryIds.length) {
      say(`${channel}: retrying ${retryIds.length} earlier failure(s)`);
      for (const message of await client.getMessages(entity, { ids: retryIds })) {
        if (!message) continue;
        if (downloaded >= cfg.maxFiles) break;
        if ((await processMessage(channel, message)) === "nospace") return;
      }
    }

    const firstSync = chan.cursor === 0;
    // A channel's full history is not worth backfilling; after the first sync
    // the cursor drives it, oldest-first so a run cut short by the file cap
    // resumes where it stopped.
    const messages = firstSync
      ? await client.getMessages(entity, { limit: cfg.initialLimit })
      : await client.getMessages(entity, {
          limit: cfg.scanLimit,
          minId: chan.cursor,
          reverse: true,
        });

    const ordered = [...messages].sort((a: any, b: any) => a.id - b.id);
    say(
      `${channel}: ${ordered.length} message(s) to consider` +
        (firstSync ? " (first sync)" : ` after id ${chan.cursor}`)
    );

    let cursor = chan.cursor;
    for (const message of ordered) {
      if (downloaded >= cfg.maxFiles) {
        say(`${channel}: run cap of ${cfg.maxFiles} file(s) reached — resuming next run`);
        break;
      }
      if (!state.ledger[`${channel}#${message.id}`]) {
        if ((await processMessage(channel, message)) === "nospace") break;
      }
      cursor = message.id;
    }

    chan.cursor = Math.max(cursor, chan.cursor);
    chan.lastSyncedAt = new Date().toISOString();
    chan.lastStatus = "ok";
    await writeState(state);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  try {
    await client.connect();
    if (!(await client.isUserAuthorized())) {
      say("TELEGRAM_SESSION is not authorized — run scripts/telegram-login.mjs");
      return finish();
    }
    for (const channel of cfg.channels) {
      try {
        await syncChannel(channel);
      } catch (err) {
        const chan = state.channels[channel] ?? { cursor: 0 };
        chan.lastStatus = `error: ${msgOf(err)}`.slice(0, 200);
        chan.lastSyncedAt = new Date().toISOString();
        state.channels[channel] = chan;
        say(`${channel}: sync failed — ${msgOf(err)}`);
      }
    }
    say(`done: ${downloaded} file(s) downloaded`);

    // Hand over to the importer. It ignores anything younger than 60 s — a
    // Samba drop appears at its first byte — so the run waits that out rather
    // than leaving the files for whoever presses Scan next.
    if (downloaded > 0) {
      say(`waiting ${QUIET_MS / 1000}s for the importer's quiet period`);
      await sleep(QUIET_MS + 2_000);
      const summary = await runImportScan();
      say(
        `import: ${summary.imported.length} attached, ${summary.parked.length} held for review`
      );
      return finish({ imported: summary });
    }
    return finish();
  } catch (err) {
    say(`sync failed — ${msgOf(err)}`);
    return finish();
  } finally {
    await client.disconnect().catch(() => {});
  }
}
