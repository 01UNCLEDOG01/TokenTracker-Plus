import os
import sys
import math
import re
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
SRC_BADGES = ROOT / "scripts" / "art" / "source-badges"
CACHE = ROOT / "scripts" / "art" / "brand-cache"

def sculpt_medallion(mask_img, base_coin, gradient_stops, rim_color=(235, 240, 248), accent_layer=None):
    m_raw = np.array(mask_img).astype(float) / 255.0
    
    b1 = np.array(mask_img.filter(ImageFilter.GaussianBlur(1.5))).astype(float) / 255.0
    b3 = np.array(mask_img.filter(ImageFilter.GaussianBlur(4.0))).astype(float) / 255.0
    b8 = np.array(mask_img.filter(ImageFilter.GaussianBlur(10.0))).astype(float) / 255.0
    h = (0.5 * b1 + 0.35 * b3 + 0.15 * b8) * m_raw
    if np.max(h) > 0:
        h = h / np.max(h)
    
    dy, dx = np.gradient(h)
    scale = 16.0
    nx = -dx * scale
    ny = -dy * scale
    nz = np.ones_like(nx)
    norm = np.sqrt(nx*nx + ny*ny + nz*nz)
    nx /= norm; ny /= norm; nz /= norm
    
    lx, ly, lz = -0.6, -0.6, 0.53
    l_norm = math.sqrt(lx*lx + ly*ly + lz*lz)
    lx /= l_norm; ly /= l_norm; lz /= l_norm
    diff = np.clip(nx * lx + ny * ly + nz * lz, 0.15, 1.0)
    
    vx, vy, vz = 0.0, 0.0, 1.0
    hx = lx + vx; hy = ly + vy; hz = lz + vz
    hn = math.sqrt(hx*hx + hy*hy + hz*hz)
    hx /= hn; hy /= hn; hz /= hn
    spec = np.clip(nx * hx + ny * hy + nz * hz, 0.0, 1.0) ** 20
    
    # Diagonal color ramp
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
            
    enamel_rgb = np.zeros((S, S, 3), dtype=np.uint8)
    for ch in range(3):
        shaded = rgb_grad[..., ch] * (diff * 0.85 + 0.20) + spec * 175.0
        enamel_rgb[..., ch] = np.clip(shaded, 0, 255).astype(np.uint8)
    
    enamel_im = Image.fromarray(enamel_rgb, "RGB").convert("RGBA")
    enamel_im.putalpha(mask_img.filter(ImageFilter.GaussianBlur(0.8)))
    
    # Bezel rim
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
    
    shadow_mask = dilated_mask.filter(ImageFilter.GaussianBlur(6))
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    shadow.putalpha(shadow_mask.point(lambda v: int(v * 0.65)))
    
    out = base_coin.convert("RGBA")
    out.alpha_composite(shadow, (4, 5))
    out.alpha_composite(bezel_im)
    out.alpha_composite(enamel_im)
    if accent_layer is not None:
        out.alpha_composite(accent_layer)
        
    return out.convert("RGB")

def mask_from_image_alpha(img_rgba, target_dim=260):
    alpha = img_rgba.split()[3]
    bbox = alpha.getbbox()
    if not bbox:
        raise ValueError("Empty alpha in image")
    cropped = alpha.crop(bbox)
    bw, bh = cropped.size
    scale = target_dim / max(bw, bh)
    nw, nh = max(1, int(round(bw * scale))), max(1, int(round(bh * scale)))
    scaled = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    scaled_bin = scaled.point(lambda v: 255 if v > 100 else 0)
    
    canvas = Image.new("L", (S, S), 0)
    canvas.paste(scaled_bin, ((S - nw) // 2, (S - nh) // 2))
    return canvas

def mask_from_svg(svg_path, target_dim=260):
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
    cropped = logo_mask.crop(bbox)
    bw, bh = cropped.size
    scale = target_dim / max(bw, bh)
    nw, nh = max(1, int(round(bw * scale))), max(1, int(round(bh * scale)))
    scaled = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    scaled_bin = scaled.point(lambda v: 255 if v > 100 else 0)
    
    canvas = Image.new("L", (S, S), 0)
    canvas.paste(scaled_bin, ((S - nw) // 2, (S - nh) // 2))
    return canvas

def save_medallion(name, composed):
    master_path = SRC_BADGES / f"{name}.jpg"
    composed.save(master_path, quality=95)
    rims.save(composed, f"{name}.png", out_dir=str(OUT_BADGES))
    print(f"Minted: {name}.png")

# 1. 智谱乾坤 (ZCode stylized Z mark from D:\ZCode\resources\icon.png)
def gen_zhipu():
    zcode_icon = Image.open(r"D:\ZCode\resources\icon.png").convert("RGBA")
    mask = mask_from_image_alpha(zcode_icon, target_dim=270)
    stops = [
        ((29, 78, 216), 0.0),   # #1d4ed8
        ((59, 130, 246), 0.45), # #3b82f6
        ((96, 165, 250), 0.85), # #60a5fa
        ((191, 219, 254), 1.0), # #bfdbfe
    ]
    coin = rims.house_coin()
    comp = sculpt_medallion(mask, coin, stops, rim_color=(235, 242, 250))
    save_medallion("zhipu-sage", comp)

# 2. 暗面行者 (Moonshot AI sliced globe from moonshot-globe.svg)
def gen_moonshot():
    mask = mask_from_svg(CACHE / "moonshot-globe.svg", target_dim=260)
    stops = [
        ((30, 27, 75), 0.0),    # #1e1b4b
        ((55, 48, 163), 0.4),   # #3730a3
        ((99, 102, 241), 0.8),  # #6366f1
        ((224, 231, 255), 1.0), # #e0e7ff
    ]
    coin = rims.house_coin()
    comp = sculpt_medallion(mask, coin, stops, rim_color=(225, 232, 245))
    save_medallion("moonshot-voyager", comp)

# 3. 海螺巨兽 (MiniMax Code cute creature from D:\MiniMax Code\resources\resources\icon.ico)
def gen_minimax():
    ico = Image.open(r"D:\MiniMax Code\resources\resources\icon.ico").convert("RGBA")
    mask = mask_from_image_alpha(ico, target_dim=260)
    stops = [
        ((2, 132, 199), 0.0),   # #0284c7 (vibrant cyan blue)
        ((14, 165, 233), 0.4),  # #0ea5e9
        ((56, 189, 248), 0.75), # #38bdf8
        ((186, 230, 253), 1.0), # #bae6fd
    ]
    coin = rims.house_coin()
    comp = sculpt_medallion(mask, coin, stops, rim_color=(240, 248, 255))
    save_medallion("minimax-abyss", comp)

# 4. 北美豆包 (Google Gemini from C:\Users\Administrator\AppData\Local\Google\Gemini\app-1.16.0\resources\app.asar.unpacked\assets\icon.png)
def gen_gemini():
    gemini_icon = Image.open(r"C:\Users\Administrator\AppData\Local\Google\Gemini\app-1.16.0\resources\app.asar.unpacked\assets\icon.png").convert("RGBA")
    mask = mask_from_image_alpha(gemini_icon, target_dim=265)
    # 4-color Google flare gradient (Red, Blue, Green, Gold)
    stops = [
        ((239, 68, 68), 0.0),   # #ef4444 (Google red)
        ((59, 130, 246), 0.38), # #3b82f6 (Google blue)
        ((16, 185, 129), 0.72), # #10b981 (Google green)
        ((245, 158, 11), 1.0),  # #f59e0b (Google yellow)
    ]
    coin = rims.house_coin()
    comp = sculpt_medallion(mask, coin, stops, rim_color=(250, 250, 255))
    save_medallion("north-america-doubao", comp)

# 5. 通义宗师 (Qwen 3D isometric interlocking triad from media_1792819066745_def04f8e.png)
def gen_qwen():
    src_path = r"C:\Users\Administrator\.gemini\antigravity\brain\9bfda5ee-7664-4add-a6ba-63d9fe49c8ad\.user_uploaded\media_1792819066745_def04f8e.png"
    im = Image.open(src_path).convert("RGBA")
    arr = np.array(im)
    g = arr[..., 1].astype(float)
    fg_mask = (g > 110)
    mask_im = Image.fromarray((fg_mask * 255).astype(np.uint8))
    
    # Crop to triad bbox, resize to 260px, center
    bbox = mask_im.getbbox()
    cropped_mask = mask_im.crop(bbox)
    bw, bh = cropped_mask.size
    scale = 260.0 / max(bw, bh)
    nw, nh = max(1, int(round(bw * scale))), max(1, int(round(bh * scale)))
    scaled_mask = cropped_mask.resize((nw, nh), Image.Resampling.LANCZOS)
    scaled_mask_bin = scaled_mask.point(lambda v: 255 if v > 100 else 0)
    
    canvas_mask = Image.new("L", (S, S), 0)
    canvas_mask.paste(scaled_mask_bin, ((S - nw) // 2, (S - nh) // 2))
    
    stops = [
        ((88, 28, 135), 0.0),   # #581c87 (royal purple)
        ((124, 58, 237), 0.4),  # #7c3aed
        ((168, 85, 247), 0.75), # #a855f7
        ((233, 213, 255), 1.0), # #e9d5ff
    ]
    coin = rims.house_coin()
    comp = sculpt_medallion(canvas_mask, coin, stops, rim_color=(245, 240, 255))
    save_medallion("qwen-dynasty", comp)

# 6. 灵动之种 (ByteDance corporate 4-perspective-panels from bytedance.svg)
def gen_bytedance():
    mask = mask_from_svg(CACHE / "bytedance.svg", target_dim=260)
    stops = [
        ((30, 64, 175), 0.0),   # #1e40af (deep blue)
        ((37, 99, 235), 0.35),  # #2563eb (sky blue)
        ((13, 148, 136), 0.7),  # #0d9488 (teal)
        ((45, 212, 191), 1.0),  # #2dd4bf (mint cyan)
    ]
    coin = rims.house_coin()
    comp = sculpt_medallion(mask, coin, stops, rim_color=(240, 248, 255))
    save_medallion("seedance-master", comp)

def main():
    print("=== Re-minting Specific Brand Medallions to User Requirements ===")
    gen_zhipu()
    gen_moonshot()
    gen_minimax()
    gen_gemini()
    gen_qwen()
    gen_bytedance()
    print("All 6 brand medallions successfully sculpted and minted!")

if __name__ == "__main__":
    main()
