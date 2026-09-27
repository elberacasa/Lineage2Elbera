// Elbera Tools: battery adapter for portable layout arithmetic/framing tests.
// No private original assets, browser, or server are read by this test suite.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', directory,
  '-p', 'test_layout_native.py'], { stdio: 'inherit', timeout: 30000 });
if (result.error) console.error('Layout tests could not run:', result.error.message);
process.exit(result.status ?? 1);
