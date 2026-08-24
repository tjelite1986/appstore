import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ExternalLink, Share2, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Screen } from "@/components/screen";
import CoverShelf from "@/components/cover-shelf";
import {
  Button,
  CARD,
  MUTED,
  SectionTitle,
  Thumb,
} from "@/components/primitives";
import SaveButton from "@/components/save-button";
import InstalledControl from "@/components/installed-control";
import { findApp, getApps } from "@/lib/store";
import { currentUserId } from "@/lib/current-user";
import { stateFor } from "@/lib/user-state";

export const dynamic = "force-dynamic";

/**
 * App detail. Not one of the sketch's screens — it only describes what tapping
 * a cover opens (cover, title, one action, room to describe the thing) — so
 * this follows that description using the blocks Home already establishes.
 */
export default async function AppDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const app = await findApp(slug);
  if (!app) notFound();

  const related = (await getApps())
    .filter((a) => a.category === app.category && a.slug !== app.slug)
    .slice(0, 6);

  const latest = app.versions[0];
  const older = app.versions.slice(1);

  // A listing added from Play carries no binary. Sending the person upstream is
  // the only honest action for it — a dead "no download yet" button says the
  // file is coming, and for these it is not.
  const shelfOnly = !latest && app.source?.kind === "play" ? app.source : null;

  // The per-user controls are simply absent without a session rather than
  // present and inert: this store is browsable by anyone, and a bookmark that
  // silently keeps nothing is a worse answer than no bookmark.
  const userId = await currentUserId();
  const mine = stateFor(userId, app.slug);

  return (
    <Screen flush>
      {/* banners/<slug>.jpg when there is one; otherwise the same deterministic
          gradient the icon falls back to, so the page stays coherent. */}
      <div className="relative">
        <Thumb
          seed={app.seed + 4}
          src={app.banner}
          className="h-40 w-full sm:h-56"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#100913] via-transparent to-transparent" />
        <Link
          href="/"
          aria-label="Back"
          className="absolute left-3 top-3 rounded-full bg-black/45 p-2 backdrop-blur"
        >
          <ArrowLeft size={16} />
        </Link>
      </div>

      <div className="-mt-10 flex items-end gap-3 px-[var(--pad)]">
        <Thumb
          seed={app.seed}
          src={app.icon}
          alt={app.name}
          className="h-20 w-20 shrink-0 rounded-[var(--radius)] border border-[color:var(--border)] shadow-xl"
        />
        <div className="min-w-0 flex-1 pb-1">
          <h1 className="truncate text-lg font-semibold">{app.name}</h1>
          <p className={cn("truncate text-sm", MUTED)}>{app.developer}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 px-[var(--pad)]">
        {latest ? (
          // A plain link, so the browser's own download manager handles it and
          // an interrupted transfer can resume — the route serves ranges.
          <a href={latest.href} className="flex-1">
            <Button className="w-full justify-center">
              <Download size={15} /> Install {latest.version}
            </Button>
          </a>
        ) : shelfOnly ? (
          <a
            href={shelfOnly.url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex-1"
          >
            <Button variant="secondary" className="w-full justify-center">
              <ExternalLink size={15} /> Get it on Google Play
            </Button>
          </a>
        ) : (
          <Button variant="ghost" className="flex-1 justify-center">
            No download yet
          </Button>
        )}
        {userId !== null && (
          <SaveButton slug={app.slug} initialSaved={mine.saved} />
        )}
        <Button variant="secondary" aria-label="Share">
          <Share2 size={15} />
        </Button>
      </div>

      {/* Nothing to install from here means nothing to mark as installed — the
          card would offer no button at all. */}
      {userId !== null && latest && (
        <InstalledControl
          slug={app.slug}
          latest={latest?.version ?? null}
          initialVersion={mine.installedVersion}
        />
      )}

      {/* The three facts a store page is expected to answer above the fold. */}
      <div className="px-[var(--pad)]">
        <div className={cn(CARD, "grid grid-cols-3 divide-x divide-[color:var(--border)]")}>
          {[
            {
              value: app.ratingCount > 0 ? app.rating.toFixed(1) : "—",
              label:
                app.ratingCount > 0 ? `${app.ratingCount} reviews` : "No reviews",
              star: app.ratingCount > 0,
            },
            { value: app.size, label: "Download" },
            shelfOnly?.playVersion
              ? // The library holds no file, so "Version" would be a dash. What
                // upstream showed is worth saying, as long as it says whose.
                { value: shelfOnly.playVersion, label: "On Play" }
              : { value: app.version, label: "Version" },
          ].map((cell) => (
            <div key={cell.label} className="px-2 py-3 text-center">
              <p className="flex items-center justify-center gap-1 text-sm font-semibold">
                {cell.value}
                {cell.star && <Star size={12} className="fill-current" />}
              </p>
              <p className={cn("mt-0.5 truncate text-[11px]", MUTED)}>
                {cell.label}
              </p>
            </div>
          ))}
        </div>
      </div>

      {app.screenshots.length > 0 && (
        <section className="px-[var(--pad)]">
          <SectionTitle title="Screenshots" />
          <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {app.screenshots.map((src, i) => (
              <Thumb
                key={src}
                seed={app.seed + i * 6}
                src={src}
                alt={`${app.name} screenshot ${i + 1}`}
                className="aspect-[9/16] w-[110px] shrink-0 rounded-[var(--radius-sm)] sm:w-[140px]"
              />
            ))}
          </div>
        </section>
      )}

      <section className="px-[var(--pad)]">
        <SectionTitle title="About" />
        <p className="whitespace-pre-line text-sm leading-relaxed text-[color:var(--muted-2)]">
          {app.description ??
            app.tagline ??
            "No description has been written for this app yet."}
        </p>
        {app.packageName && (
          <p className={cn("mt-3 break-all font-mono text-[11px]", MUTED)}>
            {app.packageName}
          </p>
        )}
      </section>

      {/* The point of an archive: the version you had still exists. */}
      {older.length > 0 && (
        <section className="px-[var(--pad)]">
          <SectionTitle title="Older versions" />
          <div className={cn(CARD, "overflow-hidden")}>
            {older.map((v, i) => (
              <a
                key={v.version}
                href={v.href}
                className={cn(
                  "flex items-center gap-3 px-3.5 py-3",
                  i > 0 && "border-t border-[color:var(--border)]"
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-sm">
                    {v.version}
                  </span>
                  <span className={cn("block truncate text-xs", MUTED)}>
                    {v.size} ·{" "}
                    {new Date(v.added).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      timeZone: "Europe/Stockholm",
                    })}
                  </span>
                </span>
                <Button size="sm" variant="secondary">
                  <Download size={13} /> Get
                </Button>
              </a>
            ))}
          </div>
        </section>
      )}

      {related.length > 0 && (
        <CoverShelf
          title={`More in ${app.category}`}
          apps={related}
          columns={6}
          sub="developer"
        />
      )}
    </Screen>
  );
}
