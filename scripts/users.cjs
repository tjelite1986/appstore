/**
 * Account management for the store — there is no sign-up page, so this is how
 * accounts are made.
 *
 * Runs inside the container, where better-sqlite3 is built for the right
 * glibc. The script travels on stdin, so nothing has to be mounted:
 *
 *   docker exec -i appstore node - list                     < scripts/users.cjs
 *   docker exec -i -e PASSWORD=… appstore node - add <email> [admin] < scripts/users.cjs
 *   docker exec -i -e PASSWORD=… appstore node - passwd <email>      < scripts/users.cjs
 *   docker exec -i appstore node - role <email> <user|admin>         < scripts/users.cjs
 *   docker exec -i appstore node - remove <email>                    < scripts/users.cjs
 *   docker exec -i -e USERS_JSON='[…]' appstore node - import        < scripts/users.cjs
 *
 * Passwords come from the environment, never the argument list, which any
 * process on the host can read. `import` takes accounts as
 * `[{ id, email, password_hash, role }]` with scrypt hashes in the format of
 * lib/password.ts and keeps their ids, so per-user rows already keyed on them
 * stay with the same person.
 */
const path = require("node:path");
const { randomBytes, scryptSync } = require("node:crypto");
const Database = require("better-sqlite3");

const DB_PATH = path.join(process.env.STORE_ROOT || "/store", "_state", "store.db");

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function password() {
  const value = process.env.PASSWORD;
  if (!value || value.length < 8) fail("Set PASSWORD (at least 8 characters)");
  return value;
}

const db = new Database(DB_PATH);
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");
// The same two tables lib/db.ts creates, in case the app has not opened the
// database since it learned about them.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at    TEXT    NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL,
    expires_at TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
`);

function clearUserRows(id) {
  for (const table of ["user_saved", "user_installed", "user_prefs", "user_repo_token", "file_status", "file_comments"]) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    if (exists) db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(id);
  }
}

function userId(email) {
  const row = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (!row) fail(`No account for ${email}`);
  return row.id;
}

const [command, ...args] = process.argv.slice(2);
const now = new Date().toISOString();

switch (command) {
  case "list": {
    const rows = db
      .prepare(
        `SELECT u.id, u.email, u.role, u.created_at,
                (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS sessions
           FROM users u ORDER BY u.id`
      )
      .all(now);
    console.table(rows);
    break;
  }
  case "add": {
    const [email, role = "user"] = args;
    if (!email) fail("Usage: add <email> [admin]");
    if (role !== "user" && role !== "admin") fail("Role must be user or admin");
    const info = db.transaction(() => {
      const row = db
        .prepare("INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)")
        .run(email, hashPassword(password()), role, now);
      // A new account starts empty. The per-user tables have no foreign key,
      // so rows left under this id by an account removed some other way would
      // otherwise become the newcomer's.
      clearUserRows(row.lastInsertRowid);
      return row;
    })();
    console.log(`Created ${email} (${role}) as id ${info.lastInsertRowid}`);
    break;
  }
  case "passwd": {
    const [email] = args;
    if (!email) fail("Usage: passwd <email>");
    const id = userId(email);
    db.transaction(() => {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password()), id);
      // A new password is usually a response to an old one leaking.
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    })();
    console.log(`Password changed for ${email}; its sessions were ended`);
    break;
  }
  case "role": {
    const [email, role] = args;
    if (!email || (role !== "user" && role !== "admin")) fail("Usage: role <email> <user|admin>");
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId(email));
    console.log(`${email} is now ${role}`);
    break;
  }
  case "remove": {
    const [email] = args;
    if (!email) fail("Usage: remove <email>");
    const id = userId(email);
    db.transaction(() => {
      // The per-user tables have no foreign key to cascade through (see
      // lib/db.ts), so they are cleared by name.
      clearUserRows(id);
      db.prepare("DELETE FROM users WHERE id = ?").run(id);
    })();
    console.log(`Removed ${email} and everything kept for it`);
    break;
  }
  case "import": {
    let rows;
    try {
      rows = JSON.parse(process.env.USERS_JSON || "");
    } catch {
      fail("Set USERS_JSON to a JSON array of { id, email, password_hash, role }");
    }
    if (!Array.isArray(rows)) fail("USERS_JSON must be an array");
    const insert = db.prepare(
      "INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    let added = 0;
    let skipped = 0;
    db.transaction(() => {
      for (const r of rows) {
        if (!Number.isInteger(r.id) || typeof r.email !== "string" || !/^[0-9a-f]+:[0-9a-f]+$/.test(r.password_hash || "")) {
          fail(`Not an importable account: ${JSON.stringify({ id: r.id, email: r.email })}`);
        }
        const role = r.role === "admin" ? "admin" : "user";
        const clash = db.prepare("SELECT id, email FROM users WHERE id = ? OR email = ?").get(r.id, r.email);
        if (clash) {
          console.log(`Skipped ${r.email}: already present as id ${clash.id} (${clash.email})`);
          skipped++;
          continue;
        }
        insert.run(r.id, r.email, r.password_hash, role, r.created_at || now);
        added++;
      }
    })();
    console.log(`Imported ${added}, skipped ${skipped}`);
    break;
  }
  default:
    fail("Commands: list | add <email> [admin] | passwd <email> | role <email> <user|admin> | remove <email> | import");
}
