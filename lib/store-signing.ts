/**
 * Builds re-signed with the store's own key.
 *
 * Mods change hands. The next build of an app is often signed by a different
 * modder than the last one, and Android refuses to install an update signed
 * with another key, so every switch costs an uninstall and the app's data.
 * A listing with `storeSigned` set is served re-signed with one key the store
 * holds, which makes the modder's key stop mattering to the phone: once the
 * store's build is installed, every later build installs over it.
 *
 * Who holds the key decides the split, the same one the F-Droid index uses
 * (see scripts/fdroid-sign.sh). Signing needs a JDK and the key, and neither
 * belongs in the container, so:
 *
 *   the app     says which files still carry another key (GET /api/store-signing)
 *               and keeps them off the shelf until they do not
 *   the host    holds the key, re-signs each file, keeps the original under
 *               `_originals/`, and writes the key's fingerprint where this
 *               module reads it (scripts/apk-resign.sh)
 *
 * What it does *not* change: `signingCert` in the meta file stays the key the
 * builds arrived with. That is the importer's trust-on-first-use check — the
 * next drop is compared against the modder's key, not against the store's —
 * so a repackaged build is still refused before it is ever signed.
 *
 * Only `.apk` files. An `.xapk` is a bundle of splits each signed on its own,
 * and re-signing one means unpacking it; those are served as they came.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { apkFacts } from "@/lib/apk-facts";
import { resolveInStore } from "@/lib/serve";
import { STORE_DIRS, STORE_ROOT } from "@/lib/storage";
import type { StoreApp } from "@/lib/store";

/** Written by scripts/apk-resign.sh; the key itself sits beside it. */
const SIGNER_FILE = path.join(STORE_ROOT, STORE_DIRS.state, "apk-signing", "signer.sha256");

/**
 * The SHA-256 of the store's signing certificate, lower-case hex — the same
 * form `extractSignerSha256` reads out of an APK. Null until the host script
 * has run once: with no key yet there is nothing to wait for, and holding
 * files back for a key that does not exist would empty the shelf.
 */
export async function storeSigner(): Promise<string | null> {
  try {
    const value = (await fs.readFile(SIGNER_FILE, "utf8")).trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Whether this build has to be held back: the listing asks for the store's
 * key and the file does not carry it yet.
 *
 * A file whose signer cannot be read counts as waiting too. The host script
 * will either sign it or report why it could not, and serving it meanwhile is
 * exactly the install this feature exists to prevent.
 */
export async function awaitingStoreSignature(
  app: Pick<StoreApp, "storeSigned">,
  abs: string,
  signer: string | null
): Promise<boolean> {
  if (!app.storeSigned || !signer) return false;
  if (!/\.apk$/i.test(abs)) return false;
  const facts = await apkFacts(abs);
  return facts?.signer !== signer;
}

export type PendingFile = {
  slug: string;
  version: string;
  file: string;
  /** Library-relative: where the served copy is, and where the original goes. */
  path: string;
  original: string;
};

/** Every file the host script still has to sign. */
export async function pendingStoreSigning(apps: StoreApp[]): Promise<PendingFile[]> {
  const signer = await storeSigner();
  const out: PendingFile[] = [];
  for (const app of apps) {
    if (!app.storeSigned) continue;
    for (const version of app.versions) {
      for (const build of version.files) {
        if (!/\.apk$/i.test(build.file)) continue;
        const abs = await resolveInStore(STORE_DIRS.apks, app.slug, version.version, build.file);
        if (!abs) continue;
        // No key yet: everything is pending, which is how the first run knows
        // what to sign before it has written a fingerprint for this to read.
        if (signer && !(await awaitingStoreSignature(app, abs, signer))) continue;
        out.push({
          slug: app.slug,
          version: version.version,
          file: build.file,
          path: path.posix.join(STORE_DIRS.apks, app.slug, version.version, build.file),
          original: path.posix.join(STORE_DIRS.originals, app.slug, version.version, build.file),
        });
      }
    }
  }
  return out;
}
