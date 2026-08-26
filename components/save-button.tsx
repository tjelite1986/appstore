"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClass, type ButtonSize } from "@/components/primitives";
import { withBasePath } from "@/lib/base-path";

/**
 * The bookmark, for a signed-in account.
 *
 * Optimistic: the icon fills on the tap and rolls back if the write is
 * refused, because the alternative on a phone is a button that appears to do
 * nothing for as long as the round trip takes. The request states the
 * resulting value rather than asking for a toggle, so a retry lands where the
 * button already shows.
 *
 * `router.refresh()` afterwards is what keeps the rest of the page honest —
 * the Saved screen and the count in the header are rendered on the server from
 * the same rows this just changed.
 */
export default function SaveButton({
  slug,
  initialSaved,
  size = "md",
  label = false,
}: {
  slug: string;
  initialSaved: boolean;
  size?: ButtonSize;
  /** Show the word beside the icon — the detail page has room, a tile does not. */
  label?: boolean;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function toggle() {
    const next = !saved;
    setSaved(next);
    setFailed(false);
    try {
      const res = await fetch(withBasePath("/api/me/saved"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, saved: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("[saved] could not write:", err);
      setSaved(!next);
      setFailed(true);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={saved ? "Remove from saved" : "Save for later"}
      title={failed ? "Could not save — try again" : undefined}
      className={cn(
        buttonClass("secondary", size),
        "transition",
        saved && "text-[color:var(--accent-text)]",
        failed && "border-red-500/60",
        pending && "opacity-70"
      )}
    >
      <Bookmark size={size === "sm" ? 13 : 15} className={cn(saved && "fill-current")} />
      {label && (saved ? "Saved" : "Save")}
    </button>
  );
}
