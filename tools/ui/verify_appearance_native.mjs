// Elbera Tools: original-source appearance proof adapter, not a portable suite.
// Requires the owner's pinned original binaries and Capstone. Each checker
// reads bytes in memory; neither executes the native client or writes assets.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const inputs = ['engine.dll', 'Engine.u'].map(name => new URL(`../../assets/interlude/system/${name}`, import.meta.url));
const missing = inputs.filter(file => !existsSync(file));
if (missing.length) {
  console.error('Appearance native proof requires owned original files (not a portable test):');
  for (const file of missing) console.error(`  missing ${fileURLToPath(file)}`);
  process.exit(1);
}

for (const script of ['check_appearance_native.py', 'check_face_selection_native.py']) {
  const file = fileURLToPath(new URL(script, import.meta.url));
  const result = spawnSync('python3', [file, '--check'], {
    stdio: 'inherit', timeout: 30000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (result.error) console.error(`${script} could not run: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
