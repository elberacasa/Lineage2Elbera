// Elbera Tools: portable hair attachment evidence boundaries, no client input.
import { spawnSync } from 'node:child_process';
import { accessSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
accessSync(new URL('./test_hair_attachment_native.py', import.meta.url));
const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s',
  fileURLToPath(new URL('.', import.meta.url)), '-p', 'test_hair_attachment_native.py'],
{ stdio: 'inherit', timeout: 30000 });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
