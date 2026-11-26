#!/usr/bin/env python3
"""把 H3 生成的 2×2 原始表处理成 48px 角色精灵表。

流程：切格 -> 洪泛去白底 -> 裁内容 -> 同角色统一缩放 -> 脚底对齐
-> 锁现有调色板（41 色）-> 外圈 1px 暗描边 -> 横向拼接 9 帧。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

VIEW = 48
FRAMES = 9
TARGET_H = 40
FOOT_Y = 45
MAX_W = 45
OUTLINE = (12, 12, 12)

PALETTE_HEX = [
    "#0c0c0c", "#1c1c24", "#3a3a46", "#606070", "#9090a0", "#bcbccd", "#e8e8f5",
    "#7a2e2e", "#b64545", "#d67b4e", "#e6a96e", "#f0d4a8", "#faf0e0",
    "#8a1420", "#c41e2a", "#e04a3a",
    "#2e3d1c", "#4a5f2e", "#6b8a3d", "#94b85a", "#bcd888",
    "#0e2438", "#1c4a6e", "#2d7aa8", "#5ab0d8", "#8fdcff", "#c8ecff",
    "#4a3d0a", "#7a641a", "#bfa01d", "#e6c93d", "#ffe066", "#fff7b0",
    "#2a1848", "#3d2666", "#5a3a8a", "#8a5abf", "#b39ddb",
    "#3a2410", "#6b441e", "#a0682e",
]


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


PALETTE = np.array([hex_to_rgb(h) for h in PALETTE_HEX], dtype=np.int32)

CHARACTER_IDS = [
    "veteran", "wizard", "engineer", "ronin", "jailer",
    "walker", "runner", "fatty", "shield", "spitter",
    "summoner", "armored", "butcher", "mother",
]
SLOW_IDS = {"fatty", "butcher", "mother"}
CLIPS = {
    "idle": [0],
    "walk": [0, 1, 2, 3],
    "attack": [4, 5, 6],
    "hit": [7],
    "death": [8],
}
ICON_IDS = ["medkit", "grenade", "shieldkit", "boots", "armor", "scope", "charm", "battery"]


def split_grid(img: Image.Image, cols: int, rows: int) -> list[Image.Image]:
    """按行优先切成 cols×rows 个等大格子。"""
    w, h = img.size
    if w % cols or h % rows:
        raise ValueError(f"sheet {w}x{h} is not divisible by {cols}x{rows}")
    cw, ch = w // cols, h // rows
    return [
        img.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch))
        for row in range(rows)
        for col in range(cols)
    ]


def split_cells(img: Image.Image) -> list[Image.Image]:
    return split_grid(img, 2, 2)


def background_mask(arr: np.ndarray, tolerance: int = 45) -> np.ndarray:
    """从四边洪泛，只吃掉与边框同色的连通区域。"""
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3].astype(np.int16)
    border = np.concatenate([rgb[0, :, :], rgb[-1, :, :], rgb[:, 0, :], rgb[:, -1, :]], axis=0)
    bg = np.median(border, axis=0)
    similar = np.abs(rgb - bg).sum(axis=2) < tolerance
    mask = np.zeros((h, w), dtype=bool)
    stack: list[tuple[int, int]] = []
    for x in range(w):
        for y in (0, h - 1):
            if similar[y, x]:
                stack.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if similar[y, x]:
                stack.append((y, x))
    while stack:
        cy, cx = stack.pop()
        if mask[cy, cx]:
            continue
        mask[cy, cx] = True
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < h and 0 <= nx < w and not mask[ny, nx] and similar[ny, nx]:
                stack.append((ny, nx))
    return mask


def cut_out(cell: Image.Image, tolerance: int = 45) -> Image.Image:
    """去白底、二值 alpha、裁到内容包围盒。"""
    arr = np.array(cell.convert("RGBA"))
    mask = background_mask(arr, tolerance)
    arr[mask] = (0, 0, 0, 0)
    alpha = arr[:, :, 3]
    arr[:, :, 3] = np.where(alpha < 128, 0, 255)
    ys, xs = np.where(arr[:, :, 3] > 0)
    if len(ys) == 0:
        raise ValueError("empty cell after background removal")
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    return Image.fromarray(arr, "RGBA").crop(box)


def foot_center_x(img: Image.Image) -> float:
    """底部 12% 行的不透明像素 x 质心。"""
    a = np.array(img)[:, :, 3] > 0
    h, w = a.shape
    rows = max(2, int(h * 0.12))
    weights = a[-rows:, :].sum(axis=0).astype(np.float64)
    total = weights.sum()
    if total == 0:
        return w / 2
    return float((weights * np.arange(w)).sum() / total)


def fit_frame(img: Image.Image, scale: float) -> Image.Image:
    w0, h0 = img.size
    nw = max(1, round(w0 * scale))
    nh = max(1, round(h0 * scale))
    small = img.resize((nw, nh), Image.LANCZOS)
    left = round(VIEW / 2 - foot_center_x(small))
    left = max(1, min(left, VIEW - 1 - nw))
    top = max(1, FOOT_Y - nh)
    canvas = Image.new("RGBA", (VIEW, VIEW), (0, 0, 0, 0))
    canvas.alpha_composite(small, (left, top))
    return canvas


def fit_frames(cuts: list[Image.Image]) -> tuple[list[Image.Image], float]:
    max_h = max(c.size[1] for c in cuts)
    max_w = max(c.size[0] for c in cuts)
    scale = min(TARGET_H / max_h, MAX_W / max_w, 1.0)
    return [fit_frame(c, scale) for c in cuts], scale


def quantize(img: Image.Image) -> Image.Image:
    arr = np.array(img.convert("RGBA"))
    # 平方和最大约 195k，必须用 int32；int16 会溢出导致颜色量化错乱
    rgb = arr[:, :, :3].astype(np.int32)
    alpha = arr[:, :, 3]
    diff = ((rgb[:, :, None, :] - PALETTE[None, None, :, :]) ** 2).sum(axis=3)
    idx = diff.argmin(axis=2)
    out = PALETTE[idx].astype(np.uint8)
    out[alpha == 0] = 0
    return Image.fromarray(np.dstack([out, alpha.astype(np.uint8)]), "RGBA")


def add_outline(img: Image.Image, color: tuple[int, int, int] = OUTLINE) -> Image.Image:
    arr = np.array(img.convert("RGBA"))
    a = arr[:, :, 3] > 0
    out = arr.copy()
    h, w = a.shape
    for y in range(h):
        for x in range(w):
            if a[y, x]:
                continue
            near = (
                (y > 0 and a[y - 1, x]) or (y < h - 1 and a[y + 1, x])
                or (x > 0 and a[y, x - 1]) or (x < w - 1 and a[y, x + 1])
            )
            if near:
                out[y, x] = (*color, 255)
    return Image.fromarray(out, "RGBA")


def make_portrait(cell: Image.Image, path: Path, size: int = 160, content_h: int = 150) -> None:
    cut = cut_out(cell)
    w0, h0 = cut.size
    scale = min(content_h / h0, (size - 4) / w0)
    nw, nh = max(1, round(w0 * scale)), max(1, round(h0 * scale))
    small = cut.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(small, ((size - nw) // 2, size - 2 - nh))
    out = add_outline(quantize(canvas))
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path)


def process_character(raw_dir: Path, cid: str, chars_dir: Path,
                      portraits_dir: Path) -> dict:
    """raw_dir/<cid>/{walk,act,hurt}.png -> 角色表 + 肖像 + 元数据。"""
    raw = raw_dir / cid
    walk = split_cells(Image.open(raw / "walk.png").convert("RGBA"))
    act = split_cells(Image.open(raw / "act.png").convert("RGBA"))
    hurt = split_cells(Image.open(raw / "hurt.png").convert("RGBA"))
    selected = [
        walk[0], walk[1], walk[2], walk[3],
        act[1], act[2], act[3],
        hurt[1], hurt[3],
    ]
    cuts = [cut_out(c) for c in selected]
    fitted, _ = fit_frames(cuts)
    frames = [add_outline(quantize(f)) for f in fitted]

    for i, f in enumerate(frames):
        a = np.array(f)[:, :, 3]
        ys, xs = np.where(a > 0)
        if len(ys) == 0:
            raise ValueError(f"{cid} frame {i} is empty")
        if int(xs.min()) < 0 or int(xs.max()) >= VIEW or int(ys.min()) < 0 or int(ys.max()) >= VIEW:
            raise ValueError(f"{cid} frame {i} is out of bounds")

    sheet = Image.new("RGBA", (VIEW * FRAMES, VIEW), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.alpha_composite(f, (i * VIEW, 0))
    chars_dir.mkdir(parents=True, exist_ok=True)
    sheet.save(chars_dir / f"{cid}.png")
    make_portrait(walk[0], portraits_dir / f"{cid}.png")

    return {
        "id": cid,
        "src": f"/assets/characters/{cid}.png",
        "view": VIEW,
        "frames": FRAMES,
        "walkFps": 6 if cid in SLOW_IDS else 8,
        "clips": CLIPS,
    }


def write_metadata(entries: list[dict], path: Path) -> None:
    lines = [
        "// 由 scripts/art/postprocess.py 生成，请勿手改。",
        "import type { RasterMeta } from './raster';",
        "",
        "export const RASTER_META: Record<string, RasterMeta> = {",
    ]
    for e in entries:
        clips = json.dumps(e["clips"], separators=(", ", ": "))
        lines.append(
            f'  {e["id"]}: {{ src: \'{e["src"]}\', view: {e["view"]}, '
            f'frames: {e["frames"]}, walkFps: {e["walkFps"]}, clips: {clips} }},'
        )
    lines += ["};", ""]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines))


def process_icons(raw_path: Path, out_dir: Path, size: int = 48, content_h: int = 36) -> None:
    """4×2 图标表 -> 8 个 48×48 透明图标。"""
    cells = split_grid(Image.open(raw_path).convert("RGBA"), 4, 2)
    if len(cells) != len(ICON_IDS):
        raise ValueError(f"expected {len(ICON_IDS)} icon cells, got {len(cells)}")
    out_dir.mkdir(parents=True, exist_ok=True)
    for cid, cell in zip(ICON_IDS, cells):
        cut = cut_out(cell)
        w0, h0 = cut.size
        scale = min(content_h / h0, (size - 4) / w0)
        nw, nh = max(1, round(w0 * scale)), max(1, round(h0 * scale))
        small = cut.resize((nw, nh), Image.LANCZOS)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.alpha_composite(small, ((size - nw) // 2, (size - nh) // 2))
        quantize(canvas).save(out_dir / f"{cid}.png")


def process_title(raw_path: Path, out_path: Path) -> None:
    """裁到 3:2 并缩放到 1536×1024；可读性交给 UI 的暗色渐变遮罩。"""
    img = Image.open(raw_path).convert("RGB")
    w, h = img.size
    target = 3 / 2
    if w / h > target:
        nw = int(h * target)
        left = (w - nw) // 2
        img = img.crop((left, 0, left + nw, h))
    else:
        nh = int(w / target)
        top = (h - nh) // 2
        img = img.crop((0, top, w, top + nh))
    img = img.resize((1536, 1024), Image.LANCZOS)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=".art-cache/raw", help="原始生成图目录")
    ap.add_argument("--out", default="public/assets", help="输出资源目录")
    ap.add_argument("--meta", default="src/ui/rasterMeta.generated.ts", help="生成的元数据 TS 路径")
    ap.add_argument("--only", nargs="+", default=None, help="只处理指定角色 id")
    ap.add_argument("--extras", action="store_true", help="同时处理图标与标题图")
    args = ap.parse_args(argv)

    raw = Path(args.raw)
    out = Path(args.out)
    ids = args.only or CHARACTER_IDS
    entries: list[dict] = []
    failed = 0
    for cid in ids:
        try:
            entries.append(process_character(raw, cid, out / "characters", out / "portraits"))
            print("OK", cid)
        except Exception as exc:  # noqa: BLE001 - 逐角色报告，不中断批量
            failed += 1
            print("FAIL", cid, exc, file=sys.stderr)

    # --only 用于质量闸门：只生成单角色，不覆盖 14 条元数据。
    # 全量时也必须 14 个都成功才重写，避免失败角色从元数据里消失。
    if args.only is None and len(entries) == len(CHARACTER_IDS):
        write_metadata(entries, Path(args.meta))

    if args.extras:
        # 远端把 extras 写在 raw/extras/ 下，和角色目录平级；
        # 图标与标题各自独立，任一失败不影响另一个。
        jobs = [
            ("icons", raw / "extras" / "icons.png", out / "icons", process_icons),
            ("title", raw / "extras" / "title.png", out / "art" / "title.png", process_title),
        ]
        for name, src, dst, fn in jobs:
            try:
                fn(src, dst)
                print("OK", name)
            except Exception as exc:  # noqa: BLE001
                failed += 1
                print("FAIL", name, exc, file=sys.stderr)

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
