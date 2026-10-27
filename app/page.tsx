import { Screen } from "@/components/screen";
import AppColumns from "@/components/app-columns";
import Changelog from "@/components/changelog";
import FeatureCards from "@/components/feature-card";
import HeroCarousel from "@/components/hero-carousel";
import IconShelf from "@/components/icon-shelf";
import QuickLinks from "@/components/quick-links";
import { heroSlides } from "@/components/hero-slides";
import { MUTED } from "@/components/primitives";
import { cn } from "@/lib/utils";
import { changelog, getCatalog, recentlyAdded } from "@/lib/store";
import { categorySlug, kindOf } from "@/lib/categories";
import { byTopRated } from "@/lib/search";
import { currentUserId } from "@/lib/current-user";
import { adultsAllowed, shelfFor, showEmptyCategories } from "@/lib/user-state";

// The catalog is a directory on disk, not a build-time constant: an app
// imported after the last deploy has to show up without one.
export const dynamic = "force-dynamic";

/**
 * Home: the newest artwork as a hero, the latest additions as big icons, a
 * few apps given a whole card, then shelves for games and the categories
 * people open most, and the category tiles last.
 *
 * Each block is skipped when it is empty — a real library fills up unevenly,
 * and a heading over an empty shelf reads as a bug.
 */
export default async function HomePage() {
  const userId = await currentUserId();
  // Read once and passed down: every block and the category tiles have to
  // agree about what this person may see.
  const adults = adultsAllowed(userId);
  const [apps, recent, entries, { collections }] = await Promise.all([
    shelfFor(userId),
    recentlyAdded(15, { adults }),
    changelog(3, { adults }),
    getCatalog(),
  ]);

  const newest = [...apps]
    .filter((a) => a.added)
    .sort((a, b) => b.added.localeCompare(a.added));
  const hero = heroSlides(newest, 10);
  const inHero = new Set(hero.map((h) => h.slug));
  const top = byTopRated(apps);
  const spotlight = top.filter((a) => a.banner && !inHero.has(a.slug)).slice(0, 6);
  const games = top.filter((a) => kindOf(a.category) === "game");
  const mediaAndEntertainment = top.filter(
    (a) => a.category === "Media" || a.category === "Entertainment"
  );
  const communication = top.filter((a) => a.category === "Communication");
  const editors = top.filter((a) => a.category === "Editor");

  return (
    <Screen>
      {apps.length === 0 && (
        <p className={cn("px-[var(--pad)] py-10 text-center text-sm", MUTED)}>
          The library is empty.
        </p>
      )}

      <HeroCarousel slides={hero} />

      <IconShelf title="Recently added" apps={recent} />

      <FeatureCards title="Worth a look" apps={spotlight} />

      <AppColumns title="Top games" href="/games" apps={games} />

      <IconShelf
        title="Media & Entertainment"
        href={`/category/${categorySlug("Media")}`}
        apps={mediaAndEntertainment}
      />

      <AppColumns
        title="Communication"
        href={`/category/${categorySlug("Communication")}`}
        apps={communication}
      />

      <IconShelf title="Editors" href={`/category/${categorySlug("Editor")}`} apps={editors} />

      {entries.length > 0 && <Changelog title="What's new" items={entries} />}

      <QuickLinks
        title="Categories"
        adults={adults}
        apps={apps}
        collections={collections}
        showEmpty={showEmptyCategories(userId)}
      />
    </Screen>
  );
}
