#!/usr/bin/env python3
"""把角色表拼成对照图，供人工检查动作与一致性。"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

from postprocess import CHARACTER_IDS, FRAMES, VIEW


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--assets", default="public/assets/characters")
    ap.add_argument("--out", default="/tmp/zombie-arena-contact.png")
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--scale", type=int, default=4)
    args = ap.parse_args(argv)

    ids = args.only or CHARACTER_IDS
    scale = max(1, args.scale)
    cell = VIEW * scale
    sheet = Image.new("RGB", (FRAMES * cell, len(ids) * cell), (24, 26, 32))
    for row, cid in enumerate(ids):
        path = Path(args.assets) / f"{cid}.png"
        if not path.exists():
            print("MISSING", path)
            continue
        img = Image.open(path).convert("RGBA")
        for col in range(FRAMES):
            frame = img.crop((col * VIEW, 0, (col + 1) * VIEW, VIEW))
            big = frame.resize((cell, cell), Image.NEAREST)
            sheet.paste(big, (col * cell, row * cell), big)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print("saved", out, sheet.size)
    print("rows:", " ".join(ids))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
