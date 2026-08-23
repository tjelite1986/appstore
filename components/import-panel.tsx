"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buttonClass,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/primitives";
import type { ImportSummary, ReviewItem } from "@/lib/import";

/**
 * The import folder and its review queue, on the Manage page.
 *
 * Client-side because it is the only interactive surface in the app, and in
 * its own file for the reason `thumb-image.tsx` exists: "use client" is
 * file-wide, so a `useState` sitting in a shared module puts that whole module
 * on the client and the server components importing it break — silently, in
 * the case of a plain string export.
 *
 * The admin token lives in localStorage rather than a cookie. There is no
 * session to hang it on yet (see `lib/admin.ts`), and a value the browser
 * never attaches to a request on its own cannot be used by a page on another
 * origin that talks this store into a POST.
 */

const TOKEN_KEY = "store-admin-token";
const CARD_CLS =
  "bg-[var(--card)] rounded-[var(--radius)] border border-[color:var(--border)]";
const MUTED_CLS = "text-[color:var(--muted)]";

const INPUT_CLS =
  "w-full rounded-full border border-[color:var(--border)] bg-[var(--card-2)] px-4 py-2 text-sm outline-none focus:border-[color:var(--accent)]";

/**
 * A real button wearing the store's button styling. `Button` from primitives
 * is a `<span>` — see `buttonClass` there for why the element is split off.
 */
function ActionButton({
  children,
  variant = "primary",
  size = "sm",
  type = "button",
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={buttonClass(
        variant,
        size,
        "disabled:cursor-not-allowed disabled:opacity-50"
      )}
    >
      {children}
    </button>
  );
}

type Props = {
  /** Where to drop files, shown so nobody has to look it up. */
  storePath: string;
  /** Files sitting in `_import/`, counted server-side on this render. */
  waiting: number;
  apps: { slug: string; name: string }[];
};

export default function ImportPanel({ storePath, waiting, apps }: Props) {
  const [token, setToken] = useState("");
  const [draftToken, setDraftToken] = useState("");
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setToken(window.localStorage.getItem(TOKEN_KEY) ?? "");
    } catch {
      /* private mode — the token just will not persist */
    }
  }, []);

  /** One place to turn a response into either data or a readable message. */
  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(path, {
        ...init,
        headers: {
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          "x-store-admin-token": token,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setToken("");
        try {
          window.localStorage.removeItem(TOKEN_KEY);
        } catch {
          /* ignore */
        }
        throw new Error("That token was not accepted");
      }
      if (!res.ok && res.status !== 409) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      return data;
    },
    [token]
  );

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const data = await call("/api/import/review");
      setItems(data.items ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [call, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function scan() {
    setBusy("scan");
    setError(null);
    try {
      setSummary(await call("/api/import/scan", { method: "POST" }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function decide(
    id: string,
    action: string,
    opts: { slug?: string; force?: boolean } = {}
  ) {
    setBusy(id);
    setError(null);
    try {
      const result = await call("/api/import/review", {
        method: "POST",
        body: JSON.stringify({ id, action, ...opts }),
      });
      if (!result.ok) setError(result.error ?? "That did not work");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (!token) {
    return (
      <div className={cn(CARD_CLS, "flex flex-col gap-2 p-3.5")}>
        <p className="text-sm">Admin token</p>
        <p className={cn("text-xs", MUTED_CLS)}>
          The import routes are gated on <code>STORE_ADMIN_TOKEN</code> until
          there is a login. Kept in this browser only.
        </p>
        <form
          className="mt-1 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draftToken) return;
            try {
              window.localStorage.setItem(TOKEN_KEY, draftToken);
            } catch {
              /* ignore */
            }
            setToken(draftToken);
            setDraftToken("");
          }}
        >
          <input
            type="password"
            className={INPUT_CLS}
            value={draftToken}
            onChange={(e) => setDraftToken(e.target.value)}
            placeholder="Token"
            autoComplete="off"
          />
          <ActionButton size="sm" type="submit">
            Unlock
          </ActionButton>
        </form>
        {error && <p className="text-xs text-[color:var(--danger,#f87171)]">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className={cn(CARD_CLS, "flex flex-col gap-2 p-3.5")}>
        <p className="text-sm">
          Drop <span className="font-mono text-xs">.apk</span> or{" "}
          <span className="font-mono text-xs">.xapk</span> files here:
        </p>
        <p className={cn("break-all font-mono text-xs", MUTED_CLS)}>{storePath}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <ActionButton size="sm" variant="secondary" onClick={scan} disabled={busy === "scan"}>
            <Upload size={13} /> {busy === "scan" ? "Scanning…" : "Scan now"}
          </ActionButton>
          <ActionButton size="sm" variant="secondary" onClick={() => void refresh()}>
            <RefreshCw size={13} /> Refresh
          </ActionButton>
          <span className={cn("text-xs", MUTED_CLS)}>
            {waiting === 0
              ? "Nothing waiting"
              : `${waiting} ${waiting === 1 ? "file" : "files"} waiting`}
          </span>
        </div>
        {/* A file that is only a minute old is skipped on purpose, so the
            summary has to say so — otherwise a fresh drop looks ignored. */}
        {summary && (
          <ul className={cn("mt-1 flex flex-col gap-0.5 text-xs", MUTED_CLS)}>
            {summary.imported.map((r) => (
              <li key={`i-${r.file}`}>
                Imported {r.app} {r.version}
                {r.promoted ? " — now the current version" : ""}
              </li>
            ))}
            {summary.parked.map((r) => (
              <li key={`p-${r.file}`}>
                Held for review: {r.file} — {r.reason}
              </li>
            ))}
            {summary.skipped.map((r) => (
              <li key={`s-${r.file}`}>
                Skipped {r.file} — {r.note}
              </li>
            ))}
            {summary.scanned === 0 && <li>The import folder is empty</li>}
          </ul>
        )}
      </div>

      {error && (
        <p className="px-1 text-xs text-[color:var(--danger,#f87171)]">{error}</p>
      )}

      {items && items.length > 0 && (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <ReviewCard
              key={item.id}
              item={item}
              apps={apps}
              busy={busy === item.id}
              onDecide={decide}
            />
          ))}
        </div>
      )}
      {items && items.length === 0 && (
        <p className={cn("px-1 text-xs", MUTED_CLS)}>Nothing waiting for a decision.</p>
      )}
    </div>
  );
}

const REASONS: Record<string, string> = {
  no_match: "No app in the catalog looks like this",
  ambiguous: "More than one app could be the target",
  duplicate: "That version exists already, with different content",
  signer_mismatch: "Signed with a different key than the one pinned",
};

function ReviewCard({
  item,
  apps,
  busy,
  onDecide,
}: {
  item: ReviewItem;
  apps: { slug: string; name: string }[];
  busy: boolean;
  onDecide: (
    id: string,
    action: string,
    opts?: { slug?: string; force?: boolean }
  ) => void;
}) {
  const [target, setTarget] = useState(
    item.matchedSlug ?? item.suggestions[0]?.slug ?? ""
  );
  const mb = (item.fileSize / 1024 / 1024).toFixed(1);

  return (
    <div className={cn(CARD_CLS, "flex flex-col gap-2 p-3.5")}>
      <div>
        <p className="break-all text-sm">{item.originalName}</p>
        <p className={cn("text-xs", MUTED_CLS)}>
          {[
            item.parsedVersion && `v${item.parsedVersion}`,
            item.packageName,
            `${mb} MB`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className={cn("mt-1 text-xs", MUTED_CLS)}>
          {REASONS[item.reason] ?? item.reason}
        </p>
      </div>

      <select
        className={INPUT_CLS}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        disabled={busy}
      >
        <option value="">Attach to…</option>
        {/* Suggestions first and named as such — the scan's own ranking is
            worth more than alphabetical order when the list is long. */}
        {item.suggestions.map((s) => (
          <option key={`s-${s.slug}`} value={s.slug}>
            {s.name} — {s.why}
          </option>
        ))}
        {apps
          .filter((a) => !item.suggestions.some((s) => s.slug === a.slug))
          .map((a) => (
            <option key={a.slug} value={a.slug}>
              {a.name}
            </option>
          ))}
      </select>

      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          size="sm"
          disabled={busy || !target}
          onClick={() => onDecide(item.id, "attach", { slug: target })}
        >
          Attach
        </ActionButton>
        <ActionButton
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => onDecide(item.id, "create-new")}
        >
          New app
        </ActionButton>
        {/* Only offered where it is the actual obstacle: re-pinning the signer
            is how a repackaged APK would take over an app, so it must be a
            deliberate answer to a refusal, never a general "force" button. */}
        {(item.reason === "signer_mismatch" || item.reason === "duplicate") && (
          <ActionButton
            size="sm"
            variant="secondary"
            disabled={busy || !target}
            onClick={() => onDecide(item.id, "attach", { slug: target, force: true })}
          >
            Attach anyway
          </ActionButton>
        )}
        <ActionButton
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => onDecide(item.id, "discard")}
        >
          Discard
        </ActionButton>
      </div>
    </div>
  );
}
