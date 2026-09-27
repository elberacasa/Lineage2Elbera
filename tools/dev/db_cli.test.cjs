const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const { dbArgs } = require('./db_cli.cjs');

const root = path.resolve(__dirname, '../..');
function withoutDbEnvironment() {
  const env = { ...process.env };
  delete env.L2_DB_DEFAULTS_FILE;
  delete env.L2_DB_NAME;
  return env;
}

test('database helper rejects missing configuration before a client can launch', () => {
  assert.throws(() => dbArgs({}), /L2_DB_DEFAULTS_FILE/);
  assert.throws(() => dbArgs({ L2_DB_DEFAULTS_FILE: '/explicit/private.cnf' }), /L2_DB_NAME/);
  assert.throws(() => dbArgs({ L2_DB_DEFAULTS_FILE: 'relative.cnf', L2_DB_NAME: 'fixture' }), /absolute/);
  assert.throws(() => dbArgs({ L2_DB_DEFAULTS_FILE: '/explicit/missing.cnf', L2_DB_NAME: 'fixture' }), /readable/);
});

test('database helper uses the explicit file first and preserves argument boundaries', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'elbera-db-config-'));
  try {
    const file = path.join(directory, 'private options.cnf');
    fs.writeFileSync(file, '[client]\n# synthetic option file, no credentials\n', { mode: 0o600 });
    const env = { L2_DB_DEFAULTS_FILE: file, L2_DB_NAME: 'fixture with spaces' };
    assert.deepEqual(dbArgs(env), [`--defaults-file=${file}`, '--database=fixture with spaces']);
    assert.throws(() => dbArgs({ ...env, L2_DB_DEFAULTS_FILE: directory }), /readable/);
    assert.throws(() => dbArgs({ ...env, L2_DB_NAME: '\0invalid' }), /L2_DB_NAME/);
    assert.throws(() => dbArgs({ ...env, L2_DB_NAME: '   ' }), /L2_DB_NAME/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('actual fixture imports without credentials and refuses SQL before launching a client', () => {
  const script = `
    const assert = require('node:assert/strict');
    const cp = require('node:child_process');
    let calls = 0;
    cp.execFileSync = () => { calls++; throw new Error('unexpected process launch'); };
    const fixture = require('./editor/world/live_fixture.js');
    assert.equal(typeof fixture.seed, 'function');
    assert.throws(() => fixture.sql('SELECT 1'), /L2_DB_DEFAULTS_FILE/);
    assert.equal(calls, 0);
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: root, env: withoutDbEnvironment(), encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test('actual source-only fixture audit runs without private database configuration', () => {
  const result = spawnSync(process.execPath, ['editor/world/live_fixture.js', '--check'], {
    cwd: root, env: withoutDbEnvironment(), encoding: 'utf8', timeout: 10000,
  });
  // The audit may find unrelated fixture violations. Either result must be
  // its actual source audit, not a credential gate or a database attempt.
  assert.ok(result.status === 0 || result.status === 1, result.stderr);
  assert.match(result.stdout, /LIVE-FIXTURE: (PASS|FAIL)/);
  assert.doesNotMatch(result.stderr, /L2_DB_DEFAULTS_FILE|L2_DB_NAME/);
});

test('walk-surface offline setup does not validate or read database configuration', () => {
  const filename = path.join(root, 'editor/world/verify_walksurface.js');
  const source = fs.readFileSync(filename, 'utf8');
  const boundary = source.indexOf('async function remeasureFromServer()');
  assert.ok(boundary > 0);
  let validations = 0;
  // Execute the actual shared setup, stopping before any browser/server
  // runner. Stubbing the browser import keeps this independent of Chrome.
  vm.runInNewContext(source.slice(0, boundary), {
    __dirname: path.dirname(filename),
    process: { argv: ['node', filename, '--check'], env: {} },
    console,
    require(name) {
      if (name.endsWith('db_cli.cjs')) return { dbArgs() {
        validations++;
        throw new Error('offline setup requested database configuration');
      } };
      if (name.endsWith('puppeteer-core')) return {};
      if (name === 'fs') return fs;
      if (name === 'path') return path;
      throw new Error(`unexpected setup import: ${name}`);
    },
  }, { filename });
  assert.equal(validations, 0);
});
