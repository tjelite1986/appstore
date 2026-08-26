"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Gamepad2,
  Home,
  LayoutDashboard,
  Menu,
  PackageCheck,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MUTED } from "@/components/primitives";

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

/** `pending` is counted in the layout — this bar runs on the client. */
export default function BottomNav({
  pending = 0,
  parentUrl,
}: {
  pending?: number;
  /** The site this store is a section of, when it is one. */
  parentUrl?: string;
}) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[color:var(--border)] bg-[var(--bar)] backdrop-blur">
      <div className="mx-auto flex max-w-5xl pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ href, label, Icon }) => {
          // "/" must match exactly or every route lights up Home.
          const on = href === "/" ? pathname === "/" : pathname.startsWith(href);
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

        {/* The rest of the site. When the store is mounted as a section of
            another app, this bar is the only one a person sees — without this
            the store is a room with no door. The menu itself belongs to that
            app and is rendered by it, so the button asks it to open on
            arrival rather than reproducing it here, where it would be a copy
            to keep in step. A real navigation: that address is not ours. */}
        {parentUrl && (
          <a
            href={`${parentUrl}/?menu=1`}
            className={cn(
              "relative mx-1 my-1 flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px] transition",
              MUTED
            )}
          >
            <span className="relative">
              <Menu size={22} strokeWidth={2} />
            </span>
            Menu
          </a>
        )}
      </div>
    </nav>
  );
}
