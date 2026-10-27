"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The header: the store's name as a wordmark on the left, search and the
 * account on the right, over a translucent black bar that blurs what scrolls
 * under it.
 *
 * Manage, Saved and Settings used to sit here as three small icons. They live
 * on the Menu screen now, with the rest of this store's own destinations, so
 * the header stays the two things people reach for from anywhere.
 */
export default function TopBar({ email }: { email?: string }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 bg-[var(--bar)] pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-[var(--pad)] py-2.5">
        <Link
          href="/"
          aria-label="App Store home"
          className="min-w-0 flex-1 truncate text-[25px] font-bold leading-none tracking-tight"
        >
          App Store
        </Link>

        <Link
          href="/search"
          aria-label="Search"
          title="Search"
          className={cn(
            "-mr-0.5 rounded-full p-2 transition hover:bg-[var(--card-2)]",
            pathname.startsWith("/search") && "bg-[var(--card-2)]"
          )}
        >
          <Search size={23} strokeWidth={2.1} />
        </Link>

        {/* Signed out it stays a dash rather than someone's initial — the
            store is browsable by anyone, and a letter there would be a claim
            about who is looking — and leads to the sign-in page. */}
        <Link
          href={email ? "/menu" : `/login?next=${encodeURIComponent(pathname)}`}
          title={email ?? "Not signed in"}
          aria-label={email ? `Signed in as ${email}` : "Not signed in"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold uppercase text-white"
          style={{
            backgroundImage: email
              ? "linear-gradient(135deg, #3d8bff, #7b4dff)"
              : "linear-gradient(135deg, #3a3a40, #26262a)",
          }}
        >
          {email ? email[0] : "–"}
        </Link>
      </div>
    </header>
  );
}
