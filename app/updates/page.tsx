import { Screen } from "@/components/screen";
import AppRows from "@/components/app-rows";
import { MUTED } from "@/components/primitives";
import { cn } from "@/lib/utils";
import { currentUserId } from "@/lib/current-user";
import { installedApps, updatableApps } from "@/lib/user-state";

export const dynamic = "force-dynamic";

/**
 * Updates. The bottom nav badges this screen, so it carries both halves of the
 * story: what is waiting, and what is already current. The old store put
 * "Installed" in the nav; here it is the second section of this screen.
 *
 * Both halves are about apps this account said it has — see
 * `components/installed-control.tsx` for why that is a claim rather than a
 * reading — so with no session there is nothing here to be wrong about.
 *
 * There is no "Update all": every update is a file the person downloads and
 * installs themselves, and a button that cannot do that is worse than none.
 */
export default async function UpdatesPage() {
  const userId = await currentUserId();
  const [pending, current] = await Promise.all([
    updatableApps(userId),
    installedApps(userId),
  ]);
  const upToDate = current.filter((a) => !a.updateTo);

  return (
    <Screen>
      <div className="px-[var(--pad)]">
        <h1 className="text-xl font-semibold">Updates</h1>
        <p className={cn("mt-0.5 text-sm", MUTED)}>
          {userId === null ? "Sign in to track your apps" : `${pending.length} waiting`}
        </p>
      </div>

      {pending.length > 0 && (
        <AppRows
          title="Available"
          apps={pending}
          button="Get"
          showUpdateTarget
        />
      )}

      {upToDate.length > 0 && (
        <AppRows title="Up to date" apps={upToDate} button="Open" />
      )}

      {pending.length === 0 && upToDate.length === 0 && (
        <p className={cn("px-[var(--pad)] py-10 text-center text-sm", MUTED)}>
          {userId === null
            ? "Nothing to show until you sign in."
            : "Nothing marked as installed yet."}
        </p>
      )}
    </Screen>
  );
}
