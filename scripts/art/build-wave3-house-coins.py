import importlib.util
from pathlib import Path
import os
import sys

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("rims", str(ROOT / "scripts" / "art" / "rebuild-badge-rims.py"))
rims = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rims)

ART_DIR = Path(r"C:\Users\Administrator\.gemini\antigravity\brain\9bfda5ee-7664-4add-a6ba-63d9fe49c8ad")
OUT_DIR = ROOT / "dashboard" / "public" / "achievements"

MAPPING = {
    "closed-source-loyalist": ART_DIR / "openai_medallion_badge_v2_1792768304089.jpg",
    "frugal-architect": ART_DIR / "achievement_token_medallion_1792768404493.jpg",
    "offgrid-sovereign": ART_DIR / "dark_metallic_achievement_badge_1792768412260.jpg",
    "megacontext-voyager": ART_DIR / "cosmic_whale_medallion_badge_1792768413988.jpg",
    "cache-miser": ART_DIR / "achievement_badge_cyber_processor_1792768421971.jpg",
    "code-cannon": ART_DIR / "naval_cannon_achievement_badge_1792768426416.jpg",
    "buzzer-beater": ART_DIR / "chronometer_achievement_medallion_1792768432579.jpg",
    "zen-balancer": ART_DIR / "zen_achievement_badge_1792768437291.jpg",
    "swarm-commander": ART_DIR / "sci_fi_fleet_achievement_badge_1792768441938.jpg",
    "terminal-purist": ART_DIR / "retro_crt_achievement_badge_1792768445111.jpg",
    "refactor-titan": ART_DIR / "blacksmith_achievement_badge_1792768450910.jpg",
}

def main():
    print(f"Building {len(MAPPING)} Wave-3 badges on house_coin rim...")
    for stem, src in MAPPING.items():
        if not src.exists():
            print(f"ERROR: missing {src}")
            sys.exit(1)
        face = rims.extract_face(str(src), radius=200, feather=2, zoom=1.0)
        coin = rims.compose(face, shadow=False)
        rims.save(coin, f"{stem}.png", out_dir=str(OUT_DIR))
        print(f"Successfully generated {stem}.png")

if __name__ == "__main__":
    main()
