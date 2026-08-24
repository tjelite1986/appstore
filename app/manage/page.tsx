import { Screen, ScreenTitle } from "@/components/screen";
import AppRows from "@/components/app-rows";
import { SectionTitle } from "@/components/primitives";
import AddApp from "@/components/add-app";
import SourcesPanel from "@/components/sources-panel";
import ImportPanel from "@/components/import-panel";
import { STORE_DIRS, STORE_HOST_ROOT } from "@/lib/storage";
import { getCatalog, pendingImports } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Manage — the admin surface, reached from the top bar.
 *
 * The import folder is real: `ImportPanel` scans it and resolves what the scan
 * would not decide on its own, `AddApp` takes an address and works out which
 * source it belongs to, and `SourcesPanel` asks those sources what they have
 * now. Nothing on this screen is layout any more.
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

      <section className="px-[var(--pad)]">
        <SectionTitle title="Sources" />
        <SourcesPanel
          counts={{
            github: apps.filter((a) => a.source?.kind === "github").length,
            fdroid: apps.filter((a) => a.source?.kind === "fdroid").length,
            play: apps.filter((a) => a.source?.kind === "play").length,
          }}
        />
      </section>

      {apps.length > 0 && (
        <AppRows title="Catalog" apps={apps.slice(0, 6)} button="Edit" />
      )}
    </Screen>
  );
}
