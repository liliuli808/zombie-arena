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


if __name__ == "__main__":
    unittest.main()
