#!/usr/bin/env python3
"""Generate the PWA icon set in public/.

A host-side developer tool, not part of the runtime: it is run by hand when the
icon design changes, and its output (the PNGs) is what ships. Requires Pillow.

    python3 scripts/make-icons.py

Bump the ?v= query in app/manifest.ts and app/layout.tsx after regenerating.
Android bakes the icon into a generated APK at install time and only re-reads
it when it notices the manifest changed, so an icon swapped behind an unchanged
URL never reaches a home screen that already has the app.
"""

from pathlib import Path

from PIL import Image, ImageDraw

PUBLIC = Path(__file__).resolve().parent.parent / "public"

ACCENT = (37, 99, 235)       # --accent, #2563eb
ACCENT_DEEP = (30, 58, 138)  # blue-900, the far end of the maskable gradient
TILE_TOP = (42, 16, 48)      # #2a1030, the plum the background glows from
TILE_BOTTOM = (16, 9, 19)    # #100913, the store's base background
WHITE = (255, 255, 255)

SUPERSAMPLE = 4


def vertical_gradient(size, top, bottom):
    """A one-pixel-wide gradient stretched to `size` — cheaper than per-pixel."""
    strip = Image.new("RGB", (1, size))
    px = strip.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        px[0, y] = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
    return strip.resize((size, size), Image.Resampling.BICUBIC)


def bag_icon(size, *, background, bag, arrow, bleed=False):
    """The store mark: a shopping bag with a download arrow cut into it — a
    shop whose goods are things you download.

    `bleed` fills the whole square (iOS applies its own rounding, and a maskable
    icon must have paint in every corner); otherwise the tile gets Android's
    rounded-square silhouette.
    """
    s = size * SUPERSAMPLE
    img = background(s).convert("RGBA")

    if not bleed:
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            (0, 0, s - 1, s - 1), radius=s * 0.22, fill=255
        )
        img.putalpha(mask)

    draw = ImageDraw.Draw(img)

    # The maskable variant keeps everything inside the 80% safe zone.
    w = s * (0.46 if bleed else 0.54)
    h = w * 0.92
    cx = s / 2
    top = s / 2 - h / 2 + w * 0.10
    body = (cx - w / 2, top, cx + w / 2, top + h)
    draw.rounded_rectangle(body, radius=w * 0.14, fill=bag)

    # Handle: an open arc above the body.
    hw = w * 0.46
    hh = w * 0.44
    draw.arc(
        (cx - hw / 2, top - hh / 2, cx + hw / 2, top + hh / 2),
        start=180,
        end=360,
        fill=bag,
        width=round(w * 0.085),
    )

    # Download arrow: a shaft and a head, centred in the body.
    shaft_w = w * 0.11
    ay0 = top + h * 0.18
    ay1 = top + h * 0.58
    draw.rectangle((cx - shaft_w / 2, ay0, cx + shaft_w / 2, ay1), fill=arrow)
    head = w * 0.24
    draw.polygon(
        [(cx - head, ay1 - head * 0.35), (cx + head, ay1 - head * 0.35), (cx, ay1 + head * 0.7)],
        fill=arrow,
    )
    # Tray the arrow lands in.
    ty = top + h * 0.85
    draw.rounded_rectangle(
        (cx - w * 0.26, ty, cx + w * 0.26, ty + w * 0.07),
        radius=w * 0.035,
        fill=arrow,
    )

    return img.resize((size, size), Image.Resampling.LANCZOS)


def main():
    PUBLIC.mkdir(parents=True, exist_ok=True)

    def tile(s):
        return vertical_gradient(s, TILE_TOP, TILE_BOTTOM)

    def blue(s):
        return vertical_gradient(s, ACCENT, ACCENT_DEEP)

    # "any": the plum tile, so the icon reads as the store on a dark home
    # screen rather than as a blue blob.
    for size in (512, 192):
        bag_icon(size, background=tile, bag=ACCENT, arrow=WHITE).save(
            PUBLIC / f"icon-{size}.png", optimize=True
        )

    # "maskable": paint to every edge. The launcher crops this to whatever
    # shape it likes.
    bag_icon(512, background=blue, bag=WHITE, arrow=ACCENT_DEEP, bleed=True).save(
        PUBLIC / "icon-maskable-512.png", optimize=True
    )

    # iOS rounds this itself and puts it on the home screen as-is.
    bag_icon(180, background=tile, bag=ACCENT, arrow=WHITE, bleed=True).save(
        PUBLIC / "apple-touch-icon.png", optimize=True
    )

    bag_icon(32, background=tile, bag=ACCENT, arrow=WHITE).save(
        PUBLIC / "favicon-32.png", optimize=True
    )

    for f in sorted(PUBLIC.glob("*.png")):
        print(f"{f.name}: {f.stat().st_size} B")


if __name__ == "__main__":
    main()
