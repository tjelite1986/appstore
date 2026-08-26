"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Search, Send, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buttonClass,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/primitives";
import type { ImportSummary, ReviewItem } from "@/lib/import";
import type { PlayListing } from "@/lib/sources/play";
import type { TelegramRun } from "@/lib/telegram";
import { ADMIN_TOKEN_KEY, adminHeaders } from "@/lib/admin-token";
import { withBasePath } from "@/lib/base-path";

/**
 * Everything on Manage that writes to the library: the Telegram feed, the
 * import folder, and the review queue the two of them fill.
 *
 * Client-side because it is the only interactive surface in the app, and in
 * its own file for the reason `thumb-image.tsx` exists: "use client" is
 * file-wide, so a `useState` sitting in a shared module puts that whole module
 * on the client and the server components importing it break — silently, in
 * the case of a plain string export.
 *
 * Getting in is normally not this panel's problem: an admin signed in to
 * elite-v2 is signed in here too, because that session cookie is scoped to the
 * parent domain both hosts share. So the panel asks for the queue first and
 * only falls back to the token form when the answer is 401 — someone browsing
 * the store logged out, or a second browser.
 *
 * That fallback token lives in localStorage rather than a cookie: it is the
 * same shared secret the host timers use (see `lib/admin.ts`), and a value the
 * browser never attaches to a request on its own cannot be used by a page on
 * another origin that talks this store into a POST.
 */

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

/**
 * A Play listing offered for a parked file, icon and all.
 *
 * The icon arrives inlined rather than as a URL to fetch: `img-src` is
 * `'self'`, the proxy that would serve it is admin-gated, and an `<img>` sends
 * no header — so the card would show a broken image to whoever came in with
 * the shared token instead of a session.
 */
type Candidate = {
  listing: PlayListing;
  iconDataUrl: string | null;
};

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
  // null while the first request is still out: the panel cannot tell "signed
  // in through elite-v2" from "needs a token" until something has answered,
  // and guessing either way flashes the wrong UI on every load.
  const [locked, setLocked] = useState<boolean | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    try {
      setToken(window.localStorage.getItem(ADMIN_TOKEN_KEY) ?? "");
    } catch {
      /* private mode — the token just will not persist */
    }
    // Reading localStorage has to wait for the client (the server render has
    // no such thing, and seeding state from it would not match on hydration),
    // so the first fetch waits for this rather than firing tokenless and
    // bouncing off a 401 that a stored token would have passed.
    setHydrated(true);
  }, []);

  /** One place to turn a response into either data or a readable message. */
  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(withBasePath(path), {
        ...init,
        headers: {
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          // Omitted when there is none: the session cookie the browser sends
          // on its own is the normal way in, and an empty header would only
          // ever be a failed guess at the shared token.
          ...adminHeaders(token),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setToken("");
        setLocked(true);
        try {
          window.localStorage.removeItem(ADMIN_TOKEN_KEY);
        } catch {
          /* ignore */
        }
        throw new Error(
          token
            ? "That token was not accepted"
            : "Sign in to elite-v2 as an admin, or use a token"
        );
      }
      if (!res.ok && res.status !== 409) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      return data;
    },
    [token]
  );

  const refresh = useCallback(async () => {
    try {
      const [data, tg] = await Promise.all([
        call("/api/import/review"),
        call("/api/telegram"),
      ]);
      setItems(data.items ?? []);
      setTelegram(tg);
      setLocked(false);
      setError(null);
      // The count of files still waiting is rendered by the server component
      // around this one, so it goes stale the moment a scan moves anything.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [call, router]);

  useEffect(() => {
    if (!hydrated) return;
    void refresh();
  }, [hydrated, refresh]);

  // A sync downloads up to 400 MB a file and then waits out the importer's
  // quiet period, so it finishes long after the request that started it.
  useEffect(() => {
    if (!telegram?.running) return;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [telegram?.running, refresh]);

  async function syncTelegram() {
    setBusy("telegram");
    setError(null);
    try {
      setTelegram(await call("/api/telegram", { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

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

  /**
   * Ask Play what it has for a package id, without writing anything.
   *
   * The route answers 404 with a sentence when there is no such listing, and
   * `call` turns that into a thrown message — which is the right shape here:
   * "Play has no listing for that package id" is the answer the card shows.
   */
  const lookupPlay = useCallback(
    async (packageId: string): Promise<Candidate> => {
      const data = await call(
        `/api/sources/play?packageId=${encodeURIComponent(packageId)}`
      );
      if (!data.listing) throw new Error(data.error ?? "Play returned nothing");
      return {
        listing: data.listing as PlayListing,
        iconDataUrl: typeof data.iconDataUrl === "string" ? data.iconDataUrl : null,
      };
    },
    [call]
  );

  async function decide(
    id: string,
    action: string,
    opts: { slug?: string; force?: boolean; fillFrom?: string } = {}
  ) {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const result = await call("/api/import/review", {
        method: "POST",
        body: JSON.stringify({ id, action, ...opts }),
      });
      if (!result.ok) setError(result.error ?? "That did not work");
      // The card that would have shown this is gone by the time the answer
      // arrives — the item leaves the queue — so what the fill wrote is said
      // here or nowhere.
      else if (result.filled) setNotice(describeFill(result));
      else if (result.fillError) {
        setNotice(`${result.appName} was created, but Play did not answer: ${result.fillError}`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (locked === null) {
    return (
      <div className={cn(CARD_CLS, "p-3.5")}>
        <p className={cn("text-sm", MUTED_CLS)}>Checking your access…</p>
      </div>
    );
  }

  if (locked) {
    return (
      <div className={cn(CARD_CLS, "flex flex-col gap-2 p-3.5")}>
        <p className="text-sm">Sign in to import</p>
        <p className={cn("text-xs", MUTED_CLS)}>
          Signing in to elite-v2 as an admin unlocks this panel — the two share
          one login. Failing that, the shared <code>STORE_ADMIN_TOKEN</code>
          also opens it, and is kept in this browser only.
        </p>
        <form
          className="mt-1 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draftToken) return;
            try {
              window.localStorage.setItem(ADMIN_TOKEN_KEY, draftToken);
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
      {telegram && <TelegramCard status={telegram} busy={busy === "telegram"} onSync={syncTelegram} />}

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
      {notice && <p className={cn("px-1 text-xs", MUTED_CLS)}>{notice}</p>}

      {items && items.length > 0 && (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <ReviewCard
              // The verdict is recomputed on every read, so a card whose
              // match changed has to remount — its target dropdown seeds from
              // the match and would otherwise keep the stale choice.
              key={`${item.id}:${item.matchedSlug ?? ""}`}
              item={item}
              apps={apps}
              busy={busy === item.id}
              onDecide={decide}
              onLookup={lookupPlay}
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

type TelegramStatus = {
  configured: boolean;
  running: boolean;
  channels: { name: string; cursor: number; lastSyncedAt?: string; lastStatus?: string }[];
  run: TelegramRun;
};

/**
 * The Telegram feed: what it last did, and a button to make it do it again.
 *
 * The run log is shown rather than a status word because the interesting
 * outcomes are all "nothing happened, and here is which nothing" — no new
 * posts, a file over the size cap, a transfer that failed and will be retried
 * next run.
 */
function TelegramCard({
  status,
  busy,
  onSync,
}: {
  status: TelegramStatus;
  busy: boolean;
  onSync: () => void;
}) {
  const when = status.run.finishedAt ?? status.run.startedAt;
  return (
    <div className={cn(CARD_CLS, "flex flex-col gap-2 p-3.5")}>
      <p className="text-sm">Telegram feed</p>
      {!status.configured ? (
        <p className={cn("text-xs", MUTED_CLS)}>
          Not configured — <code>TELEGRAM_API_ID</code>,{" "}
          <code>TELEGRAM_API_HASH</code> and <code>TELEGRAM_SESSION</code> are
          unset.
        </p>
      ) : (
        <p className={cn("text-xs", MUTED_CLS)}>
          {status.channels
            .map(
              (c) =>
                `@${c.name} — ${c.cursor ? `read up to post ${c.cursor}` : "never synced"}`
            )
            .join(" · ")}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <ActionButton
          variant="secondary"
          disabled={!status.configured || busy || status.running}
          onClick={onSync}
        >
          <Send size={13} />{" "}
          {status.running ? "Syncing…" : busy ? "Starting…" : "Sync now"}
        </ActionButton>
        {when && !status.running && (
          <span className={cn("text-xs", MUTED_CLS)}>
            Last run {new Date(when).toLocaleString("sv-SE")} —{" "}
            {status.run.downloaded} file(s)
          </span>
        )}
      </div>
      {status.run.log.length > 0 && (
        <ul className={cn("mt-1 flex flex-col gap-0.5 text-xs", MUTED_CLS)}>
          {status.run.log.slice(-6).map((line, i) => (
            <li key={i} className="break-all">
              {line.replace(/^\S+ /, "")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const REASONS: Record<string, string> = {
  no_match: "No app in the catalog looks like this",
  ambiguous: "More than one app could be the target",
  duplicate: "That version exists already, with different content",
  signer_mismatch: "Signed with a different key than the one pinned",
  // Recomputed at read time: nothing fitted when it landed, something does
  // now — usually because the app was added to the catalog since.
  now_matches: "Matches an app that has been added since",
};

/** "Created Shazam — wrote 5 fields and 8 screenshots from Play." */
function describeFill(result: any): string {
  const f = result.filled;
  const parts: string[] = [];
  if (f.written.length) parts.push(`${f.written.length} fields`);
  if (f.images.icon) parts.push("an icon");
  if (f.images.banner) parts.push("a banner");
  if (f.images.screenshots) parts.push(`${f.images.screenshots} screenshots`);
  const wrote = parts.length ? `wrote ${parts.join(", ")}` : "found nothing to add";
  const kept = f.kept.length ? ` It kept ${f.kept.join(", ")}.` : "";
  return `Created ${result.appName} — ${wrote} from Play.${kept}`;
}

/**
 * A Play listing, offered as the identity of a file about to become an app.
 *
 * Shown rather than applied, because a package id is not proof. An APK built
 * with a wrapper — GoNative and its like — carries the wrapper's id, and the
 * listing under it belongs to whoever published the wrapper's own app. So the
 * name, the developer and the first screenshot are all here to be recognised
 * or rejected before anything is written, and rejecting it still leaves the
 * plain "New app" button doing what it always did.
 */
function PlayCandidate({
  candidate: { listing, iconDataUrl },
  busy,
  onUse,
  onDismiss,
}: {
  candidate: Candidate;
  busy: boolean;
  onUse: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-[var(--radius)] border border-[color:var(--border)] bg-[var(--card-2)] p-3"
      )}
    >
      <div className="flex items-start gap-3">
        {iconDataUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={iconDataUrl}
            alt=""
            className="h-11 w-11 shrink-0 rounded-[12px] object-cover"
          />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm">{listing.name}</p>
          <p className={cn("truncate text-xs", MUTED_CLS)}>
            {[listing.developer, listing.category].filter(Boolean).join(" · ")}
          </p>
          {listing.tagline && (
            <p className={cn("mt-1 line-clamp-2 text-xs", MUTED_CLS)}>
              {listing.tagline}
            </p>
          )}
        </div>
      </div>
      <p className={cn("text-xs", MUTED_CLS)}>
        {[
          listing.description ? "a description" : null,
          listing.iconUrl ? "an icon" : null,
          listing.bannerUrl ? "a banner" : null,
          listing.screenshotUrls.length
            ? `${listing.screenshotUrls.length} screenshots`
            : null,
        ]
          .filter(Boolean)
          .join(", ") || "nothing but a name"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton size="sm" disabled={busy} onClick={onUse}>
          New app from this
        </ActionButton>
        <ActionButton size="sm" variant="secondary" disabled={busy} onClick={onDismiss}>
          Not this app
        </ActionButton>
      </div>
    </div>
  );
}

function ReviewCard({
  item,
  apps,
  busy,
  onDecide,
  onLookup,
}: {
  item: ReviewItem;
  apps: { slug: string; name: string }[];
  busy: boolean;
  onDecide: (
    id: string,
    action: string,
    opts?: { slug?: string; force?: boolean; fillFrom?: string }
  ) => void;
  onLookup: (packageId: string) => Promise<Candidate>;
}) {
  const [target, setTarget] = useState(
    item.matchedSlug ?? item.suggestions[0]?.slug ?? ""
  );
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const mb = (item.fileSize / 1024 / 1024).toFixed(1);

  async function lookUp() {
    if (!item.packageName) return;
    setLooking(true);
    setLookupError(null);
    try {
      setCandidate(await onLookup(item.packageName));
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : String(err));
    } finally {
      setLooking(false);
    }
  }

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
        {/* A new app created from an APK gets a name, a package id and a
            pinned signer, and nothing anyone would want to read. This is the
            only moment the package id is in hand and the shelf is still
            empty, so it is where the description comes from — offered, never
            taken automatically. */}
        {item.packageName && !candidate && (
          <ActionButton
            size="sm"
            variant="secondary"
            disabled={busy || looking}
            onClick={() => void lookUp()}
          >
            <Search size={13} /> {looking ? "Asking Play…" : "Look up on Play"}
          </ActionButton>
        )}
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

      {lookupError && (
        <p className={cn("text-xs", MUTED_CLS)}>{lookupError}</p>
      )}
      {candidate && (
        <PlayCandidate
          candidate={candidate}
          busy={busy}
          onUse={() =>
            onDecide(item.id, "create-new", {
              fillFrom: candidate.listing.packageId,
            })
          }
          onDismiss={() => setCandidate(null)}
        />
      )}
    </div>
  );
}
