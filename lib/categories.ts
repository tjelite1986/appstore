/**
 * The store's categories, in two kinds: apps and games.
 *
 * A listing still carries one `category` and nothing else. The kind is read off
 * it, never stored beside it, so the two cannot disagree — a second field
 * would be one more thing a filler could write half of. The names are unique
 * across both kinds for the same reason: a stored "Puzzle" has to mean one
 * shelf.
 *
 * "Games" stays a category of its own: it is what every game was filed under
 * before the game shelves existed, and what a source says when it knows the
 * listing is a game but not which kind. The UI calls it "Other games".
 *
 * No fs here on purpose — the edit form imports this file in the browser.
 */

export type AppCategory =
  | "Editor"
  | "Media"
  | "Entertainment"
  | "Communication"
  | "Adults"
  | "Other";

export type GameCategory =
  | "Action"
  | "Adventure"
  | "Arcade"
  | "Board"
  | "Card"
  | "Casual"
  | "Puzzle"
  | "Racing"
  | "Role Playing"
  | "Simulation"
  | "Sports"
  | "Strategy"
  | "Games";

export type Category = AppCategory | GameCategory;

export type CategoryKind = "app" | "game";

/** In the order the edit form and the tiles list them. */
export const APP_CATEGORIES: AppCategory[] = [
  "Editor",
  "Media",
  "Entertainment",
  "Communication",
  "Adults",
  "Other",
];

/** "Games" last: it is the shelf for a game nobody has sorted yet. */
export const GAME_CATEGORIES: GameCategory[] = [
  "Action",
  "Adventure",
  "Arcade",
  "Board",
  "Card",
  "Casual",
  "Puzzle",
  "Racing",
  "Role Playing",
  "Simulation",
  "Sports",
  "Strategy",
  "Games",
];

export const ALL_CATEGORIES: Category[] = [...APP_CATEGORIES, ...GAME_CATEGORIES];

/** The generic game shelf — what choosing "Game" in the form starts on. */
export const DEFAULT_GAME_CATEGORY: GameCategory = "Games";

export function kindOf(category: string): CategoryKind {
  return (GAME_CATEGORIES as string[]).includes(category) ? "game" : "app";
}

export function categoriesOf(kind: CategoryKind): Category[] {
  return kind === "game" ? GAME_CATEGORIES : APP_CATEGORIES;
}

/** What a person reads: the stored "Games" is the unsorted game shelf. */
export function categoryLabel(category: string): string {
  return category === DEFAULT_GAME_CATEGORY ? "Other games" : category;
}

/** The URL segment for `/category/<slug>`: "Role Playing" → "role-playing". */
export function categorySlug(category: string): string {
  return category.toLowerCase().replace(/\s+/g, "-");
}

/** Case-, space- and dash-insensitive, so "role playing" and "role-playing" both hit. */
export function findCategory(raw: string | undefined): Category | undefined {
  if (!raw) return undefined;
  const want = categorySlug(raw.trim());
  return ALL_CATEGORIES.find((c) => categorySlug(c) === want);
}

/**
 * A game shelf from a source's word for it: Play's `GAME_ROLE_PLAYING`,
 * apkmb's "Role Playing Games". Null where the word names no shelf here, so the
 * caller can fall back to the generic one.
 */
const GAME_WORDS: Record<string, GameCategory> = {
  action: "Action",
  adventure: "Adventure",
  arcade: "Arcade",
  board: "Board",
  card: "Card",
  casino: "Card",
  casual: "Casual",
  puzzle: "Puzzle",
  word: "Puzzle",
  trivia: "Puzzle",
  racing: "Racing",
  "role playing": "Role Playing",
  rpg: "Role Playing",
  simulation: "Simulation",
  sports: "Sports",
  strategy: "Strategy",
};

export function gameCategoryFor(word: string): GameCategory | null {
  const key = word
    .toLowerCase()
    .replace(/^game_/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s*games?$/, "")
    .trim();
  return GAME_WORDS[key] ?? null;
}
