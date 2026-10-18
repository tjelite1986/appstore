import Link from "next/link";
import { Bookmark, LogIn, PackageCheck, PackageOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD, MUTED, NOTE, Pill, buttonClass } from "@/components/primitives";
import ForgetStateButton from "@/components/forget-state-button";
import SignOutButton from "@/components/sign-out-button";
import type { StoreUser } from "@/lib/auth";

/**
 * Who is signed in, what the store keeps about them, and the two things they
 * can do about it. Signed out, the same card says what signing in is for.
 *
 * The avatar is the top bar's, drawn large: same gradient, same initial, so
 * the small one up there reads as a handle to this card.
 */
export default function AccountCard({
  user,
  saved,
  installed,
  updates,
}: {
  user: StoreUser | null;
  saved: number;
  installed: number;
  updates: number;
}) {
  if (!user) {
    return (
      <section className={cn(CARD, "flex flex-col gap-4 p-4 sm:flex-row sm:items-center")}>
        <Avatar initial="–" muted />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Not signed in</p>
          <p className={cn("mt-0.5", NOTE)}>
            The shelf is open to anyone. Signing in adds a saved list, an
            installed list with update checks, and a repository URL of your
            own for the phone.
          </p>
        </div>
        <Link
          href="/login?next=/settings"
          className={cn(buttonClass("primary", "sm"), "self-start sm:self-center")}
        >
          <LogIn size={13} /> Sign in
        </Link>
      </section>
    );
  }

  const kept = saved + installed;
  return (
    <section className={cn(CARD, "overflow-hidden")}>
      <div className="flex items-center gap-4 p-4">
        <Avatar initial={user.email[0]} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="min-w-0 truncate text-sm font-semibold">{user.email}</p>
            <Pill tone={user.role === "admin" ? "accent" : "neutral"}>
              {user.role === "admin" ? "Admin" : "Member"}
            </Pill>
          </div>
          <p className={cn("mt-0.5 text-xs", MUTED)}>
            {kept === 0
              ? "Nothing kept yet — save an app or mark one installed."
              : `${kept} ${kept === 1 ? "entry" : "entries"} kept in this store`}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-3 divide-x divide-[color:var(--border)] border-t border-[color:var(--border)]">
        <Figure href="/saved" Icon={Bookmark} label="Saved" value={saved} />
        <Figure href="/updates" Icon={PackageCheck} label="Installed" value={installed} />
        <Figure
          href="/updates"
          Icon={PackageOpen}
          label="Updates"
          value={updates}
          accent={updates > 0}
        />
      </dl>

      <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--border)] px-4 py-3">
        <SignOutButton />
        <ForgetStateButton count={kept} />
      </div>
    </section>
  );
}

function Avatar({ initial, muted = false }: { initial: string; muted?: boolean }) {
  return (
    <span
      aria-hidden
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl font-semibold uppercase text-white/90"
      style={{
        backgroundImage: muted
          ? "linear-gradient(135deg, hsl(266 10% 34% / 0.9), hsl(266 10% 22% / 0.9))"
          : "linear-gradient(135deg, hsl(266 45% 42% / 0.9), hsl(314 45% 24% / 0.9))",
      }}
    >
      {initial}
    </span>
  );
}

function Figure({
  href,
  Icon,
  label,
  value,
  accent = false,
}: {
  href: string;
  Icon: typeof Bookmark;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex min-w-0 flex-col items-center gap-0.5 px-2 py-3 text-center transition hover:bg-[var(--card-2)]"
    >
      <dt className={cn("flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide", MUTED)}>
        <Icon size={12} /> {label}
      </dt>
      <dd
        className={cn(
          "text-lg font-semibold tabular-nums leading-tight",
          accent && "text-[color:var(--accent-text)]"
        )}
      >
        {value}
      </dd>
    </Link>
  );
}
