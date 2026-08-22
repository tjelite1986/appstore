import { Screen, ScreenTitle } from "@/components/screen";
import ChipRow from "@/components/chip-row";
import AppGrid from "@/components/app-grid";
import QuickLinks from "@/components/quick-links";
import { APPS } from "@/lib/catalog";

/**
 * Apps — the whole non-game catalog. The sketch leaves this screen empty, so it
 * is built from the blocks Home already establishes rather than inventing a new
 * shape for it.
 */
export default function AppsPage() {
  const apps = APPS.filter((a) => a.category !== "Games");

  return (
    <Screen>
      <ScreenTitle title="Apps" subtitle={`${apps.length} in the catalog`} />
      <ChipRow items={["All", "New", "Top rated", "Updated", "Installed"]} />
      <AppGrid apps={apps} />
      <QuickLinks title="Categories" />
    </Screen>
  );
}
