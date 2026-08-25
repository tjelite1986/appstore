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
import { Link2, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { adminHeaders, readAdminToken } from "@/lib/admin-token";
import {
  buttonClass,
  CARD,
  MUTED,
  thumbBackground,
} from "@/components/primitives";
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

/** One picture an upstream holds, as `/api/apps/<slug>/artwork` describes it. */
type ArtworkCandidate = {
  kind: "icon" | "banner" | "screenshot";
  url: string;
  from: string;
  label: string;
  /** The bytes inlined, for the kinds worth looking at before choosing. */
  preview: string | null;
};

type ArtworkFind = {
  has: { icon: boolean; banner: boolean; screenshots: number };
  candidates: ArtworkCandidate[];
  looked: string[];
};

export type EditableApp = {
  slug: string;
  name: string;
  developer: string;
  category: string;
  tagline: string;
  description: string;
  icon?: string;
  /** Empty for "no plate chosen" — the fallback gradient, keyed on `seed`. */
  iconBackground?: string;
  /** Absent means "cover", which is what an icon does untold. */
  iconFit?: "cover" | "contain";
  /** Only so the preview here shows the same gradient the store does. */
  seed: number;
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
  // Its own state and its own save, not a sixth row in `form`: this is a
  // decision about a picture, made while looking at the picture, and it would
  // be odd for "Save text" to be the button that applies a colour.
  const [iconBg, setIconBg] = useState(app.iconBackground ?? "");
  const [iconFit, setIconFit] = useState(app.iconFit ?? "cover");
  const [art, setArt] = useState<ArtworkFind | null>(null);
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

  const saveIconBg = (value: string) =>
    run("iconbg", async () => {
      // "" is a deletion, so this is also how the gradient comes back.
      await call(`/api/apps/${app.slug}`, {
        method: "PATCH",
        body: JSON.stringify({ iconBackground: value }),
      });
      setIconBg(value);
    });

  const saveIconFit = (value: "cover" | "contain") =>
    run("iconfit", async () => {
      await call(`/api/apps/${app.slug}`, {
        method: "PATCH",
        body: JSON.stringify({ iconFit: value }),
      });
      setIconFit(value);
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

  const findArtwork = () =>
    run("artwork", async () => {
      setArt(await call(`/api/apps/${app.slug}/artwork`));
    });

  const useArtwork = (picks: { kind: string; url: string }[], label: string) =>
    run(label, async () => {
      await call(`/api/apps/${app.slug}/artwork`, {
        method: "POST",
        body: JSON.stringify({ picks }),
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

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className={cn("text-[11px]", MUTED)}>
              Artwork the upstream already has
            </span>
            <button
              onClick={findArtwork}
              disabled={busy === "artwork"}
              className={cn(
                buttonClass("secondary", "sm"),
                "shrink-0 disabled:opacity-60"
              )}
            >
              <Sparkles size={13} />
              {busy === "artwork" ? "Looking…" : "Find artwork"}
            </button>
          </div>
          {art && <Artwork find={art} busy={busy} onUse={useArtwork} />}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Single
            kind="icon"
            label="Icon"
            src={app.icon}
            preview={thumbBackground(app.seed, iconBg || undefined)}
            previewClassName={
              // p-1, not a percentage: padding percentages resolve against the
              // *parent's* width, and on a 48px thumbnail inside a full-width
              // card that swallows the whole image.
              iconFit === "contain" ? "object-contain p-1" : "object-cover"
            }
            busy={busy}
            onPick={(f) => upload("icon", f)}
            onUrl={(u) => fromUrl("icon", u)}
            onDrop={() => drop("icon")}
          >
            <IconLook
              value={iconBg}
              fit={iconFit}
              busy={busy === "iconbg"}
              fitBusy={busy === "iconfit"}
              onChange={setIconBg}
              onSave={saveIconBg}
              onFit={saveIconFit}
            />
          </Single>
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
 * What a repository and F-Droid hold for this app, offered rather than applied.
 *
 * The store cannot tell an icon somebody uploaded by hand from one a source
 * wrote, so it does not decide which of these are gaps — it says which kinds
 * the listing already has and lets the button read "Replace" where that is
 * what pressing it would do.
 */
function Artwork({
  find,
  busy,
  onUse,
}: {
  find: ArtworkFind;
  busy: string | null;
  onUse: (
    picks: { kind: string; url: string }[],
    label: string
  ) => Promise<boolean>;
}) {
  const singles = find.candidates.filter((c) => c.kind !== "screenshot");
  // Grouped by where they came from: an app on both GitHub and F-Droid offers
  // the same tour twice, and one "Add all" over the lot would put every
  // screenshot on the listing two times.
  const shotGroups = new Map<string, ArtworkCandidate[]>();
  for (const c of find.candidates) {
    if (c.kind !== "screenshot") continue;
    shotGroups.set(c.from, [...(shotGroups.get(c.from) ?? []), c]);
  }

  if (find.candidates.length === 0) {
    return (
      <p className={cn("text-[11px]", MUTED)}>
        Nothing found.{" "}
        {find.looked.length > 0
          ? `Looked at ${find.looked.join(", ")}.`
          : "This app has no repository and no package id to look one up by."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {singles.map((c) => (
        <div key={c.url} className="flex items-center gap-2">
          {c.preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={c.preview}
              alt=""
              className={cn(
                "shrink-0 rounded-[var(--radius)] border border-[color:var(--border)] object-cover",
                c.kind === "banner" ? "h-10 w-20" : "h-10 w-10"
              )}
            />
          ) : (
            <div
              className={cn(
                "grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius)] border border-dashed border-[color:var(--border)] text-[10px]",
                MUTED
              )}
            >
              ?
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs">
              {c.kind === "banner" ? "Banner" : "Icon"} · {c.from}
            </p>
            <p className={cn("truncate text-[11px]", MUTED)}>{c.label}</p>
          </div>
          <button
            disabled={busy === `art:${c.url}`}
            onClick={() => void onUse([{ kind: c.kind, url: c.url }], `art:${c.url}`)}
            className={cn(
              buttonClass("secondary", "sm"),
              "shrink-0 disabled:opacity-60"
            )}
          >
            {busy === `art:${c.url}`
              ? "Saving…"
              : (c.kind === "icon" ? find.has.icon : find.has.banner)
                ? "Replace"
                : "Use"}
          </button>
        </div>
      ))}

      {[...shotGroups].map(([from, shots]) => (
        <div key={from} className="flex items-center gap-2">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius)] border border-[color:var(--border)] text-xs">
            {shots.length}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs">
              {shots.length} screenshot{shots.length === 1 ? "" : "s"} · {from}
            </p>
            <p className={cn("truncate text-[11px]", MUTED)}>
              {shots[0].label}
            </p>
          </div>
          <button
            disabled={busy === `art:shots:${from}`}
            onClick={() =>
              void onUse(
                shots.map((c) => ({ kind: c.kind, url: c.url })),
                `art:shots:${from}`
              )
            }
            className={cn(
              buttonClass("secondary", "sm"),
              "shrink-0 disabled:opacity-60"
            )}
          >
            {busy === `art:shots:${from}` ? "Saving…" : "Add all"}
          </button>
        </div>
      ))}

      <p className={cn("text-[11px]", MUTED)}>
        From {find.looked.join(", ")}. Screenshots append; the list above is
        where you remove one.
      </p>
    </div>
  );
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
  preview,
  previewClassName,
  busy,
  onPick,
  onUrl,
  onDrop,
  children,
}: {
  kind: string;
  label: string;
  src?: string;
  /** What to put behind the thumbnail, so it previews what the store renders. */
  preview?: React.CSSProperties;
  /** How it meets its box, the other half of the same preview. */
  previewClassName?: string;
  busy: string | null;
  onPick: (file: File) => void;
  onUrl: (url: string) => Promise<boolean>;
  onDrop: () => void;
  children?: React.ReactNode;
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
            style={preview}
            className={cn(
              "h-12 w-12 shrink-0 rounded-[var(--radius)] border border-[color:var(--border)]",
              previewClassName ?? "object-cover"
            )}
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
      {children}
    </div>
  );
}

/**
 * The plate behind a transparent icon.
 *
 * ytdlnis and Obtainium ship a logo with no square of its own, and the store's
 * fallback gradient — which is there to stand in for artwork that is *missing*
 * — then colours an icon that is present, differently for every app. Choosing
 * one flat colour is the answer, and choosing it takes looking at the icon, so
 * it sits under the icon field and not in the text form above.
 *
 * The presets are the four that actually come up: the two neutrals a logo is
 * usually drawn for, this theme's own surfaces, and "None", which is the
 * transparent plate — the tile then shows whatever it is sitting on rather
 * than a colour of its own. "Default" is the way back to the gradient.
 */
const BG_PRESETS: { value: string; label: string; swatch: string }[] = [
  { value: "#ffffff", label: "White", swatch: "#ffffff" },
  { value: "#f2f2f2", label: "Off-white", swatch: "#f2f2f2" },
  { value: "#1b1420", label: "Dark", swatch: "#1b1420" },
  { value: "#000000", label: "Black", swatch: "#000000" },
  { value: "#00000000", label: "None", swatch: "transparent" },
];

function IconLook({
  value,
  fit,
  busy,
  fitBusy,
  onChange,
  onSave,
  onFit,
}: {
  value: string;
  fit: "cover" | "contain";
  busy: boolean;
  fitBusy: boolean;
  onChange: (v: string) => void;
  onSave: (v: string) => Promise<boolean>;
  onFit: (v: "cover" | "contain") => Promise<boolean>;
}) {
  // <input type="color"> has no way to say "nothing chosen" and no notion of
  // alpha, so it is seeded with the opaque part of the value and a plain text
  // field carries the rest. Typing is not validated here — the server owns
  // that, and a half-typed "#1b1" is not an error yet.
  const picker = /^#[0-9a-fA-F]{6}/.test(value) ? value.slice(0, 7) : "#ffffff";

  return (
    <div className="mt-2">
      <span className={cn("mb-1 block text-[11px]", MUTED)}>
        Background behind the icon
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {BG_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            disabled={busy}
            title={p.label}
            aria-label={p.label}
            aria-pressed={value.toLowerCase() === p.value}
            onClick={() => void onSave(p.value)}
            style={{ backgroundColor: p.swatch }}
            className={cn(
              "h-7 w-7 rounded-full border disabled:opacity-60",
              value.toLowerCase() === p.value
                ? "border-[color:var(--accent)] ring-2 ring-[color:var(--accent)]"
                : "border-[color:var(--border)]",
              // The transparent one needs to look transparent rather than look
              // like the card it is drawn on.
              p.swatch === "transparent" &&
                "bg-[repeating-conic-gradient(#8886_0_25%,transparent_0_50%)] bg-[length:8px_8px]"
            )}
          />
        ))}
        <input
          type="color"
          disabled={busy}
          value={picker}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Pick a colour"
          className="h-7 w-9 shrink-0 cursor-pointer rounded border border-[color:var(--border)] bg-transparent p-0.5 disabled:opacity-60"
        />
        <input
          className={cn(FIELD, "h-7 w-24 shrink-0 px-2 py-0 font-mono text-xs")}
          placeholder="#rrggbb"
          spellCheck={false}
          value={value}
          disabled={busy}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void onSave(value);
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void onSave(value)}
          className={cn(buttonClass("secondary", "sm"), "disabled:opacity-60")}
        >
          {busy ? "Saving…" : "Apply"}
        </button>
        {value && (
          <button
            type="button"
            disabled={busy}
            // Empty is the deletion: the key leaves the meta file and the
            // seeded gradient comes back.
            onClick={() => void onSave("")}
            className={cn(buttonClass("ghost", "sm"), "disabled:opacity-60")}
          >
            Default
          </button>
        )}
      </div>

      {/* The other half of the same decision. A plate is for an icon that does
          not fill its square, and the same icon is usually the one that should
          not be cropped to fit it either — a wide wordmark loses its ends to
          "Fill". Two states, so a segmented pair rather than a select. */}
      <span className={cn("mb-1 mt-2 block text-[11px]", MUTED)}>
        How the icon fills it
      </span>
      <div className="flex gap-1.5">
        {(
          [
            ["cover", "Fill", "Crops to the square"],
            ["contain", "Fit inside", "Whole icon, with a margin"],
          ] as const
        ).map(([mode, label, hint]) => (
          <button
            key={mode}
            type="button"
            disabled={fitBusy}
            title={hint}
            aria-pressed={fit === mode}
            onClick={() => void onFit(mode)}
            className={cn(
              buttonClass(fit === mode ? "primary" : "secondary", "sm"),
              "disabled:opacity-60"
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
