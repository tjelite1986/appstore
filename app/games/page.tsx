import { Screen, ScreenTitle } from "@/components/screen";
import ChipRow from "@/components/chip-row";
import CoverShelf from "@/components/cover-shelf";
import AppGrid from "@/components/app-grid";
import { currentUserId } from "@/lib/current-user";
import { catalogFor } from "@/lib/user-state";

export const dynamic = "force-dynamic";

/** Games. The chip row is the sketch's; the rest follows Home's language. */
export default async function GamesPage() {
  const games = (await catalogFor(await currentUserId())).filter(
    (a) => a.category === "Games"
  );

  return (
    <Screen>
      <ScreenTitle title="Games" />
      <ChipRow
        items={["For you", "Top", "Other", "Kids", "Premium", "Categories"]}
      />
      {games.length > 0 && (
        <CoverShelf
          title="Popular this week"
          action="View all"
          apps={games.slice(0, 6)}
          columns={6}
          sub="developer"
        />
      )}
      <AppGrid title="All games" apps={games} empty="No games yet." />
    </Screen>
  );
}
