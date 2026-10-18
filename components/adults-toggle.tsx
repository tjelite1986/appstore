"use client";

/**
 * The 18+ gate, from the one screen that admits it exists.
 *
 * Off, the Adults category is not merely hidden from the tiles: the apps are
 * absent from every list, their pages are 404 and their APKs will not download.
 * So this is not a display preference — but it is answered where every other
 * preference is, as one switch in a settings row, because a card of its own
 * reads as a warning and invites the click it is trying to slow down.
 *
 * Turning it on asks first. Turning it off does not — a gate should never be
 * harder to close than to open.
 *
 * Hand-rolled rather than a shared row component: switching it needs state,
 * and the shared pieces are imported by server components that must stay
 * server-rendered.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { MUTED, NOTE, Panel } from "@/components/primitives";
import { withBasePath } from "@/lib/base-path";

export default function AdultsToggle({
  on,
  signedIn,
}: {
  on: boolean;
  signedIn: boolean;
}) {
  const [allowed, setAllowed] = useState(on);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function set(next: boolean) {
    if (
      next &&
      !confirm(
        "Show apps filed under Adults? Confirm only if you are 18 or older."
      )
    ) {
      return;
    }
    setFailed(false);
    try {
      const res = await fetch(withBasePath("/api/me/adults"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAllowed(next);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("[adults] could not save the answer:", err);
      setFailed(true);
    }
  }

  return (
    <Panel
      icon={ShieldAlert}
      title="Content"
      description="What the shelf is allowed to show this account."
      flush
    >
      <button
        type="button"
        onClick={() => void set(!allowed)}
        disabled={!signedIn || pending}
        aria-pressed={allowed}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--card-2)] disabled:opacity-60 disabled:hover:bg-transparent"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Show 18+ apps</span>
          <span className={cn("block", NOTE)}>
            {signedIn
              ? allowed
                ? "On. Apps filed under Adults are on the shelf, in search and in your repository."
                : "Off. Apps filed under Adults are absent everywhere — not hidden, absent."
              : "Sign in to answer this. A signed-out visitor never sees the Adults shelf."}
          </span>
        </span>
        {signedIn ? null : (
          <span className={cn("shrink-0 text-xs", MUTED)}>Sign in</span>
        )}
        <span
          className={cn(
            "flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors",
            allowed ? "bg-[var(--accent)]" : "bg-[var(--card-2)]"
          )}
        >
          <span
            className={cn(
              "h-5 w-5 rounded-full bg-white shadow transition-transform",
              allowed && "translate-x-5"
            )}
          />
        </span>
      </button>
      {failed && (
        <p className="px-4 pb-3 text-xs text-[color:var(--danger)]">
          Could not save that.
        </p>
      )}
    </Panel>
  );
}
