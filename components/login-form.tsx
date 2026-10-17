"use client";

import { useState } from "react";
import { LogIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD, buttonClass } from "@/components/primitives";
import { withBasePath } from "@/lib/base-path";

const INPUT_CLS =
  "w-full rounded-full border border-[color:var(--border)] bg-[var(--card-2)] px-4 py-2 text-sm outline-none focus:border-[color:var(--accent)]";

export default function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(withBasePath("/api/auth/login"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        // A full load, not router.push: the layout read "signed out" on the
        // server, and the header, the badge and the shelf all hang off that.
        window.location.assign(withBasePath(next));
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? `Sign-in failed (HTTP ${res.status})`);
    } catch {
      setError("Could not reach the store");
    }
    setBusy(false);
  }

  return (
    <form
      onSubmit={submit}
      className={cn(CARD, "mx-[var(--pad)] flex max-w-sm flex-col gap-3 p-4")}
    >
      <input
        type="email"
        autoComplete="username"
        placeholder="Email"
        required
        className={INPUT_CLS}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        required
        className={INPUT_CLS}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className={cn(buttonClass("primary"), busy && "opacity-60")}
      >
        <LogIn size={15} /> {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
