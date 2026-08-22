import Link from "next/link";
import { cn } from "@/lib/utils";
import { MUTED, SectionTitle, Thumb, metaLine } from "@/components/primitives";
import type { StoreApp } from "@/lib/catalog";

/**
 * The catalog grid the browse screens are built from — Apps, Games, a category
 * and the search results all show the same tile, so an app looks the same
 * wherever it is found. Two per row on a phone, more as the screen allows.
 */
export default function AppGrid({
  title,
  action,
  apps,
  empty = "Nothing here yet.",
}: {
  title?: string;
  action?: string;
  apps: StoreApp[];
  empty?: string;
}) {
  return (
    <section className="px-[var(--pad)]">
      {title ? <SectionTitle title={title} action={action} /> : null}
      {apps.length === 0 ? (
        <p className={cn("py-8 text-center text-sm", MUTED)}>{empty}</p>
      ) : (
        <div className="grid grid-cols-2 gap-[var(--gap)] sm:grid-cols-3 lg:grid-cols-4">
          {apps.map((app) => (
            <Link
              key={app.slug}
              href={`/app/${app.slug}`}
              className="flex min-w-0 items-start gap-3"
            >
              <Thumb
                seed={app.seed}
                className="h-14 w-14 shrink-0 rounded-[var(--radius-sm)] shadow-lg"
              />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-sm font-medium">
                  {app.name}
                </span>
                <span className={cn("block truncate text-[11px]", MUTED)}>
                  {app.category}
                </span>
                <span className={cn("block truncate text-[11px]", MUTED)}>
                  {metaLine(app.rating, app.size)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
