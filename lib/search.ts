/**
 * Catalog search, shared by the results page and the live suggestions.
 *
 * Both have to agree: a suggestion that is not on the results page for the
 * same words reads as the store changing its mind. So the ranking lives here
 * and nowhere else.
 *
 * Every word typed has to be found somewhere in the listing (name, developer,
 * category, package id, tagline). The order is about *where* it was found: the
 * start of the name beats the start of a word in the name, which beats the
 * middle of the name, which beats any other field. Ties go to the better
 * rated app, then the alphabet.
 *
 * No fs here — it runs on lists already read through `catalogFor`, which is
 * where the 18+ gate is applied.
 */
import { categoryLabel } from "./categories";

type Searchable = {
  name: string;
  developer: string;
  category: string;
  tagline: string;
  packageName?: string;
  rating: number;
};

/** Lower-cased and accent-free — the form every comparison here is made in. */
export function norm(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** The words of a query, lower-cased and accent-free. */
export function queryTerms(query: string): string[] {
  return norm(query).split(/\s+/).filter(Boolean);
}

function scoreOne(app: Searchable, terms: string[]): number {
  const name = norm(app.name);
  const others = norm(
    [app.developer, categoryLabel(app.category), app.packageName ?? "", app.tagline].join(" ")
  );
  let score = 0;
  for (const t of terms) {
    if (name.startsWith(t)) score += 100;
    else if (new RegExp(`(^|[^a-z0-9])${escapeRegExp(t)}`).test(name)) score += 60;
    else if (name.includes(t)) score += 40;
    else if (others.includes(t)) score += 10;
    else return 0;
  }
  // A whole-name match is the thing being looked for.
  if (name === terms.join(" ")) score += 50;
  return score;
}

/**
 * Where the words of a query sit in `text`, as [start, end) offsets into the
 * original string, sorted and merged. Matched the way the search matches
 * (accent-free, case-free), so "resume" marks "Résumé" — a hit with nothing
 * highlighted reads as a wrong hit. First occurrence of each word.
 */
export function matchRanges(text: string, query: string): [number, number][] {
  // Normalise one character at a time, remembering which original character
  // each normalised one came from: NFKD can grow or shrink a character.
  let flat = "";
  const from: number[] = [];
  const width: number[] = [];
  let i = 0;
  for (const ch of text) {
    const n = norm(ch);
    for (let k = 0; k < n.length; k++) {
      from.push(i);
      width.push(ch.length);
    }
    flat += n;
    i += ch.length;
  }

  const ranges: [number, number][] = [];
  for (const t of queryTerms(query)) {
    const at = flat.indexOf(t);
    if (at < 0) continue;
    // End where the next normalised character starts, so a trailing
    // combining accent (normalised to nothing) stays with its letter.
    const next = at + t.length;
    const end =
      next >= from.length
        ? text.length
        : from[next] !== from[next - 1]
          ? from[next]
          : from[next - 1] + width[next - 1];
    ranges.push([from[at], end]);
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);

  // "edit editor" over "Photo Editor": both start at the same place, the
  // longer one wins instead of the first one dropping the second.
  const merged: [number, number][] = [];
  for (const [s, e] of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && s <= prev[1]) prev[1] = Math.max(prev[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matching apps, best first. Empty for an empty query. */
export function searchApps<T extends Searchable>(apps: T[], query: string): T[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  return apps
    .map((app) => ({ app, score: scoreOne(app, terms) }))
    .filter((r) => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.app.rating - a.app.rating ||
        a.app.name.localeCompare(b.app.name)
    )
    .map((r) => r.app);
}

/**
 * Best first by rating, with the number of ratings pulling a lone 5.0 down
 * below a 4.7 that thousands agree on. Unrated apps go last.
 */
export function byTopRated<T extends { rating: number; ratingCount: number; name: string }>(
  apps: T[]
): T[] {
  const weight = (a: T) => (a.rating > 0 ? a.rating * Math.log10(a.ratingCount + 10) : 0);
  return [...apps].sort((a, b) => weight(b) - weight(a) || a.name.localeCompare(b.name));
}
