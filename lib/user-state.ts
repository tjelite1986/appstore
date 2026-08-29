/**
 * What one account did with the catalog: what it kept, and what it has.
 *
 * `lib/store.ts` reads the library and knows nothing about people; the three
 * per-user flags on `StoreApp` have been declared-but-never-set since the
 * layout build. This is the module that fills them in, and it is the only one
 * that joins a person to an app — the catalog stays a pure function of disk,
 * so a signed-out visitor still gets the same pages, minus the flags.
 *
 * An update is derived, not stored: the catalog knows the newest file, a row
 * here knows which version the person installed, and an app is due an update
 * when the first is newer than the second. Nothing has to be recomputed when a
 * new APK lands — the next read simply answers differently.
 */
import { db } from "./db";
import {
  ADULT_CATEGORY,
  compareVersions,
  findApp,
  getApps,
  onlyHeads,
  withoutCompanions,
  installed as placeholderInstalled,
  saved as placeholderSaved,
  updates as placeholderUpdates,
  withoutAdults,
  type StoreApp,
} from "./store";

export type UserState = {
  /** Slugs the person saved. */
  saved: Set<string>;
  /** Slug to the version they have installed. */
  installed: Map<string, string>;
};

const EMPTY: UserState = { saved: new Set(), installed: new Map() };

/* ------------------------------------------------------------- the 18+ gate */

/**
 * Whether this account has said it is 18 or older.
 *
 * A signed-out browser is never old enough. That is the whole design: the
 * store is open to anyone on the network, so "nobody in particular" has to be
 * the strictest reading rather than the most permissive one, and there is no
 * cookie to clear or dialog to click past.
 */
export function adultsAllowed(userId: number | null): boolean {
  if (userId === null) return false;
  const row = db()
    .prepare("SELECT adults FROM user_prefs WHERE user_id = ?")
    .get(userId) as { adults: number } | undefined;
  return row?.adults === 1;
}

/** Idempotent, like the save toggle: the same answer may arrive twice. */
export function setAdultsAllowed(userId: number, on: boolean): void {
  db()
    .prepare(
      `INSERT INTO user_prefs (user_id, adults, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET adults = excluded.adults,
                                           updated_at = excluded.updated_at`
    )
    .run(userId, on ? 1 : 0, new Date().toISOString());
}

/**
 * One app, seen as this person may see it.
 *
 * A gated app answers null — exactly what a slug that does not exist answers,
 * so the detail page and the download route both 404 without having to say
 * which of the two reasons it was.
 */
export async function appFor(
  userId: number | null,
  slug: string
): Promise<StoreApp | null> {
  const app = await findApp(slug);
  if (!app) return null;
  if (app.category === ADULT_CATEGORY && !adultsAllowed(userId)) return null;
  return app;
}

export function readState(userId: number): UserState {
  const conn = db();
  const saved = conn
    .prepare("SELECT slug FROM user_saved WHERE user_id = ?")
    .all(userId) as { slug: string }[];
  const installed = conn
    .prepare("SELECT slug, version FROM user_installed WHERE user_id = ?")
    .all(userId) as { slug: string; version: string }[];

  return {
    saved: new Set(saved.map((r) => r.slug)),
    installed: new Map(installed.map((r) => [r.slug, r.version])),
  };
}

/**
 * Save or unsave. Idempotent on purpose: the button is a toggle backed by an
 * optimistic UI, so the same state can arrive twice and the second one must
 * not be an error.
 */
export function setSaved(userId: number, slug: string, on: boolean): void {
  const conn = db();
  if (on) {
    conn
      .prepare(
        `INSERT INTO user_saved (user_id, slug, saved_at) VALUES (?, ?, ?)
         ON CONFLICT (user_id, slug) DO NOTHING`
      )
      .run(userId, slug, new Date().toISOString());
  } else {
    conn
      .prepare("DELETE FROM user_saved WHERE user_id = ? AND slug = ?")
      .run(userId, slug);
  }
}

/**
 * Record which version of an app the person has, or `null` to forget it.
 *
 * Re-marking an app that is already installed rewrites the version rather than
 * doing nothing — that is exactly what happens after an update, and it is the
 * write that makes the app stop appearing on Updates.
 */
export function setInstalled(
  userId: number,
  slug: string,
  version: string | null
): void {
  const conn = db();
  if (version) {
    conn
      .prepare(
        `INSERT INTO user_installed (user_id, slug, version, installed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, slug)
         DO UPDATE SET version = excluded.version,
                       installed_at = excluded.installed_at`
      )
      .run(userId, slug, version, new Date().toISOString());
  } else {
    conn
      .prepare("DELETE FROM user_installed WHERE user_id = ? AND slug = ?")
      .run(userId, slug);
  }
}

/** Forget everything about one account — what Settings offers. */
export function clearState(userId: number): void {
  const conn = db();
  conn.transaction(() => {
    conn.prepare("DELETE FROM user_saved WHERE user_id = ?").run(userId);
    conn.prepare("DELETE FROM user_installed WHERE user_id = ?").run(userId);
  })();
}

/**
 * The catalog, with this person's flags on it.
 *
 * Returns new objects rather than mutating the cached catalog rows — those are
 * shared by every request, and writing a visitor's flags onto them would show
 * one person's library to the next one.
 */
export function decorate(apps: StoreApp[], state: UserState): StoreApp[] {
  return apps.map((app) => {
    const have = state.installed.get(app.slug);
    const newest = app.versions[0]?.version ?? app.version;
    const updateTo =
      have && newest && compareVersions(newest, have) < 0 ? newest : undefined;
    return {
      ...app,
      saved: state.saved.has(app.slug),
      installed: !!have,
      // The version shown on an installed row is the one they have, not the
      // one on the shelf — otherwise "1.4 → 1.4" is what an update reads as.
      version: have ?? app.version,
      updateTo,
    };
  });
}

/**
 * The catalog as this request should see it.
 *
 * With no account, the flags stay as the catalog left them: off a real library
 * that means all false, and off the placeholder catalog it means the hand-set
 * flags survive, so the screens can still be judged on an empty install.
 */
export async function catalogFor(userId: number | null): Promise<StoreApp[]> {
  // Every list screen reads through here, so this one line is the gate for all
  // of them — home, search, the category pages, saved and updates.
  const all = await getApps();
  const apps = adultsAllowed(userId) ? all : withoutAdults(all);
  if (userId === null) return apps;
  return decorate(apps, readState(userId));
}

/**
 * The catalog as the *browse* screens should see it: one card per family, and
 * no companions.
 *
 * Saved, installed and updates deliberately do not read through here. A person
 * who saved one variant saved that one — showing them the family's head
 * instead would answer a question they did not ask, and an update waiting on a
 * member is news about the member. The same goes for a companion: someone who
 * installed microG has microG installed, and its update is theirs to see.
 */
export async function shelfFor(userId: number | null): Promise<StoreApp[]> {
  return withoutCompanions(onlyHeads(await catalogFor(userId)));
}

/* ------------------------------------------------------- the screens' lists */

export async function savedApps(userId: number | null): Promise<StoreApp[]> {
  if (userId === null) return withoutAdults(await placeholderSaved());
  return (await catalogFor(userId)).filter((a) => a.saved);
}

export async function installedApps(userId: number | null): Promise<StoreApp[]> {
  if (userId === null) return withoutAdults(await placeholderInstalled());
  return (await catalogFor(userId)).filter((a) => a.installed);
}

export async function updatableApps(userId: number | null): Promise<StoreApp[]> {
  if (userId === null) return withoutAdults(await placeholderUpdates());
  return (await catalogFor(userId)).filter((a) => a.updateTo);
}

/**
 * One app's flags, without decorating the whole catalog for a detail page.
 */
export function stateFor(
  userId: number | null,
  slug: string
): { saved: boolean; installedVersion: string | null } {
  if (userId === null) return { saved: false, installedVersion: null };
  const conn = db();
  const saved = conn
    .prepare("SELECT 1 FROM user_saved WHERE user_id = ? AND slug = ?")
    .get(userId, slug);
  const row = conn
    .prepare("SELECT version FROM user_installed WHERE user_id = ? AND slug = ?")
    .get(userId, slug) as { version: string } | undefined;
  return { saved: !!saved, installedVersion: row?.version ?? null };
}
