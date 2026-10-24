import os
import sys
import re
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageOps
from svglib.svglib import svg2rlg
from reportlab.graphics import renderPM

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
CACHE = ROOT / "scripts" / "art" / "brand-cache"

OUT_BADGES.mkdir(parents=True, exist_ok=True)
OUT_TITLES.mkdir(parents=True, exist_ok=True)
SRC_BADGES.mkdir(parents=True, exist_ok=True)
SRC_TITLES.mkdir(parents=True, exist_ok=True)
CACHE.mkdir(parents=True, exist_ok=True)

def rasterize_svg_mask(svg_path, size=512, padding=128):
    target_dim = size - padding * 2
    if svg_path.stem == "gemini":
        text = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 65 65" width="512" height="512">
<path d="M32.447 0c.68 0 1.273.465 1.439 1.125a38.904 38.904 0 001.999 5.905c2.152 5 5.105 9.376 8.854 13.125 3.751 3.75 8.126 6.703 13.125 8.855a38.98 38.98 0 005.906 1.999c.66.166 1.124.758 1.124 1.438 0 .68-.464 1.273-1.125 1.439a38.902 38.902 0 00-5.905 1.999c-5 2.152-9.375 5.105-13.125 8.854-3.749 3.751-6.702 8.126-8.854 13.125a38.973 38.973 0 00-2 5.906 1.485 1.485 0 01-1.438 1.124c-.68 0-1.272-.464-1.438-1.125a38.913 38.913 0 00-2-5.905c-2.151-5-5.103-9.375-8.854-13.125-3.75-3.749-8.125-6.702-13.125-8.854a38.973 38.973 0 00-5.905-2A1.485 1.485 0 010 32.448c0-.68.465-1.272 1.125-1.438a38.903 38.903 0 005.905-2c5-2.151 9.376-5.104 13.125-8.854 3.75-3.749 6.703-8.125 8.855-13.125a38.972 38.972 0 001.999-5.905A1.485 1.485 0 0132.447 0z" fill="#000000"/>
</svg>'''
    else:
        text = svg_path.read_text(encoding="utf-8")
        text = re.sub(r'width="[^"]+"', 'width="512"', text)
        text = re.sub(r'height="[^"]+"', 'height="512"', text)
        text = text.replace("currentColor", "#000000")
        text = re.sub(r'<path(?![^>]*fill=)', '<path fill="#000000"', text)
        text = re.sub(r'fill-opacity="[^"]+"', '', text)
    
    tmp_svg = CACHE / f"_tmp_{svg_path.stem}.svg"
    tmp_svg.write_text(text, encoding="utf-8")
    drawing = svg2rlg(str(tmp_svg))
    tmp_png = CACHE / f"_tmp_{svg_path.stem}.png"
    renderPM.drawToFile(drawing, str(tmp_png), fmt="PNG")
    try:
        tmp_svg.unlink()
    except Exception:
        pass
        
    raw = Image.open(tmp_png)
    logo_mask = raw.convert("L").point(lambda v: 255 if v < 128 else 0)
    try:
        tmp_png.unlink()
    except Exception:
        pass
        
    bbox = logo_mask.getbbox()
    if not bbox:
        raise ValueError(f"Logo mask empty for {svg_path}")
        
    cropped = logo_mask.crop(bbox)
    bw, bh = cropped.size
    scale = target_dim / max(bw, bh)
    nw, nh = max(1, int(round(bw * scale))), max(1, int(round(bh * scale)))
    scaled = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    scaled_bin = scaled.point(lambda v: 255 if v > 100 else 0)
    
    canvas = Image.new("L", (size, size), 0)
    ox = (size - nw) // 2
    oy = (size - nh) // 2
    canvas.paste(scaled_bin, (ox, oy))
    return canvas

def sculpt_medallion(mask_img, base_coin, gradient_stops, rim_color=(235, 240, 248), accent_layer=None):
    m_raw = np.array(mask_img).astype(float) / 255.0
    
    # Smooth multi-scale bevel
    b1 = np.array(mask_img.filter(ImageFilter.GaussianBlur(1.5))).astype(float) / 255.0
    b3 = np.array(mask_img.filter(ImageFilter.GaussianBlur(4.0))).astype(float) / 255.0
    b8 = np.array(mask_img.filter(ImageFilter.GaussianBlur(10.0))).astype(float) / 255.0
    h = (0.5 * b1 + 0.35 * b3 + 0.15 * b8) * m_raw
    if np.max(h) > 0:
        h = h / np.max(h)
    
    # Surface gradients for lighting
    dy, dx = np.gradient(h)
    scale = 16.0
    nx = -dx * scale
    ny = -dy * scale
    nz = np.ones_like(nx)
    norm = np.sqrt(nx*nx + ny*ny + nz*nz)
    nx /= norm
    ny /= norm
    nz /= norm
    
    # Key light: upper-left (-0.6, -0.6, 0.53)
    lx, ly, lz = -0.6, -0.6, 0.53
    l_norm = math.sqrt(lx*lx + ly*ly + lz*lz)
    lx /= l_norm; ly /= l_norm; lz /= l_norm
    
    diff = np.clip(nx * lx + ny * ly + nz * lz, 0.15, 1.0)
    
    # Blinn-Phong specular
    vx, vy, vz = 0.0, 0.0, 1.0
    hx = lx + vx; hy = ly + vy; hz = lz + vz
    hn = math.sqrt(hx*hx + hy*hy + hz*hz)
    hx /= hn; hy /= hn; hz /= hn
    spec = np.clip(nx * hx + ny * hy + nz * hz, 0.0, 1.0) ** 20
    
    # Diagonal color gradient across canvas
    yy, xx = np.mgrid[0:S, 0:S].astype(float)
    t = np.clip(((xx - 100) + (yy - 100)) / (512.0 * 1.1), 0.0, 1.0)
    
    rgb_grad = np.zeros((S, S, 3), dtype=float)
    for i in range(len(gradient_stops) - 1):
        c1, p1 = gradient_stops[i]
        c2, p2 = gradient_stops[i+1]
        mask_segment = (t >= p1) & (t <= p2)
        local_t = (t - p1) / max(0.001, (p2 - p1))
        for ch in range(3):
            rgb_grad[..., ch] += np.where(mask_segment, c1[ch] + (c2[ch] - c1[ch]) * local_t, 0.0)
            
    # Apply shading to enamel
    enamel_rgb = np.zeros((S, S, 3), dtype=np.uint8)
    for ch in range(3):
        shaded = rgb_grad[..., ch] * (diff * 0.85 + 0.20) + spec * 175.0
        enamel_rgb[..., ch] = np.clip(shaded, 0, 255).astype(np.uint8)
    
    enamel_im = Image.fromarray(enamel_rgb, "RGB").convert("RGBA")
    enamel_im.putalpha(mask_img.filter(ImageFilter.GaussianBlur(0.8)))
    
    # Metal bezel rim (dilated 3px)
    dilated_mask = mask_img.filter(ImageFilter.MaxFilter(5))
    bezel_h = np.array(dilated_mask.filter(ImageFilter.GaussianBlur(2.0))).astype(float) / 255.0
    bdy, bdx = np.gradient(bezel_h)
    bnx = -bdx * 20.0
    bny = -bdy * 20.0
    bnz = np.ones_like(bnx)
    bnorm = np.sqrt(bnx*bnx + bny*bny + bnz*bnz)
    bnx /= bnorm; bny /= bnorm; bnz /= bnorm
    bdiff = np.clip(bnx * lx + bny * ly + bnz * lz, 0.2, 1.0)
    bspec = np.clip(bnx * hx + bny * hy + bnz * hz, 0.0, 1.0) ** 28
    
    bezel_rgb = np.zeros((S, S, 3), dtype=np.uint8)
    for ch in range(3):
        v = rim_color[ch] * (bdiff * 0.75 + 0.25) + bspec * 200.0
        bezel_rgb[..., ch] = np.clip(v, 0, 255).astype(np.uint8)
    
    bezel_im = Image.fromarray(bezel_rgb, "RGB").convert("RGBA")
    bezel_im.putalpha(dilated_mask.filter(ImageFilter.GaussianBlur(0.8)))
    
    # Drop shadow
    shadow_mask = dilated_mask.filter(ImageFilter.GaussianBlur(6))
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    shadow.putalpha(shadow_mask.point(lambda v: int(v * 0.65)))
    
    # Composite onto base coin
    out = base_coin.convert("RGBA")
    out.alpha_composite(shadow, (4, 5))
    out.alpha_composite(bezel_im)
    out.alpha_composite(enamel_im)
    if accent_layer is not None:
        out.alpha_composite(accent_layer)
        
    return out.convert("RGB")

def build_brand_asset(name, svg_file, gradient_stops, rim_color=(235, 240, 248), is_title=False, padding=128):
    coin = rims.house_coin()
    mask = rasterize_svg_mask(CACHE / svg_file, size=512, padding=padding)
    composed = sculpt_medallion(mask, coin, gradient_stops, rim_color=rim_color)
    
    src_dir = SRC_TITLES if is_title else SRC_BADGES
    master_path = src_dir / f"{name}.jpg"
    composed.save(master_path, quality=95)
    
    out_dir = OUT_TITLES if is_title else OUT_BADGES
    rims.save(composed, f"{name}.png", out_dir=str(out_dir))
    print(f"Minted brand medallion: {name}.png -> {out_dir}")

# ── 1. Zhipu Sage (智谱乾坤) ────────────────────────────────────────────────
def gen_zhipu_sage():
    # Official Zhipu brand logo with celestial sapphire gradient
    stops = [
        ((29, 78, 216), 0.0),   # #1d4ed8
        ((59, 130, 246), 0.45), # #3b82f6
        ((96, 165, 250), 0.85), # #60a5fa
        ((191, 219, 254), 1.0), # #bfdbfe
    ]
    build_brand_asset("zhipu-sage", "zhipu.svg", stops, rim_color=(235, 242, 250), padding=120)

# ── 2. Moonshot Voyager (暗面行者) ──────────────────────────────────────────
def gen_moonshot_voyager():
    # Official Kimi brand logo with obsidian indigo & lunar silver
    stops = [
        ((30, 27, 75), 0.0),    # #1e1b4b
        ((55, 48, 163), 0.4),   # #3730a3
        ((99, 102, 241), 0.8),  # #6366f1
        ((224, 231, 255), 1.0), # #e0e7ff
    ]
    build_brand_asset("moonshot-voyager", "kimi.svg", stops, rim_color=(220, 228, 242), padding=128)

# ── 3. MiniMax Abyss (海螺巨兽) ─────────────────────────────────────────────
def gen_minimax_abyss():
    # Official Hailuo AI chambered nautilus conch shell with abyssal oceanic teal
    stops = [
        ((4, 47, 46), 0.0),     # #042f2e
        ((15, 118, 110), 0.35), # #0f766e
        ((20, 184, 166), 0.75), # #14b8a6
        ((94, 234, 212), 1.0),  # #5eead4
    ]
    build_brand_asset("minimax-abyss", "hailuo.svg", stops, rim_color=(240, 230, 210), padding=120)

# ── 4. North America Doubao (北美豆包 / Google Gemini) ─────────────────────
def gen_north_america_doubao():
    # Official Google Gemini 4-pointed sparkle star with iconic 4-stop celestial gradient
    stops = [
        ((59, 130, 246), 0.0),  # #3b82f6 (Google blue)
        ((139, 92, 246), 0.38), # #8b5cf6 (violet)
        ((236, 72, 153), 0.72), # #ec4899 (magenta pink)
        ((245, 158, 11), 1.0),  # #f59e0b (golden flare)
    ]
    build_brand_asset("north-america-doubao", "gemini.svg", stops, rim_color=(245, 248, 255), padding=120)

# ── 5. Hyperspeed Grok (极速狂飙) ──────────────────────────────────────────
def gen_hyperspeed_grok():
    # Official xAI Grok mark with titanium chrome & electric crimson accent
    stops = [
        ((30, 41, 59), 0.0),    # #1e293b
        ((71, 85, 105), 0.35),  # #475569
        ((148, 163, 184), 0.7), # #94a3b8
        ((241, 245, 249), 1.0), # #f1f5f9
    ]
    build_brand_asset("hyperspeed-grok", "grok.svg", stops, rim_color=(250, 252, 255), padding=124)

# ── 6. Qwen Dynasty (通义宗师) ──────────────────────────────────────────────
def gen_qwen_dynasty():
    # Official Alibaba Qwen logo with royal amethyst & violet enamel
    stops = [
        ((88, 28, 135), 0.0),   # #581c87
        ((124, 58, 237), 0.4),  # #7c3aed
        ((168, 85, 247), 0.75), # #a855f7
        ((216, 180, 254), 1.0), # #d8b4fe
    ]
    build_brand_asset("qwen-dynasty", "qwen.svg", stops, rim_color=(242, 242, 250), padding=120)

# ── 7. Seedance Master (灵动之种 / 字节豆包) ───────────────────────────────
def gen_seedance_master():
    # Official ByteDance Doubao mark with vibrant cyan-orange dual enamel
    stops = [
        ((2, 132, 199), 0.0),   # #0284c7
        ((56, 189, 248), 0.5),  # #38bdf8
        ((249, 115, 22), 0.85), # #f97316
        ((251, 146, 60), 1.0),  # #fb923c
    ]
    build_brand_asset("seedance-master", "doubao.svg", stops, rim_color=(245, 235, 230), padding=124)

# ── 8. Flash Immortal (Flash 仙人) ──────────────────────────────────────────
def gen_flash_immortal():
    # Thunderbolt crossing quantum energy rings
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    cx, cy = 256, 256
    
    # Concentric orbit rings
    d.ellipse((cx - 140, cy - 140, cx + 140, cy + 140), outline=255, width=12)
    d.ellipse((cx - 100, cy - 100, cx + 100, cy + 100), outline=255, width=6)
    
    # Dynamic thunderbolt
    bolt = [
        (cx + 40, cy - 150),
        (cx - 70, cy - 10),
        (cx - 10, cy - 10),
        (cx - 50, cy + 150),
        (cx + 80, cy + 10),
        (cx + 15, cy + 10),
    ]
    d.polygon(bolt, fill=255)
    
    stops = [
        ((202, 138, 4), 0.0),   # #ca8a04
        ((234, 179, 8), 0.4),   # #eab308
        ((250, 204, 21), 0.7),  # #facc15
        ((56, 189, 248), 1.0),  # #38bdf8 (electric flash)
    ]
    coin = rims.house_coin()
    composed = sculpt_medallion(mask, coin, stops, rim_color=(250, 240, 200))
    master_path = SRC_BADGES / "flash-immortal.jpg"
    composed.save(master_path, quality=95)
    rims.save(composed, "flash-immortal.png", out_dir=str(OUT_BADGES))
    print(f"Minted flash-immortal.png -> {OUT_BADGES}")

# ── 9. Token Arbitrageur (算力套利 · 羊毛宗师) ──────────────────────────────
def gen_token_arbitrageur():
    # Golden scales of justice balancing multi-cloud token coins
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    cx, cy = 256, 256
    
    # Scale pillar & base
    d.rectangle((cx - 8, cy - 120, cx + 8, cy + 110), fill=255)
    d.polygon([(cx - 70, cy + 130), (cx + 70, cy + 130), (cx + 35, cy + 110), (cx - 35, cy + 110)], fill=255)
    
    # Balance beam (slanted slightly for dynamic arbitrage)
    d.polygon([(cx - 130, cy - 90), (cx + 130, cy - 70), (cx + 130, cy - 58), (cx - 130, cy - 78)], fill=255)
    d.ellipse((cx - 20, cy - 135, cx + 20, cy - 95), fill=255)
    
    # Left pan & chains (lower - arbitrage surplus)
    d.line((cx - 120, cy - 80, cx - 145, cy + 15), fill=255, width=4)
    d.line((cx - 120, cy - 80, cx - 95, cy + 15), fill=255, width=4)
    d.arc((cx - 150, cy + 5, cx - 90, cy + 45), 0, 180, fill=255, width=8)
    d.ellipse((cx - 130, cy + 10, cx - 110, cy + 25), fill=255)
    
    # Right pan & chains
    d.line((cx + 120, cy - 65, cx + 95, cy + 30), fill=255, width=4)
    d.line((cx + 120, cy - 65, cx + 145, cy + 30), fill=255, width=4)
    d.arc((cx + 90, cy + 20, cx + 150, cy + 60), 0, 180, fill=255, width=8)
    d.ellipse((cx + 110, cy + 25, cx + 130, cy + 40), fill=255)
    
    stops = [
        ((5, 150, 105), 0.0),   # #059669
        ((16, 185, 129), 0.4),  # #10b981
        ((245, 158, 11), 0.8),  # #f59e0b
        ((251, 191, 36), 1.0),  # #fbbf24
    ]
    coin = rims.house_coin()
    composed = sculpt_medallion(mask, coin, stops, rim_color=(245, 225, 170))
    master_path = SRC_BADGES / "token-arbitrageur.jpg"
    composed.save(master_path, quality=95)
    rims.save(composed, "token-arbitrageur.png", out_dir=str(OUT_BADGES))
    print(f"Minted token-arbitrageur.png -> {OUT_BADGES}")

# ── 10. Title Crest: CN Quad Masters (九州极客 · 四象掌门) ──────────────────
def gen_title_cn_quad_masters():
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    cx, cy = 256, 256
    
    # Four-pointed celestial diamond crest
    diamond = [
        (cx, cy - 145),
        (cx + 145, cy),
        (cx, cy + 145),
        (cx - 145, cy),
    ]
    d.polygon(diamond, outline=255, width=14)
    
    # 4 quadrant orbs representing four Chinese AI titans
    d.ellipse((cx - 20, cy - 120, cx + 20, cy - 80), fill=255) # Top (DeepSeek)
    d.ellipse((cx + 80, cy - 20, cx + 120, cy + 20), fill=255) # Right (Zhipu)
    d.ellipse((cx - 20, cy + 80, cx + 20, cy + 120), fill=255) # Bottom (MiniMax)
    d.ellipse((cx - 120, cy - 20, cx - 80, cy + 20), fill=255) # Left (Moonshot)
    
    # Central Tai-chi core nexus
    d.ellipse((cx - 45, cy - 45, cx + 45, cy + 45), fill=255)
    
    stops = [
        ((180, 83, 9), 0.0),    # #b45309 (gold amber)
        ((16, 185, 129), 0.45), # #10b981 (emerald jade)
        ((245, 158, 11), 0.8),  # #f59e0b
        ((254, 240, 138), 1.0), # #fef08a
    ]
    coin = rims.house_coin()
    composed = sculpt_medallion(mask, coin, stops, rim_color=(250, 235, 180))
    master_path = SRC_TITLES / "title-cn-quad-masters.jpg"
    composed.save(master_path, quality=95)
    rims.save(composed, "title-cn-quad-masters.png", out_dir=str(OUT_TITLES))
    print(f"Minted title-cn-quad-masters.png -> {OUT_TITLES}")

# ── 11. Title Crest: Silicon Trinity (诸神信使 · 硅谷三冠王) ────────────────
def gen_title_silicon_trinity():
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    cx, cy = 256, 256
    
    # Tri-force sacred delta
    r = 145
    pts = [
        (cx, cy - r),
        (cx + r * math.cos(math.radians(30)), cy + r * math.sin(math.radians(30))),
        (cx - r * math.cos(math.radians(30)), cy + r * math.sin(math.radians(30))),
    ]
    d.polygon(pts, outline=255, width=14)
    
    # Internal delta triad
    inner_r = 75
    in_pts = [
        (cx, cy + inner_r),
        (cx + inner_r * math.cos(math.radians(30)), cy - inner_r * math.sin(math.radians(30))),
        (cx - inner_r * math.cos(math.radians(30)), cy - inner_r * math.sin(math.radians(30))),
    ]
    d.polygon(in_pts, outline=255, width=8)
    d.ellipse((cx - 28, cy - 28, cx + 28, cy + 28), fill=255)
    
    stops = [
        ((13, 148, 136), 0.0),  # #0d9488 (OpenAI teal)
        ((79, 70, 229), 0.45),  # #4f46e5 (Anthropic violet)
        ((6, 182, 212), 0.8),   # #06b6d4 (Google celestial)
        ((165, 243, 252), 1.0), # #a5f3fc
    ]
    coin = rims.house_coin()
    composed = sculpt_medallion(mask, coin, stops, rim_color=(230, 245, 255))
    master_path = SRC_TITLES / "title-silicon-trinity.jpg"
    composed.save(master_path, quality=95)
    rims.save(composed, "title-silicon-trinity.png", out_dir=str(OUT_TITLES))
    print(f"Minted title-silicon-trinity.png -> {OUT_TITLES}")

# ── 12. Title Crest: Cyber Speedster (极速先锋 · 赛博狂飙者) ────────────────
def gen_title_cyber_speedster():
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    cx, cy = 256, 256
    
    # Curvature sonic rings
    d.ellipse((cx - 140, cy - 80, cx + 140, cy + 80), outline=255, width=12)
    
    # Falcon hyper-speed sweep wings
    wings = [
        (cx, cy - 145),
        (cx + 155, cy + 65),
        (cx + 90, cy + 65),
        (cx, cy - 35),
        (cx - 90, cy + 65),
        (cx - 155, cy + 65),
    ]
    d.polygon(wings, fill=255)
    d.ellipse((cx - 24, cy - 24, cx + 24, cy + 24), fill=255)
    
    stops = [
        ((2, 132, 199), 0.0),   # #0284c7
        ((14, 165, 233), 0.4),  # #0ea5e9 (sky cyan)
        ((168, 85, 247), 0.8),  # #a855f7 (warp violet)
        ((236, 72, 153), 1.0),  # #ec4899 (hyperspeed flare)
    ]
    coin = rims.house_coin()
    composed = sculpt_medallion(mask, coin, stops, rim_color=(240, 248, 255))
    master_path = SRC_TITLES / "title-cyber-speedster.jpg"
    composed.save(master_path, quality=95)
    rims.save(composed, "title-cyber-speedster.png", out_dir=str(OUT_TITLES))
    print(f"Minted title-cyber-speedster.png -> {OUT_TITLES}")

def main():
    print("=== Minting Official Brand 3D Medallions (Wave 4) ===")
    gen_zhipu_sage()
    gen_moonshot_voyager()
    gen_minimax_abyss()
    gen_north_america_doubao()
    gen_hyperspeed_grok()
    gen_qwen_dynasty()
    gen_flash_immortal()
    gen_seedance_master()
    gen_token_arbitrageur()
    
    print("\n=== Minting Synergy Title Crests (Wave 4) ===")
    gen_title_cn_quad_masters()
    gen_title_silicon_trinity()
    gen_title_cyber_speedster()
    print("\nAll 12 assets successfully sculpted and minted!")

if __name__ == "__main__":
    main()
