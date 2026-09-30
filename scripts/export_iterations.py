#!/usr/bin/env python3
"""Render every immutable scene iteration directly to one four-panel video."""

from __future__ import print_function

import argparse
import concurrent.futures
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path


SITE_ROOT = Path(__file__).resolve().parents[1]
HARNESS_ROOT = SITE_ROOT.parent
HOI = HARNESS_ROOT / "tools" / "hoi.py"
VIDEO_SCHEMA = "astra-four-panel-video/v1"


def read_json(path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    temporary.replace(path)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def discover_iterations(run_root):
    iterations_root = run_root / "reconstruction" / "scene" / "iterations"
    jobs = []
    for directory in sorted(iterations_root.glob("[0-9][0-9][0-9][0-9][0-9][0-9]")):
        metadata_path = directory / "iteration.json"
        blend = directory / "scene.blend"
        if not metadata_path.is_file() or not blend.is_file():
            raise RuntimeError("Incomplete iteration directory: {}".format(directory))
        metadata = read_json(metadata_path)
        iteration = int(directory.name)
        if metadata.get("iteration") != iteration:
            raise RuntimeError("Iteration number mismatch in {}".format(metadata_path))
        actual_hash = sha256(blend)
        if metadata.get("blend_sha256") != actual_hash:
            raise RuntimeError("Blend hash mismatch in {}".format(directory))
        jobs.append({
            "iteration": iteration,
            "blend": blend,
            "blend_sha256": actual_hash,
            "metadata": metadata,
        })
    if not jobs:
        raise RuntimeError("No immutable iterations found under {}".format(iterations_root))
    numbers = [job["iteration"] for job in jobs]
    if numbers != list(range(numbers[0], numbers[-1] + 1)):
        raise RuntimeError("Iteration sequence is not contiguous: {}".format(numbers))
    return jobs


def infer_fps(run_root):
    manifest = read_json(run_root / "input" / "manifest.json")
    fps = float(manifest["fps"])
    if fps <= 0 or not fps.is_integer():
        raise RuntimeError("Website video FPS must be a positive integer, got {}".format(fps))
    return int(fps)


def controller_python(override=None):
    candidate = (
        override
        or os.environ.get("ASTRA_CONTROLLER_PYTHON")
        or os.environ.get("ASTRA_SITE_PYTHON")
        or sys.executable
    )
    path = Path(os.path.expandvars(os.path.expanduser(candidate))).resolve()
    if not path.is_file():
        raise RuntimeError("Controller Python is not executable: {}".format(path))
    return str(path)


def current_output(output, job, fps, samples, engine):
    manifest_path = output / "manifest.json"
    video = output / "comparison.mp4"
    if not manifest_path.is_file() or not video.is_file():
        return False
    try:
        manifest = read_json(manifest_path)
    except (OSError, ValueError):
        return False
    actual_engine = manifest.get("render_backend", {}).get("engine")
    engine_matches = (
        actual_engine in ("BLENDER_EEVEE_NEXT", "CYCLES") if engine == "auto"
        else actual_engine == ("BLENDER_EEVEE_NEXT" if engine == "eevee" else "CYCLES")
    )
    return (
        manifest.get("schema") == VIDEO_SCHEMA
        and manifest.get("iteration") == job["iteration"]
        and manifest.get("blend_sha256") == job["blend_sha256"]
        and manifest.get("fps") == fps
        and manifest.get("samples") == samples
        and manifest.get("width") == 960
        and manifest.get("height") == 780
        and engine_matches
        and manifest.get("video_sha256") == sha256(video)
    )


def move_stale_output(output):
    if not output.exists():
        return None
    suffix = time.strftime("%Y%m%d-%H%M%S")
    stale = output.with_name(output.name + ".stale-" + suffix)
    counter = 1
    while stale.exists():
        stale = output.with_name(output.name + ".stale-{}-{}".format(suffix, counter))
        counter += 1
    output.replace(stale)
    return stale


def render_one(run_root, output_root, gravity_report, fps, samples, engine,
               device, timeout_seconds, controller, blender_python, force, gpu, job):
    output = output_root / "iteration_{:06d}".format(job["iteration"])
    if not force and current_output(output, job, fps, samples, engine):
        return {"iteration": job["iteration"], "status": "current", "output": str(output)}

    stale = move_stale_output(output)
    attempts = ("eevee", "cycles") if engine == "auto" else (engine,)
    completed = None
    for attempt_index, attempt_engine in enumerate(attempts):
        if attempt_index:
            failed = move_stale_output(output)
            print("fallback: iteration {:06d} {} failed; preserved {}".format(
                job["iteration"], attempts[attempt_index - 1], failed), flush=True)
        log_path = output_root / (
            ".iteration_{:06d}.{}.render.log".format(job["iteration"], attempt_engine)
        )
        command = [
            controller, str(HOI), "scene", "render-video",
            "--blend", str(job["blend"]),
            "--out-dir", str(output),
            "--fps", str(fps),
            "--samples", str(samples),
            "--render-engine", attempt_engine,
            "--render-device", device,
            "--timeout-seconds", str(timeout_seconds),
        ]
        if gravity_report is not None:
            command.extend(["--gravity-report", str(gravity_report)])
        if blender_python:
            command.extend(["--blender-python", blender_python])

        output_root.mkdir(parents=True, exist_ok=True)
        environment = os.environ.copy()
        if gpu is not None:
            environment["CUDA_VISIBLE_DEVICES"] = gpu
        with log_path.open("w", encoding="utf-8") as log:
            completed = subprocess.run(
                command, cwd=str(HARNESS_ROOT), stdout=log, stderr=subprocess.STDOUT,
                check=False, env=environment,
            )
        if output.is_dir():
            shutil.move(str(log_path), str(output / "render.log"))
        if completed.returncode == 0:
            break
    if completed is None or completed.returncode != 0:
        raise RuntimeError(
            "Iteration {} render failed with exit {}; see {}".format(
                job["iteration"], completed.returncode if completed else "unknown",
                output / "render.log",
            )
        )

    manifest_path = output / "manifest.json"
    manifest = read_json(manifest_path)
    manifest["iteration"] = job["iteration"]
    manifest["iteration_metadata"] = str(
        job["blend"].parent.joinpath("iteration.json").relative_to(run_root)
    )
    write_json(manifest_path, manifest)
    if not current_output(output, job, fps, samples, engine):
        raise RuntimeError("Iteration {} output failed post-render validation".format(job["iteration"]))
    return {
        "iteration": job["iteration"],
        "status": "rendered",
        "output": str(output),
        "gpu": gpu,
        "replaced": str(stale) if stale else None,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True, help="ASTRA run root")
    parser.add_argument("--output", help="defaults to RUN/output/site-videos")
    parser.add_argument("--fps", type=int, help="defaults to input/manifest.json")
    parser.add_argument("--samples", type=int, default=4)
    parser.add_argument("--engine", choices=("auto", "eevee", "cycles"), default="auto")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda", "optix"), default="auto")
    parser.add_argument("--timeout-seconds", type=float, default=7200,
                        help="per-iteration Blender timeout (default: 7200)")
    parser.add_argument("--blender-python")
    parser.add_argument("--controller-python")
    parser.add_argument("--jobs", type=int, default=1)
    parser.add_argument("--gpu", action="append",
                        help="CUDA device visible to one worker; repeat to distribute jobs. "
                             "Defaults to CUDA_VISIBLE_DEVICES entries")
    parser.add_argument("--iteration", action="append", type=int,
                        help="render only this iteration; repeat as needed")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    run_root = Path(args.run).resolve()
    output_root = (Path(args.output).resolve() if args.output
                   else run_root / "output" / "site-videos")
    fps = args.fps or infer_fps(run_root)
    if fps <= 0 or args.samples <= 0 or args.jobs <= 0 or args.timeout_seconds <= 0:
        parser.error("fps, samples, jobs, and timeout-seconds must be positive")
    gravity_candidate = run_root / "work" / "gravity" / "gravity.json"
    gravity_report = gravity_candidate if gravity_candidate.is_file() else None
    controller = controller_python(args.controller_python)
    jobs = discover_iterations(run_root)
    if args.iteration:
        selected = set(args.iteration)
        jobs = [job for job in jobs if job["iteration"] in selected]
        missing = selected.difference(job["iteration"] for job in jobs)
        if missing:
            parser.error("unknown iterations: {}".format(sorted(missing)))

    visible_devices = args.gpu
    if visible_devices is None:
        inherited = os.environ.get("CUDA_VISIBLE_DEVICES", "").strip()
        visible_devices = [value.strip() for value in inherited.split(",") if value.strip()]
    if visible_devices:
        print("CUDA workers: {}".format(", ".join(visible_devices)), flush=True)

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as executor:
        futures = [executor.submit(
            render_one, run_root, output_root, gravity_report, fps, args.samples,
            args.engine, args.device, args.timeout_seconds, controller,
            args.blender_python, args.force,
            visible_devices[index % len(visible_devices)] if visible_devices else None, job,
        ) for index, job in enumerate(jobs)]
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            results.append(result)
            print("{}: iteration {:06d}".format(result["status"], result["iteration"]), flush=True)

    report = {
        "schema": "astra-site-video-export/v1",
        "run": str(run_root),
        "output": str(output_root),
        "fps": fps,
        "samples": args.samples,
        "engine": args.engine,
        "device": args.device,
        "timeout_seconds": args.timeout_seconds,
        "cuda_workers": visible_devices,
        "results": sorted(results, key=lambda item: item["iteration"]),
    }
    output_root.mkdir(parents=True, exist_ok=True)
    write_json(output_root / "export-report.json", report)
    print("Exported {} iteration video(s).".format(len(results)))


if __name__ == "__main__":
    main()
