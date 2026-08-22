import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bookmark, Share2, Star } from "lucide-react";
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
import { APPS, findApp } from "@/lib/catalog";

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
  const app = findApp(slug);
  if (!app) notFound();

  const related = APPS.filter(
    (a) => a.category === app.category && a.slug !== app.slug
  ).slice(0, 6);

  return (
    <Screen flush>
      {/* Banner. A real one comes out of banners/<slug>.jpg; until then the
          same deterministic gradient the icon uses, so the page is coherent. */}
      <div className="relative">
        <Thumb seed={app.seed + 4} className="h-40 w-full sm:h-56" />
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
          className="h-20 w-20 shrink-0 rounded-[var(--radius)] border border-[color:var(--border)] shadow-xl"
        />
        <div className="min-w-0 flex-1 pb-1">
          <h1 className="truncate text-lg font-semibold">{app.name}</h1>
          <p className={cn("truncate text-sm", MUTED)}>{app.developer}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 px-[var(--pad)]">
        <Button className="flex-1 justify-center">
          {app.installed ? "Open" : "Install"}
        </Button>
        <Button variant="secondary" aria-label="Save">
          <Bookmark size={15} />
        </Button>
        <Button variant="secondary" aria-label="Share">
          <Share2 size={15} />
        </Button>
      </div>

      {/* The three facts a store page is expected to answer above the fold. */}
      <div className="px-[var(--pad)]">
        <div className={cn(CARD, "grid grid-cols-3 divide-x divide-[color:var(--border)]")}>
          {[
            {
              value: app.rating.toFixed(1),
              label: `${app.ratingCount} reviews`,
              star: true,
            },
            { value: app.size, label: "Download" },
            { value: app.version, label: "Version" },
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

      <section className="px-[var(--pad)]">
        <SectionTitle title="Screenshots" />
        <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[0, 1, 2, 3].map((i) => (
            <Thumb
              key={i}
              seed={app.seed + i * 6}
              className="aspect-[9/16] w-[110px] shrink-0 rounded-[var(--radius-sm)] sm:w-[140px]"
            />
          ))}
        </div>
      </section>

      <section className="px-[var(--pad)]">
        <SectionTitle title="About" />
        <p className="text-sm leading-relaxed text-[color:var(--muted-2)]">
          {app.tagline}. This description is placeholder text standing in for
          what the importer will read out of the source listing, so the block
          can be judged at a realistic length before there is anything real to
          put in it.
        </p>
      </section>

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

export function generateStaticParams() {
  return APPS.map((a) => ({ slug: a.slug }));
}
