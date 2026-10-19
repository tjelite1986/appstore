import { Screen, ScreenTitle } from "@/components/screen";
import AppGrid from "@/components/app-grid";
import QuickLinks from "@/components/quick-links";
import { currentUserId } from "@/lib/current-user";
import { adultsAllowed, shelfFor } from "@/lib/user-state";
import { kindOf } from "@/lib/categories";

export const dynamic = "force-dynamic";

/**
 * Apps — the whole non-game catalog. The sketch leaves this screen empty, so it
 * is built from the blocks Home already establishes rather than inventing a new
 * shape for it.
 */
export default async function AppsPage() {
  // The catalog as this account sees it, so a tile can say "installed".
  const userId = await currentUserId();
  const apps = (await shelfFor(userId)).filter(
    (a) => kindOf(a.category) === "app"
  );

  return (
    <Screen>
      <ScreenTitle title="Apps" subtitle={`${apps.length} in the catalog`} />
      <AppGrid apps={apps} />
      <QuickLinks title="Categories" adults={adultsAllowed(userId)} />
    </Screen>
  );
}
