/**
 * The variants of one app, and what choosing between them costs.
 *
 * Some apps arrive on this shelf several times over: five Instagram mods, each
 * a real build with its own package id, its own signer and its own reason to
 * exist. The shelf shows the family as one card (see `family` in
 * `lib/store.ts`) and this is what is behind it — the picker, on every
 * member's page, with the one being read marked.
 *
 * The line under each name is the fact a person cannot get anywhere else and
 * will find out the hard way otherwise: two builds carrying the same package
 * id cannot both be installed, so choosing one means giving up the other.
 * Android answers that with a failed install and no explanation, which is a
 * bad place to learn it.
 *
 * No client state — every row is a link, and the marked row is the page you
 * are on.
 */
import Link from "next/link";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, CARD, MUTED, SectionTitle, Thumb } from "@/components/primitives";

export type FamilyMember = {
  slug: string;
  name: string;
  version: string;
  packageName?: string;
  icon?: string;
  iconBackground?: string;
  iconFit?: "cover" | "contain";
  seed: number;
  /** The newest build's download link, or nothing when there is no file. */
  href?: string;
  /** Names of the other members this one cannot be installed beside. */
  replaces: string[];
};

export default function AppFamily({
  members,
  current,
  familyName,
}: {
  members: FamilyMember[];
  current: string;
  familyName: string;
}) {
  if (members.length < 2) return null;

  return (
    <section className="px-[var(--pad)]">
      {/* Not "4 apps": they are one app four people rebuilt, which is the
          whole reason the shelf shows them under one card. No `action` — that
          renders an arrow, and this heading leads nowhere. */}
      <SectionTitle title={`${familyName} — ${members.length} builds`} />
      <div className={cn(CARD, "overflow-hidden")}>
        {members.map((m, i) => {
          const here = m.slug === current;
          return (
            <div
              key={m.slug}
              className={cn(
                "flex items-center gap-3 px-3.5 py-3",
                i > 0 && "border-t border-[color:var(--border)]",
                here && "bg-white/[0.03]"
              )}
            >
              <Link href={`/app/${m.slug}`} className="shrink-0">
                <Thumb
                  seed={m.seed}
                  src={m.icon}
                  background={m.iconBackground}
                  fit={m.iconFit}
                  alt={m.name}
                  className="h-10 w-10 rounded-[calc(var(--radius)/1.6)] border border-[color:var(--border)]"
                />
              </Link>
              <Link href={`/app/${m.slug}`} className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{m.name}</span>
                  {here && (
                    <span className={cn("shrink-0 text-[11px]", MUTED)}>
                      · you are here
                    </span>
                  )}
                </span>
                <span className={cn("block truncate text-xs", MUTED)}>
                  {/* Version first, because it is the reason someone scrolled
                      here; the conflict second, because it is the reason they
                      will scroll back. */}
                  {m.version}
                  {m.replaces.length > 0
                    ? ` · replaces ${m.replaces.join(", ")}`
                    : " · installs alongside the others"}
                </span>
              </Link>
              {m.href ? (
                <a href={m.href} className="shrink-0">
                  <Button size="sm" variant={here ? "primary" : "secondary"}>
                    <Download size={13} /> Install
                  </Button>
                </a>
              ) : (
                <Button size="sm" variant="ghost" className="shrink-0">
                  No file
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
