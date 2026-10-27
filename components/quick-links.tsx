import Link from "next/link";
import {
  CarFront,
  Clapperboard,
  Compass,
  Crown,
  Dices,
  Briefcase,
  Gamepad2,
  GraduationCap,
  HeartPulse,
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
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { SectionTitle } from "@/components/primitives";
import { categoryTiles, type CategoryKind } from "@/lib/store";
import { categoryLabel, categorySlug } from "@/lib/categories";

/** The icon names the sketch writes on each quick-link item. */
export const ICONS: Record<string, LucideIcon> = {
  images: Images,
  clapperboard: Clapperboard,
  users: Users,
  message: MessageSquare,
  store: Store,
  briefcase: Briefcase,
  wrench: Wrench,
  graduation: GraduationCap,
  heart: HeartPulse,
  wallet: Wallet,
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
 * Category tiles: icon over label in a four-column panel divided by hairlines,
 * each tile a jump into its category.
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
  // Fill the last row with blank cells so the hairline grid stays a grid.
  const blanks = (4 - (categories.length % 4)) % 4;

  return (
    <section className="px-[var(--pad)]">
      <SectionTitle title={title} />
      <div className="grid grid-cols-4 gap-px overflow-hidden rounded-[var(--radius-lg)] bg-[#2a2a2e]">
        {categories.map(({ label, icon }) => {
          const Icon = ICONS[icon] ?? Store;
          return (
            <Link
              key={label}
              href={`/category/${categorySlug(label)}`}
              className="flex min-h-[92px] flex-col items-center justify-center gap-2 bg-[var(--card)] px-0.5 py-4 text-center transition hover:bg-[var(--card-2)]"
            >
              <Icon size={24} strokeWidth={1.7} />
              <span className="line-clamp-2 w-full text-[10.5px] leading-tight tracking-tight text-[color:var(--muted-2)]">
                {categoryLabel(label)}
              </span>
            </Link>
          );
        })}
        {Array.from({ length: blanks }, (_, i) => (
          <span key={`blank-${i}`} className="bg-[var(--card)]" />
        ))}
      </div>
    </section>
  );
}
