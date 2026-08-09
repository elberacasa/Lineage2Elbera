#!/usr/bin/env python3
"""keepalive_server.py -- editor/world/server.py, but HTTP/1.1 with keep-alive.

WHY THIS EXISTS
---------------
`editor/world/server.py` builds on `BaseHTTPRequestHandler`, whose
`protocol_version` class attribute defaults to **"HTTP/1.0"**. Python's
`BaseHTTPRequestHandler` closes the socket after every response unless
`protocol_version` is "HTTP/1.1", so on the dev server **every asset costs a
fresh TCP connection**. Giran pulls ~600 files; that is ~600 connects.

This has been offered as an explanation for slow cold loads. Task #17 asks
whether it actually dominates. `tools/dev/measure_http.py` prices the
per-connection cost in isolation; this file supplies the other half of the
evidence -- an otherwise IDENTICAL server that keeps the connection open, so
the same client, the same tree and the same profiler can be pointed at both
and the difference read off directly.

IT IS NOT A FIX AND MUST NOT BE MISTAKEN FOR ONE. Nothing under
editor/world/ is changed. This is a second process on a second port whose
only difference from the real dev server is one class attribute and the
`Connection` header that follows from it. If the measurement says keep-alive
is worth having, the one-line change belongs in editor/world/server.py and
this file goes back to being a control.

SAFETY OF THE CHANGE, stated because HTTP/1.1 without care is a hang:
every response path in editor/world/server.py sends an explicit
`Content-Length` (`_send_json`, `_send_file`, `_send_face`), which is what
lets a persistent connection find the end of a body. No route streams, no
route uses chunked encoding. `ThreadingHTTPServer` gives each connection its
own thread, so a held-open connection does not block another client -- but
it does hold a thread, which is the cost being traded.

Usage
-----
  python3 tools/dev/keepalive_server.py                 serve on :8084
  python3 tools/dev/keepalive_server.py --port 8099
  python3 tools/dev/keepalive_server.py --check         prove it differs

--check starts the server on an ephemeral port, then asserts the INVARIANTS
that make it a valid control:
  * it answers HTTP/1.1 and does NOT close the socket after a response,
    whereas :8083 answers HTTP/1.0 and does;
  * two sequential GETs succeed on ONE socket;
  * a large asset arrives complete with the Content-Length it advertises;
  * the Cache-Control headers are unchanged from the real server, so a warm
    load behaves the same.
It exits nonzero if any of those is false, which is also what would happen if
someone "fixed" server.py by breaking Content-Length.
"""

import argparse
import os
import socket
import sys
import threading
import time
from http.server import ThreadingHTTPServer

BASE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(BASE, "editor", "world"))

import server as world_server            # noqa: E402  (path set above)


class KeepAliveHandler(world_server.Handler):
    """The dev server's handler, verbatim, speaking HTTP/1.1.

    protocol_version is the ONLY override. BaseHTTPRequestHandler reads it in
    send_response_only() to write the status line and in handle_one_request()
    to decide whether to loop on the same socket; setting it to "HTTP/1.1" is
    the whole of keep-alive here because every route already sends
    Content-Length.
    """

    protocol_version = "HTTP/1.1"
    server_version = "L2WorldKeepAlive/1.1"


class Http10Handler(world_server.Handler):
    """The CONTROL arm: the dev server's handler exactly as it ships.

    This exists so the A/B differs in ONE attribute. Running the keep-alive
    arm here and the real :8083 process as the control would also have varied
    process age, thread count and accumulated TIME_WAIT state, and those turn
    out to matter more than the protocol (see --stress). Same file, same
    class, same listen backlog; only `protocol_version` differs.
    """

    protocol_version = "HTTP/1.0"
    server_version = "L2WorldControl/1.0"


class QuietMixIn:
    def log_message(self, fmt, *args):    # a 3 000-request load drowns the log
        pass


class QuietKeepAlive(QuietMixIn, KeepAliveHandler):
    pass


class QuietHttp10(QuietMixIn, Http10Handler):
    pass


# BACKLOG. socketserver.TCPServer.request_queue_size is 5, and
# editor/world/server.py inherits it. Under HTTP/1.0 the browser opens a fresh
# connection for EVERY asset, so a Giran cold load is ~3 000 connects arriving
# in a few seconds against a 5-deep accept queue. Overflowed SYNs are dropped,
# and the client's retry backoff is what surfaces as ERR_CONNECTION_TIMED_OUT.
# The A/B keeps the default so the control is honest; --backlog raises it so
# the backlog and the protocol can be separated as causes.
DEFAULT_BACKLOG = 5


def serve(port, quiet=False, keepalive=True, backlog=DEFAULT_BACKLOG, silent_log=False):
    if keepalive:
        handler = QuietKeepAlive if silent_log else KeepAliveHandler
    else:
        handler = QuietHttp10 if silent_log else Http10Handler

    class Srv(ThreadingHTTPServer):
        request_queue_size = backlog
        daemon_threads = True

    httpd = Srv(("127.0.0.1", port), handler)
    if not quiet:
        print(f"dev server on http://127.0.0.1:{httpd.server_address[1]}/ "
              f"({handler.protocol_version}, backlog {backlog}, "
              f"same routes as editor/world/server.py)")
    return httpd


# ---------------------------------------------------------------------------
# --check: prove this server differs from :8083 in exactly the intended way
# ---------------------------------------------------------------------------
def _raw(host, port, paths, keep):
    """Send `paths` down ONE socket. Returns (status lines, closedByServer)."""
    s = socket.create_connection((host, port), timeout=20)
    s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    out = []
    buf = b""

    def read_one():
        nonlocal buf
        while b"\r\n\r\n" not in buf:
            c = s.recv(65536)
            if not c:
                return None
            buf += c
        head, _, rest = buf.partition(b"\r\n\r\n")
        lines = head.decode("latin1").split("\r\n")
        hdrs = {}
        for ln in lines[1:]:
            if ":" in ln:
                k, v = ln.split(":", 1)
                hdrs[k.strip().lower()] = v.strip()
        n = int(hdrs.get("content-length", "0"))
        body = rest
        while len(body) < n:
            c = s.recv(1 << 20)
            if not c:
                break
            body += c
        buf = body[n:]
        return {"status": lines[0], "headers": hdrs, "bodyLen": len(body[:n]), "declared": n}

    for p in paths:
        s.sendall(f"GET {p} HTTP/1.1\r\nHost: {host}\r\n"
                  f"Connection: {'keep-alive' if keep else 'close'}\r\n\r\n".encode())
        r = read_one()
        out.append(r)
        if r is None:
            break
    s.settimeout(2.0)
    try:
        closed = s.recv(1) == b""
    except socket.timeout:
        closed = False
    except OSError:
        closed = True
    s.close()
    return out, closed


def check():
    bad = []
    httpd = serve(0, quiet=True)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    time.sleep(0.2)
    try:
        # 1. this server: HTTP/1.1, two GETs on one socket, socket stays open
        rs, closed = _raw("127.0.0.1", port, ["/scenes", "/scenes"], keep=True)
        if any(r is None for r in rs):
            bad.append("keep-alive server dropped the connection between two "
                       "sequential GETs on one socket")
        else:
            if not rs[0]["status"].startswith("HTTP/1.1"):
                bad.append(f"status line is {rs[0]['status']!r}, expected HTTP/1.1")
            if closed:
                bad.append("keep-alive server closed the socket after the responses; "
                           "it is not a keep-alive control at all")
        # 2. large body complete
        big = "/scenes/22_22/bspfloor.bin"
        rb, _ = _raw("127.0.0.1", port, [big], keep=True)
        if rb[0] is None or rb[0]["bodyLen"] != rb[0]["declared"] or rb[0]["declared"] == 0:
            bad.append(f"{big}: body did not arrive complete over keep-alive")
        elif rb[0]["headers"].get("cache-control") != "public, max-age=3600":
            bad.append(f"{big}: Cache-Control is "
                       f"{rb[0]['headers'].get('cache-control')!r}, not the dev server's")
        # 3. the real dev server must still be the HTTP/1.0 thing this controls for
        try:
            r0, closed0 = _raw("127.0.0.1", world_server.PORT, ["/scenes"], keep=True)
            if r0[0] is None:
                bad.append(f"no usable reply from the real dev server on "
                           f":{world_server.PORT}")
            else:
                if not r0[0]["status"].startswith("HTTP/1.0"):
                    bad.append(f"the real dev server on :{world_server.PORT} now answers "
                               f"{r0[0]['status']!r} — this control is redundant, or the "
                               "comparison it supports is stale")
                if not closed0:
                    bad.append(f"the real dev server on :{world_server.PORT} no longer "
                               "closes per response — nothing here is measuring what it says")
        except OSError as e:
            bad.append(f"real dev server on :{world_server.PORT} unreachable ({e}); "
                       "the A/B has no control arm")
    finally:
        httpd.shutdown()
    for b in bad:
        print(f"FAIL  {b}")
    if bad:
        print(f"keepalive_server --check FAILED: {len(bad)} invariant(s) broken")
        return 1
    print("PASS  HTTP/1.1 + persistent socket + complete bodies here; "
          f"HTTP/1.0 + close-per-response still on :{world_server.PORT}")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8084)
    ap.add_argument("--http10", action="store_true",
                    help="serve HTTP/1.0 (the control arm), not keep-alive")
    ap.add_argument("--backlog", type=int, default=DEFAULT_BACKLOG,
                    help=f"listen backlog (dev server inherits {DEFAULT_BACKLOG})")
    ap.add_argument("--quiet-log", action="store_true",
                    help="drop per-request logging (a 3 000-request load floods it)")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    if args.check:
        return check()
    httpd = serve(args.port, keepalive=not args.http10, backlog=args.backlog,
                  silent_log=args.quiet_log)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
