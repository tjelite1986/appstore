import Link from "next/link";
import { Store } from "lucide-react";
import { ICONS } from "@/components/quick-links";
import { categoryTiles, type StoreApp } from "@/lib/store";
import { categoryLabel, categorySlug } from "@/lib/categories";

/**
 * A scrolling row of category chips with a count on each — the way into a
 * shelf from the top of Apps, Games and Search, where the tile grid used to
 * sit at the bottom under a hundred apps.
 *
 * Only shelves holding something are drawn: a chip that opens an empty page
 * is a dead end. `apps` is the list the page already shows, so the counts
 * agree with what the viewer can open.
 */
export default async function CategoryChips({
  apps,
  adults = false,
}: {
  /** What the screen lists — the counts and which chips appear follow it. */
  apps: StoreApp[];
  adults?: boolean;
}) {
  const counts = new Map<string, number>();
  for (const a of apps) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
  const tiles = (await categoryTiles({ adults, kind: "all" })).filter(
    (t) => (counts.get(t.label) ?? 0) > 0
  );
  if (tiles.length === 0) return null;

  return (
    <nav
      aria-label="Categories"
      className="no-scrollbar flex gap-2 overflow-x-auto px-[var(--pad)] pb-1"
    >
      {tiles.map(({ label, icon }) => {
        const Icon = ICONS[icon] ?? Store;
        return (
          <Link
            key={label}
            href={`/category/${categorySlug(label)}`}
            className="flex shrink-0 items-center gap-2 rounded-full bg-[var(--card-2)] py-2 pl-3.5 pr-2.5 text-[13px] font-medium text-[color:var(--muted-2)] transition hover:bg-[var(--pill-hover)] hover:text-[color:var(--fg)]"
          >
            <Icon size={14} className="shrink-0" />
            <span className="whitespace-nowrap">{categoryLabel(label)}</span>
            <span className="rounded-full bg-black/30 px-1.5 text-[10px] tabular-nums leading-4">
              {counts.get(label)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
