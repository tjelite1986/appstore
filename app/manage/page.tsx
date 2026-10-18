import Link from "next/link";
import {
  Archive,
  ArrowUpFromLine,
  ChevronDown,
  Copy,
  FolderInput,
  History,
  Layers,
  PackagePlus,
  Rss,
} from "lucide-react";
import { Screen, ScreenTitle } from "@/components/screen";
import {
  MUTED,
  Panel,
  Pill,
  Stat,
  Thumb,
  buttonClass,
} from "@/components/primitives";
import AddApp from "@/components/add-app";
import SourcesPanel from "@/components/sources-panel";
import ImportPanel from "@/components/import-panel";
import PruneVersions from "@/components/prune-versions";
import TrackUpstreamButton from "@/components/track-upstream";
import { STORE_DIRS, STORE_HOST_ROOT } from "@/lib/storage";
import {
  formatBytes,
  getCatalog,
  pendingImports,
  withoutAdults,
  type StoreApp,
} from "@/lib/store";
import { duplicatePackages } from "@/lib/merge";
import { planPrune } from "@/lib/prune";
import { currentUser } from "@/lib/current-user";
import { adultsAllowed } from "@/lib/user-state";
import {
  lastSourceReport,
  restrictReport,
  type SourceCheck,
} from "@/lib/sources/updates";
import { cn, relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** How many shared-id groups show before the rest fold behind a disclosure. */
const DUPLICATES_SHOWN = 4;

/**
 * Manage — the admin surface, reached from the top bar.
 *
 * It opens on numbers: how big the library is, what is waiting, what is
 * wrong. Under them the screen splits in two on a wide display — the work on
 * the left (adding an app, the import folder and its review queue), the state
 * of the library on the right (sources, old versions, shared package ids,
 * what arrived last). On a phone the same cards stack in that order.
 *
 * The import folder is real: `ImportPanel` scans it and resolves what the scan
 * would not decide on its own, `AddApp` takes an address and works out which
 * source it belongs to, and `SourcesPanel` asks those sources what they have
 * now.
 */
export default async function ManagePage() {
  const [{ apps: all, placeholder }, waiting, lastReport] = await Promise.all([
    getCatalog(),
    pendingImports(),
    lastSourceReport(),
  ]);
  // Manage is reachable by anyone — only its write actions ask who you are —
  // so the 18+ gate applies to the listing here as well. An admin who needs to
  // work on that shelf opens the gate in Settings like everybody else.
  const user = await currentUser();
  const apps = adultsAllowed(user?.id ?? null) ? all : withoutAdults(all);
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

  const files = apps.flatMap((a) => a.versions.flatMap((v) => v.files));
  const bytes = files.reduce((sum, f) => sum + f.bytes, 0);
  const counts = {
    github: apps.filter((a) => a.source?.kind === "github").length,
    fdroid: apps.filter((a) => a.source?.kind === "fdroid").length,
    play: apps.filter((a) => a.source?.kind === "play").length,
  };
  const checkable = counts.github + counts.fdroid + counts.play;
  const recent = placeholder
    ? []
    : [...apps]
        .sort((a, b) => (b.added ?? "").localeCompare(a.added ?? ""))
        .slice(0, 6);

  // What the last source check found, cut to the same gated list as every
  // other number on this screen. "Behind" is what upstream has and the
  // library does not — whether a fetch will take it (`available`) or nothing
  // can (`behind`, Play); a failed check is listed with it, because an app the
  // check could not reach is not known to be current either.
  //
  // An app marked `untracked` since the report was written is cut out here
  // rather than waiting for the next run: the mark is the person's answer,
  // and the saved report is older than it. Cut from the report itself, so the
  // Sources card's summary line and this card count the same apps.
  //
  // Admins only, like the check route that produced it: the report carries
  // error messages from upstream calls, and before it was saved those only
  // ever reached the admin whose click made them. Everyone else sees the tile
  // with no number.
  const admin = user?.role === "admin";
  const report =
    admin && lastReport && !placeholder
      ? restrictReport(
          lastReport,
          new Set(apps.filter((a) => !a.source?.untracked).map((a) => a.slug))
        )
      : null;
  const bySlug = new Map(apps.map((a) => [a.slug, a]));
  const behind = report
    ? report.apps.filter((a) => a.status === "available" || a.status === "behind")
    : [];
  const failed = report ? report.apps.filter((a) => a.status === "error") : [];
  const untracked = admin ? apps.filter((a) => a.source?.untracked) : [];
  const checkedAgo = report ? relativeTime(report.at) : null;

  return (
    <Screen>
      <ScreenTitle
        title="Manage"
        subtitle={
          placeholder
            ? "The library is empty — showing the placeholder catalog"
            : "The library, what is waiting for you, and what needs a look"
        }
      />

      <div className="flex flex-col gap-[var(--gap)] px-[var(--pad)]">
        {/* The numbers first. Each one that has a card behind it jumps there. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Stat
            label="Apps"
            value={apps.length}
            sub={placeholder ? "placeholder" : plural(files.length, "file")}
            icon={Layers}
          />
          <Stat
            label="On disk"
            value={formatBytes(bytes)}
            sub={plural(
              apps.reduce((n, a) => n + a.versions.length, 0),
              "version"
            )}
            icon={Archive}
          />
          <Stat
            label="Waiting"
            value={waiting}
            sub={waiting === 0 ? "import folder empty" : "in the import folder"}
            tone={waiting > 0 ? "accent" : "neutral"}
            href="#import"
            icon={FolderInput}
          />
          <Stat
            label="Sources"
            value={counts.github + counts.fdroid + counts.play}
            sub={
              [
                counts.github && `${counts.github} GitHub`,
                counts.fdroid && `${counts.fdroid} F-Droid`,
                counts.play && `${counts.play} Play`,
              ]
                .filter(Boolean)
                .join(" · ") || "none linked"
            }
            href="#sources"
            icon={Rss}
          />
          <Stat
            label="Behind"
            value={report ? behind.length : "—"}
            sub={
              report
                ? failed.length > 0
                  ? `${failed.length} failed · ${checkedAgo}`
                  : `checked ${checkedAgo}`
                : admin
                  ? "no check yet"
                  : "admins only"
            }
            tone={behind.length > 0 || failed.length > 0 ? "warn" : "neutral"}
            href={admin && checkable > 0 ? "#behind" : undefined}
            icon={ArrowUpFromLine}
          />
          <Stat
            label="Shared ids"
            value={duplicates.length}
            sub={duplicates.length === 0 ? "none" : "two listings each"}
            tone={duplicates.length > 0 ? "warn" : "neutral"}
            href={duplicates.length > 0 ? "#duplicates" : undefined}
            icon={Copy}
          />
          <Stat
            label="Reclaimable"
            value={stale && stale.versions > 0 ? stale.size : "none"}
            sub={
              stale && stale.versions > 0
                ? plural(stale.versions, "older version")
                : "one version each"
            }
            href={stale && stale.versions > 0 ? "#older" : undefined}
            icon={History}
            // Seven tiles on a two-column phone grid leave one alone; it
            // takes the row.
            className="col-span-2 sm:col-span-1"
          />
        </div>

        <div className="grid gap-[var(--gap)] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
          {/* Left: the work. */}
          <div className="flex min-w-0 flex-col gap-[var(--gap)]">
            <Panel
              icon={PackagePlus}
              title="Add an app"
              description="Search Google Play by name, or paste a GitHub repository, an F-Droid package or an apkmb page. The panel works out which source it is."
            >
              <AddApp />
            </Panel>

            <Panel
              id="import"
              icon={FolderInput}
              title="Import"
              aside={
                waiting > 0 ? (
                  <Pill tone="accent">{plural(waiting, "file")} waiting</Pill>
                ) : null
              }
              description="The Telegram feed and the import folder both land here. Files the scan cannot place on its own wait below for a decision."
            >
              <ImportPanel
                storePath={`${STORE_HOST_ROOT}/${STORE_DIRS.import}`}
                waiting={waiting}
                // Placeholder rows are not folders on disk — offering them as
                // attach targets would create an app named after an example.
                apps={
                  placeholder
                    ? []
                    : apps.map((a) => ({ slug: a.slug, name: a.name }))
                }
              />
            </Panel>
          </div>

          {/* Right: the state of the library. */}
          <div className="flex min-w-0 flex-col gap-[var(--gap)]">
            <Panel
              id="sources"
              icon={Rss}
              title="Sources"
              description="Where the listings came from, and whether upstream has moved on. A check is a few API calls; fetching downloads every new release."
            >
              <SourcesPanel counts={counts} initialReport={report} />
            </Panel>

            {admin && checkable > 0 && (
              <Panel
                id="behind"
                icon={ArrowUpFromLine}
                title="Behind upstream"
                aside={
                  !report ? null : behind.length + failed.length > 0 ? (
                    <Pill tone="warn">
                      {behind.length + failed.length}
                    </Pill>
                  ) : (
                    <Pill tone="ok">all current</Pill>
                  )
                }
                description="Apps the last check could not call current: upstream has a release the library does not hold, or did not answer. GitHub and F-Droid releases are fetched by the timer every six hours, so what stays here from them is a release the importer refused — decide it in the review queue — or an address to fix. A Play app stays until a newer build arrives from elsewhere; one that is a modified build can be taken off the comparison."
                flush
              >
                <BehindRows
                  behind={behind}
                  failed={failed}
                  untracked={untracked}
                  report={report}
                  bySlug={bySlug}
                />
              </Panel>
            )}

            {stale && stale.versions > 0 && (
              <Panel
                id="older"
                icon={History}
                title="Older versions"
                aside={<Pill>{stale.size}</Pill>}
                description={
                  <>
                    Every app keeps its newest version; the ones behind it are
                    deleted from the disk, not moved to{" "}
                    <code>_import/_discarded/</code>. The list is shown before
                    anything goes.
                  </>
                }
              >
                <PruneVersions
                  summary={`${plural(stale.versions, "older version")} across ${plural(stale.apps.length, "app")} · ${stale.size}`}
                />
              </Panel>
            )}

            {duplicates.length > 0 && (
              <Panel
                id="duplicates"
                icon={Copy}
                title="One package id, two listings"
                aside={<Pill tone="warn">{duplicates.length}</Pill>}
                description="Android keys on the package id, so a phone holds one of each pair. Where it is the same app twice, open either listing and fold them together — the merge panel is on the app page, under the edit form."
                flush
              >
                <DuplicateGroups groups={duplicates} />
              </Panel>
            )}

            {recent.length > 0 && (
              <Panel
                icon={Layers}
                title="Recently added"
                aside={
                  <Link href="/apps" className={cn("text-xs", MUTED)}>
                    All apps &rarr;
                  </Link>
                }
                description="The last listings to arrive, newest first — the ones most likely to still need a description or an icon."
                flush
              >
                <RecentRows apps={recent} />
              </Panel>
            )}
          </div>
        </div>
      </div>
    </Screen>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "2026-10-18T…" → "18 Oct" — close enough for a list of what came last. */
function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * The shared-id groups, one block per package id and one line per listing.
 *
 * The old rendering ran every listing into one wrapped sentence with its slug,
 * version and file count in brackets — twenty of those in a row were a wall.
 * Here each listing has its own line with the facts in the same columns, and
 * everything past the first few groups folds behind a native disclosure: the
 * count is in the head, the detail is there when wanted.
 */
function DuplicateGroups({
  groups,
}: {
  groups: { packageName: string; apps: StoreApp[] }[];
}) {
  const shown = groups.slice(0, DUPLICATES_SHOWN);
  const folded = groups.slice(DUPLICATES_SHOWN);
  return (
    <div className="divide-y divide-[color:var(--border)]">
      {shown.map((group) => (
        <DuplicateGroup key={group.packageName} group={group} />
      ))}
      {folded.length > 0 && (
        <details className="group">
          <summary
            className={cn(
              "flex cursor-pointer select-none items-center justify-between gap-2 px-4 py-2.5 text-xs font-medium",
              "text-[color:var(--muted-2)] hover:bg-[var(--card-2)] [&::-webkit-details-marker]:hidden"
            )}
          >
            <span>
              <span className="group-open:hidden">
                Show {plural(folded.length, "more package id")}
              </span>
              <span className="hidden group-open:inline">Show fewer</span>
            </span>
            <ChevronDown
              size={14}
              className="transition-transform group-open:rotate-180"
            />
          </summary>
          <div className="divide-y divide-[color:var(--border)] border-t border-[color:var(--border)]">
            {folded.map((group) => (
              <DuplicateGroup key={group.packageName} group={group} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function DuplicateGroup({
  group,
}: {
  group: { packageName: string; apps: StoreApp[] };
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <code className={cn("min-w-0 truncate text-[11px]", MUTED)}>
          {group.packageName}
        </code>
        <Pill>{plural(group.apps.length, "listing")}</Pill>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {group.apps.map((app) => (
          <li key={app.slug} className="flex items-center gap-2.5">
            <Thumb
              seed={app.seed}
              src={app.icon}
              background={app.iconBackground}
              fit={app.iconFit}
              alt=""
              className="h-7 w-7 shrink-0 rounded-[var(--radius-sm)]"
            />
            <Link
              href={`/app/${app.slug}`}
              className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
            >
              {app.name}
            </Link>
            <span className={cn("shrink-0 text-xs tabular-nums", MUTED)}>
              {app.version === "—" || !app.version ? "no file" : app.version}
              {" · "}
              {plural(app.versions.length, "file")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The apps that are not known to be current, one row each: what the library
 * holds against what upstream calls its newest, and why it was not fetched.
 *
 * Under them, the Play apps somebody has taken off the comparison, each with
 * the button that puts it back — a decision the check honours should stay in
 * view where it was made, or the card quietly stops counting an app.
 */
function BehindRows({
  behind,
  failed,
  untracked,
  report,
  bySlug,
}: {
  behind: SourceCheck[];
  failed: SourceCheck[];
  untracked: StoreApp[];
  report: { at: string; checked: number; fetched: boolean } | null;
  bySlug: Map<string, StoreApp>;
}) {
  const foot =
    untracked.length > 0 ? (
      <div className="border-t border-[color:var(--border)] px-4 py-3">
        <p className={cn("text-xs", MUTED)}>
          Not compared with Play &mdash; modified builds:
        </p>
        <ul className="mt-1 flex flex-col">
          {untracked.map((app) => (
            <li key={app.slug} className="flex items-center gap-2 py-1">
              <Link
                href={`/app/${app.slug}`}
                className="min-w-0 flex-1 truncate text-sm hover:underline"
              >
                {app.name}
              </Link>
              <span className={cn("shrink-0 text-xs tabular-nums", MUTED)}>
                holds {app.versions[0]?.version ?? "nothing"}
              </span>
              <TrackUpstreamButton slug={app.slug} name={app.name} track />
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  if (!report) {
    return (
      <>
        <p className={cn("px-4 py-4 text-sm", MUTED)}>
          No check has run yet. The timer runs one every six hours, or ask for
          one in the Sources card above.
        </p>
        {foot}
      </>
    );
  }
  if (behind.length === 0 && failed.length === 0) {
    return (
      <>
        <p className={cn("px-4 py-4 text-sm", MUTED)}>
          Everything the check could reach is current &mdash;{" "}
          {plural(report.checked, "app")} checked {relativeTime(report.at)}
          {report.fetched ? "" : ", without fetching"}.
        </p>
        {foot}
      </>
    );
  }
  return (
    <>
      <ul className="divide-y divide-[color:var(--border)]">
        {[...behind, ...failed].map((check) => {
          const app = bySlug.get(check.slug);
          return (
            <li key={check.slug} className="flex items-start gap-3 px-4 py-2.5">
              {app ? (
                <Link href={`/app/${app.slug}`} className="shrink-0">
                  <Thumb
                    seed={app.seed}
                    src={app.icon}
                    background={app.iconBackground}
                    fit={app.iconFit}
                    alt={app.name}
                    className="h-10 w-10 rounded-[var(--radius-sm)]"
                  />
                </Link>
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/app/${check.slug}`}
                    className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                  >
                    {check.name}
                  </Link>
                  <Pill
                    tone={
                      check.status === "error"
                        ? "danger"
                        : check.refused
                          ? "warn"
                          : "accent"
                    }
                  >
                    {check.status === "error"
                      ? "check failed"
                      : check.refused
                        ? "refused"
                        : check.status === "behind"
                          ? "newer on Play"
                          : "newer upstream"}
                  </Pill>
                  {check.kind === "play" && check.status !== "error" && (
                    <TrackUpstreamButton
                      slug={check.slug}
                      name={check.name}
                      track={false}
                    />
                  )}
                </div>
                <span className={cn("block truncate text-xs tabular-nums", MUTED)}>
                  {[
                    check.kind,
                    `holds ${check.held ?? "nothing"}`,
                    check.upstream && `upstream ${check.upstream}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {check.detail ? (
                  <span
                    className={cn("mt-0.5 block truncate text-xs", MUTED)}
                    title={check.detail}
                  >
                    {check.detail}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {foot}
    </>
  );
}

/** The newest listings, each with a way straight into its edit form. */
function RecentRows({ apps }: { apps: StoreApp[] }) {
  return (
    <ul className="divide-y divide-[color:var(--border)]">
      {apps.map((app) => (
        <li key={app.slug} className="flex items-center gap-3 px-4 py-2.5">
          <Link href={`/app/${app.slug}`} className="shrink-0">
            <Thumb
              seed={app.seed}
              src={app.icon}
              background={app.iconBackground}
              fit={app.iconFit}
              alt={app.name}
              className="h-10 w-10 rounded-[var(--radius-sm)]"
            />
          </Link>
          <Link href={`/app/${app.slug}`} className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{app.name}</span>
            <span className={cn("block truncate text-xs", MUTED)}>
              {[
                app.version && app.version !== "—" ? app.version : "no file yet",
                app.source?.kind,
                shortDate(app.added),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </Link>
          <Link
            href={`/app/${app.slug}`}
            className={buttonClass("secondary", "sm")}
          >
            Edit
          </Link>
        </li>
      ))}
    </ul>
  );
}
