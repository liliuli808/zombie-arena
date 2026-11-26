# 角色精灵 H3 位图化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 5 个玩家职业与 9 种敌人的角色精灵替换为 H3 生成、后处理成 48px 的位图精灵表，并保留矢量回退。

**Architecture:** 每角色生成 walk / act / hurt 三张 2×2 表；`scripts/art/postprocess.py` 切表、去白底、统一缩放、脚底对齐、锁现有调色板（`scripts/spritegen/postprocess.py` 的 41 色列表；spec 里写作「37 色」是旧称）、补 1px 描边，合成 9 帧 432×48 PNG 并生成 `rasterMeta.generated.ts`。运行时 `src/ui/raster.ts` 异步预载并按片段选帧，`anim.ts` 优先画位图，未加载时回退现有矢量精灵。玩家实体 `kind` 改为职业 id，死亡使用独立视觉列表。

**Tech Stack:** TypeScript 5.7、Vite 6、Vitest 3、Canvas 2D、Python 3（PIL + numpy）、MiniMax H3 via Unsloth Studio on Colab。

---

## Before You Start

- 工作目录：`/home/jichi/zombie-arena`，分支 `master`。
- 工作树有大量与本计划无关的未提交改动。**每个提交只 `git add` 本任务列出的文件，禁止 `git add -A` / `git add .`**。
- 基线：`npm test` 当前 18 个测试文件、135 个测试全部通过。改动前先跑一次确认。
- Python 依赖已具备：`python3 -c "import numpy, PIL"` 通过。
- Colab 会话 `h3` 已安装 Unsloth Studio 并加载了 H3 GGUF；生成命令在 Task 14/15 才执行，前面任务不需要 GPU。
- 原始 1024px 图只写 `.art-cache/`，不提交。生成产物 `public/assets/characters/`、`portraits/`、`icons/`、`art/title.png` 需要提交。
- 所有中文注释与现有代码风格保持一致。

---

## Task 0: 基线确认与缓存目录

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 跑基线测试**

```bash
cd /home/jichi/zombie-arena
npm test
```

Expected: `Test Files 18 passed (18)`，`Tests 135 passed (135)`。

- [ ] **Step 2: 把原始图缓存加入 .gitignore**

在 `.gitignore` 末尾追加：

```gitignore
.art-cache/
```

- [ ] **Step 3: 提交**

```bash
git add .gitignore
git commit -m "chore: ignore local H3 art cache

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 1: 后处理基础函数（切格 / 去底 / 量化）

**Files:**
- Create: `scripts/art/postprocess.py`
- Create: `scripts/art/test_postprocess.py`

- [ ] **Step 1: 写失败测试**

创建 `scripts/art/test_postprocess.py`：

```python
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import postprocess as pp


def make_cell_sheet(path: Path, size=(1024, 1024), color=(120, 180, 90)) -> None:
    """2×2 白底表；每个角色有暗描边，内部再放一块白色衣服。"""
    img = Image.new("RGB", size, (255, 255, 255))
    d = ImageDraw.Draw(img)
    cw, ch = size[0] // 2, size[1] // 2
    for row in range(2):
        for col in range(2):
            cx, cy = col * cw + cw // 2, row * ch + ch // 2
            d.rectangle([cx - 70, cy - 200, cx + 70, cy + 200], fill=(12, 12, 12))
            d.rectangle([cx - 60, cy - 190, cx + 60, cy + 190], fill=color)
            d.rectangle([cx - 35, cy - 70, cx + 35, cy + 70], fill=(255, 255, 255))
            d.rectangle([cx - 60, cy + 150, cx + 60, cy + 190], fill=(40, 40, 50))
    img.save(path)


class SplitTests(unittest.TestCase):
    def test_split_cells_returns_four_512_cells(self):
        img = Image.new("RGB", (1024, 1024), (255, 255, 255))
        cells = pp.split_cells(img)
        self.assertEqual(len(cells), 4)
        for c in cells:
            self.assertEqual(c.size, (512, 512))

    def test_split_grid_supports_4_by_2(self):
        img = Image.new("RGB", (1024, 512), (255, 255, 255))
        cells = pp.split_grid(img, 4, 2)
        self.assertEqual(len(cells), 8)
        for c in cells:
            self.assertEqual(c.size, (256, 256))


class BackgroundTests(unittest.TestCase):
    def test_cut_out_removes_border_but_keeps_interior_white(self):
        with tempfile.TemporaryDirectory() as td:
            sheet = Path(td) / "walk.png"
            make_cell_sheet(sheet)
            cell = pp.split_cells(Image.open(sheet).convert("RGBA"))[0]
            out = pp.cut_out(cell)
            arr = np.array(out)
            self.assertLess(arr.shape[0], 500)
            self.assertLess(arr.shape[1], 500)
            opaque = arr[:, :, :3][arr[:, :, 3] > 0]
            interior_white = (opaque > 240).all(axis=1).sum()
            self.assertGreater(interior_white, 1000)

    def test_cut_out_raises_on_empty_cell(self):
        blank = Image.new("RGBA", (512, 512), (255, 255, 255, 255))
        with self.assertRaises(ValueError):
            pp.cut_out(blank)


class FitTests(unittest.TestCase):
    def make_cut(self) -> Image.Image:
        with tempfile.TemporaryDirectory() as td:
            sheet = Path(td) / "walk.png"
            make_cell_sheet(sheet)
            return pp.cut_out(pp.split_cells(Image.open(sheet).convert("RGBA"))[0])

    def test_fit_frames_places_feet_near_bottom_and_centers(self):
        cut = self.make_cut()
        fitted, scale = pp.fit_frames([cut])
        frame = fitted[0]
        self.assertEqual(frame.size, (48, 48))
        arr = np.array(frame)
        ys, xs = np.where(arr[:, :, 3] > 0)
        self.assertLessEqual(int(ys.max()), pp.FOOT_Y)
        self.assertGreaterEqual(int(ys.min()), 1)
        self.assertLessEqual(abs(float(xs.mean()) - 24.0), 2.0)
        self.assertGreater(scale, 0)

    def test_fit_frames_common_scale_for_all_frames(self):
        cut = self.make_cut()
        fitted, _ = pp.fit_frames([cut, cut])
        a = np.array(fitted[0])
        b = np.array(fitted[1])
        self.assertEqual(a.shape, b.shape)
        self.assertTrue(np.array_equal(a, b))


class QuantizeTests(unittest.TestCase):
    def test_quantize_only_emits_palette_colors(self):
        img = Image.new("RGBA", (4, 4), (123, 45, 200, 255))
        out = pp.quantize(img)
        arr = np.array(out)
        opaque = arr[:, :, :3][arr[:, :, 3] > 0]
        palette = set(map(tuple, pp.PALETTE.tolist()))
        for px in map(tuple, opaque):
            self.assertIn(px, palette)

    def test_add_outline_wraps_alpha(self):
        img = Image.new("RGBA", (5, 5), (0, 0, 0, 0))
        img.putpixel((2, 2), (120, 180, 90, 255))
        out = pp.add_outline(img)
        self.assertEqual(out.getpixel((1, 2)), (12, 12, 12, 255))
        self.assertEqual(out.getpixel((2, 2)), (120, 180, 90, 255))
        self.assertEqual(out.getpixel((0, 0)), (0, 0, 0, 0))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /home/jichi/zombie-arena
python3 scripts/art/test_postprocess.py -v
```

Expected: `ModuleNotFoundError: No module named 'postprocess'`。

- [ ] **Step 3: 写实现**

创建 `scripts/art/postprocess.py`：

```python
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
python3 scripts/art/test_postprocess.py -v
```

Expected: 8 tests PASS。

- [ ] **Step 5: 提交**

```bash
git add scripts/art/postprocess.py scripts/art/test_postprocess.py
git commit -m "feat(art): postprocess primitives for H3 sprite sheets

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 2: 角色表合成与元数据生成

**Files:**
- Modify: `scripts/art/postprocess.py`
- Modify: `scripts/art/test_postprocess.py`

- [ ] **Step 1: 写失败测试**

在 `scripts/art/test_postprocess.py` 的 `if __name__ == "__main__":` 之前追加：

```python
class ProcessCharacterTests(unittest.TestCase):
    def test_process_character_writes_9_frame_sheet_and_portrait(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            raw = root / "raw" / "walker"
            raw.mkdir(parents=True)
            for name in ("walk", "act", "hurt"):
                make_cell_sheet(raw / f"{name}.png")
            chars = root / "characters"
            portraits = root / "portraits"
            meta = pp.process_character(raw.parent, "walker", chars, portraits)
            sheet = Image.open(chars / "walker.png")
            self.assertEqual(sheet.size, (432, 48))
            arr = np.array(sheet.convert("RGBA"))
            for i in range(9):
                alpha = arr[:, i * 48:(i + 1) * 48, 3]
                self.assertGreater((alpha > 0).mean(), 0.03)
            self.assertEqual(meta["id"], "walker")
            self.assertEqual(meta["frames"], 9)
            self.assertEqual(meta["clips"]["walk"], [0, 1, 2, 3])
            self.assertEqual(Image.open(portraits / "walker.png").size, (160, 160))

    def test_write_metadata_emits_typescript(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "rasterMeta.generated.ts"
            pp.write_metadata([
                {"id": "walker", "src": "/assets/characters/walker.png",
                 "view": 48, "frames": 9, "walkFps": 8, "clips": pp.CLIPS},
            ], out)
            text = out.read_text()
            self.assertIn("import type { RasterMeta } from './raster';", text)
            self.assertIn("walker:", text)
            self.assertIn("/assets/characters/walker.png", text)
            self.assertIn('"walk": [0, 1, 2, 3]', text)
```

- [ ] **Step 2: 运行测试确认失败**

```bash
python3 scripts/art/test_postprocess.py -v
```

Expected: `AttributeError: module 'postprocess' has no attribute 'process_character'`。

- [ ] **Step 3: 写实现**

在 `scripts/art/postprocess.py` 的 `add_outline` 之后追加：

```python
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
python3 scripts/art/test_postprocess.py -v
```

Expected: 10 tests PASS。

- [ ] **Step 5: 提交**

```bash
git add scripts/art/postprocess.py scripts/art/test_postprocess.py
git commit -m "feat(art): compose 9-frame sheets and generated raster metadata

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 3: 后处理 CLI、图标与标题

**Files:**
- Modify: `scripts/art/postprocess.py`
- Modify: `scripts/art/test_postprocess.py`

- [ ] **Step 1: 写失败测试**

在 `scripts/art/test_postprocess.py` 的 `if __name__ == "__main__":` 之前追加：

```python
class ExtrasTests(unittest.TestCase):
    def test_process_icons_slices_4_by_2_into_48px(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            sheet = root / "icons.png"
            make_cell_sheet(sheet, size=(1024, 512))
            out = root / "icons"
            pp.process_icons(sheet, out)
            for cid in pp.ICON_IDS:
                self.assertTrue((out / f"{cid}.png").exists())
                self.assertEqual(Image.open(out / f"{cid}.png").size, (48, 48))

    def test_process_title_crops_and_resizes_to_1536_by_1024(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            raw = root / "title.png"
            Image.new("RGB", (1600, 1000), (20, 24, 32)).save(raw)
            out = root / "art" / "title.png"
            pp.process_title(raw, out)
            self.assertEqual(Image.open(out).size, (1536, 1024))
```

- [ ] **Step 2: 运行测试确认失败**

```bash
python3 scripts/art/test_postprocess.py -v
```

Expected: `AttributeError: module 'postprocess' has no attribute 'process_icons'`。

- [ ] **Step 3: 写实现**

在 `scripts/art/postprocess.py` 的 `write_metadata` 之后追加：

```python
def process_icons(raw_path: Path, out_dir: Path, size: int = 48, content_h: int = 36) -> None:
    """4×2 图标表 -> 8 个 48×48 透明图标。"""
    cells = split_grid(Image.open(raw_path).convert("RGBA"), 4, 2)
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
    ap.add_argument("--raw", default=".art-cache/raw")
    ap.add_argument("--out", default="public/assets")
    ap.add_argument("--meta", default="src/ui/rasterMeta.generated.ts")
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--extras", action="store_true")
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
        try:
            # 远端把 extras 写在 raw/extras/ 下，和角色目录平级
            process_icons(raw / "extras" / "icons.png", out / "icons")
            process_title(raw / "extras" / "title.png", out / "art" / "title.png")
            print("OK extras")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print("FAIL extras", exc, file=sys.stderr)

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: 运行测试确认通过**

```bash
python3 scripts/art/test_postprocess.py -v
```

Expected: 16 tests PASS。

- [ ] **Step 5: 提交**

```bash
git add scripts/art/postprocess.py scripts/art/test_postprocess.py
git commit -m "feat(art): postprocess CLI, icons and title

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

> **Post-review note:** the final CLI isolates icons/title failures (prints `OK icons` / `OK title`), uses `--only nargs="+"`, adds flag help text, and adds four mocked `MainTests` covering the metadata guard and extras isolation. Final suite after Task 3 is 16 tests; Task 4 brings it to 18.

---

## Task 4: 输出校验脚本

**Files:**
- Create: `scripts/art/validate.py`
- Modify: `scripts/art/test_postprocess.py`

- [ ] **Step 1: 写失败测试**

在 `scripts/art/test_postprocess.py` 顶部补 import：

```python
import validate as vv
```

在 `if __name__ == "__main__":` 之前追加：

```python
class ValidateTests(unittest.TestCase):
    def test_validate_sheet_accepts_processed_output(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            raw = root / "raw" / "walker"
            raw.mkdir(parents=True)
            for name in ("walk", "act", "hurt"):
                make_cell_sheet(raw / f"{name}.png")
            pp.process_character(raw.parent, "walker", root / "characters", root / "portraits")
            vv.validate_sheet(root / "characters" / "walker.png")

    def test_validate_sheet_rejects_wrong_size(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "bad.png"
            Image.new("RGBA", (100, 48), (0, 0, 0, 0)).save(path)
            with self.assertRaises(ValueError):
                vv.validate_sheet(path)
```

- [ ] **Step 2: 运行测试确认失败**

```bash
python3 scripts/art/test_postprocess.py -v
```

Expected: `ModuleNotFoundError: No module named 'validate'`。

- [ ] **Step 3: 写实现**

创建 `scripts/art/validate.py`：

```python
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


def validate_sheet(path: Path) -> None:
    img = Image.open(path).convert("RGBA")
    if img.size != (VIEW * FRAMES, VIEW):
        raise ValueError(f"{path}: expected {VIEW * FRAMES}x{VIEW}, got {img.size}")
    arr = np.array(img)
    palette = set(map(tuple, PALETTE.tolist()))
    for i in range(FRAMES):
        alpha = arr[:, i * VIEW:(i + 1) * VIEW, 3]
        coverage = float((alpha > 0).mean())
        if not (0.03 <= coverage <= 0.60):
            raise ValueError(f"{path}: frame {i} coverage {coverage:.3f} out of range")
        opaque = arr[:, i * VIEW:(i + 1) * VIEW, :3][alpha > 0]
        for px in map(tuple, opaque):
            if px not in palette:
                raise ValueError(f"{path}: frame {i} has non-palette color {px}")
    print("OK", path)


def validate_portrait(path: Path) -> None:
    img = Image.open(path)
    if img.size != (160, 160):
        raise ValueError(f"{path}: expected 160x160, got {img.size}")
    print("OK", path)


def validate_icon(path: Path) -> None:
    img = Image.open(path)
    if img.size != (48, 48):
        raise ValueError(f"{path}: expected 48x48, got {img.size}")
    print("OK", path)


def validate_title(path: Path) -> None:
    img = Image.open(path)
    if img.size != TITLE_SIZE:
        raise ValueError(f"{path}: expected {TITLE_SIZE}, got {img.size}")
    print("OK", path)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--assets", default="public/assets")
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--extras", action="store_true")
    args = ap.parse_args(argv)

    assets = Path(args.assets)
    ids = args.only or CHARACTER_IDS
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
python3 scripts/art/test_postprocess.py -v
```

Expected: 21 tests PASS。

- [ ] **Step 5: 提交**

```bash
git add scripts/art/validate.py scripts/art/test_postprocess.py
git commit -m "feat(art): validate generated sheets and extras

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

> **Post-review note:** `--only` uses `nargs="+"` so a bare flag is an argparse error; non-palette errors print plain ints; size messages use `WxH`; all `Image.open` calls use context managers. Review added three tests (non-palette pixel, missing-asset exit code, `--only` scoping), bringing the suite to 21.

---

## Task 5: 生成清单与提示词/任务规划

**Files:**
- Create: `scripts/art/manifest.json`
- Create: `scripts/art/generate_remote.py`
- Create: `scripts/art/test_generate.py`

- [ ] **Step 1: 写失败测试**

创建 `scripts/art/test_generate.py`：

```python
import json
import unittest
from pathlib import Path

import generate_remote as gr

ROOT = Path(__file__).resolve().parent


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.m = json.loads((ROOT / "manifest.json").read_text())

    def test_has_14_unique_characters_with_required_fields(self):
        chars = self.m["characters"]
        self.assertEqual(len(chars), 14)
        ids = [c["id"] for c in chars]
        self.assertEqual(len(ids), len(set(ids)))
        for c in chars:
            self.assertIn("subject", c)
            self.assertIn("act", c)
            self.assertIn("seed", c)

    def test_player_classes_keep_hands_empty(self):
        for c in self.m["characters"]:
            if c["id"] in {"veteran", "wizard", "engineer", "ronin", "jailer"}:
                self.assertTrue(c.get("empty_hands"), c["id"])


class PromptTests(unittest.TestCase):
    def test_walk_prompt_mentions_grid_and_subject(self):
        p = gr.build_walk_prompt("STYLE", "a green zombie")
        self.assertIn("2 by 2", p)
        self.assertIn("a green zombie", p)
        self.assertIn("pure white background", p)

    def test_reference_prompt_mentions_picture_and_action(self):
        p = gr.build_reference_prompt("a green zombie", "lunging forward", False)
        self.assertIn("<Picture 1>", p)
        self.assertIn("lunging forward", p)
        self.assertNotIn("Keep both hands empty", p)

    def test_reference_prompt_can_forbid_weapons(self):
        p = gr.build_reference_prompt("a wizard", "casting", True)
        self.assertIn("Keep both hands empty", p)


class PlanTests(unittest.TestCase):
    def setUp(self):
        self.m = json.loads((ROOT / "manifest.json").read_text())

    def test_plan_orders_walk_act_hurt_per_character(self):
        jobs = gr.plan_jobs(self.m, existing=set())
        walker = [j for j in jobs if j["id"] == "walker" and j["kind"] == "character"]
        self.assertEqual([j["sheet"] for j in walker], ["walk", "act", "hurt"])

    def test_plan_skips_existing_and_respects_only(self):
        existing = {"walker/walk.png", "walker/act.png", "walker/hurt.png"}
        jobs = gr.plan_jobs(self.m, existing=existing, only={"walker"})
        # 角色任务已存在；extras 尚未生成，仍应排入
        self.assertEqual([j for j in jobs if j["kind"] == "character"], [])
        self.assertEqual([j["kind"] for j in jobs], ["title", "icons"])

    def test_plan_adds_extras(self):
        jobs = gr.plan_jobs(self.m, existing=set(), only={"walker"})
        kinds = [j["kind"] for j in jobs]
        self.assertIn("title", kinds)
        self.assertIn("icons", kinds)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 运行测试确认失败**

```bash
python3 scripts/art/test_generate.py -v
```

Expected: `FileNotFoundError`（manifest 不存在）。

- [ ] **Step 3: 写 manifest**

创建 `scripts/art/manifest.json`：

```json
{
  "style": "16-bit pixel art game sprite sheet, 2 by 2 grid of four frames of the SAME",
  "negative": "blurry, 3d render, photorealistic, multiple different characters, text, watermark, grid lines, background scenery, cropped limbs, extra limbs, front view, ceiling, floor",
  "size": [1024, 1024],
  "steps": 6,
  "guidance": 1.0,
  "hurt": "recoiling backward, staggering sideways, collapsing to its knees",
  "characters": [
    { "id": "veteran", "subject": "battle-worn survivor in a dark blue jacket, red knit beanie, dark red scarf, dark trousers, boots, empty hands", "act": "miming a pistol aim with both hands and recoiling backward", "empty_hands": true, "seed": 1001 },
    { "id": "wizard", "subject": "gaunt wizard in a purple hooded robe with gold trim, pointed hat, glowing eyes, empty hands", "act": "raising both hands to cast a spell, robe flaring", "empty_hands": true, "seed": 1002 },
    { "id": "engineer", "subject": "stocky engineer in grey overalls, mustard yellow hard hat, orange tool belt, goggles, empty hands", "act": "tossing a device forward and pointing at it", "empty_hands": true, "seed": 1003 },
    { "id": "ronin", "subject": "lean ronin in a dark red haori, straw kasa hat, white sash, dark hakama, empty hands", "act": "miming a fast diagonal sword slash with both hands", "empty_hands": true, "seed": 1004 },
    { "id": "jailer", "subject": "broad jailer in a navy uniform, peaked cap, iron shoulder plate, chain at the belt, empty hands", "act": "miming a two-handed overhead swing", "empty_hands": true, "seed": 1005 },
    { "id": "walker", "subject": "shambling green-skinned zombie, torn grey shirt, dark trousers, bald head", "act": "lunging forward with both arms stretched out, mouth open", "empty_hands": false, "seed": 1006 },
    { "id": "runner", "subject": "lean sprinting zombie, ragged red shirt, exposed muscle, wild forward posture", "act": "sprinting lunge with arms swept back and mouth open", "empty_hands": false, "seed": 1007 },
    { "id": "fatty", "subject": "bloated obese zombie, dirty white shirt, huge belly, thick limbs", "act": "belly-first charge with both arms spread wide", "empty_hands": false, "seed": 1008 },
    { "id": "shield", "subject": "zombie riot officer, dark metal helmet, large rectangular riot shield, dark green jacket", "act": "raising the riot shield and shoving forward", "empty_hands": false, "seed": 1009 },
    { "id": "spitter", "subject": "bloated zombie with glowing green acid sacs on throat and chest, dripping acid", "act": "hunching and spitting a stream of green acid", "empty_hands": false, "seed": 1010 },
    { "id": "summoner", "subject": "hooded zombie sorcerer in purple robes, glowing yellow eyes, holding a skull staff", "act": "raising the skull staff overhead to summon", "empty_hands": false, "seed": 1011 },
    { "id": "armored", "subject": "zombie SWAT officer in heavy dark plate armor, cracked visor helmet, big shoulder plates", "act": "heavy shoulder charge with both arms tucked", "empty_hands": false, "seed": 1012 },
    { "id": "butcher", "subject": "giant butcher zombie, bloody white apron, bald scarred head, huge meat cleaver", "act": "overhead cleaver swing with both hands", "empty_hands": false, "seed": 1013 },
    { "id": "mother", "subject": "giant pale green brood mother, bloated body with glowing pustules, four thin clawed arms", "act": "rearing up and slamming down with clawed arms", "empty_hands": false, "seed": 1014 }
  ],
  "extras": {
    "title": {
      "prompt": "16-bit pixel art, abandoned industrial cargo yard at night, dark moody lighting, wet asphalt, oil stains, distant zombie silhouettes at the edges, empty dark space in the upper center for a title, muted palette, no text, no logo, no border",
      "width": 1536,
      "height": 1024,
      "seed": 2001
    },
    "icons": {
      "prompt": "16-bit pixel art game item icon sheet, 4 columns by 2 rows, one single item centered in each cell: medkit, fragmentation grenade, energy shield, speed boots, body armor, crit scope, healing charm, battery. Identical pixel-art style and dark outlines, pure white background, no dividing lines, no text, no labels, no shadow",
      "width": 1024,
      "height": 512,
      "seed": 2002
    }
  }
}
```

- [ ] **Step 4: 写生成脚本的纯函数与 dry-run**

创建 `scripts/art/generate_remote.py`：

```python
#!/usr/bin/env python3
"""在 Colab 上生成 H3 原始表。

纯函数部分（提示词、任务规划）可本地单测；HTTP 部分只在 Colab 上运行。
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8888"
KEY_PATH = "/content/studio_api_key.txt"
CHAR_SHEETS = ("walk", "act", "hurt")


def build_walk_prompt(style: str, subject: str) -> str:
    return (
        f"{style} {subject}, side view facing right, full body from head to feet, "
        "dark outlines, muted palette, evenly spaced, pure white background, "
        "no shadow, no dividing lines, no text, no labels."
    )


def build_reference_prompt(subject: str, action: str, empty_hands: bool) -> str:
    hands = " Keep both hands empty; do not draw any weapon." if empty_hands else ""
    return (
        "Use <Picture 1> as the exact character reference: same design, same colors, "
        "same proportions, same pixel-art style and outlines. Create a 2 by 2 grid of "
        f"four frames showing this same character {action}. Full body from head to feet "
        "in every cell, identical character in every cell, pure white background, "
        f"no dividing lines, no text, no labels.{hands}"
    )


def plan_jobs(manifest: dict, existing: set[str], only: set[str] | None = None,
              force: bool = False) -> list[dict]:
    jobs: list[dict] = []
    for c in manifest["characters"]:
        cid = c["id"]
        if only and cid not in only:
            continue
        for sheet in CHAR_SHEETS:
            rel = f"{cid}/{sheet}.png"
            if not force and rel in existing:
                continue
            prompt = (
                build_walk_prompt(manifest["style"], c["subject"])
                if sheet == "walk"
                else build_reference_prompt(
                    c["subject"],
                    c["act"] if sheet == "act" else manifest["hurt"],
                    bool(c.get("empty_hands")),
                )
            )
            jobs.append({
                "kind": "character",
                "id": cid,
                "sheet": sheet,
                "prompt": prompt,
                "seed": c["seed"] + (0 if sheet == "walk" else 100 if sheet == "act" else 200),
                "init": f"{cid}/walk.png" if sheet in ("act", "hurt") else None,
            })
    extras = manifest.get("extras", {})
    for key in ("title", "icons"):
        rel = f"extras/{key}.png"
        if force or rel not in existing:
            e = extras[key]
            jobs.append({
                "kind": key,
                "id": "extras",
                "sheet": key,
                "prompt": e["prompt"],
                "seed": e["seed"],
                "width": e["width"],
                "height": e["height"],
                "init": None,
            })
    return jobs


def read_key() -> str:
    return Path(KEY_PATH).read_text().strip()


def request(path: str, body: dict | None = None, timeout: int = 1200, raw: bool = False):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": "Bearer " + read_key()}
    if data is not None:
        headers["Content-Type"] = "application/json"
    url = path if path.startswith("http") else BASE + ("" if path.startswith("/") else "/") + path
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        payload = r.read()
    return payload if raw else (json.loads(payload) if payload else {})


def ensure_loaded() -> None:
    st = request("/api/inference/images/status")
    if st.get("loaded"):
        return
    print("LOADING_MODEL", flush=True)
    body = {
        "model_path": "unsloth/MiniMax-H3-Image-GGUF",
        "gguf_filename": "minimax_h3_image_pruned-UD-Q4_K_XL.gguf",
        "model_kind": "gguf",
        "display_repo_id": "unsloth/MiniMax-H3-Image-GGUF",
        "base_repo": "MiniMaxAI/MiniMax-H3-Image",
    }
    try:
        request("/api/inference/images/load", body, timeout=5400)
    except urllib.error.HTTPError as exc:
        print("LOAD_HTTP", exc.code, flush=True)
    for _ in range(900):
        if request("/api/inference/images/status").get("loaded"):
            return
        time.sleep(2)
    raise RuntimeError("model load timed out")


def generate_one(job: dict, raw_dir: Path, manifest: dict) -> None:
    width = job.get("width", manifest["size"][0])
    height = job.get("height", manifest["size"][1])
    body = {
        "prompt": job["prompt"],
        "negative_prompt": manifest["negative"],
        "width": width,
        "height": height,
        "steps": manifest["steps"],
        "guidance": manifest["guidance"],
        "seed": job["seed"],
    }
    if job.get("init"):
        init_path = raw_dir / job["init"]
        encoded = base64.b64encode(init_path.read_bytes()).decode()
        body["init_image"] = "data:image/png;base64," + encoded
        body["workflow"] = "reference"
    data = request("/api/inference/images/generate", body)
    image = data["images"][0]
    # GalleryImage 通常带 url；缺失时退回已知的 file 端点
    url = image.get("url") or f"/api/inference/images/gallery/{image['id']}/file"
    png = request(url, raw=True)
    if job["kind"] == "character":
        out = raw_dir / job["id"] / f"{job['sheet']}.png"
    else:
        out = raw_dir / "extras" / f"{job['sheet']}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(png)


def write_status(path: Path, status: dict) -> None:
    path.write_text(json.dumps(status, ensure_ascii=False, indent=2))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default="/content/art/manifest.json")
    ap.add_argument("--out", default="/content/art/raw")
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    manifest = json.loads(Path(args.manifest).read_text())
    raw_dir = Path(args.out)
    raw_dir.mkdir(parents=True, exist_ok=True)
    existing = {
        str(p.relative_to(raw_dir)) for p in raw_dir.rglob("*.png")
    }
    jobs = plan_jobs(manifest, existing, set(args.only) if args.only else None, args.force)

    if args.dry_run:
        print(json.dumps(jobs, ensure_ascii=False, indent=2))
        print(f"PLANNED {len(jobs)}", flush=True)
        return 0

    ensure_loaded()
    status_path = raw_dir.parent / "status.json"
    done: list[str] = []
    failed: list[str] = []
    for index, job in enumerate(jobs):
        name = f"{job['id']}/{job['sheet']}"
        write_status(status_path, {"current": name, "index": index, "total": len(jobs),
                                   "done": done, "failed": failed})
        for attempt in range(3):
            try:
                generate_one(job, raw_dir, manifest)
                done.append(name)
                print("OK", name, flush=True)
                break
            except Exception as exc:  # noqa: BLE001
                print("RETRY", name, attempt + 1, repr(exc), flush=True)
                time.sleep(3)
        else:
            failed.append(name)
            print("FAILED", name, flush=True)

    write_status(status_path, {"current": None, "total": len(jobs),
                               "done": done, "failed": failed, "finished": True})
    archive = raw_dir.parent / "raw"
    if archive.with_suffix(".zip").exists():
        archive.with_suffix(".zip").unlink()
    shutil.make_archive(str(archive), "zip", raw_dir)
    print("ALL_DONE", len(done), "failed", len(failed), flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: 运行测试确认通过**

```bash
python3 scripts/art/test_generate.py -v
python3 scripts/art/generate_remote.py --manifest scripts/art/manifest.json --out /tmp/art-raw --dry-run | tail -5
```

Expected: 11 tests PASS；dry-run 输出 `PLANNED 44`（14×3 + 2）。

- [ ] **Step 6: 提交**

```bash
git add scripts/art/manifest.json scripts/art/generate_remote.py scripts/art/test_generate.py
git commit -m "feat(art): H3 manifest, prompt builders and job planner

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

> **Post-review note:** final planner has 11 tests (seed/init wiring, unique seeds, force replan, extras skip). Remote writes are atomic (`tmp` + `os.replace`); `--only` uses `nargs="+"`; `ensure_loaded()` is skipped when there are no jobs; missing key/load failures write a finished `status.json` and exit 2/1; the archive follows `--out`; retries do not sleep after the last attempt; failures are recorded in an `errors` list; the walk prompt appends the grid clause only when the style lacks it.

---

## Task 6: 本地 Colab 编排脚本

**Files:**
- Create: `scripts/colab_gen_art.py`

- [ ] **Step 1: 写 dry-run 脚本**

创建 `scripts/colab_gen_art.py`：

```python
#!/usr/bin/env python3
"""本地入口：上传 manifest/脚本到 Colab，后台生成，轮询，下载，后处理。

用法:
    python3 scripts/colab_gen_art.py --only walker
    python3 scripts/colab_gen_art.py
    python3 scripts/colab_gen_art.py --skip-generate
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

SESSION = "h3"
REMOTE = "/content/art"
LOCAL_CACHE = Path(".art-cache")
RAW = LOCAL_CACHE / "raw"


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def ssh(script: str) -> str:
    proc = subprocess.run(
        ["colab", "ssh", "-s", SESSION, "--", "bash", "-lc", script],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        raise SystemExit(proc.returncode)
    return proc.stdout


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="+", default=None)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--skip-generate", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    only = args.only or []
    only_arg = ("--only " + " ".join(only)) if only else ""
    force_arg = "--force" if args.force else ""

    upload_manifest = ["colab", "upload", "-s", SESSION,
                       "scripts/art/manifest.json", f"{REMOTE}/manifest.json"]
    upload_script = ["colab", "upload", "-s", SESSION,
                     "scripts/art/generate_remote.py", f"{REMOTE}/generate_remote.py"]
    start = (f"mkdir -p {REMOTE}/raw && cd {REMOTE} && "
             f"nohup python3 generate_remote.py --manifest {REMOTE}/manifest.json "
             f"--out {REMOTE}/raw {only_arg} {force_arg} > gen.log 2>&1 & echo $!")
    download = ["colab", "download", "-s", SESSION, f"{REMOTE}/raw.zip",
                str(LOCAL_CACHE / "raw.zip")]

    if args.dry_run:
        print("+", " ".join(upload_manifest))
        print("+", " ".join(upload_script))
        print(f"+ colab ssh -s {SESSION} -- bash -lc '{start}'")
        print("+ poll: cat /content/art/status.json every 20s")
        print("+", " ".join(download))
        print(f"+ python3 scripts/art/postprocess.py {only_arg} --extras"
              if only else
              "+ python3 scripts/art/postprocess.py --extras")
        print(f"+ python3 scripts/art/validate.py {only_arg} --extras"
              if only else
              "+ python3 scripts/art/validate.py --extras")
        return 0

    if not args.skip_generate:
        LOCAL_CACHE.mkdir(exist_ok=True)
        ssh(f"mkdir -p {REMOTE}")
        run(upload_manifest)
        run(upload_script)
        ssh(start)
        deadline = time.time() + 45 * 60
        while True:
            if time.time() > deadline:
                print("生成超时，查看 /content/art/gen.log", file=sys.stderr)
                return 1
            raw_status = ssh(f"cat {REMOTE}/status.json 2>/dev/null || true")
            if raw_status.strip():
                status = json.loads(raw_status)
                print(f"[{status.get('index', 0) + 1}/{status.get('total', '?')}] "
                      f"{status.get('current')} done={len(status.get('done', []))} "
                      f"failed={len(status.get('failed', []))}", flush=True)
                if status.get("finished"):
                    if status.get("failed"):
                        print("失败项:", status["failed"], file=sys.stderr)
                    break
            time.sleep(20)
        run(download)
        if RAW.exists():
            shutil.rmtree(RAW)
        with zipfile.ZipFile(LOCAL_CACHE / "raw.zip") as zf:
            zf.extractall(RAW)

    post = [sys.executable, "scripts/art/postprocess.py", "--extras"]
    val = [sys.executable, "scripts/art/validate.py", "--extras"]
    if only:
        post[3:3] = ["--only", *only]
        val[3:3] = ["--only", *only]
    run(post)
    run(val)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: 运行 dry-run**

```bash
python3 scripts/colab_gen_art.py --dry-run --only walker
```

Expected: 打印 upload/ssh/poll/download/postprocess/validate 七行命令，不访问 Colab。

- [ ] **Step 3: 提交**

```bash
git add scripts/colab_gen_art.py
git commit -m "feat(art): local Colab orchestration for sprite generation

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

> **Post-review note:** reruns clear stale `status.json`/`raw.zip` and abort if a generator is still running; the remote job is launched as a grouped `nohup … & echo $!` so the real PID is captured, and a dead PID fails fast with `gen.log` while a timeout kills it; `finished` is only written after the archive exists; downloads go through `testzip()` + atomic swap so the old cache survives a corrupt zip; unknown/zero-job `--only` ids fail loudly; dry-run prints the exact argv. Verified directly (compile, 7-line dry-run, bare `--only` exits 2).

---

## Task 7: 运行时 raster 模块

**Files:**
- Create: `src/ui/raster.ts`
- Create: `src/ui/raster.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/ui/raster.test.ts`：

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { RASTER_META } from './rasterMeta.generated';
import {
  __resetRasterForTest, __setRasterForTest, clipFrame, pickClip,
  preloadRasterSheets, rasterFor, type LoadedSheet,
} from './raster';

const WALKER: LoadedSheet = {
  id: 'walker',
  src: '/assets/characters/walker.png',
  view: 48,
  frames: 9,
  walkFps: 8,
  clips: { idle: [0], walk: [0, 1, 2, 3], attack: [4, 5, 6], hit: [7], death: [8] },
  image: {} as CanvasImageSource,
};

describe('RASTER_META', () => {
  it('covers all 14 characters with 9 frames and in-range clips', () => {
    expect(Object.keys(RASTER_META)).toHaveLength(14);
    for (const [id, meta] of Object.entries(RASTER_META)) {
      expect(meta.frames, id).toBe(9);
      expect(meta.src, id).toBe(`/assets/characters/${id}.png`);
      for (const frames of Object.values(meta.clips)) {
        expect(frames.length).toBeGreaterThan(0);
        for (const f of frames) {
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThan(9);
        }
      }
    }
  });
});

describe('clipFrame', () => {
  it('returns the only frame for idle, hit and death', () => {
    expect(clipFrame(WALKER, 'idle', 0.4)).toBe(0);
    expect(clipFrame(WALKER, 'hit', 0.2)).toBe(7);
    expect(clipFrame(WALKER, 'death', 0.9)).toBe(8);
  });

  it('cycles walk frames by walkFps', () => {
    expect(clipFrame(WALKER, 'walk', 0)).toBe(0);
    expect(clipFrame(WALKER, 'walk', 0.13)).toBe(1);
    expect(clipFrame(WALKER, 'walk', 0.26)).toBe(2);
    expect(clipFrame(WALKER, 'walk', 0.5)).toBe(0);
  });

  it('maps attack phase to windup, strike and recover', () => {
    expect(clipFrame(WALKER, 'attack', 0)).toBe(4);
    expect(clipFrame(WALKER, 'attack', 0.34)).toBe(5);
    expect(clipFrame(WALKER, 'attack', 0.99)).toBe(6);
  });
});

describe('pickClip', () => {
  it('uses death > hit > attack > walk > idle', () => {
    expect(pickClip({ dead: true, hitT: 1, atkT: 1, moving: true })).toBe('death');
    expect(pickClip({ hitT: 0.1, atkT: 1, moving: true })).toBe('hit');
    expect(pickClip({ atkT: 0.1, moving: true })).toBe('attack');
    expect(pickClip({ moving: true })).toBe('walk');
    expect(pickClip({})).toBe('idle');
  });
});

describe('loader', () => {
  afterEach(() => __resetRasterForTest());

  it('no-ops without an Image constructor', async () => {
    const original = (globalThis as { Image?: unknown }).Image;
    delete (globalThis as { Image?: unknown }).Image;
    await expect(preloadRasterSheets(['walker'])).resolves.toBeUndefined();
    expect(rasterFor('walker')).toBeUndefined();
    if (original) (globalThis as { Image?: unknown }).Image = original;
  });

  it('exposes a sheet injected for tests', () => {
    __setRasterForTest('walker', WALKER);
    expect(rasterFor('walker')).toBe(WALKER);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/ui/raster.test.ts
```

Expected: 找不到 `./raster` 与 `./rasterMeta.generated`。

- [ ] **Step 3: 写实现**

创建 `src/ui/raster.ts`：

```ts
import { RASTER_META } from './rasterMeta.generated';

export type ClipId = 'idle' | 'walk' | 'attack' | 'hit' | 'death';

export interface RasterMeta {
  src: string;
  view: number;
  frames: number;
  walkFps: number;
  clips: Record<ClipId, number[]>;
}

export interface LoadedSheet extends RasterMeta {
  id: string;
  image: CanvasImageSource;
}

export interface ClipState {
  dead?: boolean;
  hitT?: number;
  atkT?: number;
  moving?: boolean;
}

const loaded = new Map<string, LoadedSheet>();

/** 测试用：清空/注入已加载的表。 */
export function __resetRasterForTest(): void { loaded.clear(); }
export function __setRasterForTest(id: string, sheet: LoadedSheet): void {
  loaded.set(id, sheet);
}

export async function preloadRasterSheets(
  ids: string[] = Object.keys(RASTER_META),
): Promise<void> {
  if (typeof Image === 'undefined') return;
  await Promise.all(ids.map(async (id) => {
    const meta = RASTER_META[id];
    if (!meta) return;
    const image = new Image();
    image.src = meta.src;
    try {
      await image.decode();
      loaded.set(id, { ...meta, id, image });
    } catch {
      // 单张失败只回退该角色，不阻塞其余资源
    }
  }));
}

export function rasterFor(id: string): LoadedSheet | undefined {
  return loaded.get(id);
}

export function pickClip(s: ClipState): ClipId {
  if (s.dead) return 'death';
  if ((s.hitT ?? 0) > 0) return 'hit';
  if ((s.atkT ?? 0) > 0) return 'attack';
  return s.moving ? 'walk' : 'idle';
}

export function clipFrame(sheet: LoadedSheet, clip: ClipId, phase: number): number {
  const frames = sheet.clips[clip];
  if (!frames || frames.length === 0) return 0;
  if (clip === 'idle' || clip === 'hit' || clip === 'death') return frames[0]!;
  if (clip === 'walk') {
    const i = Math.floor(phase * sheet.walkFps) % frames.length;
    return frames[i]!;
  }
  const i = Math.min(frames.length - 1, Math.floor(phase * frames.length));
  return frames[i]!;
}

export function drawRasterFrame(
  ctx: CanvasRenderingContext2D, sheet: LoadedSheet, frame: number,
  x: number, y: number, size: number, flip: boolean,
): void {
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x), Math.round(y));
  if (flip) ctx.scale(-1, 1);
  const sx = frame * sheet.view;
  ctx.drawImage(sheet.image, sx, 0, sheet.view, sheet.view,
    -size / 2, -size / 2, size, size);
  ctx.restore();
  ctx.imageSmoothingEnabled = smoothing;
}
```

创建 `src/ui/rasterMeta.generated.ts`（初始 14 条；Task 15 会由脚本重写）：

```ts
// 由 scripts/art/postprocess.py 生成，请勿手改。
import type { RasterMeta } from './raster';

export const RASTER_META: Record<string, RasterMeta> = {
  veteran: { src: '/assets/characters/veteran.png', view: 48, frames: 9, walkFps: 8, clips: { idle: [0], walk: [0, 1, 2, 3], attack: [4, 5, 6], hit: [7], death: [8] } },
  wizard: { src: '/assets/characters/wizard.png', view: 48, frames: 9, walkFps: 8, clips: { idle: [0], walk: [0, 1, 2, 3], attack: [4, 5, 6], hit: [7], death: [8] } },
  engineer: { src: '/assets/characters/engineer.png', view: 48, frames: 9, walkFps: 8, clips: { idle: [0], walk: [0, 1, 2, 3], attack: [4, 5, 6], hit: [7], death: [8] } },
  ronin: { src: '/assets/characters/ronin.png', view: 48, frames: 9, walkFps: 8, clips: { idle: [0], walk: [0, 1, 2, 3], attack: [4, 5, 6], hit: [7], death: [8] } },
  jailer: { src: '/assets/characters/jailer.png', view: 48, frames: 9, walkFps: 8, clips: { idle: [0], walk: [0, 1, 2, 3], attack: [4, 5, 6], hit: [7], death: [8] } },
  walker: { src: '/assets/characters/walker.png', view: 48, frames: 9, walkFps: 8, clips: { idle: [0], walk: [0, 1, 2, 3], attack: [4, 5, 6], hit: [7], death: [8] } },
  runner: { src: '/assets/characters/runner.png', view: 48, frames: 9, walkFps: 8, clips: { idle: [0], walk: [0, 1, 2, 3], attack: [4, 5, 6], hit: [7], death: [8] } },
  fatty: { src: '/assets/characters/fatty.png', view: 48, frames: 9, walkFps: 6, clips: { idle: [0], walk: [0, 1, 2, 3], attack: [4, 5, 6], hit: [7], death: [8] } },
  shield: { src: '/assets/characters/shield.png', view: 48, frames: 9, walkFps: 8, clips: { idle: [0], walk: [0, 1, 2, 3], attack: [4, 5, 6], hit: [7], death: [8] } },
  spitter: { src: '/assets/characters/spitter.png', view: 48, frames: 9, walkFps: 8, clips: { idle: [0], walk: [0, 1, 2, 3], attack: [4, 5, 6], hit: [7], death: [8] } },
  summoner: { src: '/assets/characters/summoner.png', view: 48, frames: 9, walkFps: 8, clips: { idle: [0], walk: [0, 1, 2, 3], attack: [4, 5, 6], hit: [7], death: [8] } },
  armored: { src: '/assets/characters/armored.png', view: 48, frames: 9, walkFps: 8, clips: { idle: [0], walk: [0, 1, 2, 3], attack: [4, 5, 6], hit: [7], death: [8] } },
  butcher: { src: '/assets/characters/butcher.png', view: 48, frames: 9, walkFps: 6, clips: { idle: [0], walk: [0, 1, 2, 3], attack: [4, 5, 6], hit: [7], death: [8] } },
  mother: { src: '/assets/characters/mother.png', view: 48, frames: 9, walkFps: 6, clips: { idle: [0], walk: [0, 1, 2, 3], attack: [4, 5, 6], hit: [7], death: [8] } },
};
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run src/ui/raster.test.ts
```

Expected: 7 tests PASS。

- [ ] **Step 5: 提交**

```bash
git add src/ui/raster.ts src/ui/raster.test.ts src/ui/rasterMeta.generated.ts
git commit -m "feat(ui): raster sheet loader and clip selection

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

> **Post-review note:** spec review confirmed the three files match the plan byte-for-byte. Quality review added one loader success-path test (fake `Image` with a resolving `decode()`), so the raster suite is 8 tests and the project total is 143 (19 files).

---

## Task 8: 矢量回退与职业尺寸

**Files:**
- Modify: `src/ui/sprites.ts`
- Modify: `src/ui/render.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/ui/render.test.ts` 的 `describe('spriteDrawSize', ...)` 内追加：

```ts
  it('registers player classes and maps them to the vector survivor', async () => {
    const { vectorIdFor } = await import('./sprites');
    for (const id of ['veteran', 'wizard', 'engineer', 'ronin', 'jailer']) {
      expect(spriteDrawSize(id), id).toBe(48);
      expect(vectorIdFor(id), id).toBe('player');
    }
    expect(vectorIdFor('walker')).toBe('walker');
  });
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/ui/render.test.ts
```

Expected: `vectorIdFor` 未导出，或职业尺寸回退到 72。

- [ ] **Step 3: 改 sprites.ts**

把 `SPRITE_SIZE` 开头改为：

```ts
const SPRITE_SIZE: Record<string, number> = {
  veteran: 48, wizard: 48, engineer: 48, ronin: 48, jailer: 48,
  player: 48, walker: 48, runner: 48, fatty: 54, shield: 48, spitter: 48,
  summoner: 52, armored: 54, butcher: 72, mother: 72,
  barrel: 48, crate: 48, turret: 48, grid: 48, drone: 44,
};

const VECTOR_FALLBACK: Record<string, string> = {
  veteran: 'player', wizard: 'player', engineer: 'player',
  ronin: 'player', jailer: 'player',
};

/** 职业 id 没有独立矢量骨架，回退到通用幸存者。 */
export function vectorIdFor(id: string): string {
  return VECTOR_FALLBACK[id] ?? id;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run src/ui/render.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/ui/sprites.ts src/ui/render.test.ts
git commit -m "feat(ui): player class sizes and vector fallback ids

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

> **Post-review note:** the five class ids and the `player` fallback are derived from a single `PLAYER_CLASSES` list; `frameShapes`/`spriteFrameCount`/`drawSprite` map ids through `vectorIdFor` internally. A separate `chore` commit (`918ff15`) captured the previously untracked vector-migration baseline (`vector.ts`, `anim.ts`, `bullets.ts`, `characters.ts`, `rig.ts`, modified core files) so the branch is buildable from HEAD.

---

## Task 9: 动画层接入位图与 atkDur

**Files:**
- Modify: `src/ui/anim.ts`
- Create: `src/ui/anim.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/ui/anim.test.ts`：

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { drawEntity, drawDeath } from './anim';
import { __resetRasterForTest, __setRasterForTest, type LoadedSheet } from './raster';
import type { Entity } from '../core/types';

const SHEET: LoadedSheet = {
  id: 'walker',
  src: '/assets/characters/walker.png',
  view: 48,
  frames: 9,
  walkFps: 8,
  clips: { idle: [0], walk: [0, 1, 2, 3], attack: [4, 5, 6], hit: [7], death: [8] },
  image: {} as CanvasImageSource,
};

function stubCtx(calls: string[]): CanvasRenderingContext2D {
  return new Proxy({}, { get: (_t, k) => {
    if (k === 'canvas') return { width: 960, height: 640 };
    return (...args: unknown[]) => { calls.push(String(k)); void args; };
  } }) as unknown as CanvasRenderingContext2D;
}

function zombie(kind = 'walker'): Entity {
  return { id: 2, kind, x: 100, y: 100, radius: 11, hp: 10, maxHp: 10,
    speed: 40, facing: 0, tags: [], statuses: [], dead: false, ttl: 0,
    data: { moving: 0, walk: 0 } };
}

describe('drawEntity raster path', () => {
  afterEach(() => __resetRasterForTest());

  it('uses drawImage when a sheet is loaded', () => {
    __setRasterForTest('walker', SHEET);
    const calls: string[] = [];
    drawEntity(stubCtx(calls), zombie(), 0);
    expect(calls).toContain('drawImage');
  });

  it('falls back to vector shapes when no sheet is loaded', () => {
    const calls: string[] = [];
    drawEntity(stubCtx(calls), zombie('walker'), 0);
    expect(calls).toContain('fillRect');
    expect(calls).not.toContain('drawImage');
  });

  it('renders a player class via the vector survivor fallback', () => {
    const calls: string[] = [];
    const p = { ...zombie('veteran'), id: 1, data: { moving: 0, walk: 0 } };
    drawEntity(stubCtx(calls), p, 0);
    expect(calls).toContain('fillRect');
  });
});

describe('drawDeath', () => {
  afterEach(() => __resetRasterForTest());

  it('draws the death frame from the sheet', () => {
    __setRasterForTest('walker', SHEET);
    const calls: string[] = [];
    drawDeath(stubCtx(calls), { kind: 'walker', x: 100, y: 100, facing: 0, t: 0.2 });
    expect(calls).toContain('drawImage');
  });

  it('falls back to the vector sprite without a sheet', () => {
    const calls: string[] = [];
    drawDeath(stubCtx(calls), { kind: 'walker', x: 100, y: 100, facing: 0, t: 0.2 });
    expect(calls).toContain('fillRect');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/ui/anim.test.ts
```

Expected: `drawDeath` 未导出，或位图路径未接。

- [ ] **Step 3: 改 anim.ts**

把顶部 import 改为：

```ts
import { drawShapes, drawSprite, frameShapes, spriteDrawSize, spriteFrameCount, SPRITES, vectorIdFor } from './sprites';
import { clipFrame, drawRasterFrame, pickClip, rasterFor } from './raster';
import type { Entity, WeaponDef } from '../core/types';
```

把 `atkPhase` 改为：

```ts
function atkPhase(e: Entity): number {
  const dur = e.data['atkDur'] ?? 0.3;
  return Math.min(1, (e.data['atkT'] ?? 0) / Math.max(0.01, dur));
}
```

把 `PoseOpts` 增加字段：

```ts
interface PoseOpts {
  walk: number;
  moving: boolean;
  atk: number;
  hit: number;
  time: number;
  id: number;
  atkDur: number;
}
```

把 `drawPosedSprite` 改为先映射矢量 id：

```ts
function drawPosedSprite(ctx: CanvasRenderingContext2D, id: string, size: number,
  p: PoseOpts): void {
  const vid = vectorIdFor(id);
  const sp = SPRITES[vid] ?? SPRITES['walker'];
  const k = size / sp.view;
  const frame = walkFrame(vid, p);
  const shapes = frameShapes(vid, frame);
  const bob = p.moving ? (frame % 2 === 0 ? 0 : -1) : 0;
  const recoil = p.hit > 0 ? -Math.round(p.hit * 2) : 0;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(k, k);
  ctx.translate(Math.round(recoil), Math.round(bob));
  drawShapes(ctx, shapes, sp.view);
  ctx.restore();
}
```

把 `drawEntity` 的主体替换为：

```ts
export function drawEntity(ctx: CanvasRenderingContext2D, e: Entity, time: number,
  player?: PlayerAnim): void {
  const id = e.kind;
  const atk = atkPhase(e);
  const lunge = atk > 0 ? Math.round(atk * 5) : 0;
  const moving = (e.data['moving'] ?? 0) > 0;
  const walk = e.data['walk'] ?? 0;
  const hover = id === 'drone' ? Math.round(4 + Math.sin(time * 3 + e.id) * 2.5) : 0;
  const hitT = e.data['hitT'] ?? 0;
  const hit = Math.min(1, hitT / 0.22);
  const size = spriteDrawSize(id);
  const atkT = e.data['atkT'] ?? 0;
  const atkDur = e.data['atkDur'] ?? 0.3;

  const sheet = rasterFor(id);
  if (sheet) {
    const clip = pickClip({ dead: e.dead, hitT, atkT, moving });
    const phase = clip === 'attack' ? 1 - atkT / Math.max(0.01, atkDur)
      : clip === 'walk' ? walk : 0;
    const frame = clipFrame(sheet, clip, phase);
    const bob = clip === 'idle' ? (Math.sin(time * 4 + e.id) > 0 ? -1 : 0) : 0;
    drawRasterFrame(ctx, sheet, frame,
      e.x + Math.cos(e.facing) * lunge, e.y - hover + bob,
      size, Math.cos(e.facing) < 0);
  } else {
    ctx.save();
    ctx.translate(Math.round(e.x + Math.cos(e.facing) * lunge), Math.round(e.y - hover));
    if (Math.cos(e.facing) < 0) ctx.scale(-1, 1);
    drawPosedSprite(ctx, id, size, { walk, moving, atk, hit, time, id: e.id, atkDur });
    ctx.restore();
  }

  drawStatuses(ctx, e, time, id);

  if (hitT > 0) {
    ctx.globalAlpha = hit * 0.45;
    ctx.fillStyle = '#ff5040';
    circle(ctx, e.x, e.y, Math.max(12, size * 0.38));
    ctx.globalAlpha = 1;
  }
  if (player) drawPlayerWeapon(ctx, e, player, time);
}
```

在 `drawEntity` 之后追加：

```ts
/** 死亡特效：独立于实体列表，绘制 0.8 秒后淡出。 */
export function drawDeath(ctx: CanvasRenderingContext2D,
  d: { kind: string; x: number; y: number; facing: number; t: number }): void {
  const alpha = Math.max(0, 1 - d.t / 0.8);
  if (alpha <= 0) return;
  const size = spriteDrawSize(d.kind);
  const sheet = rasterFor(d.kind);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (sheet) {
    const frame = sheet.clips.death[0] ?? 8;
    drawRasterFrame(ctx, sheet, frame, d.x, d.y, size, Math.cos(d.facing) < 0);
  } else {
    drawSprite(ctx, vectorIdFor(d.kind), d.x, d.y, 1, 0);
  }
  ctx.restore();
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run src/ui/anim.test.ts
```

Expected: 5 tests PASS。

- [ ] **Step 5: 提交**

```bash
git add src/ui/anim.ts src/ui/anim.test.ts
git commit -m "feat(ui): raster animation clips with vector fallback

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 10: 玩家身份、渲染与主循环

> **依赖：** 本任务 Step 3 的 `world.tickDeaths(dt)` 在 Task 11 才实现。按顺序执行时，先做 Task 11 Step 3 的 `combat.ts` 改动，或把 Task 10 与 Task 11 合并成一次提交。

**Files:**
- Modify: `src/main.ts`
- Modify: `src/ui/render.ts`
- Modify: `src/main.smoke.test.ts`
- Modify: `src/ui/render.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/main.smoke.test.ts` 的第一个测试里追加：

```ts
    expect(overlay.innerHTML).toContain('/assets/art/title.png');
```

在第二个测试的 `click(buttons, a => a['t'] === 'beginWave');` 之后追加：

```ts
    const player = worlds
      .map(w => w.entities.find(e => e.id === 1))
      .find(Boolean);
    expect(player?.kind).toBe('veteran');
```

在第二个测试的 `expect(overlay.innerHTML).toContain('选择角色');` 之后追加：

```ts
    expect(overlay.innerHTML).toContain('/assets/portraits/veteran.png');
```

在 `src/ui/render.test.ts` 的 `describe('renderFrame', ...)` 内追加：

```ts
  it('renders a class-kind player through the vector fallback', () => {
    const { c } = stubCtx();
    const run = createRunState(2, 'wizard', 'yard');
    const bus = new EventBus();
    const world = new World(run, bus);
    world.setRules(resolveLoadout(run).rules);
    world.entities.push({ id: 1, kind: 'wizard', x: 100, y: 100, radius: 12,
      hp: 100, maxHp: 100, speed: 100, facing: 0, tags: ['player'],
      statuses: [], dead: false, ttl: 0, data: {} });
    const arena = new Arena('yard');
    expect(() => renderFrame(c, { run, world, arena, stats: world.stats,
      mouse: { x: 100, y: 100 }, phase: 'combat', dt: 0.016,
      loadout: resolveLoadout(run) })).not.toThrow();
  });
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/main.smoke.test.ts src/ui/render.test.ts
```

Expected: 标题页没有背景图；玩家 `kind` 是 `'player'`；角色选择没有肖像。

- [ ] **Step 3: 改 main.ts**

顶部 import 增加：

```ts
import { preloadRasterSheets } from './ui/raster';
```

`ensurePlayer` 改为：

```ts
      p = { id: 1, kind: run.characterId, x: GAME_W / 2, y: GAME_H / 2, radius: 12,
```

在 `screens.title(save);` 之后增加：

```ts
void preloadRasterSheets();
```

在 `world.sweepDead();` 之后增加：

```ts
  world.tickDeaths(dt);
```

在四处僵尸/炮塔 `atkT` 赋值旁边补 `atkDur`：

```ts
      e.data['atkT'] = 0.3; // 前扑动作
      e.data['atkDur'] = 0.3;
```

```ts
      e.data['atkT'] = 0.45; // 鼓喉喷酸动作
      e.data['atkDur'] = 0.45;
```

```ts
      e.data['atkT'] = 0.6; // 举杖召唤动作
      e.data['atkDur'] = 0.6;
```

```ts
      e.data['atkT'] = 0.18; // 炮管后坐动作
      e.data['atkDur'] = 0.18;
```

在 `swing` 和 `shoot` 里补：

```ts
  p.data['atkT'] = heavy ? 0.32 : 0.18; // 挥砍动作时长
  p.data['atkDur'] = heavy ? 0.32 : 0.18;
```

```ts
  p.data['atkT'] = 0.12; // 开火/施法动作时长
  p.data['atkDur'] = 0.12;
```

- [ ] **Step 4: 改 render.ts**

顶部 import 改为：

```ts
import { drawDeath, drawEntity, type PlayerAnim } from './anim';
```

实体循环里把 id 与血条改为 `e.kind`：

```ts
    const id = e.kind;
    drawEntity(ctx, e, t, e.id === 1 ? playerAnim : undefined);
    if (e.hp < e.maxHp) {
      const barY = e.y - spriteDrawSize(id) / 2 - 5;
```

在实体循环结束后、`drawBullets` 之前增加：

```ts
  for (const d of world.deaths) drawDeath(ctx, d);
```

- [ ] **Step 5: 运行测试确认通过**

```bash
npx vitest run src/main.smoke.test.ts src/ui/render.test.ts
```

Expected: PASS。若 `world.tickDeaths` 尚不存在，先完成 Task 11 的 combat 改动再回跑；本任务与 Task 11 可在同一次提交中完成，提交信息用 `feat: raster player and death integration`。

- [ ] **Step 6: 提交**

```bash
git add src/main.ts src/ui/render.ts src/main.smoke.test.ts src/ui/render.test.ts
git commit -m "feat: player class identity, preload and raster rendering

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 11: 死亡特效列表

**Files:**
- Modify: `src/game/combat.ts`
- Modify: `src/game/combat.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/game/combat.test.ts` 的 `describe('dealDamage pipeline', ...)` 之后追加：

```ts
describe('death visuals', () => {
  it('records one death record per killed enemy and clears it after 0.8s', () => {
    const { w } = world();
    const e = mkEntity(9);
    w.entities.push(e);
    w.kill(e, false);
    expect(w.deaths).toHaveLength(1);
    expect(w.deaths[0]!.kind).toBe('walker');
    w.kill(e, false);
    expect(w.deaths).toHaveLength(1);
    w.tickDeaths(0.79);
    expect(w.deaths).toHaveLength(1);
    w.tickDeaths(0.02);
    expect(w.deaths).toHaveLength(0);
  });

  it('does not record player or deployable deaths', () => {
    const { w } = world();
    const p = mkEntity(1, 'veteran');
    const d = mkEntity(10, 'turret');
    d.tags.push('deployable');
    w.entities.push(p, d);
    w.kill(p, false);
    w.kill(d, false);
    expect(w.deaths).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/game/combat.test.ts
```

Expected: `w.deaths` 为 undefined。

- [ ] **Step 3: 改 combat.ts**

在 `World` 的 `floating` 下方增加：

```ts
  /** 纯视觉的倒地记录：实体本体仍由 sweepDead 立即移除。 */
  deaths: { kind: string; x: number; y: number; facing: number; t: number }[] = [];
```

在 `kill()` 的 `e.dead = true;` 之后增加：

```ts
    if (e.id !== 1 && !e.tags.includes('deployable')) {
      this.deaths.push({ kind: e.kind, x: e.x, y: e.y, facing: e.facing, t: 0 });
    }
```

在 `sweepDead` 之后增加：

```ts
  tickDeaths(dt: number): void {
    for (const d of this.deaths) d.t += dt;
    this.deaths = this.deaths.filter(d => d.t < 0.8);
  }
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run src/game/combat.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/game/combat.ts src/game/combat.test.ts
git commit -m "feat(game): visual death records for raster death frames

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 12: UI 肖像、图标与标题背景

**Files:**
- Create: `src/ui/icons.ts`
- Create: `src/ui/icons.test.ts`
- Modify: `src/ui/screens.ts`
- Modify: `index.html`

- [ ] **Step 1: 写失败测试**

创建 `src/ui/icons.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { iconFor } from './icons';

describe('iconFor', () => {
  it('returns static icon paths for passives and consumables', () => {
    expect(iconFor('consumable', 'medkit')).toBe('/assets/icons/medkit.png');
    expect(iconFor('passive', 'armor')).toBe('/assets/icons/armor.png');
  });

  it('returns an empty string for weapon icons without a DOM', () => {
    expect(iconFor('weapon', 'pistol')).toBe('');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/ui/icons.test.ts
```

Expected: `./icons` 不存在。

- [ ] **Step 3: 写 icons.ts**

创建 `src/ui/icons.ts`：

```ts
import { drawShapes, frameShapes, SPRITES } from './sprites';

const cache = new Map<string, string>();

/** 商店图标：消耗品/被动用后处理好的 PNG；武器用现有矢量帧离屏渲染。 */
export function iconFor(kind: 'weapon' | 'passive' | 'consumable', id: string): string {
  if (kind !== 'weapon') return `/assets/icons/${id}.png`;
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return '';
  const sp = SPRITES[id];
  if (!sp) return '';
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingEnabled = false;
  // 矢量帧坐标以 view 为边长、中心为原点；缩放到 40px 内容并居中
  const k = 40 / sp.view;
  ctx.translate(24, 24);
  ctx.scale(k, k);
  drawShapes(ctx, frameShapes(id, 0), sp.view);
  const url = canvas.toDataURL();
  cache.set(id, url);
  return url;
}
```

- [ ] **Step 4: 改 screens.ts**

把 `html` 方法改为：

```ts
  private html(inner: string, bg?: string): void {
    const background = bg
      ? `background:linear-gradient(#0d0f14cc,#0d0f14ee),url('${bg}') center/cover;`
      : 'background:#0d0f14ee;';
    this.root.innerHTML = `<div style="position:absolute;inset:0;${background}overflow:auto;padding:24px 32px">${inner}</div>`;
    this.root.querySelectorAll<HTMLElement>('[data-act]').forEach(el => {
      el.onclick = () => this.cb.onAction(JSON.parse(el.dataset.act!) as ScreenAction);
    });
  }
```

在 `btn` 之后增加：

```ts
  private btnRaw(act: ScreenAction, inner: string, disabled = false): string {
    return `<button data-act='${esc(JSON.stringify(act))}' ${disabled ? 'disabled' : ''}
      style="background:#2b3a55;color:#e8e6df;border:1px solid #4a6080;padding:6px 12px;margin:3px;cursor:pointer;font:inherit">${inner}</button>`;
  }

  private iconImg(kind: 'weapon' | 'passive' | 'consumable', id: string): string {
    const src = iconFor(kind, id);
    if (!src) return '';
    return `<img src="${src}" width="32" height="32" draggable="false"
      onerror="this.style.display='none'" style="image-rendering:pixelated;vertical-align:middle;margin-right:6px">`;
  }
```

顶部 import 增加：

```ts
import { iconFor } from './icons';
```

`title()` 的 `this.html(...)` 改为：

```ts
    this.html(`<h1 style="color:#ffe066">僵尸竞技场</h1>
      <p>最高波次 ${save.bestWave} · 点数 ${save.points} · 总击杀 ${save.totalKills}</p>
      ${this.btn({ t: 'continue' }, '开始新的一局')}
      <h3>局外解锁</h3>
      ${UNLOCKS.map(u => `${esc(u.name)} (${u.cost} 点) ${this.btn({ t: 'unlock', id: u.id },
        save.unlockedCharacters.includes(u.id) || save.unlockedMaps.includes(u.id)
          || save.unlockedWeapons.includes(u.id) ? '已解锁' : '解锁',
        save.points < u.cost || save.unlockedCharacters.includes(u.id)
          || save.unlockedMaps.includes(u.id) || save.unlockedWeapons.includes(u.id))}`).join('<br>')}`,
      '/assets/art/title.png');
```

`characterSelect` 的角色按钮改为：

```ts
      ${CHARACTERS.map(c => this.btnRaw({ t: 'start', characterId: c.id, mapId },
        `<img src="/assets/portraits/${c.id}.png" width="64" height="64" draggable="false"
          onerror="this.style.display='none'"
          style="image-rendering:pixelated;vertical-align:middle;margin-right:8px">
         ${esc(c.name)} — ${esc(c.desc)}`,
        !save.unlockedCharacters.includes(c.id))).join('<br>')}
```

`shop()` 的物品行改为：

```ts
      return `<div style="border:1px solid #33405a;padding:8px;margin:6px 0;max-width:620px">
        ${this.iconImg(it.kind, it.id)}
        <b>${esc(name ?? it.id)}</b>${esc(school)} — ${priceOf(run, it)} 金 ${it.locked ? '🔒' : ''}
        ${this.btn({ t: 'buy', index: i }, '购买')}
        ${this.btn({ t: 'lock', index: i }, it.locked ? '解锁' : '锁定')}</div>`;
```

被动列表改为：

```ts
      <h3>被动 (${run.passives.length}/3)</h3>${run.passives.map(p =>
        `${this.iconImg('passive', p)}${esc(PASSIVE_BY_ID[p]?.name ?? p)}`).join(' / ') || '—'}
```

消耗品列表改为：

```ts
      <h3>消耗品</h3>${Object.entries(run.consumables).map(([k, v]) =>
        `${this.iconImg('consumable', k)}${esc(CONSUMABLE_BY_ID[k]?.name ?? k)} x${v}`).join(' / ') || '—'}
```

- [ ] **Step 5: 改 index.html CSS**

在 `canvas { ... }` 下增加：

```css
    #overlay img { image-rendering: pixelated; user-select: none; }
```

- [ ] **Step 6: 运行测试确认通过**

```bash
npx vitest run src/ui/icons.test.ts src/main.smoke.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/ui/icons.ts src/ui/icons.test.ts src/ui/screens.ts index.html
git commit -m "feat(ui): portraits, shop icons and title background

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 13: 对照图脚本与全量测试

**Files:**
- Create: `scripts/art/contact_sheet.py`

- [ ] **Step 1: 写脚本**

创建 `scripts/art/contact_sheet.py`：

```python
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
```

- [ ] **Step 2: 跑全量测试**

```bash
npm test
```

Expected: 全部通过，新增测试文件计入总数。

- [ ] **Step 3: 跑构建**

```bash
npm run build
```

Expected: `tsc --noEmit` 与 `vite build` 成功。

- [ ] **Step 4: 提交**

```bash
git add scripts/art/contact_sheet.py
git commit -m "feat(art): contact sheet for visual review

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 14: walker 端到端质量闸门

**Files:**
- Generated: `.art-cache/raw/walker/{walk,act,hurt}.png`
- Generated: `public/assets/characters/walker.png`
- Generated: `public/assets/portraits/walker.png`
- Generated: `public/assets/icons/*.png`（8 张）
- Generated: `public/assets/art/title.png`

- [ ] **Step 1: 确认 Colab 会话与模型**

```bash
colab status -s h3
colab ssh -s h3 -- python3 - <<'PY'
import urllib.request
key=open('/content/studio_api_key.txt').read().strip()
req=urllib.request.Request('http://127.0.0.1:8888/api/inference/images/status',
                           headers={'Authorization':'Bearer '+key})
import json
print(json.load(urllib.request.urlopen(req))['loaded'])
PY
```

Expected: 会话 `IDLE` 或 `RUNNING`，最后一行 `True`。若为 `False`，先跑
`colab ssh -s h3 -- python3 /content/colab_generate.py "warmup" 512x512` 触发加载。

- [ ] **Step 2: 只生成 walker（含 extras）**

```bash
python3 scripts/colab_gen_art.py --only walker
```

Expected:

- 轮询日志出现 `walker/walk`、`walker/act`、`walker/hurt`、`extras/title`、`extras/icons`
- 下载并解压到 `.art-cache/raw/`
- `OK walker`
- `OK icons` / `OK title`
- `validate.py` 全部 `OK`

预计 2–3 分钟（两张 reference 各约 28 秒）。

- [ ] **Step 3: 生成对照图并检查**

```bash
python3 scripts/art/contact_sheet.py --only walker --scale 8 --out /tmp/walker-contact.png
```

Expected: `saved /tmp/walker-contact.png (384, 64)`。

用图片查看器或 Read 工具打开 `/tmp/walker-contact.png`，逐帧确认：

1. 9 帧都不为空、没有断肢/多角色
2. 行走 0–3 有可辨认的腿部交替
3. 攻击 4–6 有蓄力/前扑/收势
4. 受击 7 后仰，死亡 8 倒地
5. 角色始终朝右，脚底基本在同一条水平线
6. 白底已去除，外圈有暗描边

- [ ] **Step 4: 游戏内实跑**

```bash
npm run dev
```

浏览器打开 Vite 输出的地址，开始一局，确认：

- 普通僵尸显示 H3 位图且会走
- 攻击时有前扑帧，受击有后仰，死亡有倒地淡出
- 标题页出现背景图，角色选择出现 portrait，商店出现图标

- [ ] **Step 5: 质量闸门判定**

若第 3/4 步有明显问题（比例失控、动作不可读、白边、角色漂移），**停止**，不要批量生成。把问题帧和提示词记下来，调整 manifest 的 `subject` / `act` 或后处理参数后重跑 `--only walker --force`。只有观感通过才继续 Task 15。

- [ ] **Step 6: 提交 walker 与 extras 产物**

```bash
git add public/assets/characters/walker.png public/assets/portraits/walker.png
git add public/assets/icons public/assets/art/title.png
git commit -m "art: add walker raster sheet and UI assets

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 15: 批量生成其余 13 个角色

**Files:**
- Generated: `public/assets/characters/<id>.png`（13 张）
- Generated: `public/assets/portraits/<id>.png`（13 张）
- Modified: `src/ui/rasterMeta.generated.ts`（脚本重写，内容应与初始一致）

- [ ] **Step 1: 批量生成**

```bash
python3 scripts/colab_gen_art.py
```

Expected: 轮询 44 个任务（14×3 + 2 extras，walker/extras 已存在会跳过），约 15–20 分钟。失败项会打印在 `失败项:`。

- [ ] **Step 2: 检查失败项并重试**

若输出里有失败角色：

```bash
python3 scripts/colab_gen_art.py --only <失败id> --force
```

Expected: 只重跑该角色的三张表；成功后重新后处理并校验。

- [ ] **Step 3: 校验全部产物**

```bash
python3 scripts/art/validate.py --extras
```

Expected: 14 张角色表、14 张肖像、8 张图标、1 张标题全部 `OK`，退出码 0。

- [ ] **Step 4: 生成全量对照图**

```bash
python3 scripts/art/contact_sheet.py --scale 4 --out /tmp/all-contact.png
```

Expected: `saved /tmp/all-contact.png (1728, 2688)`，`rows:` 打印 14 个 id。

逐行检查：每行对应 `rows:` 的顺序，确认没有空行、错角色、断肢、明显比例漂移。

- [ ] **Step 5: 跑测试与构建**

```bash
npm test
npm run build
```

Expected: 全绿。

- [ ] **Step 6: 提交批量产物**

```bash
git add public/assets/characters public/assets/portraits public/assets/icons public/assets/art/title.png
git add src/ui/rasterMeta.generated.ts
git commit -m "art: add raster sprite sheets for all characters

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 16: 回退演练与最终验收

**Files:**
- No code changes unless a defect is found.

- [ ] **Step 1: 位图缺失回退演练**

临时把一张表移走：

```bash
mv public/assets/characters/fatty.png /tmp/fatty.png
npm run dev
```

Expected: 胖子仍以矢量精灵出现，控制台没有未捕获异常。确认后移回：

```bash
mv /tmp/fatty.png public/assets/characters/fatty.png
```

- [ ] **Step 2: 五个职业逐一实机确认**

浏览器依次选择 `老兵 / 巫师 / 工程师 / 浪人 / 狱卒` 各开一局，确认：

- 角色选择肖像与进入游戏后的身体一致
- 行走、攻击、受击动作可读
- 手持武器仍跟随朝向旋转，挥砍弧/枪口火光正常
- 商店武器图标、被动/消耗品图标可见

- [ ] **Step 3: 敌人全覆盖确认**

打至少 5 波，确认普通/奔跑者/胖子/持盾/吐酸/召唤者/装甲都出现且动作正常；用「提前降临」诅咒或打到 Boss 波，确认屠夫/尸潮之母。

- [ ] **Step 4: 最终测试**

```bash
npm test
npm run build
git status --short
```

Expected: 测试与构建通过；`git status` 不包含 `.art-cache/`、`/tmp` 文件或原始 1024 图。

- [ ] **Step 5: 更新记忆（可选但推荐）**

把本次结论追加到 `~/.claude/projects/-home-jichi-zombie-arena/memory/zombie-arena-colab-imagegen.md`：

- H3 `reference` 工作流可锁角色生成动作帧
- 每角色 3 张 2×2 表 → 9 帧 48px 的管线
- 生成入口 `python3 scripts/colab_gen_art.py`

---

## Self-Review Notes

- **Spec coverage:** 14 角色、三张表、9 帧映射、后处理、运行时、玩家 kind、死亡 FX、UI、测试、质量闸门、回退、运行手册均有对应任务。
- **调色板：** spec 第 29/253/299 行写作「37 色」，但 `scripts/spritegen/postprocess.py` 的实际列表是 41 色。本计划沿用现有 41 色，避免项目里出现两套调色板；`PALETTE_HEX` 与现有脚本逐字一致。
- **类型一致性:** `RASTER_META` / `RasterMeta` / `LoadedSheet` / `ClipId` 在 Task 7 定义，后续任务只引用这些名字；`deaths` 在 Task 11 定义，Task 10/12 使用；`iconFor(kind, id)` 在 Task 12 定义并使用。
- **顺序依赖:** Task 10 的 `world.tickDeaths` 依赖 Task 11；若按顺序执行，Task 10 Step 5 可能出现 `tickDeaths` 不存在。执行者可以先做 Task 11 的 combat 改动，或把 Task 10 与 Task 11 合并为一次提交（已在 Task 10 Step 5 注明）。
- **无占位符:** 所有代码步骤均给出完整文件或完整替换片段；操作步骤给出具体命令与预期输出。
