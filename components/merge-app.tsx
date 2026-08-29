"use client";

/**
 * Merging two listings, from the page of either one.
 *
 * The same app reaches the shelf twice when a second signer of one package id
 * arrives — the review queue gives it its own slug because the store cannot
 * offer it as an update — and the pair then sits in the catalog as `xnxx` and
 * `xnxx-2`, one holding the pictures and the other the newer binary. The fix
 * has to be reachable from whichever of the two you happen to be looking at,
 * so the panel names both directions rather than assuming you arrived on the
 * one that loses.
 *
 * It renders only where there is something to merge: the page passes the
 * listings that share this app's package id, and with none of them there is no
 * card at all. That is also what keeps the picker honest about the 18+ gate —
 * it offers siblings of the app already on screen, never a catalog-wide list
 * an admin who has not opened the gate would see holes in.
 *
 * Nothing is written until the plan has been shown. A merge moves the binaries
 * and takes a listing off the shelf; "which of these two has the screenshots"
 * is not a question to answer from memory.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GitMerge, X } from "lucide-react";
import { adminCall } from "@/lib/admin-call";
import { readAdminToken } from "@/lib/admin-token";
import { buttonClass, CARD, MUTED } from "@/components/primitives";
import { cn } from "@/lib/utils";
import { withBasePath } from "@/lib/base-path";
import type { MergePlan, MergeResult, SignerChoice } from "@/lib/merge";

/** A listing this one could be merged with — same package id, other slug. */
export type MergeSibling = {
  slug: string;
  name: string;
  version: string;
  versions: number;
};

const FIELD =
  "w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[var(--card-2)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]";

export default function MergeApp({
  app,
  siblings,
}: {
  app: { slug: string; name: string };
  siblings: MergeSibling[];
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [other, setOther] = useState(siblings[0]?.slug ?? "");
  /** Which listing survives. "in" pulls the other one into this app. */
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [signer, setSigner] = useState<SignerChoice | "">("");
  const [plan, setPlan] = useState<MergePlan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => setToken(readAdminToken()), []);

  const from = direction === "in" ? other : app.slug;
  const into = direction === "in" ? app.slug : other;

  // A plan describes one pair in one direction, so changing either makes the
  // one on screen a claim about something else.
  useEffect(() => {
    setPlan(null);
    setSigner("");
  }, [from, into]);

  const call = useCallback(
    (body: unknown) =>
      adminCall(
        "/api/apps/merge",
        { method: "POST", body: JSON.stringify(body) },
        token,
        { hint: "Sign in to elite-v2 as an admin, or unlock Manage" }
      ),
    [token]
  );

  async function preview() {
    setBusy("plan");
    setError(null);
    try {
      const { plan } = (await call({ from, into, dryRun: true })) as {
        plan: MergePlan;
      };
      setPlan(plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function merge() {
    setBusy("merge");
    setError(null);
    try {
      const { result } = (await call({
        from,
        into,
        ...(signer ? { signer } : {}),
      })) as { result: MergeResult };
      // Onto the surviving listing, whichever it was. Staying here would show
      // a page for a slug the catalog no longer has.
      router.push(withBasePath(`/app/${result.into.slug}`));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  if (!siblings.length) return null;

  if (!open) {
    return (
      <div className="px-[var(--pad)]">
        <button
          onClick={() => setOpen(true)}
          className={cn(buttonClass("secondary", "sm"), "w-full justify-center")}
        >
          <GitMerge size={14} />
          {siblings.length === 1
            ? "Another listing has this package id"
            : `${siblings.length} other listings have this package id`}
        </button>
      </div>
    );
  }

  const sibling = siblings.find((s) => s.slug === other);
  const ready = plan && (!plan.signerConflict || signer);

  return (
    <div className="px-[var(--pad)]">
      <div className={cn(CARD, "space-y-3 p-3")}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Merge listings</p>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className={cn("rounded-full p-1", MUTED)}
          >
            <X size={15} />
          </button>
        </div>

        <p className={cn("text-[11px] leading-relaxed", MUTED)}>
          The same app on the shelf twice. Everything the listing that goes away
          holds — versions, artwork, the words nobody wrote on the other side —
          moves across; what it cannot hand over is archived under{" "}
          <code>_import/_discarded/</code> rather than deleted.
        </p>

        {siblings.length > 1 && (
          <label className="block">
            <span className={cn("mb-1 block text-[11px]", MUTED)}>
              The other listing
            </span>
            <select
              className={FIELD}
              value={other}
              onChange={(e) => setOther(e.target.value)}
            >
              {siblings.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name} ({s.slug}) — {s.version}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          {(["in", "out"] as const).map((d) => {
            const keeps = d === "in" ? app.name : (sibling?.name ?? "");
            const goes = d === "in" ? (sibling?.name ?? "") : app.name;
            return (
              <button
                key={d}
                onClick={() => setDirection(d)}
                className={cn(
                  "rounded-[var(--radius)] border px-3 py-2 text-left text-xs leading-relaxed",
                  direction === d
                    ? "border-[color:var(--accent)] bg-[var(--card-2)]"
                    : "border-[color:var(--border)]"
                )}
              >
                <span className="block font-semibold">Keep {keeps}</span>
                <span className={cn("block", MUTED)}>
                  {goes} comes off the shelf
                </span>
              </button>
            );
          })}
        </div>

        {!plan ? (
          <button
            onClick={preview}
            disabled={busy === "plan" || !other}
            className={cn(
              buttonClass("secondary", "sm"),
              "w-full justify-center disabled:opacity-60"
            )}
          >
            {busy === "plan" ? "Reading…" : "Show what would move"}
          </button>
        ) : (
          <>
            <Plan plan={plan} />

            {plan.signerConflict && (
              <div className="space-y-2 rounded-[var(--radius)] border border-[color:var(--border)] p-2.5">
                <p className="text-xs font-semibold">
                  These two pinned different signing certificates
                </p>
                <p className={cn("text-[11px] leading-relaxed", MUTED)}>
                  Both binaries stay downloadable, but Android will not install
                  one over the other — a device on {plan.into.name} cannot take
                  an update signed with the other key. Pick the certificate the
                  merged listing pins: it is what the importer checks the{" "}
                  <em>next</em> drop against.
                </p>
                {(
                  [
                    ["keep", plan.signerConflict.into, plan.into.name],
                    ["adopt", plan.signerConflict.from, plan.from.name],
                  ] as const
                ).map(([value, cert, whose]) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-start gap-2 text-[11px]"
                  >
                    <input
                      type="radio"
                      name="signer"
                      className="mt-0.5"
                      checked={signer === value}
                      onChange={() => setSigner(value)}
                    />
                    <span className="min-w-0">
                      <span className="block">{whose}&apos;s</span>
                      <span className={cn("block break-all font-mono", MUTED)}>
                        {cert.slice(0, 24)}…
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={merge}
                disabled={!ready || busy === "merge"}
                className={cn(
                  buttonClass("primary", "sm"),
                  "disabled:opacity-60"
                )}
              >
                {busy === "merge"
                  ? "Merging…"
                  : `Merge into ${plan.into.name}`}
              </button>
              <button
                onClick={() => setPlan(null)}
                className={cn(buttonClass("ghost", "sm"))}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {error && (
          <p className="text-xs text-[color:var(--danger,#f87171)]">{error}</p>
        )}
      </div>
    </div>
  );
}

/** What the dry run answered, as sentences rather than a shape. */
function Plan({ plan }: { plan: MergePlan }) {
  const moving = plan.versions.filter((v) => !v.taken);
  const taken = plan.versions.filter((v) => v.taken);
  const art: string[] = [];
  if (plan.artwork.icon) art.push("the icon");
  if (plan.artwork.banner) art.push("the banner");
  if (plan.artwork.screenshots) {
    art.push(`${plan.artwork.screenshots} screenshots`);
  }

  const lines: { text: string; warn?: boolean }[] = [];
  lines.push({
    text: moving.length
      ? `${moving.length} ${moving.length === 1 ? "version" : "versions"} move: ${moving.map((v) => v.version).join(", ")}`
      : "No versions to move",
  });
  if (taken.length) {
    lines.push({
      text: `${plan.into.name} already serves ${taken.map((v) => v.version).join(", ")} — the other copy is archived`,
    });
  }
  if (art.length) lines.push({ text: `${art.join(" and ")} move across` });
  if (plan.fills.length) {
    lines.push({ text: `Fills empty fields: ${plan.fills.join(", ")}` });
  }
  if (plan.users.saved || plan.users.installed) {
    lines.push({
      text: `${plan.users.saved} saved and ${plan.users.installed} installed ${plan.users.installed === 1 ? "row" : "rows"} follow the app`,
    });
  }
  if (plan.refiles) {
    lines.push({
      text: `${plan.into.name} is re-filed as ${plan.refiles}`,
      warn: plan.refiles === "Adults",
    });
  }
  lines.push({ text: `${plan.from.name} (${plan.from.slug}) comes off the shelf` });

  return (
    <ul className="space-y-1 text-[11px] leading-relaxed">
      {lines.map((line) => (
        <li
          key={line.text}
          className={cn("flex gap-2", line.warn ? "" : MUTED)}
        >
          <span aria-hidden>·</span>
          <span>{line.text}</span>
        </li>
      ))}
    </ul>
  );
}
