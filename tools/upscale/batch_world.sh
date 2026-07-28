#!/bin/bash
# ElberaUpscaler — full world-texture HD batch (100 tiles).
# Regenerates the manifest of scene-referenced textures, upscales missing
# ones 4x into assets/world-hd/, then verifies completeness.
#
#   tools/upscale/batch_world.sh [tile ...]    # default: all tiles
#
# Learned the hard way: the xargs form needs the trailing `_` placeholder —
# without it the args shift (-o gets an empty string) and EVERY call fails
# with the tool's usage text. Do not remove it.
set -u
cd "$(dirname "$0")/.."

TILES="${@:-$(ls assets/world | grep -E '^[0-9]+_[0-9]+$')}"
echo "tiles: $(echo "$TILES" | wc -w)"

python3 tools/upscale/world_manifest.py $TILES || exit 1

# work list = manifest entries whose HD output is missing/empty
python3 - <<'EOF'
import os
out = open('/tmp/hd_todo.tsv', 'w')
n = 0
for line in open('/tmp/hd_manifest.tsv'):
    src, dst = line.rstrip('\n').split('\t')
    if not os.path.isfile(dst) or os.path.getsize(dst) == 0:
        out.write(line); n += 1
out.close()
print(f"to upscale: {n}")
EOF

rm -f /tmp/hd_failures.log
cat /tmp/hd_todo.tsv | while IFS=$'\t' read -r src dst; do
  mkdir -p "$(dirname "$dst")"; printf '%s\0%s\0' "$src" "$dst"
done | xargs -0 -n2 -P8 sh -c 'tools/upscale/bin/realesrgan-ncnn-vulkan \
  -i "$1" -o "$2" -s 4 -m tools/upscale/bin/models -f png >/dev/null 2>&1 \
  || echo "FAILED: $1" >> /tmp/hd_failures.log' _

# completeness check
python3 - <<'EOF'
import os
missing = [d for line in open('/tmp/hd_manifest.tsv')
           for s, d in [line.rstrip('\n').split('\t')]
           if not os.path.isfile(d) or os.path.getsize(d) == 0]
print(f"missing after batch: {len(missing)}")
raise SystemExit(1 if missing else 0)
EOF
