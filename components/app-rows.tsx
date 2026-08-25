import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  CARD,
  MUTED,
  SectionTitle,
  Thumb,
  buttonClass,
  metaLine,
} from "@/components/primitives";
import type { StoreApp } from "@/lib/store";

/**
 * The sketch's `app-card`: one bordered card holding a list of apps, each with
 * an icon, a name, a meta line and an action button on the right. Used on Home
 * for a category block and again on Updates and Installed, where the same row
 * shape carries a different button.
 */
export default function AppRows({
  title,
  action,
  apps,
  button = "Install",
  /** Shown instead of rating/size when the row is about a pending update. */
  showUpdateTarget = false,
}: {
  title?: string;
  action?: string;
  apps: StoreApp[];
  button?: string;
  showUpdateTarget?: boolean;
}) {
  return (
    <section className="px-[var(--pad)]">
      {title ? <SectionTitle title={title} action={action} /> : null}
      <div className={cn(CARD, "overflow-hidden")}>
        {apps.map((app, i) => (
          <div
            key={app.slug}
            className={cn(
              "flex items-center gap-3 px-3.5 py-3",
              i > 0 && "border-t border-[color:var(--border)]"
            )}
          >
            <Link href={`/app/${app.slug}`} className="shrink-0">
              <Thumb
                seed={app.seed}
                src={app.icon}
                background={app.iconBackground}
                fit={app.iconFit}
                alt={app.name}
                className="h-12 w-12 rounded-[var(--radius-sm)]"
              />
            </Link>
            <Link href={`/app/${app.slug}`} className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {app.name}
              </span>
              <span className={cn("block truncate text-xs", MUTED)}>
                {showUpdateTarget
                  ? `${app.version} → ${app.updateTo} · ${app.size}`
                  : metaLine(app.rating, app.size)}
              </span>
            </Link>
            {/* A link, not a button: everything this row could offer — the
                file, the version list, the description — is on the app's own
                page, and a button here would have to be a second way to do
                the same thing. */}
            <Link
              href={`/app/${app.slug}`}
              className={buttonClass("secondary", "sm")}
            >
              {button}
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
