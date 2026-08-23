import { Plus, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Screen, ScreenTitle } from "@/components/screen";
import AppRows from "@/components/app-rows";
import RowCard from "@/components/rows";
import { Button, CARD, MUTED, SectionTitle } from "@/components/primitives";
import { STORE_ROOT, STORE_DIRS } from "@/lib/storage";
import { getCatalog, pendingImports } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Manage — the admin surface, reached from the top bar. Laid out here, wired to
 * nothing: the add form does not submit, the review queue is a static example
 * and the toggles do not persist.
 */
export default async function ManagePage() {
  const [{ apps, placeholder }, waiting] = await Promise.all([
    getCatalog(),
    pendingImports(),
  ]);

  return (
    <Screen>
      <ScreenTitle
        title="Manage"
        subtitle={
          placeholder
            ? "The library is empty — showing the placeholder catalog"
            : `${apps.length} ${apps.length === 1 ? "app" : "apps"} in the catalog`
        }
      />

      <section className="px-[var(--pad)]">
        <SectionTitle title="Add an app" />
        <div className={cn(CARD, "flex flex-col gap-3 p-3.5")}>
          <div
            className={cn(
              "rounded-full border border-[color:var(--border)] bg-[var(--card-2)] px-4 py-2.5 text-sm",
              MUTED
            )}
          >
            Store page URL, or owner/repo
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary">
              Auto-detect source
            </Button>
            <Button size="sm">
              <Plus size={13} /> Add
            </Button>
          </div>
        </div>
      </section>

      <section className="px-[var(--pad)]">
        <SectionTitle title="Import folder" />
        <div className={cn(CARD, "flex flex-col gap-2 p-3.5")}>
          <p className="text-sm">
            Drop <span className="font-mono text-xs">.apk</span> or{" "}
            <span className="font-mono text-xs">.xapk</span> files here:
          </p>
          <p className={cn("break-all font-mono text-xs", MUTED)}>
            {STORE_ROOT}/{STORE_DIRS.import}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary">
              <Upload size={13} /> Scan now
            </Button>
            <span className={cn("text-xs", MUTED)}>
              {waiting === 0
                ? "Nothing waiting"
                : `${waiting} ${waiting === 1 ? "file" : "files"} waiting`}
            </span>
          </div>
        </div>
      </section>

      <RowCard
        title="Sources"
        rows={[
          { label: "GitHub releases", value: "Not connected", toggle: true, on: false },
          { label: "F-Droid", value: "Not connected", toggle: true, on: false },
          { label: "Play Store metadata", value: "Not connected", toggle: true, on: false },
        ]}
      />

      {apps.length > 0 && (
        <AppRows title="Catalog" apps={apps.slice(0, 6)} button="Edit" />
      )}
    </Screen>
  );
}
