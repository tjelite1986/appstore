"use client";

/**
 * The 18+ gate, from the one screen that admits it exists.
 *
 * Off, the Adults category is not merely hidden from the tiles: the apps are
 * absent from every list, their pages are 404 and their APKs will not download.
 * So this is not a display preference, and the copy does not pretend it is.
 *
 * Turning it on asks first. Turning it off does not — a gate should never be
 * harder to close than to open.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClass, CARD, MUTED, SectionTitle } from "@/components/primitives";

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
      const res = await fetch("/api/me/adults", {
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
      <div className={cn(CARD, "space-y-2 p-3")}>
        <div className="flex items-center gap-2">
          {allowed ? (
            <ShieldOff size={17} className="shrink-0 text-[color:var(--muted-2)]" />
          ) : (
            <ShieldCheck size={17} className="shrink-0 text-[color:var(--muted-2)]" />
          )}
          <span className="min-w-0 flex-1 text-sm">Adult apps</span>
          <span className={cn("shrink-0 text-xs", MUTED)}>
            {allowed ? "Shown" : "Hidden"}
          </span>
        </div>
        <p className={cn("text-[11px] leading-relaxed", MUTED)}>
          {signedIn
            ? "While this is off, apps filed under Adults are left out of every list, their pages are not found and their downloads are refused."
            : "Sign in to answer this. A browser nobody is signed in on never sees apps filed under Adults."}
        </p>
        {signedIn && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => void set(!allowed)}
              disabled={pending}
              className={cn(
                buttonClass(allowed ? "secondary" : "primary", "sm"),
                "disabled:opacity-60"
              )}
            >
              {allowed ? "Hide adult apps" : "I am 18 or older"}
            </button>
            {failed && (
              <span className="text-xs text-[color:var(--danger,#f87171)]">
                Could not save that.
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
