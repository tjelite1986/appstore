import Link from "next/link";
import { cn } from "@/lib/utils";
import { MUTED, SectionTitle, Thumb } from "@/components/primitives";
import type { StoreApp } from "@/lib/store";

/**
 * The sketch's `carousel`: a scrolling row of landscape cards with the text
 * under each, 12px between cards, and the row running off the right edge so it
 * reads as scrollable.
 *
 * Width diverges from the sketch: it sets 80px, which at 16:9 is an 80x45 card
 * — smaller than the text under it. 80px is kept as the phone width and the
 * card grows on wider screens, all from one custom property.
 */
export default function Carousel({
  title,
  action,
  apps,
}: {
  title: string;
  action?: string;
  apps: StoreApp[];
}) {
  return (
    <section>
      <div className="mx-3">
        <div className="px-[calc(var(--pad)-0.75rem)]">
          <SectionTitle title={title} action={action} />
        </div>
      </div>
      <div
        className="flex gap-3 overflow-x-auto px-[var(--pad)] pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={
          {
            "--card-w": "80px",
          } as React.CSSProperties
        }
      >
        {apps.map((app) => (
          <Link
            key={app.slug}
            href={`/app/${app.slug}`}
            className="flex w-[var(--card-w)] shrink-0 flex-col gap-1.5 sm:w-[140px] lg:w-[180px]"
          >
            <Thumb
              seed={app.seed + 4}
              src={app.banner ?? app.icon}
              // The icon standing in for a missing banner brings its plate
              // with it; a real banner is a picture and keeps the gradient.
              background={app.banner ? undefined : app.iconBackground}
              fit={app.banner ? undefined : app.iconFit}
              alt={app.name}
              className="aspect-video w-full rounded-[var(--radius-sm)]"
            />
            <div className="flex flex-col">
              <p className="truncate text-xs font-medium">{app.name}</p>
              <p className={cn("truncate text-[11px]", MUTED)}>
                {app.developer}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
