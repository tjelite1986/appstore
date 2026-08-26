"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/primitives";
import { withBasePath } from "@/lib/base-path";

/**
 * Drop everything this store remembers about the account.
 *
 * It asks first — the rows are cheap to lose but tedious to rebuild, and there
 * is no undo. It touches nothing in the library: the apps, their versions and
 * their artwork are files, and this only removes the two tables that say which
 * of them this person kept.
 */
export default function ForgetStateButton({ count }: { count: number }) {
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function forget() {
    if (
      !confirm(
        `Forget ${count} saved and installed ${count === 1 ? "entry" : "entries"}? The apps themselves stay in the library.`
      )
    ) {
      return;
    }
    setFailed(false);
    try {
      const res = await fetch(withBasePath("/api/me"), { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDone(true);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("[account] could not clear state:", err);
      setFailed(true);
    }
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        type="button"
        onClick={forget}
        disabled={pending || count === 0}
        className={cn(
          buttonClass("ghost", "sm"),
          (pending || count === 0) && "opacity-50"
        )}
      >
        <Trash2 size={13} /> Forget my library
      </button>
      {failed && (
        <span className="text-[11px] text-red-400">
          Could not clear that — try again
        </span>
      )}
      {done && !failed && (
        <span className="text-[11px] text-[color:var(--muted)]">Cleared</span>
      )}
    </div>
  );
}
