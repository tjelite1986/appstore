import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest — what makes the store installable to an
// Android home screen (and iOS's "Add to Home Screen"), running standalone
// with no browser chrome.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "App Store",
    short_name: "App Store",
    description: "An APK archive with its own front door.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#100913",
    theme_color: "#100913",
    // The ?v= is what makes a new icon reach an already-installed home screen
    // app. Android bakes the icon into a generated APK at install time and
    // only rebuilds it when it notices the manifest changed — an icon swapped
    // behind an unchanged URL is not noticed. Bump it whenever
    // scripts/make-icons.py is re-run.
    icons: [
      { src: "/icon-192.png?v=1", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png?v=1", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png?v=1",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
