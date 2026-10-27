import Link from "next/link";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { GetButton, ICON, MUTED, SectionTitle, Thumb } from "@/components/primitives";
import type { StoreApp } from "@/lib/store";

/**
 * A shelf of rows rather than tiles: three apps stacked per column, columns
 * side by side and scrolling, the next column showing at the right edge so
 * the shelf reads as more than it shows. Each row is icon, name, developer,
 * rating and a round get button.
 */
export default function AppColumns({
  title,
  href,
  apps,
  rows = 3,
  limit = 12,
}: {
  title: string;
  href?: string;
  apps: StoreApp[];
  rows?: number;
  limit?: number;
}) {
  if (apps.length === 0) return null;
  const shown = apps.slice(0, limit);
  const columns: StoreApp[][] = [];
  for (let i = 0; i < shown.length; i += rows) columns.push(shown.slice(i, i + rows));

  return (
    <section>
      <div className="px-[var(--pad)]">
        <SectionTitle title={title} href={href} />
      </div>
      <div className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-[var(--pad)] px-[var(--pad)]">
        {columns.map((col, i) => (
          <div
            key={i}
            className={cn(
              "flex shrink-0 snap-start flex-col gap-4",
              columns.length > 1
                ? "w-[86%] sm:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.7rem)]"
                : "w-full sm:w-[calc(50%-0.5rem)]"
            )}
          >
            {col.map((app) => (
              <AppRow key={app.slug} app={app} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/** One row: the shape every list in the store uses. */
export function AppRow({
  app,
  meta,
  size = "md",
}: {
  app: StoreApp;
  /** Replaces the rating line, e.g. "1.2 → 1.3 · 40 MB" on Updates. */
  meta?: React.ReactNode;
  size?: "md" | "lg";
}) {
  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <Link href={`/app/${app.slug}`} className="shrink-0">
        <Thumb
          seed={app.seed}
          src={app.icon}
          background={app.iconBackground}
          fit={app.iconFit}
          alt={app.name}
          className={cn(
            "ring-1 ring-white/[0.06]",
            size === "lg" ? "h-[72px] w-[72px]" : "h-16 w-16",
            ICON
          )}
        />
      </Link>
      <Link href={`/app/${app.slug}`} className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold leading-snug">
          {app.name}
        </span>
        <span className={cn("block truncate text-xs leading-snug", MUTED)}>
          {app.developer}
        </span>
        <span className={cn("mt-0.5 flex items-center gap-1 truncate text-xs", MUTED)}>
          {meta ?? (
            <>
              {app.rating > 0 && (
                <>
                  <Star size={11} className="fill-current" />
                  <span className="tabular-nums">{app.rating.toFixed(1)}</span>
                </>
              )}
              {app.rating > 0 && app.size && app.size !== "—" && <span>·</span>}
              {app.size && app.size !== "—" && <span>{app.size}</span>}
            </>
          )}
        </span>
      </Link>
      <GetButton app={app} />
    </div>
  );
}
