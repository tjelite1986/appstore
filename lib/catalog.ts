/**
 * The stand-in catalog.
 *
 * These rows are invented. They exist so the layout can be judged with
 * realistic text lengths — long names truncate, short ones do not — and so a
 * store with an empty library still has something on screen. `lib/store.ts`
 * falls back to them when `meta/` and `apks/` are both empty, and drops them
 * the moment a real app lands on disk.
 *
 * Nothing here has artwork or a binary: the placeholder rows render the
 * gradient thumbnails and their buttons do not download anything.
 */
import type { PlaceholderApp } from "./store";

export const PLACEHOLDER_APPS: PlaceholderApp[] = [
  { slug: "photo-editor-pro", name: "Photo Editor Pro", developer: "Lumen Labs", category: "Editor", tagline: "Layers, masks and curves on your phone", version: "9.4.1", size: "48 MB", rating: 4.6, ratingCount: 128, seed: 1 },
  { slug: "snapedit", name: "SnapEdit", developer: "Snap Tools", category: "Editor", tagline: "Remove anything from a photo", version: "7.7.4", size: "62 MB", rating: 4.4, ratingCount: 96, seed: 2, installed: true, updateTo: "7.8.0" },
  { slug: "vector-studio", name: "Vector Studio", developer: "Northline", category: "Editor", tagline: "Draw and export clean SVG", version: "3.2.0", size: "31 MB", rating: 4.8, ratingCount: 42, seed: 3 },
  { slug: "clip-cutter", name: "Clip Cutter", developer: "Rowan Media", category: "Editor", tagline: "Trim, caption, publish", version: "5.0.2", size: "77 MB", rating: 4.2, ratingCount: 210, seed: 4 },
  { slug: "colorgrade", name: "Colorgrade", developer: "Fieldwork", category: "Editor", tagline: "Film looks in one tap", version: "2.6.1", size: "24 MB", rating: 4.5, ratingCount: 64, seed: 5 },
  { slug: "retouch", name: "Retouch", developer: "Lumen Labs", category: "Editor", tagline: "Heal, clone and patch", version: "1.9.0", size: "18 MB", rating: 4.1, ratingCount: 33, seed: 6 },
  { slug: "framecast", name: "Framecast", developer: "Studio Nine", category: "Editor", tagline: "Storyboards that export to video", version: "0.9.4", size: "40 MB", rating: 4.0, ratingCount: 12, seed: 7 },
  { slug: "inkline", name: "Inkline", developer: "Pale Blue", category: "Editor", tagline: "A sketchbook with real brushes", version: "4.3.3", size: "55 MB", rating: 4.7, ratingCount: 88, seed: 8 },
  { slug: "batchpress", name: "Batchpress", developer: "Northline", category: "Editor", tagline: "Resize a thousand images at once", version: "1.4.0", size: "9 MB", rating: 4.3, ratingCount: 21, seed: 9 },

  { slug: "streamdeck", name: "Streamdeck", developer: "Halden", category: "Media", tagline: "Every library in one player", version: "6.1.0", size: "24 MB", rating: 4.6, ratingCount: 240, seed: 10, installed: true },
  { slug: "podpocket", name: "Podpocket", developer: "Grey Harbour", category: "Media", tagline: "Podcasts that remember where you were", version: "3.8.2", size: "16 MB", rating: 4.5, ratingCount: 154, seed: 11 },
  { slug: "tuner", name: "Tuner", developer: "Halden", category: "Media", tagline: "Radio without the ads", version: "2.2.7", size: "11 MB", rating: 4.2, ratingCount: 71, seed: 12 },
  { slug: "shelf", name: "Shelf", developer: "Paper Route", category: "Media", tagline: "EPUB, PDF and comics in one reader", version: "5.5.0", size: "34 MB", rating: 4.9, ratingCount: 63, seed: 13, saved: true },

  { slug: "reelbox", name: "Reelbox", developer: "Kestrel", category: "Entertainment", tagline: "Short video, endless scroll", version: "8.0.1", size: "58 MB", rating: 4.0, ratingCount: 310, seed: 14, installed: true, updateTo: "8.1.0" },
  { slug: "nightowl", name: "Nightowl", developer: "Kestrel", category: "Entertainment", tagline: "What to watch tonight", version: "1.7.2", size: "22 MB", rating: 4.4, ratingCount: 45, seed: 15, saved: true },

  { slug: "signalbox", name: "Signalbox", developer: "Alder", category: "Communication", tagline: "Private messaging, no account", version: "4.0.0", size: "27 MB", rating: 4.8, ratingCount: 190, seed: 16 },
  { slug: "roomchat", name: "Roomchat", developer: "Alder", category: "Communication", tagline: "Group calls that just connect", version: "2.9.5", size: "39 MB", rating: 4.3, ratingCount: 84, seed: 17, installed: true },
  { slug: "postbox", name: "Postbox", developer: "Grey Harbour", category: "Communication", tagline: "Mail for several accounts", version: "6.6.1", size: "45 MB", rating: 4.1, ratingCount: 122, seed: 18 },
  { slug: "relay", name: "Relay", developer: "Alder", category: "Communication", tagline: "IRC, XMPP and Matrix in one place", version: "1.2.8", size: "14 MB", rating: 4.6, ratingCount: 37, seed: 19, updateTo: "1.3.0" },

  { slug: "dune-runner", name: "Dune Runner", developer: "Two Owls", category: "Games", tagline: "Endless desert, one lane", version: "3.1.4", size: "120 MB", rating: 4.5, ratingCount: 512, seed: 20 },
  { slug: "tile-forge", name: "Tile Forge", developer: "Bright Anvil", category: "Games", tagline: "Puzzles that build a city", version: "2.0.9", size: "86 MB", rating: 4.7, ratingCount: 288, seed: 21, saved: true },
  { slug: "orbit-9", name: "Orbit 9", developer: "Two Owls", category: "Games", tagline: "Slingshot physics in space", version: "1.5.0", size: "64 MB", rating: 4.2, ratingCount: 97, seed: 22 },
  { slug: "cardhouse", name: "Cardhouse", developer: "Pale Blue", category: "Games", tagline: "Solitaire, twelve ways", version: "4.4.2", size: "27 MB", rating: 4.4, ratingCount: 143, seed: 23 },
  { slug: "pixel-keep", name: "Pixel Keep", developer: "Bright Anvil", category: "Games", tagline: "Build, defend, repeat", version: "0.8.1", size: "210 MB", rating: 4.0, ratingCount: 58, seed: 24 },
  { slug: "lanternfall", name: "Lanternfall", developer: "Studio Nine", category: "Games", tagline: "A quiet game about light", version: "1.0.3", size: "155 MB", rating: 4.9, ratingCount: 76, seed: 25 },
];

/** Feeds the changelog block on Home. `version | date | summary`. */
export const PLACEHOLDER_CHANGELOG: string[] = [
  "v1.4.0 | 28 July | Photo Editor Pro, new update",
  "v1.3.0 | 21 July | Streamdeck, new update",
  "v1.2.1 | 14 July | Signalbox, new update",
];
