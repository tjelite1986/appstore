import { notFound } from "next/navigation";
import { Screen, ScreenTitle } from "@/components/screen";
import AppGrid from "@/components/app-grid";
import { categoryTiles } from "@/lib/store";
import { currentUserId } from "@/lib/current-user";
import { adultsAllowed, shelfFor } from "@/lib/user-state";
import { categoryLabel, categorySlug, kindOf } from "@/lib/categories";

export const dynamic = "force-dynamic";

/** One category, reached from the Categories tiles on Home, Apps and Games. */
export default async function CategoryPage({
  params,
}: {
  params: Promise<{ cat: string }>;
}) {
  const { cat } = await params;
  const userId = await currentUserId();
  // Every shelf, not only the tiles drawn: an empty game shelf has no tile
  // but its address should still answer rather than 404.
  const match = (
    await categoryTiles({ adults: adultsAllowed(userId), kind: "all" })
  ).find((c) => categorySlug(c.label) === categorySlug(decodeURIComponent(cat)));
  if (!match) notFound();

  const apps = (await shelfFor(userId)).filter(
    (a) => a.category === match.label
  );

  const noun = kindOf(match.label) === "game" ? "game" : "app";

  return (
    <Screen>
      <ScreenTitle
        title={categoryLabel(match.label)}
        subtitle={`${apps.length} ${noun}${apps.length === 1 ? "" : "s"}`}
      />
      <AppGrid apps={apps} empty="This category is empty." />
    </Screen>
  );
}
