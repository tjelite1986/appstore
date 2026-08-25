"use client";

/**
 * Where the phone goes, from the screen that keeps the rest of the account.
 *
 * The store has no Android client of its own and does not need one: it speaks
 * F-Droid's repository format, so Obtainium subscribes to it and handles
 * search, installs and background update checks. All that leaves is telling
 * someone the URL — which carries their token, so it is theirs and not to be
 * shared (see `lib/repo-token.ts`).
 *
 * The origin is read off the browser rather than passed down from the server:
 * the value has to be exactly what a phone on this network would type, and
 * the page it is shown on is already at that address.
 *
 * Hand-rolled like `adults-toggle.tsx`, and for the same reason — this needs
 * state, and `rows.tsx` is imported by server components.
 */
import { useEffect, useState } from "react";
import { Copy, Check, RefreshCw, Smartphone, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD, MUTED, SectionTitle } from "@/components/primitives";

const ROW = "flex w-full items-center gap-3 px-3.5 py-3 text-left";

export default function RepoUrl({
  path,
  signedIn,
}: {
  path: string;
  signedIn: boolean;
}) {
  const [current, setCurrent] = useState(path);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);
  const url = origin ? `${origin}${current}` : "";

  async function copy() {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      // Clipboard access needs a secure context, which a plain-http visit on
      // the LAN is not. The URL is on screen either way.
      console.error("[repo] could not copy the URL:", err);
      setFailed(true);
    }
  }

  async function rotate() {
    if (
      !confirm(
        "Replace this URL? Any device already using the old one stops seeing updates until it is re-added."
      )
    ) {
      return;
    }
    setFailed(false);
    setBusy(true);
    try {
      const res = await fetch("/api/me/repo", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { token } = (await res.json()) as { token: string };
      setCurrent(`/fdroid/t/${token}/repo`);
    } catch (err) {
      console.error("[repo] could not replace the token:", err);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="px-[var(--pad)]">
      <SectionTitle title="Android" />
      <div className={cn(CARD, "overflow-hidden")}>
        <button
          type="button"
          onClick={() => void copy()}
          disabled={!url}
          className={cn(ROW, "disabled:opacity-60")}
        >
          <Smartphone
            size={17}
            className="shrink-0 text-[color:var(--muted-2)]"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">Repository URL</span>
            <span
              className={cn("block truncate font-mono text-[11px]", MUTED)}
              // Shown whole on a screen wide enough, truncated rather than
              // masked otherwise: a URL that cannot be read cannot be typed
              // into a phone, which is the only thing anyone does with it.
              title={url}
            >
              {url || " "}
            </span>
          </span>
          {copied ? (
            <Check size={15} className="shrink-0 text-[color:var(--accent)]" />
          ) : (
            <Copy size={15} className="shrink-0 opacity-40" />
          )}
        </button>

        <a
          href={`${current}/obtainium.json`}
          className={cn(ROW, "border-t border-[color:var(--border)]")}
        >
          <Download size={17} className="shrink-0 text-[color:var(--muted-2)]" />
          <span className="min-w-0 flex-1 truncate text-sm">
            Import file for Obtainium
          </span>
          <span className={cn("shrink-0 truncate text-xs", MUTED)}>
            Every app at once
          </span>
        </a>

        {signedIn && (
          <button
            type="button"
            onClick={() => void rotate()}
            disabled={busy}
            className={cn(
              ROW,
              "border-t border-[color:var(--border)] disabled:opacity-60"
            )}
          >
            <RefreshCw
              size={17}
              className="shrink-0 text-[color:var(--muted-2)]"
            />
            <span className="min-w-0 flex-1 truncate text-sm">
              Replace this URL
            </span>
            <span className={cn("shrink-0 truncate text-xs", MUTED)}>
              {busy ? "Working" : "Revokes the old one"}
            </span>
          </button>
        )}
      </div>
      <p className={cn("mt-2 text-xs", MUTED)}>
        {signedIn
          ? "Add the URL to Obtainium as a third-party F-Droid repository, one app at a time — or take the import file to get all of them in one go. Both carry your account, so treat them like a password."
          : "Add the URL to Obtainium as a third-party F-Droid repository. Sign in for one of your own — this is what a signed-out visitor sees."}
      </p>
      {failed && (
        <p className="mt-2 text-xs text-[color:var(--danger,#f87171)]">
          That did not work.
        </p>
      )}
    </section>
  );
}
