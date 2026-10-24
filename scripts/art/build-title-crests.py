import importlib.util
from pathlib import Path
import os
import sys

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("rims", str(ROOT / "scripts" / "art" / "rebuild-badge-rims.py"))
rims = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rims)

SRC_DIR = ROOT / "scripts" / "art" / "source-titles"
OUT_DIR = ROOT / "dashboard" / "public" / "achievements" / "titles"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Custom zooms ensuring perfect fit on house_coin rim
CONFIG = {
    "title-cyber-immortal": {"file": SRC_DIR / "title-cyber-immortal.jpg", "zoom": 1.02},
    "title-fleet-admiral": {"file": SRC_DIR / "title-fleet-admiral.jpg", "zoom": 1.10},
    "title-frugal-archmage": {"file": SRC_DIR / "title-frugal-archmage.jpg", "zoom": 1.02},
    "title-openai-paladin": {"file": SRC_DIR / "title-openai-paladin.jpg", "zoom": 1.10},
    "title-omniscient-architect": {"file": SRC_DIR / "title-omniscient-architect.jpg", "zoom": 1.08},
    "title-zen-master": {"file": SRC_DIR / "title-zen-master.jpg", "zoom": 1.05},
    "title-code-cannon": {"file": SRC_DIR / "title-code-cannon.jpg", "zoom": 1.02},
    "title-grand-slam": {"file": SRC_DIR / "title-grand-slam.jpg", "zoom": 1.06},
    "title-chosen-drudge": {"file": SRC_DIR / "title-chosen-drudge.jpg", "zoom": 1.05},
    "title-von-neumann": {"file": SRC_DIR / "title-von-neumann.jpg", "zoom": 1.05},
    "title-one-person-company": {"file": SRC_DIR / "title-one-person-company.jpg", "zoom": 1.05},
}

def main(only=None):
    items = {k: v for k, v in CONFIG.items() if not only or k in only}
    print(f"Building {len(items)} Title Crest Medallions on house_coin rim...")
    for stem, cfg in items.items():
        src = cfg["file"]
        zoom = cfg["zoom"]
        if not src.exists():
            print(f"ERROR: missing {src}")
            sys.exit(1)
        face = rims.extract_face(str(src), radius=200, feather=2, zoom=zoom)
        coin = rims.compose(face, shadow=False)
        rims.save(coin, f"{stem}.png", out_dir=str(OUT_DIR))
        print(f"Successfully generated {stem}.png (zoom={zoom})")

if __name__ == "__main__":
    import sys
    main(sys.argv[1:] or None)
