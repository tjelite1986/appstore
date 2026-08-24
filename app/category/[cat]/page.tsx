import { notFound } from "next/navigation";
import { Screen, ScreenTitle } from "@/components/screen";
import AppGrid from "@/components/app-grid";
import { categoryTiles } from "@/lib/store";
import { currentUserId } from "@/lib/current-user";
import { catalogFor } from "@/lib/user-state";

export const dynamic = "force-dynamic";

/** One category, reached from the Categories tiles on Home and Apps. */
export default async function CategoryPage({
  params,
}: {
  params: Promise<{ cat: string }>;
}) {
  const { cat } = await params;
  const match = (await categoryTiles()).find(
    (c) => c.label.toLowerCase() === cat.toLowerCase()
  );
  if (!match) notFound();

  const apps = (await catalogFor(await currentUserId())).filter(
    (a) => a.category === match.label
  );

  return (
    <Screen>
      <ScreenTitle
        title={match.label}
        subtitle={`${apps.length} ${apps.length === 1 ? "app" : "apps"}`}
      />
      <AppGrid apps={apps} empty="This category is empty." />
    </Screen>
  );
}
