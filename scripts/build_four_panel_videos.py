#!/usr/bin/env python3
"""Recompose six-panel review videos into website-specific four-panel videos."""

from __future__ import print_function

import argparse
import concurrent.futures
import json
from pathlib import Path

import av
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "site.json"
BUILD_ROOT = ROOT / "build" / "videos"
PANEL_WIDTH = 480
PANEL_HEIGHT = 390
OUTPUT_WIDTH = PANEL_WIDTH * 2
OUTPUT_HEIGHT = PANEL_HEIGHT * 2


def read_json(path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def jobs_from_config():
    config = read_json(CONFIG_PATH)
    jobs = []
    for example in config.get("examples", []):
        for baseline in example.get("baselines", []):
            for export in baseline.get("exports", []):
                source = (ROOT / export["source"]).resolve()
                output = BUILD_ROOT / example["id"] / baseline["id"] / (
                    export["id"] + "-four-panel.mp4"
                )
                jobs.append({
                    "example": example["id"],
                    "baseline": baseline["id"],
                    "export": export["id"],
                    "source": source,
                    "output": output,
                })
    return jobs


def is_current(job):
    output = job["output"]
    source = job["source"]
    if not output.is_file() or output.stat().st_size < 1024:
        return False
    if output.stat().st_mtime < source.stat().st_mtime:
        return False
    try:
        with av.open(str(output)) as container:
            stream = container.streams.video[0]
            return (
                stream.width == OUTPUT_WIDTH
                and stream.height == OUTPUT_HEIGHT
                and stream.frames == 1200
            )
    except Exception:
        return False


def four_panel_frame(frame):
    array = frame.to_ndarray(format="rgb24")
    if array.shape[:2] != (OUTPUT_HEIGHT, PANEL_WIDTH * 3):
        raise ValueError("Expected a 1440x780 six-panel frame, got {}".format(array.shape))
    panels = (
        array[0:PANEL_HEIGHT, PANEL_WIDTH * 2:PANEL_WIDTH * 3],
        array[PANEL_HEIGHT:OUTPUT_HEIGHT, 0:PANEL_WIDTH],
        array[PANEL_HEIGHT:OUTPUT_HEIGHT, PANEL_WIDTH:PANEL_WIDTH * 2],
        array[PANEL_HEIGHT:OUTPUT_HEIGHT, PANEL_WIDTH * 2:PANEL_WIDTH * 3],
    )
    top = np.concatenate((panels[0], panels[1]), axis=1)
    bottom = np.concatenate((panels[2], panels[3]), axis=1)
    return np.concatenate((top, bottom), axis=0)


def convert(job, force=False):
    source = job["source"]
    output = job["output"]
    if not source.is_file():
        raise RuntimeError("Missing source video: {}".format(source))
    if not force and is_current(job):
        return {"status": "current", **{key: str(value) for key, value in job.items()}}

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp.mp4")
    if temporary.exists():
        temporary.unlink()
    decoded = 0
    with av.open(str(source)) as source_container:
        source_stream = source_container.streams.video[0]
        rate = source_stream.average_rate or 60
        if source_stream.width != 1440 or source_stream.height != 780:
            raise ValueError("{} is not 1440x780".format(source))
        with av.open(str(temporary), mode="w", options={"movflags": "+faststart"}) as target:
            stream = target.add_stream("libx264", rate=rate)
            stream.width = OUTPUT_WIDTH
            stream.height = OUTPUT_HEIGHT
            stream.pix_fmt = "yuv420p"
            stream.options = {"crf": "18", "preset": "veryfast"}
            for frame in source_container.decode(source_stream):
                packet_frame = av.VideoFrame.from_ndarray(four_panel_frame(frame), format="rgb24")
                for packet in stream.encode(packet_frame):
                    target.mux(packet)
                decoded += 1
            for packet in stream.encode():
                target.mux(packet)
    if decoded != 1200:
        if temporary.exists():
            temporary.unlink()
        raise RuntimeError("{} decoded {} frames, expected 1200".format(source, decoded))
    temporary.replace(output)
    with av.open(str(output)) as check:
        stream = check.streams.video[0]
        verified = sum(1 for _ in check.decode(video=0))
        if stream.width != OUTPUT_WIDTH or stream.height != OUTPUT_HEIGHT or verified != decoded:
            raise RuntimeError("Failed output validation: {}".format(output))
    result = {"status": "built", **{key: str(value) for key, value in job.items()}}
    result.update({"frames": decoded, "fps": float(rate), "width": OUTPUT_WIDTH, "height": OUTPUT_HEIGHT})
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--jobs", type=int, default=3)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    jobs = jobs_from_config()
    results = []
    with concurrent.futures.ProcessPoolExecutor(max_workers=max(1, args.jobs)) as executor:
        futures = [executor.submit(convert, job, args.force) for job in jobs]
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            results.append(result)
            print("{}: {}/{}".format(result["status"], result["baseline"], result["export"]), flush=True)
    report = ROOT / "build" / "four-panel-report.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    with report.open("w", encoding="utf-8") as handle:
        json.dump({
            "panel_order": [
                "reconstruction_reprojected_over_rgb",
                "blender_calibrated_source",
                "blender_side",
                "blender_rear",
            ],
            "results": sorted(results, key=lambda item: (item["baseline"], item["export"])),
        }, handle, indent=2)
        handle.write("\n")
    print("Prepared {} four-panel videos.".format(len(results)))


if __name__ == "__main__":
    main()
