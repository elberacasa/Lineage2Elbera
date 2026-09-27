// Elbera Tools portable quaternion fixtures; no originals or Capstone needed.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('.', import.meta.url));
const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', directory,
  '-p', 'test_quaternion_native.py'], { stdio: 'inherit', timeout: 30000 });
if (result.error) console.error('Quaternion fixtures could not run:', result.error.message);
process.exit(result.status ?? 1);
