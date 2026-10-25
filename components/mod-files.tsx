"use client";

/**
 * The admin half of a mod's page: upload its archives, take one off, pull
 * Nexus's current words again, point the listing at another Nexus mod, or
 * take the whole mod off the shelf.
 *
 * Uploads go up in the chunks the store asks for, like OBB files
 * (`components/version-extras.tsx`): a failed chunk is retried from the
 * offset the store says it holds, and the upload id is remembered per file,
 * so picking the same file again after a reload carries on where it stopped.
 *
 * Each file carries a name and a version of its own: one Nexus page often
 * holds several mods, and the page shows every file as its own card.
 *
 * Closed until asked for, like the other admin panels on a public page.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Check,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { adminCall } from "@/lib/admin-call";
import { readAdminToken } from "@/lib/admin-token";
import { buttonClass, CARD, MUTED, NOTE } from "@/components/primitives";
import { cn } from "@/lib/utils";
import type { NexusMod } from "@/lib/sources/nexus";

type Section = "main" | "optional";

function SectionSelect({
  value,
  onChange,
  disabled,
}: {
  value: Section;
  onChange: (value: Section) => void;
  disabled: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Section)}
      disabled={disabled}
      aria-label="Section"
      className="rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-transparent px-2 py-1.5 text-xs"
    >
      <option value="main">Main files</option>
      <option value="optional">Optional files</option>
    </select>
  );
}

const RETRIES = 5;

function resumeKey(base: string, file: File): string {
  return `store-mod-upload:${base}:${file.name}:${file.size}`;
}

function remembered(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, id: string | null) {
  try {
    if (id) window.localStorage.setItem(key, id);
    else window.localStorage.removeItem(key);
  } catch {
    /* private mode: no resume across reloads, the upload still works */
  }
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

export default function ModFiles({
  game,
  mod,
  version,
  fromNexus,
  files,
  accept,
}: {
  game: string;
  mod: string;
  /** The mod's current version — the default label for a new file. */
  version: string;
  fromNexus: boolean;
  files: { file: string; name: string; section: Section; size: string; version: string }[];
  /** The extensions the store takes, `.zip` style. */
  accept: string[];
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState(version);
  const [name, setName] = useState("");
  const [section, setSection] = useState<Section>("main");
  const [editing, setEditing] = useState<{
    file: string;
    name: string;
    version: string;
    section: Section;
  } | null>(null);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [switchUrl, setSwitchUrl] = useState("");
  const [switchTo, setSwitchTo] = useState<NexusMod | null>(null);
  const stop = useRef(false);
  const router = useRouter();

  useEffect(() => setToken(readAdminToken()), []);
  useEffect(() => setLabel(version), [version]);

  const base = `/api/mods/${game}/${mod}`;
  const path = `${base}/files`;
  const opts = { hint: "Sign in as an admin, or unlock Manage", accept: [409] };

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setDone(null);
    setProgress(null);
    stop.current = false;
    const key = resumeKey(base, file);
    try {
      let id = remembered(key);
      let received = 0;
      let chunk = 32 * 1024 * 1024;
      if (id) {
        try {
          const status = await adminCall(`${path}?id=${id}`, undefined, token, opts);
          if (status.bytes === file.size) received = status.received;
          else id = null;
        } catch {
          id = null; // finished, cancelled or cleared as stale: start over
        }
      }
      if (!id) {
        const started = await adminCall(
          path,
          {
            method: "POST",
            body: JSON.stringify({
              file: file.name,
              bytes: file.size,
              name,
              version: label,
              section,
            }),
          },
          token,
          opts
        );
        id = started.id as string;
        chunk = started.chunkBytes;
        received = 0;
        remember(key, id);
      }

      let failures = 0;
      setProgress({ sent: received, total: file.size });
      while (received < file.size) {
        if (stop.current) throw new Error("Paused — pick the same file again to carry on");
        try {
          const res = await adminCall(
            `${path}?id=${id}&offset=${received}`,
            { method: "PUT", body: file.slice(received, received + chunk) },
            token,
            opts
          );
          // A 409 is the store saying where it really is; carry on from there.
          received = res.received;
          failures = 0;
          setProgress({ sent: received, total: file.size });
          if (res.done) break;
        } catch (err) {
          if (++failures > RETRIES) throw err;
          await new Promise((r) => setTimeout(r, 2000 * failures));
          const status = await adminCall(`${path}?id=${id}`, undefined, token, opts).catch(
            () => null
          );
          if (status) received = status.received;
        }
      }
      remember(key, null);
      setDone(file.name);
      setFile(null);
      setName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function act(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const removeFile = (name: string) =>
    window.confirm(`Remove ${name}? It is moved to _discarded, not deleted.`) &&
    void act(async () => {
      await adminCall(`${path}?file=${encodeURIComponent(name)}`, { method: "DELETE" }, token, opts);
      router.refresh();
    });

  const saveLabel = () =>
    editing &&
    void act(async () => {
      await adminCall(path, { method: "PATCH", body: JSON.stringify(editing) }, token, opts);
      setEditing(null);
      router.refresh();
    });

  const refresh = () =>
    void act(async () => {
      await adminCall(base, { method: "POST", body: JSON.stringify({ refresh: true }) }, token, opts);
      router.refresh();
    });

  // Looked up and shown first, like adding one: the listing's words are about
  // to become this mod's.
  const lookUpSwitch = () =>
    void act(async () => {
      setSwitchTo(null);
      const res = await adminCall(
        `/api/mods/nexus?url=${encodeURIComponent(switchUrl.trim())}`,
        undefined,
        token,
        opts
      );
      setSwitchTo(res.mod);
    });

  const switchMod = () =>
    void act(async () => {
      const res = await adminCall(
        base,
        { method: "POST", body: JSON.stringify({ nexusUrl: switchUrl.trim() }) },
        token,
        { ...opts, accept: [] }
      );
      setSwitchTo(null);
      setSwitchUrl("");
      router.push(`/mods/${res.game}/${res.mod}`);
      router.refresh();
    });

  const removeMod = () =>
    window.confirm("Take this mod off the shelf? Its folder is moved to _discarded, not deleted.") &&
    void act(async () => {
      await adminCall(base, { method: "DELETE" }, token, opts);
      router.push(`/mods/${game}`);
      router.refresh();
    });

  if (!open) {
    return (
      <div className="px-[var(--pad)]">
        <button
          onClick={() => setOpen(true)}
          className={cn(buttonClass("secondary", "sm"), "w-full justify-center")}
        >
          <Wrench size={14} />
          Manage this mod
        </button>
      </div>
    );
  }

  const pct = progress ? Math.floor((progress.sent / progress.total) * 100) : 0;

  return (
    <div className="px-[var(--pad)]">
      <div className={cn(CARD, "space-y-3 p-3")}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Manage this mod</p>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className={cn("rounded-full p-1", MUTED)}
          >
            <X size={15} />
          </button>
        </div>

        <p className={NOTE}>
          Upload the mod as an archive ({accept.filter((e) => [".zip", ".7z", ".rar"].includes(e)).join(", ")}),
          and beside it anything it is used with — a launcher .apk, an .obb.
          A file with the same name replaces the old one, which is moved to
          _discarded.
        </p>

        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map((f) =>
              editing?.file === f.file ? (
                <li key={f.file} className="flex flex-wrap items-center gap-2 text-xs">
                  <input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="Name"
                    disabled={busy}
                    className="min-w-[8rem] flex-1 rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-transparent px-2 py-1.5 text-xs"
                  />
                  <input
                    value={editing.version}
                    onChange={(e) => setEditing({ ...editing, version: e.target.value })}
                    placeholder="Version"
                    disabled={busy}
                    className="w-24 rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-transparent px-2 py-1.5 font-mono text-xs"
                  />
                  <SectionSelect
                    value={editing.section}
                    onChange={(value) => setEditing({ ...editing, section: value })}
                    disabled={busy}
                  />
                  <button
                    onClick={saveLabel}
                    disabled={busy}
                    aria-label="Save"
                    className={cn("rounded-full p-1", MUTED)}
                  >
                    <Check size={13} />
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    disabled={busy}
                    aria-label="Cancel"
                    className={cn("rounded-full p-1", MUTED)}
                  >
                    <X size={13} />
                  </button>
                </li>
              ) : (
                <li key={f.file} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold">{f.name}</span>
                    {f.version && <span className="font-mono"> · {f.version}</span>}
                    <span className={MUTED}>
                      {" "}
                      · {f.section === "optional" ? "Optional" : "Main"} · {f.file} · {f.size}
                    </span>
                  </span>
                  <button
                    onClick={() =>
                      setEditing({
                        file: f.file,
                        name: f.name,
                        version: f.version,
                        section: f.section,
                      })
                    }
                    disabled={busy}
                    aria-label={`Rename ${f.file}`}
                    className={cn("rounded-full p-1", MUTED)}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => removeFile(f.file)}
                    disabled={busy}
                    aria-label={`Remove ${f.file}`}
                    className={cn("rounded-full p-1", MUTED)}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              )
            )}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (file name if empty)"
            disabled={busy}
            className="min-w-[10rem] flex-1 rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-transparent px-2 py-1.5 text-xs"
          />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Version"
            disabled={busy}
            className="w-24 rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-transparent px-2 py-1.5 font-mono text-xs"
          />
          <SectionSelect value={section} onChange={setSection} disabled={busy} />
          <input
            type="file"
            accept={accept.join(",")}
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full min-w-0 text-xs"
          />
        </div>

        {progress && (busy || error) && (
          <div className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--border)]">
              <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
            </div>
            <p className={cn("text-xs", MUTED)}>
              {mb(progress.sent)} of {mb(progress.total)} · {pct}%
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => void upload()}
            disabled={!file || busy}
            className={cn(buttonClass("primary", "sm"), "flex-1 justify-center disabled:opacity-50")}
          >
            <Upload size={14} />
            {busy && progress ? "Uploading…" : file ? `Upload ${file.name}` : "Pick a file"}
          </button>
          {busy && progress && (
            <button
              onClick={() => {
                stop.current = true;
              }}
              className={buttonClass("secondary", "sm")}
            >
              Pause
            </button>
          )}
        </div>

        <div className="space-y-2 border-t border-[color:var(--border)] pt-3">
          <p className={NOTE}>
            {fromNexus ? "Wrong mod? Point this listing at another" : "Link this listing to"} a
            Nexus Mods page. The uploaded files stay; the name, words and picture
            become that mod&apos;s.
          </p>
          <div className="flex gap-2">
            <input
              value={switchUrl}
              onChange={(e) => {
                setSwitchUrl(e.target.value);
                setSwitchTo(null);
              }}
              placeholder="https://www.nexusmods.com/<game>/mods/<id>"
              disabled={busy}
              className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-transparent px-2 py-1.5 text-xs"
            />
            <button
              onClick={lookUpSwitch}
              disabled={busy || !switchUrl.trim()}
              className={cn(buttonClass("secondary", "sm"), "disabled:opacity-50")}
            >
              <Search size={14} /> Look up
            </button>
          </div>
          {switchTo && (
            <div className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-semibold">{switchTo.name}</span>
                {switchTo.author && ` · ${switchTo.author}`}
                {switchTo.version && <span className="font-mono"> · {switchTo.version}</span>}
              </span>
              <button
                onClick={switchMod}
                disabled={busy}
                className={cn(buttonClass("primary", "sm"), "disabled:opacity-50")}
              >
                <ArrowLeftRight size={14} /> Switch to this mod
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-[color:var(--border)] pt-3">
          {fromNexus && (
            <button
              onClick={refresh}
              disabled={busy}
              className={cn(buttonClass("secondary", "sm"), "disabled:opacity-50")}
            >
              <RefreshCw size={14} /> Refresh from Nexus
            </button>
          )}
          <button
            onClick={() => removeMod()}
            disabled={busy}
            className={cn(buttonClass("ghost", "sm"), "text-[color:var(--danger)] disabled:opacity-50")}
          >
            <Trash2 size={14} /> Remove mod
          </button>
        </div>

        {done && <p className="text-xs text-[color:var(--ok)]">{done} added.</p>}
        {error && <p className="text-xs text-[color:var(--danger)]">{error}</p>}
      </div>
    </div>
  );
}
