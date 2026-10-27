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
import { adultsAllowed, shelfFor } from "@/lib/user-state";
import {
  categoriesOf,
  categoryLabel,
  categorySlug,
  kindOf,
  type CategoryKind,
} from "@/lib/categories";
import { byTopRated } from "@/lib/search";
import { getCatalog } from "@/lib/store";

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
  // A collection is a choice somebody made, so one app is enough for a shelf.
  // Read off the same gated, kind-cut list as everything else here: filing an
  // Adults app under a collection does not put it on anybody's shelf.
  const { collections } = await getCatalog();
  const collectionShelves = collections
    .map((c) => ({ ...c, apps: top.filter((a) => a.collections.includes(c.slug)) }))
    .filter((s) => s.apps.length > 0);
  const shelves = categoriesOf(kind)
    .map((c) => ({ category: c, apps: top.filter((a) => a.category === c) }))
    .filter((s) => s.apps.length >= MIN_SHELF);

  return (
    <Screen>
      <HeroCarousel slides={hero} />
      <CategoryChips apps={apps} adults={adults} collections={collections} />
      {apps.length === 0 ? (
        <AppGrid apps={[]} empty={`No ${noun}s yet.`} />
      ) : (
        <>
          <IconShelf title="Top rated" apps={top.slice(0, 15)} />
          {newest.length > 0 && (
            <AppColumns title="Recently added" apps={newest.slice(0, 12)} />
          )}
          <FeatureCards title="Worth a look" apps={spotlight} />
          {collectionShelves.map((s) => (
            <IconShelf
              key={`c:${s.slug}`}
              title={s.name}
              href={`/collection/${s.slug}`}
              apps={s.apps}
            />
          ))}
          {/* Alternate the two shelf shapes so a dozen categories do not read
              as one long repeated strip. */}
          {shelves.map((s, i) =>
            i % 2 === 0 ? (
              <IconShelf
                key={s.category}
                title={categoryLabel(s.category)}
                href={`/category/${categorySlug(s.category)}`}
                apps={s.apps}
              />
            ) : (
              <AppColumns
                key={s.category}
                title={categoryLabel(s.category)}
                href={`/category/${categorySlug(s.category)}`}
                apps={s.apps}
              />
            )
          )}
          <QuickLinks
            title={kind === "game" ? "Game categories" : "Categories"}
            adults={adults}
            kind={kind}
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
              <AppGrid apps={apps} />
            </div>
          </details>
        </>
      )}
    </Screen>
  );
}
