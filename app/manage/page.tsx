import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Screen, ScreenTitle } from "@/components/screen";
import AppRows from "@/components/app-rows";
import RowCard from "@/components/rows";
import { Button, CARD, MUTED, SectionTitle } from "@/components/primitives";
import ImportPanel from "@/components/import-panel";
import { STORE_ROOT, STORE_DIRS } from "@/lib/storage";
import { getCatalog, pendingImports } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Manage — the admin surface, reached from the top bar.
 *
 * The import folder is real: `ImportPanel` scans it, and resolves what the
 * scan would not decide on its own. The rest is still layout — the add form
 * does not submit and the source toggles do not persist.
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
        <ImportPanel
          storePath={`${STORE_ROOT}/${STORE_DIRS.import}`}
          waiting={waiting}
          // Placeholder rows are not folders on disk — offering them as attach
          // targets would create an app named after an example.
          apps={
            placeholder
              ? []
              : apps.map((a) => ({ slug: a.slug, name: a.name }))
          }
        />
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
