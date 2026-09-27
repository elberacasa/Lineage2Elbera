// Elbera Tools battery adapter: portable qualified-prop identity regressions.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', directory,
  '-p', 'test_prop_identity.py'], { stdio: 'inherit', timeout: 30000 });
if (result.error) console.error('Prop identity tests could not run:', result.error.message);
process.exit(result.status ?? 1);
