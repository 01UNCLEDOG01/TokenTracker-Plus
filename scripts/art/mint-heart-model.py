#!/usr/bin/env python
# heart_model reuses the upstream heart-on-your-sleeve face. The old build only
# recolored that art's own rim, which the house coin replaces anyway, so mint
# from the untouched upstream face and the result is the same badge.
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("rims", ROOT / "scripts" / "art" / "rebuild-badge-rims.py")
rims = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rims)

SRC = ROOT / "dashboard" / "public" / "achievements" / "heart-on-your-sleeve.png"
OUT = ROOT / "dashboard" / "public" / "achievements"


def main():
    face = rims.extract_face(str(SRC), radius=200, feather=2, zoom=1.05)
    coin = rims.compose(face, shadow=False)
    rims.save(coin, "heart-model.png", out_dir=str(OUT))
    print("minted heart-model.png on the house coin")


if __name__ == "__main__":
    main()
