"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Download, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/primitives";
import { adminHeaders, readAdminToken } from "@/lib/admin-token";
import { detectSource } from "@/lib/sources/detect";
import type { PlayAddResult, PlayHit } from "@/lib/sources/play";
import type { GithubAddResult } from "@/lib/sources/github";
import type { FdroidAddResult } from "@/lib/sources/fdroid";
import type { ApkmbAddResult, ApkmbFill, ApkmbListing } from "@/lib/sources/apkmb";
import { withBasePath } from "@/lib/base-path";

/**
 * "Add an app" — one address, and the store works out who it belongs to.
 *
 * The four sources answer different questions. Play supplies words and
 * pictures and never a binary, so what it creates is a shelf with the label
 * already printed: the entry carries the package id, the importer matches a
 * dropped file on exactly that, and the next download attaches itself instead
 * of parking as "no matching app". GitHub and F-Droid hand out their APKs, so
 * an app added from those arrives with the newest release already on it.
 *
 * apkmb is Play's shape for the apps Play does not carry — a modified build,
 * or one on the Adults shelf. Its page is read and shown before anything is
 * written, and it lands two ways: on a new shelf, or onto the app the store
 * already holds, which is the common case because the APK usually arrived
 * first through the Telegram feed.
 *
 * Which one is asked comes from the address itself — `detectSource` — because
 * a source selector is one more thing to get wrong about an address that
 * already says where it lives.
 *
 * Its own file because "use client" is file-wide — see `thumb-image.tsx`.
 */

const CARD_CLS =
  "bg-[var(--card)] rounded-[var(--radius)] border border-[color:var(--border)]";
const MUTED_CLS = "text-[color:var(--muted)]";
const INPUT_CLS =
  "w-full rounded-full border border-[color:var(--border)] bg-[var(--card-2)] px-4 py-2 text-sm outline-none focus:border-[color:var(--accent)]";

type SourceLanding = {
  kind: "github" | "fdroid";
  slug: string;
  name: string;
  version: string;
  /** What the importer made of the file it was handed. */
  status: string;
  /** True when the store points at the upstream file instead of holding one. */
  linked?: boolean;
};

const SOURCE_LABEL: Record<"github" | "fdroid" | "play" | "apkmb", string> = {
  github: "GitHub",
  fdroid: "F-Droid",
  play: "Play",
  apkmb: "apkmb",
};

/** A read of an apkmb page, held while the person decides what to do with it. */
type ApkmbCandidate = {
  listing: ApkmbListing;
  /** Inlined by the route: the icon is on apkmb's CDN and the CSP is `img-src 'self'`. */
  iconDataUrl: string | null;
};

/** Play icons are on Google's CDN and the CSP is `img-src 'self'`. */
function iconSrc(url: string): string {
  return withBasePath(`/api/sources/play/icon?u=${encodeURIComponent(url)}`);
}

export default function AddApp() {
  const [term, setTerm] = useState("");
  const [token, setToken] = useState("");
  const [hits, setHits] = useState<PlayHit[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, PlayAddResult>>({});
  const [landed, setLanded] = useState<SourceLanding | null>(null);
  const [apkmb, setApkmb] = useState<ApkmbCandidate | null>(null);
  const [apkmbDone, setApkmbDone] = useState<string | null>(null);
  const router = useRouter();

  const detected = detectSource(term);

  useEffect(() => setToken(readAdminToken()), []);

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(withBasePath(path), {
        ...init,
        headers: {
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...adminHeaders(token),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          data.error === "This account is not a store admin"
            ? data.error
            : "Sign in to elite-v2 as an admin, or unlock the panel below"
        );
      }
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      return data;
    },
    [token]
  );

  /**
   * Add from a source that serves binaries.
   *
   * The request holds the line for as long as the download takes — a release
   * is hundreds of megabytes and the answer worth having is "it landed, and
   * this is the version", not "started".
   */
  async function addFromSource(kind: "github" | "fdroid", ref: string) {
    setBusy(kind);
    setError(null);
    setLanded(null);
    try {
      const data: GithubAddResult | FdroidAddResult =
        kind === "github"
          ? await call("/api/sources/github", {
              method: "POST",
              body: JSON.stringify({ ref }),
            })
          : await call("/api/sources/fdroid", {
              method: "POST",
              body: JSON.stringify({ packageId: ref }),
            });
      // GitHub reads the release and lets go of it; F-Droid still hands its
      // file to the importer. The two answer "which version" differently.
      setLanded(
        "linked" in data
          ? {
              kind,
              slug: data.slug,
              name: data.name,
              version: data.linked.version,
              status: "ok",
              linked: true,
            }
          : {
              kind,
              slug: data.slug,
              name: data.name,
              version: data.installed.version,
              status: data.installed.status,
            }
      );
      setHits(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Read an apkmb page and show it. Nothing is written by this.
   *
   * The lookup also says whether the catalog already holds the app, which is
   * what turns the one button into either "Add" or "Fill" — and the second is
   * the usual answer, because a mod APK normally reaches the store through the
   * Telegram feed long before anybody thinks to describe it.
   */
  async function lookupApkmb() {
    setBusy("apkmb");
    setError(null);
    setApkmb(null);
    setApkmbDone(null);
    try {
      const data = await call(
        `/api/sources/apkmb?url=${encodeURIComponent(term.trim())}`
      );
      if (!data.listing) throw new Error(data.error ?? "apkmb returned nothing");
      setApkmb({ listing: data.listing, iconDataUrl: data.iconDataUrl ?? null });
      setHits(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  /** Onto the app the store already has — gaps only, which the route enforces. */
  async function fillApkmb(listing: ApkmbListing, slug: string) {
    setBusy("apkmb-write");
    setError(null);
    try {
      const fill: ApkmbFill & { name: string } = await call(
        "/api/sources/apkmb/fill",
        { method: "POST", body: JSON.stringify({ slug, url: listing.url }) }
      );
      const wrote = [
        fill.written.length
          ? `wrote ${fill.written.join(", ")}`
          : "found every field already filled",
        fill.images.icon ? "an icon" : null,
        fill.images.screenshots
          ? `${fill.images.screenshots} screenshot${fill.images.screenshots === 1 ? "" : "s"}`
          : null,
      ].filter(Boolean);
      setApkmbDone(`${fill.name}: ${wrote.join(", ")}.`);
      setApkmb(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  /** Onto a new shelf, with no APK on it until one arrives from somewhere else. */
  async function addApkmb(listing: ApkmbListing) {
    setBusy("apkmb-write");
    setError(null);
    try {
      const result: ApkmbAddResult = await call("/api/sources/apkmb", {
        method: "POST",
        body: JSON.stringify({ url: listing.url }),
      });
      setApkmbDone(
        `${result.name} added as ${result.slug} — ${
          result.images.icon ? "icon" : "no icon"
        }, ${result.images.screenshots} screenshot${
          result.images.screenshots === 1 ? "" : "s"
        }. It has no versions until an APK for it lands.`
      );
      setApkmb(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function search() {
    const q = term.trim();
    if (!q) return;
    setBusy("search");
    setError(null);
    try {
      const data = await call(`/api/sources/play?q=${encodeURIComponent(q)}`);
      setHits(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setHits(null);
    } finally {
      setBusy(null);
    }
  }

  async function add(hit: PlayHit) {
    setBusy(hit.packageId);
    setError(null);
    try {
      const result: PlayAddResult = await call("/api/sources/play", {
        method: "POST",
        body: JSON.stringify({ packageId: hit.packageId }),
      });
      setAdded((prev) => ({ ...prev, [hit.packageId]: result }));
      // The catalog counts and the rows around this panel are rendered by the
      // server component holding it, so they are stale the moment this lands.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={cn(CARD_CLS, "flex flex-col gap-3 p-3.5")}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (detected.kind === "play") void search();
          else if (detected.kind === "apkmb") void lookupApkmb();
          else void addFromSource(detected.kind, detected.ref);
        }}
      >
        <input
          className={INPUT_CLS}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search Play, or paste a GitHub repo, F-Droid or apkmb page"
          autoComplete="off"
        />
        <button
          type="submit"
          className={cn(buttonClass("primary", "sm"), "shrink-0")}
          disabled={busy !== null || !term.trim()}
        >
          {detected.kind === "play" ? (
            <>
              <Search size={13} /> {busy === "search" ? "Searching…" : "Search"}
            </>
          ) : detected.kind === "apkmb" ? (
            <>
              <Search size={13} /> {busy === "apkmb" ? "Reading…" : "Look up"}
            </>
          ) : (
            <>
              <Download size={13} />
              {busy === detected.kind
                ? "Fetching…"
                : `Add from ${SOURCE_LABEL[detected.kind]}`}
            </>
          )}
        </button>
        {/* A bare package id belongs to either store and the address does not
            say which, so both ways stay one click away. */}
        {detected.alternative === "fdroid" && (
          <button
            type="button"
            className={cn(buttonClass("secondary", "sm"), "shrink-0")}
            disabled={busy !== null || !term.trim()}
            onClick={() => void addFromSource("fdroid", detected.ref)}
          >
            <Download size={13} />
            {busy === "fdroid" ? "Fetching…" : "F-Droid"}
          </button>
        )}
      </form>

      <p className={cn("text-xs", MUTED_CLS)}>
        {detected.kind === "play"
          ? "Play supplies the name, description and pictures — never the APK. The entry carries the package id, so the next matching drop attaches itself instead of waiting in the review queue."
          : detected.kind === "apkmb"
            ? "apkmb describes the builds Play has no listing for. The page is read and shown before anything is written, and it goes onto the app the store already has, or onto a new shelf — never over a field somebody filled in by hand."
            : `${SOURCE_LABEL[detected.kind]} serves the binary too: the newest release is downloaded, checked against the app's pinned signer, and put on the shelf as it is added. Large releases take a while — this waits for the file.`}
      </p>

      {landed && (
        <p className={cn("text-xs", MUTED_CLS)}>
          <strong className="font-normal text-[color:var(--fg)]">
            {landed.name}
          </strong>{" "}
          added from {SOURCE_LABEL[landed.kind]} as{" "}
          <Link href={`/app/${landed.slug}`} className="underline">
            {landed.slug}
          </Link>{" "}
          — version {landed.version}{" "}
          {landed.linked
            ? "is linked, and downloads come straight from the release"
            : "is on the shelf"}
          {landed.status === "ok" ? "" : ` (${landed.status})`}.
        </p>
      )}

      {apkmbDone && <p className={cn("text-xs", MUTED_CLS)}>{apkmbDone}</p>}

      {/* Shown before anything is written: a mod mirror describes the build it
          hosts, and whether that description fits the copy this store holds is
          a judgement only somebody looking at both can make. */}
      {apkmb && (
        <div className="flex flex-col gap-2 rounded-[var(--radius)] bg-[var(--card-2)] p-2.5">
          <div className="flex items-center gap-3">
            {apkmb.iconDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- inlined data URL
              <img
                src={apkmb.iconDataUrl}
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 shrink-0 rounded-[12px] object-cover"
              />
            ) : (
              <div className="h-10 w-10 shrink-0 rounded-[12px] bg-[var(--card)]" />
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{apkmb.listing.name}</p>
              <p className={cn("truncate text-xs", MUTED_CLS)}>
                {[
                  apkmb.listing.developer,
                  apkmb.listing.siteVersion,
                  apkmb.listing.rating ? `${apkmb.listing.rating.toFixed(1)}★` : null,
                  apkmb.listing.category,
                  apkmb.listing.packageId,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>

            <button
              type="button"
              className={cn(buttonClass("primary", "sm"), "shrink-0")}
              disabled={busy === "apkmb-write"}
              onClick={() =>
                apkmb.listing.existingSlug
                  ? void fillApkmb(apkmb.listing, apkmb.listing.existingSlug)
                  : void addApkmb(apkmb.listing)
              }
            >
              <Plus size={13} />
              {busy === "apkmb-write"
                ? "Writing…"
                : apkmb.listing.existingSlug
                  ? `Fill ${apkmb.listing.existingSlug}`
                  : "Add"}
            </button>
          </div>

          {apkmb.listing.tagline && (
            <p className="text-xs">{apkmb.listing.tagline}</p>
          )}
          {apkmb.listing.description && (
            <p className={cn("line-clamp-3 text-xs", MUTED_CLS)}>
              {apkmb.listing.description}
            </p>
          )}
          <p className={cn("text-xs", MUTED_CLS)}>
            {apkmb.listing.screenshotUrls.length} screenshot
            {apkmb.listing.screenshotUrls.length === 1 ? "" : "s"}
            {apkmb.listing.existingSlug
              ? " — filling writes only into the fields this app has left empty"
              : " — the shelf is created empty; the APK has to arrive separately"}
            {apkmb.listing.downloadPageUrl
              ? ", and apkmb's own download page for it is "
              : "."}
            {apkmb.listing.downloadPageUrl && (
              <a
                href={apkmb.listing.downloadPageUrl}
                target="_blank"
                rel="noreferrer nofollow"
                className="underline"
              >
                here
              </a>
            )}
            {apkmb.listing.downloadPageUrl ? "." : ""}
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs text-[color:var(--danger,#f87171)]">{error}</p>
      )}

      {hits?.length === 0 && (
        <p className={cn("text-xs", MUTED_CLS)}>Play found nothing for that.</p>
      )}

      {hits && hits.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {hits.map((hit) => {
            const result = added[hit.packageId];
            const slug = result?.slug ?? hit.existingSlug;
            return (
              <li
                key={hit.packageId}
                className="flex items-center gap-3 rounded-[var(--radius)] bg-[var(--card-2)] p-2.5"
              >
                {hit.iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- proxied
                  <img
                    src={iconSrc(hit.iconUrl)}
                    alt=""
                    width={40}
                    height={40}
                    className="h-10 w-10 shrink-0 rounded-[12px] object-cover"
                  />
                ) : (
                  <div className="h-10 w-10 shrink-0 rounded-[12px] bg-[var(--card)]" />
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{hit.name}</p>
                  <p className={cn("truncate text-xs", MUTED_CLS)}>
                    {[
                      hit.developer,
                      hit.score > 0 ? `${hit.score.toFixed(1)}★` : null,
                      hit.packageId,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>

                {slug ? (
                  <Link
                    href={`/app/${slug}`}
                    className={cn(buttonClass("secondary", "sm"), "shrink-0")}
                  >
                    <Check size={13} /> {result ? "Added" : "In catalog"}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className={cn(buttonClass("primary", "sm"), "shrink-0")}
                    disabled={busy === hit.packageId}
                    onClick={() => void add(hit)}
                  >
                    <Plus size={13} />
                    {busy === hit.packageId ? "Adding…" : "Add"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {Object.values(added).map((r) => (
        <p key={r.packageId} className={cn("text-xs", MUTED_CLS)}>
          <strong className="font-normal text-[color:var(--fg)]">{r.name}</strong>{" "}
          added as <code>{r.slug}</code> — {r.images.icon ? "icon" : "no icon"},{" "}
          {r.images.screenshots} screenshot
          {r.images.screenshots === 1 ? "" : "s"}. It has no versions until an
          APK for <code>{r.packageId}</code> lands.
        </p>
      ))}
    </div>
  );
}
