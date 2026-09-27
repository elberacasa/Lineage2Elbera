// Elbera Tools portable equation checks; no private assets or browser required.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('.', import.meta.url));
const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', directory,
  '-p', 'test_camera_native.py'], { stdio: 'inherit', timeout: 30000 });
if (result.error) console.error('Camera source tests could not run:', result.error.message);
process.exit(result.status ?? 1);
