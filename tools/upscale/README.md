# HD Texture Upscale — L2Vzla character textures

4x AI upscale of the 92 character PNGs in `editor/characters/models/`
(14 creation characters: face `_f`, body `_u/_l/_g/_b`, hair `_ah/_bh`).

## Tool

`realesrgan-ncnn-vulkan` (Real-ESRGAN ncnn build, model
`realesrgan-x4plus`), vendored locally — nothing installed system-wide:

- `bin/realesrgan-ncnn-vulkan` — universal macOS binary (x86_64+arm64),
  from the official release `xinntao/Real-ESRGAN` v0.2.5.0
  (`realesrgan-ncnn-vulkan-20220424-macos.zip`, the zip that bundles the
  models — the `Real-ESRGAN-ncnn-vulkan` repo release zips do NOT).
- `bin/models/realesrgan-x4plus.{param,bin}` — the x4 general model.
- `composite_check.py` — RGBA-over-dark/light compositing helper used for
  the hair-alpha halo check (pure stdlib).

## What was done

```sh
# backup originals for A/B
mkdir -p editor/characters/models_lq
cp editor/characters/models/*.png editor/characters/models_lq/

# batch 4x (directory mode keeps filenames identical)
tools/upscale/bin/realesrgan-ncnn-vulkan \
  -i editor/characters/models -o /tmp/hd_out -s 4 -m tools/upscale/bin/models -f png

cp /tmp/hd_out/*.png editor/characters/models/
```

- 92/92 files upscaled, all verified exactly 4x via `sips -g pixelWidth`
  (256→1024, 512→2048, 128→512 sources).
- No `*_sp` files existed in `models/` (specular masks were already
  excluded by the texture pipeline — confirmed by name scan).
- Filenames identical → no .gltf edits needed.
- Sizes: models/ went from ~10 MB (LQ) to ~308 MB (HD).
- Alpha: `realesrgan-ncnn-vulkan` processes RGBA as-is. Verified on
  `human_fighter_m_bh.png` composited over dark AND light backgrounds
  (`composite_check.py`): strand edges clean, no dark/color halos, alpha
  channel preserved (`sips -g hasAlpha` = yes).
- Visual verification: `verify_app.js` (app on :8082) passes; face
  closeups of human_fighter_m / elf_f / darkelf_m / dwarf_f re-rendered
  and inspected — skin detail, fabric folds and hair strands visibly
  sharper, no color shifts, no UV misalignment (identical composition to
  the LQ reference renders in `tools/src/char_pipeline/verify/after/`).

## A/B

- LQ originals: `editor/characters/models_lq/` (restore with
  `cp models_lq/*.png models/`).
- HD proof renders: `tools/src/char_pipeline/verify/after/*_hd.png`.

## Quality notes

- realesrgan-x4plus is conservative on hand-painted 2004 art: it
  sharpens edges (hair strands, seams, buckles, face features) without
  inventing texture — exactly right for this content. Skin stays smooth;
  no painterly artifacts or color drift observed.
- 512px body textures → 2048px; 256px face textures → 1024px; 128px
  hair accent textures → 512px. Memory/VRAM per model is still trivial.
- The `_ori` hair textures (alpha-tested strands) upscale cleanly; the
  alpha channel is treated as a 4th channel, so mask edges stay aligned
  with the color edges.

## Scaling this to the full texture library (assets/library/, ~30k)

The same command works per package directory:

```sh
tools/upscale/bin/realesrgan-ncnn-vulkan \
  -i assets/library/<Package> -o /tmp/hd_library/<Package> -s 4 \
  -m tools/upscale/bin/models -f png -j 4
```

Caveats for the full library run:

- **Skip specular/mask textures** (`*_sp` names): their alpha is a
  specular mask and their RGB may be a mask too — upscaling is pointless
  or harmful. Filter by name before invoking.
- The character pipeline's `decode_texture_png` fallback (DXT3 `_sp`
  textures decoded via l2lib) already produces clean RGB — upscale the
  decoded output, not the library's `_sp` exports.
- Runtime: ~2–4 s per 512px texture on this machine (Apple Silicon,
  ncnn/Vulkan via MoltenVK) → roughly 24–48 h for 30k textures; shard
  with `xargs -P` over package dirs if needed (the binary is single-GPU
  but multiple processes coexist fine).
- Disk: expect ~25–30x size growth (PNG at 16x pixels).

## World textures — HD pilot (tiles 17_25 TI village, 22_22 Giran)

Same binary/recipe, but side-by-side instead of in-place:

- `assets/world-hd/<tile>/{textures,props/textures}/<name>.png` — 4x
  upscaled copies of ONLY the textures referenced by `scene.json`
  (terrain layer diffuses + prop gltf images; orphan files skipped).
  The LQ originals in `assets/world/` are untouched — they ARE the LQ
  backup (unlike the character pass, nothing is overwritten, so no
  `models_lq`-style copy was needed).
- Splat maps (`textures/<tile>_*.png`) are NOT upscaled — they are blend
  weights, not art; the client falls back to the LQ file, so layer
  blending is byte-identical in both modes.
- No `*_sp` (specular-alpha) textures existed in either tile (name scan);
  they must stay excluded if a future tile ships them.
- Rebuild manifest + batch (per-file mode, ~17 files/s on M4 with -P8,
  1268 files in 75 s):

  ```sh
  python3 tools/upscale/world_manifest.py          # writes /tmp/hd_manifest.tsv
  cat /tmp/hd_manifest.tsv | while IFS=$'\t' read -r src dst; do
    mkdir -p "$(dirname "$dst")"; printf '%s\0%s\0' "$src" "$dst"
  done | xargs -0 -n2 -P8 sh -c 'tools/upscale/bin/realesrgan-ncnn-vulkan \
    -i "$1" -o "$2" -s 4 -m tools/upscale/bin/models -f png' _
  ```

Client switch (ElberaClient, port 8083):

- `?hd=1` enables, `?hd=0` disables; persists in localStorage
  (`l2vzla.hd`). Default is LQ (HD is a heavy download: pilot tiles went
  76 MB -> 1.86 GB, 24.4x).
- The client only swaps the scene base URL `/scenes/` -> `/scenes-hd/`;
  the server (`editor/world/server.py`) serves `assets/world-hd/` when
  the file exists and falls back to `assets/world/` otherwise, so
  scene.json, heightmaps, gltf, splats and non-pilot tiles all keep
  working unchanged.
- Verification: `WORLD_BASE='http://127.0.0.1:8083/?hd=1' node
  verify_terrain.js hd` (the three verify_*.js harnesses accept
  `WORLD_BASE`).
