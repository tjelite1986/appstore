"use client";

/**
 * Handing someone else the app.
 *
 * Two addresses, because they answer different questions. The page is what to
 * send a person: it renders a preview in whatever they are reading it in (see
 * `generateMetadata` in the detail page), and it still works when the app has
 * no file here yet. The download is what to send a phone: it is the APK
 * itself, served as an attachment, so tapping it in a chat starts the install
 * rather than opening a store.
 *
 * The download address deliberately drops the `?v=` the Install button
 * carries. That button is the version on screen; a link that outlives the
 * conversation it was pasted into should be the newest one the store has, and
 * the route already treats a missing version that way.
 *
 * Both are built from `window.location.origin` rather than passed in from the
 * server: this has to be exactly the address the person reading it can reach,
 * and that is the one their browser is already on. `withBasePath` covers the
 * mount prefix, which Next does not add to a string we assemble ourselves —
 * see `lib/base-path.ts`.
 *
 * Its own file because "use client" is file-wide, and the detail page is a
 * server component.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2, Share2, Smartphone, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD, MUTED, buttonClass } from "@/components/primitives";
import { withBasePath } from "@/lib/base-path";

const ROW = "flex w-full items-center gap-3 px-3.5 py-2.5 text-left";

type Target = "page" | "file";

export default function ShareApp({
  slug,
  name,
  hasFile,
  externalUrl,
}: {
  slug: string;
  name: string;
  /** True when the store holds an APK for this app and can serve it itself. */
  hasFile: boolean;
  /**
   * Where the binary lives when it is not here — a linked GitHub release. The
   * store has no file to hand out for these, but there is still a download to
   * pass on, so it is offered under the same heading.
   */
  externalUrl?: string;
}) {
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState("");
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState<Target | null>(null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Both read the browser, so both wait for it: rendering them on the server
  // would mean an origin of nothing and a share button that is wrong about
  // whichever device is not the one that rendered it.
  useEffect(() => {
    setOrigin(window.location.origin);
    setCanShare(typeof navigator !== "undefined" && "share" in navigator);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onDown(e: PointerEvent) {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    // Capture, so a click that lands on something else closes this before
    // that something else acts on it.
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  const pageUrl = origin ? `${origin}${withBasePath(`/app/${slug}`)}` : "";
  const fileUrl = hasFile
    ? origin
      ? `${origin}${withBasePath(`/api/download/${encodeURIComponent(slug)}`)}`
      : ""
    : (externalUrl ?? "");

  async function copy(which: Target) {
    const url = which === "page" ? pageUrl : fileUrl;
    if (!url) return;
    setFailed(false);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch (err) {
      // Clipboard access needs a secure context, which a plain-http visit on
      // the LAN is not. The URL is on screen either way.
      console.error("[share] could not copy the URL:", err);
      setFailed(true);
    }
  }

  async function shareSheet() {
    try {
      await navigator.share({ title: name, url: pageUrl });
      setOpen(false);
    } catch (err) {
      // Dismissing the sheet rejects too, and that is not a failure worth
      // reporting — the rows below it still work.
      if ((err as Error)?.name !== "AbortError") {
        console.error("[share] the share sheet refused:", err);
      }
    }
  }

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        aria-label="Share"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={buttonClass("secondary")}
      >
        <Share2 size={15} />
      </button>

      {open && (
        <div
          className={cn(
            CARD,
            "absolute right-0 top-full z-30 mt-2 w-[min(21rem,calc(100vw-2rem))] overflow-hidden shadow-xl"
          )}
        >
          <button
            type="button"
            onClick={() => void copy("page")}
            disabled={!pageUrl}
            className={cn(ROW, "disabled:opacity-60")}
          >
            <Link2 size={17} className="shrink-0 text-[color:var(--muted-2)]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">Link to this page</span>
              <span className={cn("block truncate text-[11px]", MUTED)}>
                Shows the app with its icon and blurb
              </span>
            </span>
            {copied === "page" ? (
              <Check size={15} className="shrink-0 text-[color:var(--accent)]" />
            ) : (
              <Copy size={15} className="shrink-0 opacity-40" />
            )}
          </button>

          {(hasFile || externalUrl) && (
            <button
              type="button"
              onClick={() => void copy("file")}
              disabled={!fileUrl}
              className={cn(
                ROW,
                "border-t border-[color:var(--border)] disabled:opacity-60"
              )}
            >
              <Smartphone
                size={17}
                className="shrink-0 text-[color:var(--muted-2)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  Direct download link
                </span>
                <span className={cn("block truncate text-[11px]", MUTED)}>
                  {hasFile
                    ? "Always the newest version — installs on tap"
                    : "Downloads from where this app is published"}
                </span>
              </span>
              {copied === "file" ? (
                <Check
                  size={15}
                  className="shrink-0 text-[color:var(--accent)]"
                />
              ) : (
                <Copy size={15} className="shrink-0 opacity-40" />
              )}
            </button>
          )}

          {canShare && (
            <button
              type="button"
              onClick={() => void shareSheet()}
              disabled={!pageUrl}
              className={cn(
                ROW,
                "border-t border-[color:var(--border)] disabled:opacity-60"
              )}
            >
              <Upload
                size={17}
                className="shrink-0 text-[color:var(--muted-2)]"
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                Share the page&hellip;
              </span>
            </button>
          )}

          {failed && (
            <p className="border-t border-[color:var(--border)] px-3.5 py-2.5 text-[11px] text-[color:var(--danger,#f87171)]">
              Could not copy. Long-press the address bar instead.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
