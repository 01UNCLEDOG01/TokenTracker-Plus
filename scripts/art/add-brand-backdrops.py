#!/usr/bin/env python
"""Add a low-contrast thematic backdrop to five brand medallions.

The emblem stays the subject: the texture lives inside the face (r < 94 of 256)
at 10–16% opacity, so it reads as depth rather than decoration. The house rim
and the binary alpha are untouched.

Run after minting the brand set: `python scripts/art/add-brand-backdrops.py`.
"""
import importlib.util
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "dashboard" / "public" / "achievements"

_spec = importlib.util.spec_from_file_location("rims", ROOT / "scripts" / "art" / "rebuild-badge-rims.py")
rims = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rims)
S = 256
C = (S - 1) / 2.0

RNG = np.random.default_rng(20261024)


def face_mask(strength=True):
    yy, xx = np.mgrid[0:S, 0:S].astype(float)
    r = np.hypot(xx - C, yy - C)
    if strength:
        return np.clip((94 - r) / 10.0, 0.0, 1.0)
    return (r < 94).astype(float)


def draw_layer(draw_fn):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(img))
    return img


def tech_grid(d, color):
    step = 18
    for x in range(0, S, step):
        d.line([(x, 0), (x, S)], fill=color, width=1)
    for y in range(0, S, step):
        d.line([(0, y), (S, y)], fill=color, width=1)
    for cx in range(9, S, step):
        for cy in range(9, S, step):
            d.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], outline=color)


def sonar(d, color):
    for radius in range(18, 120, 14):
        d.arc([C - radius, C - radius, C + radius, C + radius], 200, 340, fill=color, width=2)
    for _ in range(26):
        a = RNG.random() * math.tau
        r = 30 + RNG.random() * 60
        x = C + math.cos(a) * r
        y = C + math.sin(a) * r
        s = 2 + RNG.random() * 4
        d.ellipse([x - s, y - s, x + s, y + s], outline=color)


def starfield(d, color):
    for _ in range(140):
        a = RNG.random() * math.tau
        r = math.sqrt(RNG.random()) * 96
        x = C + math.cos(a) * r
        y = C + math.sin(a) * r
        s = 0.5 + RNG.random() * 1.6
        d.ellipse([x - s, y - s, x + s, y + s], fill=color)
    for cx, cy, rr in [(70, 90, 26), (185, 170, 34), (110, 190, 18)]:
        d.arc([cx - rr, cy - rr, cx + rr, cy + rr], 15, 300, fill=color, width=2)


def cloud_bands(d, color):
    for i in range(7):
        y0 = 30 + i * 30
        pts = []
        for x in range(0, S + 8, 8):
            y = y0 + math.sin((x / S) * math.tau * 1.4 + i * 0.9) * 12
            pts.append((x, y))
        d.line(pts, fill=color, width=2)


def light_streaks(d, color):
    for i in range(10):
        x = -40 + i * 34
        d.line([(x, S), (x + 150, 0)], fill=color, width=2)
    for i in range(4):
        d.line([(-20 + i * 60, 0), (S + 20 + i * 60, S)], fill=color, width=1)



def nebula(d, color):
    for _ in range(90):
        a = RNG.random() * math.tau
        r = math.sqrt(RNG.random()) * 96
        x = C + math.cos(a) * r
        y = C + math.sin(a) * r
        s = 0.6 + RNG.random() * 2.2
        d.ellipse([x - s, y - s, x + s, y + s], fill=color)
    for cx, cy, rr in [(95, 100, 34), (160, 165, 44)]:
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=color, width=3)


def speed_lines(d, color):
    for i in range(14):
        y = 20 + i * 16
        x0 = RNG.random() * 90
        d.line([(x0, y), (x0 + 90, y - 6)], fill=color, width=2)


def electric_arcs(d, color):
    for k in range(9):
        a = (k / 9.0) * math.tau
        pts = [(C, C)]
        for step in range(1, 5):
            r = step * 22
            jitter = (RNG.random() - 0.5) * 14
            pts.append((C + math.cos(a) * r + jitter, C + math.sin(a) * r + jitter))
        d.line(pts, fill=color, width=2)


def ledger_grid(d, color):
    for x in range(10, S, 22):
        d.line([(x, 0), (x, S)], fill=color, width=1)
    for y in range(10, S, 22):
        d.line([(0, y), (S, y)], fill=color, width=1)
    for cx, cy in [(70, 80), (185, 95), (120, 185)]:
        d.ellipse([cx - 14, cy - 14, cx + 14, cy + 14], outline=color, width=2)


def rays(d, color):
    for k in range(18):
        a = (k / 18.0) * math.tau
        x0, y0 = C + math.cos(a) * 34, C + math.sin(a) * 34
        x1, y1 = C + math.cos(a) * 96, C + math.sin(a) * 96
        d.line([(x0, y0), (x1, y1)], fill=color, width=2)


def ocean(d, color):
    # Light shafts through water, then swell lines and bubbles.
    for i in range(7):
        x0 = 6 + i * 38
        d.line([(x0, S), (x0 + 70, 0)], fill=color, width=9)
    for i in range(6):
        y0 = 42 + i * 30
        pts = [(x, y0 + math.sin(x / 26.0 + i) * 7) for x in range(0, S + 6, 6)]
        d.line(pts, fill=color, width=2)
    for _ in range(26):
        x = RNG.random() * S
        y = RNG.random() * S
        r = 1 + RNG.random() * 4
        d.ellipse([x - r, y - r, x + r, y + r], outline=color)

BRANDS = {
    "zhipu-sage": (tech_grid, (150, 190, 255, 255), 0.35, 0.34),
    "minimax-abyss": (ocean, (120, 235, 255, 255), 0.45, 0.34),
    "moonshot-voyager": (starfield, (210, 195, 255, 255), 0.40, 0.40),
    "qwen-dynasty": (cloud_bands, (205, 175, 255, 255), 0.28, 0.38),
    "seedance-master": (light_streaks, (150, 245, 230, 255), 0.26, 0.34),
    "north-america-doubao": (nebula, (170, 205, 255, 255), 0.35, 0.34),
    "hyperspeed-grok": (speed_lines, (175, 220, 255, 255), 0.30, 0.32),
    "flash-immortal": (electric_arcs, (255, 225, 150, 255), 0.30, 0.30),
    "token-arbitrageur": (ledger_grid, (245, 215, 150, 255), 0.35, 0.30),
    "claude-survivor": (rays, (255, 190, 160, 255), 0.35, 0.30),
}


def apply(name, draw_fn, color, blur, opacity):
    path = OUT / f"{name}.png"
    img = Image.open(path).convert("RGBA")
    base = np.array(img).astype(np.float32)
    alpha = base[..., 3]

    layer = draw_layer(lambda d: draw_fn(d, color))
    if blur:
        layer = layer.filter(ImageFilter.GaussianBlur(0.8))
    tex = np.array(layer).astype(np.float32)
    tex_rgb, tex_a = tex[..., :3], tex[..., 3] / 255.0

    weight = face_mask() * tex_a * opacity
    # Keep fully transparent/edge pixels as they are; only the face changes.
    weight = weight * (alpha >= 250)
    for c in range(3):
        base[..., c] = base[..., c] * (1 - weight) + tex_rgb[..., c] * weight

    # A gentle upper-left key + rim falloff gives the flat emblem a face plane
    # instead of a printed sticker.
    yy, xx = np.mgrid[0:S, 0:S].astype(float)
    r = np.hypot(xx - C, yy - C)
    theta = np.degrees(np.arctan2(yy - C, xx - C))
    key = np.cos(np.radians(theta + 135.0))
    shade = (0.88 + 0.12 * key) * np.clip(1.06 - (r / 118.0) ** 3, 0.72, 1.0)
    shade = np.where(alpha >= 250, shade, 1.0)
    for c in range(3):
        base[..., c] = np.clip(base[..., c] * shade, 0, 255)

    out = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGBA")
    # Same save contract as the house saver (RGB palette + one transparent
    # index), kept at 256 because these files are already minted at that size.
    solid = (np.array(out)[..., 3] >= 128)
    rgb = np.array(out)[..., :3].copy()
    rgb[~solid] = 0
    q = Image.fromarray(rgb, "RGB").quantize(
        colors=255, method=Image.FASTOCTREE, dither=Image.Dither.NONE
    )
    idx = np.array(q).copy()
    idx[~solid] = 255
    pal = q.getpalette()[: 255 * 3] + [0, 0, 0]
    saved = Image.fromarray(idx.astype(np.uint8), "P")
    saved.putpalette(pal)
    saved.info["transparency"] = bytes([255] * 255 + [0])
    saved.save(OUT / f"{name}.png", optimize=True)
    print("backdrop", name)


def main(only=None):
    for name, (fn, color, blur, opacity) in BRANDS.items():
        if only and name not in only:
            continue
        apply(name, fn, color, blur, opacity)


if __name__ == "__main__":
    import sys
    main(sys.argv[1:] or None)
