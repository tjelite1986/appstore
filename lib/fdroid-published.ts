/**
 * What the signing job leaves on disk, and what the repository route serves
 * back out of it.
 *
 * Everything here is a *file*, not a document built per request, and that is
 * the whole reason this module exists: a signature cannot be per request, so
 * the app hands over the catalog whole (`/api/fdroid/index-v1`,
 * `/api/fdroid/index-v2`) and `scripts/fdroid-sign.sh` — which owns the key,
 * out here where a JDK is — seals it and drops the result in
 * `_state/fdroid/<variant>/`.
 *
 * Two variants exist for the same reason: `all` is the whole shelf, `clean` is
 * the shelf without Adults, and the token in the URL picks between them, the
 * same decision the unsigned `index.xml` makes per request.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveInStore } from "./serve";
import { STORE_DIRS } from "./storage";

/** Where a built index lives, relative to the library root. */
export const FDROID_STATE_DIR = path.join(STORE_DIRS.state, "fdroid");

/** The two documents that exist, and the directory each one's files sit in. */
export const INDEX_VARIANTS = ["all", "clean"] as const;
export type IndexVariant = (typeof INDEX_VARIANTS)[number];

/**
 * The published files, and the type each is served as.
 *
 * `index-v1.jar` is the whole catalog inside one signed jar. Index-v2 splits
 * that in two: `entry.jar` is a signed jar holding nothing but the SHA-256 and
 * size of `index-v2.json`, which is then fetched unsigned and checked against
 * it. The signature covers both either way — a document whose hash does not
 * match the one in the entry is refused.
 *
 * A client asking for a name that is not here, or for one this repository has
 * never signed, gets a 404, which is what "we do not publish that format"
 * looks like on the wire. Clients probe: Neo Store asks for `entry.jar` first
 * and falls back to `index-v1.jar` on a 404 without complaining.
 */
export const PUBLISHED_FILES: Record<string, string> = {
  "index-v1.jar": "application/java-archive",
  "entry.jar": "application/java-archive",
  "index-v2.json": "application/json; charset=utf-8",
};

/**
 * The repository key's fingerprint, or null before anything has been signed.
 *
 * An F-Droid client takes it on the URL — `?fingerprint=…` — and refuses an
 * index signed by anything else, which is what makes a repository over a home
 * connection worth trusting at all. The signing job writes the file after
 * every index is in place, so its presence also answers "is there a signed
 * index yet"; that is why the settings row appears with it and not before.
 */
export async function repoFingerprint(): Promise<string | null> {
  const abs = await resolveInStore(FDROID_STATE_DIR, "fingerprint.txt");
  if (!abs) return null;
  try {
    const raw = (await fs.readFile(abs, "utf8")).trim();
    return /^[0-9A-F]{64}$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}
