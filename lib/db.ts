/**
 * The one database in an app whose library is a directory tree.
 *
 * Everything a *person* can see about an app — its name, its versions, its
 * artwork — is a file, and that is deliberate: the library survives this app
 * and can be inspected with `ls`. What a person *did* is not like that. Saving
 * an app and marking one installed are per-account facts with no natural file
 * to live in, they are written far more often than the catalog changes, and
 * two tabs can write them at the same moment. That is a database's job, so
 * this is where it starts and, so far, ends: two tables keyed on the elite-v2
 * account id.
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
