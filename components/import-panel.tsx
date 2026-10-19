"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FolderOpen,
  Inbox,
  RefreshCw,
  Search,
  Send,
  Upload,
} from "lucide-react";
import { cn, relativeTime } from "@/lib/utils";
import {
  MUTED,
  NOTE,
  Pill,
  buttonClass,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/primitives";
import type { ImportSummary, ReviewItem } from "@/lib/import";
import type { PlayFill, PlayListing } from "@/lib/sources/play";
import type { ApkmbListing } from "@/lib/sources/apkmb";
import type { TelegramCandidate, TelegramRun } from "@/lib/telegram";
import { adminCall } from "@/lib/admin-call";
import { withBasePath } from "@/lib/base-path";
import { ADMIN_TOKEN_KEY } from "@/lib/admin-token";

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
 * Getting in is normally not this panel's problem: an admin who has signed in
 * is let through by their session cookie. So the panel asks for the queue first and
 * only falls back to the token form when the answer is 401 — someone browsing
 * the store logged out, or a second browser.
 *
 * That fallback token lives in localStorage rather than a cookie: it is the
 * same shared secret the host timers use (see `lib/admin.ts`), and a value the
 * browser never attaches to a request on its own cannot be used by a page on
 * another origin that talks this store into a POST.
 */

/**
 * A block inside the Import panel: the feed, the folder, the queue. The page
 * draws the panel around them, so these are bordered sections, not cards.
 */
const BLOCK_CLS =
  "flex flex-col gap-2.5 rounded-[var(--radius)] border border-[color:var(--border)] p-3.5";
/** The head of a block: icon, title, status at the right. */
const BLOCK_HEAD_CLS = "flex items-center gap-2";
const MUTED_CLS = MUTED;
/** A nested card: a review item, a candidate. Tinted so it sits inside a block. */
const CARD_CLS =
  "bg-[var(--card-2)] rounded-[var(--radius)] border border-[color:var(--border)]";

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

/** The same thing for a page the feed could not download. Inlined icon, same reason. */
type LinkListing = {
  listing: ApkmbListing;
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
  // in" from "needs a token" until something has answered,
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
    (path: string, init?: RequestInit) =>
      adminCall(path, init, token, {
        // A refused signer is an offer to attach anyway, not a failure.
        accept: [409],
        hint: token
          ? "That token was not accepted"
          : "Sign in as an admin, or use a token",
        onRefused: (status) => {
          // A 401 means the token, if any, is wrong: forget it. A 403 is a
          // session the store knows but will not let in — not an admin, or a
          // cross-origin write — and no retry as this account changes that.
          // Either way the panel locks and says why, rather than waiting for
          // a load that is never going to succeed.
          if (status === 401) {
            setToken("");
            try {
              window.localStorage.removeItem(ADMIN_TOKEN_KEY);
            } catch {
              /* ignore */
            }
          }
          setLocked(true);
        },
      }),
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

  /**
   * Ask apkmb what one of its product pages says, without writing anything.
   *
   * Deliberately on click and not on render: this is an outbound request to
   * another site, and a panel that made one per candidate every time Manage
   * loaded would be hammering apkmb to draw a card nobody asked for.
   */
  const lookupLink = useCallback(
    async (url: string): Promise<LinkListing> => {
      const data = await call(`/api/sources/apkmb?url=${encodeURIComponent(url)}`);
      if (!data.listing) throw new Error(data.error ?? "apkmb returned nothing");
      return {
        listing: data.listing as ApkmbListing,
        iconDataUrl: typeof data.iconDataUrl === "string" ? data.iconDataUrl : null,
      };
    },
    [call]
  );

  /** Stop the feed offering a page — the same call for a fill and for a refusal. */
  const answerCandidate = useCallback(
    async (url: string) => {
      await call("/api/telegram/candidate", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
    },
    [call]
  );

  async function fillFromLink(url: string, slug: string) {
    setBusy(url);
    setError(null);
    setNotice(null);
    try {
      const result = await call("/api/sources/apkmb/fill", {
        method: "POST",
        body: JSON.stringify({ slug, url }),
      });
      // Cleared only once the fill has answered: a page that failed to write
      // is still a page worth offering.
      await answerCandidate(url);
      setNotice(describeLinkFill(result));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function dismissLink(url: string) {
    setBusy(url);
    setError(null);
    try {
      await answerCandidate(url);
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
    // The first load has not answered — or answered with something other
    // than a verdict on access (the app down, no admin credential configured),
    // which is worth reading rather than waiting behind.
    return error ? (
      <p className="text-xs text-[color:var(--danger)]">{error}</p>
    ) : (
      <p className={cn("text-sm", MUTED_CLS)}>Checking your access…</p>
    );
  }

  if (locked) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Sign in to import</p>
        <p className={NOTE}>
          <a href={withBasePath("/login?next=/manage")} className="underline">
            Signing in
          </a>{" "}
          as an admin unlocks this panel. Failing that, the shared{" "}
          <code>STORE_ADMIN_TOKEN</code>
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
        {error && <p className="text-xs text-[color:var(--danger)]">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {telegram && (
        <TelegramCard
          status={telegram}
          busy={busy === "telegram"}
          busyUrl={busy}
          apps={apps}
          onSync={syncTelegram}
          onLookup={lookupLink}
          onFill={fillFromLink}
          onDismiss={dismissLink}
        />
      )}

      <div className={BLOCK_CLS}>
        <div className={BLOCK_HEAD_CLS}>
          <FolderOpen size={15} className="shrink-0 text-[color:var(--muted-2)]" />
          <p className="min-w-0 flex-1 truncate text-sm font-medium">Import folder</p>
          <Pill tone={waiting > 0 ? "accent" : "neutral"}>
            {waiting === 0
              ? "empty"
              : `${waiting} ${waiting === 1 ? "file" : "files"} waiting`}
          </Pill>
        </div>
        <p className={NOTE}>
          Drop <code>.apk</code> or <code>.xapk</code> files in this folder on
          the host. The timer scans it on its own; the button does it now.
        </p>
        <p className="break-all rounded-[var(--radius)] bg-black/25 px-2.5 py-1.5 font-mono text-xs text-[color:var(--muted-2)]">
          {storePath}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton size="sm" variant="secondary" onClick={scan} disabled={busy === "scan"}>
            <Upload size={13} /> {busy === "scan" ? "Scanning…" : "Scan now"}
          </ActionButton>
          <ActionButton size="sm" variant="secondary" onClick={() => void refresh()}>
            <RefreshCw size={13} /> Refresh
          </ActionButton>
        </div>
        {/* A file that is only a minute old is skipped on purpose, so the
            summary has to say so — otherwise a fresh drop looks ignored. */}
        {summary && (
          <ul className="flex flex-col gap-0.5 text-xs text-[color:var(--muted-2)]">
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

      {error && <p className="text-xs text-[color:var(--danger)]">{error}</p>}
      {notice && <p className={cn("text-xs", MUTED_CLS)}>{notice}</p>}

      <div className={BLOCK_CLS}>
        <div className={BLOCK_HEAD_CLS}>
          <Inbox size={15} className="shrink-0 text-[color:var(--muted-2)]" />
          <p className="min-w-0 flex-1 truncate text-sm font-medium">Review queue</p>
          {items && items.length > 0 ? (
            <Pill tone="warn">
              {items.length} {items.length === 1 ? "decision" : "decisions"}
            </Pill>
          ) : (
            <Pill>empty</Pill>
          )}
        </div>
        <p className={NOTE}>
          Files the scan could not place on its own: no app looked like them,
          more than one did, or the signer did not match. Each one waits here
          until you say where it goes.
        </p>
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
        <p className={cn("text-xs", MUTED_CLS)}>Nothing waiting for a decision.</p>
      )}
      </div>
    </div>
  );
}

type TelegramStatus = {
  configured: boolean;
  running: boolean;
  channels: { name: string; cursor: number; lastSyncedAt?: string; lastStatus?: string }[];
  run: TelegramRun;
  /** Links the run rejected that apkmb has a page for. Older states have none. */
  candidates?: TelegramCandidate[];
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
  busyUrl,
  apps,
  onSync,
  onLookup,
  onFill,
  onDismiss,
}: {
  status: TelegramStatus;
  busy: boolean;
  /** Which row is mid-request, keyed by the candidate's URL. */
  busyUrl: string | null;
  apps: { slug: string; name: string }[];
  onSync: () => void;
  onLookup: (url: string) => Promise<LinkListing>;
  onFill: (url: string, slug: string) => void;
  onDismiss: (url: string) => void;
}) {
  const when = status.run.finishedAt ?? status.run.startedAt;
  return (
    <div className={BLOCK_CLS}>
      <div className={BLOCK_HEAD_CLS}>
        <Send size={15} className="shrink-0 text-[color:var(--muted-2)]" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">Telegram feed</p>
        {!status.configured ? (
          <Pill>not configured</Pill>
        ) : status.running ? (
          <Pill tone="accent">syncing</Pill>
        ) : status.run.error ? (
          <Pill tone="danger">failed</Pill>
        ) : when ? (
          <Pill tone="ok">synced {relativeTime(when)}</Pill>
        ) : (
          <Pill>never synced</Pill>
        )}
      </div>
      {!status.configured ? (
        <p className={NOTE}>
          Not configured — <code>TELEGRAM_API_ID</code>,{" "}
          <code>TELEGRAM_API_HASH</code> and <code>TELEGRAM_SESSION</code> are
          unset.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {status.channels.map((c) => (
            <li key={c.name} className="flex items-baseline gap-2 text-xs">
              <span className="font-medium">@{c.name}</span>
              <span className={MUTED_CLS}>
                {c.cursor ? `read up to post ${c.cursor}` : "never synced"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          variant="secondary"
          disabled={!status.configured || busy || status.running}
          onClick={onSync}
        >
          <RefreshCw size={13} className={status.running ? "animate-spin" : undefined} />{" "}
          {status.running ? "Syncing…" : busy ? "Starting…" : "Sync now"}
        </ActionButton>
        {when && !status.running && (
          <span className={cn("text-xs", MUTED_CLS)}>
            Last run {new Date(when).toLocaleString("sv-SE")} ·{" "}
            {status.run.downloaded} {status.run.downloaded === 1 ? "file" : "files"}
          </span>
        )}
      </div>
      {status.run.error && !status.running && (
        <p className="text-xs text-[color:var(--danger)]">
          Failed: {status.run.error}
        </p>
      )}
      {status.run.log.length > 0 && (
        <ul className="flex flex-col gap-0.5 rounded-[var(--radius)] bg-black/25 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[color:var(--muted-2)]">
          {status.run.log.slice(-6).map((line, i) => (
            <li key={i} className="break-all">
              {line.replace(/^\S+ /, "")}
            </li>
          ))}
        </ul>
      )}
      {/* Pages the feed could not download but apkmb can describe. They sit
          inside this card rather than beside it because they are the same
          run's leftovers, and a card of their own would read as a warning. */}
      {(status.candidates?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-2 border-t border-[color:var(--border)] pt-2.5">
          <p className={NOTE}>
            {status.candidates!.length === 1
              ? "One link was not an APK, but apkmb has a page for it"
              : `${status.candidates!.length} links were not APKs, but apkmb has pages for them`}
          </p>
          {status.candidates!.map((c) => (
            <LinkCandidateRow
              key={c.url}
              candidate={c}
              apps={apps}
              busy={busyUrl === c.url}
              onLookup={onLookup}
              onFill={onFill}
              onDismiss={onDismiss}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** "3 min ago", "2 h ago", "yesterday" — for a status pill, not a log. */
const REASONS: Record<string, string> = {
  no_match: "No app in the catalog looks like this",
  ambiguous: "More than one app could be the target",
  duplicate: "That version exists already, with different content",
  signer_mismatch: "Signed with a different key than the one pinned",
  unverifiable: "No readable signature to check against the pinned key",
  // Recomputed at read time: nothing fitted when it landed, something does
  // now — usually because the app was added to the catalog since.
  now_matches: "Matches an app that has been added since",
};

/** "Created Shazam — wrote 5 fields and 8 screenshots from Play." */
function describeFill(result: { appName?: string; filled: PlayFill }): string {
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
        "flex flex-col gap-2 rounded-[var(--radius)] border border-[color:var(--border)] bg-black/20 p-3"
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

/** "Filled Xnxx — wrote 3 fields and 5 screenshots from apkmb. It kept name, category." */
function describeLinkFill(result: {
  name?: string;
  written?: string[];
  kept?: string[];
  images?: { icon?: boolean; screenshots?: number };
}): string {
  const parts: string[] = [];
  if (result.written?.length) parts.push(`${result.written.length} fields`);
  if (result.images?.icon) parts.push("an icon");
  if (result.images?.screenshots) parts.push(`${result.images.screenshots} screenshots`);
  const wrote = parts.length ? `wrote ${parts.join(", ")}` : "found nothing to add";
  const kept = result.kept?.length ? ` It kept ${result.kept.join(", ")}.` : "";
  return `Filled ${result.name ?? "the app"} — ${wrote} from apkmb.${kept}`;
}

/**
 * One rejected link, offered as a description for an app already in the store.
 *
 * Two states, and the first one is deliberately just an address: looking the
 * page up is a visit to apkmb, so it waits for a click — the same shape the
 * review queue's Play lookup has, for the same reason.
 *
 * It can only ever fill an app that exists. A page in a channel is not
 * evidence enough to create a listing: apkmb files adult apps under
 * Entertainment, so a listing conjured from one would land outside the 18+
 * gate. Filling an app whose shelf somebody already chose cannot do that.
 */
function LinkCandidateRow({
  candidate,
  apps,
  busy,
  onLookup,
  onFill,
  onDismiss,
}: {
  candidate: TelegramCandidate;
  apps: { slug: string; name: string }[];
  busy: boolean;
  onLookup: (url: string) => Promise<LinkListing>;
  onFill: (url: string, slug: string) => void;
  onDismiss: (url: string) => void;
}) {
  const [found, setFound] = useState<LinkListing | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [target, setTarget] = useState("");

  async function lookUp() {
    setLooking(true);
    setLookupError(null);
    try {
      const result = await onLookup(candidate.url);
      setFound(result);
      // Preselected only when it is a row somebody can actually see. The list
      // this panel holds is the gated one, and a `<select>` whose value has no
      // option renders blank while still submitting — which would fill a
      // listing the person was never shown. This card approves what it draws.
      const matched = result.listing.existingSlug ?? "";
      setTarget(apps.some((a) => a.slug === matched) ? matched : "");
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : String(err));
    } finally {
      setLooking(false);
    }
  }

  const listing = found?.listing;
  const matchedIsListed =
    !!listing?.existingSlug && apps.some((a) => a.slug === listing.existingSlug);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-[var(--radius)] border border-[color:var(--border)] bg-black/20 p-3"
      )}
    >
      <div className="flex items-start gap-3">
        {listing && found?.iconDataUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={found.iconDataUrl}
            alt=""
            className="h-11 w-11 shrink-0 rounded-[12px] object-cover"
          />
        )}
        <div className="min-w-0">
          <p className="break-all text-sm">{listing?.name ?? candidate.url}</p>
          <p className={cn("truncate text-xs", MUTED_CLS)}>
            {[
              listing?.developer,
              listing?.category,
              `@${candidate.channel}`,
              `post ${candidate.messageId}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {listing?.tagline && (
            <p className={cn("mt-1 line-clamp-2 text-xs", MUTED_CLS)}>
              {listing.tagline}
            </p>
          )}
          <p className={cn("mt-1 break-all text-xs", MUTED_CLS)}>
            {listing
              ? [
                  listing.description ? "a description" : null,
                  listing.iconUrl ? "an icon" : null,
                  listing.screenshotUrls.length
                    ? `${listing.screenshotUrls.length} screenshots`
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ") || "nothing but a name"
              : candidate.note}
          </p>
        </div>
      </div>

      {listing && (
        <>

          {/* The shelf apkmb names is apkmb's, and it files adult apps under
              Entertainment. A fill writes gaps only, so an app that already
              has a category keeps it — but one that has none would take this. */}
          {listing.category && (
            <p className={cn("text-xs", MUTED_CLS)}>
              apkmb shelves this under {listing.category}. A fill only writes
              that where the app has no category of its own.
            </p>
          )}

          <select
            className={INPUT_CLS}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={busy}
          >
            <option value="">Describes…</option>
            {apps.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.name}
              </option>
            ))}
          </select>
          <p className={cn("text-xs", MUTED_CLS)}>
            {!listing.existingSlug
              ? "Nothing in the catalog matched. Pick the app these words describe."
              : matchedIsListed
                ? "Matched an app in the catalog — check it is the same build."
                : // The list this panel was given is the gated one, so an
                  // Adults app is matched and unpickable at once — which is
                  // the common case here, Play having no listing for those.
                  "Matched an app on the Adults shelf, which this list does not show. Open the 18+ gate in Settings to fill it."}
          </p>
        </>
      )}

      {lookupError && <p className={cn("text-xs", MUTED_CLS)}>{lookupError}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {!listing && (
          <ActionButton
            size="sm"
            variant="secondary"
            disabled={busy || looking}
            onClick={() => void lookUp()}
          >
            <Search size={13} /> {looking ? "Asking apkmb…" : "Look up"}
          </ActionButton>
        )}
        {listing && (
          <ActionButton
            size="sm"
            disabled={busy || !target}
            onClick={() => onFill(candidate.url, target)}
          >
            {busy ? "Filling…" : "Fill this app"}
          </ActionButton>
        )}
        <ActionButton
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => onDismiss(candidate.url)}
        >
          {listing ? "Not this app" : "Not an app page"}
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
  // The scan matched against the whole catalog; this card draws the gated
  // list (Manage hides the 18+ shelf until the gate is opened). A suggestion
  // the person cannot see is not offered, and the preselection is made from
  // what is offered — a `<select>` whose value has no option renders blank
  // while still submitting, and would attach the file to an app the person
  // was never shown. This card approves what it draws.
  const offered = (slug: string | null | undefined) =>
    !!slug && apps.some((a) => a.slug === slug);
  const suggestions = item.suggestions.filter((s) => offered(s.slug));
  const [target, setTarget] = useState(
    offered(item.matchedSlug) ? item.matchedSlug! : (suggestions[0]?.slug ?? "")
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
    <div className={cn(CARD_CLS, "flex flex-col gap-2.5 p-3.5")}>
      <div className="flex flex-col gap-1">
        <p className="break-all text-sm font-medium">{item.originalName}</p>
        <p className={cn("break-all text-xs", MUTED_CLS)}>
          {[
            item.parsedVersion && `v${item.parsedVersion}`,
            item.packageName,
            `${mb} MB`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="text-xs text-[color:var(--warn)]">
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
        {suggestions.map((s) => (
          <option key={`s-${s.slug}`} value={s.slug}>
            {s.name} — {s.why}
          </option>
        ))}
        {apps
          .filter((a) => !suggestions.some((s) => s.slug === a.slug))
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
        {(item.reason === "signer_mismatch" ||
          item.reason === "unverifiable" ||
          item.reason === "duplicate") && (
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
