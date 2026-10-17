/**
 * Who is browsing.
 *
 * The store keeps its own accounts: a `users` table and a `sessions` table in
 * the same database as the per-user state (`lib/db.ts`). It used to borrow a
 * sibling app's login over HTTP; that app is gone, and the account ids were
 * carried across unchanged so every saved and installed row still belongs to
 * the same person.
 *
 * A session is a random token in an HttpOnly cookie. Only its SHA-256 is
 * stored, so a copy of the database is not a set of live logins, and signing
 * out — or deleting the row — ends it on the next request rather than whenever
 * a signed token would have expired.
 *
 * The cookie is scoped to this host alone. No `Domain`: nothing else under the
 * parent domain has any business receiving it.
 */
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";

export const SESSION_COOKIE = "store_session";
const SESSION_DAYS = 30;

export interface StoreUser {
  id: number;
  email: string;
  role: "user" | "admin";
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The named cookie out of a raw `Cookie` header.
 *
 * Split on the separator rather than searching for the name: a substring match
 * would read any cookie whose name merely ends in this one.
 */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function userForToken(token: string): StoreUser | null {
  const row = db()
    .prepare(
      `SELECT u.id, u.email, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .get(hashToken(token), new Date().toISOString()) as StoreUser | undefined;
  return row ?? null;
}

/**
 * The account behind a request, or null.
 *
 * The cookie is looked for before the database is touched: a signed-out
 * request — which is every request `next build` renders — never opens it.
 */
export function sessionUser(req: Request): StoreUser | null {
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  return token ? userForToken(token) : null;
}

export function startSession(userId: number): { token: string; expires: Date } {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  const conn = db();
  // Expired rows are swept here rather than on a timer: a login is rare, and
  // nothing else ever reads a session that has run out.
  conn.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now.toISOString());
  conn
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
    )
    .run(hashToken(token), userId, now.toISOString(), expires.toISOString());
  return { token, expires };
}

export function endSession(token: string): void {
  db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

/**
 * Whether the browser reached us over HTTPS. Traefik terminates TLS, so the
 * request this app sees is plain HTTP and the original scheme is a header.
 * A cookie marked Secure on a plain-HTTP LAN address would never come back.
 */
function overHttps(req: Request): boolean {
  return (
    req.headers.get("x-forwarded-proto") === "https" ||
    new URL(req.url).protocol === "https:"
  );
}

export function sessionCookie(req: Request, token: string, expires: Date): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expires.toUTCString()}`,
    ...(overHttps(req) ? ["Secure"] : []),
  ].join("; ");
}

export function clearedSessionCookie(req: Request): string {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(overHttps(req) ? ["Secure"] : []),
  ].join("; ");
}
