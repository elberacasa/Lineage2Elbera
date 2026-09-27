// Elbera Tools portable release-boundary checks; no private input or service.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('.', import.meta.url));
const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', directory,
  '-p', 'test_build_core.py'], { stdio: 'inherit', timeout: 30000 });
if (result.error) console.error('Tools release tests could not run:', result.error.message);
process.exit(result.status ?? 1);
