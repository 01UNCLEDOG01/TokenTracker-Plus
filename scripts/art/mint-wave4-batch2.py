import os
import sys
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path("D:/tt-rebase")
sys.path.insert(0, str(ROOT / "scripts" / "art"))

import importlib.util
spec = importlib.util.spec_from_file_location("rims", str(ROOT / "scripts" / "art" / "rebuild-badge-rims.py"))
rims = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rims)

spec4 = importlib.util.spec_from_file_location("wave4", str(ROOT / "scripts" / "art" / "build-wave4-assets.py"))
wave4 = importlib.util.module_from_spec(spec4)
spec4.loader.exec_module(wave4)

OUT_BADGES = ROOT / "dashboard" / "public" / "achievements"
OUT_TITLES = ROOT / "dashboard" / "public" / "achievements" / "titles"
SRC_BADGES = ROOT / "scripts" / "art" / "source-badges"
SRC_TITLES = ROOT / "scripts" / "art" / "source-titles"

S = 512
cx, cy = 256, 256

def gen_meituan_longcat():
    # Load user official Meituan LongCat reference
    src_file = SRC_BADGES / "meituan-longcat-source.png"
    im_src = Image.open(src_file).convert("RGB")
    w, h = im_src.size

    # Floodfill background
    im_work = im_src.copy()
    ImageDraw.floodfill(im_work, (0, 0), (255, 0, 255), thresh=30)
    ImageDraw.floodfill(im_work, (w - 1, 0), (255, 0, 255), thresh=30)
    ImageDraw.floodfill(im_work, (0, h - 1), (255, 0, 255), thresh=30)
    ImageDraw.floodfill(im_work, (w - 1, h - 1), (255, 0, 255), thresh=30)

    arr = np.array(im_work)
    cat_body = ~((arr[:, :, 0] == 255) & (arr[:, :, 1] == 0) & (arr[:, :, 2] == 255))
    is_eyes = cat_body & (arr[:, :, 0] < 60) & (arr[:, :, 1] < 60) & (arr[:, :, 2] < 60)

    cat_mask_np = np.zeros((h, w), dtype=np.uint8)
    cat_mask_np[cat_body] = 255
    cat_mask_np[is_eyes] = 0

    y_idx, x_idx = np.where(cat_body)
    bbox = (int(np.min(x_idx)), int(np.min(y_idx)), int(np.max(x_idx)), int(np.max(y_idx)))
    cat_cropped = Image.fromarray(cat_mask_np).crop(bbox)

    cw, ch = cat_cropped.size
    scale = min(320.0 / cw, 320.0 / ch)
    nw, nh = int(cw * scale), int(ch * scale)
    cat_resized = cat_cropped.resize((nw, nh), Image.Resampling.LANCZOS)

    mask = Image.new("L", (S, S), 0)
    mask.paste(cat_resized, ((S - nw) // 2, (S - nh) // 2))

    stops = [
        ((6, 78, 59), 0.0),      # #064e3b deep emerald
        ((16, 185, 129), 0.35),  # #10b981 Meituan Longcat vibrant green
        ((52, 211, 153), 0.75),  # #34d399 soft mint sheen
        ((209, 250, 229), 1.0),  # #d1fae5 highlights
    ]
    coin = rims.house_coin()
    composed = wave4.sculpt_medallion(mask, coin, stops, rim_color=(220, 255, 240))
    master_path = SRC_BADGES / "meituan-longcat.jpg"
    composed.save(master_path, quality=95)
    rims.save(composed, "meituan-longcat.png", out_dir=str(OUT_BADGES))
    print(f"Minted meituan-longcat.png -> {OUT_BADGES}")

def gen_jd_joy_brother():
    # Load user official JD Joy reference
    src_file = SRC_BADGES / "jd-joy-source.png"
    im_src = Image.open(src_file).convert("RGB")
    w, h = im_src.size
    arr_jd = np.array(im_src)

    is_red_bg = (arr_jd[:, :, 0] > 180) & (arr_jd[:, :, 1] < 80) & (arr_jd[:, :, 2] < 80)
    dog_body = ~is_red_bg
    is_features = dog_body & (arr_jd[:, :, 0] < 120) & (arr_jd[:, :, 1] < 120) & (arr_jd[:, :, 2] < 120)

    dog_mask_np = np.zeros((h, w), dtype=np.uint8)
    dog_mask_np[dog_body] = 255
    dog_mask_np[is_features] = 0

    y_idx, x_idx = np.where(dog_body)
    bbox_jd = (int(np.min(x_idx)), int(np.min(y_idx)), int(np.max(x_idx)), int(np.max(y_idx)))
    dog_cropped = Image.fromarray(dog_mask_np).crop(bbox_jd)

    cw, ch = dog_cropped.size
    scale = min(330.0 / cw, 330.0 / ch)
    nw, nh = int(cw * scale), int(ch * scale)
    dog_resized = dog_cropped.resize((nw, nh), Image.Resampling.LANCZOS)

    mask = Image.new("L", (S, S), 0)
    mask.paste(dog_resized, ((S - nw) // 2, (S - nh) // 2))

    stops = [
        ((153, 27, 27), 0.0),    # #991b1b JD heritage dark red
        ((220, 38, 38), 0.4),    # #dc2626 classic JD crimson
        ((248, 113, 113), 0.75), # #f87171 coral highlight
        ((254, 226, 226), 1.0),  # #fee2e2 porcelain rim light
    ]
    coin = rims.house_coin()
    composed = wave4.sculpt_medallion(mask, coin, stops, rim_color=(255, 230, 230))
    master_path = SRC_BADGES / "jd-joy-brother.jpg"
    composed.save(master_path, quality=95)
    rims.save(composed, "jd-joy-brother.png", out_dir=str(OUT_BADGES))
    print(f"Minted jd-joy-brother.png -> {OUT_BADGES}")

def gen_hunyuan_master():
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    # Hunyuan Taiji / Cosmos vortex rings
    d.ellipse((cx - 130, cy - 130, cx + 130, cy + 130), outline=255, width=16)
    # Yin-yang swirling vortex
    # Outer circle
    d.pieslice((cx - 100, cy - 100, cx + 100, cy + 100), 270, 90, fill=255)
    # Swirl bulges
    d.pieslice((cx - 50, cy - 100, cx + 50, cy), 90, 270, fill=255)
    d.pieslice((cx - 50, cy, cx + 50, cy + 100), 270, 90, fill=0)
    # Nucleus dots
    d.ellipse((cx - 14, cy - 64, cx + 14, cy - 36), fill=0)
    d.ellipse((cx - 14, cy + 36, cx + 14, cy + 64), fill=255)

    stops = [
        ((3, 105, 161), 0.0),   # #0369a1 (Tencent Blue)
        ((14, 165, 233), 0.35), # #0ea5e9
        ((56, 189, 248), 0.75), # #38bdf8
        ((224, 242, 254), 1.0), # #e0f2fe
    ]
    coin = rims.house_coin()
    composed = wave4.sculpt_medallion(mask, coin, stops, rim_color=(220, 240, 255))
    master_path = SRC_BADGES / "hunyuan-master.jpg"
    composed.save(master_path, quality=95)
    rims.save(composed, "hunyuan-master.png", out_dir=str(OUT_BADGES))
    print(f"Minted hunyuan-master.png -> {OUT_BADGES}")

def gen_stepfun_voyager():
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    # Ascending stair steps
    step_w = 42
    step_h = 36
    # 4 cascading steps to the stars
    for i in range(5):
        sx = cx - 110 + i * step_w
        sy = cy + 90 - i * step_h
        d.rectangle((sx, sy, sx + step_w, cy + 90), fill=255)
    # Starburst at the pinnacle
    star_x = cx + 80
    star_y = cy - 85
    r_out = 45
    r_in = 16
    star_pts = []
    for k in range(8):
        angle = k * math.pi / 4 - math.pi / 2
        r = r_out if k % 2 == 0 else r_in
        star_pts.append((star_x + r * math.cos(angle), star_y + r * math.sin(angle)))
    d.polygon(star_pts, fill=255)
    # Orbit crescent sweeping upward
    d.arc((cx - 130, cy - 110, cx + 120, cy + 120), 45, 230, fill=255, width=10)

    stops = [
        ((76, 29, 149), 0.0),   # #4c1d95
        ((109, 40, 217), 0.4),  # #6d28d9
        ((139, 92, 246), 0.75), # #8b5cf6
        ((237, 233, 254), 1.0), # #ede9fe
    ]
    coin = rims.house_coin()
    composed = wave4.sculpt_medallion(mask, coin, stops, rim_color=(235, 225, 255))
    master_path = SRC_BADGES / "stepfun-voyager.jpg"
    composed.save(master_path, quality=95)
    rims.save(composed, "stepfun-voyager.png", out_dir=str(OUT_BADGES))
    print(f"Minted stepfun-voyager.png -> {OUT_BADGES}")

def gen_title_connoisseur_eater():
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    # Four-pointed gourmet banquet emblem
    d.ellipse((cx - 135, cy - 135, cx + 135, cy + 135), outline=255, width=14)
    # Four directional gourmet flares
    d.polygon([(cx, cy - 145), (cx + 25, cy - 80), (cx - 25, cy - 80)], fill=255)
    d.polygon([(cx, cy + 145), (cx + 25, cy + 80), (cx - 25, cy + 80)], fill=255)
    d.polygon([(cx - 145, cy), (cx - 80, cy + 25), (cx - 80, cy - 25)], fill=255)
    d.polygon([(cx + 145, cy), (cx + 80, cy + 25), (cx + 80, cy - 25)], fill=255)
    # Central celestial platter / cauldron
    d.ellipse((cx - 60, cy - 60, cx + 60, cy + 60), fill=255)
    d.ellipse((cx - 40, cy - 40, cx + 40, cy + 40), fill=0)
    d.ellipse((cx - 16, cy - 16, cx + 16, cy + 16), fill=255)

    stops = [
        ((120, 53, 15), 0.0),   # #78350f
        ((194, 65, 12), 0.4),   # #c2410c
        ((249, 115, 22), 0.75), # #f97316
        ((254, 215, 170), 1.0), # #fed7aa
    ]
    coin = rims.house_coin()
    composed = wave4.sculpt_medallion(mask, coin, stops, rim_color=(255, 215, 160))
    master_path = SRC_TITLES / "title-connoisseur-eater.jpg"
    composed.save(master_path, quality=95)
    rims.save(composed, "title-connoisseur-eater.png", out_dir=str(OUT_TITLES))
    print(f"Minted title-connoisseur-eater.png -> {OUT_TITLES}")

def gen_title_industrial_giant():
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    # Five-pointed imperial crest
    r_out = 145
    r_in = 65
    pts = []
    for k in range(10):
        angle = k * math.pi / 5 - math.pi / 2
        r = r_out if k % 2 == 0 else r_in
        pts.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    d.polygon(pts, outline=255, fill=0)
    d.polygon(pts, fill=255)
    # Inner five pillars / cauldron circle
    d.ellipse((cx - 60, cy - 60, cx + 60, cy + 60), fill=0)
    d.ellipse((cx - 35, cy - 35, cx + 35, cy + 35), fill=255)

    stops = [
        ((6, 78, 59), 0.0),     # #064e3b
        ((16, 149, 106), 0.4),  # #10b981
        ((52, 211, 153), 0.75), # #34d399
        ((209, 250, 229), 1.0), # #d1fae5
    ]
    coin = rims.house_coin()
    composed = wave4.sculpt_medallion(mask, coin, stops, rim_color=(200, 245, 225))
    master_path = SRC_TITLES / "title-industrial-giant.jpg"
    composed.save(master_path, quality=95)
    rims.save(composed, "title-industrial-giant.png", out_dir=str(OUT_TITLES))
    print(f"Minted title-industrial-giant.png -> {OUT_TITLES}")

if __name__ == "__main__":
    gen_meituan_longcat()
    gen_jd_joy_brother()
    gen_hunyuan_master()
    gen_stepfun_voyager()
    gen_title_connoisseur_eater()
    gen_title_industrial_giant()
    print("All 4 badges & 2 titles minted successfully!")
