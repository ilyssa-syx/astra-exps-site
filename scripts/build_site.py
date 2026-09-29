#!/usr/bin/env python3
"""Build the static ASTRA experiment catalog from configured run directories."""

from __future__ import print_function

import html
import json
import re
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "site.json"
PUBLIC = ROOT / "public"
BUILD = ROOT / "build"
ITERATION_RE = re.compile(r"[/\\]iterations[/\\](\d+)[/\\]")
MIN_VIDEO_BYTES = 1024


def read_json(path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def iteration_from_export(export_dir):
    for metadata_name in ("manifest.json", "render_video_job.json"):
        metadata_path = export_dir / metadata_name
        if not metadata_path.is_file():
            continue
        metadata = read_json(metadata_path)
        blend = metadata.get("blend", "")
        match = ITERATION_RE.search(blend)
        if match:
            return int(match.group(1)), metadata
    match = re.search(r"iter(?:ation)?[_-]?(\d+)", export_dir.name, re.I)
    if match:
        return int(match.group(1)), {}
    return None, {}


def variant_label(export_name, metadata):
    panel_count = len(metadata.get("panel_order", []))
    if "gpu" in export_name.lower() and panel_count:
        return "GPU · {}-panel comparison".format(panel_count)
    if "gpu" in export_name.lower():
        return "GPU comparison"
    return "Comparison render"


def build_catalog(config):
    asset_base = config.get("asset_base_url", "").rstrip("/")
    public_examples = []
    upload_assets = []
    warnings = []

    for example in config.get("examples", []):
        public_example = {
            "id": example["id"],
            "title": example.get("title", example["id"]),
            "description": example.get("description", ""),
            "baselines": [],
        }
        for baseline in example.get("baselines", []):
            run_root = (ROOT / baseline["run"]).resolve()
            exports = []
            ignored = []
            annotations = baseline.get("iterations", {})
            configured_exports = baseline.get("exports", [])
            if configured_exports:
                export_specs = []
                for spec in configured_exports:
                    video_path = (
                        BUILD
                        / "videos"
                        / example["id"]
                        / baseline["id"]
                        / (spec["id"] + "-four-panel.mp4")
                    )
                    if not video_path.is_file():
                        raise RuntimeError(
                            "Missing four-panel video {}; run scripts/build_four_panel_videos.py".format(
                                video_path
                            )
                        )
                    export_specs.append((video_path, int(spec["iteration"]), spec))
            else:
                videos_root = run_root / "output" / "videos"
                if not videos_root.is_dir():
                    raise RuntimeError("Missing videos directory: {}".format(videos_root))
                export_specs = []
                for video_path in sorted(videos_root.glob("*/*.mp4")):
                    iteration, metadata = iteration_from_export(video_path.parent)
                    if iteration is None:
                        warnings.append("Could not identify iteration for {}".format(video_path))
                        continue
                    export_specs.append((video_path, iteration, {
                        "id": video_path.parent.name,
                        "label": variant_label(video_path.parent.name, metadata),
                    }))

            for video_path, iteration, spec in export_specs:
                if video_path.stat().st_size < MIN_VIDEO_BYTES:
                    ignored.append({
                        "file": str(video_path),
                        "reason": "empty or incomplete MP4 ({} bytes)".format(video_path.stat().st_size),
                    })
                    continue

                iteration_path = (
                    run_root
                    / "reconstruction"
                    / "scene"
                    / "iterations"
                    / "{:06d}".format(iteration)
                    / "iteration.json"
                )
                iteration_data = read_json(iteration_path) if iteration_path.is_file() else {}
                annotation = annotations.get(str(iteration), {})
                export_name = spec["id"]
                asset_key = "{}/{}/four-panel/{}-four-panel.mp4".format(
                    example["id"], baseline["id"], export_name
                )
                video_url = "{}/{}".format(asset_base, asset_key) if asset_base else ""
                exports.append({
                    "iteration": iteration,
                    "label": spec.get("label", "Iteration {:02d}".format(iteration)),
                    "variant": "Four-panel RGB",
                    "export_id": export_name,
                    "status": annotation.get("status", "review"),
                    "runtime_seconds": annotation.get("runtime_seconds"),
                    "token_count": annotation.get("token_count"),
                    "token_note": annotation.get("token_note", ""),
                    "tools": annotation.get("tools", []),
                    "conclusion": annotation.get("conclusion", ""),
                    "change": annotation.get("change", iteration_data.get("reason", "")),
                    "video_url": video_url,
                    "asset_key": asset_key,
                    "bytes": video_path.stat().st_size,
                    "width": 960,
                    "height": 780,
                })
                upload_assets.append({
                    "source": str(video_path),
                    "key": asset_key,
                    "bytes": video_path.stat().st_size,
                })

            exports.sort(key=lambda item: (item["iteration"], item["export_id"]))
            public_example["baselines"].append({
                "id": baseline["id"],
                "label": baseline.get("label", baseline["id"]),
                "summary": baseline.get("summary", ""),
                "exports": exports,
                "ignored_exports": ignored,
            })
        public_examples.append(public_example)

    return {
        "site_title": config.get("site_title", "ASTRA Experiments"),
        "asset_base_url": asset_base,
        "examples": public_examples,
    }, upload_assets, warnings


def render_example_page(example, site_title):
    title = "{} · {}".format(example.get("title", example["id"]), site_title)
    return """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="{description}">
  <title>{title}</title>
  <link rel="stylesheet" href="../../assets/site.css">
</head>
<body data-example="{example_id}">
  <header class="topbar"><a class="brand" href="../../">ASTRA / EXPERIMENTS</a></header>
  <main id="example-root" class="page-shell" aria-live="polite">
    <p class="loading">Loading experiment…</p>
  </main>
  <script src="../../assets/example.js" defer></script>
</body>
</html>
""".format(
        title=html.escape(title),
        description=html.escape(example.get("description", ""), quote=True),
        example_id=html.escape(example["id"], quote=True),
    )


def build_pages(config, catalog):
    template_root = ROOT / "site"
    PUBLIC.mkdir(parents=True, exist_ok=True)
    assets_dest = PUBLIC / "assets"
    if assets_dest.exists():
        shutil.rmtree(str(assets_dest))
    shutil.copytree(str(template_root / "assets"), str(assets_dest))
    shutil.copy2(str(template_root / "index.html"), str(PUBLIC / "index.html"))
    (PUBLIC / ".nojekyll").touch()
    write_json(PUBLIC / "data" / "catalog.json", catalog)

    examples_root = PUBLIC / "examples"
    if examples_root.exists():
        shutil.rmtree(str(examples_root))
    for example in config.get("examples", []):
        output = examples_root / example["id"] / "index.html"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            render_example_page(example, catalog["site_title"]), encoding="utf-8"
        )


def main():
    config = read_json(CONFIG_PATH)
    catalog, assets, warnings = build_catalog(config)
    build_pages(config, catalog)
    write_json(BUILD / "asset-manifest.json", {"assets": assets})
    write_json(BUILD / "build-report.json", {"warnings": warnings})
    print(
        "Built {} example(s), {} baseline(s), and {} video asset(s).".format(
            len(catalog["examples"]),
            sum(len(item["baselines"]) for item in catalog["examples"]),
            len(assets),
        )
    )
    if not catalog["asset_base_url"]:
        print("R2 asset_base_url is not configured; video cards will show a pending state.")
    for warning in warnings:
        print("WARNING: {}".format(warning))


if __name__ == "__main__":
    main()
