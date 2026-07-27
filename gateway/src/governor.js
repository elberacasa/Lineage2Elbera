// Connection governor (cross-process).
// aCis applies a HARDCODED anti-flood accept filter on BOTH loginserver:2106
// and gameserver:7777 (commons/network/IPv4Filter.java): connections faster
// than ~1/s from one IP accumulate strikes, the 4th rapid one bans the IP,
// and every further attempt refreshes a 300s in-memory ban. Since every
// browser client proxied by this gateway connects from the same host, ALL
// outbound L2 connections must be paced — and because test suites and the
// gateway run as SEPARATE processes, the pacing is coordinated through a
// lockfile shared by every ElberaGate process on this machine.
'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');

const MIN_INTERVAL_MS = 1100; // IPv4Filter increments a strike below 1000ms
const LOCK_FILE = path.join(__dirname, '..', '.governor-lock');
const STATE_FILE = path.join(__dirname, '..', '.governor-state');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function acquireLock() {
  for (;;) {
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx'); // atomic create = mutex
      return fd;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Stale-lock guard: if the holder died, the lock file is older than 60s.
      try {
        if (Date.now() - fs.statSync(LOCK_FILE).mtimeMs > 60000) fs.unlinkSync(LOCK_FILE);
      } catch (_) { /* race: someone else cleaned it */ }
      await sleep(120 + Math.random() * 200);
    }
  }
}

function releaseLock(fd) {
  try { fs.closeSync(fd); } catch (_) { /* ignore */ }
  try { fs.unlinkSync(LOCK_FILE); } catch (_) { /* ignore */ }
}

// Runs work() (which should open ONE socket to an L2 server) holding the
// global lock, pacing connections MIN_INTERVAL_MS apart across ALL local
// ElberaGate processes. Returns a promise for work()'s result.
async function gatedConnect(work) {
  const fd = await acquireLock();
  try {
    let last = 0;
    try { last = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).last || 0; } catch (_) { /* no state yet */ }
    const delay = MIN_INTERVAL_MS - (Date.now() - last);
    if (delay > 0) await sleep(delay);
    fs.writeFileSync(STATE_FILE, JSON.stringify({ last: Date.now(), pid: process.pid }));
    return await work();
  } finally {
    releaseLock(fd);
  }
}

module.exports = { gatedConnect };
