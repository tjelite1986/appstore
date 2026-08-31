"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  Bookmark,
  Gamepad2,
  Home,
  LayoutDashboard,
  Menu,
  PackageCheck,
  Search,
  Settings,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MUTED } from "@/components/primitives";
import { useBackDismiss } from "@/lib/use-back-dismiss";

/**
 * The sketch's `bottom-nav`: five tabs, `variant: "indicator"` (the active tab
 * sits in an accent-tinted pill rather than just changing colour), blurred bar,
 * labels on, and a count badge over Updates.
 */
const TABS = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/apps", label: "Apps", Icon: LayoutDashboard },
  { href: "/games", label: "Games", Icon: Gamepad2 },
  { href: "/search", label: "Search", Icon: Search },
  { href: "/updates", label: "Updates", Icon: PackageCheck },
];

/**
 * The sixth button: this store's own destinations, the ones that do not earn a
 * tab. It used to hand the whole press over to the site the store is mounted
 * in — `?menu=1` opened that app's menu, which meant leaving the store to
 * reach a page inside it. The store now draws its own sheet, and the way back
 * to that site is one row in it rather than the whole button.
 */
const MENU_LINKS = [
  { href: "/saved", label: "Saved", Icon: Bookmark },
  { href: "/manage", label: "Manage", Icon: Wrench },
  { href: "/settings", label: "Settings", Icon: Settings },
];

/** `pending` is counted in the layout — this bar runs on the client. */
export default function BottomNav({
  pending = 0,
  parentUrl,
  email,
}: {
  pending?: number;
  /** The site this store is a section of, when it is one. */
  parentUrl?: string;
  /** Who is signed in, shown at the head of the sheet. */
  email?: string;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the sheet when one of its links has navigated away.
  useEffect(() => setMenuOpen(false), [pathname]);
  useBackDismiss(menuOpen, () => setMenuOpen(false));

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[color:var(--border)] bg-[var(--bar)] backdrop-blur">
        <div className="mx-auto flex max-w-5xl pb-[env(safe-area-inset-bottom)]">
          {TABS.map(({ href, label, Icon }) => {
            // "/" must match exactly or every route lights up Home.
            const on =
              !menuOpen &&
              (href === "/" ? pathname === "/" : pathname.startsWith(href));
            const badge = href === "/updates" && pending > 0;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "relative mx-1 my-1 flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px] transition",
                  on
                    ? "bg-[var(--accent-soft)] text-[color:var(--accent-text)]"
                    : MUTED
                )}
              >
                <span className="relative">
                  <Icon size={22} strokeWidth={on ? 2.4 : 2} />
                  {badge && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                      {pending}
                    </span>
                  )}
                </span>
                {label}
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className={cn(
              "relative mx-1 my-1 flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px] transition",
              menuOpen
                ? "bg-[var(--accent-soft)] text-[color:var(--accent-text)]"
                : MUTED
            )}
          >
            <span className="relative">
              <Menu size={22} strokeWidth={menuOpen ? 2.4 : 2} />
            </span>
            Menu
          </button>
        </div>
      </nav>

      {menuOpen && (
        // Above the bar and the top bar, both z-30, so the sheet covers them.
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="rounded-t-[var(--radius-lg)] border-t border-[color:var(--border)] bg-[var(--menu)] pb-[env(safe-area-inset-bottom)] text-[color:var(--fg)] backdrop-blur"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex max-w-5xl items-center justify-between border-b border-[color:var(--border)] px-4 py-3">
              {/* Signed out this stays a statement of fact rather than a name:
                  the store is browsable by anyone. */}
              <span className="min-w-0 truncate text-sm font-semibold">
                {email ?? "Not signed in"}
              </span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                className={cn("rounded-[var(--radius-sm)] p-1 transition hover:bg-[var(--card-2)]", MUTED)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="mx-auto max-w-5xl py-1">
              {MENU_LINKS.map(({ href, label, Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 px-5 py-3 text-sm transition hover:bg-[var(--card-2)]"
                >
                  <Icon size={18} className="text-[color:var(--muted-2)]" />
                  {label}
                </Link>
              ))}
              {parentUrl && (
                <>
                  <div className="my-1 border-t border-[color:var(--border)]" />
                  {/* A plain <a>: that address is not one of this app's routes,
                      so asking the router to resolve it would 404 here before
                      the browser ever left. */}
                  <a
                    href={parentUrl}
                    className="flex items-center gap-3 px-5 py-3 text-sm transition hover:bg-[var(--card-2)]"
                  >
                    <ArrowLeft
                      size={18}
                      className="text-[color:var(--muted-2)]"
                    />
                    Back to Elite
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
