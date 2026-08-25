"use client";

import { useState } from "react";

/**
 * The image half of `Thumb`, split out for one reason: the error fallback
 * needs state, and state needs "use client". Left inside primitives.tsx that
 * directive would put the whole module — `metaLine`, `MUTED`, `CARD` — on the
 * client, where a server component calling them throws.
 *
 * Rendering null on error uncovers the gradient underneath, so a file that has
 * gone missing from the library looks like an app with no icon rather than a
 * broken-image glyph.
 */
export default function ThumbImage({
  src,
  alt = "",
  fit = "cover",
}: {
  src: string;
  alt?: string;
  /** "contain" fits the whole image in the box; "cover" fills and crops. */
  fit?: "cover" | "contain";
}) {
  const [failed, setFailed] = useState(false);
  const [tracked, setTracked] = useState(src);

  // A new URL — the icon was replaced — deserves a fresh attempt.
  if (src !== tracked) {
    setTracked(src);
    setFailed(false);
  }
  if (failed) return null;

  return (
    // Not next/image: these are served by a route handler off a bind mount, so
    // there is nothing for the optimiser to do that the mtime-versioned URL and
    // the immutable cache header do not already do.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={
        fit === "contain"
          ? // Inset rather than inset-0: an icon that has to be *fitted* is a
            // logo, and a logo drawn hard against the edges of its plate looks
            // like a mistake. The margin is part of what "fit" means here.
            "absolute inset-[9%] h-[82%] w-[82%] object-contain"
          : "absolute inset-0 h-full w-full object-cover"
      }
      onError={() => setFailed(true)}
    />
  );
}
