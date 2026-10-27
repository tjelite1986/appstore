import Link from "next/link";
import { Store } from "lucide-react";
import { ICONS } from "@/components/category-icons";
import { SectionTitle } from "@/components/primitives";
import {
  categoryTiles,
  customTiles,
  type CategoryKind,
  type CollectionDef,
  type StoreApp,
} from "@/lib/store";
import { categoryLabel, categorySlug } from "@/lib/categories";

/**
 * Category tiles: icon over label in a four-column panel divided by hairlines,
 * each tile a jump into its category.
 *
 * Custom categories come first and look the same; which of them appear is
 * counted over `apps`, the list the screen shows (see `customTiles`).
 */
export default async function QuickLinks({
  title,
  adults = false,
  kind = "app",
  apps = [],
  collections = [],
  showEmpty = false,
}: {
  title: string;
  /** Whether this viewer has passed the 18+ gate — see `lib/user-state.ts`. */
  adults?: boolean;
  /** App shelves or game shelves; the Games screen asks for the second. */
  kind?: CategoryKind;
  apps?: StoreApp[];
  collections?: CollectionDef[];
  showEmpty?: boolean;
}) {
  const categories = [
    ...customTiles(collections, apps, { adults, showEmpty }).map((c) => ({
      key: `c:${c.slug}`,
      href: `/category/${c.slug}`,
      label: c.name,
      icon: c.icon,
    })),
    ...(await categoryTiles({ adults, kind })).map(({ label, icon }) => ({
      key: label,
      href: `/category/${categorySlug(label)}`,
      label: categoryLabel(label),
      icon,
    })),
  ];
  if (categories.length === 0) return null;
  // Fill the last row with blank cells so the hairline grid stays a grid.
  const blanks = (4 - (categories.length % 4)) % 4;

  return (
    <section className="px-[var(--pad)]">
      <SectionTitle title={title} />
      <div className="grid grid-cols-4 gap-px overflow-hidden rounded-[var(--radius-lg)] bg-[#2a2a2e]">
        {categories.map(({ key, href, label, icon }) => {
          const Icon = ICONS[icon] ?? Store;
          return (
            <Link
              key={key}
              href={href}
              className="flex min-h-[92px] flex-col items-center justify-center gap-2 bg-[var(--card)] px-0.5 py-4 text-center transition hover:bg-[var(--card-2)]"
            >
              <Icon size={24} strokeWidth={1.7} />
              <span className="line-clamp-2 w-full text-[10.5px] leading-tight tracking-tight text-[color:var(--muted-2)]">
                {label}
              </span>
            </Link>
          );
        })}
        {Array.from({ length: blanks }, (_, i) => (
          <span key={`blank-${i}`} className="bg-[var(--card)]" />
        ))}
      </div>
    </section>
  );
}
