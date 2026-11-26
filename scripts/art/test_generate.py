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

    def test_seed_init_wiring_and_unique_jobs(self):
        jobs = gr.plan_jobs(self.m, existing=set(), only={"walker"})
        chars = [j for j in jobs if j["kind"] == "character"]
        by_sheet = {j["sheet"]: j for j in chars}
        base = next(c["seed"] for c in self.m["characters"] if c["id"] == "walker")
        self.assertEqual(by_sheet["walk"]["seed"], base)
        self.assertEqual(by_sheet["act"]["seed"], base + 100)
        self.assertEqual(by_sheet["hurt"]["seed"], base + 200)
        self.assertIsNone(by_sheet["walk"]["init"])
        self.assertEqual(by_sheet["act"]["init"], "walker/walk.png")
        self.assertEqual(by_sheet["hurt"]["init"], "walker/walk.png")
        all_jobs = gr.plan_jobs(self.m, existing=set())
        seeds = [j["seed"] for j in all_jobs]
        self.assertEqual(len(seeds), 44)
        # 种子可以复用（runner/spitter 为过覆盖率校验重掷）。hurt 提示词对所有角色相同，
        # 角色身份由 init 图决定，因此唯一性键是 (seed, prompt, init)——它能抓住整条任务被复制粘贴。
        keys = [(j["seed"], j["prompt"], j["init"]) for j in all_jobs]
        self.assertEqual(len(keys), len(set(keys)))

    def test_force_replans_everything(self):
        existing = {f"{c['id']}/{sheet}.png"
                    for c in self.m["characters"] for sheet in ("walk", "act", "hurt")}
        existing.update({"extras/title.png", "extras/icons.png"})
        self.assertEqual(gr.plan_jobs(self.m, existing=existing), [])
        self.assertEqual(len(gr.plan_jobs(self.m, existing=existing, force=True)), 44)

    def test_extras_skip_when_existing(self):
        existing = {"walker/walk.png", "walker/act.png", "walker/hurt.png",
                    "extras/title.png", "extras/icons.png"}
        self.assertEqual(gr.plan_jobs(self.m, existing=existing, only={"walker"}), [])


if __name__ == "__main__":
    unittest.main()
