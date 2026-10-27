"use client";

/**
 * Long-press an app card to start choosing, tap more to add them, then file
 * them all under one category. Admin only — `AppGrid` draws these pieces only
 * when the page hands it `bulk`.
 *
 * A built-in category moves the apps there: an app has one, and it decides
 * App or Game and the 18+ gate. A custom category is added beside what each
 * app already has. The route (`/api/apps/bulk-category`) goes through the
 * same validation as the edit form, one app at a time.
 */
import { createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, FolderInput, Store, X } from "lucide-react";
import { adminCall } from "@/lib/admin-call";
import { readAdminToken } from "@/lib/admin-token";
import { buttonClass, MUTED, NOTE } from "@/components/primitives";
import { DEFAULT_CUSTOM_ICON, ICONS } from "@/components/category-icons";
import { cn } from "@/lib/utils";

/** What the picker offers. Built by the page, which knows the viewer's gate. */
export type BulkOptions = {
  custom: { slug: string; name: string; icon?: string; adults?: boolean }[];
  /** Built-in categories: the stored name, what the UI calls it, its kind. */
  builtIn: { value: string; label: string; kind: "app" | "game" }[];
};

/** Long enough that a scroll or an ordinary tap never trips it. */
const HOLD_MS = 450;
/** A finger that travels further than this is scrolling, not holding. */
const SLOP_PX = 10;

type Picked = { slug: string; category: string };

type Ctx = {
  selecting: boolean;
  picked: Map<string, Picked>;
  toggle: (app: Picked) => void;
};

const BulkContext = createContext<Ctx | null>(null);

export function BulkSelect({
  options,
  children,
}: {
  options: BulkOptions;
  children: React.ReactNode;
}) {
  const [picked, setPicked] = useState<Map<string, Picked>>(new Map());
  const [open, setOpen] = useState(false);
  const selecting = picked.size > 0;

  const toggle = (app: Picked) =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(app.slug)) next.delete(app.slug);
      else next.set(app.slug, app);
      return next;
    });

  const clear = () => {
    setPicked(new Map());
    setOpen(false);
  };

  // Escape leaves the selection, the way it closes everything else here.
  // Bubble phase on document, so an inner control can still claim the key.
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) clear();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selecting]);

  return (
    <BulkContext.Provider value={{ selecting, picked, toggle }}>
      {children}
      {selecting && !open && (
        <div
          className="fixed inset-x-4 z-40 mx-auto flex max-w-md items-center gap-2 rounded-full border border-[color:var(--border)] bg-[var(--menu)] py-2 pl-5 pr-2 shadow-lg backdrop-blur"
          style={{ bottom: "calc(var(--nav-h) + env(safe-area-inset-bottom) + 0.75rem)" }}
        >
          <span className="min-w-0 flex-1 text-sm font-semibold tabular-nums">
            {picked.size} selected
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={cn(buttonClass("primary", "sm"), "shrink-0")}
          >
            <FolderInput size={14} />
            Edit category
          </button>
          <button
            type="button"
            onClick={clear}
            className={cn("shrink-0 rounded-full p-2", MUTED)}
            aria-label="Stop selecting"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {open && (
        <Picker
          options={options}
          picked={[...picked.values()]}
          onClose={() => setOpen(false)}
          onDone={clear}
        />
      )}
    </BulkContext.Provider>
  );
}

/**
 * One card that is a link until a long press, and a checkbox after it.
 *
 * The press is timed by hand rather than read off `contextmenu`, which
 * desktop browsers fire on a right click and Android on a hold — and which
 * here is swallowed, so a hold does not also open the link menu.
 */
export function SelectableCard({
  slug,
  category,
  href,
  className,
  children,
}: {
  slug: string;
  category: string;
  href: string;
  className: string;
  children: React.ReactNode;
}) {
  const ctx = useContext(BulkContext);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Set when the hold fired, so the click that ends it does not navigate.
  const held = useRef(false);

  if (!ctx) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  const { selecting, picked, toggle } = ctx;
  const on = picked.has(slug);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  return (
    <Link
      href={href}
      draggable={false}
      aria-pressed={selecting ? on : undefined}
      className={cn(
        className,
        "relative select-none [-webkit-touch-callout:none]",
        on && "bg-[var(--card-2)] ring-2 ring-[color:var(--accent)]"
      )}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        held.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        timer.current = setTimeout(() => {
          held.current = true;
          timer.current = null;
          navigator.vibrate?.(15);
          toggle({ slug, category });
        }, HOLD_MS);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > SLOP_PX) cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        if (held.current) {
          e.preventDefault();
          held.current = false;
        } else if (selecting) {
          e.preventDefault();
          toggle({ slug, category });
        }
      }}
    >
      {children}
      {on && (
        <span className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-white">
          <Check size={13} strokeWidth={3} />
        </span>
      )}
    </Link>
  );
}

type Target =
  | { kind: "custom"; slug: string; name: string }
  | { kind: "builtIn"; value: string; label: string }
  | { kind: "new" };

function Picker({
  options,
  picked,
  onClose,
  onDone,
}: {
  options: BulkOptions;
  picked: Picked[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [target, setTarget] = useState<Target | null>(null);
  const [newName, setNewName] = useState("");
  const [newAdults, setNewAdults] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const n = picked.length;
  const apps = `${n} ${n === 1 ? "app" : "apps"}`;
  // Moving an Adults app anywhere else takes it out from behind the gate.
  const leavingAdults =
    target?.kind === "builtIn" && target.value !== "Adults"
      ? picked.filter((p) => p.category === "Adults").length
      : 0;

  async function apply() {
    if (!target) return;
    setBusy(true);
    setError(null);
    const token = readAdminToken();
    const call = (path: string, body: unknown) =>
      adminCall(path, { method: "POST", body: JSON.stringify(body) }, token, {
        hint: "Sign in as an admin, or unlock Manage",
      });
    try {
      let body: Record<string, unknown>;
      if (target.kind === "builtIn") {
        body = { category: target.value };
      } else if (target.kind === "custom") {
        body = { add: target.slug };
      } else {
        const made = await call("/api/collections", {
          action: "create",
          name: newName,
          adults: newAdults,
        });
        body = { add: made.collection.slug };
      }
      const res = await call("/api/apps/bulk-category", {
        slugs: picked.map((p) => p.slug),
        ...body,
      });
      router.refresh();
      if (res.failed?.length > 0) {
        setError(
          `${res.failed.length} could not be filed: ` +
            res.failed.map((f: { slug: string; error: string }) => `${f.slug} (${f.error})`).join(", ")
        );
        return;
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const chip = (selected: boolean) =>
    cn(
      "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition",
      selected
        ? "bg-[var(--accent)] text-white"
        : "bg-[var(--card-2)] text-[color:var(--muted-2)] hover:bg-[var(--pill-hover)]"
    );

  const isTarget = (t: Target) =>
    !!target &&
    target.kind === t.kind &&
    (t.kind === "new" ||
      (t.kind === "custom" && target.kind === "custom" && t.slug === target.slug) ||
      (t.kind === "builtIn" && target.kind === "builtIn" && t.value === target.value));

  const groups: { title: string; kind: "app" | "game" }[] = [
    { title: "App categories", kind: "app" },
    { title: "Game categories", kind: "game" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Edit category"
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-[var(--radius-lg)] bg-[var(--card)] sm:rounded-[var(--radius-lg)]"
      >
        <div className="flex items-center gap-2 px-5 pb-2 pt-4">
          <h2 className="min-w-0 flex-1 text-[17px] font-bold">Edit category</h2>
          <span className={cn("text-xs tabular-nums", MUTED)}>{apps}</span>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={cn("rounded-full p-1.5", MUTED)}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-4">
          <section>
            <h3 className="mb-1 text-[13px] font-semibold">Your categories</h3>
            <p className={cn("mb-2", NOTE)}>Added beside what each app already has.</p>
            <div className="flex flex-wrap gap-1.5">
              {options.custom.map((c) => {
                const Icon = ICONS[c.icon ?? DEFAULT_CUSTOM_ICON] ?? Store;
                const t: Target = { kind: "custom", slug: c.slug, name: c.name };
                return (
                  <button
                    key={c.slug}
                    type="button"
                    onClick={() => setTarget(t)}
                    aria-pressed={isTarget(t)}
                    className={chip(isTarget(t))}
                  >
                    <Icon size={14} />
                    {c.name}
                    {c.adults && <span className="text-[10px] font-bold">18+</span>}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setTarget({ kind: "new" })}
                aria-pressed={isTarget({ kind: "new" })}
                className={chip(isTarget({ kind: "new" }))}
              >
                + New category
              </button>
            </div>
            {target?.kind === "new" && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Name, like Favourites"
                  maxLength={60}
                  aria-label="New category name"
                  className="min-w-0 flex-1 basis-48 rounded-full border border-[color:var(--border)] bg-[var(--card-2)] px-4 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                />
                <label className="flex shrink-0 items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={newAdults}
                    onChange={(e) => setNewAdults(e.target.checked)}
                  />
                  18+
                </label>
              </div>
            )}
          </section>

          {groups.map((g) => (
            <section key={g.kind}>
              <h3 className="mb-1 text-[13px] font-semibold">{g.title}</h3>
              {g.kind === "app" && (
                <p className={cn("mb-2", NOTE)}>
                  Moves the apps: an app has one built-in category.
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {options.builtIn
                  .filter((c) => c.kind === g.kind)
                  .map((c) => {
                    const t: Target = { kind: "builtIn", value: c.value, label: c.label };
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setTarget(t)}
                        aria-pressed={isTarget(t)}
                        className={chip(isTarget(t))}
                      >
                        {c.label}
                      </button>
                    );
                  })}
              </div>
            </section>
          ))}
        </div>

        <div className="border-t border-[color:var(--border)] px-5 py-3">
          {leavingAdults > 0 && (
            <p className="mb-2 text-xs text-[color:var(--warn)]">
              {leavingAdults} of these {leavingAdults === 1 ? "is" : "are"} filed under
              Adults. Moving {leavingAdults === 1 ? "it" : "them"} makes{" "}
              {leavingAdults === 1 ? "it" : "them"} visible to everyone.
            </p>
          )}
          {error && <p className="mb-2 text-xs text-[color:var(--danger)]">{error}</p>}
          <button
            type="button"
            onClick={() => void apply()}
            disabled={
              busy || !target || (target.kind === "new" && !newName.trim())
            }
            className={cn(buttonClass("primary", "md"), "w-full justify-center")}
          >
            {!target
              ? "Pick a category"
              : target.kind === "builtIn"
                ? `Move ${apps} to ${target.label}`
                : target.kind === "custom"
                  ? `Add ${apps} to ${target.name}`
                  : `Add ${apps} to ${newName.trim() || "the new category"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
