"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  GitBranch,
  Package,
  Play,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MUTED, NOTE, Pill, buttonClass } from "@/components/primitives";
import { adminHeaders, readAdminToken } from "@/lib/admin-token";
import type { SourceCheck, SourceReport } from "@/lib/sources/updates";
import { withBasePath } from "@/lib/base-path";

/**
 * "Sources", on Manage.
 *
 * This card used to be three toggles that were wired to nothing and said "Not
 * connected" about a Play source that had been working for weeks. What a
 * source can be asked here is not whether it is on — it is on as soon as one
 * app carries its address — but what it has now.
 *
 * Checking and fetching are two buttons rather than one because they cost very
 * different things: a check is one request per sourced app, a fetch is every
 * new release downloaded over a home line. Nothing is fetched without being
 * asked for by name. Play apps are checked and never fetched, so what they
 * add to a report is a "behind" count, not a bigger Fetch button.
 *
 * The page wraps this in a `Panel`; the body here is the three source rows,
 * the buttons, and the report of the last check.
 *
 * The last check may have been the timer's. Its saved report arrives as
 * `initialReport`, so the summary line and the "Fetch" button are right from
 * the first paint; the per-app list stays folded until a run happens here,
 * because every sourced app at once is a long list and the "Behind upstream"
 * card beside this one already shows the part that matters.
 */

export type SourceCounts = { github: number; fdroid: number; play: number };

const LINES: {
  key: keyof SourceCounts;
  label: string;
  note: string;
  Icon: LucideIcon;
}[] = [
  {
    key: "github",
    label: "GitHub releases",
    note: "Words and binaries. The newest release is fetched.",
    Icon: GitBranch,
  },
  {
    key: "fdroid",
    label: "F-Droid",
    note: "Words, icon and binaries. The recommended build is fetched.",
    Icon: Package,
  },
  {
    key: "play",
    label: "Google Play",
    note: "Words and pictures. The version Play shows is compared, never fetched.",
    Icon: Play,
  },
];

const STATUS_TEXT: Record<SourceCheck["status"], string> = {
  current: "up to date",
  available: "newer upstream",
  behind: "newer on Play",
  installed: "fetched",
  unavailable: "nothing to fetch",
  error: "failed",
};

const STATUS_TONE: Record<SourceCheck["status"], "neutral" | "accent" | "ok" | "danger"> = {
  current: "neutral",
  available: "accent",
  behind: "accent",
  installed: "ok",
  unavailable: "neutral",
  error: "danger",
};

export default function SourcesPanel({
  counts,
  initialReport = null,
}: {
  counts: SourceCounts;
  initialReport?: SourceReport | null;
}) {
  const [report, setReport] = useState<SourceReport | null>(initialReport);
  const [ran, setRan] = useState(false);
  // The page re-renders with a new saved report — after a row on the Behind
  // card is taken off the comparison, say — and until a run has happened here
  // that report is the one to show, or the two cards count different apps.
  useEffect(() => {
    if (!ran) setReport(initialReport);
  }, [initialReport, ran]);
  const [busy, setBusy] = useState<"check" | "fetch" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkable = counts.github + counts.fdroid + counts.play;

  async function run(install: boolean) {
    setBusy(install ? "fetch" : "check");
    setError(null);
    try {
      const res = await fetch(withBasePath("/api/sources/check"), {
        method: install ? "POST" : "GET",
        headers: {
          ...(install ? { "Content-Type": "application/json" } : {}),
          ...adminHeaders(readAdminToken()),
        },
        ...(install ? { body: JSON.stringify({ install: true }) } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          res.status === 401 || res.status === 403
            ? "Sign in as an admin, or unlock the import panel"
            : data.error || `Request failed (${res.status})`
        );
      }
      setReport(data as SourceReport);
      setRan(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {LINES.map(({ key, label, note, Icon }) => (
          <li key={key} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--card-2)] text-[color:var(--muted-2)]">
              <Icon size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{label}</span>
              <span className={cn("block", NOTE)}>{note}</span>
            </span>
            <Pill tone={counts[key] > 0 ? "accent" : "neutral"}>
              {counts[key] === 0
                ? "no apps"
                : `${counts[key]} app${counts[key] === 1 ? "" : "s"}`}
            </Pill>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--border)] pt-3">
        <button
          type="button"
          className={cn(buttonClass("secondary", "sm"), "disabled:opacity-50")}
          disabled={busy !== null || checkable === 0}
          onClick={() => void run(false)}
        >
          <RefreshCw size={13} className={busy === "check" ? "animate-spin" : undefined} />
          {busy === "check" ? "Asking…" : "Check for updates"}
        </button>

        {/* Only offered once a check has said there is something to fetch:
            the button's name is then a fact rather than an invitation. */}
        {report && report.available > 0 && (
          <button
            type="button"
            className={cn(buttonClass("primary", "sm"), "disabled:opacity-50")}
            disabled={busy !== null}
            onClick={() => void run(true)}
          >
            <ArrowDownToLine size={13} />
            {busy === "fetch"
              ? "Fetching…"
              : `Fetch ${report.available} update${report.available === 1 ? "" : "s"}`}
          </button>
        )}

        {checkable === 0 ? (
          <span className={cn("text-xs", MUTED)}>
            Nothing to check — add an app from GitHub, F-Droid or Play first.
          </span>
        ) : report ? (
          <span className={cn("text-xs tabular-nums", MUTED)}>
            {report.checked} checked · {report.available} newer ·{" "}
            {report.installed} fetched
            {report.behind > 0 ? ` · ${report.behind} behind Play` : ""}
            {report.errors > 0 ? ` · ${report.errors} failed` : ""}
          </span>
        ) : null}
      </div>

      {error && <p className="text-xs text-[color:var(--danger)]">{error}</p>}

      {ran && report && report.apps.length > 0 && (
        <ul className="flex flex-col divide-y divide-[color:var(--border)] rounded-[var(--radius)] border border-[color:var(--border)]">
          {report.apps.map((app) => (
            <li
              key={app.slug}
              className="flex items-center gap-2 px-3 py-2 text-xs"
            >
              <Link
                href={`/app/${app.slug}`}
                className="min-w-0 shrink-0 truncate font-medium hover:underline"
              >
                {app.name}
              </Link>
              <span className={cn("min-w-0 flex-1 truncate", MUTED)}>
                {app.detail ??
                  [app.held && `has ${app.held}`, app.upstream && `upstream ${app.upstream}`]
                    .filter(Boolean)
                    .join(" · ")}
              </span>
              <Pill tone={STATUS_TONE[app.status]}>{STATUS_TEXT[app.status]}</Pill>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
