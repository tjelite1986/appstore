import { notFound } from "next/navigation";
import { Screen, ScreenTitle } from "@/components/screen";
import AppGrid from "@/components/app-grid";
import { categoryTiles, getCatalog } from "@/lib/store";
import { currentUserId } from "@/lib/current-user";
import { adultsAllowed, shelfFor } from "@/lib/user-state";
import { categoryLabel, categorySlug, kindOf } from "@/lib/categories";
import { bulkOptions } from "@/lib/bulk-options";

export const dynamic = "force-dynamic";

/**
 * One category, built-in or made in Manage, reached from its tile, chip or
 * shelf on Home, Apps and Games.
 *
 * Built-in slugs are tried first; Manage refuses a custom name that would
 * collide with one, so the order only matters for a hand-edited file.
 */
export default async function CategoryPage({
  params,
}: {
  params: Promise<{ cat: string }>;
}) {
  const { cat } = await params;
  const want = decodeURIComponent(cat);
  const userId = await currentUserId();
  const adults = adultsAllowed(userId);
  // Every shelf, not only the tiles drawn: an empty game shelf has no tile
  // but its address should still answer rather than 404.
  const match = (await categoryTiles({ adults, kind: "all" })).find(
    (c) => categorySlug(c.label) === categorySlug(want)
  );
  const [shelf, bulk] = await Promise.all([shelfFor(userId), bulkOptions()]);

  if (match) {
    const apps = shelf.filter((a) => a.category === match.label);
    const noun = kindOf(match.label) === "game" ? "game" : "app";
    return (
      <Screen>
        <ScreenTitle
          title={categoryLabel(match.label)}
          subtitle={`${apps.length} ${noun}${apps.length === 1 ? "" : "s"}`}
        />
        <AppGrid apps={apps} empty="This category is empty." bulk={bulk} />
      </Screen>
    );
  }

  // A custom category holds apps and games together, because it is not a
  // kind. An 18+ one is absent for a viewer with the gate shut, exactly like
  // a slug that does not exist; its apps are read through `shelfFor`, so a
  // gated listing filed here stays absent too.
  const custom = (await getCatalog()).collections.find((c) => c.slug === want);
  if (!custom || (custom.adults && !adults)) notFound();

  const apps = shelf.filter((a) => a.collections.includes(custom.slug));
  const games = apps.filter((a) => kindOf(a.category) === "game").length;
  const parts = [
    apps.length - games > 0 && `${apps.length - games} app${apps.length - games === 1 ? "" : "s"}`,
    games > 0 && `${games} game${games === 1 ? "" : "s"}`,
  ].filter(Boolean);

  return (
    <Screen>
      <ScreenTitle title={custom.name} subtitle={parts.join(" · ") || "Empty"} />
      <AppGrid apps={apps} empty="This category is empty." bulk={bulk} />
    </Screen>
  );
}
