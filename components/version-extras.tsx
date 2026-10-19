"use client";

/**
 * Adding an OBB or a cache archive to a version — the admin half of
 * `lib/extras.ts`.
 *
 * The file goes up in the chunks the store asks for, one after another. A
 * chunk that fails is retried from the offset the store says it holds, and
 * the upload id is remembered per file, so reloading the page and picking the
 * same file again carries on where it stopped instead of sending a gigabyte
 * twice.
 *
 * Closed until asked for, like the other admin panels on a public page.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Trash2, Upload, X } from "lucide-react";
import { adminCall } from "@/lib/admin-call";
import { readAdminToken } from "@/lib/admin-token";
import { buttonClass, CARD, MUTED } from "@/components/primitives";
import { cn } from "@/lib/utils";

type Extra = { file: string; size: string };

const RETRIES = 5;

function resumeKey(slug: string, version: string, file: File): string {
  return `store-extra-upload:${slug}:${version}:${file.name}:${file.size}`;
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

export default function VersionExtras({
  slug,
  versions,
}: {
  slug: string;
  /** Newest first, with what each already carries. */
  versions: { version: string; extras: Extra[] }[];
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [version, setVersion] = useState(versions[0]?.version ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const stop = useRef(false);
  const router = useRouter();

  useEffect(() => setToken(readAdminToken()), []);

  const path = `/api/apps/${encodeURIComponent(slug)}/extras`;
  const opts = { hint: "Sign in as an admin, or unlock Manage", accept: [409] };

  async function upload() {
    if (!file || !version) return;
    setBusy(true);
    setError(null);
    setDone(null);
    stop.current = false;
    const key = resumeKey(slug, version, file);
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
            body: JSON.stringify({ version, file: file.name, bytes: file.size }),
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
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(v: string, name: string) {
    if (!window.confirm(`Remove ${name} from ${v}? It is moved to _discarded, not deleted.`)) {
      return;
    }
    setError(null);
    try {
      await adminCall(
        `${path}?v=${encodeURIComponent(v)}&file=${encodeURIComponent(name)}`,
        { method: "DELETE" },
        token,
        opts
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!open) {
    return (
      <div className="px-[var(--pad)]">
        <button
          onClick={() => setOpen(true)}
          className={cn(buttonClass("secondary", "sm"), "w-full justify-center")}
        >
          <Archive size={14} />
          OBB / cache files
        </button>
      </div>
    );
  }

  const pct = progress ? Math.floor((progress.sent / progress.total) * 100) : 0;

  return (
    <div className="px-[var(--pad)]">
      <div className={cn(CARD, "space-y-3 p-3")}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">OBB / cache files</p>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className={cn("rounded-full p-1", MUTED)}
          >
            <X size={15} />
          </button>
        </div>

        <p className={cn("text-xs leading-relaxed", MUTED)}>
          Game data that goes beside the APK: an .obb, or a .zip people unpack
          themselves. It is stored with the version it is for and offered on
          this page under that version.
        </p>

        {versions.some((v) => v.extras.length > 0) && (
          <ul className="space-y-1.5">
            {versions.flatMap((v) =>
              v.extras.map((x) => (
                <li key={`${v.version}/${x.file}`} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono">{v.version}</span> · {x.file} · {x.size}
                  </span>
                  <button
                    onClick={() => void remove(v.version, x.file)}
                    aria-label={`Remove ${x.file}`}
                    className={cn("rounded-full p-1", MUTED)}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))
            )}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          <select
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            disabled={busy}
            className="rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-transparent px-2 py-1.5 font-mono text-xs"
          >
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                {v.version}
              </option>
            ))}
          </select>
          <input
            type="file"
            accept=".obb,.zip"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="min-w-0 flex-1 text-xs"
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
            {busy ? "Uploading…" : file ? `Upload ${file.name}` : "Pick a file"}
          </button>
          {busy && (
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

        {done && <p className="text-xs text-[color:var(--ok)]">{done} added.</p>}
        {error && <p className="text-xs text-[color:var(--danger)]">{error}</p>}
      </div>
    </div>
  );
}
