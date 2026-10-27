/**
 * The sites modified builds are taken from, as far as the source check can
 * read them.
 *
 * A mod is numbered by whoever modified it and lags the original on purpose,
 * so comparing it with Play calls it behind forever. What it can be compared
 * with is the page it was taken from: that page names the build it offers,
 * and a newer number there is a newer build signed with the same key.
 *
 * Only hosts listed here are asked. `modSource` is free for a person to fill
 * with any address — a forum thread, a Telegram post — and is shown as a link
 * whatever it is, but the server only fetches pages it knows how to read.
 */
import { apkmbDownloadLinks, fetchApkmbListing } from "@/lib/sources/apkmb";
import { BROWSER_USER_AGENT } from "@/lib/sources/net";

const PAGE_TIMEOUT_MS = 20_000;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;

type ModSite = {
  /** What the page and the report call it. */
  name: string;
  version: (url: string) => Promise<string | null>;
};

const SITES: Record<string, ModSite> = {
  "apkmb.com": {
    name: "apkmb",
    // The page's own version is often Play's, copied in: IPTV# read 3.18
    // while the only file offered was "… v3.16 Mod.apk". The file name is
    // what can actually be fetched, so it wins where it carries a number.
    version: async (url) => {
      for (const link of await apkmbDownloadLinks(url)) {
        const found = versionInFileName(link);
        if (found) return found;
      }
      return (await fetchApkmbListing(url)).siteVersion;
    },
  },
  "modyolo.com": {
    name: "modyolo",
    version: async (url) => jsonLdVersion(await readPage(url)),
  },
};

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** A short name for the page a mod came from — the site's, or its host. */
export function modSiteName(url: string): string {
  const host = hostOf(url);
  return (host && SITES[host]?.name) ?? host ?? url;
}

/** Whether the source check knows how to read a version off this page. */
export function isCheckableModSource(url: string | undefined): url is string {
  const host = url ? hostOf(url) : null;
  return host !== null && host in SITES;
}

/** The version the page offers, or null when it does not say. */
export async function modSourceVersion(url: string): Promise<string | null> {
  const host = hostOf(url);
  const site = host ? SITES[host] : undefined;
  if (!site) throw new Error(`no version reader for ${host ?? url}`);
  const version = await site.version(url);
  return version?.trim() || null;
}

function versionInFileName(link: string): string | null {
  let name: string;
  try {
    name = decodeURIComponent(new URL(link).pathname.split("/").pop() ?? "");
  } catch {
    return null;
  }
  return /\bv(\d+(?:\.\d+)+)/i.exec(name)?.[1] ?? null;
}

async function readPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": BROWSER_USER_AGENT, accept: "text/html,*/*" },
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${hostOf(url)} answered HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.byteLength > MAX_PAGE_BYTES) {
    throw new Error(`${body.byteLength} bytes is not a listing page`);
  }
  return body.toString("utf8");
}

/** `softwareVersion` off the page's schema.org SoftwareApplication block. */
function jsonLdVersion(html: string): string | null {
  const blocks = html.matchAll(
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const [, raw] of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const node of nodesOf(parsed)) {
      const type = node["@type"];
      const isApp = Array.isArray(type)
        ? type.some((t) => String(t).endsWith("Application"))
        : String(type ?? "").endsWith("Application");
      if (isApp && node.softwareVersion) return String(node.softwareVersion);
    }
  }
  return null;
}

function nodesOf(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(nodesOf);
  if (!value || typeof value !== "object") return [];
  const node = value as Record<string, unknown>;
  return [node, ...nodesOf(node["@graph"])];
}
