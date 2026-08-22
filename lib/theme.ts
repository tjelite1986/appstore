/**
 * Design tokens for the store, taken verbatim from the Layout Studio sketch
 * (`docs/elitev3/app-store.json`): dark mode, blue accent, plum background,
 * 4px radius, roomy density, system sans. The sketch is the spec — change a
 * value here only when the app deliberately diverges, and note it in README.
 */
export const THEME = {
  mode: "dark",
  accent: "#2563eb",
  background: "plum",
  radius: 4,
  density: "roomy",
  font: "sans",
} as const;

/** Plum, the same radial gradient Layout Studio and elite-v2 render. */
export const BACKGROUND_CSS =
  "radial-gradient(circle at 80% -10%, #2a1030 0%, #100913 65%)";

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
  --radius-sm: ${Math.max(4, Math.round(THEME.radius * 0.6))}px;
  --radius-lg: ${Math.round(THEME.radius * 1.35)}px;
  --gap: 1.25rem;
  --pad: 1.5rem;
  --fg: #ffffff;
  --card: rgba(255, 255, 255, 0.05);
  --card-2: rgba(255, 255, 255, 0.10);
  --border: rgba(255, 255, 255, 0.10);
  --muted: rgba(255, 255, 255, 0.50);
  --muted-2: rgba(255, 255, 255, 0.70);
  --bar: rgba(0, 0, 0, 0.60);
  --menu: rgba(28, 28, 32, 0.96);
  --app-bg: ${BACKGROUND_CSS};
  /* Height reserved for the fixed bottom nav so page content can clear it. */
  --nav-h: 4.25rem;
}
`;
