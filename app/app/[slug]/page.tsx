import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ExternalLink, Star } from "lucide-react";
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
import EditApp from "@/components/edit-app";
import MergeApp from "@/components/merge-app";
import ShareApp from "@/components/share-app";
import { storedText } from "@/lib/edit";
import { abiShortLabel } from "@/lib/apk-abi";
import { appFor, catalogFor } from "@/lib/user-state";
import type { StoreApp } from "@/lib/store";
import { withBasePath } from "@/lib/base-path";
import { requestOrigin } from "@/lib/origin";
import { currentUser } from "@/lib/current-user";
import { stateFor } from "@/lib/user-state";

export const dynamic = "force-dynamic";

const SOURCE_NAME: Record<string, string> = {
  play: "Google Play",
  github: "GitHub",
  fdroid: "F-Droid",
};

/** How much of a listing fits on a link preview card before it is cut off. */
const PREVIEW_CHARS = 200;

/**
 * One line about the app, for somewhere it has to stand alone.
 *
 * The tagline first — it was written to be exactly this, one line — where the
 * page below prefers the long text because it has the room. Neither is
 * guaranteed: an app imported from a dropped APK has whatever the filename
 * said and nothing else, and for those the developer and version at least say
 * what the thing is.
 */
function summarise(app: StoreApp): string {
  const text = (app.tagline || app.description || "").replace(/\s+/g, " ").trim();
  if (!text) return `${app.developer} · ${app.version}`;
  return text.length <= PREVIEW_CHARS
    ? text
    : `${text.slice(0, PREVIEW_CHARS - 1).trimEnd()}\u2026`;
}

/**
 * What a chat app draws when this URL is pasted into it.
 *
 * This is the whole reason to send the page rather than the file: Telegram and
 * the rest fetch the address, read these tags and render a card, so a shared
 * app arrives as its name, its icon and a line about it instead of a bare
 * link. The APK link installs on tap but previews as nothing, which is why
 * `components/share-app.tsx` offers both and leads with this one.
 *
 * The image has to be absolute, because the machine fetching it is not on this
 * site and has no page to resolve a relative path against. `metadataBase` is
 * what Next resolves the app-absolute media URLs against, and it comes from
 * the request because the store answers on more than one address.
 *
 * The 18+ gate holds here too, and falls out of `appFor` rather than being
 * restated: a crawler arrives with no session, so an Adults listing has no
 * metadata to give it — the same answer the page itself gives.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const app = await appFor((await currentUser())?.id ?? null, slug);
  if (!app) return {};

  const origin = await requestOrigin();
  const description = summarise(app);
  // The banner first: a preview card is drawn wide, and an icon stretched to
  // fill that shape looks worse than the artwork made for it. Both are
  // optional — an app with neither gets a card with no image, because the
  // fallback artwork is a CSS gradient with no URL to hand out.
  const image = app.banner ?? app.icon;

  return {
    title: app.name,
    description,
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    openGraph: {
      type: "website",
      siteName: "App Store",
      title: app.name,
      description,
      url: withBasePath(`/app/${app.slug}`),
      ...(image ? { images: [{ url: image, alt: app.name }] } : {}),
    },
    twitter: {
      // Only the banner is wide enough to be worth the big card; an icon in
      // that slot is cropped to a strip of itself.
      card: app.banner ? "summary_large_image" : "summary",
      title: app.name,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

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
  // The per-user controls are simply absent without a session rather than
  // present and inert: this store is browsable by anyone, and a bookmark that
  // silently keeps nothing is a worse answer than no bookmark. The same reading
  // decides whether the 18+ gate is open — see `appFor`.
  const viewer = await currentUser();
  const userId = viewer?.id ?? null;
  // A gated app is not found rather than refused: a page that says "you may
  // not see this" still says the app is here.
  const app = await appFor(userId, slug);
  if (!app) notFound();

  const visible = await catalogFor(userId);
  const related = visible
    .filter((a) => a.category === app.category && a.slug !== app.slug)
    .slice(0, 6);

  // The same app on the shelf twice — a second signer of one package id gets
  // its own slug, so the pair is only ever discoverable through the id they
  // share. Read off the gated catalog like everything else here: a picker that
  // offered a listing the person may not open would be a hole in the gate.
  const siblings = app.packageName
    ? visible
        .filter((a) => a.packageName === app.packageName && a.slug !== app.slug)
        .map((a) => ({
          slug: a.slug,
          name: a.name,
          version: a.version,
          versions: a.versions.length,
        }))
    : [];

  const latest = app.versions[0];
  const older = app.versions.slice(1);

  // A listing added from Play carries no binary. Sending the person upstream is
  // the only honest action for it — a dead "no download yet" button says the
  // file is coming, and for these it is not.
  const shelfOnly = !latest && app.source?.kind === "play" ? app.source : null;

  // A linked app has no file here either, but unlike a Play listing there is a
  // real download at the other end — the exact asset this store read the
  // version and the signer out of. So the button installs, it just does not
  // come from us.
  const linked = !latest && app.source?.assetUrl ? app.source : null;

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
          background={app.iconBackground}
          fit={app.iconFit}
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
        ) : linked ? (
          // Straight to the release rather than through /api/download: the
          // file is not here to serve, and GitHub's own CDN resumes better
          // than a proxy that would only add a hop.
          <a href={linked.assetUrl} className="flex-1">
            <Button className="w-full justify-center">
              <Download size={15} /> Install {app.version}
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
        <ShareApp
          slug={app.slug}
          name={app.name}
          hasFile={Boolean(latest)}
          externalUrl={linked?.assetUrl}
        />
      </div>

      {/* A release published as separate per-ABI builds. The button above
          already installs the right one for a phone — this row is for the
          case it cannot know about: a tablet, an emulator, someone keeping a
          copy for a device that is not the one they are browsing from. Named
          by ABI rather than by file, because the file names on this shelf are
          whatever the person who packaged them felt like typing. */}
      {latest && latest.files.length > 1 && (
        <div className="px-[var(--pad)] pt-3">
          <div className="flex flex-wrap gap-2">
            {latest.files.map((f) => (
              <a key={f.file} href={f.href}>
                <Button size="sm" variant="secondary">
                  <Download size={13} /> {f.abi} · {f.size}
                </Button>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Nothing to install — no file here and no link out — means nothing to
          mark as installed, and the card would offer no button at all. */}
      {userId !== null && (latest || linked) && (
        <InstalledControl
          slug={app.slug}
          latest={latest?.version ?? app.version}
          initialVersion={mine.installedVersion}
        />
      )}

      {/* Admins only, and closed until asked for — see components/edit-app.tsx.
          The token-holder route into Manage does not apply here: this is a
          public page, and a form on it would be an invitation to everyone. */}
      {viewer?.role === "admin" && (
        <EditApp
          app={{
            slug: app.slug,
            // The file, not the row: `app` carries the catalog's fallbacks in
            // the fields nobody has filled, and a form seeded with those saves
            // them. They go along as placeholders instead.
            stored: await storedText(app.slug),
            fallback: {
              name: app.name,
              developer: app.developer,
              category: app.category,
            },
            icon: app.icon,
            iconBackground: app.iconBackground,
            iconFit: app.iconFit,
            seed: app.seed,
            banner: app.banner,
            screenshots: app.screenshots,
          }}
        />
      )}

      {/* Only where there is a duplicate to fold in — with no sibling this
          renders nothing at all. See components/merge-app.tsx. */}
      {viewer?.role === "admin" && (
        <MergeApp app={{ slug: app.slug, name: app.name }} siblings={siblings} />
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
        {/* Where the words, the pictures and — for GitHub and F-Droid — the
            file itself came from. An archive that cannot say where a binary
            came from is asking to be trusted for no reason. */}
        {app.source && (
          <p className={cn("mt-1 text-[11px]", MUTED)}>
            From{" "}
            <a
              href={app.source.url}
              target="_blank"
              rel="noreferrer noopener"
              className="underline"
            >
              {SOURCE_NAME[app.source.kind]}
            </a>
            {app.source.repo ? ` · ${app.source.repo}` : ""}
          </p>
        )}
      </section>

      {/* The point of an archive: the version you had still exists. */}
      {older.length > 0 && (
        <section className="px-[var(--pad)]">
          <SectionTitle title="Older versions" />
          <div className={cn(CARD, "overflow-hidden")}>
            {older.map((v, i) => (
              <div
                key={v.version}
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
                    {/* One size is a fact about one file. Where the version
                        holds several builds they are not the same size, and
                        printing the default one's would describe a download
                        the person may not be about to start. */}
                    {v.files.length > 1 ? `${v.files.length} builds` : v.size} ·{" "}
                    {new Date(v.added).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      timeZone: "Europe/Stockholm",
                    })}
                  </span>
                </span>
                {/* One button per build. A version with a single file keeps
                    the plain "Get" it has always had — naming its ABI would
                    ask a question nobody has to answer. */}
                <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
                  {v.files.map((f) => (
                    <a key={f.file} href={f.href}>
                      <Button size="sm" variant="secondary">
                        <Download size={13} />{" "}
                        {v.files.length > 1 ? abiShortLabel(f.abis) : "Get"}
                      </Button>
                    </a>
                  ))}
                </span>
              </div>
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
