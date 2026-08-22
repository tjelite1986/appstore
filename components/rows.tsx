import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD, MUTED, SectionTitle } from "@/components/primitives";

export type Row = {
  label: string;
  value?: string;
  Icon?: LucideIcon;
  href?: string;
  /** Renders a switch instead of a chevron. Cosmetic in this build. */
  toggle?: boolean;
  on?: boolean;
};

/** A settings-style card of labelled rows. */
export default function RowCard({
  title,
  rows,
}: {
  title?: string;
  rows: Row[];
}) {
  return (
    <section className="px-[var(--pad)]">
      {title ? <SectionTitle title={title} /> : null}
      <div className={cn(CARD, "overflow-hidden")}>
        {rows.map((row, i) => {
          const body = (
            <>
              {row.Icon ? (
                <row.Icon
                  size={17}
                  className="shrink-0 text-[color:var(--muted-2)]"
                />
              ) : null}
              <span className="min-w-0 flex-1 truncate text-sm">
                {row.label}
              </span>
              {row.value ? (
                <span className={cn("shrink-0 truncate text-xs", MUTED)}>
                  {row.value}
                </span>
              ) : null}
              {row.toggle ? (
                <span
                  className={cn(
                    "flex h-5 w-9 shrink-0 items-center rounded-full px-0.5",
                    row.on ? "bg-[var(--accent)]" : "bg-[var(--card-2)]"
                  )}
                >
                  <span
                    className={cn(
                      "h-4 w-4 rounded-full bg-white transition",
                      row.on && "translate-x-4"
                    )}
                  />
                </span>
              ) : row.href ? (
                <ChevronRight size={15} className="shrink-0 opacity-40" />
              ) : null}
            </>
          );

          const className = cn(
            "flex items-center gap-3 px-3.5 py-3",
            i > 0 && "border-t border-[color:var(--border)]"
          );

          return row.href ? (
            <Link key={row.label} href={row.href} className={className}>
              {body}
            </Link>
          ) : (
            <div key={row.label} className={className}>
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}
