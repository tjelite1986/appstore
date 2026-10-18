"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/primitives";
import { adminCall } from "@/lib/admin-call";
import { readAdminToken } from "@/lib/admin-token";

/**
 * One button on a Behind row: stop comparing this app with Play, or start again.
 *
 * It is for the row that is behind because it is a modified build — Play says
 * 14.0.43, the library holds "v5.2 mod", and no fetch is going to reconcile
 * them. Pressing it writes the decision onto the listing and refreshes the
 * page, which moves the row to the card's "not tracked" foot, where the same
 * button undoes it.
 */
export default function TrackUpstreamButton({
  slug,
  name,
  track,
}: {
  slug: string;
  name: string;
  /** What pressing the button does: false hides the app, true tracks it again. */
  track: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await adminCall(
        "/api/sources/track",
        { method: "POST", body: JSON.stringify({ slug, track }) },
        readAdminToken(),
        { hint: "Sign in as an admin, or unlock the import panel" },
      );
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || pending;
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={disabled}
        title={
          track
            ? `Compare ${name} with Play again`
            : `${name} is a modified build — stop comparing it with Play`
        }
        className={cn(buttonClass("ghost", "sm"), disabled && "opacity-50")}
      >
        {track ? <Eye size={13} /> : <EyeOff size={13} />}
        {track ? "Track again" : "Not a Play build"}
      </button>
      {error && (
        <span
          className="max-w-[16rem] truncate text-[11px] text-[color:var(--danger)]"
          title={error}
        >
          {error}
        </span>
      )}
    </span>
  );
}
