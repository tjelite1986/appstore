/**
 * GET /api/search?q=<words> — the live suggestions under the search box.
 *
 * The same catalog and the same ranking as the results page (`lib/search.ts`
 * over `catalogFor`), cut to a handful and to the fields a suggestion row
 * draws. Read through `catalogFor`, so a gated app is as absent here as it is
 * everywhere else.
 */
import { sessionUser } from "@/lib/auth";
import { catalogFor } from "@/lib/user-state";
import { searchApps, queryTerms } from "@/lib/search";
import { categoryLabel, categorySlug } from "@/lib/categories";
import type { StoreApp } from "@/lib/store";

export const dynamic = "force-dynamic";

const LIMIT = 8;

export type Suggestion = {
  slug: string;
  name: string;
  developer: string;
  category: string;
  rating: number;
  seed: number;
  icon?: string;
  iconBackground?: string;
  iconFit?: StoreApp["iconFit"];
};

export type SearchResponse = {
  apps: Suggestion[];
  total: number;
  categories: { label: string; slug: string }[];
};

export async function GET(req: Request): Promise<Response> {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
  const apps = await catalogFor(sessionUser(req)?.id ?? null);
  const results = searchApps(apps, q);

  // A category is suggested when every word is in its name — "puz" offers
  // the Puzzle shelf. Only shelves that hold something this viewer can see.
  const terms = queryTerms(q);
  const seen = new Set<string>();
  const categories: SearchResponse["categories"] = [];
  if (terms.length > 0) {
    for (const a of apps) {
      const label = categoryLabel(a.category);
      if (seen.has(label)) continue;
      seen.add(label);
      const hay = label.toLowerCase();
      if (terms.every((t) => hay.includes(t))) {
        categories.push({ label, slug: categorySlug(a.category) });
      }
    }
  }

  const body: SearchResponse = {
    apps: results.slice(0, LIMIT).map((a) => ({
      slug: a.slug,
      name: a.name,
      developer: a.developer,
      category: categoryLabel(a.category),
      rating: a.rating,
      seed: a.seed,
      icon: a.icon,
      iconBackground: a.iconBackground,
      iconFit: a.iconFit,
    })),
    total: results.length,
    categories: categories.slice(0, 3),
  };
  return Response.json(body, { headers: { "cache-control": "private, no-store" } });
}
