"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/primitives";
import { adminHeaders, readAdminToken } from "@/lib/admin-token";
import type { PlayAddResult, PlayHit } from "@/lib/sources/play";

/**
 * "Add an app" — search Google Play, and put the listing on the shelf.
 *
 * What this creates has no APK in it, and that is the point. An entry carries
 * the package id, and the importer matches a dropped file on exactly that, so
 * describing the app first is what stops the next download parking as "no
 * matching app". The binary arrives from wherever it comes from; Play only
 * supplies the words and the pictures.
 *
 * Its own file because "use client" is file-wide — see `thumb-image.tsx`.
 */

const CARD_CLS =
  "bg-[var(--card)] rounded-[var(--radius)] border border-[color:var(--border)]";
const MUTED_CLS = "text-[color:var(--muted)]";
const INPUT_CLS =
  "w-full rounded-full border border-[color:var(--border)] bg-[var(--card-2)] px-4 py-2 text-sm outline-none focus:border-[color:var(--accent)]";

/** Play icons are on Google's CDN and the CSP is `img-src 'self'`. */
function iconSrc(url: string): string {
  return `/api/sources/play/icon?u=${encodeURIComponent(url)}`;
}

export default function AddApp() {
  const [term, setTerm] = useState("");
  const [token, setToken] = useState("");
  const [hits, setHits] = useState<PlayHit[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, PlayAddResult>>({});
  const router = useRouter();

  useEffect(() => setToken(readAdminToken()), []);

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(path, {
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
          void search();
        }}
      >
        <input
          className={INPUT_CLS}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search Google Play, or paste a package id"
          autoComplete="off"
        />
        <button
          type="submit"
          className={cn(buttonClass("primary", "sm"), "shrink-0")}
          disabled={busy === "search" || !term.trim()}
        >
          <Search size={13} /> {busy === "search" ? "Searching…" : "Search"}
        </button>
      </form>

      <p className={cn("text-xs", MUTED_CLS)}>
        Play supplies the name, description and pictures — never the APK. The
        entry carries the package id, so the next matching drop attaches itself
        instead of waiting in the review queue.
      </p>

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
