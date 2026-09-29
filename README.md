# ASTRA Experiments Site

Static experiment review pages hosted by GitHub Pages. Large video assets live in Cloudflare R2.

## Current content

- Example: `0827-spoon`
- Baseline: `20260928-2400s`
- Source run: `../runs/20260928_v7/2400`
- Valid exports: iterations 3, 5, 8, and 9

The 48-byte `output/videos/final_iter09/comparison.mp4` contains no media payload and is intentionally excluded. The valid GPU export for iteration 9 is included.

## Build

Edit `config/site.json`, then run:

```bash
python3 scripts/build_site.py
```

The script discovers exported MP4s, reads their iteration metadata, writes the public catalog and pages, and creates a local `build/asset-manifest.json`. It does not hash videos.

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
