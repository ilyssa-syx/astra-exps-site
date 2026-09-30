#!/usr/bin/env bash
# Run a site-side Python command with the tested CUDA/EGL environment.
# This launcher validates an existing allocation; it never requests a GPU.
set -euo pipefail

SITE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../config/render.env
source "$SITE_ROOT/config/render.env"

if (( $# == 0 )); then
    echo 'Usage: bash scripts/run_egl.sh scripts/export_iterations.py [arguments...]' >&2
    exit 2
fi
if [[ -z "${TMUX:-}" && "${ASTRA_SITE_ALLOW_NO_TMUX:-0}" != 1 ]]; then
    echo 'Refusing to render outside tmux. Attach to the GPU allocation first.' >&2
    exit 2
fi
if [[ -z "${SLURM_JOB_ID:-}" && "${ASTRA_SITE_ALLOW_NO_SLURM:-0}" != 1 ]]; then
    echo 'No active Slurm allocation. This launcher does not request GPUs.' >&2
    exit 2
fi
if [[ -z "${CUDA_VISIBLE_DEVICES:-}" ]]; then
    echo 'CUDA_VISIBLE_DEVICES is empty; refusing to fall back to a login node or CPU.' >&2
    exit 2
fi
if [[ ! -x "$ASTRA_SITE_PYTHON" ]]; then
    echo "Site Python is not executable: $ASTRA_SITE_PYTHON" >&2
    exit 2
fi
if [[ ! -d "$ASTRA_SITE_EXTERNAL_ROOT" ]]; then
    echo "External HOI dependency root is missing: $ASTRA_SITE_EXTERNAL_ROOT" >&2
    exit 2
fi

export PATH="$(dirname -- "$ASTRA_SITE_PYTHON"):$PATH"
SITE_PYTHONPATH="$ASTRA_SITE_EXTERNAL_ROOT/.deps/shared:$ASTRA_SITE_EXTERNAL_ROOT/third_party/WiLoR:$ASTRA_SITE_EXTERNAL_ROOT/third_party/sam2"
export PYTHONPATH="$SITE_PYTHONPATH${PYTHONPATH:+:$PYTHONPATH}"
export MPLCONFIGDIR="$SITE_ROOT/build/runtime-cache/matplotlib"
export YOLO_CONFIG_DIR="$SITE_ROOT/build/runtime-cache/ultralytics"
mkdir -p "$MPLCONFIGDIR" "$YOLO_CONFIG_DIR"

"$ASTRA_SITE_PYTHON" "$SITE_ROOT/scripts/check_egl.py"
exec "$ASTRA_SITE_PYTHON" "$@"

