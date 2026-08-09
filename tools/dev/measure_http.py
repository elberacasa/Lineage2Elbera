#!/usr/bin/env python3
"""measure_http.py -- what does the dev server's HTTP/1.0 actually cost?

WHY THIS EXISTS
---------------
`editor/world/server.py` is a `ThreadingHTTPServer` over
`BaseHTTPRequestHandler`, whose `protocol_version` defaults to **"HTTP/1.0"**.
Under HTTP/1.0 with no `Connection: keep-alive` in the reply, the server closes
the socket after every response, so **every asset costs a fresh TCP
connection**.  That is a real difference from production, and it has been used
as an explanation for slow cold loads without anyone measuring it.

This measures it, and nothing else.  It does NOT change the server.

WHAT IT MEASURES
----------------
  1. `protocol`   -- the reply's status line and whether the socket is closed
                     by the server after one response (proof, not assumption).
  2. `perRequest` -- the fixed cost of one request: connect + write + read
                     headers, for a body small enough that transfer time is
                     negligible.  Reported as a distribution, because the mean
                     of a bimodal latency is a lie.
  3. `throughput` -- bytes/second once a connection is up, from a large file.
  4. `verdict`    -- for a given (requests, bytes) workload, how much of the
                     wall time is connection overhead and how much is bytes.
                     The workload is supplied, not guessed: pass
                     `--requests N --bytes B` (Resource Timing totals from
                     verify_loadprofile.js), or use `--assets` to price the
                     REAL per-tile asset set by listing it off disk.

Localhost only.  A LAN or WAN client pays an RTT per connection on top; this
number is therefore a FLOOR for the overhead, never a ceiling.

Usage
-----
  python3 tools/dev/measure_http.py                       measure and report
  python3 tools/dev/measure_http.py --assets 22_22        price one tile's files
  python3 tools/dev/measure_http.py --requests 812 --bytes 214000000
  python3 tools/dev/measure_http.py --json
  python3 tools/dev/measure_http.py --check               regression gate

--check asserts the INVARIANTS, not the timings (timings are machine- and
load-dependent and a threshold on them would be a flake generator):
  * the server still answers HTTP/1.0 and still closes the connection per
    response  -- if this ever stops being true, every conclusion drawn from
    this tool is void and the caller must know;
  * a large asset still arrives complete and with the Content-Length it
    advertises;
  * `Cache-Control` is still `public, max-age=3600` on tile assets (a warm
    load depends on it) and `no-store` on `.js` (dev reload depends on that).
It exits nonzero if any of those changes.
"""

import argparse
import json
import os
import socket
import statistics
import sys
import time

# Overridable so --check can be aimed at a deliberately-wrong server and shown
# to FAIL, rather than only ever being seen to pass. Proof, 2026-08-08: a
# throwaway HTTP/1.1 keep-alive server on :8197 →
#   ELBERA_WORLD_PORT=8197 python3 tools/dev/measure_http.py --check
# reports 3 broken invariants and exits 1.
HOST = os.environ.get("ELBERA_WORLD_HOST", "127.0.0.1")
PORT = int(os.environ.get("ELBERA_WORLD_PORT", "8083"))
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

# Small, always-present, and cheap to serve: the fixed-cost probe.
SMALL = "/scenes"
# Large, always-present: the throughput probe.  bspfloor.bin is also the file
# whose size grew 18x with the walk raster, so it is the interesting one.
LARGE_TILE = "22_22"
LARGE = f"/scenes/{LARGE_TILE}/bspfloor.bin"


def fetch(path, read_body=True):
    """One request over one fresh connection. Returns timings + the reply."""
    t0 = time.perf_counter()
    s = socket.create_connection((HOST, PORT), timeout=30)
    s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    t_conn = time.perf_counter()
    s.sendall(f"GET {path} HTTP/1.1\r\nHost: {HOST}\r\n"
              f"Connection: keep-alive\r\n\r\n".encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = s.recv(65536)
        if not chunk:
            break
        buf += chunk
    t_hdr = time.perf_counter()
    head, _, rest = buf.partition(b"\r\n\r\n")
    lines = head.decode("latin1").split("\r\n")
    status = lines[0]
    headers = {}
    for ln in lines[1:]:
        if ":" in ln:
            k, v = ln.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    body = rest
    n = int(headers.get("content-length", "0"))
    if read_body:
        while len(body) < n:
            chunk = s.recv(1 << 20)
            if not chunk:
                break
            body += chunk
    t_body = time.perf_counter()
    # Does the server close after one response?  Ask the socket, do not infer
    # it from the status line.
    s.settimeout(2.0)
    try:
        closed = s.recv(1) == b""
    except socket.timeout:
        closed = False
    except OSError:
        closed = True
    s.close()
    return {
        "status": status, "headers": headers, "bodyLen": len(body),
        "declaredLen": n, "closedByServer": closed,
        "connectMs": (t_conn - t0) * 1000,
        "headerMs": (t_hdr - t_conn) * 1000,
        "bodyMs": (t_body - t_hdr) * 1000,
        "totalMs": (t_body - t0) * 1000,
    }


def pct(xs, q):
    xs = sorted(xs)
    if not xs:
        return 0.0
    i = min(len(xs) - 1, int(round((len(xs) - 1) * q)))
    return xs[i]


def tile_assets(tile):
    """The files that live in one tile's directory, from disk.

    Not a claim about what the client requests -- it is an upper bound on the
    tile's own package.  Props and textures live elsewhere and are counted
    separately by the caller if wanted.
    """
    d = os.path.join(ROOT, "assets", "world", tile)
    out = []
    for dirpath, _dirs, files in os.walk(d):
        for f in files:
            p = os.path.join(dirpath, f)
            out.append((os.path.relpath(p, d), os.path.getsize(p)))
    return sorted(out)


def measure(n_small, args):
    res = {"host": f"{HOST}:{PORT}", "at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}

    probe = fetch(SMALL)
    res["protocol"] = {
        "statusLine": probe["status"],
        "isHttp10": probe["status"].startswith("HTTP/1.0"),
        "serverClosesPerResponse": probe["closedByServer"],
        "server": probe["headers"].get("server"),
    }

    # 1. fixed per-request cost
    samples = [fetch(SMALL) for _ in range(n_small)]
    tot = [s["totalMs"] for s in samples]
    res["perRequest"] = {
        "path": SMALL, "n": n_small, "bodyBytes": samples[0]["bodyLen"],
        "connectMs_median": round(statistics.median(s["connectMs"] for s in samples), 3),
        "totalMs_median": round(statistics.median(tot), 3),
        "totalMs_p90": round(pct(tot, 0.90), 3),
        "totalMs_p99": round(pct(tot, 0.99), 3),
        "totalMs_max": round(max(tot), 3),
    }

    # 2. throughput on a large body
    big = [fetch(LARGE) for _ in range(3)]
    best = min(big, key=lambda b: b["totalMs"])
    mb = best["bodyLen"] / 1048576.0
    res["throughput"] = {
        "path": LARGE, "bytes": best["bodyLen"],
        "bestTotalMs": round(best["totalMs"], 2),
        "bodyMs": round(best["bodyMs"], 2),
        "MiBps": round(mb / (best["totalMs"] / 1000.0), 1),
        "cacheControl": best["headers"].get("cache-control"),
        "complete": best["bodyLen"] == best["declaredLen"],
    }

    # 3. price a workload
    fixed = res["perRequest"]["totalMs_median"]
    rate = res["throughput"]["MiBps"] * 1048576.0 / 1000.0     # bytes per ms
    work = None
    if args.assets:
        files = tile_assets(args.assets)
        work = {"source": f"assets/world/{args.assets}/ on disk",
                "requests": len(files), "bytes": sum(s for _n, s in files),
                "largest": sorted(files, key=lambda f: -f[1])[:6]}
    elif args.requests:
        work = {"source": "supplied", "requests": args.requests, "bytes": args.bytes}
    if work:
        oh = work["requests"] * fixed
        tx = work["bytes"] / rate if rate else 0
        work["serialConnectionOverheadMs"] = round(oh, 1)
        work["serialTransferMs"] = round(tx, 1)
        work["overheadShareSerial"] = round(100 * oh / (oh + tx), 1) if (oh + tx) else 0
        # A browser opens several sockets per origin, so the SERIAL number is a
        # worst case. Chrome's cap for HTTP/1.x is 6 per origin; dividing both
        # terms by 6 leaves the ratio unchanged, which is the point: parallelism
        # does not change WHICH term dominates.
        work["note"] = ("Chrome opens up to 6 sockets per origin, so both terms "
                        "shrink by ~6x in a real load and the SHARE is unchanged.")
        res["workload"] = work
    return res


def report(r):
    L = []
    p = L.append
    p("")
    p(f"DEV SERVER HTTP COST — {r['host']}   {r['at']}")
    p("")
    pr = r["protocol"]
    p(f"  protocol      {pr['statusLine']}   ({pr['server']})")
    p(f"                HTTP/1.0: {pr['isHttp10']}   "
      f"closes after every response: {pr['serverClosesPerResponse']}")
    q = r["perRequest"]
    p("")
    p(f"  per request   {q['n']} sequential GETs of {q['path']} ({q['bodyBytes']} B body)")
    p(f"                connect  median {q['connectMs_median']:.3f} ms")
    p(f"                total    median {q['totalMs_median']:.3f} ms   "
      f"p90 {q['totalMs_p90']:.3f}   p99 {q['totalMs_p99']:.3f}   max {q['totalMs_max']:.3f}")
    t = r["throughput"]
    p("")
    p(f"  throughput    {t['path']}  {t['bytes']:,} B")
    p(f"                {t['bestTotalMs']:.1f} ms best of 3  =  {t['MiBps']} MiB/s   "
      f"complete: {t['complete']}")
    p(f"                Cache-Control: {t['cacheControl']}")
    if "workload" in r:
        w = r["workload"]
        p("")
        p(f"  workload      {w['source']}")
        p(f"                {w['requests']} requests, {w['bytes']:,} bytes")
        p(f"                connection overhead  {w['serialConnectionOverheadMs']:>9.1f} ms serial")
        p(f"                byte transfer        {w['serialTransferMs']:>9.1f} ms serial")
        p(f"                => connection overhead is {w['overheadShareSerial']}% of the total")
        p(f"                {w['note']}")
        if "largest" in w:
            p("                largest files:")
            for n, s in w["largest"]:
                p(f"                  {s/1048576:8.2f} MiB  {n}")
    p("")
    return "\n".join(L)


def check():
    bad = []
    probe = fetch(SMALL)
    if not probe["status"].startswith("HTTP/1.0"):
        bad.append(f"status line is now {probe['status']!r} — this tool's whole "
                   "premise (connection per asset) may no longer hold; re-derive it")
    if not probe["closedByServer"]:
        bad.append("the server no longer closes the connection after a response — "
                   "keep-alive is in play and every overhead number here is stale")
    big = fetch(LARGE)
    if big["bodyLen"] != big["declaredLen"]:
        bad.append(f"{LARGE}: got {big['bodyLen']} B, Content-Length said "
                   f"{big['declaredLen']} B")
    cc = big["headers"].get("cache-control")
    if cc != "public, max-age=3600":
        bad.append(f"{LARGE}: Cache-Control is {cc!r}, expected 'public, max-age=3600' "
                   "— without it there is no warm cache and every reload is cold")
    js = fetch("/js/main.js")
    if js["headers"].get("cache-control") != "no-store":
        bad.append(f"/js/main.js: Cache-Control is "
                   f"{js['headers'].get('cache-control')!r}, expected 'no-store' "
                   "— a cached bundle makes edits invisible during development")
    for b in bad:
        print(f"FAIL  {b}")
    if bad:
        print(f"measure_http --check FAILED: {len(bad)} invariant(s) broken")
        return 1
    print("PASS  HTTP/1.0 + close-per-response + Content-Length + Cache-Control "
          "all as documented")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200, help="fixed-cost samples")
    ap.add_argument("--assets", metavar="TILE", help="price one tile's file set")
    ap.add_argument("--requests", type=int, help="workload request count")
    ap.add_argument("--bytes", type=int, default=0, help="workload byte count")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    try:
        socket.create_connection((HOST, PORT), timeout=3).close()
    except OSError as e:
        print(f"measure_http: no dev server on {HOST}:{PORT} ({e})", file=sys.stderr)
        return 2
    if args.check:
        return check()
    r = measure(args.n, args)
    print(json.dumps(r, indent=2) if args.json else report(r))
    return 0


if __name__ == "__main__":
    sys.exit(main())
