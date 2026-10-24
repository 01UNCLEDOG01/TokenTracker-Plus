import importlib.util
from pathlib import Path
import os
import sys

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("rims", str(ROOT / "scripts" / "art" / "rebuild-badge-rims.py"))
rims = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rims)

SRC_DIR = ROOT / "scripts" / "art" / "source-badges"
OUT_DIR = ROOT / "dashboard" / "public" / "achievements"

MAPPING = {
    "closed-source-loyalist": SRC_DIR / "closed-source-loyalist.jpg",
    "frugal-architect": SRC_DIR / "frugal-architect.jpg",
    "offgrid-sovereign": SRC_DIR / "offgrid-sovereign.jpg",
    "megacontext-voyager": SRC_DIR / "megacontext-voyager.jpg",
    "cache-miser": SRC_DIR / "cache-miser.jpg",
    "code-cannon": SRC_DIR / "code-cannon.jpg",
    "buzzer-beater": SRC_DIR / "buzzer-beater.jpg",
    "zen-balancer": SRC_DIR / "zen-balancer.jpg",
    "swarm-commander": SRC_DIR / "swarm-commander.jpg",
    "terminal-purist": SRC_DIR / "terminal-purist.jpg",
    "refactor-titan": SRC_DIR / "refactor-titan.jpg",
}

def main():
    print(f"Building {len(MAPPING)} Wave-3 badges on house_coin rim...")
    for stem, src in MAPPING.items():
        if not src.exists():
            print(f"ERROR: missing {src}")
            sys.exit(1)
        face = rims.extract_face(str(src), radius=200, feather=2, zoom=1.05)
        coin = rims.compose(face, shadow=False)
        rims.save(coin, f"{stem}.png", out_dir=str(OUT_DIR))
        print(f"Successfully generated {stem}.png")

if __name__ == "__main__":
    main()
