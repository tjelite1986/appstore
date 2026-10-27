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
 * The same address serves two different clients, and the second one needs one
 * thing more. Obtainium reads the unsigned `index.xml` and takes the URL as it
 * stands; a real F-Droid client reads the signed `index-v1.jar` and wants the
 * key's fingerprint alongside, so that a repository it fetches over someone
 * else's network is still the repository it subscribed to. Hence two tabs over
 * one address: one plain, one with `?fingerprint=`. The second appears only
 * once something has actually been signed.
 *
 * A URL on a laptop screen is a thing to be typed into a phone, which is the
 * one thing nobody wants to do with eighty characters of hex — so the card
 * draws it as a QR code too. F-Droid clients scan one natively; Obtainium
 * takes the address through the phone's camera app. Drawn in the browser
 * (`qrcode-generator`, no dependencies) because the plain address depends on
 * the browser's origin when the deployment has not pinned one; rendered as
 * one SVG path from the module grid rather than the library's own markup, so
 * nothing is injected as HTML.
 *
 * The address comes from the deployment when it pins one (FDROID_PUBLIC_URL —
 * see lib/fdroid-url.ts), because that is the address the signed index names
 * and this card must hand out the same one. Otherwise it is read off the
 * browser: the value has to be exactly what a phone on this network would
 * type, and the page it is shown on is already at that address, plus the
 * mount prefix — see lib/base-path.ts.
 */
import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import {
  Check,
  Copy,
  Download,
  QrCode,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MUTED, NOTE, Panel, Pill, buttonClass } from "@/components/primitives";
import { withBasePath } from "@/lib/base-path";

type Client = "obtainium" | "fdroid";

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
  const [client, setClient] = useState<Client>("obtainium");
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);
  // A pinned address wins: the signed index names that one, and this card has
  // to hand out the same URL the index vouches for. Without one, the browser's
  // origin plus the mount prefix — `current` is an app path, and everything
  // below the prefix belongs to this app.
  const plainUrl = baseUrl
    ? `${baseUrl}${current}`
    : origin
      ? `${origin}${withBasePath(current)}`
      : "";
  // What an F-Droid client is given: the same address, plus the key it should
  // insist on. Uppercase hex with no separators is the form those clients
  // parse — see scripts/fdroid-sign.sh, which is where the value comes from.
  const fdroidUrl =
    plainUrl && fingerprint ? `${plainUrl}?fingerprint=${fingerprint}` : "";
  const url = client === "fdroid" ? fdroidUrl : plainUrl;

  const qr = useMemo(() => {
    if (!showQr || !url) return null;
    try {
      const code = qrcode(0, "M");
      code.addData(url);
      code.make();
      const n = code.getModuleCount();
      let d = "";
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (code.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
        }
      }
      return { n, d };
    } catch (err) {
      console.error("[repo] could not draw the QR code:", err);
      return null;
    }
  }, [showQr, url]);

  async function copy() {
    setFailed(null);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      // Clipboard access needs a secure context, which a plain-http visit on
      // the LAN is not. The URL is on screen either way.
      console.error("[repo] could not copy the URL:", err);
      setFailed("Could not copy — select the address and copy it by hand.");
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
    setFailed(null);
    setBusy(true);
    try {
      const res = await fetch(withBasePath("/api/me/repo"), { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { token } = (await res.json()) as { token: string };
      setCurrent(`/fdroid/t/${token}/repo`);
    } catch (err) {
      console.error("[repo] could not replace the token:", err);
      setFailed("Could not replace the URL.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      icon={Smartphone}
      title="On your phone"
      aside={
        signedIn ? (
          <Pill tone="accent">your account</Pill>
        ) : (
          <Pill>signed-out shelf</Pill>
        )
      }
      description={
        signedIn
          ? "This store is an F-Droid repository. Add the address to Obtainium or an F-Droid client and the phone installs and updates from here. It carries your account — treat it like a password."
          : "This store is an F-Droid repository. The address below is the open shelf, Adults excluded. Sign in for one of your own, with your saved and installed lists behind it."
      }
    >
      <div className="flex flex-col gap-3">
        {/* Two clients, one address: the tabs pick which form is shown. */}
        {fingerprint && (
          <div
            role="tablist"
            className="flex w-fit gap-1 rounded-full border border-[color:var(--border)] bg-[var(--card-2)] p-0.5"
          >
            {(
              [
                ["obtainium", "Obtainium"],
                ["fdroid", "F-Droid client"],
              ] as [Client, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={client === key}
                onClick={() => setClient(key)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition",
                  client === key
                    ? "bg-[var(--accent)] text-white"
                    : "text-[color:var(--muted-2)] hover:text-[color:var(--fg)]"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[color:var(--border)] bg-black/25 p-3">
          <p className={cn("text-[11px] font-medium uppercase tracking-wide", MUTED)}>
            {client === "fdroid" ? "Repository address with fingerprint" : "Repository address"}
          </p>
          <p className="break-all font-mono text-xs leading-relaxed">
            {url || " "}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => void copy()}
              disabled={!url}
              className={cn(buttonClass("secondary", "sm"), "disabled:opacity-50")}
            >
              {copied ? (
                <Check size={13} className="text-[color:var(--accent-text)]" />
              ) : (
                <Copy size={13} />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={() => setShowQr((v) => !v)}
              disabled={!url}
              aria-pressed={showQr}
              className={cn(buttonClass("secondary", "sm"), "disabled:opacity-50")}
            >
              <QrCode size={13} /> {showQr ? "Hide QR" : "Show QR"}
            </button>
          </div>
        </div>

        {showQr && qr && (
          <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-start sm:gap-4">
            {/* White plate on purpose: a QR code on a dark page does not scan. */}
            <div className="w-44 shrink-0 rounded-[var(--radius)] bg-white p-3">
              <svg
                viewBox={`0 0 ${qr.n} ${qr.n}`}
                shapeRendering="crispEdges"
                role="img"
                aria-label="QR code of the repository address"
                className="block h-auto w-full"
              >
                <path d={qr.d} fill="#000" />
              </svg>
            </div>
            <p className={cn("text-center sm:text-left", NOTE)}>
              {client === "fdroid"
                ? "In Droid-ify or Neo Store: Repositories → add → scan. The fingerprint rides along, so the client refuses an index signed by any other key."
                : "Point the phone's camera at it and open the link, or in Obtainium: Add app → paste the address as a third-party F-Droid repository."}
            </p>
          </div>
        )}

        {client === "fdroid" && fingerprint && (
          <div className="flex flex-col gap-1">
            <p className={cn("text-[11px] font-medium uppercase tracking-wide", MUTED)}>
              Signing key fingerprint
            </p>
            <p className="break-all font-mono text-[11px] leading-relaxed text-[color:var(--muted-2)]">
              {fingerprint.replace(/(.{4})/g, "$1 ").trim()}
            </p>
          </div>
        )}

        <ul className="divide-y divide-[color:var(--border)] rounded-[var(--radius)] border border-[color:var(--border)]">
          <li>
            <a
              href={withBasePath(`${current}/obtainium.json`)}
              className="flex items-center gap-3 px-3.5 py-3 transition hover:bg-[var(--card-2)]"
            >
              <Download size={16} className="shrink-0 text-[color:var(--muted-2)]" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Import file for Obtainium</span>
                <span className={cn("block", NOTE)}>
                  Every app on the shelf in one file. Obtainium → Import/Export → import.
                </span>
              </span>
            </a>
          </li>
          {signedIn && (
            <li>
              <button
                type="button"
                onClick={() => void rotate()}
                disabled={busy}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-[var(--card-2)] disabled:opacity-60"
              >
                <RefreshCw
                  size={16}
                  className={cn(
                    "shrink-0 text-[color:var(--muted-2)]",
                    busy && "animate-spin"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Replace this address</span>
                  <span className={cn("block", NOTE)}>
                    Revokes the old one. Every device using it has to be re-added.
                  </span>
                </span>
              </button>
            </li>
          )}
        </ul>

        {fingerprint ? (
          <p className={NOTE}>
            Obtainium handles the apps you point it at, one at a time. An
            F-Droid client such as Droid-ify or Neo Store lists the whole shelf
            and tells you about apps you have never installed.
          </p>
        ) : null}

        {failed && <p className="text-xs text-[color:var(--danger)]">{failed}</p>}
      </div>
    </Panel>
  );
}
