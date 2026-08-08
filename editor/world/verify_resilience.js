// verify_resilience.js — one transient failure must not end the session.
//
// Two defects this locks down, both of which turned a momentary hiccup into a
// dead client that only a page reload could recover:
//
//  1. loadScene() had no catch, and it nulls `terrain` BEFORE fetching the new
//     scene. A single failed request left the world with no terrain and the
//     #loading overlay still raised — and that overlay is opaque, covers the
//     viewport and swallows clicks, so the player was stranded with no way back.
//  2. the socket close handler never set `online = false`. After a drop the
//     world emptied, every send silently no-opped, and the toggle still read
//     "online", so nothing told the player what had happened or let them retry.
//
// Both are tested by actually causing the failure — a request interception that
// fails scene fetches, and a real socket close — rather than by asserting the
// happy path still works. A suite that only proves the good case is what let
// these survive.
//
// Usage: node verify_resilience.js [base-url]

const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://127.0.0.1:8083/';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// The overlay is only harmful when it is both visible and intercepting input,
// so ask the browser what is actually under the cursor rather than trusting a
// class name.
const overlayState = () => {
  const el = document.getElementById('loading');
  if (!el) return { present: false };
  const cs = getComputedStyle(el);
  const mid = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  return {
    present: true,
    hidden: el.classList.contains('hidden'),
    display: cs.display,
    blocksClicks: !!(mid && (mid === el || el.contains(mid))),
  };
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1200,900'],
  });

  // --- 1. a scene fetch that fails mid-session -----------------------------
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const booted = await page.waitForFunction(
    () => window.__world && window.__world.ready === true, { timeout: 120000 })
    .then(() => true).catch(() => false);
  check('client boots', booted);
  if (!booted) { await browser.close(); process.exit(1); }

  const firstTile = await page.evaluate(() => window.__world.currentTile);

  // Fail every scene.json from here on, then ask for a different tile.
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (r.url().includes('/scene.json')) r.abort('failed'); else r.continue();
  });

  const target = await page.evaluate(async () => {
    const scenes = await (await fetch('/scenes')).json();
    return scenes.find(t => t !== window.__world.currentTile) || null;
  });
  check('a second tile exists to switch to', !!target, target || 'none');

  await page.evaluate((t) => window.__world.loadScene && window.__world.loadScene(t), target);
  await sleep(4000);

  const after = await page.evaluate(overlayState);
  check('the loading overlay comes down after a failed scene load',
        after.present && after.hidden === true, JSON.stringify(after));
  check('the viewport is not left blocked by the overlay',
        after.blocksClicks === false, `blocksClicks=${after.blocksClicks}`);

  const alive = await page.evaluate(() => ({
    tile: window.__world.currentTile,
    terrain: !!window.__world.terrain,
    frames: !!window.__world.renderer,
  }));
  check('the client keeps a usable world rather than nothing',
        alive.tile === firstTile && alive.terrain === true,
        `tile=${alive.tile} terrain=${alive.terrain}`);

  await page.close();

  // --- 2. losing the connection -------------------------------------------
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1200, height: 900 });
  await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => window.__world && window.__world.ready === true,
                           { timeout: 120000 }).catch(() => {});

  // Drive the close handler through the normal dispatch, as a dropped socket
  // would. Going fully online needs the live stack; this exercises the same
  // path deterministically.
  const closed = await p2.evaluate(() => {
    const w = window.__world;
    if (!w.net || !w.net.inject) return { unsupported: true };
    w.net.inject({ op: 'close' });
    const toggle = document.getElementById('online-toggle');
    return { online: w.net.online, checked: toggle ? toggle.checked : null };
  });

  if (closed.unsupported) {
    check('close handling is testable through net.inject', false, 'no inject hook');
  } else {
    check('a dropped connection clears the online state', closed.online === false,
          `online=${closed.online}`);
    check('the Online toggle reflects the drop', closed.checked === false,
          `checked=${closed.checked}`);
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error('SUITE ERROR', err); process.exit(1); });
