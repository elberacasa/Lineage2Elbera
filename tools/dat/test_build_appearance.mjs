// Elbera Tools: source-free face binding tests; no original asset access.
import { spawnSync } from 'node:child_process';
import { accessSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
accessSync(new URL('./test_build_appearance.py', import.meta.url));
const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s',
  fileURLToPath(new URL('.', import.meta.url)), '-p', 'test_build_appearance.py'], { stdio: 'inherit', timeout: 30000 });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
