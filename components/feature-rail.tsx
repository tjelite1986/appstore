import Link from "next/link";
import { cn } from "@/lib/utils";
import { SectionTitle, Thumb, metaLine } from "@/components/primitives";
import type { StoreApp } from "@/lib/store";
import { categoryLabel } from "@/lib/categories";

/**
 * Big banner cards that snap as they scroll, with the app's icon and name
 * laid over the foot of the artwork. One card and a sliver of the next on a
 * phone, so the row reads as scrollable; two or three on a wider screen.
 *
 * Only apps with a real banner belong here — an icon blown up to 16:9 is not
 * a feature, it is a blur. The caller filters.
 */
export default function FeatureRail({
  title,
  apps,
}: {
  title?: string;
  apps: StoreApp[];
}) {
  if (apps.length === 0) return null;
  return (
    <section>
      {title ? (
        <div className="px-[var(--pad)]">
          <SectionTitle title={title} />
        </div>
      ) : null}
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-[var(--pad)] px-[var(--pad)] pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {apps.map((app) => (
          <Link
            key={app.slug}
            href={`/app/${app.slug}`}
            className="group relative w-[85%] shrink-0 snap-start overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)] sm:w-[calc(50%-0.375rem)] lg:w-[calc(33.333%-0.5rem)]"
          >
            <Thumb
              seed={app.seed + 4}
              src={app.banner}
              alt={app.name}
              className="aspect-video w-full transition duration-300 group-hover:scale-[1.03]"
            />
            <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-3 pt-10">
              <Thumb
                seed={app.seed}
                src={app.icon}
                background={app.iconBackground}
                fit={app.iconFit}
                alt=""
                className="h-11 w-11 shrink-0 rounded-[var(--radius-sm)] shadow-lg ring-1 ring-white/15"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">
                  {app.name}
                </span>
                <span className={cn("block truncate text-[11px] text-white/70")}>
                  {categoryLabel(app.category)} · {metaLine(app.rating, app.size)}
                </span>
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
