// Elbera Tools source-only package checks; no original input or service.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('.', import.meta.url));
const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', directory,
  '-p', 'test_build_npc_source.py'], { stdio: 'inherit', timeout: 90000 });
if (result.error) console.error('NPC Source release tests could not run:', result.error.message);
process.exit(result.status ?? 1);
