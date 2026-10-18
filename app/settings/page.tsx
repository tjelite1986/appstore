import Link from "next/link";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ArrowUpRight,
  FolderInput,
  HardDrive,
  Layers,
  ShieldCheck,
  Store,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { Screen, ScreenTitle } from "@/components/screen";
import { MUTED, NOTE, Panel, Pill } from "@/components/primitives";
import AccountCard from "@/components/account-card";
import AdultsToggle from "@/components/adults-toggle";
import RepoUrl from "@/components/repo-url";
import { STORE_HOST_ROOT } from "@/lib/storage";
import { currentUser } from "@/lib/current-user";
import { adultsAllowed, readState, updatableApps } from "@/lib/user-state";
import { getCatalog, pendingImports, withoutAdults } from "@/lib/store";
import { repoTokenFor } from "@/lib/repo-token";
import { repoFingerprint, repoSignedAt } from "@/lib/fdroid-published";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Settings: the account, the one content preference, and the phone.
 *
 * An admin gets a fourth card about the store itself — the numbers an owner
 * glances at to know the thing is alive, and the way into Manage. The old
 * Appearance rows (Theme, Accent, Background) were links to this same page
 * with nothing behind them; the theme is a build-time constant in
 * `lib/theme.ts`, and a row that cannot be changed is not a setting.
 */
export default async function SettingsPage() {
  const user = await currentUser();
  const state = user ? readState(user.id) : null;
  const [updates, fingerprint, signedAt] = await Promise.all([
    user ? updatableApps(user.id) : Promise.resolve([]),
    repoFingerprint(),
    repoSignedAt(),
  ]);
  // Signed out there is no account to put in the path, so the URL offered is
  // the open one — the same shelf a signed-out browser gets, Adults excluded.
  const repoPath = user
    ? `/fdroid/t/${repoTokenFor(user.id)}/repo`
    : "/fdroid/repo";

  return (
    <Screen>
      <ScreenTitle
        title="Settings"
        subtitle={user ? "Your account, and how the phone reaches this store" : "How the phone reaches this store"}
      />

      <div className="flex flex-col gap-[var(--gap)] px-[var(--pad)]">
        <AccountCard
          user={user}
          saved={state?.saved.size ?? 0}
          installed={state?.installed.size ?? 0}
          updates={updates.length}
        />

        <div className="grid gap-[var(--gap)] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
          <RepoUrl
            path={repoPath}
            signedIn={!!user}
            fingerprint={fingerprint}
            baseUrl={process.env.FDROID_PUBLIC_URL?.trim() || undefined}
          />

          <div className="flex min-w-0 flex-col gap-[var(--gap)]">
            <AdultsToggle on={adultsAllowed(user?.id ?? null)} signedIn={!!user} />

            {user?.role === "admin" && (
              <StorePanel
                fingerprint={fingerprint}
                signedAt={signedAt}
                adults={adultsAllowed(user.id)}
              />
            )}
          </div>
        </div>
      </div>
    </Screen>
  );
}

/**
 * The store at a glance, for whoever runs it. Facts only — every action lives
 * on Manage, which the head links to.
 */
async function StorePanel({
  fingerprint,
  signedAt,
  adults,
}: {
  fingerprint: string | null;
  signedAt: string | null;
  /** The gate applies here as on Manage, so the two screens count alike. */
  adults: boolean;
}) {
  const [{ apps: all, placeholder }, waiting] = await Promise.all([
    getCatalog(),
    pendingImports(),
  ]);
  const apps = adults ? all : withoutAdults(all);
  const files = apps.reduce(
    (n, a) => n + a.versions.reduce((m, v) => m + v.files.length, 0),
    0
  );
  return (
    <Panel
      icon={Store}
      title="This store"
      aside={
        <Link
          href="/manage"
          className="flex items-center gap-1 text-xs text-[color:var(--accent-text)] hover:underline"
        >
          Manage <ArrowUpRight size={13} />
        </Link>
      }
      description="What the library holds and whether the signed index is current. Shown to admins only."
      flush
    >
      <ul className="divide-y divide-[color:var(--border)]">
        <Fact
          Icon={Layers}
          label="Catalog"
          value={
            placeholder
              ? "placeholder"
              : `${apps.length} ${apps.length === 1 ? "app" : "apps"}`
          }
          note={placeholder ? "the library could not be read" : `${files} ${files === 1 ? "file" : "files"} on disk`}
        />
        <Fact
          Icon={FolderInput}
          label="Import folder"
          value={waiting === 0 ? "empty" : `${waiting} waiting`}
          tone={waiting > 0 ? "accent" : undefined}
          note="files dropped on the host, not yet scanned"
        />
        <Fact
          Icon={ShieldCheck}
          label="Signed index"
          value={fingerprint ? "signed" : "not yet"}
          tone={fingerprint ? "ok" : "warn"}
          note={
            signedAt
              ? `last signed ${new Date(signedAt).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}`
              : "the signing job has not run; F-Droid clients cannot subscribe yet"
          }
        />
        <Fact
          Icon={HardDrive}
          label="Library"
          value={STORE_HOST_ROOT}
          mono
          note="on the host — the import folder is _import/ inside it"
        />
        <Fact Icon={Tag} label="Build" value={buildId()} mono note="what the installed app compares against to reload itself" />
      </ul>
    </Panel>
  );
}

function Fact({
  Icon,
  label,
  value,
  note,
  tone,
  mono = false,
}: {
  Icon: LucideIcon;
  label: string;
  value: string;
  note?: string;
  tone?: "accent" | "ok" | "warn";
  mono?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Icon size={16} className="shrink-0 text-[color:var(--muted-2)]" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {note ? <span className={cn("block", NOTE)}>{note}</span> : null}
      </span>
      {tone ? (
        <Pill tone={tone}>{value}</Pill>
      ) : (
        <span
          className={cn(
            "max-w-[50%] shrink-0 text-right text-xs",
            mono ? "break-all font-mono" : "truncate",
            MUTED
          )}
          title={value}
        >
          {value}
        </span>
      )}
    </li>
  );
}

/** The same opaque id `/api/version` serves; "dev" outside a build. */
function buildId(): string {
  try {
    return readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8")
      .trim()
      .slice(0, 12);
  } catch {
    return "dev";
  }
}
