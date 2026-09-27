// Synthetic only. Requires POSIX sh/awk and a JDK for the independent Properties
// round trip; never starts Docker, MariaDB, loginserver or gameserver.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const deploy = path.resolve(__dirname, '..');
const writer = path.join(deploy, 'write-db-password.sh');
const baseline = '# synthetic config\nURL = unchanged\nPassword = obsolete\nOther = untouched\\ value\n';

function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'elbera-password-config-'));
  try { run(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function write(file, password) {
  const env = { ...process.env };
  delete env.DB_PASS;
  if (password !== undefined) env.DB_PASS = password;
  // The only process arguments are executable/script/configuration paths.
  return spawnSync('sh', [writer, file], { env, encoding: 'utf8' });
}

test('punctuation, whitespace and Unicode survive the actual Java Properties reader', () => fixture(directory => {
  const cases = ['ordinary', '&|\\$`"\'=:#!;%/', ' leading and trailing ', '\ttabs\t\f',
    '\\u0041 literal escape', 'Español 日本語 😀', '   ', '\u0001control\u007f'];
  const files = [], expected = {};
  for (const [index, password] of cases.entries()) {
    const file = path.join(directory, `case ${index}.properties`);
    fs.writeFileSync(file, index === 0 ? baseline.replace('Password = obsolete', '\t Password\t= obsolete') : baseline);
    const result = write(file, password);
    assert.equal(result.status, 0, `writer case ${index}: ${result.stderr}`);
    assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /^Password = (?:\\u[0-9a-f]{4})+$/m);
    assert.equal(source.replace(/^Password = .*$/m, 'Password = obsolete'), baseline);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    files.push(file); expected[`EXPECTED_${index}`] = password;
  }
  const java = `import java.util.*; import java.nio.file.*;
public class PasswordRoundTrip {
  public static void main(String[] args) throws Exception {
    for (int i=0; i<args.length; i++) {
      Properties p=new Properties();
      try (var in=Files.newInputStream(Path.of(args[i]))) { p.load(in); }
      if (!System.getenv("EXPECTED_"+i).equals(p.getProperty("Password")))
        throw new AssertionError("Password mismatch at synthetic case "+i);
      if (!"unchanged".equals(p.getProperty("URL"))) throw new AssertionError("URL changed");
      if (!"untouched value".equals(p.getProperty("Other"))) throw new AssertionError("Other changed");
    }
  }
}`;
  const source = path.join(directory, 'PasswordRoundTrip.java'); fs.writeFileSync(source, java);
  const javac = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/javac') : 'javac';
  const javaCommand = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java') : 'java';
  const compile = spawnSync(javac, [source], { encoding: 'utf8' });
  assert.equal(compile.status, 0, 'JDK required for Properties parity check: ' + (compile.error?.message || compile.stderr));
  const result = spawnSync(javaCommand, ['-cp', directory, 'PasswordRoundTrip', ...files], {
    env: { ...process.env, ...expected }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
}));

test('missing, empty and newline input fail without modifying configuration or logging the value', () => fixture(directory => {
  const file = path.join(directory, 'server.properties');
  for (const password of [undefined, '', 'before\nafter', 'before\rafter', 'before\r\nafter']) {
    fs.writeFileSync(file, baseline);
    const result = write(file, password);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DB_PASS:/);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.includes('before'), false);
    assert.equal(fs.readFileSync(file, 'utf8'), baseline);
    assert.deepEqual(fs.readdirSync(directory), ['server.properties']);
  }
}));

test('missing or duplicate Password assignments are rejected atomically', () => fixture(directory => {
  const file = path.join(directory, 'server.properties');
  for (const original of ['URL = unchanged\n', baseline + 'Password=duplicate\n']) {
    fs.writeFileSync(file, original);
    const result = write(file, 'synthetic');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exactly one Password assignment/);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    assert.deepEqual(fs.readdirSync(directory), ['server.properties']);
  }
}));

test('both image entrypoints use the shared writer before other config edits', () => {
  for (const kind of ['gameserver', 'loginserver']) {
    const source = fs.readFileSync(path.join(deploy, `entrypoint-${kind}.sh`), 'utf8');
    assert.match(source, /export DB_PASS\nsh \/usr\/local\/lib\/elbera\/write-db-password\.sh "\$CFG"/);
    assert.ok(source.indexOf('write-db-password.sh') < source.indexOf('sed -i'));
    assert.equal(source.split('\n').some(line => line.includes('sed ') && line.includes('DB_PASS')), false);
    const docker = fs.readFileSync(path.join(deploy, `Dockerfile.${kind}`), 'utf8');
    assert.match(docker, /COPY write-db-password\.sh java-password\.awk \/usr\/local\/lib\/elbera\//);
    assert.match(docker, /command -v awk/); assert.match(docker, /command -v mktemp/);
  }
});
