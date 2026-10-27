import { Screen } from "@/components/screen";
import AppGrid from "@/components/app-grid";
import CategoryChips from "@/components/category-chips";
import IconShelf from "@/components/icon-shelf";
import SearchBox from "@/components/search-box";
import { currentUserId } from "@/lib/current-user";
import {
  adultsAllowed,
  catalogFor,
  shelfFor,
  showEmptyCategories,
} from "@/lib/user-state";
import { getCatalog } from "@/lib/store";
import { bulkOptions } from "@/lib/bulk-options";
import { byTopRated, searchApps } from "@/lib/search";

export const dynamic = "force-dynamic";

/**
 * Search. The box suggests as it is typed (`components/search-box.tsx`);
 * Enter lands here with the query in the URL, where it can be shared and gone
 * back to. Both rank through `lib/search.ts`, so the list here starts with the
 * suggestions that were under the box.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const userId = await currentUserId();
  // Every listing, members of a family included: the shelf shows a family as
  // one card, but someone typing "Elitogram" means that build and no other.
  const apps = await catalogFor(userId);
  const results = searchApps(apps, query);

  return (
    <Screen>
      <div className="px-[var(--pad)]">
        {/* Keyed on the query so going back to another search resets the box. */}
        <SearchBox key={query} initialQuery={query} autoFocus={!query} />
      </div>
      {query ? (
        <AppGrid
          title={`${results.length} ${results.length === 1 ? "result" : "results"} for "${query}"`}
          apps={results}
          empty="Nothing matched. Try fewer or shorter words."
          bulk={await bulkOptions()}
        />
      ) : (
        <Browse userId={userId} />
      )}
    </Screen>
  );
}

/** Before anything is typed: the shelves to wander into instead. */
async function Browse({ userId }: { userId: number | null }) {
  const [shelf, { collections }] = await Promise.all([shelfFor(userId), getCatalog()]);
  return (
    <>
      <CategoryChips
        apps={shelf}
        adults={adultsAllowed(userId)}
        collections={collections}
        showEmpty={showEmptyCategories(userId)}
      />
      <IconShelf title="Popular" apps={byTopRated(shelf).slice(0, 15)} />
    </>
  );
}
