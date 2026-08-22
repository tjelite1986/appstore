import { notFound } from "next/navigation";
import { Screen, ScreenTitle } from "@/components/screen";
import AppGrid from "@/components/app-grid";
import { CATEGORIES, byCategory, type Category } from "@/lib/catalog";

/** One category, reached from the Categories tiles on Home and Apps. */
export default async function CategoryPage({
  params,
}: {
  params: Promise<{ cat: string }>;
}) {
  const { cat } = await params;
  const match = CATEGORIES.find((c) => c.label.toLowerCase() === cat);
  if (!match) notFound();

  const apps = byCategory(match.label as Category);

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

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ cat: c.label.toLowerCase() }));
}
