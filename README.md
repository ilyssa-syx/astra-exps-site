# ASTRA Experiments Site

Static experiment review pages hosted by GitHub Pages. Large video assets live in Cloudflare R2.

- R2 bucket: `baseline-pointmaps`
- Public asset URL: `https://pub-eaa718fdd45e428bb7275d91ccbfbfb5.r2.dev`

## Current content

- Example: `0827-spoon`
- Baselines: `20260928-2400s` and `no harness`
- Source runs: `../runs/20260928_v7/2400` and `../no_harness_examples/0827-spoon`
- ASTRA exports: iterations 3, 5, 8, and 9
- No-harness exports: before key-time fix, before topology fix, and final

The 48-byte `output/videos/final_iter09/comparison.mp4` contains no media payload and is intentionally excluded. The valid GPU export for iteration 9 is included.

## Build

Edit `config/site.json`, prepare the website-specific four-panel videos, then build:

```bash
/home/yixuansu/miniforge3/envs/sam3d-objects/bin/python \
  scripts/build_four_panel_videos.py --jobs 3
python3 scripts/build_site.py
```

The video builder removes source RGB and observed depth from each six-panel review and recomposes reprojection, calibrated source, side, and rear into a 960×780 2×2 video. Original reconstruction deliverables are never modified. The site builder reads iteration metadata, writes the public catalog and pages, and creates a local `build/asset-manifest.json`. Neither script hashes videos.

Runtime and token figures shown beside a video are stage-local, not cumulative. ASTRA runtimes are differences between consecutive bound review timestamps. Its run-local `output/usage.json` did not receive usage records, so ASTRA token increments are recovered from the matched outer Codex rollout's checkpoint totals (5,887,278 / 8,740,360 / 12,796,613 / 16,599,879). No-harness stages use the recorded stage-boundary timestamps and sum only per-response token records inside each interval. Preflight usage is excluded; the final no-harness stage includes the later shaded-review correction because that is the displayed final video.

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
<example>/<baseline>/iter-<number>/<export-name>.mp4
```

## GitHub Pages

Push `main` after enabling GitHub Pages with **GitHub Actions** as the publishing source. The workflow publishes only `public/`; local run paths and upload manifests are not deployed.
