"use client";

/**
 * Deleting a whole listing — every version, the artwork, the meta file and
 * what accounts said about it.
 *
 * Built like the prune panel: closed until asked for, the plan on screen
 * before the button, and nothing archived behind it (see `lib/remove.ts`).
 * One more guard than the prune, because this one cannot leave anything
 * behind: the button only works once the slug has been typed.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, X } from "lucide-react";
import { adminCall } from "@/lib/admin-call";
import { readAdminToken } from "@/lib/admin-token";
import { buttonClass, CARD, MUTED } from "@/components/primitives";
import { cn } from "@/lib/utils";
import type { RemovePlan } from "@/lib/remove";

const FIELD =
  "w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[var(--card-2)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]";

export default function RemoveApp({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [plan, setPlan] = useState<RemovePlan | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<"plan" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => setToken(readAdminToken()), []);

  const call = useCallback(
    (body: unknown) =>
      adminCall(
        `/api/apps/${encodeURIComponent(slug)}/remove`,
        { method: "POST", body: JSON.stringify(body) },
        token,
        { hint: "Sign in as an admin, or unlock Manage" }
      ),
    [slug, token]
  );

  async function preview() {
    setBusy("plan");
    setError(null);
    try {
      const { plan } = (await call({ dryRun: true })) as { plan: RemovePlan };
      setPlan(plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    setError(null);
    try {
      await call({ confirm: slug });
      // The page this panel sits on no longer exists.
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  function close() {
    setOpen(false);
    setPlan(null);
    setTyped("");
    setError(null);
  }

  if (!open) {
    return (
      <div className="px-[var(--pad)]">
        <button
          onClick={() => {
            setOpen(true);
            void preview();
          }}
          className={cn(
            buttonClass("secondary", "sm"),
            "w-full justify-center text-[color:var(--danger,#f87171)]"
          )}
        >
          <Trash2 size={14} />
          Remove app
        </button>
      </div>
    );
  }

  return (
    <div className="px-[var(--pad)]">
      <div className={cn(CARD, "space-y-3 p-3")}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Remove this app</p>
          <button onClick={close} aria-label="Close" className={cn("rounded-full p-1", MUTED)}>
            <X size={15} />
          </button>
        </div>

        <p className="text-xs leading-relaxed">
          Deletes the listing and every file it has. Nothing is archived under{" "}
          <code>_import/_discarded/</code> — it is gone.
        </p>

        {busy === "plan" && <p className={cn("text-xs", MUTED)}>Reading…</p>}

        {plan && <Plan plan={plan} />}

        {plan && (
          <div className="space-y-2">
            <label className="block text-xs">
              Type <span className="font-mono font-semibold">{plan.slug}</span> to confirm
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={cn(FIELD, "mt-1 font-mono")}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={remove}
                disabled={busy !== null || typed.trim() !== plan.slug}
                className={cn(buttonClass("primary", "sm"), "disabled:opacity-60")}
              >
                {busy === "remove" ? "Deleting…" : `Delete ${plan.name} (${plan.size})`}
              </button>
              <button onClick={close} className={buttonClass("ghost", "sm")}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-[color:var(--danger,#f87171)]">{error}</p>}
      </div>
    </div>
  );
}

function Plan({ plan }: { plan: RemovePlan }) {
  const { saved, installed, statuses, comments } = plan.rows;
  const rows = [
    saved && `${saved} saved`,
    installed && `${installed} installed`,
    statuses && `${statuses} working/broken marks`,
    comments && `${comments} comments`,
  ].filter(Boolean);
  return (
    <ul className="space-y-1 text-xs leading-relaxed">
      <li>
        {plan.versions.length
          ? `${plan.versions.length} ${plan.versions.length === 1 ? "version" : "versions"} (${plan.versions.join(", ")}), ${plan.files} ${plan.files === 1 ? "file" : "files"}, ${plan.size}`
          : "No files on disk — only the listing"}
      </li>
      <li>Icon, banner, screenshots and the meta file</li>
      {rows.length > 0 && <li>Account rows: {rows.join(", ")}</li>}
      {plan.relatives.length > 0 && (
        <li>
          Unlinked from: <span className="font-mono">{plan.relatives.join(", ")}</span>
        </li>
      )}
    </ul>
  );
}
