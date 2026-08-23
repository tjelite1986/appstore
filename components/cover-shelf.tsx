import Link from "next/link";
import { cn } from "@/lib/utils";
import { MUTED, SectionTitle, Thumb } from "@/components/primitives";
import type { StoreApp } from "@/lib/store";

/**
 * The sketch's `album-shelf`: a grid of square covers with a title and a
 * subtitle under each.
 *
 * Columns diverge from the sketch on purpose. It asks for 6 (Recently Added)
 * and 4 (Communication); at 390px with roomy density that is a 40px cover, too
 * small to recognise an icon in. The sketch number is honoured as the widescreen
 * column count and the grid steps down on narrow screens.
 */
const COLUMN_CLASS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
  5: "grid-cols-3 sm:grid-cols-4 lg:grid-cols-5",
  6: "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6",
};

export default function CoverShelf({
  title,
  action,
  apps,
  columns = 4,
  sub = "category",
  rounded = true,
}: {
  title: string;
  action?: string;
  apps: StoreApp[];
  columns?: number;
  /** What the second line shows — the sketch sets it per shelf. */
  sub?: "category" | "developer";
  rounded?: boolean;
}) {
  return (
    <section className="px-[var(--pad)]">
      <SectionTitle title={title} action={action} />
      <div
        className={cn(
          "grid gap-[var(--gap)]",
          COLUMN_CLASS[columns] ?? COLUMN_CLASS[4]
        )}
      >
        {apps.map((app) => (
          <Link key={app.slug} href={`/app/${app.slug}`} className="min-w-0">
            <Thumb
              seed={app.seed}
              src={app.icon}
              alt={app.name}
              className={cn(
                "aspect-square w-full shadow-lg",
                rounded && "rounded-[var(--radius-sm)]"
              )}
            />
            <p className="mt-1.5 truncate text-xs font-medium">{app.name}</p>
            <p className={cn("truncate text-[11px]", MUTED)}>
              {sub === "developer" ? app.developer : app.category}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
