import Link from "next/link";
import { cn } from "@/lib/utils";
import { SectionTitle, Thumb } from "@/components/primitives";
import { AppRow } from "@/components/app-columns";
import type { StoreApp } from "@/lib/store";

/**
 * One app given room: its banner across a card, and the app's row under it.
 * Several scroll side by side, the next card peeking in. Only apps with a real
 * banner belong here — an icon blown up to 16:9 is a blur. The caller filters.
 */
export default function FeatureCards({
  title,
  href,
  apps,
}: {
  title: string;
  href?: string;
  apps: StoreApp[];
}) {
  if (apps.length === 0) return null;
  return (
    <section>
      <div className="px-[var(--pad)]">
        <SectionTitle title={title} href={href} />
      </div>
      <div className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-[var(--pad)] px-[var(--pad)]">
        {apps.map((app) => (
          <div
            key={app.slug}
            className={cn(
              "shrink-0 snap-start overflow-hidden rounded-[var(--radius-lg)] bg-[var(--card)]",
              apps.length > 1
                ? "w-[88%] sm:w-[calc(50%-0.375rem)] lg:w-[calc(33.333%-0.5rem)]"
                : "w-full sm:w-[calc(50%-0.375rem)]"
            )}
          >
            <Link href={`/app/${app.slug}`} className="block">
              <Thumb
                seed={app.seed + 4}
                src={app.banner}
                alt=""
                className="aspect-[16/9] w-full"
              />
            </Link>
            <div className="p-3.5">
              <AppRow app={app} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
