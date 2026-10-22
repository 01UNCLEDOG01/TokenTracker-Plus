"""Rebuild the TT-plus app icons from scripts/art/source-icons/app-icon-plus-1024.png.

The source is an AI-generated "enhanced" variant of the original TokenTracker
icon (same white arrow on a dark rounded plate, recolored to the gold of the
reference W mark). The plate is cropped out of the 1024 source, the background
outside its rounded corners is made transparent, and every shipped size is
written: dashboard PNGs, favicon.ico, and the Windows tray icon.

Usage:
  python scripts/art/build-plus-app-icons.py            # no corner tag
  python scripts/art/build-plus-app-icons.py --tag plus # white "plus" tag
  python scripts/art/build-plus-app-icons.py --preview  # write 512px previews
                                                       # to scripts/art/previews/
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "scripts" / "art" / "source-icons" / "app-icon-plus-1024.png"
PUBLIC = ROOT / "dashboard" / "public"
WIN_ASSETS = ROOT / "TokenTrackerWin" / "assets"
PREVIEWS = ROOT / "scripts" / "art" / "previews"

PLATE_INSET_RATIO = 0.022  # cut inside the plate's own bright bevel
CORNER_RADIUS_RATIO = 0.235
BACKGROUND_LUMA_CUTOFF = 150  # dark plate only: excludes the AI source's white frame and gray shadow
# AI sources may carry stray border pixels from reference images; trim a thin
# margin before locating the dark plate.
SOURCE_TRIM_RATIO = 0.04
# White "plus" corner tag, drawn as vectors so it stays crisp at 16px and
# sits on the same layer as the plate (nothing floats outside the silhouette).
TAG_WIDTH_RATIO = 0.32
TAG_HEIGHT_RATIO = 0.11
TAG_MARGIN_RATIO = 0.09
TAG_TEXT = "plus"
TAG_TEXT_COLOR = (17, 24, 39, 255)
TAG_FILL = (255, 255, 255, 255)


def trim_source_margin(image: Image.Image) -> Image.Image:
    side = min(image.size)
    margin = int(side * SOURCE_TRIM_RATIO)
    return image.crop((margin, margin, image.width - margin, image.height - margin))


def plate_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    gray = image.convert("L")
    mask = gray.point(lambda v: 255 if v < BACKGROUND_LUMA_CUTOFF else 0)
    return mask.getbbox()


def load_tag_font(size: int):
    from PIL import ImageFont

    for name in ("segoeuib.ttf", "arialbd.ttf", "arial.ttf", "segoeui.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_plus_tag(plate: Image.Image, enabled: bool = True) -> Image.Image:
    if not enabled:
        return plate
    side = plate.width
    width = int(side * TAG_WIDTH_RATIO)
    height = int(side * TAG_HEIGHT_RATIO)
    margin = int(side * TAG_MARGIN_RATIO)
    x1 = side - margin - width
    y1 = side - margin - height
    x2 = side - margin
    y2 = side - margin
    draw = ImageDraw.Draw(plate)
    draw.rounded_rectangle((x1, y1, x2, y2), radius=height // 2, fill=TAG_FILL)
    font = load_tag_font(max(10, int(height * 0.58)))
    draw.text(
        ((x1 + x2) / 2, (y1 + y2) / 2),
        TAG_TEXT,
        font=font,
        fill=TAG_TEXT_COLOR,
        anchor="mm",
    )
    return plate


def rounded_plate(
    image: Image.Image,
    with_tag: bool = True,
) -> Image.Image:
    box = plate_bbox(trim_source_margin(image))
    if box is None:
        raise SystemExit("source image has no visible plate")
    left, top, right, bottom = box
    side0 = min(right - left, bottom - top)
    inset = int(side0 * PLATE_INSET_RATIO)
    left += inset
    top += inset
    right -= inset
    bottom -= inset
    side = min(right - left, bottom - top)
    # Center the square crop so the plate is not stretched.
    center_x = (left + right) // 2
    center_y = (top + bottom) // 2
    left = center_x - side // 2
    top = center_y - side // 2
    cropped = image.crop((left, top, left + side, top + side)).convert("RGBA")
    radius = int(side * CORNER_RADIUS_RATIO)
    mask = Image.new("L", (side, side), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (0, 0, side - 1, side - 1),
        radius=radius,
        fill=255,
    )
    cropped.putalpha(mask)
    return draw_plus_tag(cropped, enabled=with_tag)


def save_png(plate: Image.Image, relative: str, size: int) -> None:
    target = ROOT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    plate.resize((size, size), Image.LANCZOS).save(target, format="PNG")


def save_ico(plate: Image.Image, relative: str, sizes: list[int]) -> None:
    target = ROOT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    plate.save(
        target,
        format="ICO",
        sizes=[(size, size) for size in sizes],
    )


def main() -> None:
    argv = sys.argv[1:]
    with_tag = "--tag" in argv and (not argv or True)
    # Accept `--tag` (draw the tag) or `--tag plus` / `--tag none`.
    if "--tag" in argv:
        idx = argv.index("--tag")
        value = argv[idx + 1] if idx + 1 < len(argv) and not argv[idx + 1].startswith("-") else "plus"
        with_tag = value != "none"
    preview_only = "--preview" in argv
    source = Image.open(SOURCE).convert("RGB")
    plate = rounded_plate(source, with_tag=with_tag)
    if preview_only:
        PREVIEWS.mkdir(parents=True, exist_ok=True)
        name = "icon-tag-512.png" if with_tag else "icon-no-tag-512.png"
        plate.resize((512, 512), Image.LANCZOS).save(PREVIEWS / name, format="PNG")
        print("preview written:", PREVIEWS / name)
        return
    save_png(plate, "dashboard/public/app-icon.png", 200)
    save_png(plate, "dashboard/public/apple-touch-icon.png", 180)
    save_png(plate, "dashboard/public/favicon-16.png", 16)
    save_png(plate, "dashboard/public/favicon-32.png", 32)
    save_png(plate, "dashboard/public/icon-192.png", 192)
    save_png(plate, "dashboard/public/icon-512.png", 512)
    save_ico(plate, "dashboard/public/favicon.ico", [16, 32, 48, 256])
    save_ico(plate, "TokenTrackerWin/assets/trayicon.ico", [16, 24, 32, 48, 64, 256])
    print("plus app icons rebuilt from", SOURCE.name, "(tag)" if with_tag else "(no tag)")


if __name__ == "__main__":
    main()
