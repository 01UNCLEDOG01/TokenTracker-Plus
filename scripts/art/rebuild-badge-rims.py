# Rebuild the AI-painted badge faces onto the house coin rim.
#
# The first AI pass baked its own rim: a beaded checker fringe outside the
# frame and a near-black groove between face and frame. Both read as seams
# at 176px in the app. This script keeps the painted face (inside r=198 at
# 512) and casts the house rim from scratch, matching the geometry and warm
# champagne silver of the original upstream medallions (inner dip at r=204,
# frame 212..230, soft edge out to 236).
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageOps
from pathlib import Path
import math
import numpy as np

S = 512
C = (S - 1) / 2.0
ROOT = Path(__file__).resolve().parents[2]
OUT = str(ROOT / "dashboard" / "public" / "achievements")
SRC_BADGES = ROOT / "scripts" / "art" / "source-badges"
SRC_EMBLEM = ROOT / "scripts" / "art" / "source-emblem"


def radial_grid():
    yy, xx = np.mgrid[0:S, 0:S].astype(float)
    dx, dy = xx - C, yy - C
    r = np.sqrt(dx * dx + dy * dy)
    theta = np.degrees(np.arctan2(dy, dx))
    return r, theta


def house_coin():
    """One-piece cast coin: dark brushed face, a soft inner dip (not a black
    groove), a warm brushed-silver frame and a rolled outer edge."""
    r, theta = radial_grid()
    rng = np.random.default_rng(20261022)
    key = np.cos(np.radians(theta + 135.0))  # light from the upper-left
    brush = (rng.random(S) - 0.5) * 9.0
    br = brush[np.clip(r.astype(int), 0, S - 1)]
    grain = (rng.random((S, S)) - 0.5) * 4.5
    ring = (rng.random(S) - 0.5)[np.clip(r.astype(int), 0, S - 1)] * 3.0

    v = 44 + 9 * np.clip(r / 200.0, 0, 1) + 2.5 * key + grain * 0.55 + ring

    # seamless roll: the face climbs straight into the frame with no dark
    # groove; this band is also blended over the painted face edge
    t = np.clip((r - 188.0) / 20.0, 0, 1)
    ease = t * t * (3 - 2 * t)
    roll = (r >= 188) & (r < 208)
    v[roll] = 54 + (186 - 54) * ease[roll] + 6 * key[roll]

    # warm champagne frame 208..230
    frame = (r >= 208) & (r < 230)
    v[frame] = np.clip(184 + 38 * key[frame] + br[frame] * 1.4, 130, 244)
    lip = (r >= 208) & (r < 211)
    v[lip] = np.clip(206 + 28 * key[lip], 168, 252)

    # bright polished edge: the original medallions end on their brightest
    # chamfer, so the tier ring meets the rim directly. A dark outer band
    # here is the black line users see between the two frames.
    edge_band = (r >= 230) & (r < 234)
    v[edge_band] = np.clip(196 + 22 * key[edge_band] + br[edge_band] * 0.6, 160, 230)
    edge = (r >= 234) & (r < 237)
    v[edge] = np.clip(212 + 18 * key[edge], 185, 240)
    outer = r >= 237
    v[outer] = 220

    rgb = np.zeros((S, S, 3), dtype=np.uint8)
    warm = r >= 198  # face stays neutral gunmetal, frame is champagne
    rgb[..., 0] = np.clip(v + np.where(warm, 5, 1), 0, 255)
    rgb[..., 1] = np.clip(v + np.where(warm, -4, 0), 0, 255)
    rgb[..., 2] = np.clip(v + np.where(warm, -14, 3), 0, 255)
    return Image.fromarray(rgb, "RGB")


def extract_face(path, radius=196, feather=6):
    """Painted coin -> just the face, feathered so it melts into the house
    dip instead of ending on its own groove."""
    face = Image.open(path).convert("RGBA").resize((S, S), Image.LANCZOS)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).ellipse(
        (C - radius, C - radius, C + radius, C + radius), fill=255
    )
    mask = mask.filter(ImageFilter.GaussianBlur(feather / 2.0))
    face.putalpha(mask)
    return face


def compose(face, coin=None, shadow=True):
    base = coin or house_coin()
    out = base.convert("RGBA")
    if shadow:
        alpha = face.getchannel("A")
        sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        sh.putalpha(alpha.filter(ImageFilter.GaussianBlur(9)).point(lambda a: int(a * 0.68)))
        out.alpha_composite(sh, (5, 7))
    out.alpha_composite(face)
    # the painted face ends on a hard dark painted groove; melt it into the
    # house roll so no seam survives at display size
    r, _ = radial_grid()
    t = np.clip((r - 188.0) / 20.0, 0, 1)
    ease = (t * t * (3 - 2 * t) * 255).astype(np.uint8)
    out = Image.composite(base, out, Image.fromarray(ease, "L"))
    return out


def coin_alpha():
    alpha = Image.new("L", (S, S), 0)
    ImageDraw.Draw(alpha).ellipse((C - 236, C - 236, C + 236, C + 236), fill=255)
    return alpha.filter(ImageFilter.GaussianBlur(1.0))


def save(img, name, out_dir=OUT):
    """Binary coin alpha + opaque interior. Quantizing RGBA directly let
    FASTOCTREE average edge transparency into interior palette entries
    (alpha 252-254 everywhere), which is exactly the kind of faint wash that
    can shimmer as a checker when scaled. Here RGB is quantized separately
    and one palette index carries alpha 0, so the coin is either solid or
    gone and no baked edge can survive."""
    rgba = img.convert("RGBA")
    rgba.putalpha(coin_alpha())
    rgba = rgba.resize((256, 256), Image.LANCZOS)
    a = np.array(rgba)
    solid = (a[..., 3] >= 128).astype(np.uint8)
    rgb = a[..., :3].copy()
    rgb[solid == 0] = 0
    q = Image.fromarray(rgb, "RGB").quantize(
        colors=255, method=Image.FASTOCTREE, dither=Image.Dither.NONE
    )
    idx = np.array(q).copy()
    idx[solid == 0] = 255
    pal = q.getpalette()[: 255 * 3] + [0, 0, 0]
    out = Image.fromarray(idx.astype(np.uint8), "P")
    out.putpalette(pal)
    out.info["transparency"] = bytes([255] * 255 + [0])
    out.save(f"{out_dir}/{name}", optimize=True)
    print("saved", name)




# ── emblem helpers ──────────────────────────────────────────────────────────
BRAND = str(ROOT / "scripts" / "art" / "brand-cache")


def key_white(path):
    """Colored logo on white -> RGBA with saturated pixels opaque."""
    a = np.array(Image.open(path).convert("RGB")).astype(np.float32)
    al = np.clip((255 - a.min(axis=2)) * 1.7, 0, 255)
    al[al < 12] = 0
    return Image.fromarray(np.dstack([a, al]).astype(np.uint8), "RGBA")


def key_black(path):
    """Steel emblem on pure black -> RGBA via corner flood fill, so dark
    interior shadows stay part of the art instead of being keyed out."""
    im = Image.open(path).convert("RGB")
    tmp = im.copy()
    w, h = im.size
    for corner in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        ImageDraw.floodfill(tmp, corner, (255, 0, 255), thresh=18)
    bg = np.all(np.array(tmp) == (255, 0, 255), axis=2)
    al = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8), "L")
    al = al.filter(ImageFilter.GaussianBlur(0.8))
    return Image.fromarray(
        np.dstack([np.array(im), np.array(al)]).astype(np.uint8), "RGBA"
    )


def fill_holes(mask):
    """Split a logo mask into solid silhouette + enclosed negative space
    (the DeepSeek belly, eye and mouth), so the white parts of the mark read
    as light enamel instead of holes onto the coin face."""
    inv = ImageOps.invert(mask)
    flood = inv.copy()
    w, h = flood.size
    for corner in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        if flood.getpixel(corner) > 0:
            ImageDraw.floodfill(flood, corner, 0, thresh=0)
    holes = flood
    solid = ImageChops.lighter(mask, holes)
    return solid, holes


def fit(img, max_w, max_h):
    box = img.getchannel("A").getbbox()
    img = img.crop(box)
    scale = min(max_w / img.width, max_h / img.height)
    return img.resize(
        (max(1, round(img.width * scale)), max(1, round(img.height * scale))),
        Image.LANCZOS,
    )


def paste_center(layer, img, cx, cy):
    layer.alpha_composite(img, (round(cx - img.width / 2), round(cy - img.height / 2)))


def enamel(mask, top, bottom, outline=(154, 144, 132), glow=(255, 240, 226)):
    """Give a logo silhouette an enamel-and-steel edge instead of a flat
    fill: cast outline, diagonal color, inner highlight, one specular."""
    mask = mask.filter(ImageFilter.GaussianBlur(0.8))
    w, h = mask.size
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    t = np.clip(0.58 * (yy / max(1, h - 1)) + 0.28 * (xx / max(1, w - 1)), 0, 1)
    rgb = (
        np.array(top, dtype=float)[None, None, :] * (1 - t[..., None])
        + np.array(bottom, dtype=float)[None, None, :] * t[..., None]
    )
    grad = Image.fromarray(
        np.dstack([rgb, np.array(mask)]).astype(np.uint8), "RGBA"
    )

    dil = mask.filter(ImageFilter.MaxFilter(9))
    ring = ImageChops.subtract(dil, mask).filter(ImageFilter.GaussianBlur(1.0))
    outline_img = Image.new("RGBA", (w, h), outline + (255,))
    outline_img.putalpha(ring.point(lambda v: int(v * 0.92)))

    ero = mask.filter(ImageFilter.MinFilter(5))
    hi = ImageChops.subtract(mask, ero).filter(ImageFilter.GaussianBlur(1.2))
    hi_img = Image.new("RGBA", (w, h), glow + (255,))
    hi_img.putalpha(hi.point(lambda v: int(v * 0.8)))

    spec = np.clip(
        1 - np.sqrt((xx - 0.34 * w) ** 2 + (yy - 0.28 * h) ** 2) / (0.62 * w),
        0,
        1,
    ) ** 2
    spec_img = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    spec_img.putalpha(
        Image.fromarray((spec * np.array(mask) / 255.0 * 90).astype(np.uint8), "L")
    )

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.alpha_composite(outline_img)
    out.alpha_composite(grad)
    out.alpha_composite(hi_img)
    out.alpha_composite(spec_img)
    return out


def bevel_overlay(mask, strength=0.5):
    """Directional light/shadow relief for flat enamel logos. White/black
    only, so the brand hue stays saturated (a gray overlay washed the Claude
    orange into salmon)."""
    height = mask.filter(ImageFilter.GaussianBlur(2.2))
    relief = np.array(
        ImageChops.subtract(height, ImageChops.offset(height, 4, 4), 1.6, 128)
    ).astype(float)
    hi = np.clip((relief - 128) * 2.0, 0, 255) * strength
    lo = np.clip((128 - relief) * 2.0, 0, 255) * strength
    m = np.array(mask).astype(float) / 255.0
    out = Image.new("RGBA", mask.size, (0, 0, 0, 0))
    light = Image.new("RGBA", mask.size, (255, 248, 236, 255))
    light.putalpha(Image.fromarray((hi * m).astype(np.uint8), "L"))
    dark = Image.new("RGBA", mask.size, (10, 8, 6, 255))
    dark.putalpha(Image.fromarray((lo * m).astype(np.uint8), "L"))
    out.alpha_composite(light)
    out.alpha_composite(dark)
    return out


def coin(layer, cx, cy, r):
    d = ImageDraw.Draw(layer)
    ry = r * 0.8
    d.ellipse((cx - r + 3, cy - ry + 5, cx + r + 3, cy + ry + 5), fill=(0, 0, 0, 90))
    d.ellipse((cx - r, cy - ry, cx + r, cy + ry), fill=(150, 105, 30, 255))
    d.ellipse((cx - r + 3, cy - ry + 3, cx + r - 3, cy + ry - 3), fill=(247, 205, 96, 255))
    d.ellipse((cx - r + 9, cy - ry + 8, cx + r - 9, cy + ry - 8), fill=(255, 226, 130, 255))
    pts = []
    for i in range(10):
        ang = math.pi * i / 5.0 - math.pi / 2
        rr = r * 0.36 if i % 2 == 0 else r * 0.15
        pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang) * 0.8))
    d.polygon(pts, fill=(196, 146, 44, 255))
    d.arc((cx - r + 7, cy - ry + 5, cx + r - 7, cy + ry - 5), 190, 320, fill=(255, 248, 205, 255), width=3)


# ── bespoke faces ───────────────────────────────────────────────────────────
def multitool_day():
    """One robot, four hands, four tools — 分身有术."""
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    robot = fit(key_black(str(SRC_EMBLEM / "one-man-band.png")), 348, 368)
    paste_center(layer, robot, 256, 258)
    save(compose(layer), "multitool-day.png")


def claude_survivor():
    """Only the official Claude starburst — the brand mark is the badge."""
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    star = fit(key_white(f"{BRAND}/claude-code.png"), 380, 380)
    star_mask = star.getchannel("A")
    star = enamel(
        star_mask,
        (232, 132, 98),
        (196, 92, 66),
        outline=(118, 52, 34),
        glow=(255, 184, 152),
    )
    star.alpha_composite(bevel_overlay(star_mask, 0.55))
    paste_center(layer, star, 256, 256)
    save(compose(layer), "claude-survivor.png")


def wishing_well():
    """The official DeepSeek whale in blue enamel, over wish-coins."""
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    whale = fit(key_white(f"{BRAND}/deepseek.png"), 336, 300)
    solid, holes = fill_holes(whale.getchannel("A"))
    blue = enamel(
        solid,
        (88, 114, 255),
        (48, 76, 232),
        outline=(34, 52, 128),
        glow=(190, 206, 255),
    )
    belly = enamel(
        holes,
        (219, 228, 246),
        (144, 160, 194),
        outline=(150, 168, 204),
        glow=(250, 252, 255),
    )
    blue.alpha_composite(belly)
    blue.alpha_composite(bevel_overlay(solid, 0.45))
    paste_center(layer, blue, 250, 220)
    for cx, cy, r in ((292, 352, 40), (348, 382, 34), (238, 386, 30)):
        coin(layer, cx, cy, r)
    save(compose(layer), "wishing-well.png")


AI_FACES = (
    "phoenix",
    "iron-month",
    "full-blast",
    "deep-diver",
    "grand-slam",
    "around-the-clock",
    "sprinter",
    "cache-alchemist",
    "real-money",
    "session-marathon",
    "early-bird",
)


if __name__ == "__main__":
    for stem in AI_FACES:
        save(compose(extract_face(str(SRC_BADGES / f"{stem}.png")), shadow=False), f"{stem}.png")
    multitool_day()
    claude_survivor()
    wishing_well()
