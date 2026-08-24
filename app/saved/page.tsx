import { Screen, ScreenTitle } from "@/components/screen";
import AppGrid from "@/components/app-grid";
import { currentUserId } from "@/lib/current-user";
import { savedApps } from "@/lib/user-state";

export const dynamic = "force-dynamic";

/**
 * Saved — reached from the top bar's bookmark, not from the bottom nav.
 *
 * What a person kept is a fact about that person, so this screen is the one
 * place in the store that is empty for a reason rather than by accident: no
 * session, nothing to show, and the empty line says which of the two it is.
 */
export default async function SavedPage() {
  const userId = await currentUserId();

  return (
    <Screen>
      <ScreenTitle title="Saved" subtitle="Apps you kept for later" />
      <AppGrid
        apps={await savedApps(userId)}
        empty={
          userId === null
            ? "Sign in to keep apps here."
            : "Nothing saved yet — tap the bookmark on an app."
        }
      />
    </Screen>
  );
}
