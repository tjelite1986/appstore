/**
 * What the long-press category picker offers, or nothing for a viewer who may
 * not file apps. Built on the server so the picker never lists a category the
 * viewer cannot see: Adults only past the gate, like the edit form.
 */
import type { BulkOptions } from "@/components/bulk-category";
import { currentUser } from "@/lib/current-user";
import { adultsAllowed } from "@/lib/user-state";
import { ADULT_CATEGORY, getCatalog } from "@/lib/store";
import {
  APP_CATEGORIES,
  GAME_CATEGORIES,
  categoryLabel,
} from "@/lib/categories";

export async function bulkOptions(): Promise<BulkOptions | undefined> {
  const user = await currentUser();
  if (user?.role !== "admin") return undefined;
  const adults = adultsAllowed(user.id);
  const { collections } = await getCatalog();
  return {
    custom: collections
      .filter((c) => adults || !c.adults)
      .map(({ slug, name, icon, adults }) => ({ slug, name, icon, adults })),
    builtIn: [
      ...APP_CATEGORIES.filter((c) => adults || c !== ADULT_CATEGORY).map((c) => ({
        value: c as string,
        label: categoryLabel(c),
        kind: "app" as const,
      })),
      ...GAME_CATEGORIES.map((c) => ({
        value: c as string,
        label: categoryLabel(c),
        kind: "game" as const,
      })),
    ],
  };
}
