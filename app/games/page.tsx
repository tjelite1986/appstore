import { Screen, ScreenTitle } from "@/components/screen";
import ChipRow from "@/components/chip-row";
import CoverShelf from "@/components/cover-shelf";
import AppGrid from "@/components/app-grid";
import { byCategory } from "@/lib/catalog";

/** Games. The chip row is the sketch's; the rest follows Home's language. */
export default function GamesPage() {
  const games = byCategory("Games");

  return (
    <Screen>
      <ScreenTitle title="Games" />
      <ChipRow
        items={["For you", "Top", "Other", "Kids", "Premium", "Categories"]}
      />
      <CoverShelf
        title="Popular this week"
        action="View all"
        apps={games.slice(0, 6)}
        columns={6}
        sub="developer"
      />
      <AppGrid title="All games" apps={games} />
    </Screen>
  );
}
