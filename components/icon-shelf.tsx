import Link from "next/link";
import { cn } from "@/lib/utils";
import { MUTED, SectionTitle, Thumb } from "@/components/primitives";
import type { StoreApp } from "@/lib/store";

/**
 * One horizontal row of icons with the name and rating under each — a
 * category's shelf on Apps and Games. It shows a slice and links to the whole
 * category, so a screen of a dozen shelves stays a screen and not a wall.
 */
export default function IconShelf({
  title,
  href,
  apps,
  limit = 15,
}: {
  title: string;
  /** Where "See all" goes; left off when the row already is all of it. */
  href?: string;
  apps: StoreApp[];
  limit?: number;
}) {
  if (apps.length === 0) return null;
  const shown = apps.slice(0, limit);
  return (
    <section>
      <div className="px-[var(--pad)]">
        <SectionTitle
          title={title}
          action={href ? `See all ${apps.length}` : undefined}
          href={href}
        />
      </div>
      <div className="flex gap-3 overflow-x-auto px-[var(--pad)] pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-4">
        {shown.map((app) => (
          <Link
            key={app.slug}
            href={`/app/${app.slug}`}
            className="group w-[76px] shrink-0 sm:w-[96px]"
          >
            <Thumb
              seed={app.seed}
              src={app.icon}
              background={app.iconBackground}
              fit={app.iconFit}
              alt={app.name}
              className="aspect-square w-full rounded-[var(--radius-lg)] shadow-lg ring-1 ring-white/5 transition group-hover:ring-[color:var(--accent)]"
            />
            <p className="mt-1.5 line-clamp-2 text-xs font-medium leading-tight">
              {app.name}
            </p>
            <p className={cn("mt-0.5 truncate text-[11px]", MUTED)}>
              {app.rating > 0 ? `${app.rating.toFixed(1)} ★` : app.size}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
