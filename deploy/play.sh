#!/bin/bash
# play.sh — one-command bring-up of the Elbera browser stack.
#
#   deploy/play.sh           start everything locally, print a status table
#   deploy/play.sh --tunnel  same + Cloudflare quick tunnel, print the public link
#   deploy/play.sh --stop    stop tunnel + edge proxy only (game servers keep running)
#
# Idempotent: anything already listening on its port is left running.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export PATH="$JAVA_HOME/bin:$PATH"

GATEWAY_LOG="$ROOT/gateway/gateway.log"
CLIENT_LOG="$ROOT/editor/world/world.log"
EDGE_LOG="$ROOT/deploy/edge/edge.log"
TUNNEL_LOG="$ROOT/deploy/edge/tunnel.log"
EDGE_PIDFILE="$ROOT/deploy/edge/edge.pid"
TUNNEL_PIDFILE="$ROOT/deploy/edge/tunnel.pid"

usage() {
  sed -n '2,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

port_listening() { # port
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_port() { # port label timeout_seconds — warns, never fails
  local port="$1" label="$2" limit="$3" waited=0
  while (( waited < limit )); do
    if port_listening "$port"; then
      echo "$label: listening on $port"
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
  done
  echo "WARNING: $label not listening on $port after ${limit}s — check its log" >&2
  return 1
}

start_loginserver() {
  if port_listening 2106; then echo "loginserver  : already listening on 2106 — skipping"; return; fi
  echo "loginserver  : starting (log: dist/login/log/stdout.log)"
  (cd "$ROOT/server/aCis_gameserver/build/dist/login" && nohup ./startLoginServer.sh >/dev/null 2>&1 &)
}

start_gameserver() {
  if port_listening 7777; then echo "gameserver   : already listening on 7777 — skipping"; return; fi
  echo "gameserver   : starting (log: dist/gameserver/log/stdout.log)"
  (cd "$ROOT/server/aCis_gameserver/build/dist/gameserver" && nohup ./startGameServer.sh >/dev/null 2>&1 &)
}

start_gateway() {
  if port_listening 8090; then echo "gateway      : already listening on 8090 — skipping"; return; fi
  echo "gateway      : starting (log: gateway/gateway.log)"
  (cd "$ROOT/gateway" && nohup npm start >>"$GATEWAY_LOG" 2>&1 &)
}

start_client() {
  if port_listening 8083; then echo "client       : already listening on 8083 — skipping"; return; fi
  echo "client       : starting (log: editor/world/world.log)"
  (cd "$ROOT" && nohup python3 editor/world/server.py >>"$CLIENT_LOG" 2>&1 &)
}

start_edge() {
  if port_listening 8095; then echo "edge         : already listening on 8095 — skipping"; return; fi
  echo "edge         : starting (log: deploy/edge/edge.log)"
  (cd "$ROOT/deploy/edge" && nohup node server.js >>"$EDGE_LOG" 2>&1 & echo $! >"$EDGE_PIDFILE")
}

tunnel_running() {
  [[ -f "$TUNNEL_PIDFILE" ]] && kill -0 "$(cat "$TUNNEL_PIDFILE")" 2>/dev/null
}

start_tunnel() {
  if tunnel_running; then echo "tunnel       : already running (pid $(cat "$TUNNEL_PIDFILE")) — skipping"; return; fi
  if pgrep -f "cloudflared tunnel --url" >/dev/null 2>&1; then
    echo "tunnel       : a cloudflared quick tunnel is already running — skipping"
    return
  fi
  echo "tunnel       : starting cloudflared quick tunnel (log: deploy/edge/tunnel.log)"
  : >"$TUNNEL_LOG"
  # --protocol http2: the default QUIC transport dies seconds after
  # registration on some home networks ("control stream encountered a
  # failure while serving" in a retry loop); http2 is the stable fallback.
  (nohup cloudflared tunnel --protocol http2 --url http://127.0.0.1:8095 >>"$TUNNEL_LOG" 2>&1 & echo $! >"$TUNNEL_PIDFILE")
}

tunnel_url() {
  grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true
}

wait_tunnel_url() { # poll the tunnel log up to 60s for the public URL
  local waited=0 url
  while (( waited < 60 )); do
    url="$(tunnel_url)"
    if [[ -n "$url" ]]; then printf '%s' "$url"; return 0; fi
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

stop_edge_and_tunnel() {
  if tunnel_running; then
    kill "$(cat "$TUNNEL_PIDFILE")" && rm -f "$TUNNEL_PIDFILE"
    echo "tunnel       : stopped"
  else
    echo "tunnel       : not running (no pid file) — nothing to stop"
  fi
  if [[ -f "$EDGE_PIDFILE" ]] && kill -0 "$(cat "$EDGE_PIDFILE")" 2>/dev/null; then
    kill "$(cat "$EDGE_PIDFILE")" && rm -f "$EDGE_PIDFILE"
    echo "edge         : stopped"
  else
    echo "edge         : not started by this script — leaving it alone"
  fi
  echo "loginserver, gameserver, gateway and client left running."
}

print_status() {
  local row name port state
  echo
  echo "=== Elbera stack status ==="
  printf '%-14s %-7s %s\n' SERVICE PORT STATE
  for row in MariaDB:3306 loginserver:2106 gameserver:7777 gateway:8090 client:8083 edge:8095; do
    name="${row%%:*}"; port="${row##*:}"
    if port_listening "$port"; then state=LISTENING; else state=down; fi
    printf '%-14s %-7s %s\n' "$name" "$port" "$state"
  done
  if tunnel_running; then printf '%-14s %-7s %s\n' tunnel - "running (pid $(cat "$TUNNEL_PIDFILE"))"; fi
}

main() {
  local tunnel=0 stop=0 arg
  for arg in "$@"; do
    case "$arg" in
      --tunnel)  tunnel=1 ;;
      --stop)    stop=1 ;;
      -h|--help) usage; exit 0 ;;
      *) echo "unknown flag: $arg" >&2; usage; exit 1 ;;
    esac
  done

  if (( stop )); then stop_edge_and_tunnel; exit 0; fi

  if port_listening 3306; then
    echo "mariadb      : already listening on 3306 — skipping"
  else
    echo "mariadb      : starting via brew services..."
    brew services start mariadb >/dev/null
  fi

  start_loginserver
  start_gameserver
  start_gateway
  start_client
  start_edge

  echo
  echo "Waiting for loginserver and gameserver (boot can take 1–3 min)..."
  wait_for_port 2106 loginserver 300 || true
  wait_for_port 7777 gameserver 300 || true
  wait_for_port 8090 gateway 30 || true
  wait_for_port 8083 client 15 || true
  wait_for_port 8095 edge 15 || true

  if (( tunnel )); then
    start_tunnel
    echo "Waiting for the public URL (up to 60s)..."
    local url
    url="$(wait_tunnel_url || true)"
    print_status
    if [[ -z "$url" ]]; then
      echo "ERROR: no trycloudflare URL in deploy/edge/tunnel.log within 60s — check the log" >&2
      exit 1
    fi
    cat <<EOF

================================================================
  THE LINK TO SEND FRIENDS:

      $url

  Anyone with this link can play — account and character are
  auto-created on first login (device-id identity, no password).
  Keep this Mac awake while they play:  caffeinate -dimsu
  Stop sharing with:                    deploy/play.sh --stop
================================================================
EOF
  else
    print_status
    echo
    echo "Local play:  http://127.0.0.1:8095  (edge) · http://127.0.0.1:8083 (client direct)"
    echo "Re-run with --tunnel for a public link to share with friends."
  fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
