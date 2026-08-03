'use strict';

// Elbera edge proxy: one public port.
//  - HTTP: reverse-proxies everything to the web client (EDGE_HTTP_UPSTREAM).
//  - WS:   upgrades on /ws go to the gateway (EDGE_WS_UPSTREAM); other paths are rejected.

const http = require('node:http');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = parseInt(process.env.EDGE_PORT || '8095', 10);
const HTTP_UPSTREAM = new URL(process.env.EDGE_HTTP_UPSTREAM || 'http://127.0.0.1:8083');
const WS_UPSTREAM = new URL(process.env.EDGE_WS_UPSTREAM || 'ws://127.0.0.1:8090');

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function stripHopByHop(headers) {
  const out = {};
  const connectionTokens = (headers.connection || '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || connectionTokens.includes(lower)) continue;
    out[name] = value;
  }
  return out;
}

const server = http.createServer((req, res) => {
  const headers = stripHopByHop(req.headers);
  headers.host = HTTP_UPSTREAM.host;

  const upstreamReq = http.request(
    {
      hostname: HTTP_UPSTREAM.hostname,
      port: HTTP_UPSTREAM.port,
      path: req.url,
      method: req.method,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.statusMessage, stripHopByHop(upstreamRes.headers));
      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on('error', (err) => {
    console.error(`[edge] HTTP upstream error for ${req.method} ${req.url}: ${err.message}`);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('Bad Gateway');
  });

  req.pipe(upstreamReq);
});

// Reserved codes (1005/1006/1015) can't be sent in a close frame; close without code instead.
function forwardClose(ws, code, reason) {
  if ([1005, 1006, 1015].includes(code)) ws.close();
  else ws.close(code, reason);
}

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname !== '/ws') {
    console.warn(`[edge] rejected WS upgrade for path ${pathname}`);
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
    return;
  }

  const upstream = new WebSocket(WS_UPSTREAM.toString(), { headers: stripHopByHop(req.headers) });
  let accepted = false;

  const rejectSocket = (status) => {
    if (!socket.destroyed) socket.end(`HTTP/1.1 ${status}\r\n\r\n`);
  };

  upstream.on('error', (err) => {
    console.error(`[edge] WS upstream error: ${err.message}`);
    if (!accepted) rejectSocket('502 Bad Gateway');
  });

  upstream.on('open', () => {
    wss.handleUpgrade(req, socket, head, (client) => {
      accepted = true;
      client.on('message', (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
      });
      client.on('close', (code, reason) => forwardClose(upstream, code, reason));
      client.on('error', () => upstream.close());
      upstream.on('message', (data, isBinary) => client.send(data, { binary: isBinary }));
      upstream.on('close', (code, reason) => forwardClose(client, code, reason));
    });
  });

  socket.on('error', () => upstream.close());
  socket.on('close', () => {
    if (!accepted) upstream.close();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[edge] listening on 0.0.0.0:${server.address().port}`);
  console.log(`[edge] HTTP -> ${HTTP_UPSTREAM}`);
  console.log(`[edge] WS /ws -> ${WS_UPSTREAM}`);
});
