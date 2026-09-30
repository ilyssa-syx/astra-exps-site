#!/usr/bin/env python3
"""Build the static ASTRA experiment catalog from configured run directories."""

from __future__ import print_function

import html
import hashlib
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
EXCLUDED_AUDIT_OPERATIONS = {
    ("run", "budget-status"),
    ("run", "usage"),
}


def read_json(path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_jsonl(path):
    events = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                events.append(json.loads(line))
            except ValueError as error:
                raise RuntimeError(
                    "Invalid JSON in {} at line {}: {}".format(path, line_number, error)
                )
    return events


def verify_audit_chain(events, path):
    previous_hash = None
    for index, event in enumerate(events, 1):
        if event.get("schema") != "hoi-agent-audit-event/v1":
            raise RuntimeError("Unsupported audit event schema at {}:{}".format(path, index))
        if event.get("sequence") != index or event.get("previous_hash") != previous_hash:
            raise RuntimeError("Broken audit sequence/hash link at {}:{}".format(path, index))
        unsigned = dict(event)
        recorded_hash = unsigned.pop("event_hash", None)
        canonical = json.dumps(
            unsigned, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
            allow_nan=False,
        )
        expected_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        if recorded_hash != expected_hash:
            raise RuntimeError("Changed audit event at {}:{}".format(path, index))
        previous_hash = recorded_hash


def referenced_json(run_root, reference):
    if not reference:
        return None
    path = (run_root / reference).resolve()
    try:
        path.relative_to(run_root)
    except ValueError:
        raise RuntimeError("Audit reference escapes run root: {}".format(reference))
    return read_json(path) if path.is_file() else None


def argument_value(argv, option):
    try:
        index = argv.index(option)
    except ValueError:
        return None
    return argv[index + 1] if index + 1 < len(argv) else None


def build_audit(run_root, iterations):
    """Export and segment the audit without rewriting its recorded claims."""
    audit_path = run_root / "audit" / "events.jsonl"
    if not audit_path.is_file():
        return {
            "available": False,
            "source": "audit/events.jsonl",
            "setup_events": [],
            "iteration_events": {},
            "excluded_event_count": 0,
        }

    events = read_jsonl(audit_path)
    verify_audit_chain(events, audit_path)
    excluded_call_ids = {
        event.get("payload", {}).get("call_id")
        for event in events
        if event.get("event") == "tool_call_started"
        and (
            event.get("payload", {}).get("tool"),
            event.get("payload", {}).get("operation"),
        ) in EXCLUDED_AUDIT_OPERATIONS
    }
    included = [
        event
        for event in events
        if event.get("payload", {}).get("call_id") not in excluded_call_ids
    ]
    reason_to_iteration = {
        metadata.get("reason"): number
        for number, metadata in iterations.items()
        if metadata.get("reason")
    }
    call_targets = {}
    documents = {}
    for event in included:
        payload = event.get("payload", {})
        call_id = payload.get("call_id")
        if not call_id:
            continue
        document = referenced_json(run_root, payload.get("request"))
        if document is not None:
            documents[(call_id, "request")] = document
            reason = argument_value(document.get("argv", []), "--reason")
            if reason in reason_to_iteration:
                call_targets[call_id] = reason_to_iteration[reason]
            if payload.get("tool") == "scene" and payload.get("operation") == "create":
                stdout_path = run_root / "audit" / "tool_calls" / call_id / "stdout.log"
                if stdout_path.is_file():
                    created = []
                    for line in stdout_path.read_text(encoding="utf-8").splitlines():
                        try:
                            value = json.loads(line)
                        except ValueError:
                            continue
                        if isinstance(value, dict) and isinstance(value.get("iteration"), int):
                            created.append(value["iteration"])
                        current = value.get("current", {}) if isinstance(value, dict) else {}
                        if isinstance(current.get("iteration"), int):
                            created.append(current["iteration"])
                    if created:
                        call_targets[call_id] = max(created)
        result = referenced_json(run_root, payload.get("result"))
        if result is not None:
            documents[(call_id, "result")] = result

    setup_events = []
    iteration_events = {str(number): [] for number in iterations}
    current_iteration = None
    for event in included:
        payload = event.get("payload", {})
        call_id = payload.get("call_id")
        if event.get("event") == "tool_call_started" and call_id in call_targets:
            current_iteration = call_targets[call_id]
        assigned_iteration = call_targets.get(call_id, current_iteration)
        exported = {"raw": event}
        request = documents.get((call_id, "request"))
        result = documents.get((call_id, "result"))
        if event.get("event") == "tool_call_started" and request is not None:
            exported["request"] = request
        if event.get("event") == "tool_call_finished" and result is not None:
            exported["result"] = result
        if assigned_iteration in iterations:
            iteration_events[str(assigned_iteration)].append(exported)
        else:
            setup_events.append(exported)

    return {
        "available": True,
        "source": "audit/events.jsonl",
        "setup_events": setup_events,
        "iteration_events": iteration_events,
        "excluded_event_count": len(events) - len(included),
        "included_event_count": len(included),
    }


def review_status(events):
    verdict = None
    for exported in events:
        argv = exported.get("request", {}).get("argv", [])
        recorded = argument_value(argv, "--verdict")
        if recorded:
            verdict = recorded
    return {"accept": "accepted", "reject": "rejected", "revise": "revised"}.get(
        verdict, "recorded"
    )


def run_iterations(run_root):
    root = run_root / "reconstruction" / "scene" / "iterations"
    result = {}
    for directory in sorted(root.glob("[0-9][0-9][0-9][0-9][0-9][0-9]")):
        metadata_path = directory / "iteration.json"
        blend = directory / "scene.blend"
        if not metadata_path.is_file() or not blend.is_file():
            raise RuntimeError("Incomplete iteration directory: {}".format(directory))
        metadata = read_json(metadata_path)
        number = int(directory.name)
        if metadata.get("iteration") != number:
            raise RuntimeError("Iteration number mismatch: {}".format(metadata_path))
        if metadata.get("blend_sha256") != sha256(blend):
            raise RuntimeError("Blend hash mismatch: {}".format(directory))
        result[number] = metadata
    return result


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
    asset_version = config.get("asset_version", "1")
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
            configured_exports = baseline.get("exports", [])
            annotations = baseline.get("iterations", {})
            iterations = run_iterations(run_root)
            audit = build_audit(run_root, iterations)
            if baseline.get("auto_iterations"):
                if not iterations:
                    raise RuntimeError("No iterations found for {}".format(run_root))
                export_specs = []
                for iteration, iteration_data in sorted(iterations.items()):
                    render_dir = (
                        run_root / "output" / "site-videos"
                        / "iteration_{:06d}".format(iteration)
                    )
                    video_path = render_dir / "comparison.mp4"
                    manifest_path = render_dir / "manifest.json"
                    metadata = read_json(manifest_path) if manifest_path.is_file() else {}
                    if metadata and (
                        metadata.get("schema") != "astra-four-panel-video/v1"
                        or metadata.get("iteration") != iteration
                        or metadata.get("blend_sha256") != iteration_data.get("blend_sha256")
                        or metadata.get("width") != 960
                        or metadata.get("height") != 780
                        or not video_path.is_file()
                        or metadata.get("video_sha256") != sha256(video_path)
                    ):
                        raise RuntimeError("Stale or mismatched video manifest: {}".format(manifest_path))
                    export_specs.append((video_path, iteration, {
                        "id": "iteration-{:06d}".format(iteration),
                        "label": "Iteration {:02d}".format(iteration),
                        "metadata": metadata,
                        "manifest_valid": bool(metadata),
                    }))
            elif configured_exports:
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
                video_ready = (
                    spec.get("manifest_valid", True)
                    and video_path.is_file()
                    and video_path.stat().st_size >= MIN_VIDEO_BYTES
                )
                if not video_ready:
                    ignored.append({
                        "file": str(video_path),
                        "reason": "missing manifest or incomplete MP4",
                    })
                    warnings.append("Missing iteration video: {}".format(video_path))

                iteration_path = (
                    run_root
                    / "reconstruction"
                    / "scene"
                    / "iterations"
                    / "{:06d}".format(iteration)
                    / "iteration.json"
                )
                iteration_data = read_json(iteration_path) if iteration_path.is_file() else {}
                export_name = spec["id"]
                asset_key = "{}/{}/iterations/{}.mp4".format(
                    example["id"], baseline["id"], export_name
                )
                video_url = "{}/{}?v={}".format(
                    asset_base, asset_key, asset_version
                ) if asset_base and video_ready else ""
                audit_events = audit.get("iteration_events", {}).get(str(iteration), [])
                annotation = annotations.get(str(iteration), {})
                exports.append({
                    "iteration": iteration,
                    "label": spec.get("label", "Iteration {:02d}".format(iteration)),
                    "variant": "Four-panel RGB",
                    "export_id": export_name,
                    "status": annotation.get("status", review_status(audit_events)),
                    "runtime_seconds": annotation.get("runtime_seconds"),
                    "token_count": annotation.get("token_count"),
                    "token_note": annotation.get("token_note", ""),
                    "reason": iteration_data.get("reason", ""),
                    "provenance": iteration_data.get("provenance"),
                    "blend_sha256": iteration_data.get("blend_sha256", ""),
                    "audit_events": audit_events,
                    "video_url": video_url,
                    "asset_key": asset_key,
                    "video_ready": video_ready,
                    "bytes": video_path.stat().st_size if video_ready else 0,
                    "width": 960,
                    "height": 780,
                })
                if video_ready:
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
                "total_token_count": baseline.get("total_token_count"),
                "token_total_note": baseline.get("token_total_note", ""),
                "exports": exports,
                "ignored_exports": ignored,
                "audit": {
                    "available": audit["available"],
                    "source": audit["source"],
                    "setup_events": audit.get("setup_events", []),
                    "included_event_count": audit.get("included_event_count", 0),
                    "excluded_event_count": audit["excluded_event_count"],
                },
            })
        public_examples.append(public_example)

    return {
        "site_title": config.get("site_title", "ASTRA Experiments"),
        "asset_base_url": asset_base,
        "examples": public_examples,
    }, upload_assets, warnings


def render_example_page(example, site_title, asset_version):
    title = "{} · {}".format(example.get("title", example["id"]), site_title)
    return """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="{description}">
  <title>{title}</title>
  <link rel="stylesheet" href="../../assets/site.css?v={asset_version}">
</head>
<body data-example="{example_id}" data-asset-version="{asset_version}">
  <header class="topbar"><a class="brand" href="../../">ASTRA / EXPERIMENTS</a></header>
  <main id="example-root" class="page-shell" aria-live="polite">
    <p class="loading">Loading experiment…</p>
  </main>
  <script src="../../assets/example.js?v={asset_version}" defer></script>
</body>
</html>
""".format(
        title=html.escape(title),
        description=html.escape(example.get("description", ""), quote=True),
        example_id=html.escape(example["id"], quote=True),
        asset_version=html.escape(asset_version, quote=True),
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
            render_example_page(
                example,
                catalog["site_title"],
                config.get("asset_version", "1"),
            ),
            encoding="utf-8",
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
