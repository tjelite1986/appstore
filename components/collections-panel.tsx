"use client";

/**
 * Manage's list of collections: make one, rename it, move it up or down,
 * delete it.
 *
 * Membership is not edited here — that is a decision about one app, made on
 * its page while looking at it. This panel only shapes the list of shelves.
 * Deleting asks once inline, because it also takes the collection off every
 * listing filed under it.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { adminCall } from "@/lib/admin-call";
import { readAdminToken } from "@/lib/admin-token";
import { buttonClass, MUTED } from "@/components/primitives";
import { cn } from "@/lib/utils";

const INPUT_CLS =
  "w-full rounded-full border border-[color:var(--border)] bg-[var(--card-2)] px-4 py-2 text-sm outline-none focus:border-[color:var(--accent)]";

const ICON_BTN = cn("rounded-full p-1.5 disabled:opacity-30", MUTED);

export type CollectionRow = { slug: string; name: string; count: number };

export default function CollectionsPanel({ rows }: { rows: CollectionRow[] }) {
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ slug: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => setToken(readAdminToken()), []);

  async function send(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await adminCall(
        "/api/collections",
        { method: "POST", body: JSON.stringify(body) },
        token,
        { hint: "Sign in as an admin, or unlock Manage" }
      );
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (await send({ action: "create", name })) setName("");
  }

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (await send({ action: "rename", slug: editing.slug, name: editing.name })) {
      setEditing(null);
    }
  }

  return (
    <div>
      {rows.length > 0 && (
        <ul className="divide-y divide-[color:var(--border)] border-b border-[color:var(--border)]">
          {rows.map((row, i) => (
            <li key={row.slug} className="flex items-center gap-2 px-4 py-2">
              {editing?.slug === row.slug ? (
                <form onSubmit={rename} className="flex min-w-0 flex-1 items-center gap-1">
                  <input
                    autoFocus
                    className={INPUT_CLS}
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    aria-label="Collection name"
                  />
                  <button type="submit" disabled={busy} className={ICON_BTN} aria-label="Save name">
                    <Check size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className={ICON_BTN}
                    aria-label="Cancel"
                  >
                    <X size={15} />
                  </button>
                </form>
              ) : confirming === row.slug ? (
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 text-sm">
                    Delete {row.name}?{" "}
                    <span className={MUTED}>
                      {row.count > 0
                        ? `It comes off ${row.count} ${row.count === 1 ? "app" : "apps"}; the apps stay.`
                        : "No apps are in it."}
                    </span>
                  </span>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      if (await send({ action: "delete", slug: row.slug })) setConfirming(null);
                    }}
                    className={buttonClass("primary", "sm")}
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirming(null)}
                    className={buttonClass("ghost", "sm")}
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.name}</span>
                  <span className={cn("shrink-0 text-xs tabular-nums", MUTED)}>
                    {row.count} {row.count === 1 ? "app" : "apps"}
                  </span>
                  <button
                    disabled={busy || i === 0}
                    onClick={() => send({ action: "move", slug: row.slug, step: -1 })}
                    className={ICON_BTN}
                    aria-label={`Move ${row.name} up`}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    disabled={busy || i === rows.length - 1}
                    onClick={() => send({ action: "move", slug: row.slug, step: 1 })}
                    className={ICON_BTN}
                    aria-label={`Move ${row.name} down`}
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setConfirming(null);
                      setEditing({ slug: row.slug, name: row.name });
                    }}
                    className={ICON_BTN}
                    aria-label={`Rename ${row.name}`}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setEditing(null);
                      setConfirming(row.slug);
                    }}
                    className={ICON_BTN}
                    aria-label={`Delete ${row.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={create} className="flex items-center gap-2 p-4">
        <input
          className={INPUT_CLS}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New collection, like Favourites"
          maxLength={60}
          aria-label="New collection name"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className={cn(buttonClass("secondary", "sm"), "shrink-0")}
        >
          <Plus size={14} />
          Add
        </button>
      </form>

      {error && (
        <p className="px-4 pb-4 text-xs text-[color:var(--danger)]">{error}</p>
      )}
    </div>
  );
}
