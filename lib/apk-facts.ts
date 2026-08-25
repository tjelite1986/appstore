/**
 * The three things a signed index needs out of an APK's bytes.
 *
 * The v0 `index.xml` deliberately says nothing that requires opening a file
 * (see `lib/fdroid-index.ts`). `index-v1.json` cannot be that cheap: a client
 * checks the download against the index's SHA-256, keys versions on
 * `versionCode`, and refuses an APK whose signer is not the one the index
 * named. All three come from the file itself.
 *
 * Hashing the shelf is minutes of disk on this machine and the answer never
 * changes for a file that has not changed, so every read goes through a cache
 * keyed on the path plus the pair (size, mtime). That pair is the whole
 * invalidation: bytes cannot change without the size or the modification time
 * moving, and a rewritten file that somehow kept both would also have to be
 * the same length to the byte — at which point re-reading it would be the
 * only way to know, which is what a full re-hash of a 3 GB shelf costs.
 *
 * A file that cannot be read at all is not cached. That is on purpose: a
 * transient failure must not become a permanent wrong answer.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { readApkInfo } from "./apk-manifest";
import { computeSha256, extractSignerSha256 } from "./apk-verify";
import { db } from "./db";
import { STORE_ROOT } from "./storage";

export type ApkFacts = {
  sha256: string;
  /** Null when the manifest could not be read — the app is then left out. */
  versionCode: number | null;
  /** Null for an APK with no v2/v3 signing block. */
  signer: string | null;
};

type Row = {
  size: number;
  mtime: number;
  sha256: string;
  version_code: number | null;
  signer: string | null;
};

/** Rows are keyed on the library-relative path, so moving STORE_ROOT is free. */
function keyFor(abs: string): string {
  const rel = path.relative(STORE_ROOT, abs);
  return rel.startsWith("..") ? abs : rel;
}

/**
 * What is in this APK, from the cache when the file is unchanged.
 *
 * Null when the file could not be read. Callers treat that as "not on the
 * shelf" rather than as an empty entry — an index that named a file it could
 * not hash would send clients to a download it cannot verify.
 */
export async function apkFacts(abs: string): Promise<ApkFacts | null> {
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  const key = keyFor(abs);
  const size = stat.size;
  // Whole milliseconds: the column is an integer and sub-millisecond precision
  // is not carried across every filesystem this may sit on.
  const mtime = Math.floor(stat.mtimeMs);

  const conn = db();
  const row = conn
    .prepare(
      "SELECT size, mtime, sha256, version_code, signer FROM apk_facts WHERE path = ?"
    )
    .get(key) as Row | undefined;
  if (row && row.size === size && row.mtime === mtime) {
    return {
      sha256: row.sha256,
      versionCode: row.version_code,
      signer: row.signer,
    };
  }

  let sha256: string;
  try {
    sha256 = await computeSha256(abs);
  } catch {
    return null;
  }
  const { versionCode } = await readApkInfo(abs);
  const signer = extractSignerSha256(abs);

  conn
    .prepare(
      `INSERT INTO apk_facts (path, size, mtime, sha256, version_code, signer, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (path) DO UPDATE SET size         = excluded.size,
                                        mtime        = excluded.mtime,
                                        sha256       = excluded.sha256,
                                        version_code = excluded.version_code,
                                        signer       = excluded.signer,
                                        read_at      = excluded.read_at`
    )
    .run(key, size, mtime, sha256, versionCode, signer, new Date().toISOString());

  return { sha256, versionCode, signer };
}

/**
 * Rows for files that are gone.
 *
 * Nothing breaks without this — a stale row is only ever found by a path that
 * no longer exists — but the index build is the one caller that walks the
 * whole shelf, so it is also the one place that can tell.
 */
export function forgetApkFacts(keepKeys: Set<string>): number {
  const conn = db();
  const rows = conn.prepare("SELECT path FROM apk_facts").all() as {
    path: string;
  }[];
  const gone = rows.map((r) => r.path).filter((p) => !keepKeys.has(p));
  if (!gone.length) return 0;
  const drop = conn.prepare("DELETE FROM apk_facts WHERE path = ?");
  conn.transaction(() => gone.forEach((p) => drop.run(p)))();
  return gone.length;
}

/** The key `forgetApkFacts` compares against, for a path a caller resolved. */
export const apkFactsKey = keyFor;
