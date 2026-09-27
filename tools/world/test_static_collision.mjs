// Elbera Tools: battery adapter for portable static collision framing tests.
// No private original assets, browser, or server are read by this test suite.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', directory,
  '-p', 'test_static_collision.py'], { stdio: 'inherit', timeout: 30000 });
if (result.error) console.error('Static collision tests could not run:', result.error.message);
process.exit(result.status ?? 1);
