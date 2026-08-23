import { Screen, ScreenTitle } from "@/components/screen";
import AppGrid from "@/components/app-grid";
import { saved } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Saved — reached from the top bar's bookmark, not from the bottom nav.
 *
 * What a person kept is a fact about that person, and there is no login yet, so
 * off a real library this is empty by design.
 */
export default async function SavedPage() {
  return (
    <Screen>
      <ScreenTitle title="Saved" subtitle="Apps you kept for later" />
      <AppGrid apps={await saved()} empty="Nothing saved yet." />
    </Screen>
  );
}
