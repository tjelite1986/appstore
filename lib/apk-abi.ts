/**
 * Which ABIs a file on the shelf carries, and which of several files a phone
 * should be handed.
 *
 * A version directory used to hold exactly one binary. It now holds one per
 * build: an app published as separate arm64 and arm32 APKs is the same version
 * twice, and both belong on the shelf — the alternative was the importer
 * throwing one of them away (see `attachApk`).
 *
 * The ABI is read from the APK's own `lib/<abi>/` entries, never from its file
 * name. A file called `__arm8` is a claim by whoever renamed it; the entries
 * are what Android itself will look at. Split bundles carry their ABIs in
 * `config.<abi>.apk` members instead, which is the same kind of fact — the
 * zip's structure, not a label on the outside.
 *
 * Reading costs the zip's central directory, tens of milliseconds on a cold
 * file here, so the answer is cached on (path, size, mtime) exactly the way
 * `lib/apk-facts.ts` caches the expensive half. The catalog is rendered per
 * request; it cannot open a hundred APKs to do it.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { readApkAbis } from "./apk-manifest";
import { db } from "./db";
import { STORE_ROOT } from "./storage";

/** Rows are keyed on the library-relative path, so moving STORE_ROOT is free. */
function keyFor(abs: string): string {
  const rel = path.relative(STORE_ROOT, abs);
  return rel.startsWith("..") ? abs : rel;
}

type Row = { size: number; mtime: number; abis: string };

/**
 * The ABIs in this APK, from the cache when the file is unchanged.
 *
 * An empty list means "no native code", which is a positive answer: such an
 * app installs on every phone. An unreadable file gives the same empty list —
 * it is not cached, so a transient failure does not become a stuck answer, and
 * a file nobody can open has bigger problems than its ABI.
 */
export async function apkAbis(abs: string): Promise<string[]> {
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return [];
  }
  if (!stat.isFile()) return [];

  const key = keyFor(abs);
  const size = stat.size;
  const mtime = Math.floor(stat.mtimeMs);

  // The cache is an optimisation, not the source. Every caller here is a
  // catalog read, and a catalog that could not be rendered because the state
  // database was unreachable would be a page of nothing — so a database that
  // will not open costs the read its speed and nothing else.
  try {
    const conn = db();
    const row = conn
      .prepare("SELECT size, mtime, abis FROM apk_abis WHERE path = ?")
      .get(key) as Row | undefined;
    if (row && row.size === size && row.mtime === mtime) {
      return row.abis ? row.abis.split(",") : [];
    }

    const abis = readApkAbis(abs);
    conn
      .prepare(
        `INSERT INTO apk_abis (path, size, mtime, abis, read_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET size    = excluded.size,
                                          mtime   = excluded.mtime,
                                          abis    = excluded.abis,
                                          read_at = excluded.read_at`
      )
      .run(key, size, mtime, abis.join(","), new Date().toISOString());

    return abis;
  } catch {
    return readApkAbis(abs);
  }
}

/**
 * Rows for files that are gone — the same sweep `forgetApkFacts` does, run
 * from the same job, because it is the one caller that walks the whole shelf.
 */
export function forgetApkAbis(keepKeys: Set<string>): number {
  const conn = db();
  const rows = conn.prepare("SELECT path FROM apk_abis").all() as {
    path: string;
  }[];
  const gone = rows.map((r) => r.path).filter((p) => !keepKeys.has(p));
  if (!gone.length) return 0;
  const drop = conn.prepare("DELETE FROM apk_abis WHERE path = ?");
  conn.transaction(() => gone.forEach((p) => drop.run(p)))();
  return gone.length;
}

/** The key `forgetApkAbis` compares against, for a path a caller resolved. */
export const apkAbisKey = keyFor;

/**
 * What to call this build on a button.
 *
 * "universal" for a file with no native code and for one carrying every ABI
 * the others in its version carry — both install anywhere, and a person
 * choosing between downloads cares about that, not about the list. Anything
 * else is named by its ABIs, because there is no shorter true label: an APK
 * with only `armeabi-v7a` will refuse to install on a phone that has no arm32
 * support, and the name is the only warning it gets.
 */
export function abiLabel(abis: string[]): string {
  if (!abis.length) return "universal";
  if (abis.length > 1) return "universal";
  return abis[0];
}

/** Shorter than the ABI name and still unambiguous, for a narrow button. */
export function abiShortLabel(abis: string[]): string {
  if (abis.length !== 1) return "universal";
  switch (abis[0]) {
    case "arm64-v8a":
      return "arm64";
    case "armeabi-v7a":
      return "arm32";
    default:
      return abis[0];
  }
}

/**
 * How good a default this build is, higher first.
 *
 * Every phone this store is used from is arm64, and a 32-bit-only APK on one
 * of them fails at install time with a message that says nothing useful. So an
 * arm64 build wins, a build with no native code — which runs anywhere — comes
 * next, and an arm32-only file is last: it is on the shelf to be chosen
 * deliberately, not to be handed to someone who pressed Install.
 */
export function abiRank(abis: string[]): number {
  if (abis.includes("arm64-v8a")) return 3;
  if (!abis.length) return 2;
  if (abis.includes("x86_64") || abis.includes("x86")) return 0;
  return 1;
}

/** A stable identity for "the same build" across versions of one app. */
export function abiKey(abis: string[]): string {
  return abis.length ? abis.join(",") : "universal";
}
