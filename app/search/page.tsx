import { Search } from "lucide-react";
import { Screen } from "@/components/screen";
import ChipRow from "@/components/chip-row";
import AppGrid from "@/components/app-grid";
import { MUTED } from "@/components/primitives";
import { cn } from "@/lib/utils";
import { APPS } from "@/lib/catalog";

/**
 * Search. The field is a static stand-in — there is no query handling in this
 * build — and the grid below shows what results will look like.
 */
export default function SearchPage() {
  return (
    <Screen>
      <div className="px-[var(--pad)]">
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-full border border-[color:var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm",
            MUTED
          )}
        >
          <Search size={16} />
          Search apps and games
        </div>
      </div>
      <ChipRow
        items={["All", "Apps", "Games", "Editor", "Media", "Communication"]}
      />
      <AppGrid title="Suggestions" apps={APPS.slice(0, 8)} />
    </Screen>
  );
}
