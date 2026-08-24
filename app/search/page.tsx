import { Search } from "lucide-react";
import { Screen } from "@/components/screen";
import ChipRow from "@/components/chip-row";
import AppGrid from "@/components/app-grid";
import { MUTED } from "@/components/primitives";
import { cn } from "@/lib/utils";
import { currentUserId } from "@/lib/current-user";
import { catalogFor } from "@/lib/user-state";

export const dynamic = "force-dynamic";

/**
 * Search. A plain GET form — the whole catalog is already in memory, so a
 * server round trip answers faster than shipping a client search would, and
 * the query stays in the URL where it can be shared and gone back to.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const apps = await catalogFor(await currentUserId());

  const needle = query.toLowerCase();
  const results = query
    ? apps.filter((a) =>
        [a.name, a.developer, a.tagline, a.category, a.packageName ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(needle)
      )
    : [];

  return (
    <Screen>
      <form action="/search" className="px-[var(--pad)]">
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-full border border-[color:var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm",
            MUTED
          )}
        >
          <Search size={16} className="shrink-0" />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search apps and games"
            aria-label="Search apps and games"
            autoComplete="off"
            className="w-full bg-transparent text-[color:var(--fg)] outline-none placeholder:text-[color:var(--muted)]"
          />
        </div>
      </form>
      <ChipRow
        items={["All", "Apps", "Games", "Editor", "Media", "Communication"]}
      />
      {query ? (
        <AppGrid
          title={`${results.length} ${results.length === 1 ? "result" : "results"} for "${query}"`}
          apps={results}
          empty="Nothing matched."
        />
      ) : (
        <AppGrid title="Suggestions" apps={apps.slice(0, 8)} />
      )}
    </Screen>
  );
}
