/**
 * The library as a *signed* F-Droid repository index.
 *
 * `lib/fdroid-index.ts` writes the old `index.xml` for Obtainium, which asks
 * for nothing it cannot answer from the catalog. This file writes the format
 * a real F-Droid client reads — `index-v1.json`, the payload of a signed
 * `index-v1.jar` — and it exists for the one thing Obtainium cannot do:
 * notice an app that was not already on the phone. A subscribed client lists
 * the whole repository, so a new app on the shelf simply appears.
 *
 * Two costs come with that, and both shape what is below.
 *
 * The first is bytes. A client verifies its download against the index's
 * SHA-256 and keys versions on `versionCode`, so every APK has to be opened.
 * That goes through `lib/fdroid-shelf.ts`, which both index formats read the
 * library through, and which caches on (path, size, mtime); a build after a
 * quiet hour reads no APK at all.
 *
 * The second is that the index is *signed*, and a signature cannot be per
 * request. So this produces a whole document, not a response: the host job
 * that owns the repository key asks for one, seals it, and drops the jar
 * where the route can serve it. Which of the two documents — with Adults or
 * without — a client gets is decided by the URL it fetched, exactly as the
 * unsigned index decides it.
 *
 * Icons are the one thing here that is a URL rather than a value. A client
 * builds the address itself from the repository it fetched plus the name in
 * the index, and it builds two different ones depending on which field the
 * name is in — so both are written, and the repository route answers both
 * shapes. See `iconName` below.
 *
 * What a package entry deliberately omits: `minSdkVersion`, `targetSdkVersion`,
 * `nativecode` and `uses-permission`. A client treats an absent minSdk and an
 * empty nativecode list as "compatible with this phone", which is the right
 * answer for a shelf whose APKs were installed by hand anyway, and reading
 * them would mean parsing every manifest past its root element for a field
 * nothing here gates on.
 */
import { collectShelf, iconName, ms } from "./fdroid-shelf";
import type { StoreApp } from "./store";

/**
 * The repository-format version this document claims. 20 is what current
 * `fdroidserver` writes for index-v1 and what the clients that read it expect.
 */
const INDEX_V1_VERSION = 20;

export type IndexV1Options = {
  /** Absolute URL of the directory the index is served from. */
  repoUrl: string;
  repoName: string;
  description: string;
};

export type IndexV1Result = {
  /** The document, ready to be zipped into `index-v1.jar`. */
  json: string;
  /** How many apps made it in. */
  apps: number;
  /** How many APK files are listed across all of them. */
  packages: number;
  /**
   * Apps left out, with the reason. Not an error — a listing that links to
   * Play has nothing to serve — but the job that builds this prints it, so a
   * missing app has an answer without anyone opening a database.
   */
  skipped: { slug: string; reason: string }[];
  /** Library-relative paths of every APK that was read or cached this build. */
  seen: Set<string>;
};

/**
 * Build the document.
 *
 * `timestamp` is passed in rather than taken from the clock: a client refuses
 * an index older than the one it already has, so the value has to move forward
 * on every publish, and the caller is the one that knows whether this build is
 * a publish or a dry run.
 */
export async function buildIndexV1(
  apps: StoreApp[],
  opts: IndexV1Options & { timestamp: number }
): Promise<IndexV1Result> {
  const shelf = await collectShelf(apps);

  const appList = [];
  const packages: Record<string, unknown[]> = {};
  let packageCount = 0;

  for (const { id, app, entries } of shelf.packages) {
    packages[id] = entries.map((entry) => ({
      packageName: entry.packageName,
      apkName: entry.apkName,
      versionName: entry.versionName,
      versionCode: entry.versionCode,
      hash: entry.hash,
      hashType: "sha256",
      signer: entry.signer,
      size: entry.size,
      added: entry.added,
    }));
    packageCount += entries.length;

    const description = app.description || app.tagline;
    const icon = iconName(app);
    appList.push({
      packageName: id,
      name: app.name,
      summary: app.tagline,
      description,
      // Fetched from `<repo>/icons-<dpi>/<icon>` — the client picks the
      // bucket for its screen, and this repository answers every one of them
      // with the same file, because there is only one file.
      ...(icon ? { icon } : {}),
      // Unknown rather than absent: this store never asks for a licence, and
      // a client renders the string as-is.
      license: "Unknown",
      categories: [app.category],
      authorName: app.developer,
      added: ms(app.added),
      lastUpdated: Math.max(...entries.map((e) => e.added), ms(app.added)),
      suggestedVersionCode: String(entries[0].versionCode),
      suggestedVersionName: entries[0].versionName,
      // Newer clients read the localised block and fall back to the flat
      // fields; older ones only know the flat ones. Both are written, which
      // is what a repository built by fdroidserver looks like too.
      localized: {
        "en-US": {
          name: app.name,
          summary: app.tagline,
          description,
          // The same file again, under the name a newer client prefers:
          // `<repo>/<packageName>/en-US/<icon>`. A client that reads this one
          // never looks at the flat field, and one that does not, does.
          ...(icon ? { icon } : {}),
        },
      },
    });
  }

  const index = {
    repo: {
      timestamp: opts.timestamp,
      version: INDEX_V1_VERSION,
      name: opts.repoName,
      // The repository's own picture, which this store does not have. Empty
      // rather than the conventional "icon.png": a client shows a repository
      // without a picture either way, and naming a file that is not there
      // only buys a 404 on every refresh.
      icon: "",
      address: opts.repoUrl,
      description: opts.description,
      mirrors: [] as string[],
    },
    // Part of the format. This repository asks nothing of a phone.
    requests: { install: [] as string[], uninstall: [] as string[] },
    apps: appList,
    packages,
  };

  return {
    json: JSON.stringify(index),
    apps: appList.length,
    packages: packageCount,
    skipped: shelf.skipped,
    seen: shelf.seen,
  };
}
