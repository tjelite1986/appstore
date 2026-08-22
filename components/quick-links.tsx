import Link from "next/link";
import {
  Clapperboard,
  Images,
  MessageSquare,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import { SectionTitle } from "@/components/primitives";
import { CATEGORIES } from "@/lib/catalog";

/** The icon names the sketch writes on each quick-link item. */
const ICONS: Record<string, LucideIcon> = {
  images: Images,
  clapperboard: Clapperboard,
  users: Users,
  message: MessageSquare,
  store: Store,
};

/**
 * The sketch's `quick-links`: icon tiles in a 3-column grid that jump into a
 * category.
 */
export default function QuickLinks({ title }: { title: string }) {
  return (
    <section className="px-[var(--pad)]">
      <SectionTitle title={title} />
      <div className="grid grid-cols-3 gap-[var(--gap)]">
        {CATEGORIES.map(({ label, icon }) => {
          const Icon = ICONS[icon] ?? Store;
          return (
            <Link
              key={label}
              href={`/category/${label.toLowerCase()}`}
              className="flex flex-col items-center gap-2 rounded-[var(--radius)] bg-[var(--card)] px-3 py-5 text-center transition hover:bg-[var(--card-2)]"
            >
              <Icon size={20} className="text-[color:var(--muted-2)]" />
              <span className="text-xs font-medium text-[color:var(--muted-2)]">
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
