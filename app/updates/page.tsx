import { Screen } from "@/components/screen";
import AppRows from "@/components/app-rows";
import { Button, MUTED } from "@/components/primitives";
import { cn } from "@/lib/utils";
import { installed, updates } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Updates. The bottom nav badges this screen, so it carries both halves of the
 * story: what is waiting, and what is already current. The old store put
 * "Installed" in the nav; here it is the second section of this screen.
 *
 * Both halves are about one person's device, so they stay empty until there is
 * a login to hang them on.
 */
export default async function UpdatesPage() {
  const [pending, current] = await Promise.all([updates(), installed()]);
  const upToDate = current.filter((a) => !a.updateTo);

  return (
    <Screen>
      <div className="flex items-start justify-between gap-3 px-[var(--pad)]">
        <div>
          <h1 className="text-xl font-semibold">Updates</h1>
          <p className={cn("mt-0.5 text-sm", MUTED)}>
            {pending.length} waiting
          </p>
        </div>
        {pending.length > 0 && <Button size="sm">Update all</Button>}
      </div>

      {pending.length > 0 && (
        <AppRows
          title="Available"
          apps={pending}
          button="Update"
          showUpdateTarget
        />
      )}

      {upToDate.length > 0 && (
        <AppRows title="Up to date" apps={upToDate} button="Open" />
      )}

      {pending.length === 0 && upToDate.length === 0 && (
        <p className={cn("px-[var(--pad)] py-10 text-center text-sm", MUTED)}>
          Nothing installed from here yet.
        </p>
      )}
    </Screen>
  );
}
