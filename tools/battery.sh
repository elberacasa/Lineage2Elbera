#!/bin/bash
# Elbera full verification battery — one command, all suites.
#
# Usage:
#   tools/battery.sh                 every section (mock, solo, gateway, live)
#   tools/battery.sh --mock-only     client suites that need the shared mocks
#   tools/battery.sh --solo-only     client suites that need only the dev server
#   tools/battery.sh --client-only   mock + solo  (no real aCis needed)
#   tools/battery.sh --gateway-only  gateway/test/** against the real stack
#   tools/battery.sh --live-only     browser suites against the real stack
#   tools/battery.sh --no-live       everything except the *_live browser suites
#   tools/battery.sh --selftest      prove the watchdog and the mock's EADDRINUSE
#                                    handler still work (fast, no suites)
#   tools/battery.sh --list          print the suite table and exit
#
# Env:
#   BATTERY_LOGDIR   where per-suite logs go            (default /tmp/elbera_battery)
#   BATTERY_TIMEOUT  override EVERY suite's limit, secs (default: per-suite column)
#   BATTERY_ONLY     space-separated suite names to run; everything else skipped
#
# Exit 0 only if every suite that ran passed.
#
# ---------------------------------------------------------------------------
# WHY THE WATCHDOG EXISTS
#
# A suite that hangs used to stall the whole sweep. In the run before this one,
# two suites sat at 0.0% CPU for 7 and 36 minutes and the battery produced NO
# TABLE AT ALL — the single worst failure mode, because a sweep that reports
# nothing is indistinguishable from a sweep that was never started. Every suite
# now runs under a hard deadline; blowing it is a FAILURE with a TIMEOUT reason,
# never a stall. Timeouts are NOT retried: retrying a hang just doubles it.
# ---------------------------------------------------------------------------
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
LOGDIR="${BATTERY_LOGDIR:-/tmp/elbera_battery}"
ONLY="${BATTERY_ONLY:-}"
PASS=0; FAIL=0; SKIP=0
FAILED=(); RETRIED=(); TIMEDOUT=(); SKIPPED=()

# ---------------------------------------------------------------------------
# THE SUITE TABLE.  section|name|dir|timeout_s|script|args...
#
# section: mock  needs the shared mock gateways on 8085/8086/8087
#          solo  needs only the dev server on 8083 (or nothing at all)
#          gw    gateway/test/** — needs aCis :2106/:7777 and MariaDB
#          live  browser suites against the REAL stack (gateway :8090 + aCis)
#
# The timeout column is a CEILING, not an expectation: pick roughly 3x the
# observed runtime so load spikes do not manufacture failures.
# ---------------------------------------------------------------------------
SUITES=(
# --- client, shared mocks --------------------------------------------------
"mock|verify_ui|editor/world|240|verify_ui.js"
"mock|verify_statuswnd|editor/world|240|verify_statuswnd.js"
"mock|verify_detailstatuswnd|editor/world|300|verify_detailstatuswnd.js"
"mock|verify_skillwnd|editor/world|300|verify_skillwnd.js"
"mock|verify_shortcutwnd|editor/world|300|verify_shortcutwnd.js"
"mock|verify_inventorywnd|editor/world|300|verify_inventorywnd.js"
"mock|verify_chatwnd|editor/world|300|verify_chatwnd.js"
"mock|verify_nameplates|editor/world|300|verify_nameplates.js|--check"
"mock|verify_dropmesh|editor/world|300|verify_dropmesh.js|--check"
"mock|verify_dialog|editor/world|300|verify_dialog.js"
"mock|verify_actionwnd|editor/world|300|verify_actionwnd.js"
"mock|verify_minimap|editor/world|300|verify_minimap.js"
"mock|verify_remoteanim|editor/world|420|verify_remoteanim.js"
"mock|verify_questwnd|editor/world|300|verify_questwnd.js"
"mock|verify_partywnd|editor/world|300|verify_partywnd.js"
"mock|verify_abnormal|editor/world|360|verify_abnormal.js"
"mock|verify_combat|editor/world|360|verify_combat.js"
"mock|verify_skills|editor/world|300|verify_skills.js"
"mock|verify_skillanim|editor/world|360|verify_skillanim.js"
"mock|verify_skilldepth|editor/world|360|verify_skilldepth.js"
"mock|verify_skillvfx|editor/world|300|verify_skillvfx.js"
"mock|verify_skillphase|editor/world|360|verify_skillphase.js|--check --browser"
"mock|verify_clanwnd|editor/world|300|verify_clanwnd.js"
"mock|verify_shopwnd|editor/world|300|verify_shopwnd.js"
"mock|verify_storewnd|editor/world|300|verify_storewnd.js"
"mock|verify_tradewnd|editor/world|360|verify_tradewnd.js"
"mock|verify_warehousewnd|editor/world|300|verify_warehousewnd.js"
"mock|verify_multisellwnd|editor/world|300|verify_multisellwnd.js"
"mock|verify_civilians|editor/world|300|verify_civilians.js"
"mock|verify_atktiming|editor/world|300|verify_atktiming.js"
"mock|verify_movespeed|editor/world|300|verify_movespeed.js"
"mock|verify_online|editor/world|300|verify_online.js"
"mock|verify_m5|editor/world|360|verify_m5.js"
"mock|verify_charcreate|editor/world|360|verify_charcreate.js"
"mock|verify_charsel|editor/world|360|verify_charsel.js"
"mock|verify_selfmodel|editor/world|360|verify_selfmodel.js"
# verify_targetwnd leases its own ephemeral ports (it needs a second mock with
# MOCK_LEVEL=40). Independent of the shared three; runnable standalone.
"mock|verify_targetwnd|editor/world|420|verify_targetwnd.js"
# Both drive ?ws=ws://127.0.0.1:8085 — they were in the `solo` section, which
# runs AFTER stop_mocks, so #online-toggle connected to nothing and both died
# on a 20 s / 240 s entity wait that read like a scale regression (2026-08-08).
"mock|verify_scale|editor/world|420|verify_scale.js"
"mock|verify_scale2|editor/world|600|verify_scale2.js"
# Pure data/replay audit under --check (0 s, no browser), but it carries a
# BASE of ?ws=...:8085 for its --shots / --live modes, so it lives in the
# section where that port is up.
"mock|verify_emotes|editor/world|300|verify_emotes.js|--check"

# --- client, no gateway ----------------------------------------------------
# Static gate, no browser and no server: audits every `live` row in THIS file
# for a stable login identity. Nine live suites had none on 2026-08-09 — each
# headless run minted a random deviceId, landed on a brand-new EMPTY account
# (auth_ok{chars:[]}), opened character creation and then blew a 120 s wait
# for an enterWorld that could never arrive. Twelve red rows, nine of them
# this one harness defect. Keep this row FIRST in `solo`: it is 0.1 s and it
# tells you the live section is worth running at all.
"solo|verify_livefixture|editor/world|60|live_fixture.js|--check"
# Pure-node data audits: no browser, no server. --check is REQUIRED on these
# three — without it they print a report and exit 0 no matter what they found.
"solo|verify_text|editor/world|120|verify_text.js|--check"
"solo|verify_npcdialog|editor/world|180|verify_npcdialog.js|--check"
"solo|verify_audio_coverage|editor/world|120|verify_audio_coverage.js|--check"
"solo|verify_creature_anims|editor/world|180|verify_creature_anims.js|--check"
"solo|verify_anim|editor/world|420|verify_anim.js|--check"
# Pure-data + source-text suite (no browser, no server): the skill-cast clip
# table out of lineagewarrior.int, the .ukx phase keyframes, and the live-aCis
# cast-timing capture.
"solo|verify_castanim|editor/world|120|verify_castanim.js|--check"
"solo|verify_skillclass|editor/world|120|verify_skillclass.js|--check"
"solo|verify_steps|editor/world|300|verify_steps.js|--check"
# Browser suites against the dev server only.
"solo|verify_app|editor/world|300|verify_app.js"
"solo|verify_armor|editor/world|300|verify_armor.js|--check"
"solo|verify_audio|editor/world|300|verify_audio.js"
"solo|verify_bsp|editor/world|600|verify_bsp.js"
"solo|verify_camera|editor/world|900|verify_camera.js"
"solo|verify_equipment|editor/world|300|verify_equipment.js"
"solo|verify_shield|editor/world|300|verify_shield.js|--check"
"solo|verify_feet|editor/world|1500|verify_feet.js|--check"
"solo|verify_geodata|editor/world|600|verify_geodata.js"
"solo|verify_ground|editor/world|1800|verify_ground.js"
"solo|verify_interior|editor/world|420|verify_interior.js"
"solo|verify_neighbors|editor/world|1800|verify_neighbors.js"
# MEASURED 2026-08-09: 13 min standalone, and it buffers EVERYTHING into one
# console.log at the end — so for 13 minutes it sits at 0.0% CPU with an
# empty log, which is indistinguishable from a deadlock. It is not hung.
"solo|verify_pathfinding|editor/world|2400|verify_pathfinding.js"
"solo|verify_pavement|editor/world|420|verify_pavement.js"
"solo|verify_props|editor/world|420|verify_props.js|--check"
"solo|verify_resilience|editor/world|300|verify_resilience.js"
"solo|verify_shadercount|editor/world|420|verify_shadercount.js|--check"
"solo|verify_terrain|editor/world|420|verify_terrain.js"
"solo|verify_torches|editor/world|360|verify_torches.js"
"solo|verify_uigeom_wnd|editor/world|300|verify_uigeom_wnd.js"
"solo|verify_walkfall|editor/world|900|verify_walkfall.js"
"solo|verify_walksurface|editor/world|900|verify_walksurface.js|--check"
"solo|verify_water|editor/world|360|verify_water.js"
# Landed 2026-08-09 by a concurrent agent, mid-battery, so it was NOT in the
# sweep this table's results came from. Browser suite, dev server only (no
# mock, no gateway) -> solo. It exits nonzero on its own; no --check needed.
# TIMEOUT IS PROVISIONAL: not measured by the author of this row. It renders
# 3 tiles twice each (?lm=off vs on); verify_bsp does one pass in 129 s, so
# 900 is a ceiling to be tightened once a real runtime is recorded.
"solo|verify_bsplight|editor/world|900|verify_bsplight.js"
# Landed 2026-08-08 by a concurrent agent; --check is REQUIRED (see above).
"solo|verify_sky|editor/world|300|verify_sky.js|--check"
# Item tooltips. SOLO, not mock: it leases an ephemeral port from the OS and
# spawns its own mock_gateway, so it never touches 8085-8087 and is runnable
# while a battery holds them (the fix verify_targetwnd got, applied from the
# start). --selftest, not --check: it does everything --check does AND then
# injects a reordered draw list and a missing grade symbol and REQUIRES the
# gates to go red, so a green row here means the gates can still fail.
# --check rides along because gate (d) below requires it whenever a
# suite's failure exit mentions it; both flags set the same exit path.
# Measured 2026-08-09: 17 s wall.
"solo|verify_tooltip|editor/world|300|verify_tooltip.js|--check --selftest"

# --- gateway/test, real aCis ----------------------------------------------
"gw|verify-one|gateway|300|test/verify-one.js"
"gw|verify-two|gateway|300|test/verify-two.js"
# NOT gateway/test/ — this one lives under editor/world/test/ and speaks L2
# directly (it deliberately bypasses the JSON bridge to read MoveToLocation's
# cx,cy,cz, which the bridge drops).
"gw|verify-move|editor/world|300|test/verify-move.js"
"gw|verify-movement|gateway|600|test/verify-movement.js|--check"
"gw|verify-m4|gateway|600|test/verify-m4.js"
"gw|verify-m5|gateway|420|test/verify-m5.js"
"gw|verify-combat|gateway|600|test/verify-combat.js"
"gw|verify-observer|gateway|600|test/verify-observer.js"
"gw|verify-mods|gateway|420|test/verify-mods.js"
"gw|verify-level|gateway|420|test/verify-level.js"
"gw|verify-dialog|gateway|420|test/verify-dialog.js"
"gw|verify-action|gateway|420|test/verify-action.js"
"gw|verify-party|gateway|600|test/verify-party.js"
"gw|verify-quest|gateway|900|test/verify-quest.js"
"gw|verify-buffs|gateway|600|test/verify-buffs.js"
"gw|verify-shop|gateway|900|test/verify-shop.js"
"gw|verify-multisell|gateway|900|test/verify-multisell.js"
"gw|verify-trade|gateway|600|test/verify-trade.js"
"gw|verify-store|gateway|900|test/verify-store.js"
"gw|verify-clan|gateway|900|test/verify-clan.js"
"gw|verify-warehouse|gateway|900|test/verify-warehouse.js"
"gw|verify-create|gateway|420|test/verify-create.js"
"gw|verify-tutorial|gateway|600|test/verify-tutorial.js"
"gw|verify-shots|gateway|900|test/verify-shots.js"
"gw|verify-paperdoll|gateway|600|test/verify-paperdoll.js"
"gw|verify-atkspeed|gateway|600|test/verify-atkspeed.js"
"gw|verify-charinfo-atk|gateway|600|test/verify-charinfo-atk.js"
"gw|verify-respawn|gateway|420|test/verify-respawn.js"
"gw|smoke-protocol|gateway|300|test/smoke-protocol.js"

# --- browser against the REAL stack ---------------------------------------
# Registered 2026-08-09 (was the last UNCLASSIFIED suite on disk). It is in
# `live`, not `mock`, for a hard reason: it SPAWNS ITS OWN mock on 8087 and
# refuses to run if that port is already bound ("refusing to talk to someone
# else's mock", verify_ghostnpc.js:213). The shared mocks hold 8087 for the
# whole mock section, so it can only run after stop_mocks. Its live half also
# needs the real gateway. --check is REQUIRED: verify_ghostnpc.js:362 gates
# its nonzero exit on it. MEASURED standalone 2026-08-09: 86 s.
"live|verify_ghostnpc|editor/world|300|verify_ghostnpc.js|--check"
"live|verify_live|editor/world|900|verify_live.js"
"live|verify_equipswap|editor/world|600|verify_equipswap.js"
"live|verify_soulshot|editor/world|900|verify_soulshot.js|--check"
"live|verify_abnormal_live|editor/world|900|verify_abnormal_live.js"
"live|verify_actionwnd_live|editor/world|600|verify_actionwnd_live.js"
"live|verify_clanwnd_live|editor/world|900|verify_clanwnd_live.js"
"live|verify_invchatwnd_live|editor/world|600|verify_invchatwnd_live.js|--check"
"live|verify_minimap_live|editor/world|600|verify_minimap_live.js"
"live|verify_multisellwnd_live|editor/world|900|verify_multisellwnd_live.js"
"live|verify_partywnd_live|editor/world|900|verify_partywnd_live.js"
"live|verify_questwnd_live|editor/world|600|verify_questwnd_live.js"
"live|verify_selfmodel_live|editor/world|900|verify_selfmodel_live.js"
"live|verify_shopwnd_live|editor/world|900|verify_shopwnd_live.js"
"live|verify_skilldepth_live|editor/world|900|verify_skilldepth_live.js"
"live|verify_storewnd_live|editor/world|900|verify_storewnd_live.js"
"live|verify_tradewnd_live|editor/world|900|verify_tradewnd_live.js"
"live|verify_warehousewnd_live|editor/world|900|verify_warehousewnd_live.js"
)

# ---------------------------------------------------------------------------
# Suites deliberately NOT in the table, with the reason. Anything absent from
# BOTH lists is an accident; `--list` prints the diff so it cannot hide.
# ---------------------------------------------------------------------------
EXCLUDED=(
"verify_loadprofile|instrument, not a suite: prints a timing profile, no PASS/FAIL of its own. Results + method: docs/load-profile.md; ~35 min per run"
"verify_hd_closeup|A/B screenshot generator for the HD-texture pilot; needs WORLD_BASE=?hd=1 and a human eye"
"verify_skillcast|needs a SECOND gateway on :8096 (GATEWAY_PORT=8096 node gateway/src/server.js); no auto-spawn yet"
)

# ---------------------------------------------------------------------------
# Watchdog runner. Returns 0 pass, 1 fail, 124 timeout.
# ---------------------------------------------------------------------------
run_once() { # dir timeout log script args...
  local dir="$1" limit="$2" log="$3"; shift 3
  case "$dir" in /*) ;; *) dir="$ROOT/$dir" ;; esac
  ( cd "$dir" && exec node "$@" ) >"$log" 2>&1 &
  local pid=$! ticks=0 max=$(( limit * 4 ))
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$ticks" -ge "$max" ]; then
      # disown first: otherwise bash prints its own "Terminated: 15" job notice
      # into the middle of the results table.
      disown "$pid" 2>/dev/null
      kill -TERM "$pid" 2>/dev/null
      sleep 2
      kill -KILL "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      # A puppeteer suite killed mid-flight orphans its headless Chrome, which
      # then holds GPU/CPU and skews every suite after it. Suites run serially,
      # so reaping every headless Chrome here is safe.
      pkill -f 'Google Chrome.*--headless' 2>/dev/null
      # The banner goes in ONLY NOW, after the process is reaped. Appending it
      # while the suite was still alive lost it: the dying process still held
      # its own fd with its own offset, and its last write landed on top of the
      # appended bytes. Observed 2026-08-08 on verify_camera — the log came out
      # 66 bytes long with no KILLED line at all.
      echo "" >>"$log"
      echo "battery: KILLED after ${limit}s — this suite exceeded its deadline." >>"$log"
      return 124
    fi
    sleep 0.25
    ticks=$(( ticks + 1 ))
  done
  wait "$pid"
  return $?
}

run() { # section name dir timeout script args...
  local name="$1" dir="$2" limit="${BATTERY_TIMEOUT:-$3}"; shift 3
  local log="$LOGDIR/$name.log" t0 t1 rc
  t0=$(date +%s)
  run_once "$dir" "$limit" "$log" "$@"; rc=$?
  t1=$(date +%s)
  if [ "$rc" -eq 0 ]; then
    printf 'PASS  %-26s %4ss\n' "$name" "$((t1-t0))"; PASS=$((PASS+1)); return
  fi
  if [ "$rc" -eq 124 ]; then
    printf 'FAIL  %-26s %4ss  TIMEOUT (>%ss)  %s\n' "$name" "$((t1-t0))" "$limit" "$log"
    FAIL=$((FAIL+1)); FAILED+=("$name"); TIMEDOUT+=("$name"); return
  fi
  # One retry to absorb timing flakes under load — marked PASS* so a suite that
  # only ever passes on the second attempt stays visibly distinct from a solid
  # one. Never retried on TIMEOUT (above): retrying a hang just doubles it.
  mv "$log" "$LOGDIR/$name.attempt1.log" 2>/dev/null
  run_once "$dir" "$limit" "$log" "$@"; rc=$?
  t1=$(date +%s)
  if [ "$rc" -eq 0 ]; then
    printf 'PASS* %-26s %4ss  (needed a retry; first attempt: %s)\n' \
      "$name" "$((t1-t0))" "$LOGDIR/$name.attempt1.log"
    PASS=$((PASS+1)); RETRIED+=("$name")
  elif [ "$rc" -eq 124 ]; then
    printf 'FAIL  %-26s %4ss  TIMEOUT on retry (>%ss)  %s\n' "$name" "$((t1-t0))" "$limit" "$log"
    FAIL=$((FAIL+1)); FAILED+=("$name"); TIMEDOUT+=("$name")
  else
    printf 'FAIL  %-26s %4ss  exit %s  %s\n' "$name" "$((t1-t0))" "$rc" "$log"
    FAIL=$((FAIL+1)); FAILED+=("$name")
  fi
}

# Wait for a TCP port to accept a connection. `sleep 2` was a guess; a mock
# that failed to bind (EADDRINUSE from a previous run's survivor) used to be
# silent. mock_gateway.js now exits 98 on EADDRINUSE and only prints its
# "mock gateway on ws://..." line from the 'listening' event, so a bind failure
# is loud in $LOGDIR/mock_<port>.log as well as here.
wait_port() { # port timeout_s
  local port="$1" deadline=$(( $(date +%s) + ${2:-15} ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if nc -z 127.0.0.1 "$port" 2>/dev/null; then return 0; fi
    sleep 0.2
  done
  echo "battery: mock never came up on :$port  (see $LOGDIR/mock_$port.log)" >&2
  return 1
}

spawn_mock() { # port(optional) logfile
  local port="$1" log="$2"
  bash -c "cd '$ROOT/editor/world' && exec node mock_gateway.js $port > '$log' 2>&1" &
  disown 2>/dev/null
}

# THE MOCKS CAN DIE UNDER A RUNNING BATTERY, and until 2026-08-08 nothing
# noticed. Check before every mock-section suite, restart what is genuinely
# gone, and say so LOUDLY so the row below the message is read as suspect
# rather than as evidence.
#
# BUT A SINGLE FAILED `nc -z` IS NOT PROOF A MOCK DIED. Measured 2026-08-09,
# mid-battery: this function announced "the mock on :8085 DIED mid-run" and
# respawned it — and the respawn exited 98 with "port 8085 is already in use",
# which PROVES the original was listening the whole time. `ps` confirmed it:
# all three mock PIDs still carried the battery's own start time and had never
# been restarted, and the suite that ran under the warning (verify_shortcutwnd)
# passed. So the probe was at fault, not the mock.
#
# That matters twice over: a false "the mock died" banner tells the operator to
# distrust a row that was fine — the same damage as a wrong result — and the
# 2026-08-08 note above it (that "something outside this script" killed the
# 8086/8087 mocks) was most likely this same misfire, since no process was ever
# shown to have exited.
#
# So: retry the probe before believing it, and check for the PROCESS before
# restarting anything. A live process with a slow accept gets a quiet,
# non-alarming note instead of the banner.
mock_proc_alive() { # port — matches the exact command spawn_mock used
  if [ "$1" = 8085 ]; then pgrep -f 'mock_gateway\.js$' >/dev/null 2>&1
  else                     pgrep -f "mock_gateway\.js $1\$" >/dev/null 2>&1; fi
}
mock_port_answers() { # port — 3 tries; one refused connect is not death
  local port="$1" i
  for i in 1 2 3; do
    nc -z 127.0.0.1 "$port" 2>/dev/null && return 0
    sleep 0.3
  done
  return 1
}
check_mocks() {
  local port restarted=0
  for port in 8085 8086 8087; do
    mock_port_answers "$port" && continue
    if mock_proc_alive "$port"; then
      echo "battery: note — the mock on :$port did not answer 3 probes but its" >&2
      echo "battery: process is alive; NOT restarting (a restart would only" >&2
      echo "battery: collide and exit 98). Read this as a slow accept, not a" >&2
      echo "battery: dead mock, and not as a reason to doubt the row below." >&2
      continue
    fi
    echo "battery: !! the mock on :$port is GONE — no listener AND no process." >&2
    echo "battery: !! Restarting it. The suite that ran immediately before this" >&2
    echo "battery: !! line may have failed for that reason and not for its own." >&2
    if [ "$port" = 8085 ]; then spawn_mock ""     "$LOGDIR/mock_8085.restart.log"
    else                        spawn_mock "$port" "$LOGDIR/mock_$port.restart.log"; fi
    restarted=1
  done
  disown -a 2>/dev/null
  [ "$restarted" -eq 1 ] && { wait_port 8085 || true; wait_port 8086 || true; wait_port 8087 || true; }
  return 0
}

# ---------------------------------------------------------------------------
# --list / --selftest
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--list" ]; then
  printf '%-6s %-30s %5s  %s\n' SECTION SUITE LIMIT SCRIPT
  for row in "${SUITES[@]}"; do
    IFS='|' read -r sec name dir lim script rest <<<"$row"
    printf '%-6s %-30s %5s  %s/%s %s\n' "$sec" "$name" "$lim" "$dir" "$script" "${rest:-}"
  done
  echo
  echo "EXCLUDED (deliberate):"
  for row in "${EXCLUDED[@]}"; do
    IFS='|' read -r name why <<<"$row"
    printf '  %-30s %s\n' "$name" "$why"
  done
  echo
  # Both directions, because each has bitten. (a) A row can point at a script
  # that does not exist — `gateway/test/verify-move.js` did; the file is under
  # editor/world/test/ — and a missing file only shows up as a MODULE_NOT_FOUND
  # FAIL an hour into a sweep. (b) Anything on disk that is in neither list is
  # an ACCIDENT, which is how 57 suites went unrun.
  missing=0
  for row in "${SUITES[@]}"; do
    IFS='|' read -r sec name dir lim script rest <<<"$row"
    [ -f "$dir/$script" ] || { echo "MISSING SCRIPT: $name -> $dir/$script"; missing=$((missing+1)); }
    # (c) A suite that opens ws://127.0.0.1:808{5,6,7} must be in the `mock`
    # section — the mocks are stopped before `solo` runs. verify_scale and
    # verify_scale2 were in `solo` and failed on entity waits that read like a
    # product regression until the URL was looked at (2026-08-08).
    if [ "$sec" != "mock" ] && grep -qE "ws://127\.0\.0\.1:808[567]" "$dir/$script" 2>/dev/null; then
      echo "WRONG SECTION: $name is '$sec' but connects to a mock port"; missing=$((missing+1))
    fi
    # (d) A suite whose failure path is gated on --check must be given --check,
    # or it reports and exits 0 forever. Six were (2026-08-08).
    case "$rest" in *--check*) ;; *)
      if grep -qE "includes\('--check'\)|includes\(\"--check\"\)" "$dir/$script" 2>/dev/null; then
        echo "NEEDS --check: $name ($dir/$script gates its failure exit on it)"
        missing=$((missing+1))
      fi ;;
    esac
  done
  for f in editor/world/verify_*.js editor/world/test/verify-*.js; do
    b=$(basename "$f" .js)
    printf '%s\n' "${SUITES[@]}" | grep -q "|$b|" && continue
    printf '%s\n' "${EXCLUDED[@]}" | grep -q "^$b|" && continue
    echo "UNCLASSIFIED: $f"; missing=$((missing+1))
  done
  for f in gateway/test/verify-*.js; do
    b=$(basename "$f" .js)
    printf '%s\n' "${SUITES[@]}" | grep -q "|$b|" && continue
    printf '%s\n' "${EXCLUDED[@]}" | grep -q "^$b|" && continue
    echo "UNCLASSIFIED: $f"; missing=$((missing+1))
  done
  echo "suites in table: ${#SUITES[@]}   unclassified: $missing"
  [ "$missing" -eq 0 ]
  exit $?
fi

if [ "${1:-}" = "--selftest" ]; then
  # Proves the two things that made the last sweep worthless. Must FAIL on a
  # tree without the watchdog / without mock_gateway's 'error' handler.
  mkdir -p "$LOGDIR"
  bad=0
  echo "selftest 1: a hanging suite must be KILLED and reported, not stall the run"
  cat >"$LOGDIR/_hang.js" <<'EOF'
setInterval(() => {}, 1 << 30);   // never exits, never uses CPU
EOF
  t0=$(date +%s)
  run_once "$LOGDIR" 5 "$LOGDIR/_hang.log" "_hang.js"; rc=$?
  t1=$(date +%s); el=$((t1-t0))
  if [ "$rc" -eq 124 ] && [ "$el" -lt 20 ]; then
    echo "  ok: killed after ${el}s, rc=124"
  else
    echo "  FAIL: rc=$rc after ${el}s (expected rc=124 in <20s)"; bad=1
  fi
  grep -q 'KILLED after 5s' "$LOGDIR/_hang.log" \
    && echo "  ok: reason recorded in the suite log" \
    || { echo "  FAIL: no KILLED line in $LOGDIR/_hang.log"; bad=1; }

  echo "selftest 2: a port collision must be LOUD (mock_gateway 'error' handler)"
  (cd "$ROOT/editor/world" && node mock_gateway.js 8198 >"$LOGDIR/_st_mock.log" 2>&1 &)
  wait_port 8198 10 || { echo "  FAIL: first mock never bound"; bad=1; }
  (cd "$ROOT/editor/world" && node mock_gateway.js 8198 >"$LOGDIR/_st_collide.log" 2>&1); rc=$?
  pkill -f 'mock_gateway.js 8198' 2>/dev/null
  if [ "$rc" -eq 98 ]; then echo "  ok: second mock exited 98"; else
    echo "  FAIL: second mock exited $rc (expected 98)"; bad=1; fi
  grep -q 'already in use' "$LOGDIR/_st_collide.log" \
    && echo "  ok: EADDRINUSE diagnosed in the log" \
    || { echo "  FAIL: no diagnosis in $LOGDIR/_st_collide.log"; bad=1; }
  # The pre-fix mock printed its "mock gateway on ws://..." banner BEFORE the
  # bind failed, so a caller that watched stdout believed it had started.
  grep -q 'mock gateway on ws' "$LOGDIR/_st_collide.log" \
    && { echo "  FAIL: the collided mock still announced itself as listening"; bad=1; } \
    || echo "  ok: no false 'listening' banner"

  echo "selftest 4: a LIVE mock must never be reported as dead"
  # Guards the 2026-08-09 false alarm: check_mocks announced "the mock on
  # :8085 DIED", respawned it, and the respawn exited 98 because the original
  # was listening all along. FAILS on the pre-fix tree only if the probe
  # misfires, which is racy to force -- so this asserts the invariant that
  # makes the misfire harmless: a mock whose PROCESS is alive is never
  # restarted, and mock_proc_alive must actually see it.
  pkill -9 -f mock_gateway.js 2>/dev/null; sleep 0.5
  spawn_mock ""   "$LOGDIR/_st4_8085.log"
  spawn_mock 8086 "$LOGDIR/_st4_8086.log"
  spawn_mock 8087 "$LOGDIR/_st4_8087.log"
  disown -a 2>/dev/null
  wait_port 8085 10 && wait_port 8086 10 && wait_port 8087 10 || {
    echo "  FAIL: could not bring the three mocks up"; bad=1; }
  for port in 8085 8086 8087; do
    mock_proc_alive "$port" \
      && echo "  ok: mock_proc_alive sees the :$port process" \
      || { echo "  FAIL: mock_proc_alive missed the live :$port process — a" \
                "slow probe would now trigger a bogus restart"; bad=1; }
  done
  st4=$(check_mocks 2>&1)
  if printf '%s' "$st4" | grep -q 'GONE\|DIED'; then
    echo "  FAIL: check_mocks called a live mock dead:"; printf '    %s\n' "$st4"; bad=1
  else
    echo "  ok: check_mocks left three healthy mocks alone (no restart, no banner)"
  fi
  pkill -9 -f mock_gateway.js 2>/dev/null

  echo "selftest 3: the suite table covers everything on disk"
  "$0" --list >"$LOGDIR/_list.log" 2>&1 \
    && echo "  ok: no unclassified suites" \
    || { echo "  FAIL: see $LOGDIR/_list.log"; grep UNCLASSIFIED "$LOGDIR/_list.log"; bad=1; }

  [ "$bad" -eq 0 ] && echo "selftest: PASS" || echo "selftest: FAIL"
  exit "$bad"
fi

MODE="${1:-all}"
case "$MODE" in
  all|--all)       SECTIONS="mock solo gw live" ;;
  --client-only)   SECTIONS="mock solo" ;;
  --mock-only)     SECTIONS="mock" ;;
  --solo-only)     SECTIONS="solo" ;;
  --gateway-only)  SECTIONS="gw" ;;
  --live-only)     SECTIONS="live" ;;
  --no-live)       SECTIONS="mock solo gw" ;;
  *) echo "battery: unknown mode '$MODE' (see the header for the list)" >&2; exit 2 ;;
esac

rm -rf "$LOGDIR"; mkdir -p "$LOGDIR"
echo "battery: sections [$SECTIONS]  logs -> $LOGDIR"
echo "started: $(date '+%Y-%m-%d %H:%M:%S')"
echo "---"

wants() { case " $SECTIONS " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
selected() { # name
  [ -z "$ONLY" ] && return 0
  case " $ONLY " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}


MOCKS_UP=0
start_mocks() {
  [ "$MOCKS_UP" -eq 1 ] && return 0
  # Kill survivors from an interrupted run BEFORE binding, or the fresh mocks
  # lose the race — and now die with exit 98 instead of pretending to work.
  pkill -f mock_gateway.js 2>/dev/null; sleep 0.5
  # Launched through a THROWAWAY bash so the mocks are grandchildren, not jobs
  # of this shell. `( ... & )` and `disown -a` both failed to stop bash 3.2
  # printing its own "Terminated: 15" / "Killed: 9" job notices into the middle
  # of the results table when stop_mocks killed them; a process this shell never
  # owned cannot be announced.
  spawn_mock ""     "$LOGDIR/mock_8085.log"
  # verify_charcreate keeps cc ENABLED (it tests the creation flow itself) and
  # drives its own mock on 8086 so it coexists with the 8085 one
  spawn_mock 8086 "$LOGDIR/mock_8086.log"
  # verify_charsel (multi-char accounts) and verify_selfmodel drive 8087
  spawn_mock 8087 "$LOGDIR/mock_8087.log"
  disown -a 2>/dev/null
  wait_port 8085 || exit 1
  wait_port 8086 || exit 1
  wait_port 8087 || exit 1
  MOCKS_UP=1
}
stop_mocks() {
  # SIGTERM makes bash announce "Terminated: 15" for every process it is still
  # tracking, straight into the middle of the results table, and neither
  # `( ... & )` nor `disown -a` suppressed it on bash 3.2. SIGKILL is not
  # announced, and a mock has no state worth flushing.
  pkill -9 -f mock_gateway.js 2>/dev/null
  MOCKS_UP=0
}


# Preflight: name what is missing instead of letting 29 gateway suites all fail
# with the same unreadable ECONNREFUSED.
preflight() { # port label
  nc -z 127.0.0.1 "$1" 2>/dev/null && return 0
  echo "battery: PREREQUISITE DOWN — $2 (127.0.0.1:$1) is not listening." >&2
  return 1
}
preflight 8083 "world dev server" || exit 1
if wants gw || wants live; then
  preflight 8090 "gateway" || echo "battery: gw/live suites will fail" >&2
  preflight 7777 "aCis game server" || echo "battery: gw/live suites will fail" >&2
fi

for sec in mock solo gw live; do
  wants "$sec" || continue
  [ "$sec" = "mock" ] && start_mocks
  header=0
  for row in "${SUITES[@]}"; do
    IFS='|' read -r rsec name dir lim script a1 a2 <<<"$row"
    [ "$rsec" = "$sec" ] || continue
    if ! selected "$name"; then SKIP=$((SKIP+1)); SKIPPED+=("$name"); continue; fi
    if [ "$header" -eq 0 ]; then echo "== $sec =="; header=1; fi
    [ "$sec" = "mock" ] && check_mocks
    if [ -n "${a2:-}" ]; then run "$name" "$dir" "$lim" "$script" "$a1" "$a2"
    elif [ -n "${a1:-}" ]; then run "$name" "$dir" "$lim" "$script" "$a1"
    else run "$name" "$dir" "$lim" "$script"; fi
  done
  [ "$sec" = "mock" ] && stop_mocks
done

echo "---"
echo "finished: $(date '+%Y-%m-%d %H:%M:%S')"
echo "battery: $PASS passed, $FAIL failed$([ "$SKIP" -gt 0 ] && echo ", $SKIP skipped")"
if [ "${#RETRIED[@]}" -gt 0 ]; then
  echo "retried: ${RETRIED[*]}  (passed only on the second attempt — treat as flaky)"
fi
if [ "${#TIMEDOUT[@]}" -gt 0 ]; then
  echo "timeout: ${TIMEDOUT[*]}  (HUNG — killed at the deadline, not a normal failure)"
fi
if [ "$FAIL" -gt 0 ]; then
  echo "failed:  ${FAILED[*]}"
  echo "logs:    $LOGDIR"
fi
[ "$FAIL" -eq 0 ]
