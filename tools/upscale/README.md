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
