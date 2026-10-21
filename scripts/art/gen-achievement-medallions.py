# Generator for the self-drawn TokenTracker achievement medallion faces
# (256px, solid bright silver frame + dark face + steel relief emblem + one
# accent color). Style target: the existing AI-made medallions that live
# beside the outputs. Rerun to tweak; outputs land in dashboard/public.
from PIL import Image, ImageDraw, ImageOps, ImageChops, ImageFilter
import math

S = 512
OUT = "D:/tt-rebase/dashboard/public/achievements"

STEEL = 235    # height for raised steel parts
ACCENT_H = 205 # slightly lower relief for accent parts
# Measured from the original medallions (veteran/streak/night-owl/wordsmith):
# emblem bbox max-dimension ≈ 77.5% of the canvas; the artwork carries a
# SOLID bright silver frame (luminance >120 across r 82-92% of the disc,
# ~11px at 256) with a mid-dark outer rim beyond it.
EMBLEM_TARGET = 0.775 * S


def base_disc():
    """One-piece casting (numpy): dark face with a soft ambient bounce toward
    the rim, a wide brushed-silver frame lit from the upper-left, and NO hard
    seams — the frame ramps into the face so the coin reads as a single metal
    body (the old hard inner lip made it look like stacked rings)."""
    import numpy as np
    yy, xx = np.mgrid[0:S, 0:S].astype(float)
    dx, dy = xx - (S - 1) / 2.0, yy - (S - 1) / 2.0
    r = np.sqrt(dx * dx + dy * dy)
    theta = np.degrees(np.arctan2(dy, dx))
    rng = np.random.default_rng(20261021)
    brush = (rng.random(S) - 0.5) * 9.0  # concentric brushed-metal noise
    br = brush[np.clip(r.astype(int), 0, S - 1)]
    key = np.cos(np.radians(theta - 135.0))  # key light from upper-left

    v = np.zeros((S, S), dtype=float)
    # dark face (same radial gradient as before) + faint key-light shading
    face = np.clip(r / 212.0, 0, 1)
    v = 24 + 13 * np.sin(face * math.pi * 0.9) + 4 * key
    # ambient bounce rising toward the frame (no hard lip line)
    bounce = (r >= 196) & (r < 212)
    v[bounce] += ((r[bounce] - 196) / 16.0) * 26.0
    # seamless ramp face -> frame
    ramp = (r >= 212) & (r < 220)
    t = (r[ramp] - 212) / 8.0
    v[ramp] = 54 + (160 - 54) * t
    # brushed silver frame with angular key light — darker than v1: the
    # original faces' frames sit visibly darker than the CSS tier ring.
    frame = (r >= 220) & (r <= 236)
    v[frame] = 190 + 26 * key[frame] + br[frame]
    # bright edge highlight at the outer rim
    edge = (r > 234) & (r <= 236)
    v[edge] = np.minimum(238, v[edge] + 14)
    # beyond the frame: silver continuation, NOT the dark face color — the
    # circular alpha mask sits right at 236 and its anti-aliased rim samples
    # these pixels; dark ones here showed up as a black seam between the
    # frame and the CSS tier ring.
    v[r > 236] = 238.0

    rgb = np.zeros((S, S, 3), dtype=np.uint8)
    is_frame = r >= 212
    rgb[..., 0] = np.where(is_frame, np.clip(v, 0, 244), np.clip(v, 0, 255))
    rgb[..., 1] = rgb[..., 0] + np.where(is_frame, 5, 3)
    rgb[..., 2] = rgb[..., 0] + np.where(is_frame, 11, 6)
    rgb[..., 1] = np.clip(rgb[..., 1], 0, 255)
    rgb[..., 2] = np.clip(rgb[..., 2], 0, 255)
    return Image.fromarray(rgb, "RGB")


def emboss(height_map):
    """Height map -> cast-metal look (light from top-left). Offset 2px +
    a >1 subtract scale keep the relief crisp at 256px (3px/1.0 read soft)."""
    shifted = ImageChops.offset(height_map, 2, 2)
    relief = ImageChops.subtract(height_map, shifted, 1.3, 118)
    return ImageOps.colorize(
        relief, black=(14, 16, 19), white=(240, 244, 249), mid=(120, 130, 141)
    )


def scale_emblem(height_map, accent_layer):
    """Scale the emblem about the UNION bounding box of both layers so the
    steel relief and the accent tint stay perfectly aligned. The emblem's
    max dimension is normalized to EMBLEM_TARGET (77.5% of the canvas —
    measured from the original medallions). Normalizing the max dimension
    alone is NOT enough for emblems whose elements sit on the bbox DIAGONAL
    (around-the-clock's sun/moon): a corner sits at sqrt(w²+h²)/2 from the
    coin center and crosses into the frame. After scaling, clamp the
    farthest bbox corner to the dark-face radius (212px @512, minus a hair)
    so every emblem stays ON the face — flush against the frame is fine,
    crossing it is not. Applies to all faces through this single function."""
    boxes = [l.getbbox() for l in (height_map, accent_layer)]
    boxes = [b for b in boxes if b]
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    x1 = max(b[2] for b in boxes)
    y1 = max(b[3] for b in boxes)
    factor = EMBLEM_TARGET / float(max(x1 - x0, y1 - y0))
    w = max(1, int((x1 - x0) * factor))
    hgt = max(1, int((y1 - y0) * factor))
    # corner-distance clamp (see docstring)
    far = max(
        math.hypot(px - S / 2.0, py - S / 2.0)
        for px, py in (
            ((S - w) / 2.0, (S - hgt) / 2.0),
            ((S + w) / 2.0, (S - hgt) / 2.0),
            ((S - w) / 2.0, (S + hgt) / 2.0),
            ((S + w) / 2.0, (S + hgt) / 2.0),
        )
    )
    limit = 210.0  # dark face radius 212 minus a hair
    if far > limit:
        shrink = limit / far
        w = max(1, int(w * shrink))
        hgt = max(1, int(hgt * shrink))
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
    # Round-coin alpha that stops at the silver frame (r≈238): everything
    # beyond it is transparent so the CSS tier ring / coin edge (rarity
    # color) sits directly against the frame. The artwork guardrail
    # (test/user-badges-artwork.test.js) requires a tRNS chunk — quantize
    # keeps it as palette transparency.
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).ellipse((20, 20, S - 20, S - 20), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(1.2))  # soft anti-aliased rim
    rgba = img.convert("RGBA")
    rgba.putalpha(mask)
    rgba.resize((256, 256), Image.LANCZOS).quantize(
        colors=256, method=Image.FASTOCTREE
    ).save(f"{OUT}/{name}", optimize=True)
    print("saved", name)


def logo_height(path, fill=ACCENT_H, cutoff=200):
    """Rasterized brand logo -> height map: opaque shape at `fill` height,
    in-shape light details and the white background recessed to 0."""
    img = Image.open(path).convert("L")
    return img.point(lambda v: fill if v <= cutoff else 0)


def recolor_github_face(src, name, rim_inner=110):
    """The upstream wall mixes two sources: AI-painted faces and quantized
    copies of GitHub's official achievement faces (upstream commit message:
    "Badge artwork sourced from GitHub profile achievements"). GitHub's
    frames are WHITE; recolor the rim band to the house brushed silver so
    these faces match the rest of the wall. Alpha (incl. the soft edge and
    the tRNS chunk after quantize) is preserved."""
    import numpy as np
    img = Image.open(src).convert("RGBA")
    a = np.array(img).astype(float)
    n = a.shape[0]
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    dx, dy = xx - (n - 1) / 2.0, yy - (n - 1) / 2.0
    r = np.sqrt(dx * dx + dy * dy)
    theta = np.degrees(np.arctan2(dy, dx))
    rng = np.random.default_rng(20261021)
    brush = (rng.random(n) - 0.5) * 9.0
    br = brush[np.clip(r.astype(int), 0, n - 1)]
    key = np.cos(np.radians(theta - 135.0))
    lum = 206 + 26 * key + br
    band = r >= rim_inner
    for c, off in ((0, 0), (1, 5), (2, 11)):
        ch = a[..., c]
        ch[band] = np.clip(lum[band] + off, 0, 248)
        a[..., c] = ch
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")
    out.quantize(colors=256, method=Image.FASTOCTREE).save(f"{OUT}/{name}", optimize=True)
    print("saved", name)


def deep_thinker():
    recolor_github_face(f"{OUT}/galaxy-brain.png", "deep-thinker.png")


def heart_model():
    recolor_github_face(f"{OUT}/heart-on-your-sleeve.png", "heart-model.png")


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
    h, acc = scale_emblem(h, acc)
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
    h, acc = scale_emblem(h, acc)
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
    h, acc = scale_emblem(h, acc)
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
    h, acc = scale_emblem(h, acc)
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
    h, acc = scale_emblem(h, acc)
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
    h, acc = scale_emblem(h, acc)
    save(compose(disc, h, acc), "session-marathon.png")


# ── phoenix: firebird rising from ash flecks ────────────────────────────────
def phoenix():
    disc = base_disc()
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    ACC = (242, 128, 62, 240)
    # raised wings: two sweeping arcs meeting at a raised body
    dh.arc((96, 128, 268, 320), 210, 330, fill=STEEL, width=lw(14))
    dh.arc((244, 128, 416, 320), 210, 330, fill=STEEL, width=lw(14))
    # feather tips (short strokes at the wing ends)
    for x0, y0, dx, dy in ((118, 224, -26, 44), (394, 224, 26, 44)):
        dh.line((x0, y0, x0 + dx, y0 + dy), fill=STEEL, width=lw(9))
    # body: slim raised diamond + head
    dh.polygon([(256, 176), (282, 268), (256, 352), (230, 268)], fill=STEEL)
    dh.ellipse((240, 148, 272, 182), fill=STEEL)
    # beak
    dh.polygon([(270, 158), (296, 168), (270, 178)], fill=ACCENT_H)
    # flames rising from the ash bed below (accent)
    da.polygon([(206, 400), (226, 344), (246, 400)], fill=ACC)
    da.polygon([(240, 404), (266, 318), (292, 404)], fill=ACC)
    da.polygon([(286, 400), (306, 356), (326, 400)], fill=ACC)
    # ash bed: low relief bar the bird rises from
    dh.rounded_rectangle((176, 396, 336, 414), 8, fill=ACCENT_H)
    h, acc = scale_emblem(h, acc)
    save(compose(disc, h, acc), "phoenix.png")


# ── iron-month: calendar page with filled day cells ─────────────────────────
def iron_month():
    disc = base_disc()
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    ACC = (124, 186, 224, 240)
    dh.rounded_rectangle((146, 150, 366, 372), 14, fill=STEEL)
    # recessed header strip + binder rings
    dh.rectangle((146, 196, 366, 216), fill=110)
    for rx in (196, 316):
        dh.rounded_rectangle((rx - 8, 118, rx + 8, 162), 8, fill=STEEL)
    # day cells: 4x3, some filled (accent) — active days
    y0 = 232
    for row in range(3):
        for col in range(4):
            x0 = 166 + col * 48
            if (row * 4 + col) % 2 == 0:
                da.rounded_rectangle((x0, y0 + row * 44, x0 + 38, y0 + row * 44 + 34), 5, fill=ACC)
            else:
                dh.rounded_rectangle((x0, y0 + row * 44, x0 + 38, y0 + row * 44 + 34), 5, fill=ACCENT_H)
    h, acc = scale_emblem(h, acc)
    save(compose(disc, h, acc), "iron-month.png")


# ── full-blast: starburst detonation with radial sparks ─────────────────────
def full_blast():
    disc = base_disc()
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    ACC = (245, 152, 58, 245)
    cx = cy = 256
    # 8-point star (low relief) with a hot accent core
    pts = []
    for i in range(16):
        ang = math.pi * i / 8.0 - math.pi / 2
        r = 150 if i % 2 == 0 else 62
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    dh.polygon(pts, fill=ACCENT_H)
    da.ellipse((cx - 46, cy - 46, cx + 46, cy + 46), fill=ACC)
    # radial spark strokes (raised steel) in the diagonals
    for ang in (35, 125, 215, 305):
        a = math.radians(ang)
        dh.line((cx + 88 * math.cos(a), cy + 88 * math.sin(a),
                 cx + 132 * math.cos(a), cy + 132 * math.sin(a)), fill=STEEL, width=lw(8))
    h, acc = scale_emblem(h, acc)
    save(compose(disc, h, acc), "full-blast.png")


# ── deep-diver: anchor over rising bubbles ──────────────────────────────────
def deep_diver():
    disc = base_disc()
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    ACC = (112, 176, 228, 240)
    cx = 256
    # stock ring on top
    dh.ellipse((cx - 26, 118, cx + 26, 170), outline=STEEL, width=lw(11))
    # shank + stock bar
    dh.line((cx, 158, cx, 388), fill=STEEL, width=lw(13))
    dh.line((cx - 84, 200, cx + 84, 200), fill=STEEL, width=lw(11))
    # flukes: two sweeping arms ending in barbed tips
    dh.arc((cx - 148, 250, cx, 404), 180, 296, fill=STEEL, width=lw(13))
    dh.arc((cx, 250, cx + 148, 404), 244, 360, fill=STEEL, width=lw(13))
    dh.polygon([(cx - 158, 330), (cx - 178, 386), (cx - 120, 372)], fill=STEEL)
    dh.polygon([(cx + 158, 330), (cx + 178, 386), (cx + 120, 372)], fill=STEEL)
    # bubbles drifting up beside the shank (accent)
    for bx, by, r in ((196, 176, 10), (180, 130, 7), (322, 210, 9), (338, 162, 6)):
        da.ellipse((bx - r, by - r, bx + r, by + r), fill=ACC)
    h, acc = scale_emblem(h, acc)
    save(compose(disc, h, acc), "deep-diver.png")


# ── multitool-day: stacked tool plates (one day, many tools) ────────────────
def multitool_day():
    disc = base_disc()
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    ACC = (176, 142, 228, 240)
    # three isometric plates stacked with offsets; top plate carries the accent
    for i, (dx, dy) in enumerate(((-34, 34), (-17, 17), (0, 0))):
        box = (166 + dx, 190 + dy, 346 + dx, 330 + dy)
        if i == 2:
            dh.rounded_rectangle(box, 16, fill=STEEL)
            da.rounded_rectangle((box[0] + 22, box[1] + 22, box[2] - 22, box[3] - 22), 10, fill=ACC)
        else:
            dh.rounded_rectangle(box, 16, fill=ACCENT_H)
            dh.rounded_rectangle(box, 16, outline=STEEL, width=lw(6))
    # tool slots on the top plate (recessed)
    for sx in (232, 296):
        dh.rectangle((sx - 9, 240, sx + 9, 300), fill=90)
    h, acc = scale_emblem(h, acc)
    save(compose(disc, h, acc), "multitool-day.png")


# ── claude-survivor: the Claude starburst over crossed survivor bones ───────
def claude_survivor():
    disc = base_disc()
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    ACC = (240, 128, 96, 235)
    # crossed bones peeking out below the logo (steel, low)
    dh.line((150, 356, 342, 408), fill=STEEL, width=lw(20))
    dh.line((342, 356, 150, 408), fill=STEEL, width=lw(20))
    for ex, ey in ((150, 356), (342, 408), (342, 356), (150, 408)):
        dh.ellipse((ex - 15, ey - 15, ex + 15, ey + 15), fill=STEEL)
    # official Claude starburst, cast in accent metal, front and center
    star = Image.open("D:/tt-rebase/scripts/art/brand-cache/claude-code.png")
    hh = logo_height("D:/tt-rebase/scripts/art/brand-cache/claude-code.png", ACCENT_H).resize((356, 356), Image.LANCZOS)
    h.paste(hh, (78, 62), hh)
    m = star.convert("L").point(lambda v: 255 if v <= 200 else 0).resize((356, 356), Image.LANCZOS)
    acc.paste(ACC, (78, 62), m)
    h, acc = scale_emblem(h, acc)
    save(compose(disc, h, acc), "claude-survivor.png")


# ── wishing-well: the DeepSeek whale with coins dropping in ─────────────────
def wishing_well():
    disc = base_disc()
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    GOLD = (238, 196, 90, 245)
    # official DeepSeek whale, cast in accent metal
    whale = Image.open("D:/tt-rebase/scripts/art/brand-cache/deepseek.png")
    hh = logo_height("D:/tt-rebase/scripts/art/brand-cache/deepseek.png", ACCENT_H).resize((360, 360), Image.LANCZOS)
    h.paste(hh, (76, 86), hh)
    m = whale.convert("L").point(lambda v: 255 if v <= 200 else 0).resize((360, 360), Image.LANCZOS)
    acc.paste((90, 126, 240, 235), (76, 86), m)
    # wish-coins dropping toward the whale (raised steel rims, gold faces)
    for bx, by, r in ((88, 120, 17), (122, 82, 12), (424, 132, 14), (398, 88, 10)):
        da.ellipse((bx - r, by - r, bx + r, by + r), fill=GOLD)
        da.ellipse((bx - r + 4, by - r + 4, bx + r - 4, by + r - 4), outline=(176, 136, 44, 255), width=4)
    h, acc = scale_emblem(h, acc)
    save(compose(disc, h, acc), "wishing-well.png")


# ── grand-slam: trophy cup with a star ──────────────────────────────────────
def grand_slam():
    disc = base_disc()
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    GOLD = (238, 196, 90, 245)
    cx = 256
    # cup body (raised) + accent front panel
    dh.polygon([(170, 140), (342, 140), (322, 262), (256, 292), (190, 262)], fill=STEEL)
    da.polygon([(198, 160), (314, 160), (300, 250), (256, 274), (212, 250)], fill=GOLD)
    # handles
    dh.arc((96, 148, 200, 244), 90, 270, fill=STEEL, width=lw(11))
    dh.arc((312, 148, 416, 244), 270, 90, fill=STEEL, width=lw(11))
    # stem + base
    dh.rounded_rectangle((238, 292, 274, 330), 6, fill=STEEL)
    dh.rounded_rectangle((196, 330, 316, 352), 8, fill=STEEL)
    dh.rounded_rectangle((180, 352, 332, 378), 8, fill=ACCENT_H)
    # star on the cup (recessed into the accent panel)
    pts = []
    for i in range(10):
        ang = math.pi * i / 5.0 - math.pi / 2
        r = 34 if i % 2 == 0 else 14
        pts.append((cx + r * math.cos(ang), 205 + r * math.sin(ang)))
    da.polygon(pts, fill=(176, 136, 44, 255))
    # sparkles above the rim
    dh.line((cx - 92, 118, cx - 92, 142), fill=STEEL, width=6)
    dh.line((cx - 104, 130, cx - 80, 130), fill=STEEL, width=6)
    dh.line((cx + 92, 118, cx + 92, 142), fill=STEEL, width=6)
    dh.line((cx + 80, 130, cx + 104, 130), fill=STEEL, width=6)
    h, acc = scale_emblem(h, acc)
    save(compose(disc, h, acc), "grand-slam.png")


early_bird()
around_the_clock()
sprinter()
cache_alchemist()
real_money()
session_marathon()
phoenix()
iron_month()
full_blast()
deep_diver()
multitool_day()
claude_survivor()
wishing_well()
grand_slam()
deep_thinker()
heart_model()
