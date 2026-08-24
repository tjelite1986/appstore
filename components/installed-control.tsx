"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, PackageCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD, MUTED, buttonClass } from "@/components/primitives";

/**
 * "What you have", on the detail page.
 *
 * A web page cannot see what is on the phone, so this is a claim the person
 * makes rather than something discovered — and saying so is better than a
 * checkmark that pretends to know. It earns its place on the Updates screen:
 * the library knows the newest file, this row knows which one they took, and
 * an update is the difference.
 *
 * The download itself is left alone. It is a plain link so the browser's own
 * download manager handles it and an interrupted transfer resumes, and
 * intercepting the click to record something would give that up.
 */
export default function InstalledControl({
  slug,
  latest,
  initialVersion,
}: {
  slug: string;
  /** The newest version in the library, or null when there is no APK yet. */
  latest: string | null;
  initialVersion: string | null;
}) {
  const [version, setVersion] = useState(initialVersion);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function record(next: string | null) {
    const previous = version;
    setVersion(next);
    setFailed(false);
    try {
      const res = await fetch("/api/me/installed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, version: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("[installed] could not write:", err);
      setVersion(previous);
      setFailed(true);
    }
  }

  const behind = version && latest && version !== latest;

  return (
    <div className="px-[var(--pad)]">
      <div className={cn(CARD, "flex items-center gap-3 px-3.5 py-3")}>
        <PackageCheck
          size={18}
          className={cn("shrink-0", version ? "text-[color:var(--accent-text)]" : MUTED)}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {version ? `You have ${version}` : "Not on your device"}
          </p>
          <p className={cn("truncate text-[11px]", MUTED)}>
            {failed
              ? "Could not save that — try again"
              : behind
                ? `${latest} is in the library`
                : version
                  ? "Up to date"
                  : "Mark it once you have installed the file"}
          </p>
        </div>

        {latest && version !== latest && (
          <button
            type="button"
            onClick={() => record(latest)}
            disabled={pending}
            className={cn(buttonClass("secondary", "sm"), pending && "opacity-70")}
          >
            <Check size={13} /> {behind ? `Now on ${latest}` : "I have this"}
          </button>
        )}

        {version && (
          <button
            type="button"
            onClick={() => record(null)}
            disabled={pending}
            aria-label="Forget that this is installed"
            title="Forget that this is installed"
            className={cn(buttonClass("ghost", "sm"), pending && "opacity-70")}
          >
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
