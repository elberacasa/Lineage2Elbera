// Elbera Tools portable PE/comparison tests; synthetic bytes, no client inputs.
import { spawnSync } from 'node:child_process';
import { accessSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
accessSync(new URL('./test_supplemental_pe.py', import.meta.url));
const directory = fileURLToPath(new URL('.', import.meta.url));
const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', directory,
  '-p', 'test_supplemental_pe.py'], { stdio: 'inherit', timeout: 30000 });
if (result.error) console.error('Supplemental PE tests could not run:', result.error.message);
process.exit(result.status ?? 1);
