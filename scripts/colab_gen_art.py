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
        LOCAL_CACHE.mkdir(parents=True, exist_ok=True)
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
                try:
                    status = json.loads(raw_status)
                except json.JSONDecodeError:
                    # 旧版生成器可能留下被截断的 status.json，继续轮询即可。
                    print("status.json 解析失败，继续轮询:", raw_status.strip(),
                          file=sys.stderr)
                    time.sleep(20)
                    continue
                if not isinstance(status, dict):
                    print("status.json 结构异常，继续轮询:", raw_status.strip(),
                          file=sys.stderr)
                    time.sleep(20)
                    continue
                print(f"[{status.get('index', 0) + 1}/{status.get('total', '?')}] "
                      f"{status.get('current')} done={len(status.get('done', []))} "
                      f"failed={len(status.get('failed', []))}", flush=True)
                if status.get("finished"):
                    if status.get("failed"):
                        print("失败项:", status["failed"], file=sys.stderr)
                        for err in status.get("errors") or []:
                            print("ERROR", err, file=sys.stderr)
                        print(f"生成失败，未下载产物；查看 {REMOTE}/gen.log",
                              file=sys.stderr)
                        return 1
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
