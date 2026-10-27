import Link from "next/link";
import { ArrowUpCircle, Bookmark, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ICON, MUTED, SectionTitle, Thumb, metaLine } from "@/components/primitives";
import type { StoreApp } from "@/lib/store";
import { categoryLabel } from "@/lib/categories";
import { BulkSelect, SelectableCard, type BulkOptions } from "@/components/bulk-category";

/**
 * The catalog grid the browse screens are built from — Apps, Games, a category
 * and the search results all show the same tile, so an app looks the same
 * wherever it is found. Two per row on a phone, more as the screen allows.
 *
 * With `bulk` (an admin, see `lib/bulk-options.ts`), a long press on a card
 * starts choosing apps to file under a category together.
 */
export default function AppGrid({
  title,
  action,
  apps,
  empty = "Nothing here yet.",
  bulk,
}: {
  title?: string;
  action?: string;
  apps: StoreApp[];
  empty?: string;
  bulk?: BulkOptions;
}) {
  const grid = (
    <section className="px-[var(--pad)]">
      {title ? <SectionTitle title={title} action={action} /> : null}
      {apps.length === 0 ? (
        <p className={cn("py-8 text-center text-sm", MUTED)}>{empty}</p>
      ) : (
        <div className="-mx-2 grid grid-cols-2 gap-x-2 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
          {apps.map((app) => (
            <Card
              key={app.slug}
              bulk={!!bulk}
              slug={app.slug}
              category={app.category}
              collections={app.collections}
            >
              <Thumb
                seed={app.seed}
                src={app.icon}
                background={app.iconBackground}
                fit={app.iconFit}
                alt={app.name}
                className={cn("h-14 w-14 shrink-0 ring-1 ring-white/[0.06]", ICON)}
              />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-sm font-semibold leading-snug">
                  {app.name}
                </span>
                <span className={cn("block truncate text-[11px]", MUTED)}>
                  {categoryLabel(app.category)}
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
            </Card>
          ))}
        </div>
      )}
    </section>
  );
  return bulk && apps.length > 0 ? <BulkSelect options={bulk}>{grid}</BulkSelect> : grid;
}

const CARD_CLASS =
  "flex min-w-0 items-center gap-3 rounded-[var(--radius)] p-2 transition hover:bg-[var(--card)]";

/** A plain link, or one a long press can select when the grid allows it. */
function Card({
  bulk,
  slug,
  category,
  collections,
  children,
}: {
  bulk: boolean;
  slug: string;
  category: string;
  collections: string[];
  children: React.ReactNode;
}) {
  const href = `/app/${slug}`;
  return bulk ? (
    <SelectableCard
      slug={slug}
      category={category}
      collections={collections}
      href={href}
      className={CARD_CLASS}
    >
      {children}
    </SelectableCard>
  ) : (
    <Link href={href} className={CARD_CLASS}>
      {children}
    </Link>
  );
}
