import { Screen, ScreenTitle } from "@/components/screen";
import ChipRow from "@/components/chip-row";
import AppGrid from "@/components/app-grid";
import QuickLinks from "@/components/quick-links";
import { currentUserId } from "@/lib/current-user";
import { shelfFor } from "@/lib/user-state";

export const dynamic = "force-dynamic";

/**
 * Apps — the whole non-game catalog. The sketch leaves this screen empty, so it
 * is built from the blocks Home already establishes rather than inventing a new
 * shape for it.
 */
export default async function AppsPage() {
  // The catalog as this account sees it, so a tile can say "installed".
  const apps = (await shelfFor(await currentUserId())).filter(
    (a) => a.category !== "Games"
  );

  return (
    <Screen>
      <ScreenTitle title="Apps" subtitle={`${apps.length} in the catalog`} />
      <ChipRow items={["All", "New", "Top rated", "Updated", "Installed"]} />
      <AppGrid apps={apps} />
      <QuickLinks title="Categories" />
    </Screen>
  );
}
