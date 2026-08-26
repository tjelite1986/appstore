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
 * The same URL serves two different clients from the same row, and the second
 * one needs one thing more. Obtainium reads the unsigned `index.xml` and takes
 * the URL as it stands; a real F-Droid client reads the signed `index-v1.jar`
 * and wants the key's fingerprint alongside, so that a repository it fetches
 * over someone else's network is still the repository it subscribed to. Hence
 * two rows carrying the same address: one plain, one with `?fingerprint=`.
 * The second appears only once something has actually been signed.
 *
 * The address comes from the deployment when it pins one (FDROID_PUBLIC_URL —
 * see lib/fdroid-url.ts), because that is the address the signed index names
 * and this row must hand out the same one. Otherwise it is read off the
 * browser: the value has to be exactly what a phone on this network would
 * type, and the page it is shown on is already at that address, plus the
 * mount prefix — see lib/base-path.ts.
 *
 * Hand-rolled like `adults-toggle.tsx`, and for the same reason — this needs
 * state, and `rows.tsx` is imported by server components.
 */
import { useEffect, useState } from "react";
import {
  Copy,
  Check,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD, MUTED, SectionTitle } from "@/components/primitives";
import { withBasePath } from "@/lib/base-path";

const ROW = "flex w-full items-center gap-3 px-3.5 py-3 text-left";

export default function RepoUrl({
  path,
  signedIn,
  fingerprint,
  baseUrl,
}: {
  path: string;
  signedIn: boolean;
  /** Null until the signing job has run at least once. */
  fingerprint: string | null;
  /** Set when the deployment pins where the repository answers. */
  baseUrl?: string;
}) {
  const [current, setCurrent] = useState(path);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<"repo" | "fdroid" | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);
  // A pinned address wins: the signed index names that one, and this row has
  // to hand out the same URL the index vouches for. Without one, the browser's
  // origin plus the mount prefix — `current` is an app path, and everything
  // below the prefix belongs to this app.
  const url = baseUrl
    ? `${baseUrl}${current}`
    : origin
      ? `${origin}${withBasePath(current)}`
      : "";
  // What an F-Droid client is given: the same address, plus the key it should
  // insist on. Uppercase hex with no separators is the form those clients
  // parse — see scripts/fdroid-sign.sh, which is where the value comes from.
  const fdroidUrl = url && fingerprint ? `${url}?fingerprint=${fingerprint}` : "";

  async function copy(which: "repo" | "fdroid") {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(which === "repo" ? url : fdroidUrl);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
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
      const res = await fetch(withBasePath("/api/me/repo"), { method: "POST" });
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
          onClick={() => void copy("repo")}
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
          {copied === "repo" ? (
            <Check size={15} className="shrink-0 text-[color:var(--accent)]" />
          ) : (
            <Copy size={15} className="shrink-0 opacity-40" />
          )}
        </button>

        {fingerprint && (
          <button
            type="button"
            onClick={() => void copy("fdroid")}
            disabled={!fdroidUrl}
            className={cn(
              ROW,
              "border-t border-[color:var(--border)] disabled:opacity-60"
            )}
          >
            <ShieldCheck
              size={17}
              className="shrink-0 text-[color:var(--muted-2)]"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                F-Droid client URL
              </span>
              <span
                className={cn("block truncate font-mono text-[11px]", MUTED)}
                title={fdroidUrl}
              >
                {fingerprint}
              </span>
            </span>
            {copied === "fdroid" ? (
              <Check size={15} className="shrink-0 text-[color:var(--accent)]" />
            ) : (
              <Copy size={15} className="shrink-0 opacity-40" />
            )}
          </button>
        )}

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
        {fingerprint
          ? " The second URL is for an F-Droid client such as Droid-ify or Neo Store, which lists the whole shelf and tells you about apps you have never installed."
          : ""}
      </p>
      {failed && (
        <p className="mt-2 text-xs text-[color:var(--danger,#f87171)]">
          That did not work.
        </p>
      )}
    </section>
  );
}
