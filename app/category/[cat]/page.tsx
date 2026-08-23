import { notFound } from "next/navigation";
import { Screen, ScreenTitle } from "@/components/screen";
import AppGrid from "@/components/app-grid";
import { byCategory, categoryTiles, type Category } from "@/lib/store";

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

  const apps = await byCategory(match.label as Category);

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
