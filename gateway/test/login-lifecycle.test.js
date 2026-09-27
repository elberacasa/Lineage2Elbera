'use strict';

// Deterministic lifecycle checks: actual Bridge + GameSession, with only the
// login service, TCP transport, governor queue, and clock replaced. No ports,
// database, shared lock files, or real game accounts are used.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const authReply = { sessionKey: {}, server: { id: 1, host: 'fixture', port: 1 } };

function fixture() {
  const logins = [], queued = [], sockets = [], timers = new Map();
  const clock = {
    setTimeout(fn, ms) { const token = {}; timers.set(token, { fn, ms }); return token; },
    clearTimeout(token) { timers.delete(token); },
  };

  class Socket extends EventEmitter {
    constructor() { super(); this.destroyed = false; this.writes = []; }
    write(bytes) { this.writes.push(bytes); }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      queueMicrotask(() => this.emit('close'));
    }
  }
  function load(filename, overrides) {
    const full = path.join(__dirname, '..', 'src', filename);
    const requireLocal = createRequire(full);
    const context = {
      module: { exports: {} }, Buffer, process: { env: {} }, ...clock,
      require(name) {
        return Object.hasOwn(overrides, name) ? overrides[name] : requireLocal(name);
      },
    };
    vm.runInNewContext(fs.readFileSync(full, 'utf8'), context, { filename: full });
    return context.module.exports;
  }
  const { GameSession } = load('gameclient.js', {
    net: { connect() { const socket = new Socket(); sockets.push(socket); return socket; } },
    './governor.js': { gatedConnect(work) {
      const gate = deferred(); queued.push({ ...gate, work }); return gate.promise;
    } },
  });
  const { Bridge } = load('bridge.js', {
    './gameclient.js': { GameSession },
    './loginclient.js': { login() { const call = deferred(); logins.push(call); return call.promise; } },
    './npcnames.js': {}, './questnames.js': {}, './weapontypes.js': {},
  });
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.messages = [];
  ws.send = text => ws.messages.push(JSON.parse(text));
  ws.close = () => { ws.readyState = 3; ws.emit('close'); };
  const bridge = new Bridge(ws, {}, () => {});

  return {
    bridge, ws, logins, queued, sockets, timers,
    login(id = 'lifecycle-fixture') {
      return bridge._onMessage(JSON.stringify({ op: 'login', deviceId: id, noAutoCreate: true }));
    },
    releaseGate() {
      const gate = queued.shift();
      assert.ok(gate, 'game connection was queued');
      const work = gate.work();
      work.then(gate.resolve, gate.reject);
      return work;
    },
    retry() {
      const entry = [...timers].find(([, timer]) => timer.ms === 4000);
      assert.ok(entry, 'retry backoff is pending');
      timers.delete(entry[0]); entry[1].fn();
    },
  };
}

async function finishLogin(f) {
  const opening = f.releaseGate();
  f.sockets.at(-1).emit('connect');
  await opening;
  f.bridge.game.emit('charList', []);
  await flush();
}

test('concurrent login messages create one authenticated game session', async () => {
  const f = fixture();
  const first = f.login('first');
  const duplicate = f.login('second');
  assert.equal(f.logins.length, 1, 'only the first message authenticates');
  f.logins[0].resolve(authReply);
  await flush();
  assert.equal(f.queued.length, 1);
  await finishLogin(f);
  await Promise.all([first, duplicate]);
  assert.equal(f.sockets.length, 1);
  assert.equal(f.ws.messages.filter(m => m.op === 'auth_ok').length, 1);
  f.ws.close();
  await flush();
  assert.ok(f.sockets[0].destroyed, 'normal disconnect still closes its socket');
  assert.equal(f.timers.size, 0);
});

for (const outcome of ['success', 'failure']) {
  test(`browser close while authentication is pending ignores later ${outcome}`, async () => {
    const f = fixture();
    const pending = f.login();
    f.ws.close();
    if (outcome === 'success') f.logins[0].resolve(authReply);
    else f.logins[0].reject(new Error('fixture authentication failed'));
    await flush();
    assert.equal(f.queued.length, 0, 'no delayed game connection was queued');
    assert.equal(f.sockets.length, 0);
    assert.equal(f.bridge.game, null);
    assert.equal(f.timers.size, 0);
    await pending;
    await f.login('after-close');
    assert.equal(f.logins.length, 1, 'closed bridge never authenticates or retries again');
  });
}

test('browser close cancels a game connection still waiting for the governor', async () => {
  const f = fixture();
  const pending = f.login();
  f.logins[0].resolve(authReply);
  await flush();
  assert.equal(f.queued.length, 1);
  f.ws.close();
  await flush();
  assert.equal(f.timers.size, 0, 'closing a queued session settles its login waiter');
  await pending;
  await f.releaseGate();
  assert.equal(f.sockets.length, 0, 'releasing the queue cannot open an orphan socket');
  assert.equal(f.logins.length, 1, 'disconnect is not retried');
  assert.equal(f.timers.size, 0);
});

test('browser close during TCP connect destroys the socket and releases the governor', async () => {
  const f = fixture();
  const pending = f.login();
  f.logins[0].resolve(authReply);
  await flush();
  const opening = f.releaseGate();
  assert.equal(f.sockets.length, 1);
  f.ws.close();
  await flush();
  assert.equal(f.timers.size, 0, 'closed browser does not schedule a retry');
  await Promise.all([pending, opening]);
  assert.ok(f.sockets[0].destroyed);
  assert.equal(f.sockets[0].writes.length, 0);
  assert.equal(f.logins.length, 1);
  assert.equal(f.timers.size, 0);
});

test('duplicate messages cannot bypass retry backoff, and close prevents the retry', async () => {
  const f = fixture();
  const pending = f.login();
  f.logins[0].reject(new Error('fixture temporary failure'));
  await flush();
  await f.login('duplicate-during-backoff');
  assert.equal(f.logins.length, 1);
  f.ws.close();
  f.retry();
  await pending;
  assert.equal(f.logins.length, 1);
  assert.equal(f.queued.length, 0);
  assert.equal(f.timers.size, 0);
});

test('an open browser can still authenticate through the existing one-retry path', async () => {
  const f = fixture();
  const pending = f.login();
  f.logins[0].reject(new Error('fixture temporary failure'));
  await flush();
  f.retry();
  await flush();
  assert.equal(f.logins.length, 2);
  f.logins[1].resolve(authReply);
  await flush();
  await finishLogin(f);
  await pending;
  assert.equal(f.ws.messages.filter(m => m.op === 'auth_ok').length, 1);
  f.ws.close();
  await flush();
  assert.ok(f.sockets[0].destroyed);
  assert.equal(f.timers.size, 0);
});

test('malformed game framing closes the authenticated session without a retry or leaked timer', async () => {
  const f = fixture();
  const pending = f.login();
  f.logins[0].resolve(authReply);
  await flush();
  await finishLogin(f);
  await pending;
  f.sockets[0].emit('data', Buffer.from([0, 0]));
  await flush();
  assert.ok(f.sockets[0].destroyed);
  assert.equal(f.ws.readyState, 3);
  assert.equal(f.timers.size, 0);
  assert.equal(f.logins.length, 1);
});
