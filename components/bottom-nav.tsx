"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gamepad2, Home, LayoutGrid, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A floating bar: a rounded, blurred dock lifted off the bottom edge, the
 * active tab sitting in a darker pill of its own.
 *
 * Four tabs. Search moved to the header, where it is reachable from every
 * screen; Updates, Saved, Game Mods, Manage and Settings are on the Menu
 * screen, so the Menu tab carries the update count the Updates tab used to.
 */
const TABS = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/games", label: "Games", Icon: Gamepad2 },
  { href: "/apps", label: "Apps", Icon: LayoutGrid },
  { href: "/menu", label: "Menu", Icon: Menu },
];

/** Routes reached from the Menu screen light up the Menu tab. */
const MENU_ROUTES = ["/menu", "/updates", "/saved", "/mods", "/manage", "/settings"];

/** `pending` is counted in the layout — this bar runs on the client. */
export default function BottomNav({ pending = 0 }: { pending?: number }) {
  const pathname = usePathname();

  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto flex w-full max-w-[22rem] gap-1 rounded-full border border-white/[0.06] bg-[var(--dock)] p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.6)] backdrop-blur-xl">
        {TABS.map(({ href, label, Icon }) => {
          // "/" must match exactly or every route lights up Home.
          const on =
            href === "/"
              ? pathname === "/"
              : href === "/menu"
                ? MENU_ROUTES.some((r) => pathname.startsWith(r))
                : pathname.startsWith(href);
          const badge = href === "/menu" && pending > 0;
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? "page" : undefined}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-0.5 rounded-full py-2 text-[11px] transition",
                on
                  ? "bg-white/[0.11] font-semibold text-white"
                  : "text-white/70 hover:text-white"
              )}
            >
              <span className="relative">
                <Icon size={22} strokeWidth={on ? 2.3 : 1.9} />
                {badge && (
                  <span className="absolute -right-2.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#ff6a1a] px-1 text-[10px] font-bold text-white">
                    {pending}
                  </span>
                )}
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
