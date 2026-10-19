import Link from "next/link";
import {
  CarFront,
  Clapperboard,
  Compass,
  Crown,
  Dices,
  Gamepad2,
  Images,
  Joystick,
  MessageSquare,
  Package,
  Plane,
  Puzzle,
  Shield,
  Smile,
  Spade,
  Store,
  Swords,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { SectionTitle } from "@/components/primitives";
import { categoryTiles, type CategoryKind } from "@/lib/store";
import { categoryLabel, categorySlug } from "@/lib/categories";

/** The icon names the sketch writes on each quick-link item. */
const ICONS: Record<string, LucideIcon> = {
  images: Images,
  clapperboard: Clapperboard,
  users: Users,
  message: MessageSquare,
  store: Store,
  package: Package,
  swords: Swords,
  compass: Compass,
  joystick: Joystick,
  dices: Dices,
  spade: Spade,
  smile: Smile,
  puzzle: Puzzle,
  car: CarFront,
  shield: Shield,
  plane: Plane,
  trophy: Trophy,
  crown: Crown,
  gamepad: Gamepad2,
};

/**
 * The sketch's `quick-links`: icon tiles in a 3-column grid that jump into a
 * category.
 */
export default async function QuickLinks({
  title,
  adults = false,
  kind = "app",
}: {
  title: string;
  /** Whether this viewer has passed the 18+ gate — see `lib/user-state.ts`. */
  adults?: boolean;
  /** App shelves or game shelves; the Games screen asks for the second. */
  kind?: CategoryKind;
}) {
  const categories = await categoryTiles({ adults, kind });
  if (categories.length === 0) return null;

  return (
    <section className="px-[var(--pad)]">
      <SectionTitle title={title} />
      <div className="grid grid-cols-3 gap-[var(--gap)]">
        {categories.map(({ label, icon }) => {
          const Icon = ICONS[icon] ?? Store;
          return (
            <Link
              key={label}
              href={`/category/${categorySlug(label)}`}
              className="flex flex-col items-center gap-2 rounded-[var(--radius)] bg-[var(--card)] px-3 py-5 text-center transition hover:bg-[var(--card-2)]"
            >
              <Icon size={20} className="text-[color:var(--muted-2)]" />
              <span className="text-xs font-medium text-[color:var(--muted-2)]">
                {categoryLabel(label)}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
