import type { StoreApp } from "@/lib/store";
import { categoryLabel } from "@/lib/categories";
import type { HeroSlide } from "@/components/hero-carousel";

/** How recent an addition still reads as "New" over the artwork. */
const NEW_FOR_MS = 14 * 24 * 3600 * 1000;

/**
 * Slides for the hero: only listings with a real banner, slimmed to what the
 * client needs so the whole listing does not ride along in the page.
 */
export function heroSlides(apps: StoreApp[], limit = 8): HeroSlide[] {
  const now = Date.now();
  return apps
    .filter((a): a is StoreApp & { banner: string } => Boolean(a.banner))
    .slice(0, limit)
    .map((a) => {
      const added = a.added ? Date.parse(a.added) : NaN;
      return {
        slug: a.slug,
        name: a.name,
        banner: a.banner,
        kicker:
          !Number.isNaN(added) && now - added < NEW_FOR_MS
            ? "New"
            : categoryLabel(a.category),
        line: a.tagline,
        seed: a.seed,
      };
    });
}
