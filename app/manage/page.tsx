import { Screen, ScreenTitle } from "@/components/screen";
import AppRows from "@/components/app-rows";
import RowCard from "@/components/rows";
import { SectionTitle } from "@/components/primitives";
import AddApp from "@/components/add-app";
import ImportPanel from "@/components/import-panel";
import { STORE_DIRS, STORE_HOST_ROOT } from "@/lib/storage";
import { getCatalog, pendingImports } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Manage — the admin surface, reached from the top bar.
 *
 * The import folder is real: `ImportPanel` scans it and resolves what the scan
 * would not decide on its own, and `AddApp` searches Google Play for something
 * to attach a drop to. The source toggles below are still layout.
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
        <AddApp />
      </section>

      <section className="px-[var(--pad)]">
        <SectionTitle title="Import" />
        <ImportPanel
          storePath={`${STORE_HOST_ROOT}/${STORE_DIRS.import}`}
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
