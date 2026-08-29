/**
 * Putting a binary a source found onto the shelf it belongs to.
 *
 * GitHub and F-Droid differ in how they are addressed and what they can say
 * about an app, but the moment an APK is in hand they are the same: the file
 * has to be checked against what it claims to be, named from what is actually
 * inside it, and handed to the importer — which owns the signer pin and the
 * layout under `apks/`. Downloading straight into `apks/` would be a second
 * implementation of those rules.
 *
 * The staging folder is a subdirectory of the drop zone on purpose: it is on
 * the same filesystem, so the importer's move is a rename, and the scan only
 * reads files at the top level, so a download in progress is never picked up
 * as a drop.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { STORE_DIRS, STORE_ROOT } from "@/lib/storage";
import {
  attachApk,
  isPlaceholderVersion,
  parkRefused,
  parseApkFilename,
} from "@/lib/import";
import { readApkInfo } from "@/lib/apk-manifest";
import { verifyApk } from "@/lib/apk-verify";
import { downloadFile, looksLikeApk } from "@/lib/sources/net";

const STAGING_DIR = path.join(STORE_ROOT, STORE_DIRS.import, "_sources");

/**
 * The release is signed with a key other than the one the app is pinned to.
 *
 * Its own class so the check can tell "upstream refused" from "the network
 * failed": the second is worth trying again next run, the first is not until
 * a person has decided, and fetching 200 MB every six hours to be refused
 * again is neither.
 */
export class RefusedRelease extends Error {
  constructor(
    message: string,
    /** The review id when the file was kept for a decision; null when not. */
    readonly reviewId: string | null
  ) {
    super(message);
    this.name = "RefusedRelease";
  }
}

export type InstalledVersion = {
  version: string;
  /** What the importer made of the file — "ok", "unsigned", … */
  status: string;
  /** True when this is now the version the store serves. */
  promoted: boolean;
  bytes: number;
  packageName: string | null;
};

/**
 * Download one APK and attach it to `slug`.
 *
 * The version comes from the manifest inside the file rather than from the
 * release tag: a tag is what the author called the release, and the two
 * disagree often enough that trusting the tag would file an app under a
 * version the phone will never report.
 */
export async function installFromUrl(
  slug: string,
  url: string,
  opts: { fileName: string; tag: string; fallbackVersion?: string | null }
): Promise<InstalledVersion> {
  const staged = path.join(STAGING_DIR, slug, path.basename(opts.fileName));
  const bytes = await downloadFile(url, staged, { tag: opts.tag });

  try {
    if (!(await looksLikeApk(staged))) {
      throw new Error(
        "that download is not an APK — the source served something else"
      );
    }

    const manifest = await readApkInfo(staged);
    const parsed = parseApkFilename(path.basename(opts.fileName));
    const version =
      (isPlaceholderVersion(manifest.versionName)
        ? parsed.version ?? opts.fallbackVersion ?? null
        : null) ||
      manifest.versionName ||
      opts.fallbackVersion ||
      parsed.version ||
      (manifest.versionCode ? `vc${manifest.versionCode}` : null) ||
      "unknown";

    const attached = await attachApk(slug, staged, {
      version,
      packageName: manifest.packageName,
      fileName: path.basename(opts.fileName),
    });
    if (!attached.ok) {
      // The importer refuses a file signed by a key this app has not seen
      // before. That is the check that stops a repackaged build from taking
      // over an app someone already installed, so a source may not talk its
      // way past it — the review queue is where a person decides. So the
      // file goes there, out of staging before the cleanup below reaches it.
      if (attached.status === "signer_mismatch") {
        const id = await parkRefused(staged, {
          originalName: path.basename(opts.fileName),
          slug,
          appName: attached.appName ?? slug,
          reason: "signer_mismatch",
        });
        throw new RefusedRelease(
          `signed with a different key than the version already here — held in the review queue as ${id}`,
          id
        );
      }
      throw new Error(`the importer refused the file (${attached.status})`);
    }

    return {
      version: attached.version ?? version,
      status: attached.status,
      promoted: Boolean(attached.promoted),
      bytes,
      packageName: manifest.packageName,
    };
  } finally {
    // On success the importer moved the file out; this clears the rest.
    await fs.rm(path.join(STAGING_DIR, slug), { recursive: true, force: true });
  }
}

export type LinkedVersion = {
  /** What the manifest inside the release said, not the tag. */
  version: string;
  packageName: string | null;
  /** SHA-256 of the signer cert, so a later release can be checked against it. */
  signerSha256: string | null;
  bytes: number;
};

/**
 * Read a release without keeping it.
 *
 * GitHub hosts the file already, so mirroring a second copy buys nothing the
 * store needs — except the two facts that only exist inside the binary: the
 * version the phone will report, and who signed it. So the file is fetched,
 * asked those two questions, and deleted. What is kept is a link to the same
 * asset plus the answers.
 *
 * The signer is checked against the pin the same way `attachApk` does it. A
 * linked app never stops being verified: every new tag comes back through
 * here, and a release signed with a new key is refused rather than linked.
 */
export async function installLinked(
  slug: string,
  url: string,
  opts: {
    fileName: string;
    tag: string;
    fallbackVersion?: string | null;
    /** The signer this app is already pinned to, when it has one. */
    pinnedSigner?: string | null;
  }
): Promise<LinkedVersion> {
  const staged = path.join(STAGING_DIR, slug, path.basename(opts.fileName));
  const bytes = await downloadFile(url, staged, { tag: opts.tag });

  try {
    if (!(await looksLikeApk(staged))) {
      throw new Error(
        "that download is not an APK — the source served something else"
      );
    }

    const verify = await verifyApk(staged, {
      pinnedSigner: opts.pinnedSigner ?? null,
    });
    if (verify.status === "signer_mismatch") {
      // Nothing to park: a linked app keeps no shelf for the file to wait
      // on. Dropping it into the queue would offer to mirror a build for an
      // app that is served by link, which is a different decision.
      throw new RefusedRelease(
        "signed with a different key than the one this app is pinned to — re-add the app from the new release if that is expected",
        null
      );
    }

    const manifest = await readApkInfo(staged);
    const parsed = parseApkFilename(path.basename(opts.fileName));
    const version =
      (isPlaceholderVersion(manifest.versionName)
        ? parsed.version ?? opts.fallbackVersion ?? null
        : null) ||
      manifest.versionName ||
      opts.fallbackVersion ||
      parsed.version ||
      (manifest.versionCode ? `vc${manifest.versionCode}` : null) ||
      "unknown";

    return {
      version,
      packageName: manifest.packageName,
      signerSha256: verify.signerSha256 ?? null,
      bytes,
    };
  } finally {
    // Nothing moved the file out of staging — for a linked app there is no
    // shelf to move it to, and this is the whole point of the mode.
    await fs.rm(path.join(STAGING_DIR, slug), { recursive: true, force: true });
  }
}

/** True when the library already holds this version of the app. */
export function alreadyHeld(
  versions: { version: string }[],
  version: string | null
): boolean {
  if (!version) return false;
  const want = version.replace(/^v/i, "").trim().toLowerCase();
  return versions.some(
    (v) => v.version.replace(/^v/i, "").trim().toLowerCase() === want
  );
}
