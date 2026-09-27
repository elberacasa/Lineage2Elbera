// Elbera Tools: source-free default hair selection and texture decode checks.
import { spawnSync } from 'node:child_process';
import { accessSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
accessSync(new URL('./test_default_hair_bindings.py', import.meta.url));
const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s',
  fileURLToPath(new URL('.', import.meta.url)), '-p', 'test_default_hair_bindings.py'],
{ stdio: 'inherit', timeout: 30000 });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
