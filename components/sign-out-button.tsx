"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/primitives";
import { withBasePath } from "@/lib/base-path";

export default function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(withBasePath("/api/auth/logout"), { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // A full load for the same reason as signing in: every server-rendered
      // part of the page still believes someone is here.
      window.location.assign(withBasePath("/"));
    } catch (err) {
      console.error("[account] could not sign out:", err);
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        className={cn(buttonClass("ghost", "sm"), busy && "opacity-50")}
      >
        <LogOut size={13} /> Sign out
      </button>
      {failed && (
        <span className="text-[11px] text-red-400">
          Could not sign out — try again
        </span>
      )}
    </div>
  );
}
