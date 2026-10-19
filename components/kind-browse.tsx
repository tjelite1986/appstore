import { ChevronDown } from "lucide-react";
import { Screen, ScreenTitle } from "@/components/screen";
import AppGrid from "@/components/app-grid";
import CategoryChips from "@/components/category-chips";
import FeatureRail from "@/components/feature-rail";
import IconShelf from "@/components/icon-shelf";
import { currentUserId } from "@/lib/current-user";
import { adultsAllowed, shelfFor } from "@/lib/user-state";
import {
  categoriesOf,
  categoryLabel,
  categorySlug,
  kindOf,
  type CategoryKind,
} from "@/lib/categories";
import { byTopRated } from "@/lib/search";

/** Below this a category gets no shelf of its own; its chip still leads to it. */
const MIN_SHELF = 3;

/**
 * Apps and Games are the same screen over a different half of the catalog:
 * category chips to jump with, a rail of banners, the best rated and the
 * newest, a shelf per category, and the whole list last for whoever wants to
 * read it top to bottom.
 */
export default async function KindBrowse({ kind }: { kind: CategoryKind }) {
  const userId = await currentUserId();
  const adults = adultsAllowed(userId);
  const apps = (await shelfFor(userId))
    .filter((a) => kindOf(a.category) === kind)
    .sort((a, b) => a.name.localeCompare(b.name));
  const noun = kind === "game" ? "game" : "app";

  const top = byTopRated(apps);
  const newest = [...apps]
    .filter((a) => a.added)
    .sort((a, b) => b.added.localeCompare(a.added));
  // The newest with artwork, so the rail is not the Top rated row again.
  const featured = newest.filter((a) => a.banner).slice(0, 8);
  const shelves = categoriesOf(kind)
    .map((c) => ({ category: c, apps: top.filter((a) => a.category === c) }))
    .filter((s) => s.apps.length >= MIN_SHELF);

  return (
    <Screen>
      <ScreenTitle
        title={kind === "game" ? "Games" : "Apps"}
        subtitle={`${apps.length} ${noun}${apps.length === 1 ? "" : "s"} in the catalog`}
      />
      <CategoryChips apps={apps} adults={adults} />
      {apps.length === 0 ? (
        <AppGrid apps={[]} empty={`No ${noun}s yet.`} />
      ) : (
        <>
          <FeatureRail apps={featured} />
          <IconShelf title="Top rated" apps={top.slice(0, 15)} />
          {newest.length > 0 && (
            <IconShelf title="Recently added" apps={newest.slice(0, 15)} />
          )}
          {shelves.map((s) => (
            <IconShelf
              key={s.category}
              title={categoryLabel(s.category)}
              href={`/category/${categorySlug(s.category)}`}
              apps={s.apps}
            />
          ))}
          {/* Folded: the shelves above are the way in, and the whole list
              under them made the screen a wall on a phone. A <details> needs
              no client code and keeps the list in the page for find-in-page. */}
          <details className="group">
            <summary className="mx-[var(--pad)] flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-medium transition hover:bg-[var(--card-2)] [&::-webkit-details-marker]:hidden">
              <span>
                All {noun}s A–Z{" "}
                <span className="text-[color:var(--muted)]">({apps.length})</span>
              </span>
              <span className="flex items-center gap-1 text-xs text-[color:var(--accent-text)]">
                <span className="group-open:hidden">Show all</span>
                <span className="hidden group-open:inline">Hide</span>
                <ChevronDown
                  size={16}
                  className="transition-transform group-open:rotate-180"
                />
              </span>
            </summary>
            <div className="mt-[var(--gap)]">
              <AppGrid apps={apps} />
            </div>
          </details>
        </>
      )}
    </Screen>
  );
}
