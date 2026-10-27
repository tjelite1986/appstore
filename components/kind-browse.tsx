import { ChevronDown } from "lucide-react";
import { Screen } from "@/components/screen";
import AppGrid from "@/components/app-grid";
import AppColumns from "@/components/app-columns";
import CategoryChips from "@/components/category-chips";
import FeatureCards from "@/components/feature-card";
import HeroCarousel from "@/components/hero-carousel";
import IconShelf from "@/components/icon-shelf";
import QuickLinks from "@/components/quick-links";
import { heroSlides } from "@/components/hero-slides";
import { currentUserId } from "@/lib/current-user";
import { adultsAllowed, shelfFor, showEmptyCategories } from "@/lib/user-state";
import {
  categoriesOf,
  categoryLabel,
  categorySlug,
  kindOf,
  type CategoryKind,
} from "@/lib/categories";
import { byTopRated } from "@/lib/search";
import { getCatalog } from "@/lib/store";
import { bulkOptions } from "@/lib/bulk-options";

/** Below this a category gets no shelf of its own; its chip still leads to it. */
const MIN_SHELF = 3;

/**
 * Apps and Games are the same screen over a different half of the catalog:
 * the newest artwork as a hero, category chips to jump with, the best rated
 * and the newest, a shelf per category, the category tiles, and the whole
 * list last for whoever wants to read it top to bottom.
 */
export default async function KindBrowse({ kind }: { kind: CategoryKind }) {
  const userId = await currentUserId();
  const adults = adultsAllowed(userId);
  const showEmpty = showEmptyCategories(userId);
  const apps = (await shelfFor(userId))
    .filter((a) => kindOf(a.category) === kind)
    .sort((a, b) => a.name.localeCompare(b.name));
  const noun = kind === "game" ? "game" : "app";

  const top = byTopRated(apps);
  const newest = [...apps]
    .filter((a) => a.added)
    .sort((a, b) => b.added.localeCompare(a.added));
  // The newest with artwork lead; the best rated with artwork that did not
  // make the hero get a card of their own further down.
  const hero = heroSlides(newest, 8);
  const inHero = new Set(hero.map((h) => h.slug));
  const spotlight = top.filter((a) => a.banner && !inHero.has(a.slug)).slice(0, 6);
  // A custom category is a choice somebody made, so one app is enough for a
  // shelf, and it goes first. Read off the same gated, kind-cut list as
  // everything else here: filing an Adults app under one does not put it on
  // anybody's shelf, and an 18+ one is not drawn for a viewer with the gate
  // shut.
  const { collections } = await getCatalog();
  const shelves = [
    ...collections
      .filter((c) => adults || !c.adults)
      .map((c) => ({
        key: `c:${c.slug}`,
        title: c.name,
        href: `/category/${c.slug}`,
        apps: top.filter((a) => a.collections.includes(c.slug)),
      }))
      .filter((s) => s.apps.length > 0),
    ...categoriesOf(kind)
      .map((c) => ({
        key: c,
        title: categoryLabel(c),
        href: `/category/${categorySlug(c)}`,
        apps: top.filter((a) => a.category === c),
      }))
      .filter((s) => s.apps.length >= MIN_SHELF),
  ];

  return (
    <Screen>
      <HeroCarousel slides={hero} />
      <CategoryChips
        apps={apps}
        adults={adults}
        collections={collections}
        showEmpty={showEmpty}
      />
      {apps.length === 0 ? (
        <AppGrid apps={[]} empty={`No ${noun}s yet.`} />
      ) : (
        <>
          <IconShelf title="Top rated" apps={top.slice(0, 15)} />
          {newest.length > 0 && (
            <AppColumns title="Recently added" apps={newest.slice(0, 12)} />
          )}
          <FeatureCards title="Worth a look" apps={spotlight} />
          {/* Alternate the two shelf shapes so a dozen categories do not read
              as one long repeated strip. */}
          {shelves.map((s, i) =>
            i % 2 === 0 ? (
              <IconShelf key={s.key} title={s.title} href={s.href} apps={s.apps} />
            ) : (
              <AppColumns key={s.key} title={s.title} href={s.href} apps={s.apps} />
            )
          )}
          <QuickLinks
            title={kind === "game" ? "Game categories" : "Categories"}
            adults={adults}
            kind={kind}
            apps={apps}
            collections={collections}
            showEmpty={showEmpty}
          />
          {/* Folded: the shelves above are the way in, and the whole list
              under them made the screen a wall on a phone. A <details> needs
              no client code and keeps the list in the page for find-in-page. */}
          <details className="group">
            <summary className="mx-[var(--pad)] flex cursor-pointer list-none items-center justify-between gap-3 rounded-full bg-[var(--card-2)] px-5 py-3.5 text-sm font-semibold transition hover:bg-[var(--pill-hover)] [&::-webkit-details-marker]:hidden">
              <span>
                All {noun}s A–Z{" "}
                <span className="font-normal text-[color:var(--muted)]">({apps.length})</span>
              </span>
              <span className="flex items-center gap-1 text-xs font-medium text-[color:var(--muted-2)]">
                <span className="group-open:hidden">Show all</span>
                <span className="hidden group-open:inline">Hide</span>
                <ChevronDown
                  size={16}
                  className="transition-transform group-open:rotate-180"
                />
              </span>
            </summary>
            <div className="mt-[var(--gap)]">
              <AppGrid apps={apps} bulk={await bulkOptions()} />
            </div>
          </details>
        </>
      )}
    </Screen>
  );
}
