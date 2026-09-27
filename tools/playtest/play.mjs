#!/usr/bin/env node
// Elbera Tools CLI. See README.md; importing session.mjs never connects.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { Geodata, NavGrid } from '../../editor/world/js/geodata.js';
import { PlaySession, readIdentity } from './session.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { identity: { type: 'string' }, character: { type: 'string' },
  receipt: { type: 'string' }, gateway: { type: 'string', default: 'ws://127.0.0.1:8090' },
  'timeout-seconds': { type: 'string', default: '1200' }, help: { type: 'boolean' } } });
if (values.help) {
  console.log('Elbera Tools existing-character playtest (no browser, SQL or character creation)\n'
    + 'node tools/playtest/play.mjs --identity PRIVATE.json --character EXISTING_NAME\n'
    + '  --receipt tmp/restart-audit/playtest.jsonl [--gateway ws://127.0.0.1:8090]\n'
    + '  [--timeout-seconds 1200]\n'
    + 'Requires an existing deviceId JSON, private actionname/geodata assets and gateway ws dependency.\n'
    + 'Manual JSON commands only; no mutation queue or automatic combat loop. See tools/playtest/README.md.');
  process.exit(0);
}
if (!values.identity || !values.character || !values.receipt) throw new Error('--identity, --character and --receipt are required');
const identityPath = path.resolve(values.identity), receiptPath = path.resolve(values.receipt);
const gateway = new URL(values.gateway);
if (!['ws:', 'wss:'].includes(gateway.protocol) || gateway.username || gateway.password)
  throw new Error('Gateway must be a ws/wss URL without embedded credentials');
const timeout = Number(values['timeout-seconds']);
if (!Number.isInteger(timeout) || timeout < 1 || timeout > 3600) throw new Error('Operational timeout must be 1..3600 seconds');
let identity;
try { identity = readIdentity(JSON.parse(fs.readFileSync(identityPath, 'utf8'))); }
catch { throw new Error('Cannot read a valid explicit existing-identity JSON file'); }
const relativeReceipt = path.relative(root, receiptPath);
if (!relativeReceipt || relativeReceipt.startsWith('..') || path.isAbsolute(relativeReceipt))
  throw new Error('Receipt must be inside an ignored repository directory');
try { execFileSync('git', ['check-ignore', '--quiet', '--', relativeReceipt], { cwd: root, stdio: 'ignore' }); }
catch { throw new Error('Receipt is not gitignored; choose tmp/restart-audit/'); }
if (fs.existsSync(receiptPath) && (fs.lstatSync(receiptPath).isSymbolicLink()
    || fs.realpathSync(receiptPath) === fs.realpathSync(identityPath))) throw new Error('Receipt cannot be an identity file or symbolic link');
const hash = data => createHash('sha256').update(data).digest('hex');
const actionBytes = fs.readFileSync(path.join(root, 'assets/gamedata/actionname.json'));
const actions = JSON.parse(actionBytes);
if (!Array.isArray(actions) || !actions.every(a => Number.isInteger(a.id))) throw new Error('Original action catalog is unavailable');
const actionIds = new Set(actions.map(a => a.id));
// Optional original metadata: unavailable/invalid data disables only henna queries.
let hennaCatalog = null, hennaCatalogSHA256 = null;
try {
  const bytes = fs.readFileSync(path.join(root, 'assets/gamedata/henna.json'));
  hennaCatalogSHA256 = hash(bytes);
  hennaCatalog = JSON.parse(bytes);
} catch { /* Ordinary play does not require henna metadata. */ }
let recipeCatalog = null, recipeCatalogSHA256 = null;
try {
  const bytes = fs.readFileSync(path.join(root, 'assets/gamedata/recipes.json'));
  recipeCatalogSHA256 = hash(bytes);
  recipeCatalog = JSON.parse(bytes);
} catch { /* Book queries and ordinary play do not require recipe metadata. */ }
fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
const canonicalReceipt = path.join(fs.realpathSync(path.dirname(receiptPath)), path.basename(receiptPath));
const canonicalRelative = path.relative(fs.realpathSync(root), canonicalReceipt);
if (!canonicalRelative || canonicalRelative.startsWith('..') || path.isAbsolute(canonicalRelative))
  throw new Error('Receipt directory must resolve inside the repository');
try { execFileSync('git', ['check-ignore', '--quiet', '--', canonicalRelative], { cwd: root, stdio: 'ignore' }); }
catch { throw new Error('Resolved receipt path is not gitignored'); }
if (fs.existsSync(receiptPath)) {
  const receiptStat = fs.statSync(receiptPath), identityStat = fs.statSync(identityPath);
  if (!receiptStat.isFile() || (receiptStat.dev === identityStat.dev && receiptStat.ino === identityStat.ino))
    throw new Error('Receipt must be a regular file distinct from the identity file');
}
const fd = fs.openSync(receiptPath, 'a', 0o600);
fs.fchmodSync(fd, 0o600);
const sessionId = randomUUID();
const emit = (type, details = {}) => {
  const row = JSON.stringify({ at: new Date().toISOString(), sessionId, type, data: details });
  fs.writeSync(fd, row + '\n'); console.log(row);
};
emit('session-start', { character: values.character, timeoutSeconds: timeout,
  actionCatalogSHA256: hash(actionBytes), hennaCatalogSHA256, recipeCatalogSHA256,
  limits: 'static geodata navigation and gateway behavior; not browser/native fidelity proof' });
const cache = new Map();
const geoAt = (x, y) => {
  const tile = `${20 + Math.floor(x / 32768)}_${18 + Math.floor(y / 32768)}`;
  if (cache.has(tile)) return cache.get(tile);
  const directory = path.join(root, 'assets/world', tile), file = path.join(directory, 'geodata.json');
  if (!fs.existsSync(file)) { cache.set(tile, null); return null; }
  const bytes = fs.readFileSync(file), meta = JSON.parse(bytes), layer = meta.layers?.[0];
  if (layer?.encoding !== 'blockstream-v1' || path.basename(layer.data) !== layer.data) throw new Error('Unsupported geodata metadata');
  const buffer = fs.readFileSync(path.join(directory, layer.data));
  if (buffer.length < 8 || buffer.readUInt32LE(0) !== 0x4c324731) throw new Error('Invalid geodata binary');
  const geo = new Geodata(meta, buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  cache.set(tile, geo);
  emit('geodata-input', { tile, metadataSHA256: hash(bytes), binarySHA256: hash(buffer) });
  return geo;
};
const require = createRequire(path.join(root, 'gateway/package.json'));
const WebSocket = require('ws');
const ws = new WebSocket(gateway.href);
const session = new PlaySession({ character: values.character, nav: new NavGrid(geoAt), actionIds, hennaCatalog, recipeCatalog, emit,
  send: message => { if (ws.readyState !== WebSocket.OPEN) throw new Error('Gateway connection is not open'); ws.send(JSON.stringify(message)); },
  close: () => { if (ws.readyState === WebSocket.CONNECTING) ws.terminate(); else ws.close(); } });
const input = readline.createInterface({ input: process.stdin });
input.on('line', async line => {
  let command;
  try { command = JSON.parse(line); }
  catch { emit('command-refused', { reason: 'Invalid JSON; no command sent' }); return; }
  try {
    await session.command(command);
    if (!session.closed) emit('command-complete', { op: command?.op });
  } catch (error) { emit('command-refused', { op: command?.op, reason: error.message }); }
});
input.on('close', () => session.stop('input-closed'));
ws.on('open', () => session.begin(identity));
ws.on('message', bytes => {
  try { session.accept(JSON.parse(bytes)); }
  catch { emit('server-message-error', { reason: 'Invalid or unsupported server message' }); session.stop('invalid-server-message'); }
});
ws.on('error', () => session.stop('socket-error'));
const deadline = setTimeout(() => session.stop('operational-deadline'), timeout * 1000);
const loginDeadline = setTimeout(() => { if (session.phase !== 'world') session.stop('world-entry-timeout'); }, 60000);
ws.on('close', () => {
  clearTimeout(deadline); clearTimeout(loginDeadline);
  session.stop('socket-closed'); input.close();
  // Any pending command observes closed before its next bounded wait. Keep the
  // fd until process exit so its final refusal can still be recorded.
});
process.once('SIGINT', () => session.stop('operator-interrupt'));
process.once('SIGTERM', () => session.stop('operator-terminate'));
process.once('exit', () => fs.closeSync(fd));
