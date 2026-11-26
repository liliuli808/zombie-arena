#!/usr/bin/env python3
"""本地入口：上传 manifest/脚本到 Colab，后台生成，轮询，下载，后处理。

用法:
    python3 scripts/colab_gen_art.py --only walker
    python3 scripts/colab_gen_art.py
    python3 scripts/colab_gen_art.py --skip-generate

所有本地路径都以仓库根为锚点，因此可在任意工作目录下运行。
"""
from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

SESSION = "h3"
REMOTE = "/content/art"

REPO = Path(__file__).resolve().parents[1]
LOCAL_CACHE = REPO / ".art-cache"
RAW = LOCAL_CACHE / "raw"
MANIFEST = REPO / "scripts/art/manifest.json"
REMOTE_SCRIPT = REPO / "scripts/art/generate_remote.py"
POSTPROCESS = REPO / "scripts/art/postprocess.py"
VALIDATE = REPO / "scripts/art/validate.py"

POLL_INTERVAL = 20
DEADLINE_SECONDS = 45 * 60
SSH_TIMEOUT = 120
SHEETS = ("walk", "act", "hurt")

PYTHON = sys.executable or "python3"


def run(cmd: list[str], cwd: Path = REPO) -> None:
    print("+", shlex.join(cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=cwd)


def ssh(script: str) -> str:
    """执行远端 shell 脚本；超时或非零退出时抛出 SystemExit。"""
    try:
        proc = subprocess.run(
            ["colab", "ssh", "-s", SESSION, "--", "bash", "-lc", script],
            capture_output=True, text=True, timeout=SSH_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        print(f"colab ssh 超时（{SSH_TIMEOUT}s）", file=sys.stderr)
        raise SystemExit(1)
    except FileNotFoundError:
        print("找不到 colab 命令", file=sys.stderr)
        raise SystemExit(1)
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        raise SystemExit(proc.returncode)
    return proc.stdout


def poll_ssh(script: str) -> str:
    """轮询专用：连续失败最多重试 3 次，避免短暂的 ssh 故障丢掉计费中的任务。"""
    last: SystemExit | None = None
    for attempt in range(4):  # 1 次首试 + 3 次重试
        try:
            return ssh(script)
        except SystemExit as exc:
            last = exc
            if attempt < 3:
                print(f"轮询失败，{attempt + 1}/3 重试", file=sys.stderr)
                time.sleep(5)
    raise last if last is not None else SystemExit(1)


def kill_remote(pid: int) -> None:
    try:
        ssh(f"kill {pid} 2>/dev/null || true")
    except SystemExit:
        pass


def parse_status(raw: str) -> dict | None:
    if not raw.strip():
        return None
    try:
        status = json.loads(raw)
    except json.JSONDecodeError:
        # 旧版生成器可能留下被截断的 status.json，继续轮询即可。
        print("status.json 解析失败，继续轮询:", raw.strip(), file=sys.stderr)
        return None
    if not isinstance(status, dict):
        print("status.json 结构异常，继续轮询:", raw.strip(), file=sys.stderr)
        return None
    return status


def read_status() -> dict | None:
    return parse_status(poll_ssh(f"cat {REMOTE}/status.json 2>/dev/null || true"))


def print_progress(status: dict) -> None:
    index = (status.get("index") or 0) + 1
    total = status.get("total")
    total = "?" if total is None else total
    done = len(status.get("done") or [])
    failed = len(status.get("failed") or [])
    print(f"[{index}/{total}] {status.get('current')} "
          f"done={done} failed={failed}", flush=True)


def dump_gen_log() -> None:
    tail = poll_ssh(f"tail -n 40 {REMOTE}/gen.log 2>/dev/null || true")
    if tail.strip():
        print(tail.rstrip(), file=sys.stderr)
    print("远端生成进程已退出，但未写出完成状态", file=sys.stderr)


def wait_for_status(pid: int) -> dict:
    """轮询到 finished；超时抛 TimeoutError，进程消失抛 SystemExit。"""
    deadline = time.time() + DEADLINE_SECONDS
    while True:
        status = read_status()
        if status is not None:
            print_progress(status)
            if status.get("finished"):
                return status

        alive = (poll_ssh(
            f"kill -0 {pid} 2>/dev/null && echo alive || echo dead"
        ).strip().splitlines() or [""])[-1].strip()
        if alive == "dead":
            # 再读一次，避免“刚写完状态就退出”的竞态。
            status = read_status()
            if status is not None and status.get("finished"):
                print_progress(status)
                return status
            dump_gen_log()
            raise SystemExit(1)

        if time.time() >= deadline:
            # 到点先做最后一次读取，刚好完成的任务仍然接受。
            status = read_status()
            if status is not None and status.get("finished"):
                print_progress(status)
                return status
            raise TimeoutError

        time.sleep(POLL_INTERVAL)


def finished_error(status: dict, only: list[str]) -> int:
    failed = status.get("failed") or []
    if failed:
        print("失败项:", failed, file=sys.stderr)
        for err in status.get("errors") or []:
            print("ERROR", err, file=sys.stderr)
        print(f"生成失败，未下载产物；查看 {REMOTE}/gen.log", file=sys.stderr)
        return 1
    if only and (status.get("total") or 0) == 0:
        print("没有计划任何任务（可能已存在），可加 --force 重新生成",
              file=sys.stderr)
        return 1
    return 0


def verify_raw(raw_dir: Path, only: list[str]) -> None:
    if not only:
        return
    missing = [
        str(raw_dir / cid / f"{sheet}.png")
        for cid in only
        for sheet in SHEETS
        if not (raw_dir / cid / f"{sheet}.png").is_file()
    ]
    if missing:
        raise ValueError("缺少原始图: " + ", ".join(missing))


def download_and_extract(only: list[str]) -> None:
    """下载 zip，校验后原子替换本地 raw 目录；失败时保留旧 raw。"""
    zip_tmp = LOCAL_CACHE / "raw.zip.tmp"
    zip_final = LOCAL_CACHE / "raw.zip"
    tmp_dir = LOCAL_CACHE / "raw.tmp"
    old_dir = LOCAL_CACHE / "raw.old"
    download = ["colab", "download", "-s", SESSION,
                f"{REMOTE}/raw.zip", str(zip_tmp)]

    zip_tmp.unlink(missing_ok=True)
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)

    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            run(download)
            last_exc = None
            break
        except (subprocess.CalledProcessError, OSError) as exc:
            last_exc = exc
            if attempt < 2:
                delay = 5 * (attempt + 1)
                print(f"下载失败，{delay}s 后重试（{attempt + 1}/3）",
                      file=sys.stderr)
                time.sleep(delay)
    if last_exc is not None:
        print("下载 raw.zip 失败", file=sys.stderr)
        raise SystemExit(1)

    try:
        with zipfile.ZipFile(zip_tmp) as zf:
            bad = zf.testzip()
            if bad is not None:
                raise ValueError(f"zip 校验失败: {bad}")
            root = tmp_dir.resolve()
            for member in zf.infolist():
                target = (tmp_dir / member.filename).resolve()
                if target != root and root not in target.parents:
                    raise ValueError(f"zip 包含不安全路径: {member.filename}")
            zf.extractall(tmp_dir)
        verify_raw(tmp_dir, only)

        if old_dir.exists():
            shutil.rmtree(old_dir)
        had_old = RAW.exists()
        if had_old:
            RAW.rename(old_dir)
        try:
            tmp_dir.rename(RAW)
        except Exception:
            if had_old and not RAW.exists():
                old_dir.rename(RAW)
            raise
        if old_dir.exists():
            shutil.rmtree(old_dir)
        os.replace(zip_tmp, zip_final)
    except Exception as exc:  # noqa: BLE001 - 任何失败都保留旧缓存
        print(f"本地缓存替换失败: {exc}", file=sys.stderr)
        shutil.rmtree(tmp_dir, ignore_errors=True)
        zip_tmp.unlink(missing_ok=True)
        raise SystemExit(1)


def character_ids() -> set[str]:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    return {c["id"] for c in data.get("characters", [])}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="+", default=None)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--skip-generate", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    only = args.only or []

    if only:
        try:
            known = character_ids()
        except (OSError, json.JSONDecodeError) as exc:
            print(f"无法读取 manifest {MANIFEST}: {exc}", file=sys.stderr)
            return 1
        unknown = sorted(set(only) - known)
        if unknown:
            print(f"未知角色 id: {', '.join(unknown)}（见 {MANIFEST}）",
                  file=sys.stderr)
            return 2

    remote_args = ["python3", "generate_remote.py",
                   "--manifest", f"{REMOTE}/manifest.json",
                   "--out", f"{REMOTE}/raw"]
    if only:
        remote_args += ["--only", *only]
    if args.force:
        remote_args.append("--force")
    start = (f"mkdir -p {REMOTE}/raw && cd {REMOTE} && "
             f"{{ nohup {shlex.join(remote_args)} > gen.log 2>&1 & echo $!; }}")

    upload_manifest = ["colab", "upload", "-s", SESSION,
                       str(MANIFEST), f"{REMOTE}/manifest.json"]
    upload_script = ["colab", "upload", "-s", SESSION,
                     str(REMOTE_SCRIPT), f"{REMOTE}/generate_remote.py"]
    ssh_argv = ["colab", "ssh", "-s", SESSION, "--", "bash", "-lc", start]
    download = ["colab", "download", "-s", SESSION,
                f"{REMOTE}/raw.zip", str(LOCAL_CACHE / "raw.zip.tmp")]

    post = [PYTHON, str(POSTPROCESS), "--extras"]
    val = [PYTHON, str(VALIDATE), "--extras"]
    if only:
        post += ["--only", *only]
        val += ["--only", *only]

    if args.dry_run:
        if not args.skip_generate:
            print("+", shlex.join(upload_manifest))
            print("+", shlex.join(upload_script))
            print("+", shlex.join(ssh_argv))
            print(f"+ poll: cat {REMOTE}/status.json every {POLL_INTERVAL}s")
            print("+", shlex.join(download))
        print("+", shlex.join(post))
        print("+", shlex.join(val))
        return 0

    if args.skip_generate:
        if not RAW.is_dir():
            print(f"--skip-generate 需要已有的原始图目录: {RAW}",
                  file=sys.stderr)
            return 1
    else:
        LOCAL_CACHE.mkdir(parents=True, exist_ok=True)
        ssh(f"mkdir -p {REMOTE}")
        # 旧进程仍在跑时直接中止，别把它的状态当成这次的结果。
        if poll_ssh("pgrep -f '[g]enerate_remote[.]py' || true").strip():
            print("已有生成进程在运行，先等待或结束它", file=sys.stderr)
            return 1
        # 清掉上一轮的终态与压缩包，避免首次轮询读到旧结果。
        ssh(f"rm -f {REMOTE}/status.json {REMOTE}/raw.zip")
        run(upload_manifest)
        run(upload_script)
        lines = ssh(start).strip().splitlines()
        pid_text = lines[-1].strip() if lines else ""
        if not pid_text.isdigit():
            print(f"无法获取远端进程 PID: {pid_text!r}", file=sys.stderr)
            return 1
        pid = int(pid_text)
        try:
            status = wait_for_status(pid)
        except KeyboardInterrupt:
            kill_remote(pid)
            raise
        except TimeoutError:
            kill_remote(pid)
            print(f"生成超时，查看 {REMOTE}/gen.log", file=sys.stderr)
            return 1
        except SystemExit:
            kill_remote(pid)  # 进程可能已死，kill 是幂等的兜底
            raise
        code = finished_error(status, only)
        if code:
            return code
        download_and_extract(only)

    for cmd in (post, val):
        try:
            run(cmd)
        except subprocess.CalledProcessError as exc:
            return exc.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
