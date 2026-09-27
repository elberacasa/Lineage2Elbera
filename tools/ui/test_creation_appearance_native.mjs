// Elbera Tools portable creation-option checks; no original client files.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('.', import.meta.url));
const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', directory,
  '-p', 'test_creation_appearance_native.py'], { stdio: 'inherit', timeout: 30000 });
if (result.error) console.error('Creation option tests could not run:', result.error.message);
process.exit(result.status ?? 1);
