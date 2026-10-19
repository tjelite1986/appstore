"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid, Loader2, Search, X } from "lucide-react";
import { MUTED, Thumb } from "@/components/primitives";
import { cn } from "@/lib/utils";
import { withBasePath } from "@/lib/base-path";
import type { SearchResponse } from "@/app/api/search/route";

/**
 * The search field, with suggestions that follow the typing.
 *
 * Still a plain GET form underneath: Enter (with nothing highlighted) goes to
 * `/search?q=`, so the full result list keeps its shareable URL. The dropdown
 * asks `/api/search` after a short pause, drops answers to a query that has
 * since changed, and is driven by the arrow keys as well as the pointer.
 */
export default function SearchBox({
  initialQuery = "",
  autoFocus = false,
}: {
  initialQuery?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed) {
      setData(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          withBasePath(`/api/search?q=${encodeURIComponent(trimmed)}`),
          { signal: ctrl.signal }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData((await res.json()) as SearchResponse);
        setActive(-1);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setData(null);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [trimmed]);

  // Close when a tap lands anywhere outside the field and its list.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const apps = data?.apps ?? [];
  const categories = data?.categories ?? [];
  // One list for the keyboard: categories first, then apps, then "all results".
  const targets: string[] = [
    ...categories.map((c) => `/category/${c.slug}`),
    ...apps.map((a) => `/app/${a.slug}`),
    ...(trimmed && data && data.total > 0
      ? [`/search?q=${encodeURIComponent(trimmed)}`]
      : []),
  ];
  const showList = open && trimmed.length > 0 && data !== null;

  function go(href: string) {
    setOpen(false);
    inputRef.current?.blur();
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (targets.length ? (i + 1) % targets.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (targets.length ? (i <= 0 ? targets.length - 1 : i - 1) : -1));
    } else if (e.key === "Enter" && showList && active >= 0 && targets[active]) {
      e.preventDefault();
      go(targets[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  const optionId = (i: number) => `${listId}-opt-${i}`;
  const rowClass = (i: number) =>
    cn(
      "flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition",
      active === i ? "bg-[var(--card-2)]" : "hover:bg-[var(--card)]"
    );

  return (
    <div ref={boxRef} className="relative">
      <form
        action={withBasePath("/search")}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (!trimmed) return;
          go(`/search?q=${encodeURIComponent(trimmed)}`);
        }}
      >
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-full border bg-[var(--card)] px-4 py-2.5 text-sm transition",
            showList
              ? "border-[color:var(--accent)]"
              : "border-[color:var(--border)] focus-within:border-[color:var(--accent)]",
            MUTED
          )}
        >
          {loading ? (
            <Loader2 size={16} className="shrink-0 animate-spin" />
          ) : (
            <Search size={16} className="shrink-0" />
          )}
          <input
            ref={inputRef}
            type="search"
            name="q"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Search apps and games"
            aria-label="Search apps and games"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
            autoComplete="off"
            autoFocus={autoFocus}
            enterKeyHint="search"
            className="w-full bg-transparent text-base text-[color:var(--fg)] outline-none placeholder:text-[color:var(--muted)] sm:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                setOpen(true);
                inputRef.current?.focus();
              }}
              className="-mr-1 shrink-0 rounded-full p-1 hover:bg-[var(--card-2)] hover:text-[color:var(--fg)]"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      </form>

      {showList ? (
        <div
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-2 max-h-[min(70vh,32rem)] overflow-y-auto rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[var(--menu)] py-1.5 shadow-2xl backdrop-blur"
        >
          {targets.length === 0 ? (
            <p className={cn("px-4 py-3 text-sm", MUTED)}>
              No apps match &ldquo;{trimmed}&rdquo;.
            </p>
          ) : null}

          {categories.map((c, i) => (
            <Link
              key={c.slug}
              id={optionId(i)}
              role="option"
              aria-selected={active === i}
              href={`/category/${c.slug}`}
              onClick={() => setOpen(false)}
              onPointerEnter={() => setActive(i)}
              className={rowClass(i)}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[color:var(--accent-text)]">
                <LayoutGrid size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  <Highlight text={c.label} query={trimmed} />
                </span>
                <span className={cn("block text-xs", MUTED)}>Category</span>
              </span>
            </Link>
          ))}

          {apps.map((a, j) => {
            const i = categories.length + j;
            return (
              <Link
                key={a.slug}
                id={optionId(i)}
                role="option"
                aria-selected={active === i}
                href={`/app/${a.slug}`}
                onClick={() => setOpen(false)}
                onPointerEnter={() => setActive(i)}
                className={rowClass(i)}
              >
                <Thumb
                  seed={a.seed}
                  src={a.icon}
                  background={a.iconBackground}
                  fit={a.iconFit}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-[var(--radius-sm)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    <Highlight text={a.name} query={trimmed} />
                  </span>
                  <span className={cn("block truncate text-xs", MUTED)}>
                    {[a.category, a.developer, a.rating > 0 ? `${a.rating.toFixed(1)} ★` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </Link>
            );
          })}

          {data && data.total > 0 ? (
            <Link
              id={optionId(targets.length - 1)}
              role="option"
              aria-selected={active === targets.length - 1}
              href={`/search?q=${encodeURIComponent(trimmed)}`}
              onClick={() => setOpen(false)}
              onPointerEnter={() => setActive(targets.length - 1)}
              className={cn(
                rowClass(targets.length - 1),
                "mt-1 border-t border-[color:var(--border)] text-sm text-[color:var(--accent-text)]"
              )}
            >
              <Search size={14} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {data.total === 1
                  ? `See the result for "${trimmed}"`
                  : `See all ${data.total} results for "${trimmed}"`}
              </span>
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The first case-insensitive occurrence of each typed word, in bold. */
function Highlight({ text, query }: { text: string; query: string }) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  const marks: [number, number][] = [];
  for (const w of words) {
    const at = lower.indexOf(w);
    if (at >= 0) marks.push([at, at + w.length]);
  }
  if (marks.length === 0) return <>{text}</>;
  marks.sort((a, b) => a[0] - b[0]);
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const [s, e] of marks) {
    if (s < pos) continue;
    if (s > pos) parts.push(text.slice(pos, s));
    parts.push(
      <mark key={s} className="bg-transparent font-semibold text-[color:var(--accent-text)]">
        {text.slice(s, e)}
      </mark>
    );
    pos = e;
  }
  parts.push(text.slice(pos));
  return <>{parts}</>;
}
