import { Screen } from "@/components/screen";
import AppRows from "@/components/app-rows";
import { Button, MUTED } from "@/components/primitives";
import { cn } from "@/lib/utils";
import { INSTALLED, UPDATES } from "@/lib/catalog";

/**
 * Updates. The bottom nav badges this screen, so it carries both halves of the
 * story: what is waiting, and what is already current. The old store put
 * "Installed" in the nav; here it is the second section of this screen.
 */
export default function UpdatesPage() {
  const upToDate = INSTALLED.filter((a) => !a.updateTo);

  return (
    <Screen>
      <div className="flex items-start justify-between gap-3 px-[var(--pad)]">
        <div>
          <h1 className="text-xl font-semibold">Updates</h1>
          <p className={cn("mt-0.5 text-sm", MUTED)}>
            {UPDATES.length} waiting
          </p>
        </div>
        <Button size="sm">Update all</Button>
      </div>

      <AppRows
        title="Available"
        apps={UPDATES}
        button="Update"
        showUpdateTarget
      />

      {upToDate.length > 0 && (
        <AppRows title="Up to date" apps={upToDate} button="Open" />
      )}
    </Screen>
  );
}
