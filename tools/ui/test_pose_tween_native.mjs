// Elbera Tools portable tween fixtures; no originals or Capstone required.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync('python3', ['-m', 'unittest', 'discover',
  '-s', fileURLToPath(new URL('.', import.meta.url)), '-p', 'test_pose_tween_native.py'],
{ stdio: 'inherit', timeout: 30000 });
if (result.error) console.error('Tween fixtures could not run:', result.error.message);
process.exit(result.status ?? 1);
