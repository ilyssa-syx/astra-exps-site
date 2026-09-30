# ASTRA Experiments Site

Static experiment review pages hosted by GitHub Pages. Large video assets live in Cloudflare R2.

- R2 bucket: `baseline-pointmaps`
- Public asset URL: `https://pub-eaa718fdd45e428bb7275d91ccbfbfb5.r2.dev`

## Current content

- Example: `0827-spoon`
- Baselines: `20260928-2400s` and `no harness`
- Source runs: `../runs/20260928_v7/2400` and `../no_harness_examples/0827-spoon`
- ASTRA exports: every immutable scene iteration discovered from the run
- No-harness exports: before key-time fix, before topology fix, and final

## Build

Render every ASTRA iteration directly to a resumable four-panel website video, prepare
any explicitly configured non-ASTRA videos, then build:

```bash
bash scripts/run_egl.sh scripts/export_iterations.py \
  --run ../runs/20260928_v7/2400 \
  --engine eevee --samples 4 --jobs 3 --timeout-seconds 7200
python3 scripts/build_four_panel_videos.py --jobs 3
python3 scripts/build_site.py
```

Run the EGL step only after reconstruction has produced its immutable iterations,
inside an existing tmux + Slurm GPU shell. The site-owned launcher validates CUDA
and a real offscreen EGL context but never requests a GPU. See
[`docs/egl-rendering.md`](docs/egl-rendering.md) for the tested environment, device
index pitfall, overrides, smoke test, and recovery procedure.

`export_iterations.py` discovers `reconstruction/scene/iterations/*/scene.blend`,
validates every immutable blend hash, and invokes the canonical scene renderer. It
renders reprojection, calibrated source, side, and rear directly into one 960×780
2×2 video; no six-panel intermediate or second video transcode is produced. The
default Eevee backend is substantially faster than the former forced Cycles CPU
path. Existing outputs are reused only when their manifest, blend hash, settings,
and video hash all match. The exporter also raises the per-iteration worker timeout
to two hours by default so full 1200-frame videos do not inherit the CLI's short
smoke-test timeout.

`build_four_panel_videos.py` remains only for explicitly configured standalone
baselines that do not have ASTRA iteration directories. The site builder discovers
ASTRA iterations and their videos automatically, exports the run audit grouped by
iteration, writes the public catalog and pages, and creates `build/asset-manifest.json`.

## Cloudflare R2

1. Configure an R2-compatible rclone remote.
2. Set `asset_base_url` in `config/site.json` to the bucket's public custom domain.
3. Rebuild the site.
4. Preview uploads:

   ```bash
   python3 scripts/upload_assets.py --remote REMOTE:BUCKET --dry-run
   ```

5. Upload:

   ```bash
   python3 scripts/upload_assets.py --remote REMOTE:BUCKET
   ```

Uploads use rclone's `--size-only` comparison to avoid repeated content hashing.

For browser playback, the public R2 domain must allow `GET`, `HEAD`, and byte-range requests. MP4 files are written beneath:

```text
<example>/<baseline>/iterations/iteration-<six-digit-number>.mp4
```

## GitHub Pages

Push `main` after enabling GitHub Pages with **GitHub Actions** as the publishing source. The workflow publishes only `public/`; local run paths and upload manifests are not deployed.
