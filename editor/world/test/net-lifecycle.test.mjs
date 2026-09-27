// Actual browser NetClient, with only WebSocket/storage boundaries replaced.
// No gateway, accounts, credentials, ports or live process changes are needed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../js/net.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '');

function fixture() {
  const sockets = [], tasks = [], events = [], warnings = [];
  class Socket {
    static OPEN = 1;
    constructor(url) {
      this.url = url; this.readyState = 0; this.sent = []; this.closeCount = 0;
      sockets.push(this);
    }
    open() { this.readyState = 1; this.onopen?.({}); }
    message(msg) { this.onmessage?.({ data: JSON.stringify(msg) }); }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() {
      const connecting = this.readyState === 0;
      this.closeCount++;
      this.readyState = 2;
      // Native WebSocket reports error when a connecting handshake is
      // cancelled. Listeners are resolved when the queued event dispatches.
      tasks.push(() => {
        if (connecting) this.onerror?.({});
        this.readyState = 3;
        this.onclose?.({});
      });
    }
    remoteClose() { this.readyState = 3; this.onclose?.({}); }
  }
  const stored = new Map([['l2vzla.deviceId', 'synthetic-device']]);
  const context = {
    WebSocket: Socket,
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) },
    console: { warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args) },
  };
  vm.runInNewContext(source + '\nglobalThis.client = new NetClient();', context);
  const client = context.client;
  for (const op of ['open', 'close', 'error', 'enterWorld', 'chat'])
    client.on(op, msg => events.push({ op, msg }));
  return { client, sockets, tasks, events, warnings,
    flush() { while (tasks.length) tasks.shift()(); } };
}

test('cancelling an old handshake cannot report failure against its healthy replacement', () => {
  const f = fixture();
  f.client.connect('ws://first.invalid');
  f.client.connect('ws://replacement.invalid');
  const replacement = f.sockets[1];
  replacement.open();
  f.flush();
  assert.deepEqual(f.events.map(e => e.op), ['open']);
  assert.equal(f.client.ws, replacement);
  assert.equal(f.client.connected, true);
  assert.equal(f.client.url, 'ws://replacement.invalid');
  assert.deepEqual(replacement.sent, [{ op: 'login', deviceId: 'synthetic-device' }]);
  assert.equal(f.client.send('moveTo', { x: 1, y: 2, z: 3 }), true);
  assert.equal(replacement.sent.at(-1).op, 'moveTo');
});

test('disconnect retires every transport callback and stays silent during cancellation', () => {
  const f = fixture();
  f.client.connect('ws://first.invalid');
  const old = f.sockets[0];
  f.client.disconnect();
  for (const name of ['onopen', 'onclose', 'onerror', 'onmessage'])
    assert.equal(old[name], null, name + ' was detached');
  f.flush();
  f.client.disconnect();
  assert.equal(old.closeCount, 1);
  assert.equal(f.client.ws, null);
  assert.equal(f.client.connected, false);
  assert.equal(f.client.send('moveTo'), false);
  assert.deepEqual(f.events, []);
});

test('retained callbacks from a retired socket cannot emit, log, log in or clear a newer socket', () => {
  const f = fixture();
  f.client.connect('ws://first.invalid');
  const old = f.sockets[0];
  old.open();
  // Extra defensive case: a transport adapter may already hold callbacks,
  // even after the normal browser event-handler properties are detached.
  const queued = { open: old.onopen, close: old.onclose, error: old.onerror, message: old.onmessage };
  f.client.connect('ws://replacement.invalid');
  const current = f.sockets[1]; current.open();
  const eventCount = f.events.length, logCount = f.client.log.length;
  queued.open({});
  queued.error({});
  queued.message({ data: JSON.stringify({ op: 'enterWorld', char: { name: 'retired' } }) });
  queued.message({ data: 'broken retired JSON' });
  queued.close({});
  assert.equal(f.events.length, eventCount);
  assert.equal(f.client.log.length, logCount);
  assert.equal(f.warnings.length, 0);
  assert.equal(f.client.ws, current);
  assert.equal(f.client.connected, true);
  assert.equal(current.sent.length, 1, 'only its own open event logs in');
});

test('active traffic, malformed JSON and remote close keep their existing behavior', () => {
  const f = fixture();
  f.client.connect('ws://current.invalid');
  const current = f.sockets[0]; current.open();
  current.message({ op: 'chat', text: 'synthetic text' });
  current.onmessage({ data: '{broken' });
  assert.deepEqual(f.events.map(e => e.op), ['open', 'chat']);
  assert.equal(f.warnings.length, 1);
  assert.equal(f.client.log.at(-1).op, 'chat');
  current.remoteClose();
  assert.deepEqual(f.events.map(e => e.op), ['open', 'chat', 'close']);
  assert.equal(f.client.connected, false);
  assert.equal(f.client.ws, null);
  current.remoteClose();
  assert.equal(f.events.filter(e => e.op === 'close').length, 1);
});

test('an open handler can replace the socket without sending the retired login to it', () => {
  const f = fixture();
  let first = true;
  f.client.on('open', () => {
    if (!first) return;
    first = false;
    f.client.connect('ws://replacement.invalid');
    // Complete synchronously to exercise the callback's reentrancy boundary.
    f.sockets[1].open();
  });
  f.client.connect('ws://first.invalid');
  f.sockets[0].open();
  assert.equal(f.client.ws, f.sockets[1]);
  assert.equal(f.client.connected, true);
  assert.equal(f.sockets[0].sent.length, 0);
  assert.deepEqual(f.sockets[1].sent, [{ op: 'login', deviceId: 'synthetic-device' }]);
});
