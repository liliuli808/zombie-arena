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
        "no shadow, no dividing lines, no text, no labels, "
        "2 by 2 grid of four frames."
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
