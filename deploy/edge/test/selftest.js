'use strict';

// Self-test: dummy upstreams + edge on ephemeral ports.
// Asserts: HTTP GET proxied (body+status), WS /ws echoes, WS on wrong path rejected.

const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function startEdge(httpUpstream, wsUpstream) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: {
        ...process.env,
        EDGE_PORT: '0',
        EDGE_HTTP_UPSTREAM: `http://127.0.0.1:${httpUpstream}`,
        EDGE_WS_UPSTREAM: `ws://127.0.0.1:${wsUpstream}`,
      },
    });
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      const match = buf.match(/listening on 0\.0\.0\.0:(\d+)/);
      if (match) resolve({ child, port: parseInt(match[1], 10) });
    });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('exit', (code) => reject(new Error(`edge exited early with code ${code}`)));
  });
}

async function main() {
  const httpUpstream = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`hello from upstream ${req.method} ${req.url}`);
  });

  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => ws.on('message', (data, isBinary) => ws.send(data, { binary: isBinary })));
  const wsUpstream = http.createServer();
  wsUpstream.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req)));

  const httpPort = await listen(httpUpstream);
  const wsPort = await listen(wsUpstream);
  const { child: edge, port: edgePort } = await startEdge(httpPort, wsPort);
  console.log(`dummy HTTP upstream :${httpPort}, dummy WS upstream :${wsPort}, edge :${edgePort}`);

  let failures = 0;
  const check = (name, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
    if (!ok) failures++;
  };

  try {
    // 1. HTTP GET proxied with body+status
    const httpResult = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${edgePort}/some/path?q=1`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject);
    });
    check('HTTP GET proxied (status 200)', httpResult.status === 200);
    check('HTTP GET proxied (body)', httpResult.body === 'hello from upstream GET /some/path?q=1');

    // 2. WS to /ws echoes
    const echo = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${edgePort}/ws`);
      ws.on('open', () => ws.send('ping'));
      ws.on('message', (data) => {
        ws.close();
        resolve(data.toString());
      });
      ws.on('error', reject);
    });
    check('WS /ws echoes message', echo === 'ping');

    // 3. WS to a wrong path is rejected
    const rejected = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${edgePort}/nope`);
      ws.on('open', () => resolve(false));
      ws.on('unexpected-response', (req, res) => resolve(res.statusCode === 404));
      ws.on('error', () => resolve(false));
    });
    check('WS wrong path rejected with 404', rejected);
  } finally {
    edge.kill();
    httpUpstream.close();
    wsUpstream.close();
  }

  console.log(failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
