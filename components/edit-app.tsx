"use client";

/**
 * Editing a listing from the page it describes.
 *
 * The moment you notice a name is wrong is while looking at it, so the form
 * lives on the detail page rather than behind a picker in Manage. It is closed
 * until asked for: this renders for admins on every app page, and an always-open
 * form would put a wall of inputs above the thing people came to read.
 *
 * What it cannot do is as deliberate as what it can. The package id, the pinned
 * signer and the source block are absent from the form because the server
 * refuses them — see `lib/edit.ts`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Pencil, Plus, Trash2, X } from "lucide-react";
import { adminHeaders, readAdminToken } from "@/lib/admin-token";
import { buttonClass, CARD, MUTED } from "@/components/primitives";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  "Editor",
  "Media",
  "Entertainment",
  "Communication",
  "Games",
  "Adults",
  "Other",
];

const FIELD =
  "w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[var(--card-2)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]";

export type EditableApp = {
  slug: string;
  name: string;
  developer: string;
  category: string;
  tagline: string;
  description: string;
  icon?: string;
  banner?: string;
  screenshots: string[];
};

export default function EditApp({ app }: { app: EditableApp }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [form, setForm] = useState({
    name: app.name,
    developer: app.developer,
    category: app.category,
    tagline: app.tagline,
    description: app.description,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  useEffect(() => setToken(readAdminToken()), []);

  // The server trims and drops empties, so what came back is the truth about
  // the file — reseeding from it stops the form from showing a value the
  // library does not hold.
  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const json = init?.body && typeof init.body === "string";
      const res = await fetch(path, {
        ...init,
        headers: {
          ...(json ? { "Content-Type": "application/json" } : {}),
          ...adminHeaders(token),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          data.error === "This account is not a store admin"
            ? data.error
            : "Sign in to elite-v2 as an admin, or unlock Manage"
        );
      }
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      return data;
    },
    [token]
  );

  /**
   * Returns whether the work landed. A URL field clears itself on success and
   * keeps what was typed on failure — retyping a long CDN address because the
   * host was slow once is the wrong thing to ask of anyone.
   */
  async function run(label: string, work: () => Promise<void>): Promise<boolean> {
    setBusy(label);
    setError(null);
    setSaved(false);
    try {
      await work();
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run("save", async () => {
      const data = await call(`/api/apps/${app.slug}`, {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      if (data.app) {
        setForm({
          name: data.app.name,
          developer: data.app.developer,
          category: data.app.category,
          tagline: data.app.tagline,
          description: data.app.description,
        });
      }
      setSaved(true);
    });

  const upload = (kind: string, file: File) =>
    run(`upload:${kind}`, async () => {
      const body = new FormData();
      body.set("kind", kind);
      body.set("file", file);
      await call(`/api/apps/${app.slug}/image`, { method: "POST", body });
    });

  const fromUrl = (kind: string, url: string) =>
    run(`upload:${kind}`, async () => {
      await call(`/api/apps/${app.slug}/image`, {
        method: "POST",
        body: JSON.stringify({ kind, url }),
      });
    });

  const drop = (kind: string, file?: string) =>
    run(`drop:${kind}:${file ?? ""}`, async () => {
      const query = new URLSearchParams({ kind });
      if (file) query.set("file", file);
      await call(`/api/apps/${app.slug}/image?${query}`, { method: "DELETE" });
    });

  if (!open) {
    return (
      <div className="px-[var(--pad)]">
        <button
          onClick={() => setOpen(true)}
          className={cn(buttonClass("secondary", "sm"), "w-full justify-center")}
        >
          <Pencil size={14} /> Edit listing
        </button>
      </div>
    );
  }

  return (
    <div className="px-[var(--pad)]">
      <div className={cn(CARD, "space-y-3 p-3")}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Edit listing</p>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className={cn("rounded-full p-1", MUTED)}
          >
            <X size={15} />
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Text
            label="Name"
            value={form.name}
            onChange={(v) => setForm((f) => ({ ...f, name: v }))}
          />
          <Text
            label="Developer"
            value={form.developer}
            onChange={(v) => setForm((f) => ({ ...f, developer: v }))}
          />
        </div>

        <label className="block">
          <span className={cn("mb-1 block text-[11px]", MUTED)}>Category</span>
          <select
            className={FIELD}
            value={form.category}
            onChange={(e) =>
              setForm((f) => ({ ...f, category: e.target.value }))
            }
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <Text
          label="Tagline"
          value={form.tagline}
          onChange={(v) => setForm((f) => ({ ...f, tagline: v }))}
        />

        <label className="block">
          <span className={cn("mb-1 block text-[11px]", MUTED)}>
            Description
          </span>
          <textarea
            rows={8}
            className={cn(FIELD, "resize-y leading-relaxed")}
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
          />
        </label>

        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={busy === "save"}
            className={cn(buttonClass("primary", "sm"), "disabled:opacity-60")}
          >
            {busy === "save" ? "Saving…" : "Save text"}
          </button>
          {saved && <span className={cn("text-xs", MUTED)}>Saved.</span>}
        </div>

        <hr className="border-[color:var(--border)]" />

        <div className="grid gap-3 sm:grid-cols-2">
          <Single
            kind="icon"
            label="Icon"
            src={app.icon}
            busy={busy}
            onPick={(f) => upload("icon", f)}
            onUrl={(u) => fromUrl("icon", u)}
            onDrop={() => drop("icon")}
          />
          <Single
            kind="banner"
            label="Banner"
            src={app.banner}
            busy={busy}
            onPick={(f) => upload("banner", f)}
            onUrl={(u) => fromUrl("banner", u)}
            onDrop={() => drop("banner")}
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className={cn("text-[11px]", MUTED)}>
              Screenshots ({app.screenshots.length})
            </span>
            <Picker
              label="Add"
              icon={<Plus size={13} />}
              busy={busy === "upload:screenshot"}
              onPick={(f) => upload("screenshot", f)}
            />
          </div>
          <UrlField
            busy={busy === "upload:screenshot"}
            onSubmit={(u) => fromUrl("screenshot", u)}
          />
          {app.screenshots.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {app.screenshots.map((src) => {
                const file = fileNameOf(src);
                return (
                  <div key={src} className="relative shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt=""
                      className="h-28 rounded-[var(--radius)] border border-[color:var(--border)]"
                    />
                    <button
                      onClick={() => drop("screenshot", file)}
                      aria-label={`Remove ${file}`}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-1"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <p className="text-xs text-[color:var(--danger,#f87171)]">{error}</p>
        )}
        <p className={cn("text-[11px]", MUTED)}>
          The package id and the signer are read from the APK and are not
          editable here.
        </p>
      </div>
    </div>
  );
}

/**
 * The file name inside a media href.
 *
 * Hrefs are cache-busted (`…/1.jpg?v=123`), and the delete route matches on
 * what the directory holds — so the query has to come off first.
 */
function fileNameOf(href: string): string {
  const path = href.split("?")[0];
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * An image by address rather than by file dialog.
 *
 * Everything worth putting on a listing is already somewhere — a repo avatar,
 * a screenshot in a README, a Play thumbnail. Downloading it only to hand it
 * back through a file picker is a detour, and the server reads the bytes
 * either way.
 */
function UrlField({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (url: string) => Promise<boolean>;
}) {
  const [url, setUrl] = useState("");

  async function send() {
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    if (await onSubmit(trimmed)) setUrl("");
  }

  return (
    <div className="mt-2 flex gap-2">
      <input
        className={cn(FIELD, "min-w-0 text-xs")}
        placeholder="…or paste an image URL"
        value={url}
        spellCheck={false}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          // Inside a form this would submit it; there is no form, but the key
          // still belongs to this field rather than to the page.
          e.preventDefault();
          void send();
        }}
      />
      <button
        disabled={busy || !url.trim()}
        onClick={() => void send()}
        className={cn(
          buttonClass("secondary", "sm"),
          "shrink-0 disabled:opacity-60"
        )}
      >
        <Link2 size={13} />
        {busy ? "Fetching…" : "Fetch"}
      </button>
    </div>
  );
}

function Text({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className={cn("mb-1 block text-[11px]", MUTED)}>{label}</span>
      <input
        className={FIELD}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Picker({
  label,
  icon,
  busy,
  onPick,
}: {
  label: string;
  icon?: React.ReactNode;
  busy: boolean;
  onPick: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        disabled={busy}
        onClick={() => ref.current?.click()}
        className={cn(buttonClass("secondary", "sm"), "disabled:opacity-60")}
      >
        {icon}
        {busy ? "Uploading…" : label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so picking the same file twice still fires a change.
          e.target.value = "";
          if (file) onPick(file);
        }}
      />
    </>
  );
}

function Single({
  kind,
  label,
  src,
  busy,
  onPick,
  onUrl,
  onDrop,
}: {
  kind: string;
  label: string;
  src?: string;
  busy: string | null;
  onPick: (file: File) => void;
  onUrl: (url: string) => Promise<boolean>;
  onDrop: () => void;
}) {
  return (
    <div>
      <span className={cn("mb-1 block text-[11px]", MUTED)}>{label}</span>
      <div className="flex items-center gap-2">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            className="h-12 w-12 shrink-0 rounded-[var(--radius)] border border-[color:var(--border)] object-cover"
          />
        ) : (
          <div
            className={cn(
              "grid h-12 w-12 shrink-0 place-items-center rounded-[var(--radius)] border border-dashed border-[color:var(--border)] text-[10px]",
              MUTED
            )}
          >
            none
          </div>
        )}
        <Picker
          label="Replace"
          busy={busy === `upload:${kind}`}
          onPick={onPick}
        />
        {src && (
          <button
            disabled={busy === `drop:${kind}:`}
            onClick={onDrop}
            aria-label={`Remove ${label.toLowerCase()}`}
            className={cn(buttonClass("ghost", "sm"), "disabled:opacity-60")}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <UrlField busy={busy === `upload:${kind}`} onSubmit={onUrl} />
    </div>
  );
}
