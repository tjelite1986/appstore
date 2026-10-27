import { SectionTitle } from "@/components/primitives";
import { AppRow } from "@/components/app-columns";
import type { StoreApp } from "@/lib/store";

/**
 * A plain vertical list of app rows under a heading — Updates and My apps.
 * Same row as every shelf, so an app looks the same wherever it is listed.
 */
export default function AppRows({
  id,
  title,
  action,
  apps,
  /** Shown instead of rating/size when the row is about a pending update. */
  showUpdateTarget = false,
}: {
  id?: string;
  title?: string;
  action?: string;
  apps: StoreApp[];
  showUpdateTarget?: boolean;
}) {
  return (
    <section id={id} className="scroll-mt-16 px-[var(--pad)]">
      {title ? <SectionTitle title={title} action={action} /> : null}
      <div className="flex flex-col gap-4">
        {apps.map((app) => (
          <AppRow
            key={app.slug}
            app={app}
            meta={
              showUpdateTarget ? (
                <span className="truncate">
                  {app.version} → {app.updateTo} · {app.size}
                </span>
              ) : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}
