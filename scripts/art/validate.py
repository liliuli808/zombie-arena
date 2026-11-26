#!/usr/bin/env python3
"""校验后处理产物：尺寸、帧透明度、调色板、缺失文件。"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from postprocess import (
    CHARACTER_IDS, FRAMES, ICON_IDS, PALETTE, VIEW,
)

TITLE_SIZE = (1536, 1024)


def _size_str(size: tuple[int, int]) -> str:
    return f"{size[0]}x{size[1]}"


def validate_sheet(path: Path) -> None:
    with Image.open(path) as src:
        img = src.convert("RGBA")
    expected = (VIEW * FRAMES, VIEW)
    if img.size != expected:
        raise ValueError(
            f"{path}: expected {_size_str(expected)}, got {_size_str(img.size)}")
    arr = np.array(img)
    palette = set(map(tuple, PALETTE.tolist()))
    for i in range(FRAMES):
        alpha = arr[:, i * VIEW:(i + 1) * VIEW, 3]
        coverage = float((alpha > 0).mean())
        if not (0.03 <= coverage <= 0.60):
            raise ValueError(f"{path}: frame {i} coverage {coverage:.3f} out of range")
        opaque = arr[:, i * VIEW:(i + 1) * VIEW, :3][alpha > 0]
        for px in map(tuple, opaque):
            px = tuple(int(v) for v in px)
            if px not in palette:
                raise ValueError(f"{path}: frame {i} has non-palette color {px}")
    print("OK", path)


def validate_portrait(path: Path) -> None:
    expected = (160, 160)
    with Image.open(path) as img:
        if img.size != expected:
            raise ValueError(
                f"{path}: expected {_size_str(expected)}, got {_size_str(img.size)}")
    print("OK", path)


def validate_icon(path: Path) -> None:
    expected = (48, 48)
    with Image.open(path) as img:
        if img.size != expected:
            raise ValueError(
                f"{path}: expected {_size_str(expected)}, got {_size_str(img.size)}")
    print("OK", path)


def validate_title(path: Path) -> None:
    with Image.open(path) as img:
        if img.size != TITLE_SIZE:
            raise ValueError(
                f"{path}: expected {_size_str(TITLE_SIZE)}, got {_size_str(img.size)}")
    print("OK", path)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--assets", default="public/assets",
                    help="Asset root containing characters/, portraits/, icons/, art/")
    ap.add_argument("--only", nargs="+", default=None,
                    help="Validate only these character ids (default: all)")
    ap.add_argument("--extras", action="store_true",
                    help="Also validate icons and the title image")
    args = ap.parse_args(argv)

    assets = Path(args.assets)
    ids = args.only if args.only is not None else CHARACTER_IDS
    errors: list[str] = []
    for cid in ids:
        for path, fn in (
            (assets / "characters" / f"{cid}.png", validate_sheet),
            (assets / "portraits" / f"{cid}.png", validate_portrait),
        ):
            try:
                fn(path)
            except Exception as exc:  # noqa: BLE001
                errors.append(str(exc))

    if args.extras:
        for cid in ICON_IDS:
            try:
                validate_icon(assets / "icons" / f"{cid}.png")
            except Exception as exc:  # noqa: BLE001
                errors.append(str(exc))
        try:
            validate_title(assets / "art" / "title.png")
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))

    if errors:
        for e in errors:
            print("ERROR", e, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
