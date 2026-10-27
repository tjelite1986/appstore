import Link from "next/link";
import {
  Bookmark,
  ChevronRight,
  LogIn,
  PackageCheck,
  Puzzle,
  RotateCw,
  Search,
  Settings,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Screen } from "@/components/screen";
import SignOutButton from "@/components/sign-out-button";
import { MUTED } from "@/components/primitives";
import { cn } from "@/lib/utils";
import { currentUser } from "@/lib/current-user";
import { installedApps, savedApps, updatableApps } from "@/lib/user-state";

export const dynamic = "force-dynamic";

/**
 * Menu: the store's own destinations that do not earn a tab. Round shortcuts
 * across the top for the four a person uses most, then plain rows for the
 * rest, grouped and divided the way a phone's settings list is.
 *
 * Counts are this account's: a signed-out visitor sees the shortcuts with no
 * numbers on them rather than someone else's.
 */
export default async function MenuPage() {
  const user = await currentUser();
  const userId = user?.id ?? null;
  const [pending, installed, saved] = await Promise.all([
    updatableApps(userId),
    installedApps(userId),
    savedApps(userId),
  ]);

  const shortcuts: Shortcut[] = [
    { href: "/updates#installed", label: "My apps", Icon: PackageCheck, count: installed.length, quiet: true },
    { href: "/updates", label: "Updates", Icon: RotateCw, count: pending.length },
    { href: "/saved", label: "Saved", Icon: Bookmark, count: saved.length, quiet: true },
    { href: "/mods", label: "Game Mods", Icon: Puzzle },
  ];

  return (
    <Screen>
      <div className="px-[var(--pad)]">
        <h1 className="text-[28px] font-bold tracking-tight">Menu</h1>
      </div>

      <div className="grid grid-cols-4 gap-2 px-[var(--pad)]">
        {shortcuts.map((s) => (
          <ShortcutButton key={s.href} {...s} />
        ))}
      </div>

      <Rows>
        <Row href="/search" label="Search" Icon={Search} />
        <Row href="/settings" label="Settings" Icon={Settings} />
        {user?.role === "admin" && (
          <Row href="/manage" label="Manage the store" Icon={Wrench} />
        )}
      </Rows>

      <div className="mx-[var(--pad)] rounded-[var(--radius-lg)] bg-[var(--card)] px-4 py-4">
        {user ? (
          <div className="flex items-center gap-3">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold uppercase"
              style={{ backgroundImage: "linear-gradient(135deg, #3d8bff, #7b4dff)" }}
            >
              {user.email[0]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{user.email}</span>
              <span className={cn("block text-xs capitalize", MUTED)}>{user.role}</span>
            </span>
            <SignOutButton />
          </div>
        ) : (
          <Link href="/login?next=%2Fmenu" className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--pill)]">
              <LogIn size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Sign in</span>
              <span className={cn("block text-xs", MUTED)}>
                Track updates, keep apps for later
              </span>
            </span>
            <ChevronRight size={20} className={MUTED} />
          </Link>
        )}
      </div>
    </Screen>
  );
}

type Shortcut = {
  href: string;
  label: string;
  Icon: LucideIcon;
  count?: number;
  /** A count that is a size, not a call to action: grey rather than orange. */
  quiet?: boolean;
};

function ShortcutButton({ href, label, Icon, count = 0, quiet = false }: Shortcut) {
  return (
    <Link href={href} className="group flex flex-col items-center gap-2 text-center">
      <span className="relative flex h-[60px] w-[60px] items-center justify-center rounded-full bg-[var(--pill)] transition group-hover:bg-[var(--pill-hover)]">
        <Icon size={25} strokeWidth={1.9} />
        {count > 0 && (
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white",
              quiet ? "bg-[#4a4a50]" : "bg-[#ff6a1a]"
            )}
          >
            {count}
          </span>
        )}
      </span>
      <span className="text-xs leading-tight">{label}</span>
    </Link>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-[var(--pad)] divide-y divide-[color:var(--border)] overflow-hidden rounded-[var(--radius-lg)] bg-[var(--card)]">
      {children}
    </div>
  );
}

function Row({ href, label, Icon }: { href: string; label: string; Icon: LucideIcon }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 px-4 py-3.5 text-[15px] transition hover:bg-[var(--card-2)]"
    >
      <Icon size={21} strokeWidth={1.9} className="text-[color:var(--muted-2)]" />
      <span className="flex-1">{label}</span>
      <ChevronRight size={18} className={MUTED} />
    </Link>
  );
}
