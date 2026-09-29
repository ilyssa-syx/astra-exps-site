#!/usr/bin/env python3
"""Upload generated video assets with rclone, using size-only comparisons."""

from __future__ import print_function

import argparse
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "build" / "asset-manifest.json"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--remote",
        required=True,
        help="rclone destination including bucket, e.g. cloudflare-r2:astra-exps",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not MANIFEST.is_file():
        raise SystemExit("Run scripts/build_site.py first")
    with MANIFEST.open("r", encoding="utf-8") as handle:
        assets = json.load(handle).get("assets", [])

    destination = args.remote.rstrip("/")
    for asset in assets:
        target = "{}/{}".format(destination, asset["key"])
        command = [
            "rclone",
            "copyto",
            asset["source"],
            target,
            "--size-only",
            "--progress",
        ]
        if args.dry_run:
            command.append("--dry-run")
        print("Uploading {} -> {}".format(asset["source"], target))
        subprocess.check_call(command)


if __name__ == "__main__":
    main()

