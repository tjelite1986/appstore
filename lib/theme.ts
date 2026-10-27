/**
 * Design tokens for the store. They started as the Layout Studio sketch
 * (`docs/elitev3/app-store.json`); since 2026-10-27 the look follows the big
 * phone stores instead: true black, soft grey cards, large radii, round grey
 * pill buttons and a floating bottom bar. The README lists the divergences.
 */
export const THEME = {
  mode: "dark",
  accent: "#3d8bff",
  background: "black",
  radius: 18,
  density: "roomy",
  font: "sans",
} as const;

/** True black: artwork and icons carry the colour, the page does not. */
export const BACKGROUND_CSS = "#000000";

export const FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * The custom properties every component styles itself from. Mirrors Layout
 * Studio's `themeVars`, so a block rendered here and the same block in the
 * sketch resolve to identical colours and spacing.
 */
export const THEME_VARS = `
:root {
  --accent: ${THEME.accent};
  --accent-soft: color-mix(in srgb, ${THEME.accent}, transparent 82%);
  --accent-text: color-mix(in srgb, ${THEME.accent}, white 42%);
  --radius: ${THEME.radius}px;
  --radius-sm: ${Math.round(THEME.radius * 0.6)}px;
  --radius-lg: ${Math.round(THEME.radius * 1.35)}px;
  /* App icons: a squircle-ish corner relative to the icon's own size. */
  --icon-radius: 24%;
  --gap: 1.25rem;
  --pad: 1.125rem;
  --fg: #ffffff;
  --card: #161618;
  --card-2: #252528;
  /* The round grey buttons on every row and shelf. */
  --pill: #2e2e32;
  --pill-hover: #3a3a3f;
  --border: rgba(255, 255, 255, 0.09);
  --muted: rgba(255, 255, 255, 0.55);
  --muted-2: rgba(255, 255, 255, 0.75);
  --bar: rgba(0, 0, 0, 0.72);
  --dock: rgba(38, 38, 42, 0.82);
  --menu: rgba(28, 28, 32, 0.96);
  /* Status colours, kept to a hint of text: the store is dark and quiet. */
  --danger: #f87171;
  --warn: #fbbf24;
  --ok: #4ade80;
  --app-bg: ${BACKGROUND_CSS};
  /* Height reserved for the floating bottom nav (bar + its lift off the edge)
     so page content can clear it. */
  --nav-h: 5.75rem;
}
`;
