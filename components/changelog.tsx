import { cn } from "@/lib/utils";
import { MUTED } from "@/components/primitives";

/**
 * The sketch's `changelog`, with `showRail: false` — no timeline rail, just
 * version pill, date and summary. The newest entry carries the accent.
 * Entries come in as "version | date | summary".
 */
export default function Changelog({
  title,
  items,
}: {
  title?: string;
  items: string[];
}) {
  return (
    <section className="px-[var(--pad)]">
      {title ? (
        <h2 className="mb-3 text-sm font-semibold text-[color:var(--muted-2)]">
          {title}
        </h2>
      ) : null}
      <div className="flex flex-col gap-4">
        {items.map((raw, i) => {
          const [version, date, summary] = raw.split("|").map((s) => s.trim());
          return (
            <div key={raw}>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-mono text-[10px]",
                    i === 0
                      ? "bg-[var(--accent)] text-white"
                      : cn("bg-[var(--card-2)]", MUTED)
                  )}
                >
                  {version}
                </span>
                <span className={cn("text-[11px]", MUTED)}>{date}</span>
              </div>
              <p className="mt-1 text-sm text-[color:var(--muted-2)]">
                {summary}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
