"use client";

/**
 * Deleting every version but the newest.
 *
 * On an app page it speaks for that listing; on Manage, with no slug, for the
 * whole library. Either way nothing is deleted until the list has been on
 * screen: this is the one write in the store with no `_discarded/` behind it
 * (see `lib/prune.ts`), so the plan is the safety, and the button that acts
 * on it names the size it frees rather than a verb.
 *
 * Closed until asked for, like the merge panel — a delete control that is
 * always open on a public page is an invitation to press it.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, X } from "lucide-react";
import { adminCall } from "@/lib/admin-call";
import { readAdminToken } from "@/lib/admin-token";
import { buttonClass, CARD, MUTED } from "@/components/primitives";
import { cn } from "@/lib/utils";
import type { PrunePlan, PruneResult } from "@/lib/prune";

export default function PruneVersions({
  slug,
  summary,
}: {
  /** One listing, or the whole library when absent. */
  slug?: string;
  /** What the closed button says — the page knows the count, the panel not yet. */
  summary: string;
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [plan, setPlan] = useState<PrunePlan | null>(null);
  const [done, setDone] = useState<PruneResult | null>(null);
  const [busy, setBusy] = useState<"plan" | "prune" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => setToken(readAdminToken()), []);

  const call = useCallback(
    (body: unknown) =>
      adminCall(
        "/api/apps/prune",
        { method: "POST", body: JSON.stringify(body) },
        token,
        { hint: "Sign in to elite-v2 as an admin, or unlock Manage" }
      ),
    [token]
  );

  const scope = slug ? { slug } : {};

  async function preview() {
    setBusy("plan");
    setError(null);
    setDone(null);
    try {
      const { plan } = (await call({ ...scope, dryRun: true })) as { plan: PrunePlan };
      setPlan(plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function prune() {
    setBusy("prune");
    setError(null);
    try {
      const { result } = (await call(scope)) as { result: PruneResult };
      setDone(result);
      setPlan(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function close() {
    setOpen(false);
    setPlan(null);
    setDone(null);
    setError(null);
  }

  if (!open) {
    return (
      <div className={slug ? "px-[var(--pad)]" : undefined}>
        <button
          onClick={() => {
            setOpen(true);
            void preview();
          }}
          className={cn(buttonClass("secondary", "sm"), "w-full justify-center")}
        >
          <Trash2 size={14} />
          {summary}
        </button>
      </div>
    );
  }

  return (
    <div className={slug ? "px-[var(--pad)]" : undefined}>
      <div className={cn(CARD, "space-y-3 p-3")}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Remove older versions</p>
          <button onClick={close} aria-label="Close" className={cn("rounded-full p-1", MUTED)}>
            <X size={15} />
          </button>
        </div>

        <p className={cn("text-[11px] leading-relaxed", MUTED)}>
          Keeps the newest version {slug ? "of this app" : "of every app"} and
          deletes the rest. Unlike a discard, these files are <strong>not</strong>{" "}
          archived under <code>_import/_discarded/</code> — they are gone.
        </p>

        {busy === "plan" && <p className={cn("text-xs", MUTED)}>Reading…</p>}

        {plan && <Plan plan={plan} />}

        {plan && plan.apps.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={prune}
              disabled={busy !== null}
              className={cn(buttonClass("primary", "sm"), "disabled:opacity-60")}
            >
              {busy === "prune"
                ? "Deleting…"
                : `Delete ${plan.files} ${plan.files === 1 ? "file" : "files"} (${plan.size})`}
            </button>
            <button onClick={close} className={buttonClass("ghost", "sm")}>
              Cancel
            </button>
          </div>
        )}

        {done && (
          <p className="text-xs">
            Removed {done.versions} {done.versions === 1 ? "version" : "versions"} —{" "}
            {done.size} freed.
          </p>
        )}

        {error && (
          <p className="text-xs text-[color:var(--danger,#f87171)]">{error}</p>
        )}
      </div>
    </div>
  );
}

/** What the dry run answered: one line per app, the versions it loses. */
function Plan({ plan }: { plan: PrunePlan }) {
  if (!plan.apps.length && !plan.skipped.length) {
    return <p className={cn("text-xs", MUTED)}>Nothing to remove — every app holds one version.</p>;
  }
  return (
    <div className="space-y-2">
      {plan.apps.length > 0 && (
        <ul className="space-y-1.5 text-[11px] leading-relaxed">
          {plan.apps.map((app) => (
            <li key={app.slug} className="flex gap-2">
              <span aria-hidden className={MUTED}>·</span>
              <span className="min-w-0">
                <span className="font-semibold">{app.name}</span>{" "}
                <span className={MUTED}>keeps {app.keep}, loses</span>{" "}
                <span className="font-mono">{app.drop.map((v) => v.version).join(", ")}</span>{" "}
                <span className={MUTED}>({app.size})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {plan.skipped.length > 0 && (
        <ul className={cn("space-y-1 text-[11px] leading-relaxed", MUTED)}>
          {plan.skipped.map((s) => (
            <li key={s.slug} className="flex gap-2">
              <span aria-hidden>·</span>
              <span>
                {s.name} is left alone — {s.reason}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
