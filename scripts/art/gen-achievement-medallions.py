# Generator for the self-drawn TokenTracker achievement medallion faces
# (256px, dark gunmetal disc + wide polished silver band + steel relief emblem
# + one accent color). Style target: the existing AI-made medallions that live
# beside the outputs. Rerun to tweak; outputs land in dashboard/public.
from PIL import Image, ImageDraw, ImageOps, ImageChops, ImageFilter
import math

S = 512
OUT = "D:/tt-rebase/dashboard/public/achievements"

STEEL = 235    # height for raised steel parts
ACCENT_H = 205 # slightly lower relief for accent parts
EMBLEM_SCALE = 1.32


def base_disc():
    """Dark gunmetal face wrapped in a wide polished silver band — the thick
    edge that reads as 'medallion' even before the CSS tier ring is applied."""
    img = Image.new("RGB", (S, S), (8, 9, 11))
    d = ImageDraw.Draw(img)
    cx = cy = S // 2
    BAND_OUT, BAND_IN = 252, 212
    for r in range(BAND_OUT, BAND_IN, -1):
        t = (BAND_OUT - r) / float(BAND_OUT - BAND_IN)  # 0 outer → 1 inner
        v = int(212 - 70 * t)
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(v, v + 4, v + 9), width=2)
    d.ellipse((cx - 251, cy - 251, cx + 251, cy + 251), outline=(236, 240, 245), width=4)
    d.ellipse((cx - BAND_IN, cy - BAND_IN, cx + BAND_IN, cy + BAND_IN), outline=(56, 61, 67), width=5)
    for r in range(BAND_IN - 6, 0, -2):
        t = r / float(BAND_IN)
        v = int(22 + 14 * math.sin(t * math.pi * 0.9))
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(v, v + 3, v + 6))
    d.ellipse((cx - 196, cy - 196, cx + 196, cy + 196), outline=(44, 49, 55), width=3)
    return img


def emboss(height_map):
    """Height map -> cast-metal look (light from top-left)."""
    shifted = ImageChops.offset(height_map, 3, 3)
    relief = ImageChops.subtract(height_map, shifted, 1, 118)
    return ImageOps.colorize(
        relief, black=(14, 16, 19), white=(240, 244, 249), mid=(120, 130, 141)
    )


def scale_emblem(height_map, accent_layer, factor):
    """Scale the emblem about the UNION bounding box of both layers so the
    steel relief and the accent tint stay perfectly aligned."""
    boxes = [l.getbbox() for l in (height_map, accent_layer)]
    boxes = [b for b in boxes if b]
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    x1 = max(b[2] for b in boxes)
    y1 = max(b[3] for b in boxes)
    w = max(1, int((x1 - x0) * factor))
    hgt = max(1, int((y1 - y0) * factor))
    out_h = Image.new("L", (S, S), 0)
    out_a = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ox, oy = (S - w) // 2, (S - hgt) // 2
    out_h.paste(height_map.crop((x0, y0, x1, y1)).resize((w, hgt), Image.LANCZOS), (ox, oy))
    out_a.paste(accent_layer.crop((x0, y0, x1, y1)).resize((w, hgt), Image.LANCZOS), (ox, oy))
    return out_h, out_a


def compose(disc, height_map, accent_layer):
    metal = emboss(height_map).convert("RGBA")
    # keep only the emblem footprint opaque — the flat background must show
    # the disc and its band
    mask = height_map.point(lambda v: 255 if v > 6 else 0)
    mask = mask.filter(ImageFilter.GaussianBlur(1.4))
    metal.putalpha(mask)
    out = disc.convert("RGBA")
    out.alpha_composite(metal)
    if accent_layer is not None:
        out.alpha_composite(accent_layer)
    return out.convert("RGB")


def new_layer():
    return Image.new("L", (S, S), 0), Image.new("RGBA", (S, S), (0, 0, 0, 0))


def save(img, name):
    img.resize((256, 256), Image.LANCZOS).quantize(
        colors=256, method=Image.MEDIANCUT
    ).save(f"{OUT}/{name}", optimize=True)
    print("saved", name)


def lw(width):
    return max(3, int(width))


def crescent_mask(cx, cy, r, dx):
    """Circle minus an offset circle — for the moon."""
    m1 = Image.new("L", (S, S), 0)
    ImageDraw.Draw(m1).ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
    m2 = Image.new("L", (S, S), 0)
    ImageDraw.Draw(m2).ellipse((cx - r + dx, cy - r, cx + r + dx, cy + r), fill=255)
    return ImageChops.subtract(m1, m2)


# ── early-bird: sunrise over the horizon ────────────────────────────────────
def early_bird():
    disc = base_disc()
    h, acc = new_layer()
    dh = ImageDraw.Draw(h)
    ACC = (240, 162, 74, 235)
    dh.rectangle((146, 306, 366, 318), fill=STEEL)
    dh.pieslice((202, 254, 310, 362), 180, 360, fill=ACCENT_H)
    for ang in (200, 240, 270, 300, 340):
        a = math.radians(ang)
        dh.line((256 + 66 * math.cos(a), 308 + 66 * math.sin(a),
                 256 + 108 * math.cos(a), 308 + 108 * math.sin(a)), fill=STEEL, width=lw(9))
    for bx, by, s in ((176, 168, 1.0), (218, 142, 0.75)):  # birds as raised strokes
        dh.arc((bx - 14 * s, by - 10 * s, bx, by + 10 * s), 200, 320, fill=STEEL, width=5)
        dh.arc((bx, by - 10 * s, bx + 14 * s, by + 10 * s), 220, 340, fill=STEEL, width=5)
    ImageDraw.Draw(acc).pieslice((202, 254, 310, 362), 180, 360, fill=ACC)
    h, acc = scale_emblem(h, acc, EMBLEM_SCALE)
    save(compose(disc, h, acc), "early-bird.png")


# ── around-the-clock: clock flanked by day and night ────────────────────────
def around_the_clock():
    disc = base_disc()
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    cx, cy, r = 256, 268, 92
    SUN = (238, 196, 90, 240)
    MOON = (159, 194, 232, 240)
    dh.ellipse((cx - r, cy - r, cx + r, cy + r), outline=STEEL, width=lw(12))
    for i in range(12):
        a = math.radians(i * 30)
        dh.line((cx + 72 * math.cos(a), cy + 72 * math.sin(a),
                 cx + 84 * math.cos(a), cy + 84 * math.sin(a)), fill=STEEL, width=lw(5))
    dh.line((cx, cy, cx, cy - 58), fill=STEEL, width=lw(9))
    dh.line((cx, cy, cx + 40, cy + 22), fill=STEEL, width=lw(9))
    da.ellipse((cx - 7, cy - 7, cx + 7, cy + 7), fill=(238, 243, 248, 255))
    # sun rays as accent strokes
    for ang in (210, 250, 290, 330):
        a = math.radians(ang)
        da.line((363 + 40 * math.cos(a), 141 + 40 * math.sin(a),
                 363 + 56 * math.cos(a), 141 + 56 * math.sin(a)), fill=SUN, width=6)
    da.pieslice((330, 108, 396, 174), 180, 360, fill=SUN)
    moon = crescent_mask(149, 395, 23, 10)  # lower-left crescent
    acc.paste(MOON, (0, 0), moon)
    h.paste(ACCENT_H, (0, 0), moon)
    h, acc = scale_emblem(h, acc, EMBLEM_SCALE)
    save(compose(disc, h, acc), "around-the-clock.png")


# ── sprinter: lightning burst with speed lines ──────────────────────────────
def sprinter():
    disc = base_disc()
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    ACC = (242, 181, 68, 245)
    bolt = [(300, 112), (192, 280), (262, 280), (214, 400), (344, 238), (276, 238), (326, 112)]
    dh.polygon(bolt, fill=ACCENT_H)
    da.polygon(bolt, fill=ACC)
    for y in (216, 258, 300):
        dh.rounded_rectangle((118, y - 5, 178, y + 5), 5, fill=STEEL)
    h, acc = scale_emblem(h, acc, EMBLEM_SCALE)
    save(compose(disc, h, acc), "sprinter.png")


# ── cache-alchemist: alchemy flask brewing golden drops ─────────────────────
def cache_alchemist():
    disc = base_disc()
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    ACC = (232, 195, 90, 240)
    dh.rounded_rectangle((238, 132, 274, 208), 8, outline=STEEL, width=lw(10))
    dh.polygon([(238, 204), (186, 316), (326, 316), (274, 204)], outline=STEEL, width=lw(10))
    dh.rounded_rectangle((182, 312, 330, 332), 10, fill=STEEL)
    da.polygon([(214, 262), (196, 306), (316, 306), (298, 262)], fill=ACC)
    for bx, by, r in ((256, 232, 9), (272, 212, 6), (244, 196, 5)):
        da.ellipse((bx - r, by - r, bx + r, by + r), fill=ACC)
    dh.line((330, 140, 330, 168), fill=STEEL, width=6)  # sparkle, raised
    dh.line((316, 154, 344, 154), fill=STEEL, width=6)
    h, acc = scale_emblem(h, acc, EMBLEM_SCALE)
    save(compose(disc, h, acc), "cache-alchemist.png")


# ── real-money: banknote over a stack of coins ──────────────────────────────
def real_money():
    disc = base_disc()
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    GOLD = (236, 195, 84, 245)
    GOLD_D = (176, 136, 44, 245)
    dh.rounded_rectangle((150, 176, 362, 258), 12, fill=STEEL)
    # engraved note details (recessed height)
    dh.rounded_rectangle((162, 188, 350, 246), 8, outline=120, width=5)
    dh.ellipse((234, 192, 278, 236), outline=120, width=5)
    for i, cy in enumerate((306, 334, 362)):
        da.ellipse((178, cy - 24, 334, cy + 24), fill=GOLD_D)
        da.ellipse((178, cy - 30, 334, cy + 18), fill=GOLD)
    for cy in (306, 334, 362):
        da.ellipse((196, cy - 18, 316, cy + 12), outline=GOLD_D[:3] + (255,), width=4)
    h, acc = scale_emblem(h, acc, EMBLEM_SCALE)
    save(compose(disc, h, acc), "real-money.png")


# ── session-marathon: hourglass with patient blue sand ──────────────────────
def session_marathon():
    disc = base_disc()
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    ACC = (127, 178, 229, 240)
    dh.rounded_rectangle((180, 128, 332, 146), 8, fill=STEEL)
    dh.rounded_rectangle((180, 366, 332, 384), 8, fill=STEEL)
    dh.polygon([(194, 152), (318, 152), (256, 252)], outline=STEEL, width=lw(9))
    dh.polygon([(256, 262), (194, 360), (318, 360)], outline=STEEL, width=lw(9))
    da.polygon([(224, 196), (288, 196), (256, 244)], fill=ACC)
    da.polygon([(256, 296), (222, 352), (290, 352)], fill=ACC)
    dh.line((254, 252, 254, 300), fill=ACCENT_H, width=lw(7))
    h, acc = scale_emblem(h, acc, EMBLEM_SCALE)
    save(compose(disc, h, acc), "session-marathon.png")


early_bird()
around_the_clock()
sprinter()
cache_alchemist()
real_money()
session_marathon()
