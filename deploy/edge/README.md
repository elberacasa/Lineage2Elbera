# Edge proxy — public entry point

One local port that fronts the web client and the gateway, for exposing through a Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:8095`).

```bash
cd deploy/edge
npm install
npm start
```

- HTTP: reverse-proxies everything to the client app (`EDGE_HTTP_UPSTREAM`, default `http://127.0.0.1:8083`).
- WS: upgrades on `/ws` go to the gateway (`EDGE_WS_UPSTREAM`, default `ws://127.0.0.1:8090`); upgrades on any other path get a 404 close.
- Listens on `0.0.0.0:8095` (`EDGE_PORT`) so a tunnel or LAN can reach it.

Self-test (dummy upstreams, ephemeral ports, exits non-zero on failure):

```bash
npm test
```

## Files

- `server.js` — HTTP proxy (node:http, streams request/response, strips hop-by-hop headers) + WS proxy (`ws` in noServer mode, bidirectional pipe with close/error propagation).
- `test/selftest.js` — asserts HTTP GET proxying (body+status), WS `/ws` echo, and 404 on a wrong WS path.
- `test/verify-public.js` — live end-to-end through a tunnel URL: `node test/verify-public.js https://<sub>.trycloudflare.com` → login → enterWorld against the real aCis, `VERIFY-PUBLIC: PASS`.
