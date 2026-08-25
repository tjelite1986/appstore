/**
 * The one database in an app whose library is a directory tree.
 *
 * Everything a *person* can see about an app — its name, its versions, its
 * artwork — is a file, and that is deliberate: the library survives this app
 * and can be inspected with `ls`. What a person *did* is not like that. Saving
 * an app and marking one installed are per-account facts with no natural file
 * to live in, they are written far more often than the catalog changes, and
 * two tabs can write them at the same moment. That is a database's job, so
 * this is where it lives: the tables keyed on the elite-v2 account id.
 *
 * One table here is neither content nor a person's doing — `apk_facts` caches
 * what reading an APK's bytes costs. It is here rather than in a file because
 * it is written per file, read per index build, and can be thrown away
 * without losing anything.
 *
 * It lives under `_state/`, beside the Telegram cursor — bookkeeping, not
 * content — so a backup of the library still picks it up and nothing in
 * `apks/` or `meta/` has to change.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { STORE_DIRS, STORE_ROOT } from "./storage";

const DB_PATH = path.join(STORE_ROOT, STORE_DIRS.state, "store.db");

let handle: Database.Database | null = null;

/**
 * Opened on first use, never at import time.
 *
 * `next build` renders pages in worker processes, and a module that opened a
 * database as a side effect of being imported would open one in each of them
 * against a path that may not even be mounted. Every caller here is behind a
 * signed-in request, so the build never reaches this.
 */
export function db(): Database.Database {
  if (handle) return handle;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const conn = new Database(DB_PATH);

  // busy_timeout first, and on its own line: it governs how the *following*
  // statements behave when another connection holds the write lock, and
  // journal_mode = WAL takes that lock. Set the other way round, the very
  // first pragma of a second process is the one that throws SQLITE_BUSY.
  conn.pragma("busy_timeout = 5000");
  conn.pragma("journal_mode = WAL");
  conn.pragma("synchronous = NORMAL");
  conn.pragma("foreign_keys = ON");

  migrate(conn);
  handle = conn;
  return conn;
}

/**
 * `IF NOT EXISTS` throughout, so this is safe to run on every open and safe to
 * run from two processes at once — which happens, because the app and its
 * timers are separate callers into the same file.
 *
 * `user_id` is elite-v2's account id and there is no users table here to point
 * it at: identity is resolved over HTTP (see `lib/sso.ts`), so a foreign key
 * would be a promise this database cannot keep. An account deleted over there
 * leaves rows here that nothing will ever ask for again.
 */
function migrate(conn: Database.Database): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS user_saved (
      user_id  INTEGER NOT NULL,
      slug     TEXT    NOT NULL,
      saved_at TEXT    NOT NULL,
      PRIMARY KEY (user_id, slug)
    );

    -- One row per person who has changed something away from the defaults.
    -- A missing row is the default, which is why every column here has to
    -- have a safe one: "no row" and "answered no" must read the same.
    CREATE TABLE IF NOT EXISTS user_prefs (
      user_id    INTEGER PRIMARY KEY,
      -- Whether this account has confirmed it is 18 or older. 0 hides the
      -- Adults category everywhere, including from a typed-in URL.
      adults     INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT    NOT NULL
    );

    -- The token that puts this account's shelf in an Android client.
    --
    -- Obtainium reaches the repository over plain HTTP with no cookie and no
    -- header of its own, so the only place an identity can ride is the path
    -- (see app/fdroid/[[...path]]/route.ts). One long random value per
    -- account, rotatable, and worth exactly one thing: reading the library as
    -- that account, Adults included.
    CREATE TABLE IF NOT EXISTS user_repo_token (
      user_id    INTEGER PRIMARY KEY,
      token      TEXT    NOT NULL UNIQUE,
      created_at TEXT    NOT NULL
    );

    -- What is inside an APK, keyed on the file it was read from.
    --
    -- Not user state, and the one table here that is a cache rather than a
    -- fact: every value in it can be recomputed by reading the file again.
    -- It exists because the signed index needs a SHA-256 of every APK on the
    -- shelf and the shelf is gigabytes — hashing all of it on a Pi is minutes
    -- of disk, and it is the same answer every time.
    --
    -- The path is relative to STORE_ROOT so the rows survive a move of the
    -- library; size and mtime are the invalidation, because a file whose
    -- bytes changed cannot keep the same pair by accident.
    CREATE TABLE IF NOT EXISTS apk_facts (
      path         TEXT    PRIMARY KEY,
      size         INTEGER NOT NULL,
      mtime        INTEGER NOT NULL,
      sha256       TEXT    NOT NULL,
      version_code INTEGER,
      -- The SHA-256 of the signer certificate, or NULL for an APK carrying
      -- no v2/v3 signing block. NULL is a real answer, not a missing one.
      signer       TEXT,
      read_at      TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_installed (
      user_id      INTEGER NOT NULL,
      slug         TEXT    NOT NULL,
      -- The version the person actually has. This is the whole point of the
      -- row: "installed" alone cannot tell an up-to-date app from one with an
      -- update waiting, and the catalog knows only what the newest file is.
      version      TEXT    NOT NULL,
      installed_at TEXT    NOT NULL,
      PRIMARY KEY (user_id, slug)
    );
  `);
}
