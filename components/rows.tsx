import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD, MUTED, SectionTitle } from "@/components/primitives";

export type Row = {
  label: string;
  value?: string;
  Icon?: LucideIcon;
  href?: string;
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
              {row.href ? (
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
