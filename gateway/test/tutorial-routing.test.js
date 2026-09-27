'use strict';

// Actual Bridge and packet codec; no sockets, accounts, timers or private
// source files. Wire bytes are constructed independently of the send methods.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Bridge } = require('../src/bridge.js');
const { GameSession } = require('../src/gameclient.js');

function fixture() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  const messages = [], packets = [];
  ws.send = data => messages.push(JSON.parse(data));
  const bridge = new Bridge(ws, {}, () => {});
  const game = new GameSession();
  game._send = bytes => packets.push(Buffer.from(bytes));
  bridge.game = game;
  bridge._wireGame(game, {}, true);
  return { messages, packets, game, send: value => bridge._onMessage(JSON.stringify(value)) };
}

test('tutorial HTML stays separate from NPC HTML and retains original link actions', () => {
  const f = fixture();
  const html = '<html><body><a action="link TE02">fixture next</a></body></html>';
  f.game.emit('tutorialHtml', html);
  f.game.emit('tutorialQuestionMark', 42);
  f.game.emit('tutorialEvent', 10);
  f.game.emit('tutorialCloseHtml');
  assert.deepEqual(f.messages, [
    { op: 'tutorialHtml', html }, { op: 'tutorialQuestionMark', markId: 42 },
    { op: 'tutorialEvent', eventId: 10 }, { op: 'tutorialHtmlClose' },
  ]);
  assert.equal(f.packets.length, 0, 'arming an event never echoes it to the server');
});

test('raw tutorial link targets use 0x7b, including non-TE HTML links', async () => {
  const f = fixture();
  for (const command of ['TE02', 'Tutorial/Page.htm']) {
    await f.send({ op: 'tutorialLink', command });
    assert.deepEqual(f.packets.at(-1), Buffer.concat([
      Buffer.from([0x7b]), Buffer.from(command, 'utf16le'), Buffer.from([0, 0]),
    ]));
  }
  await f.send({ op: 'bypass', command: 'npc_42_Chat 1' });
  assert.equal(f.packets.at(-1)[0], 0x21, 'ordinary NPC links retain their own opcode');
});

test('question ID and occurring event bit remain unchanged in wire packets', async () => {
  const f = fixture();
  await f.send({ op: 'tutorialQuestionMark', markId: 42 });
  await f.send({ op: 'tutorialEvent', eventId: 0x80000000 });
  assert.deepEqual(f.packets, [Buffer.from([0x7d, 42, 0, 0, 0]), Buffer.from([0x7e, 0, 0, 0, 128])]);
});

test('malformed or oversized tutorial links do not become truncated commands', async () => {
  const f = fixture();
  for (const command of [null, 7, {}, 'TE02\0TE00', 'x'.repeat(32766)])
    await f.send({ op: 'tutorialLink', command });
  assert.equal(f.packets.length, 0);
  await f.send({ op: 'tutorialLink', command: 'x'.repeat(32765) });
  assert.equal(f.packets[0].length + 2, 65535, 'largest accepted payload fits framing');
});
