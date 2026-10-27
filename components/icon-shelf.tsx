import Link from "next/link";
import { cn } from "@/lib/utils";
import { GetButton, ICON, MUTED, SectionTitle, Thumb } from "@/components/primitives";
import type { StoreApp } from "@/lib/store";

/**
 * One horizontal row of large icons, each with its name, its developer and a
 * round get button under it. It shows a slice and links to the whole
 * category, so a screen of a dozen shelves stays a screen and not a wall.
 */
export default function IconShelf({
  title,
  href,
  apps,
  limit = 15,
}: {
  title: string;
  /** Where the chevron goes; left off when the row already is all of it. */
  href?: string;
  apps: StoreApp[];
  limit?: number;
}) {
  if (apps.length === 0) return null;
  const shown = apps.slice(0, limit);
  return (
    <section>
      <div className="px-[var(--pad)]">
        <SectionTitle title={title} href={href} />
      </div>
      <div className="no-scrollbar flex gap-3 overflow-x-auto scroll-px-[var(--pad)] px-[var(--pad)] pb-1 sm:gap-4">
        {shown.map((app) => (
          <div key={app.slug} className="flex w-[104px] shrink-0 flex-col sm:w-[120px]">
            <Link href={`/app/${app.slug}`} className="group flex flex-1 flex-col">
              <Thumb
                seed={app.seed}
                src={app.icon}
                background={app.iconBackground}
                fit={app.iconFit}
                alt={app.name}
                className={cn(
                  "aspect-square w-full ring-1 ring-white/[0.06] transition group-hover:brightness-110",
                  ICON
                )}
              />
              <p className="mt-2 line-clamp-2 text-center text-[13px] font-semibold leading-tight">
                {app.name}
              </p>
              <p className={cn("mt-1 truncate text-center text-[11px]", MUTED)}>
                {app.developer}
              </p>
              <p className={cn("truncate text-center text-[11px]", MUTED)}>
                {app.rating > 0 ? `★ ${app.rating.toFixed(1)}` : app.size}
              </p>
            </Link>
            <GetButton app={app} wide className="mt-2" />
          </div>
        ))}
      </div>
    </section>
  );
}
