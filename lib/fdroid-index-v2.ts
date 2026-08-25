/**
 * The library as an `index-v2.json` document.
 *
 * Same shelf as `lib/fdroid-index-v1.ts`, same facts, read through the same
 * `lib/fdroid-shelf.ts` — a different format, and one worth publishing beside
 * v1 rather than instead of it. A current client asks for index-v2 *first*
 * (Neo Store fetches `entry.jar`, the official client too) and only falls back
 * to `index-v1.jar` when that 404s. Publishing both costs one extra document
 * per signing run and spares every client a wasted round trip; dropping v1
 * would cost nothing today and break the first old client that showed up.
 *
 * What actually differs, beyond nesting:
 *
 * - **Every name is a path, not a bare file name.** `"/icons/x.png"`,
 *   `"/app_1.0.apk"` — the client appends it to the repository address it was
 *   configured with. v1's bare `apkName` and `icon` are composed by rules the
 *   client carries instead, which is why v1 needs the icon written twice under
 *   two different fields and this does not.
 * - **A version is keyed on the APK's SHA-256**, not listed in an array. The
 *   ordering that v1 got from writing newest first has to come from
 *   `versionCode` here, which every client sorts on anyway.
 * - **The signature does not cover this document.** It covers `entry.json`
 *   inside `entry.jar`, which carries this file's SHA-256 and size. So the
 *   bytes this returns are what gets hashed — the caller must not reformat
 *   them, and `scripts/fdroid-sign.sh` writes the response to disk verbatim.
 *
 * The same omissions as v1, for the same reasons: no `usesSdk`, no
 * `nativecode`, no permissions. An absent `usesSdk` reads as "compatible",
 * which is the right answer for a shelf of hand-collected APKs, and filling it
 * in would mean parsing every manifest past its root element for a field
 * nothing here gates on.
 */
import { collectShelf, iconName, ms } from "./fdroid-shelf";
import type { StoreApp } from "./store";

/**
 * The format version this document claims. 20002 is what current
 * `fdroidserver` writes for index-v2, and what the clients that read it check.
 */
export const INDEX_V2_VERSION = 20002;

export type IndexV2Options = {
  /** Absolute URL of the directory the index is served from. */
  repoUrl: string;
  repoName: string;
  description: string;
  timestamp: number;
};

export type IndexV2Result = {
  /** The document. These exact bytes are what `entry.json` will hash. */
  json: string;
  apps: number;
  packages: number;
  skipped: { slug: string; reason: string }[];
  seen: Set<string>;
};

/**
 * A repository-relative path, encoded so a client can paste it onto an
 * address without thinking about it.
 *
 * Names on this shelf are slug-derived and already URL-safe, so in practice
 * this changes nothing — but an icon dropped in by hand is not bound by that,
 * and a space in a name would otherwise reach the client as a broken URL
 * rather than a missing file.
 */
function repoPath(...segments: string[]): string {
  return `/${segments.map(encodeURIComponent).join("/")}`;
}

/** English is the only language this store has; index-v2 wants it labelled. */
function en<T>(value: T): Record<string, T> {
  return { "en-US": value };
}

export async function buildIndexV2(
  apps: StoreApp[],
  opts: IndexV2Options
): Promise<IndexV2Result> {
  const shelf = await collectShelf(apps);

  const packages: Record<string, unknown> = {};
  const categories: Record<string, unknown> = {};
  let packageCount = 0;

  for (const { id, app, entries } of shelf.packages) {
    const description = app.description || app.tagline;
    const icon = iconName(app);
    packageCount += entries.length;

    // A category is a value in v1 and an entry in a table here. The table is
    // what a client renders in its own category list, so an app in a category
    // nobody declared shows up under its raw id — declare each one as it is
    // met, in the order the shelf met it.
    if (app.category && !categories[app.category]) {
      categories[app.category] = { name: en(app.category) };
    }

    packages[id] = {
      metadata: {
        added: ms(app.added),
        lastUpdated: Math.max(...entries.map((e) => e.added), ms(app.added)),
        name: en(app.name),
        summary: en(app.tagline),
        description: en(description),
        // `<repo>/<packageName>/en-US/<icon>` — one file, addressed the way a
        // v2 client addresses everything: as a path it was handed, not one it
        // assembled. The repository route answers this shape already.
        ...(icon ? { icon: en({ name: repoPath(id, "en-US", icon) }) } : {}),
        // Unknown rather than absent: this store never asks for a licence, and
        // a client renders the string as-is.
        license: "Unknown",
        categories: app.category ? [app.category] : [],
        ...(app.developer ? { authorName: app.developer } : {}),
      },
      // Keyed on the file's SHA-256, which is also what the client verifies
      // its download against. Two identical files under one package id would
      // collapse to one entry here — they are the same bytes, so that is the
      // truth rather than a loss.
      versions: Object.fromEntries(
        entries.map((entry) => [
          entry.hash,
          {
            added: entry.added,
            file: {
              name: repoPath(entry.apkName),
              sha256: entry.hash,
              size: entry.size,
            },
            manifest: {
              versionName: entry.versionName,
              versionCode: entry.versionCode,
              // A list, because an APK can carry more than one signer. This
              // store pins exactly one per app and refuses the rest.
              signer: { sha256: [entry.signer] },
            },
          },
        ])
      ),
    };
  }

  const index = {
    repo: {
      name: en(opts.repoName),
      description: en(opts.description),
      address: opts.repoUrl,
      // No repository picture, and no promise of one: naming a file that is
      // not there buys a 404 on every refresh. The field is optional here,
      // unlike v1 where it had to be written empty.
      timestamp: opts.timestamp,
      categories,
      antiFeatures: {},
      mirrors: [] as unknown[],
    },
    packages,
  };

  return {
    json: JSON.stringify(index),
    apps: shelf.packages.length,
    packages: packageCount,
    skipped: shelf.skipped,
    seen: shelf.seen,
  };
}
