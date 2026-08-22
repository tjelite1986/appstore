import { Screen, ScreenTitle } from "@/components/screen";
import AppGrid from "@/components/app-grid";
import { SAVED } from "@/lib/catalog";

/** Saved — reached from the top bar's bookmark, not from the bottom nav. */
export default function SavedPage() {
  return (
    <Screen>
      <ScreenTitle title="Saved" subtitle="Apps you kept for later" />
      <AppGrid apps={SAVED} empty="Nothing saved yet." />
    </Screen>
  );
}
