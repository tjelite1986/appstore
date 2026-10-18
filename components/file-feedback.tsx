"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  MessageSquare,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD, MUTED, Pill, buttonClass } from "@/components/primitives";
import { withBasePath } from "@/lib/base-path";
import type { FileFeedback, FileStatus } from "@/lib/file-feedback";

/**
 * "Does this build work?" — one card per file on the detail page.
 *
 * Two things live here because they are answered at the same moment: a
 * thumbs up or down for the build, and the words that explain it ("needs
 * microG", "login broken since 2.3"). Both are per version, not per app: the
 * library keeps older builds precisely because the newest one is not always
 * the one that runs, and an answer that could not say which build it was
 * about would be worth nothing a month later.
 *
 * Counts and comments are visible to everyone who can see the app; writing
 * needs an account, and signed out the controls are absent rather than
 * disabled, as everywhere else in this store. Optimistic like the other
 * toggles, with `router.refresh()` to bring the server-rendered counts back
 * in line.
 *
 * `compact` is the shape used under an older version: a one-line summary
 * that opens on tap, so a list of ten builds does not become ten comment
 * boxes.
 */
export default function FileFeedbackCard({
  slug,
  feedback,
  signedIn,
  compact = false,
}: {
  slug: string;
  feedback: FileFeedback;
  signedIn: boolean;
  compact?: boolean;
}) {
  const [mine, setMine] = useState<FileStatus | null>(feedback.mine);
  const [counts, setCounts] = useState({
    working: feedback.working,
    broken: feedback.broken,
  });
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(!compact);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { version } = feedback;

  async function mark(next: FileStatus) {
    // Tapping the one already lit takes the answer back.
    const target = mine === next ? null : next;
    const previous = { mine, counts };
    setMine(target);
    setCounts({
      working:
        counts.working -
        (mine === "working" ? 1 : 0) +
        (target === "working" ? 1 : 0),
      broken:
        counts.broken -
        (mine === "broken" ? 1 : 0) +
        (target === "broken" ? 1 : 0),
    });
    setError(null);
    try {
      const res = await fetch(withBasePath(`/api/apps/${slug}/feedback`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version, status: target }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("[feedback] could not write status:", err);
      setMine(previous.mine);
      setCounts(previous.counts);
      setError("Could not save that — try again");
    }
  }

  async function post() {
    const text = draft.trim();
    if (!text) return;
    setError(null);
    try {
      const res = await fetch(withBasePath(`/api/apps/${slug}/comments`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version, body: text }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      setDraft("");
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("[feedback] could not post comment:", err);
      setError(
        err instanceof Error ? err.message : "Could not post that — try again",
      );
    }
  }

  async function remove(id: number) {
    setError(null);
    try {
      const res = await fetch(withBasePath(`/api/apps/${slug}/comments`), {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("[feedback] could not delete comment:", err);
      setError("Could not remove that — try again");
    }
  }

  const summary = (
    <span className="flex flex-wrap items-center gap-1.5">
      {counts.working > 0 && (
        <Pill tone="ok">
          <ThumbsUp size={11} /> {counts.working}
        </Pill>
      )}
      {counts.broken > 0 && (
        <Pill tone="danger">
          <ThumbsDown size={11} /> {counts.broken}
        </Pill>
      )}
      {feedback.comments.length > 0 && (
        <Pill>
          <MessageSquare size={11} /> {feedback.comments.length}
        </Pill>
      )}
      {counts.working === 0 &&
        counts.broken === 0 &&
        feedback.comments.length === 0 && (
          <span className={cn("text-[11px]", MUTED)}>No feedback yet</span>
        )}
    </span>
  );

  const body = (
    <div
      className={cn("flex flex-col gap-3", compact ? "pt-3" : "px-3.5 py-3")}
    >
      {signedIn && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => mark("working")}
            aria-pressed={mine === "working"}
            disabled={pending}
            className={cn(
              buttonClass("secondary", "sm"),
              mine === "working" &&
                "border-[color:var(--ok)] text-[color:var(--ok)]",
              pending && "opacity-70",
            )}
          >
            <ThumbsUp
              size={13}
              className={cn(mine === "working" && "fill-current")}
            />
            Works for me
          </button>
          <button
            type="button"
            onClick={() => mark("broken")}
            aria-pressed={mine === "broken"}
            disabled={pending}
            className={cn(
              buttonClass("secondary", "sm"),
              mine === "broken" &&
                "border-[color:var(--danger)] text-[color:var(--danger)]",
              pending && "opacity-70",
            )}
          >
            <ThumbsDown
              size={13}
              className={cn(mine === "broken" && "fill-current")}
            />
            Not working
          </button>
        </div>
      )}

      {feedback.comments.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {feedback.comments.map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className={cn("text-[11px]", MUTED)}>
                  <span className="font-medium text-[color:var(--muted-2)]">
                    {c.author}
                  </span>{" "}
                  ·{" "}
                  {new Date(c.createdAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    timeZone: "Europe/Stockholm",
                  })}
                </p>
                <p className="whitespace-pre-line break-words text-sm leading-relaxed">
                  {c.body}
                </p>
              </div>
              {c.deletable && (
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  disabled={pending}
                  aria-label="Remove this comment"
                  title="Remove this comment"
                  className={cn(
                    buttonClass("ghost", "sm"),
                    "shrink-0",
                    pending && "opacity-70",
                  )}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {signedIn ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void post();
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void post();
              }
            }}
            rows={2}
            maxLength={1000}
            placeholder={`Anything about ${version}?`}
            aria-label={`Comment on ${version}`}
            className="min-w-0 flex-1 resize-y rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-[var(--card-2)] px-3 py-2 text-sm placeholder:text-[color:var(--muted)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]"
          />
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            aria-label="Post comment"
            className={cn(
              buttonClass("primary", "sm"),
              (pending || !draft.trim()) && "opacity-60",
            )}
          >
            <Send size={13} /> Post
          </button>
        </form>
      ) : (
        feedback.comments.length === 0 &&
        counts.working === 0 &&
        counts.broken === 0 && (
          <p className={cn("text-[11px]", MUTED)}>
            Sign in to say whether this build works.
          </p>
        )
      )}

      {error && (
        <p className="text-[11px] text-[color:var(--danger)]">{error}</p>
      )}
    </div>
  );

  if (compact) {
    return (
      <div className="flex flex-col">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 text-left"
        >
          {summary}
          <ChevronDown
            size={14}
            className={cn(
              "ml-auto shrink-0 transition",
              MUTED,
              open && "rotate-180",
            )}
          />
        </button>
        {open && body}
      </div>
    );
  }

  return (
    <div className="px-[var(--pad)]">
      <div className={cn(CARD, "overflow-hidden")}>
        <div className="flex items-center gap-3 border-b border-[color:var(--border)] px-3.5 py-3">
          <MessageSquare size={18} className={cn("shrink-0", MUTED)} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Does {version} work?</p>
            <p className={cn("truncate text-[11px]", MUTED)}>
              What people found when they installed this build
            </p>
          </div>
          {summary}
        </div>
        {body}
      </div>
    </div>
  );
}
