"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/primitives";
import { adminHeaders, readAdminToken } from "@/lib/admin-token";
import type { SourceCheck, SourceReport } from "@/lib/sources/updates";

/**
 * "Sources", on Manage.
 *
 * This card used to be three toggles that were wired to nothing and said "Not
 * connected" about a Play source that had been working for weeks. What a
 * source can be asked here is not whether it is on — it is on as soon as one
 * app carries its address — but what it has now.
 *
 * Checking and fetching are two buttons rather than one because they cost very
 * different things: a check is a handful of API calls, a fetch is every new
 * release downloaded over a home line. Nothing is fetched without being asked
 * for by name.
 */

const CARD_CLS =
  "bg-[var(--card)] rounded-[var(--radius)] border border-[color:var(--border)]";
const MUTED_CLS = "text-[color:var(--muted)]";

export type SourceCounts = { github: number; fdroid: number; play: number };

const LINES: { key: keyof SourceCounts; label: string; note: string }[] = [
  {
    key: "github",
    label: "GitHub releases",
    note: "words and binaries — the newest release is fetched",
  },
  {
    key: "fdroid",
    label: "F-Droid",
    note: "words, icon and binaries — the recommended build is fetched",
  },
  {
    key: "play",
    label: "Google Play",
    note: "words and pictures only — Play serves APKs to nobody but Play",
  },
];

const STATUS_TEXT: Record<SourceCheck["status"], string> = {
  current: "up to date",
  available: "newer upstream",
  installed: "fetched",
  unavailable: "nothing to fetch",
  error: "failed",
};

export default function SourcesPanel({ counts }: { counts: SourceCounts }) {
  const [report, setReport] = useState<SourceReport | null>(null);
  const [busy, setBusy] = useState<"check" | "fetch" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkable = counts.github + counts.fdroid;

  async function run(install: boolean) {
    setBusy(install ? "fetch" : "check");
    setError(null);
    try {
      const res = await fetch("/api/sources/check", {
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
            ? "Sign in as an admin, or unlock the panel below"
            : data.error || `Request failed (${res.status})`
        );
      }
      setReport(data as SourceReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={cn(CARD_CLS, "flex flex-col gap-3 p-3.5")}>
      <div className="flex flex-col gap-2">
        {LINES.map((line) => (
          <div key={line.key} className="flex items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate text-sm">
              {line.label}
              <span className={cn("ml-2 text-[11px]", MUTED_CLS)}>
                {line.note}
              </span>
            </span>
            <span className={cn("shrink-0 text-xs", MUTED_CLS)}>
              {counts[line.key] === 0
                ? "no apps"
                : `${counts[line.key]} app${counts[line.key] === 1 ? "" : "s"}`}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={cn(buttonClass("secondary", "sm"))}
          disabled={busy !== null || checkable === 0}
          onClick={() => void run(false)}
        >
          <RefreshCw size={13} />
          {busy === "check" ? "Asking…" : "Check for updates"}
        </button>

        {/* Only offered once a check has said there is something to fetch:
            the button's name is then a fact rather than an invitation. */}
        {report && report.available > 0 && (
          <button
            type="button"
            className={cn(buttonClass("primary", "sm"))}
            disabled={busy !== null}
            onClick={() => void run(true)}
          >
            <ArrowDownToLine size={13} />
            {busy === "fetch"
              ? "Fetching…"
              : `Fetch ${report.available} update${report.available === 1 ? "" : "s"}`}
          </button>
        )}

        {checkable === 0 && (
          <span className={cn("text-xs", MUTED_CLS)}>
            Nothing to check — add an app from GitHub or F-Droid above.
          </span>
        )}
      </div>

      {error && (
        <p className="text-xs text-[color:var(--danger,#f87171)]">{error}</p>
      )}

      {report && (
        <div className="flex flex-col gap-1.5">
          <p className={cn("text-xs", MUTED_CLS)}>
            {report.checked} checked · {report.available} newer ·{" "}
            {report.installed} fetched
            {report.errors > 0 ? ` · ${report.errors} failed` : ""}
          </p>
          {report.apps.map((app) => (
            <div
              key={app.slug}
              className="flex items-baseline gap-2 rounded-[var(--radius)] bg-[var(--card-2)] px-2.5 py-2 text-xs"
            >
              <Link href={`/app/${app.slug}`} className="truncate">
                {app.name}
              </Link>
              <span className={cn("min-w-0 flex-1 truncate", MUTED_CLS)}>
                {app.detail ??
                  [app.held && `has ${app.held}`, app.upstream && `upstream ${app.upstream}`]
                    .filter(Boolean)
                    .join(" · ")}
              </span>
              <span
                className={cn(
                  "shrink-0",
                  app.status === "error"
                    ? "text-[color:var(--danger,#f87171)]"
                    : app.status === "current"
                      ? MUTED_CLS
                      : "text-[color:var(--accent-text)]"
                )}
              >
                {STATUS_TEXT[app.status]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
