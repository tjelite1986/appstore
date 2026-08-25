import Link from "next/link";
import { ArrowUpCircle, Bookmark, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { MUTED, SectionTitle, Thumb, metaLine } from "@/components/primitives";
import type { StoreApp } from "@/lib/store";

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
                src={app.icon}
                background={app.iconBackground}
                fit={app.iconFit}
                alt={app.name}
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
                {/* Only ever set for a signed-in visitor — `catalogFor` leaves
                    the flags off otherwise, so this line simply is not there
                    rather than being there and always false. */}
                {(app.installed || app.saved) && (
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[color:var(--accent-text)]">
                    {app.installed &&
                      (app.updateTo ? (
                        <span className="flex items-center gap-1">
                          <ArrowUpCircle size={11} /> {app.updateTo}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <Check size={11} /> Installed
                        </span>
                      ))}
                    {app.saved && (
                      <Bookmark
                        size={11}
                        className="fill-current"
                        aria-label="Saved"
                      />
                    )}
                  </span>
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
