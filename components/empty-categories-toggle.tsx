"use client";

/**
 * Whether custom categories that hold nothing still get a tile and a chip.
 *
 * A display preference, unlike the 18+ switch beside it: nothing is gated by
 * it, so it switches both ways without asking.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { MUTED, NOTE, Panel } from "@/components/primitives";
import { withBasePath } from "@/lib/base-path";

export default function EmptyCategoriesToggle({
  on,
  signedIn,
}: {
  on: boolean;
  signedIn: boolean;
}) {
  const [shown, setShown] = useState(on);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function set(next: boolean) {
    setFailed(false);
    try {
      const res = await fetch(withBasePath("/api/me/empty-categories"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setShown(next);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("[empty-categories] could not save the answer:", err);
      setFailed(true);
    }
  }

  return (
    <Panel
      icon={LayoutGrid}
      title="Browsing"
      description="How the category tiles and chips are drawn for this account."
      flush
    >
      <button
        type="button"
        onClick={() => void set(!shown)}
        disabled={!signedIn || pending}
        aria-pressed={shown}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--card-2)] disabled:opacity-60 disabled:hover:bg-transparent"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Show empty categories</span>
          <span className={cn("block", NOTE)}>
            {signedIn
              ? shown
                ? "On. A custom category with nothing in it still has a tile and a chip, leading to an empty list."
                : "Off. A custom category with nothing in it is left out until something is filed there."
              : "Sign in to change this. Empty categories are left out."}
          </span>
        </span>
        {signedIn ? null : (
          <span className={cn("shrink-0 text-xs", MUTED)}>Sign in</span>
        )}
        <span
          className={cn(
            "flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors",
            shown ? "bg-[var(--accent)]" : "bg-[var(--card-2)]"
          )}
        >
          <span
            className={cn(
              "h-5 w-5 rounded-full bg-white shadow transition-transform",
              shown && "translate-x-5"
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
