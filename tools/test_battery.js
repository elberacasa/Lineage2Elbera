#!/usr/bin/env node
'use strict';

// Exercise the real runner in a disposable tree. Only one solo fixture runs;
// no game, database, browser, shared mock, or process-name cleanup is invoked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const source = fs.readFileSync(path.join(__dirname, 'battery.sh'), 'utf8');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'battery-runner-'));
const runner = path.join(temp, 'tools', 'battery.sh');
const logs = path.join(temp, 'logs');
const baseArgs = ['--check', '--selftest'];
const tooltipRow = 'verify_tooltip.js|--check|--selftest';

function write(relative, contents, mode) {
  const dest = path.join(temp, relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, contents, { mode });
}

function invoke(mode, extraEnv = {}) {
  const result = spawnSync('/bin/bash', [runner, mode], {
    cwd: temp,
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      PATH: `${path.join(temp, 'bin')}${path.delimiter}${process.env.PATH}`,
      BATTERY_LOGDIR: logs,
      BATTERY_ONLY: 'verify_tooltip',
      BATTERY_TIMEOUT: '10',
      BATTERY_FIXTURE_ARGS: JSON.stringify(baseArgs),
      BATTERY_FIXTURE_EXIT: '0',
      BATTERY_FORBIDDEN_CLEANUP: path.join(temp, 'unexpected-process-cleanup'),
      ...extraEnv,
    },
  });
  assert.ifError(result.error);
  return { ...result, output: result.stdout + result.stderr };
}

try {
  // Make every registered script exist so --list can run its normal audit.
  // The placeholders are never selected for execution.
  const table = source.match(/^SUITES=\(\n([\s\S]*?)^\)/m);
  assert.ok(table, 'suite table exists');
  for (const match of table[1].matchAll(/^"([^"\n]+)"$/gm)) {
    const fields = match[1].split('|');
    write(path.join(fields[2], fields[4]), 'process.exit(0);\n');
  }
  // The battery's port preflight is irrelevant to this isolated fixture.
  write('bin/nc', '#!/bin/sh\nexit 0\n', 0o755);
  // Fail safely even if a future regression reaches the old timeout cleanup.
  // A harness test must never kill unrelated processes on the developer's Mac.
  write('bin/pkill', '#!/bin/sh\nprintf forbidden > "$BATTERY_FORBIDDEN_CLEANUP"\nexit 99\n', 0o755);
  write('editor/world/verify_tooltip.js', `
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
assert.deepEqual(args, JSON.parse(process.env.BATTERY_FIXTURE_ARGS));
console.log('ACTUAL_ARGV=' + JSON.stringify(args));
if (process.argv.includes('--check')) process.exit(Number(process.env.BATTERY_FIXTURE_EXIT));
`);
  write('tools/battery.sh', source, 0o755);

  let result = invoke('--solo-only');
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /1 passed, 0 failed/);
  assert.ok(fs.readFileSync(path.join(logs, 'verify_tooltip.log'), 'utf8')
    .includes('ACTUAL_ARGV=' + JSON.stringify(baseArgs)), 'flags reach the child separately');

  result = invoke('--solo-only', { BATTERY_FIXTURE_EXIT: '17' });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /0 passed, 1 failed/);
  assert.match(result.output, /exit 17/);
  assert.ok(fs.existsSync(path.join(logs, 'verify_tooltip.attempt1.log')),
    'a failed retry remains a failure');

  // More than two arguments, including a single positional value with spaces,
  // must survive without shell splitting or an arbitrary argument-count cap.
  const extendedArgs = [...baseArgs, '--third', 'literal value with spaces'];
  assert.ok(source.includes(tooltipRow), 'tooltip has explicit argument fields');
  write('tools/battery.sh', source.replace(tooltipRow,
    `${tooltipRow}|--third|literal value with spaces`));
  result = invoke('--solo-only', { BATTERY_FIXTURE_ARGS: JSON.stringify(extendedArgs) });
  assert.equal(result.status, 0, result.output);

  // Reintroduce the actual false-green table defect: --list and execution
  // must both reject it before starting any test process.
  write('tools/battery.sh', source.replace(tooltipRow,
    'verify_tooltip.js|--check --selftest'));
  for (const mode of ['--list', '--solo-only']) {
    result = invoke(mode);
    assert.equal(result.status, 2, result.output);
    assert.match(result.output, /INVALID ARGUMENT: verify_tooltip/);
    assert.doesNotMatch(result.output, /^started:/m);
  }

  // A similar-looking option is not the --check that enables failure exits.
  write('tools/battery.sh', source.replace(tooltipRow,
    'verify_tooltip.js|--check-report|--selftest'));
  result = invoke('--list');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /NEEDS --check: verify_tooltip/);

  write('tools/battery.sh', source);
  result = invoke('--list');
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /solo\s+verify_markprojector\s/);
  assert.match(result.output, /live\s+verify_nameplate_color\s/);
  assert.equal(fs.existsSync(path.join(temp, 'unexpected-process-cleanup')), false,
    'no process-name cleanup was attempted');
  console.log('PASS battery runner: separate flags, literal argv, failure exit, and table validation');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
