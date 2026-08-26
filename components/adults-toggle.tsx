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
 * The row is hand-rolled rather than a `RowCard`: switching it needs state, and
 * `rows.tsx` is imported by server components that must stay server-rendered.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD, MUTED, SectionTitle } from "@/components/primitives";
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
    <section className="px-[var(--pad)]">
      <SectionTitle title="Content" />
      <div className={cn(CARD, "overflow-hidden")}>
        <button
          type="button"
          onClick={() => void set(!allowed)}
          disabled={!signedIn || pending}
          aria-pressed={allowed}
          className="flex w-full items-center gap-3 px-3.5 py-3 text-left disabled:opacity-60"
        >
          <ShieldAlert
            size={17}
            className="shrink-0 text-[color:var(--muted-2)]"
          />
          <span className="min-w-0 flex-1 truncate text-sm">Show 18+ apps</span>
          {signedIn ? null : (
            <span className={cn("shrink-0 truncate text-xs", MUTED)}>
              Sign in
            </span>
          )}
          <span
            className={cn(
              "flex h-5 w-9 shrink-0 items-center rounded-full px-0.5",
              allowed ? "bg-[var(--accent)]" : "bg-[var(--card-2)]"
            )}
          >
            <span
              className={cn(
                "h-4 w-4 rounded-full bg-white transition",
                allowed && "translate-x-4"
              )}
            />
          </span>
        </button>
      </div>
      {failed && (
        <p className="mt-2 text-xs text-[color:var(--danger,#f87171)]">
          Could not save that.
        </p>
      )}
    </section>
  );
}
