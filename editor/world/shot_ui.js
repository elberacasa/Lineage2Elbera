// shot_ui.js — open the client, show a set of windows, screenshot them.
//
// A working tool for looking at the UI, not a pass/fail suite: the retail
// windows are judged by eye against the real client, so what this produces is
// evidence to inspect, not an assertion.
//
// Usage: node shot_ui.js [outdir] [base-url]

const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.argv[2] || path.join(__dirname, 'ui_shots');
const BASE = process.argv[3] || 'http://127.0.0.1:8083/';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1600,1000',
           '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const logs = [];
  page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') logs.push('ERR ' + m.text()); });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__world && window.__world.ready === true,
                             { timeout: 120000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  await page.screenshot({ path: path.join(OUT, '00-world.png') });

  // Open windows by their retail shortcuts, one shot each, then close so the
  // next one is not judged through a stack of overlapping frames.
  const keys = [
    ['KeyV', '01-inventory'],
    ['KeyK', '02-skills'],
    ['KeyT', '03-charsheet'],
    ['KeyX', '04-systemmenu'],
    ['KeyC', '05-actions'],
    ['KeyU', '06-quests'],
  ];
  // The client's key handler switches on event.code ('KeyV'), so the event has
  // to carry a real code — pressing the character 'v' does nothing.
  for (const [code, name] of keys) {
    // Retail keymap: these windows are Alt+letter, not the bare letter, and
    // the handler switches on event.code — so the event needs both.
    await page.evaluate((c) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: c, altKey: true, bubbles: true }));
    }, code);
    await new Promise(r => setTimeout(r, 1200));
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  }
  // everything at once, the way a player actually has it
  await page.screenshot({ path: path.join(OUT, '07-all-windows.png') });

  fs.writeFileSync(path.join(OUT, 'console.txt'), logs.join('\n'));
  console.log(`shots -> ${OUT}`);
  console.log(logs.length ? `console errors:\n${logs.slice(0, 15).join('\n')}` : 'no console errors');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
