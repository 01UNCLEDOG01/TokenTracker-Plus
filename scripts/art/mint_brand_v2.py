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

def sculpt_medallion(mask_img, base_coin, gradient_stops, rim_color=(235, 240, 248), custom_height=None, overlay_img=None):
    if custom_height is not None:
        h = custom_height
        m_raw = (h > 0.02).astype(float)
    else:
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
    diff = np.clip(nx * lx + ny * ly + nz * lz, 0.18, 1.0)
    
    vx, vy, vz = 0.0, 0.0, 1.0
    hx = lx + vx; hy = ly + vy; hz = lz + vz
    hn = math.sqrt(hx*hx + hy*hy + hz*hz)
    hx /= hn; hy /= hn; hz /= hn
    spec = np.clip(nx * hx + ny * hy + nz * hz, 0.0, 1.0) ** 18
    
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
        shaded = rgb_grad[..., ch] * (diff * 0.85 + 0.20) + spec * 170.0
        enamel_rgb[..., ch] = np.clip(shaded, 0, 255).astype(np.uint8)
        
    m_bin = m_raw > 0.05
    m_img = Image.fromarray((m_bin * 255).astype(np.uint8))
    rim_mask = ImageOps.invert(m_img).filter(ImageFilter.GaussianBlur(1.8))
    rim_arr = (np.array(m_img.filter(ImageFilter.GaussianBlur(2.0))).astype(float) / 255.0) * (
               np.array(rim_mask).astype(float) / 255.0)
    rim_arr = np.clip(rim_arr * 3.5, 0.0, 1.0)
    
    for ch in range(3):
        enamel_rgb[..., ch] = (
            enamel_rgb[..., ch].astype(float) * (1.0 - rim_arr) +
            rim_color[ch] * rim_arr
        ).astype(np.uint8)
        
    enamel_rgba = Image.fromarray(np.dstack([enamel_rgb, (m_bin * 255).astype(np.uint8)]))
    if overlay_img is not None:
        enamel_rgba.alpha_composite(overlay_img)
        
    final_canvas = base_coin.copy().convert("RGBA")
    drop_shadow = m_img.filter(ImageFilter.GaussianBlur(7.0))
    shadow_arr = (np.array(drop_shadow).astype(float) / 255.0) * 0.65
    
    bg_np = np.array(final_canvas).astype(float)
    for ch in range(3):
        bg_np[..., ch] *= (1.0 - shadow_arr * (1.0 - m_bin))
    final_canvas = Image.fromarray(np.clip(bg_np, 0, 255).astype(np.uint8))
    
    final_canvas.alpha_composite(enamel_rgba)
    return final_canvas

def sculpt_from_texture(texture_rgba, base_coin, rim_color=(235, 240, 248), relief_scale=14.0):
    tex_arr = np.array(texture_rgba)
    rgb = tex_arr[:, :, :3].astype(float)
    alpha = (tex_arr[:, :, 3].astype(float) / 255.0)
    
    gray = (0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]) / 255.0
    h_raw = alpha * 0.70 + gray * alpha * 0.30
    
    b1 = np.array(Image.fromarray((h_raw * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))).astype(float) / 255.0
    b3 = np.array(Image.fromarray((h_raw * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4.0))).astype(float) / 255.0
    b8 = np.array(Image.fromarray((h_raw * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(8.0))).astype(float) / 255.0
    h = (0.5 * b1 + 0.35 * b3 + 0.15 * b8) * (alpha > 0.05)
    if np.max(h) > 0:
        h = h / np.max(h)
        
    dy, dx = np.gradient(h)
    nx = -dx * relief_scale
    ny = -dy * relief_scale
    nz = np.ones_like(nx)
    norm = np.sqrt(nx*nx + ny*ny + nz*nz)
    nx /= norm; ny /= norm; nz /= norm
    
    lx, ly, lz = -0.6, -0.6, 0.55
    l_norm = math.sqrt(lx*lx + ly*ly + lz*lz)
    lx /= l_norm; ly /= l_norm; lz /= l_norm
    diff = np.clip(nx * lx + ny * ly + nz * lz, 0.22, 1.0)
    
    vx, vy, vz = 0.0, 0.0, 1.0
    hx = lx + vx; hy = ly + vy; hz = lz + vz
    hn = math.sqrt(hx*hx + hy*hy + hz*hz)
    hx /= hn; hy /= hn; hz /= hn
    spec = np.clip(nx * hx + ny * hy + nz * hz, 0.0, 1.0) ** 18
    
    shaded_rgb = np.zeros((S, S, 3), dtype=np.uint8)
    for ch in range(3):
        col = rgb[..., ch] * (diff * 0.82 + 0.22) + spec * 170.0
        shaded_rgb[..., ch] = np.clip(col, 0, 255).astype(np.uint8)
        
    m_bin = alpha > 0.1
    m_img = Image.fromarray((m_bin * 255).astype(np.uint8))
    rim_mask = ImageOps.invert(m_img).filter(ImageFilter.GaussianBlur(1.8))
    rim_arr = (np.array(m_img.filter(ImageFilter.GaussianBlur(2.0))).astype(float) / 255.0) * (
               np.array(rim_mask).astype(float) / 255.0)
    rim_arr = np.clip(rim_arr * 3.5, 0.0, 1.0)
    
    for ch in range(3):
        shaded_rgb[..., ch] = (
            shaded_rgb[..., ch].astype(float) * (1.0 - rim_arr) +
            rim_color[ch] * rim_arr
        ).astype(np.uint8)
        
    enamel_rgba = Image.fromarray(np.dstack([shaded_rgb, (m_bin * 255).astype(np.uint8)]))
    
    final_canvas = base_coin.copy().convert("RGBA")
    drop_shadow = m_img.filter(ImageFilter.GaussianBlur(6.0))
    shadow_arr = (np.array(drop_shadow).astype(float) / 255.0) * 0.60
    
    bg_np = np.array(final_canvas).astype(float)
    for ch in range(3):
        bg_np[..., ch] *= (1.0 - shadow_arr * (1.0 - m_bin))
    final_canvas = Image.fromarray(np.clip(bg_np, 0, 255).astype(np.uint8))
    
    final_canvas.alpha_composite(enamel_rgba)
    return final_canvas

def save_medallion(name, composed):
    master_path = SRC_BADGES / f"{name}.jpg"
    composed.convert("RGB").save(master_path, quality=95)
    rims.save(composed, f"{name}.png", out_dir=str(OUT_BADGES))
    print(f"Minted: {name}.png")

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

# -------------------------------------------------------------
# 1. 智谱乾坤 (ZCode Official Geometric 'Z')
# -------------------------------------------------------------
def gen_zhipu():
    z_raw = Image.open(r"D:\ZCode\resources\icon.png")
    z_arr = np.array(z_raw)
    z_gray = z_arr[:, :, :3].mean(axis=2)
    # The icon carries a hairline rounded-square border that also clears 100;
    # crop past it so only the three-stroke Z is sculpted.
    zh, zw = z_gray.shape
    inset = int(min(zh, zw) * 0.18)
    z_gray = z_gray[inset:zh - inset, inset:zw - inset]
    z_gray_img = Image.fromarray(z_gray.astype(np.uint8), "L")
    z_mask_raw = z_gray_img.point([255 if v > 100 else 0 for v in range(256)])
    bbox = z_mask_raw.getbbox()
    z_crop = z_mask_raw.crop(bbox)

    target_dim = 265
    scale = target_dim / max(z_crop.size)
    nw, nh = max(1, int(round(z_crop.width * scale))), max(1, int(round(z_crop.height * scale)))
    z_resized = z_crop.resize((nw, nh), Image.Resampling.LANCZOS)
    z_bin = z_resized.point(lambda v: 255 if v > 100 else 0)

    z_canvas = Image.new("L", (S, S), 0)
    z_canvas.paste(z_bin, ((S - nw)//2, (S - nh)//2))

    stops = [
        ((22, 58, 160), 0.0),    # deep royal blue
        ((38, 115, 240), 0.40),  # vibrant electric blue
        ((85, 185, 255), 0.72),  # cyan-blue highlight
        ((250, 220, 85), 1.0)    # golden quantum peak
    ]
    coin = rims.house_coin()
    comp = sculpt_medallion(z_canvas, coin, stops, rim_color=(240, 245, 255))
    save_medallion("zhipu-sage", comp)

# -------------------------------------------------------------
# 2. 暗面行者 (Moonshot with Authentic Lunar Craters)
# -------------------------------------------------------------
def gen_moonshot():
    ms_canvas = mask_from_svg(CACHE / "moonshot-globe.svg", target_dim=260)
    
    # Generate authentic lunar craters on the globe
    m_arr = np.array(ms_canvas).astype(float) / 255.0
    b1 = np.array(ms_canvas.filter(ImageFilter.GaussianBlur(1.5))).astype(float) / 255.0
    b3 = np.array(ms_canvas.filter(ImageFilter.GaussianBlur(4.0))).astype(float) / 255.0
    b8 = np.array(ms_canvas.filter(ImageFilter.GaussianBlur(10.0))).astype(float) / 255.0
    h_base = (0.5 * b1 + 0.35 * b3 + 0.15 * b8) * m_arr
    if np.max(h_base) > 0:
        h_base /= np.max(h_base)

    # Spherical bulge on the globe
    yy, xx = np.mgrid[0:S, 0:S].astype(float)
    dist_c = np.sqrt((xx - C)**2 + (yy - C)**2)
    sphere_curv = np.clip(1.0 - (dist_c / 135.0)**2, 0.0, 1.0) ** 0.5
    h_sphere = h_base * (0.6 + 0.4 * sphere_curv)

    # Impact craters: (cx, cy, radius, depth)
    craters = [
        (215, 220, 24, 0.38),
        (290, 275, 32, 0.48),
        (245, 305, 18, 0.30),
        (315, 210, 16, 0.28),
        (195, 275, 15, 0.24),
        (265, 190, 14, 0.22),
        (310, 310, 12, 0.20),
    ]
    crater_field = np.zeros((S, S), dtype=float)
    for cx, cy, r, depth in craters:
        d = np.sqrt((xx - cx)**2 + (yy - cy)**2)
        bowl = np.exp(- (d / (0.65 * r))**2)
        rim = np.exp(- ((d - r) / (0.28 * r))**2) * 0.65
        crater_profile = (- bowl + rim) * depth
        crater_field += crater_profile

    h_lunar = np.clip(h_sphere + crater_field * m_arr, 0.0, 1.2)
    if np.max(h_lunar) > 0:
        h_lunar /= np.max(h_lunar)

    stops = [
        ((32, 22, 70), 0.0),     # deep space obsidian
        ((60, 48, 125), 0.38),   # midnight violet
        ((105, 88, 185), 0.75),  # starlight amethyst
        ((200, 185, 250), 1.0)   # lunar frost highlight
    ]
    coin = rims.house_coin()
    comp = sculpt_medallion(ms_canvas, coin, stops, rim_color=(235, 230, 255), custom_height=h_lunar)
    save_medallion("moonshot-voyager", comp)

# -------------------------------------------------------------
# 3. 海螺巨兽 (MiniMax Crystalline Cybernetic Monster)
# -------------------------------------------------------------
def gen_minimax():
    mini_raw = Image.open(r"D:\MiniMax Code\resources\resources\icon.ico")
    mini_arr = np.array(mini_raw)
    mini_alpha = mini_arr[:, :, 3]
    mini_mask = Image.fromarray(((mini_alpha > 50).astype(np.uint8) * 255))
    bbox = mini_mask.getbbox()
    mini_crop = mini_mask.crop(bbox)

    ratio = 260.0 / max(mini_crop.size)
    new_w = int(mini_crop.width * ratio)
    new_h = int(mini_crop.height * ratio)
    mini_resized = mini_crop.resize((new_w, new_h), Image.Resampling.LANCZOS)
    mini_bin = mini_resized.point(lambda v: 255 if v > 100 else 0)

    mini_canvas = Image.new("L", (S, S), 0)
    mini_canvas.paste(mini_bin, ((S - new_w)//2, (S - new_h)//2))

    m_arr = np.array(mini_canvas).astype(float) / 255.0
    b1 = np.array(mini_canvas.filter(ImageFilter.GaussianBlur(1.8))).astype(float) / 255.0
    b3 = np.array(mini_canvas.filter(ImageFilter.GaussianBlur(4.5))).astype(float) / 255.0
    b8 = np.array(mini_canvas.filter(ImageFilter.GaussianBlur(11.0))).astype(float) / 255.0
    h_creature = (0.45 * b1 + 0.35 * b3 + 0.20 * b8) * m_arr
    if np.max(h_creature) > 0:
        h_creature /= np.max(h_creature)

    # Mechanical visor, faceted forehead core and sonar rings: the creature
    # reads as a deep-sea machine rather than a cartoon blob.
    overlay = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rounded_rectangle(
        [C - 92, C - 26, C + 92, C + 14], radius=16,
        fill=(4, 18, 34, 235), outline=(0, 200, 255, 210), width=3,
    )
    for sx in (C - 46, C + 46):
        draw.rounded_rectangle([sx - 22, C - 18, sx + 22, C + 1], radius=8, fill=(0, 225, 255, 255))
        draw.rounded_rectangle([sx - 13, C - 15, sx + 13, C - 3], radius=5, fill=(205, 255, 255, 255))

    node_y = int(C - 66)
    node_size = 17
    node_pts = [
        (C, node_y - node_size),
        (C + node_size, node_y),
        (C, node_y + node_size),
        (C - node_size, node_y),
    ]
    draw.polygon(node_pts, fill=(0, 235, 255, 240), outline=(235, 255, 255, 255))
    draw.polygon(
        [(C, node_y - 8), (C + 8, node_y), (C, node_y + 8), (C - 8, node_y)],
        fill=(235, 255, 255, 255),
    )

    for radius in (24, 38, 52):
        draw.arc(
            [C - 120 - radius, C - 6 - radius, C - 120 + radius, C - 6 + radius],
            start=300, end=60, fill=(0, 220, 255, 150), width=3,
        )
        draw.arc(
            [C + 120 - radius, C - 6 - radius, C + 120 + radius, C - 6 + radius],
            start=120, end=240, fill=(0, 220, 255, 150), width=3,
        )

    stops = [
        ((4, 45, 85), 0.0),      # abyssal navy
        ((10, 125, 205), 0.45),  # electric cerulean
        ((18, 198, 240), 0.80),  # vibrant cyan
        ((130, 255, 235), 1.0)   # bioluminescent mint
    ]
    coin = rims.house_coin()
    comp = sculpt_medallion(mini_canvas, coin, stops, rim_color=(180, 245, 255), custom_height=h_creature, overlay_img=overlay)
    save_medallion("minimax-abyss", comp)

# -------------------------------------------------------------
# 4. 北美豆包 (Official Google Gemini 4-Color Star)
# -------------------------------------------------------------
def gen_gemini():
    gemini_img = Image.open(CACHE / "gemini-official.png").convert("RGBA")
    g_alpha = gemini_img.split()[-1]
    g_bin = g_alpha.point(lambda a: 255 if a > 10 else 0)
    bbox = g_bin.getbbox()
    g_crop = gemini_img.crop(bbox)

    target_dim = 270
    scale = target_dim / max(g_crop.size)
    nw, nh = max(1, int(round(g_crop.width * scale))), max(1, int(round(g_crop.height * scale)))
    g_resized = g_crop.resize((nw, nh), Image.Resampling.LANCZOS)

    g_canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    g_canvas.paste(g_resized, ((S - nw)//2, (S - nh)//2))

    coin = rims.house_coin()
    comp = sculpt_from_texture(g_canvas, coin, rim_color=(250, 245, 240), relief_scale=14.0)
    save_medallion("north-america-doubao", comp)

# -------------------------------------------------------------
# 5. 通义宗师 (Qwen 3D Triad)
# -------------------------------------------------------------
def gen_qwen():
    im = Image.open(CACHE / "qwen-master.png").convert("RGBA")
    arr = np.array(im)
    g = arr[..., 1].astype(float)
    fg_mask = (g > 110)
    mask_im = Image.fromarray((fg_mask * 255).astype(np.uint8))
    
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
        ((88, 28, 135), 0.0),
        ((124, 58, 237), 0.4),
        ((168, 85, 247), 0.75),
        ((233, 213, 255), 1.0),
    ]
    coin = rims.house_coin()
    comp = sculpt_medallion(canvas_mask, coin, stops, rim_color=(245, 240, 255))
    save_medallion("qwen-dynasty", comp)

# -------------------------------------------------------------
# 6. 灵动之种 (ByteDance 4 perspective panels)
# -------------------------------------------------------------
def gen_bytedance():
    mask = mask_from_svg(CACHE / "bytedance.svg", target_dim=260)
    stops = [
        ((30, 64, 175), 0.0),
        ((37, 99, 235), 0.35),
        ((13, 148, 136), 0.7),
        ((45, 212, 191), 1.0),
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
