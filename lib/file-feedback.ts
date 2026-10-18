/**
 * What people say about one build of an app: whether it worked for them, and
 * anything they wrote about it.
 *
 * This is the other per-user module beside `lib/user-state.ts`, and it is
 * keyed one level down — on a *file* (slug + version) rather than on an app.
 * A library that keeps older versions is asking exactly that question: not
 * "is this app any good" but "does this build run", and the answer changes
 * from one APK to the next.
 *
 * Both tables are plain facts stored as given. A status is one row per person
 * per build, overwritten on change, deleted on "forget"; the counts shown are
 * computed on read. A comment is a row per message, deleted by its author or
 * by an admin. Nothing here is derived at write time, so a build that gains
 * a comment after everyone else moved on still reads right.
 */
import { db } from "./db";
import type { StoreUser } from "./auth";

export type FileStatus = "working" | "broken";

export type FileComment = {
  id: number;
  /** Whoever wrote it, as the part of their address before the @. */
  author: string;
  body: string;
  createdAt: string;
  /** Whether the viewer may delete it: their own, or any as an admin. */
  deletable: boolean;
};

export type FileFeedback = {
  version: string;
  working: number;
  broken: number;
  /** The viewer's own answer, or null — signed out or not yet said. */
  mine: FileStatus | null;
  comments: FileComment[];
};

/** The longest comment accepted. Long enough for a paragraph, not an essay. */
export const COMMENT_MAX = 1000;

/** Rejects anything but the two words the column allows. */
export function isFileStatus(value: unknown): value is FileStatus {
  return value === "working" || value === "broken";
}

/** The name shown beside a comment. The address itself stays off the page. */
function displayName(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

/**
 * Feedback for every version named, for this viewer.
 *
 * Takes the versions rather than reading them off the tables, so a version
 * with nothing said about it still comes back with zero counts — the page
 * draws every row either way. Three statements for the whole page rather than
 * three per version; the detail page lists every build an app has.
 */
export function feedbackFor(
  viewer: StoreUser | null,
  slug: string,
  versions: string[],
): Map<string, FileFeedback> {
  const result = new Map<string, FileFeedback>();
  for (const v of versions) {
    result.set(v, {
      version: v,
      working: 0,
      broken: 0,
      mine: null,
      comments: [],
    });
  }
  if (versions.length === 0) return result;

  const conn = db();
  const counts = conn
    .prepare(
      `SELECT version, status, COUNT(*) AS n FROM file_status
       WHERE slug = ? GROUP BY version, status`,
    )
    .all(slug) as { version: string; status: FileStatus; n: number }[];
  for (const row of counts) {
    const entry = result.get(row.version);
    if (entry) entry[row.status] = row.n;
  }

  if (viewer) {
    const mine = conn
      .prepare(
        "SELECT version, status FROM file_status WHERE slug = ? AND user_id = ?",
      )
      .all(slug, viewer.id) as { version: string; status: FileStatus }[];
    for (const row of mine) {
      const entry = result.get(row.version);
      if (entry) entry.mine = row.status;
    }
  }

  // The author's address is read off `users` at display time rather than
  // copied onto the comment, so a renamed account reads right everywhere. A
  // comment whose account is gone keeps its words under "someone".
  const comments = conn
    .prepare(
      `SELECT c.id, c.version, c.user_id, c.body, c.created_at, u.email
       FROM file_comments c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.slug = ? ORDER BY c.id`,
    )
    .all(slug) as {
    id: number;
    version: string;
    user_id: number;
    body: string;
    created_at: string;
    email: string | null;
  }[];
  for (const row of comments) {
    const entry = result.get(row.version);
    if (!entry) continue;
    entry.comments.push({
      id: row.id,
      author: row.email ? displayName(row.email) : "someone",
      body: row.body,
      createdAt: row.created_at,
      deletable:
        !!viewer && (viewer.role === "admin" || viewer.id === row.user_id),
    });
  }

  return result;
}

/**
 * Say whether a build worked, or take it back with `null`.
 *
 * Idempotent like the other toggles: the buttons are optimistic, and the same
 * answer arriving twice must not be an error.
 */
export function setFileStatus(
  userId: number,
  slug: string,
  version: string,
  status: FileStatus | null,
): void {
  const conn = db();
  if (status) {
    conn
      .prepare(
        `INSERT INTO file_status (user_id, slug, version, status, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, slug, version)
         DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
      )
      .run(userId, slug, version, status, new Date().toISOString());
  } else {
    conn
      .prepare(
        "DELETE FROM file_status WHERE user_id = ? AND slug = ? AND version = ?",
      )
      .run(userId, slug, version);
  }
}

/** Returns the new comment's id. The body is trimmed; empty is the caller's 400. */
export function addComment(
  userId: number,
  slug: string,
  version: string,
  body: string,
): number {
  const info = db()
    .prepare(
      `INSERT INTO file_comments (user_id, slug, version, body, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(userId, slug, version, body, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

/**
 * Remove a comment. The author may remove their own; an admin any. Returns
 * false when no row matched, which covers "not yours" and "already gone" with
 * one answer — the route turns it into a 404 either way.
 */
export function deleteComment(
  viewer: StoreUser,
  slug: string,
  id: number,
): boolean {
  const info =
    viewer.role === "admin"
      ? db()
          .prepare("DELETE FROM file_comments WHERE id = ? AND slug = ?")
          .run(id, slug)
      : db()
          .prepare(
            "DELETE FROM file_comments WHERE id = ? AND slug = ? AND user_id = ?",
          )
          .run(id, slug, viewer.id);
  return info.changes > 0;
}

/**
 * Forget this account's answers about builds — part of "forget my library".
 * Comments stay: they were written for everyone reading the page, and the
 * author can remove them one by one.
 */
export function clearFileStatus(userId: number): void {
  db().prepare("DELETE FROM file_status WHERE user_id = ?").run(userId);
}

/**
 * Re-point everything said about the source app's builds at the target —
 * what a merge needs. Statuses collide on (user, version) when a person
 * answered for the same version under both slugs; the target's row wins, the
 * same rule `moveUserRows` applies to installed.
 */
export function moveFeedback(from: string, into: string): void {
  const conn = db();
  conn.transaction(() => {
    conn
      .prepare(
        `INSERT OR IGNORE INTO file_status (user_id, slug, version, status, updated_at)
         SELECT user_id, ?, version, status, updated_at FROM file_status WHERE slug = ?`,
      )
      .run(into, from);
    conn.prepare("DELETE FROM file_status WHERE slug = ?").run(from);
    conn
      .prepare("UPDATE file_comments SET slug = ? WHERE slug = ?")
      .run(into, from);
  })();
}
