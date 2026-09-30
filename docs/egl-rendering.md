# Offline EGL rendering

Website rendering is a post-run publishing operation. The reconstruction harness
creates immutable iteration directories and their `scene.blend` files; it does not
need to render a website video while reconstructing. This repository discovers
those iterations later and renders them in one resumable batch.

## Owned configuration

The site owns its rendering entry points:

- `config/render.env` contains the tested interpreter, dependency root, EGL backend,
  and thread defaults. Export the same variable before launch to override a value.
- `scripts/run_egl.sh` requires an existing tmux + Slurm GPU shell, creates writable
  site-local caches, runs the CUDA/EGL preflight, and then executes a Python command.
- `scripts/check_egl.py` performs a real CUDA tensor operation and creates a 64×64
  `pyrender.OffscreenRenderer`; import success alone is not considered a valid test.
- `scripts/export_iterations.py` reads immutable blends and invokes the harness's
  canonical read-only four-panel renderer. Rendered files live under
  `RUN/output/site-videos`, outside the immutable iteration directories.

The exporter reuses the launcher's Python by default; it does not read the harness
runtime configuration to choose its controller. `--controller-python` and
`ASTRA_CONTROLLER_PYTHON` remain explicit overrides for diagnostics.

The wrapper validates a GPU allocation but never requests one. GPU selection and
allocation policy therefore remain outside this site repository.

## Render after reconstruction

Attach to the allocated shell in tmux and run from this repository:

```bash
cd /grogu/datasets/yixuansu/models/astra-project/astra-hoi-harness/astra-exps-site

bash scripts/run_egl.sh scripts/export_iterations.py \
  --run ../runs/20260928_v7/2400 \
  --engine eevee \
  --samples 4 \
  --jobs 3 \
  --timeout-seconds 7200

python3 scripts/build_four_panel_videos.py --jobs 3
python3 scripts/build_site.py
```

The exporter validates immutable iteration metadata, resumes matching outputs, and
moves stale outputs aside before replacing them. A repeat run should report every
iteration as `current` without launching Blender again.

Use `--iteration N` for a targeted retry. Use `--force` only when an intentional
rerender is required, since it bypasses output reuse.

## EGL device notes from 2026-09-29

The verified allocation was Slurm job `3981268` on `grogu-2-30`, with three RTX
A5000 GPUs. The tested environment used Python 3.11 from `sam3d-objects`, PyTorch
2.5.1+cu121, `PYOPENGL_PLATFORM=egl`, and `CUDA_VISIBLE_DEVICES=0,1,2`.

Three concurrent renders succeeded with local `EGL_DEVICE_ID` values `0`, `1`, and
`2`. Values `5`, `6`, and `7` failed because EGL device indices are local renderer
indices, not cluster-wide GPU identifiers. The normal exporter intentionally leaves
`EGL_DEVICE_ID` unset and assigns workers through `CUDA_VISIBLE_DEVICES`; this was
the configuration used for the successful nine-iteration export. Set
`EGL_DEVICE_ID` only for a node-specific diagnostic where the local EGL enumeration
has already been checked.

Useful failure distinctions:

- CUDA check fails: the shell is not inside a usable GPU allocation, or its device
  visibility is wrong.
- CUDA succeeds but EGL creation fails: inspect `PYOPENGL_PLATFORM`, the local EGL
  device index, and node driver compatibility.
- A short render succeeds but a full render is terminated: keep the two-hour
  per-iteration timeout and inspect the iteration's `render.log`; the exporter will
  reuse already complete iterations on the next run.
