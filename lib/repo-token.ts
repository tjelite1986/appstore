/**
 * The per-account secret that an Android client puts in its repository URL.
 *
 * Everything else here identifies people by the elite-v2 cookie, which works
 * because everything else here is a browser. Obtainium is not: it fetches the
 * index and the APK with a bare GET, sends no cookie, and — the part that
 * decides the design — its F-Droid repository source cannot be given a header
 * (`getRequestHeaders` returns null and that source does not override it) and
 * strips every query parameter but `appId` off the URL it was configured with.
 *
 * The path survives all of that. So the identity rides there:
 *
 *     /fdroid/repo/index.xml            — nobody in particular, no Adults
 *     /fdroid/t/<token>/repo/index.xml  — this account's shelf
 *
 * A token is therefore a bearer credential in a URL, which is a real cost: it
 * sits in the client's config, and anyone holding it reads the library as its
 * owner. It buys nothing else — no writes, no account, no elite-v2 session —
 * and rotating it is one row.
 */
import { randomBytes } from "node:crypto";
import { db } from "./db";

/** 32 hex characters. Hex rather than base64url so the value survives being
 *  read off a screen, retyped, and pasted into a form that trims punctuation. */
const TOKEN_BYTES = 16;

export function newRepoToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/**
 * This account's token, minted on first ask.
 *
 * Lazy on purpose: an account that never opens an Android client never gets a
 * row, and the settings page is the only thing that asks.
 */
export function repoTokenFor(userId: number): string {
  const conn = db();
  const row = conn
    .prepare("SELECT token FROM user_repo_token WHERE user_id = ?")
    .get(userId) as { token: string } | undefined;
  if (row) return row.token;

  const token = newRepoToken();
  conn
    .prepare(
      "INSERT INTO user_repo_token (user_id, token, created_at) VALUES (?, ?, ?)"
    )
    .run(userId, token, new Date().toISOString());
  return token;
}

/** A new token, which is also how a leaked one is revoked. */
export function rotateRepoToken(userId: number): string {
  const token = newRepoToken();
  db()
    .prepare(
      `INSERT INTO user_repo_token (user_id, token, created_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET token = excluded.token,
                                           created_at = excluded.created_at`
    )
    .run(userId, token, new Date().toISOString());
  return token;
}

/**
 * Who a token belongs to, or null.
 *
 * The shape is checked before the database is asked, so a path segment that
 * could never be a token — a typo, a probe, a traversal attempt — costs a
 * regex rather than a query.
 */
export function userForRepoToken(token: string): number | null {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const row = db()
    .prepare("SELECT user_id FROM user_repo_token WHERE token = ?")
    .get(token) as { user_id: number } | undefined;
  return row?.user_id ?? null;
}
