#!/bin/bash
# Elbera full verification battery — one command, all suites.
# Usage: tools/battery.sh [--client-only|--gateway-only]
# Exit 0 only if every suite passes. Prints a summary table.
set -u
cd "$(dirname "$0")/.."
MODE="${1:-all}"
PASS=0; FAIL=0; FAILED=()

run() { # name dir script — one retry to absorb timing flakes under load
  local name="$1" dir="$2" script="$3"
  if (cd "$dir" && node "$script" >/dev/null 2>&1) \
  || (cd "$dir" && node "$script" >/dev/null 2>&1); then
    echo "PASS  $name"; PASS=$((PASS+1))
  else
    echo "FAIL  $name"; FAIL=$((FAIL+1)); FAILED+=("$name")
  fi
}

if [ "$MODE" != "--gateway-only" ]; then
  (cd editor/world && node mock_gateway.js > /tmp/elbera_mock.log 2>&1 &)
  sleep 2
  for v in verify_ui verify_statuswnd verify_skillwnd verify_shortcutwnd \
           verify_inventorywnd verify_chatwnd verify_targetwnd verify_dialog \
           verify_actionwnd verify_minimap verify_remoteanim verify_questwnd \
           verify_partywnd verify_abnormal verify_combat verify_skills \
           verify_m5 verify_app verify_civilians verify_interior verify_geodata; do
    run "$v" editor/world "$v.js"
  done
  pkill -f mock_gateway.js 2>/dev/null
fi

if [ "$MODE" != "--client-only" ]; then
  for t in verify-one verify-two verify-m4 verify-m5 verify-combat \
           verify-mods verify-level verify-dialog verify-action \
           verify-party verify-quest verify-buffs verify-shop \
           verify-trade; do
    run "$t" gateway "test/$t.js"
  done
fi

echo "---"
echo "battery: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
