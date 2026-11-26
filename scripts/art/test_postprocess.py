import io
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image, ImageDraw

import postprocess as pp
import validate as vv


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


def nearest_palette_rgb(rgb: tuple[int, int, int]) -> tuple[int, int, int]:
    """把任意 RGB 映射到调色板里最近的颜色。"""
    diff = ((pp.PALETTE - np.array(rgb, dtype=np.int32)) ** 2).sum(axis=1)
    return tuple(int(v) for v in pp.PALETTE[int(diff.argmin())])


def count_body_pixels(frame: np.ndarray, rgb: tuple[int, int, int]) -> int:
    """统计单帧中与给定身体色完全匹配的不透明像素数。"""
    target = np.array(rgb, dtype=np.uint8)
    return int((((frame[:, :, :3] == target).all(axis=2))
                & (frame[:, :, 3] > 0)).sum())


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
            colors = {
                "walk": (120, 180, 90),
                "act": (200, 80, 60),
                "hurt": (60, 100, 200),
            }
            raw = root / "raw" / "walker"
            raw.mkdir(parents=True)
            for name, color in colors.items():
                make_cell_sheet(raw / f"{name}.png", color=color)
            chars = root / "characters"
            portraits = root / "portraits"
            meta = pp.process_character(raw.parent, "walker", chars, portraits)

            with Image.open(chars / "walker.png") as im:
                self.assertEqual(im.size, (432, 48))
                arr = np.array(im.convert("RGBA"))
            for i in range(9):
                alpha = arr[:, i * 48:(i + 1) * 48, 3]
                self.assertGreater((alpha > 0).mean(), 0.03)

            walk_rgb = nearest_palette_rgb(colors["walk"])
            act_rgb = nearest_palette_rgb(colors["act"])
            hurt_rgb = nearest_palette_rgb(colors["hurt"])
            expected = (
                (range(0, 4), walk_rgb, (act_rgb, hurt_rgb)),
                (range(4, 7), act_rgb, (walk_rgb, hurt_rgb)),
                (range(7, 9), hurt_rgb, (walk_rgb, act_rgb)),
            )
            for frames, body, others in expected:
                for i in frames:
                    frame = arr[:, i * 48:(i + 1) * 48, :]
                    self.assertGreater(
                        count_body_pixels(frame, body), 100,
                        f"frame {i} missing body color {body}")
                    for other in others:
                        self.assertEqual(
                            count_body_pixels(frame, other), 0,
                            f"frame {i} leaked color {other}")

            self.assertEqual(meta["id"], "walker")
            self.assertEqual(meta["frames"], 9)
            self.assertEqual(meta["clips"]["walk"], [0, 1, 2, 3])
            self.assertEqual(meta["walkFps"], 8)

            with Image.open(portraits / "walker.png") as im:
                self.assertEqual(im.size, (160, 160))

            raw2 = root / "raw" / "fatty"
            raw2.mkdir(parents=True)
            for name, color in colors.items():
                make_cell_sheet(raw2 / f"{name}.png", color=color)
            meta2 = pp.process_character(raw2.parent, "fatty", chars, portraits)
            self.assertEqual(meta2["walkFps"], 6)

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
                with Image.open(out / f"{cid}.png") as im:
                    self.assertEqual(im.size, (48, 48))

    def test_process_title_crops_and_resizes_to_1536_by_1024(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            raw = root / "title.png"
            Image.new("RGB", (1600, 1000), (20, 24, 32)).save(raw)
            out = root / "art" / "title.png"
            pp.process_title(raw, out)
            with Image.open(out) as im:
                self.assertEqual(im.size, (1536, 1024))


class MainTests(unittest.TestCase):
    @staticmethod
    def stub_character(raw_dir: Path, cid: str, chars_dir: Path, portraits_dir: Path) -> dict:
        return {
            "id": cid,
            "src": f"/assets/characters/{cid}.png",
            "view": 48,
            "frames": 9,
            "walkFps": 8,
            "clips": {"idle": [0]},
        }

    def test_main_full_success_writes_14_entry_metadata(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            meta = root / "rasterMeta.generated.ts"
            with mock.patch.object(pp, "process_character", side_effect=self.stub_character):
                rc = pp.main([
                    "--raw", str(root / "raw"),
                    "--out", str(root / "assets"),
                    "--meta", str(meta),
                ])
            self.assertEqual(rc, 0)
            self.assertTrue(meta.exists())
            self.assertEqual(meta.read_text().count("/assets/characters/"), 14)

    def test_main_character_failure_skips_metadata(self):
        def stub(raw_dir, cid, chars_dir, portraits_dir):
            if cid == "mother":
                raise RuntimeError("boom")
            return MainTests.stub_character(raw_dir, cid, chars_dir, portraits_dir)

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            meta = root / "rasterMeta.generated.ts"
            with mock.patch.object(pp, "process_character", side_effect=stub):
                rc = pp.main([
                    "--raw", str(root / "raw"),
                    "--out", str(root / "assets"),
                    "--meta", str(meta),
                ])
            self.assertEqual(rc, 1)
            self.assertFalse(meta.exists())

    def test_main_only_never_writes_metadata(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            meta = root / "rasterMeta.generated.ts"
            with mock.patch.object(pp, "process_character", side_effect=self.stub_character):
                rc = pp.main([
                    "--only", "walker",
                    "--raw", str(root / "raw"),
                    "--out", str(root / "assets"),
                    "--meta", str(meta),
                ])
            self.assertEqual(rc, 0)
            self.assertFalse(meta.exists())

    def test_main_extras_isolated_failures(self):
        title = mock.Mock()
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            meta = root / "rasterMeta.generated.ts"
            with mock.patch.object(pp, "process_character", side_effect=self.stub_character), \
                    mock.patch.object(pp, "process_icons", side_effect=RuntimeError("bad icons")), \
                    mock.patch.object(pp, "process_title", title):
                rc = pp.main([
                    "--only", "walker", "--extras",
                    "--raw", str(root / "raw"),
                    "--out", str(root / "assets"),
                    "--meta", str(meta),
                ])
            self.assertEqual(rc, 1)
            title.assert_called_once()


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
            with self.assertRaisesRegex(ValueError, r"expected 432x48"):
                vv.validate_sheet(path)

    def test_validate_sheet_rejects_non_palette_pixel(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "bad.png"
            img = Image.new("RGBA", (pp.VIEW * pp.FRAMES, pp.VIEW), (0, 0, 0, 0))
            body = tuple(int(v) for v in pp.PALETTE[0]) + (255,)
            ImageDraw.Draw(img).rectangle(
                [0, 0, pp.VIEW * pp.FRAMES - 1, 19], fill=body)
            img.putpixel((5, 5), (1, 2, 3, 255))
            img.save(path)
            with self.assertRaisesRegex(ValueError, r"non-palette"):
                vv.validate_sheet(path)

    def test_main_returns_nonzero_when_asset_missing(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                rc = vv.main(["--assets", str(root), "--only", "walker"])
            self.assertEqual(rc, 1)

    def test_main_only_scopes_validation(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            raw = root / "raw" / "walker"
            raw.mkdir(parents=True)
            for name in ("walk", "act", "hurt"):
                make_cell_sheet(raw / f"{name}.png")
            pp.process_character(raw.parent, "walker", root / "characters", root / "portraits")
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                rc = vv.main(["--assets", str(root), "--only", "walker"])
            self.assertEqual(rc, 0)


if __name__ == "__main__":
    unittest.main()
