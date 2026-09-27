'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PacketFramer } = require('../src/l2io.js');

test('fragmented headers and coalesced packets preserve every byte in order', () => {
  const received = [], f = new PacketFramer(body => received.push([...body]));
  f.push(Buffer.from([4]));
  assert.deepEqual(received, []);
  f.push(Buffer.from([0, 8]));
  assert.deepEqual(received, []);
  f.push(Buffer.from([9, 3, 0, 17, 5, 0, 32]));
  assert.deepEqual(received, [[8, 9], [17]]);
  f.push(Buffer.from([33, 34]));
  assert.deepEqual(received, [[8, 9], [17], [32, 33, 34]]);
  assert.equal(f.buf.length, 0);
});

for (const total of [0, 1, 2]) {
  test(`invalid frame length ${total} rejects once without decoding or looping`, () => {
    const errors = [], received = [];
    const f = new PacketFramer(body => received.push(body), error => errors.push(error));
    f.push(Buffer.from([total, 0, 3, 0, 17]));
    assert.equal(received.length, 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /invalid L2 packet length/);
    assert.equal(f.buf.length, 0);
    f.push(Buffer.from([3, 0, 17]));
    assert.equal(received.length, 0, 'failed framing cannot resume an ambiguous stream');
    assert.equal(errors.length, 1);
  });
}

test('largest uint16-framed payload works across many chunks', () => {
  const payload = Buffer.alloc(65533, 0xa5), received = [];
  const f = new PacketFramer(body => received.push(body));
  f.push(Buffer.from([255, 255]));
  for (let offset = 0; offset < payload.length; offset += 8192)
    f.push(payload.subarray(offset, offset + 8192));
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], payload);
});
