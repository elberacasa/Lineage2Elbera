#!/bin/bash
# Resumable batch converter for M2 world expansion.
# Converts every named tile from assets/world/tile-map.json that is not
# classified ocean/off-world/utility (GM, olympiad, Seven Signs interiors).
# Skips tiles that already have a scene.json. Logs per tile to
# tools/world/batch_convert.log ; failures go to tools/world/batch_failures.txt
cd "$(dirname "$0")/../.." || exit 1

LOG=tools/world/batch_convert.log
FAIL=tools/world/batch_failures.txt

TILES=$(python3 - <<'EOF'
import json, os
tm = json.load(open('assets/world/tile-map.json'))
have_unr = set(f[:-4] for f in os.listdir('assets/interlude/maps') if f.endswith('.unr'))
SKIP = {'Ocean','Ocean (Talking Island approach)','Unnamed terrain',
        'Off-world (no terrain data)','GM Room (off-world)',
        'Olympiad Stadium (off-world)','Seven Signs'}
todo = []
for t, v in sorted(tm.items()):
    if v['name'] in SKIP or t not in have_unr:
        continue
    if os.path.exists(os.path.join('assets/world', t, 'scene.json')):
        continue
    todo.append(t)
print(' '.join(todo))
EOF
)

echo "=== batch start $(date -u +%FT%TZ) : $(echo $TILES | wc -w | tr -d ' ') tiles ===" >> "$LOG"
for tile in $TILES; do
    if [ -f "assets/world/$tile/scene.json" ]; then
        echo "[skip] $tile already converted" >> "$LOG"
        continue
    fi
    echo "[start] $tile $(date -u +%FT%TZ)" >> "$LOG"
    if python3 tools/world/convert.py "$tile" >> "$LOG" 2>&1; then
        if [ -f "assets/world/$tile/scene.json" ]; then
            echo "[done] $tile" >> "$LOG"
        else
            echo "[FAIL] $tile : no scene.json produced" >> "$LOG"
            echo "$tile : no scene.json produced" >> "$FAIL"
        fi
    else
        echo "[FAIL] $tile : exit $?" >> "$LOG"
        echo "$tile : converter exit non-zero" >> "$FAIL"
    fi
done
echo "=== batch end $(date -u +%FT%TZ) ===" >> "$LOG"
