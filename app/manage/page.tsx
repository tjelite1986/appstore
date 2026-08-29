import Link from "next/link";
import { Screen, ScreenTitle } from "@/components/screen";
import AppRows from "@/components/app-rows";
import { CARD, MUTED, SectionTitle } from "@/components/primitives";
import AddApp from "@/components/add-app";
import SourcesPanel from "@/components/sources-panel";
import ImportPanel from "@/components/import-panel";
import PruneVersions from "@/components/prune-versions";
import { STORE_DIRS, STORE_HOST_ROOT } from "@/lib/storage";
import { getCatalog, pendingImports, withoutAdults } from "@/lib/store";
import { duplicatePackages } from "@/lib/merge";
import { planPrune } from "@/lib/prune";
import { currentUserId } from "@/lib/current-user";
import { adultsAllowed } from "@/lib/user-state";
import { cn } from "@/lib/utils";

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
  const [{ apps: all, placeholder }, waiting] = await Promise.all([
    getCatalog(),
    pendingImports(),
  ]);
  // Manage is reachable by anyone — only its write actions ask who you are —
  // so the 18+ gate applies to the listing here as well. An admin who needs to
  // work on that shelf opens the gate in Settings like everybody else.
  const apps = adultsAllowed(await currentUserId()) ? all : withoutAdults(all);
  // Two listings for one package id. Usually it is the same app twice — a
  // second signer arrives, the review queue cannot offer it as an update, and
  // it gets its own slug — but not always: two mods of one program are a pair
  // somebody meant to have. So this reports the collision and does not act on
  // it. Nothing else on this screen would ever say so, the pair being
  // alphabetically adjacent only by luck, and the merge control lives on the
  // app page, where you have to already suspect it to go looking.
  const duplicates = placeholder ? [] : duplicatePackages(apps);
  // Counted off the same gated list, so the number on the button and the list
  // behind it — read through the route with the same gate — agree.
  const stale = placeholder ? null : planPrune(apps);

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

      {duplicates.length > 0 && (
        <section className="px-[var(--pad)]">
          <SectionTitle title="One package id, two listings" />
          <div className={cn(CARD, "divide-y divide-[color:var(--border)]")}>
            {duplicates.map((group) => (
              <div key={group.packageName} className="space-y-1.5 p-3">
                <p className={cn("break-all font-mono text-[11px]", MUTED)}>
                  {group.packageName}
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {group.apps.map((app) => (
                    <Link
                      key={app.slug}
                      href={`/app/${app.slug}`}
                      className="text-sm underline decoration-[color:var(--border)] underline-offset-4"
                    >
                      {app.name}{" "}
                      <span className={cn("text-xs", MUTED)}>
                        ({app.slug} · {app.version} ·{" "}
                        {app.versions.length === 1
                          ? "1 file"
                          : `${app.versions.length} files`}
                        )
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className={cn("mt-2 text-[11px] leading-relaxed", MUTED)}>
            Android keys on the package id, so a phone can hold only one of
            each pair at a time. Where that is the same app twice, open either
            listing to fold them together — the merge panel is on the app page,
            under the edit form.
          </p>
        </section>
      )}

      {stale && stale.versions > 0 && (
        <section className="px-[var(--pad)]">
          <SectionTitle title="Older versions" />
          <PruneVersions
            summary={`${stale.versions} older ${stale.versions === 1 ? "version" : "versions"} across ${stale.apps.length} ${stale.apps.length === 1 ? "app" : "apps"} · ${stale.size}`}
          />
          <p className={cn("mt-2 text-[11px] leading-relaxed", MUTED)}>
            Every app keeps its newest version; the ones behind it are deleted
            from the disk, not moved to <code>_import/_discarded/</code>. The
            list is shown before anything goes.
          </p>
        </section>
      )}

      {apps.length > 0 && (
        <AppRows title="Catalog" apps={apps.slice(0, 6)} button="Edit" />
      )}
    </Screen>
  );
}
