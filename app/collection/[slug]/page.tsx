import { notFound } from "next/navigation";
import { Screen, ScreenTitle } from "@/components/screen";
import AppGrid from "@/components/app-grid";
import { getCatalog } from "@/lib/store";
import { currentUserId } from "@/lib/current-user";
import { shelfFor } from "@/lib/user-state";
import { kindOf } from "@/lib/categories";

export const dynamic = "force-dynamic";

/**
 * One admin-made collection, reached from its chip or shelf on Apps and Games.
 *
 * Apps and games together, because a collection is not a kind — and through
 * `shelfFor`, so a gated listing filed here stays absent for whoever has the
 * gate shut. An empty collection answers rather than 404s: it exists, it just
 * holds nothing this viewer can see.
 */
export default async function CollectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { collections } = await getCatalog();
  const match = collections.find((c) => c.slug === decodeURIComponent(slug));
  if (!match) notFound();

  const apps = (await shelfFor(await currentUserId())).filter((a) =>
    a.collections.includes(match.slug)
  );
  const games = apps.filter((a) => kindOf(a.category) === "game").length;
  const parts = [
    apps.length - games > 0 && `${apps.length - games} app${apps.length - games === 1 ? "" : "s"}`,
    games > 0 && `${games} game${games === 1 ? "" : "s"}`,
  ].filter(Boolean);

  return (
    <Screen>
      <ScreenTitle title={match.name} subtitle={parts.join(" · ") || "Empty"} />
      <AppGrid apps={apps} empty="Nothing in this collection yet." />
    </Screen>
  );
}
