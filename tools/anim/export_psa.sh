#!/bin/sh
# Export every creature MeshAnimation to .psa so the audit has an oracle to
# check the shipped glTFs against.  umodel is that oracle: it reads the retail
# .ukx directly, so what it lists IS what the retail asset contains.
#
# ~535 .psa, a few hundred MB, into tools/anim/psa/ (git-ignored scratch).
# Re-run only when the client assets change.
#
# Usage: tools/anim/export_psa.sh [outdir]
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${1:-$ROOT/tools/anim/psa}
UMODEL=$ROOT/tools/bin/umodel
CLIENT=$ROOT/assets/interlude

mkdir -p "$OUT"
cd "$CLIENT"
# The creature packages: monsters, NPCs, event NPCs, decorations.  Player-race
# sets (Fighter/Magic/Elf/DarkElf/Orc/Dwarf/Shaman) come along as dependencies
# of the NPC packages, which is why the player audit finds them too.
for p in LineageMonsters LineageMonsters2 LineageMonsters3 \
         LineageNpcs LineageNPCs2 lineagenpcsev lineagedecos; do
  f=$(ls animations | grep -ix "$p.ukx" || true)
  [ -n "$f" ] || { echo "skip: no animations/$p.ukx"; continue; }
  echo "exporting $f"
  "$UMODEL" -game=l2 -export -out="$OUT" "animations/$f" >/dev/null 2>&1 || true
done
echo "psa files: $(find "$OUT" -name '*.psa' | wc -l | tr -d ' ')"
