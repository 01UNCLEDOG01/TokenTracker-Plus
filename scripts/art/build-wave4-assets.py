import os
import sys
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageOps

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "art"))

import importlib.util
spec = importlib.util.spec_from_file_location("rims", str(ROOT / "scripts" / "art" / "rebuild-badge-rims.py"))
rims = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rims)

S = 512
C = (S - 1) / 2.0
OUT_BADGES = ROOT / "dashboard" / "public" / "achievements"
OUT_TITLES = ROOT / "dashboard" / "public" / "achievements" / "titles"
SRC_BADGES = ROOT / "scripts" / "art" / "source-badges"
SRC_TITLES = ROOT / "scripts" / "art" / "source-titles"

OUT_BADGES.mkdir(parents=True, exist_ok=True)
OUT_TITLES.mkdir(parents=True, exist_ok=True)
SRC_BADGES.mkdir(parents=True, exist_ok=True)
SRC_TITLES.mkdir(parents=True, exist_ok=True)

STEEL = 235
ACCENT_H = 205
EMBLEM_TARGET = 0.74 * S

def new_layer():
    return Image.new("L", (S, S), 0), Image.new("RGBA", (S, S), (0, 0, 0, 0))

def emboss(height_map):
    shifted = ImageChops.offset(height_map, 3, 3)
    relief = ImageChops.subtract(height_map, shifted, 1.6, 112)
    return ImageOps.colorize(
        relief, black=(14, 16, 19), white=(240, 244, 249), mid=(120, 130, 141)
    )

def scale_emblem(height_map, accent_layer, target=EMBLEM_TARGET):
    boxes = [l.getbbox() for l in (height_map, accent_layer)]
    boxes = [b for b in boxes if b]
    if not boxes:
        return height_map, accent_layer
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    x1 = max(b[2] for b in boxes)
    y1 = max(b[3] for b in boxes)
    factor = target / float(max(x1 - x0, y1 - y0))
    w = max(1, int((x1 - x0) * factor))
    hgt = max(1, int((y1 - y0) * factor))
    limit = 196.0
    far = max(
        math.hypot(px - S / 2.0, py - S / 2.0)
        for px, py in (
            ((S - w) / 2.0, (S - hgt) / 2.0),
            ((S + w) / 2.0, (S - hgt) / 2.0),
            ((S - w) / 2.0, (S + hgt) / 2.0),
            ((S + w) / 2.0, (S + hgt) / 2.0),
        )
    )
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

def compose_emblem(coin, height_map, accent_layer):
    metal = emboss(height_map).convert("RGBA")
    mask = height_map.point(lambda v: 255 if v > 6 else 0)
    mask = mask.filter(ImageFilter.GaussianBlur(1.4))
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    shadow.putalpha(mask.filter(ImageFilter.GaussianBlur(6)).point(lambda v: int(v * 0.55)))
    out = coin.convert("RGBA")
    out.alpha_composite(shadow, (4, 5))
    metal.putalpha(mask)
    out.alpha_composite(metal)
    if accent_layer is not None:
        out.alpha_composite(accent_layer)
    return out.convert("RGB")

def build_asset(name, h, acc, is_title=False):
    coin = rims.house_coin()
    h_scaled, acc_scaled = scale_emblem(h, acc)
    composed = compose_emblem(coin, h_scaled, acc_scaled)
    
    # Save master JPG to source directory
    src_dir = SRC_TITLES if is_title else SRC_BADGES
    master_path = src_dir / f"{name}.jpg"
    composed.save(master_path, quality=95)
    
    # Save minted PNG with binary alpha
    out_dir = OUT_TITLES if is_title else OUT_BADGES
    rims.save(composed, f"{name}.png", out_dir=str(out_dir))
    print(f"Minted: {name}.png -> {out_dir}")

# ── 1. Zhipu Sage (智谱乾坤) ────────────────────────────────────────────────
def gen_zhipu_sage():
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    CYAN = (56, 189, 248, 240)
    cx, cy = 256, 256
    
    # Hexagon vertices
    def hex_pts(r):
        return [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))) for a in range(30, 390, 60)]
    
    dh.polygon(hex_pts(150), outline=STEEL, width=10)
    dh.polygon(hex_pts(110), outline=ACCENT_H, width=6)
    da.polygon(hex_pts(110), outline=CYAN, width=6)
    
    # Radial traces & nodes
    for p in hex_pts(150):
        dh.line((cx, cy, p[0], p[1]), fill=STEEL, width=5)
        dh.ellipse((p[0]-14, p[1]-14, p[0]+14, p[1]+14), fill=ACCENT_H)
        da.ellipse((p[0]-14, p[1]-14, p[0]+14, p[1]+14), fill=CYAN)
    
    # Central cubic core
    dh.ellipse((cx-40, cy-40, cx+40, cy+40), fill=STEEL)
    dh.polygon(hex_pts(30), fill=ACCENT_H)
    da.polygon(hex_pts(30), fill=CYAN)
    
    build_asset("zhipu-sage", h, acc)

# ── 2. Moonshot Voyager (暗面行者) ──────────────────────────────────────────
def gen_moonshot_voyager():
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    VIOLET = (192, 132, 252, 240)
    
    # Crescent moon
    m1 = Image.new("L", (S, S), 0)
    ImageDraw.Draw(m1).ellipse((200, 100, 360, 260), fill=255)
    m2 = Image.new("L", (S, S), 0)
    ImageDraw.Draw(m2).ellipse((235, 90, 395, 250), fill=255)
    cres = ImageChops.subtract(m1, m2)
    h.paste(Image.new("L", (S, S), ACCENT_H), mask=cres)
    acc.paste(Image.new("RGBA", (S, S), VIOLET), mask=cres)
    
    # Lunar terrain curve
    dh.arc((80, 260, 432, 540), 180, 360, fill=STEEL, width=12)
    # Craters on terrain
    dh.ellipse((140, 340, 180, 360), outline=STEEL, width=4)
    dh.ellipse((320, 330, 370, 355), outline=STEEL, width=4)
    
    # Rover Chassis
    dh.rectangle((210, 280, 302, 310), fill=STEEL)
    # 4 Wheels
    for wx in (215, 240, 272, 297):
        dh.ellipse((wx-12, 305, wx+12, 329), fill=STEEL, outline=ACCENT_H, width=3)
        da.ellipse((wx-6, 311, wx+6, 323), fill=VIOLET)
    # Rover Antenna mast
    dh.line((235, 280, 235, 240), fill=STEEL, width=4)
    dh.arc((220, 225, 250, 255), 210, 330, fill=STEEL, width=5)
    dh.line((245, 280, 280, 255), fill=STEEL, width=3)
    
    # Stars
    for sx, sy in ((140, 160), (380, 140), (120, 220), (390, 230), (280, 80)):
        dh.ellipse((sx-4, sy-4, sx+4, sy+4), fill=STEEL)
        da.ellipse((sx-3, sy-3, sx+3, sy+3), fill=VIOLET)
        
    build_asset("moonshot-voyager", h, acc)

# ── 3. MiniMax Abyss (海螺巨兽) ─────────────────────────────────────────────
def gen_minimax_abyss():
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    AQUA = (45, 212, 191, 240)
    cx, cy = 256, 256
    
    # Expanding Nautilus Shell segments
    radii = [150, 125, 100, 78, 58, 40, 25]
    for i, r in enumerate(radii):
        ox = cx - int(r * 0.22 * math.cos(i * 0.7))
        oy = cy + int(r * 0.15 * math.sin(i * 0.7))
        fill_val = STEEL if i % 2 == 0 else ACCENT_H
        dh.ellipse((ox - r, oy - r, ox + r, oy + r), outline=STEEL, width=6)
        if i % 2 == 1:
            da.arc((ox - r, oy - r, ox + r, oy + r), 40 * i, 40 * i + 120, fill=AQUA, width=6)
            
    # Spiral ridges
    for deg in range(0, 360, 45):
        rad = math.radians(deg)
        x1 = cx + 50 * math.cos(rad)
        y1 = cy + 50 * math.sin(rad)
        x2 = cx + 145 * math.cos(rad)
        y2 = cy + 145 * math.sin(rad)
        dh.line((x1, y1, x2, y2), fill=STEEL, width=4)
        
    # Tentacles extending below
    for tx in (-60, -20, 20, 60):
        dh.arc((cx + tx - 25, cy + 90, cx + tx + 25, cy + 165), 0, 180, fill=STEEL, width=7)
        da.arc((cx + tx - 25, cy + 90, cx + tx + 25, cy + 165), 30, 150, fill=AQUA, width=5)
        
    build_asset("minimax-abyss", h, acc)

# ── 4. North America Doubao / Google Gemini (北美豆包) ──────────────────────
def gen_north_america_doubao():
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    BLUE = (96, 165, 250, 240)
    cx, cy = 256, 256
    
    # Gemini 4-pointed diamond star
    pts = []
    # 4 tips at 145px, 4 valleys at 32px
    for i in range(8):
        ang = math.radians(i * 45)
        r = 148 if i % 2 == 0 else 36
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    
    dh.polygon(pts, fill=STEEL, outline=ACCENT_H)
    da.polygon(pts, fill=BLUE)
    
    # Inner facets
    for i in range(4):
        ang = math.radians(i * 90)
        p_tip = (cx + 148 * math.cos(ang), cy + 148 * math.sin(ang))
        dh.line((cx, cy, p_tip[0], p_tip[1]), fill=STEEL, width=5)
        
    # Orbiting planetary ring
    dh.arc((cx - 155, cy - 70, cx + 155, cy + 70), 0, 360, fill=STEEL, width=6)
    da.arc((cx - 155, cy - 70, cx + 155, cy + 70), 30, 210, fill=BLUE, width=5)
    
    # Diamond spark satellites
    for sx, sy in ((cx-110, cy-110), (cx+110, cy-110), (cx-110, cy+110), (cx+110, cy+110)):
        dh.ellipse((sx-8, sy-8, sx+8, sy+8), fill=STEEL)
        da.ellipse((sx-6, sy-6, sx+6, sy+6), fill=BLUE)
        
    build_asset("north-america-doubao", h, acc)

# ── 5. Hyperspeed Grok (极速狂飙) ───────────────────────────────────────────
def gen_hyperspeed_grok():
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    CRIMSON = (244, 63, 94, 240)
    AMBER = (251, 191, 36, 240)
    cx, cy = 256, 256
    
    # Mach rings expanding backwards
    for r in (155, 125, 95):
        dh.arc((cx - r - 40, cy - r + 40, cx + r - 40, cy + r + 40), 70, 220, fill=STEEL, width=6)
        da.arc((cx - r - 40, cy - r + 40, cx + r - 40, cy + r + 40), 90, 200, fill=CRIMSON, width=5)
        
    # Relativistic Rocket body pointing to (cx+90, cy-90)
    # Fuselage polygon
    body = [
        (cx + 115, cy - 115), # nose
        (cx + 40, cy - 80),   # right shoulder
        (cx - 30, cy + 10),   # right fin tip
        (cx - 45, cy - 0),    # right nozzle
        (cx - 0, cy + 45),    # left nozzle
        (cx + 10, cy + 30),   # left fin tip
        (cx - 80, cy + 40),   # left shoulder
    ]
    dh.polygon(body, fill=STEEL, outline=ACCENT_H)
    da.polygon(body, outline=AMBER)
    
    # Twin plasma thruster flames
    plume = [(cx - 20, cy + 20), (cx - 100, cy + 100), (cx + 20, cy - 20)]
    dh.polygon(plume, fill=ACCENT_H)
    da.polygon(plume, fill=CRIMSON)
    
    build_asset("hyperspeed-grok", h, acc)

# ── 6. Qwen Dynasty (通义宗师) ──────────────────────────────────────────────
def gen_qwen_dynasty():
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    GOLD = (251, 191, 36, 240)
    cx, cy = 256, 256
    
    # 3D Isometric Quantum Cube
    top = [(cx, cy - 115), (cx + 95, cy - 60), (cx, cy - 5), (cx - 95, cy - 60)]
    left = [(cx - 95, cy - 60), (cx, cy - 5), (cx, cy + 105), (cx - 95, cy + 50)]
    right = [(cx, cy - 5), (cx + 95, cy - 60), (cx + 95, cy + 50), (cx, cy + 105)]
    
    dh.polygon(top, fill=STEEL, outline=ACCENT_H)
    dh.polygon(left, fill=ACCENT_H, outline=STEEL)
    dh.polygon(right, fill=STEEL, outline=ACCENT_H)
    
    da.polygon(top, outline=GOLD)
    da.polygon(left, outline=GOLD)
    da.polygon(right, outline=GOLD)
    
    # Circuit etchings on faces
    for face in (left, right):
        mid_x = (face[0][0] + face[2][0]) // 2
        mid_y = (face[0][1] + face[2][1]) // 2
        dh.ellipse((mid_x-10, mid_y-10, mid_x+10, mid_y+10), fill=ACCENT_H)
        da.ellipse((mid_x-8, mid_y-8, mid_x+8, mid_y+8), fill=GOLD)
        
    # Central glyph in top face
    dh.ellipse((cx-18, cy-60-18, cx+18, cy-60+18), fill=STEEL)
    da.ellipse((cx-14, cy-60-14, cx+14, cy-60+14), fill=GOLD)
    
    build_asset("qwen-dynasty", h, acc)

# ── 7. Flash Immortal (Flash 仙人) ──────────────────────────────────────────
def gen_flash_immortal():
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    YELLOW = (250, 204, 21, 240)
    cx, cy = 256, 256
    
    # Cloud Pedestal Base
    dh.arc((cx - 130, cy + 80, cx - 20, cy + 160), 180, 360, fill=STEEL, width=8)
    dh.arc((cx - 60, cy + 55, cx + 60, cy + 155), 180, 360, fill=STEEL, width=10)
    dh.arc((cx + 20, cy + 80, cx + 130, cy + 160), 180, 360, fill=STEEL, width=8)
    dh.rectangle((cx - 120, cy + 120, cx + 120, cy + 136), fill=STEEL)
    
    # High-Voltage Lightning Bolt
    bolt = [
        (cx + 25, cy - 145),
        (cx - 35, cy - 25),
        (cx + 15, cy - 25),
        (cx - 45, cy + 115),
        (cx + 40, cy - 5),
        (cx - 10, cy - 5),
        (cx + 45, cy - 145),
    ]
    dh.polygon(bolt, fill=STEEL, outline=ACCENT_H)
    da.polygon(bolt, fill=YELLOW)
    
    # Radiating electrical sparks
    for sx, sy in ((cx - 85, cy - 90), (cx + 85, cy - 90), (cx - 95, cy + 20), (cx + 95, cy + 20)):
        dh.ellipse((sx-6, sy-6, sx+6, sy+6), fill=STEEL)
        da.ellipse((sx-5, sy-5, sx+5, sy+5), fill=YELLOW)
        
    build_asset("flash-immortal", h, acc)

# ── 8. Seedance Master (灵动之种) ───────────────────────────────────────────
def gen_seedance_master():
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    LIME = (74, 222, 128, 240)
    cx, cy = 256, 256
    
    # Sound frequency rhythm waves (lateral arcs)
    for r in (110, 135, 160):
        dh.arc((cx - r, cy - r, cx + r, cy + r), 140, 220, fill=STEEL, width=5)
        dh.arc((cx - r, cy - r, cx + r, cy + r), 320, 400, fill=STEEL, width=5)
        da.arc((cx - r, cy - r, cx + r, cy + r), 150, 210, fill=LIME, width=4)
        da.arc((cx - r, cy - r, cx + r, cy + r), 330, 390, fill=LIME, width=4)
        
    # Sprouting Seed Pod
    dh.ellipse((cx - 30, cy + 60, cx + 30, cy + 120), fill=STEEL, outline=ACCENT_H, width=4)
    da.ellipse((cx - 24, cy + 66, cx + 24, cy + 114), fill=LIME)
    
    # Sprout Stem
    dh.line((cx, cy + 70, cx, cy - 30), fill=STEEL, width=8)
    
    # Twin Dynamic Leaves
    left_leaf = [(cx, cy - 30), (cx - 75, cy - 70), (cx - 50, cy - 130), (cx, cy - 60)]
    right_leaf = [(cx, cy - 30), (cx + 75, cy - 70), (cx + 50, cy - 130), (cx, cy - 60)]
    
    dh.polygon(left_leaf, fill=STEEL, outline=ACCENT_H)
    dh.polygon(right_leaf, fill=STEEL, outline=ACCENT_H)
    da.polygon(left_leaf, fill=LIME)
    da.polygon(right_leaf, fill=LIME)
    
    build_asset("seedance-master", h, acc)

# ── 9. Token Arbitrageur (算力套利 · 羊毛宗师) ──────────────────────────────
def gen_token_arbitrageur():
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    EMERALD = (52, 211, 153, 240)
    GOLD = (251, 191, 36, 240)
    cx, cy = 256, 256
    
    # Scale Central Pillar & Base
    dh.rectangle((cx - 70, cy + 125, cx + 70, cy + 145), fill=STEEL)
    dh.line((cx, cy - 90, cx, cy + 130), fill=STEEL, width=10)
    dh.ellipse((cx - 18, cy - 105, cx + 18, cy - 70), fill=STEEL)
    da.ellipse((cx - 12, cy - 100, cx + 12, cy - 75), fill=GOLD)
    
    # Beam (tilted slightly)
    dh.line((cx - 125, cy - 45, cx + 125, cy - 75), fill=STEEL, width=8)
    
    # Left Pan (Compute Chips)
    lx, ly = cx - 125, cy - 45
    dh.line((lx, ly, lx - 30, ly + 90), fill=STEEL, width=3)
    dh.line((lx, ly, lx + 30, ly + 90), fill=STEEL, width=3)
    dh.arc((lx - 40, ly + 75, lx + 40, ly + 105), 0, 180, fill=STEEL, width=6)
    dh.rectangle((lx - 18, ly + 65, lx + 18, ly + 85), fill=ACCENT_H)
    da.rectangle((lx - 14, ly + 68, lx + 14, ly + 82), fill=EMERALD)
    
    # Right Pan (Shears / Wool)
    rx, ry = cx + 125, cy - 75
    dh.line((rx, ry, rx - 30, ry + 90), fill=STEEL, width=3)
    dh.line((rx, ry, rx + 30, ry + 90), fill=STEEL, width=3)
    dh.arc((rx - 40, ry + 75, rx + 40, ry + 105), 0, 180, fill=STEEL, width=6)
    dh.ellipse((rx - 16, ry + 70, rx + 16, ry + 88), fill=ACCENT_H)
    da.ellipse((rx - 12, ry + 72, rx + 12, ry + 86), fill=GOLD)
    
    build_asset("token-arbitrageur", h, acc)

# ── 10. Title Crest: CN Quad Masters (九州极客 · 四象掌门) ──────────────────
def gen_title_cn_quad_masters():
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    AMBER = (245, 158, 11, 240)
    JADE = (16, 185, 129, 240)
    cx, cy = 256, 256
    
    # Outer mystic compass ring
    dh.arc((cx - 150, cy - 150, cx + 150, cy + 150), 0, 360, fill=STEEL, width=10)
    da.arc((cx - 150, cy - 150, cx + 150, cy + 150), 0, 360, fill=AMBER, width=4)
    
    # 4 Cardinal Beast Orbs (North, East, South, West)
    cards = [(cx, cy - 150), (cx + 150, cy), (cx, cy + 150), (cx - 150, cy)]
    for px, py in cards:
        dh.ellipse((px - 22, py - 22, px + 22, py + 22), fill=STEEL)
        da.ellipse((px - 16, py - 16, px + 16, py + 16), fill=AMBER)
        
    # Central Taiji Core
    dh.ellipse((cx - 60, cy - 60, cx + 60, cy + 60), fill=STEEL)
    da.arc((cx - 60, cy - 60, cx + 60, cy + 60), 0, 180, fill=AMBER, width=8)
    da.arc((cx - 60, cy - 60, cx + 60, cy + 60), 180, 360, fill=JADE, width=8)
    
    # Connecting quad conduits
    for px, py in cards:
        dh.line((cx, cy, px, py), fill=STEEL, width=6)
        
    build_asset("title-cn-quad-masters", h, acc, is_title=True)

# ── 11. Title Crest: Silicon Trinity (诸神信使 · 硅谷三冠王) ────────────────
def gen_title_silicon_trinity():
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    CYAN = (6, 182, 212, 240)
    cx, cy = 256, 256
    
    # Sacred Equilateral Triangle
    r = 155
    pts = [
        (cx + r * math.cos(math.radians(-90)), cy + r * math.sin(math.radians(-90))),
        (cx + r * math.cos(math.radians(30)), cy + r * math.sin(math.radians(30))),
        (cx + r * math.cos(math.radians(150)), cy + r * math.sin(math.radians(150))),
    ]
    dh.polygon(pts, outline=STEEL, width=12)
    da.polygon(pts, outline=CYAN, width=6)
    
    # Vertex Orbs (OpenAI, Claude, Google)
    for px, py in pts:
        dh.ellipse((px - 24, py - 24, px + 24, py + 24), fill=STEEL)
        da.ellipse((px - 16, py - 16, px + 16, py + 16), fill=CYAN)
        dh.line((cx, cy, px, py), fill=STEEL, width=6)
        
    # Radiant Eye Singularity at center
    dh.ellipse((cx - 42, cy - 42, cx + 42, cy + 42), fill=STEEL)
    da.ellipse((cx - 30, cy - 30, cx + 30, cy + 30), fill=CYAN)
    
    build_asset("title-silicon-trinity", h, acc, is_title=True)

# ── 12. Title Crest: Cyber Speedster (极速先锋 · 赛博狂飙者) ────────────────
def gen_title_cyber_speedster():
    h, acc = new_layer()
    dh, da = ImageDraw.Draw(h), ImageDraw.Draw(acc)
    SKY = (56, 189, 248, 240)
    cx, cy = 256, 256
    
    # Hypersonic Delta Wings
    wings = [
        (cx, cy - 140),     # apex nose
        (cx + 155, cy + 70), # right wingtip
        (cx + 90, cy + 85),  # right inner notch
        (cx + 40, cy + 140), # right thruster
        (cx, cy + 105),      # center keel
        (cx - 40, cy + 140), # left thruster
        (cx - 90, cy + 85),  # left inner notch
        (cx - 155, cy + 70), # left wingtip
    ]
    dh.polygon(wings, fill=STEEL, outline=ACCENT_H)
    da.polygon(wings, outline=SKY)
    
    # Tachyon speed streams
    for y in (cy - 40, cy, cy + 40):
        dh.line((cx - 160, y, cx + 160, y), fill=STEEL, width=4)
        da.line((cx - 130, y, cx + 130, y), fill=SKY, width=3)
        
    # Warp core center
    dh.ellipse((cx - 28, cy - 10, cx + 28, cy + 46), fill=STEEL)
    da.ellipse((cx - 20, cy - 2, cx + 20, cy + 38), fill=SKY)
    
    build_asset("title-cyber-speedster", h, acc, is_title=True)

def main():
    print("=== Generating 9 Wave-4 Achievement Medallions ===")
    gen_zhipu_sage()
    gen_moonshot_voyager()
    gen_minimax_abyss()
    gen_north_america_doubao()
    gen_hyperspeed_grok()
    gen_qwen_dynasty()
    gen_flash_immortal()
    gen_seedance_master()
    gen_token_arbitrageur()
    
    print("\n=== Generating 3 Wave-4 Title Crest Medallions ===")
    gen_title_cn_quad_masters()
    gen_title_silicon_trinity()
    gen_title_cyber_speedster()
    print("\nAll assets successfully generated!")

if __name__ == "__main__":
    main()
