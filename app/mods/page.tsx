import Link from "next/link";
import { Screen, ScreenTitle } from "@/components/screen";
import { CARD, MUTED, Thumb } from "@/components/primitives";
import AddMod from "@/components/add-mod";
import { gameMods, listGames } from "@/lib/mods";
import { currentUser } from "@/lib/current-user";
import { adultsAllowed } from "@/lib/user-state";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Game Mods — one tile per game, reached from the menu. A game's mods are on
 * its own page; adding one is an admin panel under the tiles.
 */
export default async function ModsPage() {
  const viewer = await currentUser();
  const adults = adultsAllowed(viewer?.id ?? null);
  const games = await listGames(adults);
  // Offered when filing a GitHub mod; Nexus mods bring their own.
  const categories =
    viewer?.role === "admin"
      ? [
          ...new Set(
            (await Promise.all(games.map((g) => gameMods(g.slug, adults))))
              .flat()
              .map((m) => m.category)
              .filter(Boolean)
          ),
        ].sort()
      : [];

  return (
    <Screen>
      <ScreenTitle title="Game Mods" subtitle="Mods for the games people play" />

      {games.length === 0 ? (
        <p className={cn("px-[var(--pad)] text-sm", MUTED)}>No mods yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 px-[var(--pad)] sm:grid-cols-3 lg:grid-cols-4">
          {games.map((g) => (
            <Link key={g.slug} href={`/mods/${g.slug}`} className={cn(CARD, "overflow-hidden")}>
              <Thumb seed={g.seed} src={g.cover} alt={g.name} className="aspect-[4/3] w-full" />
              <div className="p-2.5">
                <p className="truncate text-sm font-semibold">{g.name}</p>
                <p className={cn("text-xs", MUTED)}>
                  {g.modCount} {g.modCount === 1 ? "mod" : "mods"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {viewer?.role === "admin" && (
        <AddMod
          games={games.map((g) => ({ slug: g.slug, name: g.name }))}
          categories={categories}
        />
      )}
    </Screen>
  );
}
