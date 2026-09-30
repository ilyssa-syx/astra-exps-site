#!/usr/bin/env python3
"""Fail fast unless the current allocation provides working CUDA and EGL."""

from __future__ import print_function

import json
import os
import socket
import sys

import torch


def main():
    if not torch.cuda.is_available():
        raise SystemExit("CUDA is unavailable in this process")

    cuda_check = (torch.ones(1, device="cuda:0") + 1).item()

    import pyrender

    renderer = pyrender.OffscreenRenderer(64, 64)
    renderer.delete()

    print(json.dumps({
        "host": socket.gethostname(),
        "slurm_job_id": os.environ.get("SLURM_JOB_ID"),
        "python": sys.executable,
        "torch": torch.__version__,
        "cuda_build": torch.version.cuda,
        "cuda_visible_devices": os.environ.get("CUDA_VISIBLE_DEVICES"),
        "egl_device_id": os.environ.get("EGL_DEVICE_ID"),
        "gpu": torch.cuda.get_device_name(0),
        "cuda_check": cuda_check,
        "egl": "ok",
    }), flush=True)


if __name__ == "__main__":
    main()

