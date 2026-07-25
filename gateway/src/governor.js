// Connection governor.
// aCis applies a HARDCODED anti-flood accept filter on BOTH loginserver:2106
// and gameserver:7777 (commons/network/IPv4Filter.java): more than 3 rapid
// connections per second from one IP gets that IP rejected, and every further
// attempt refreshes a 300s in-memory ban. Since every browser client proxied
// by this gateway connects from the same host, ALL outbound L2 connections
// must be paced. 400ms spacing = 2.5 conn/s, safely below the limit.
'use strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIN_INTERVAL_MS = 400;

let _chain = Promise.resolve();
let _lastConnect = 0;

// Runs work() (which should open ONE socket to an L2 server) respecting the
// global pacing. Returns a promise for work()'s result.
function gatedConnect(work) {
  const p = _chain.then(async () => {
    const delay = MIN_INTERVAL_MS - (Date.now() - _lastConnect);
    if (delay > 0) await sleep(delay);
    _lastConnect = Date.now();
    return work();
  });
  _chain = p.catch(() => {});
  return p;
}

module.exports = { gatedConnect };
