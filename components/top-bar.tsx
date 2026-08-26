"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bookmark, CornerUpLeft, Home, Settings, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The sketch's `window-chrome` block: centred title, app icon on the left,
 * Manage / Saved / Settings plus an avatar on the right, compact, translucent
 * over the page (`solid: false`), no window controls.
 *
 * Icon note: the sketch names two Material Symbols (`ms.handyman` for Manage,
 * `ms.videogame_asset` and `ms.deployed_code_update` in the bottom nav). This
 * app ships lucide only — bundling a second icon font for three glyphs is not
 * worth a self-hosted font file — so the nearest lucide equivalents stand in.
 */
const ACTIONS = [
  { href: "/manage", label: "Manage", Icon: Wrench },
  { href: "/saved", label: "Saved", Icon: Bookmark },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export default function TopBar({
  email,
  parentUrl,
}: {
  email?: string;
  /** Where the login comes from — a link back, when one is configured. */
  parentUrl?: string;
}) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-[color:var(--border)] bg-[var(--bar)] backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-2.5 px-3 py-1.5">
        <Link
          href="/"
          aria-label="App Store home"
          className="flex h-[21px] w-[21px] shrink-0 items-center justify-center rounded-[6px]"
          style={{
            backgroundImage:
              "linear-gradient(135deg, color-mix(in srgb, var(--accent), transparent 40%), var(--card-2))",
          }}
        >
          <Home size={10} />
        </Link>

        {/* The store borrows its login from another app, so it is somewhere a
            person arrives *from*. This is the way back, and it is only drawn
            when ELITE_APP_URL says there is one. */}
        {parentUrl && (
          <a
            href={parentUrl}
            aria-label="Back to the app this login comes from"
            title="Back"
            className="shrink-0 rounded-[var(--radius-sm)] p-1 text-[color:var(--muted-2)] transition hover:bg-[var(--card-2)]"
          >
            <CornerUpLeft size={13} />
          </a>
        )}

        <span className="min-w-0 flex-1 text-center">
          <span className="block truncate text-[13px] font-semibold tracking-wide">
            APPSTORE
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-1.5">
          {ACTIONS.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              aria-label={label}
              title={label}
              className={cn(
                "rounded-[var(--radius-sm)] p-1 transition hover:bg-[var(--card-2)]",
                pathname === href
                  ? "text-[color:var(--fg)]"
                  : "text-[color:var(--muted-2)]"
              )}
            >
              <Icon size={13} />
            </Link>
          ))}
          {/* The sketch's avatar slot, now that there is an identity to put in
              it. Signed out it stays a dash rather than someone's initial —
              the store is browsable by anyone, and a letter there would be a
              claim about who is looking. */}
          <span
            title={email ?? "Not signed in"}
            aria-label={email ? `Signed in as ${email}` : "Not signed in"}
            className="ml-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full text-[9px] font-semibold uppercase text-white/90"
            style={{
              backgroundImage: email
                ? "linear-gradient(135deg, hsl(266 45% 42% / 0.9), hsl(314 45% 24% / 0.9))"
                : "linear-gradient(135deg, hsl(266 10% 34% / 0.9), hsl(266 10% 22% / 0.9))",
            }}
          >
            {email ? email[0] : "\u2013"}
          </span>
        </span>
      </div>
    </header>
  );
}
