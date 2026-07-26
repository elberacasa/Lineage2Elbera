// ChatWnd verification (mock gateway on 8085): retail chrome (head strip,
// bottom band), tab strip with retail tabs + filter semantics, colored
// channels, whisper flow, sysmsg rendering, Enter-to-type input.
// Output: verify_shots/chatwnd_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085';
const OUT = path.join(__dirname, 'verify_shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { consoleLogs: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', m => summary.consoleLogs.push(m.text()));
    page.on('pageerror', e => summary.consoleLogs.push('PAGEERROR: ' + e.message));

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 30000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      'window.__world.net.log.some(m => m.op === "enterWorld")', { timeout: 20000 });
    await sleep(1500);

    summary.chrome = await page.evaluate(() => ({
      head: !!window.__world.chat.headEl,
      tabs: document.querySelectorAll('#chat-tabs button').length,
      tabLabels: [...document.querySelectorAll('#chat-tabs button')]
        .map(b => b.textContent || b.dataset.tab),
      inputMined: (() => {
        const i = document.getElementById('chat-input');
        return { left: i.style.left, top: i.style.top };
      })(),
      bottomLeft: (() => {
        const r = window.__world.chat.root.getBoundingClientRect();
        return { x: Math.round(r.x), bottom: Math.round(r.bottom) };
      })(),
    }));

    const type = async (text) => {
      await page.keyboard.press('Enter'); await sleep(250);
      await page.type('#chat-input', text);
      await page.keyboard.press('Enter'); await sleep(300);
    };
    await type('hello all');
    await type('/shout shouting now');
    await type('/trade trading now');
    await type('/w Cora secret whisper');
    await page.waitForFunction(
      `window.__world.chat.lines.some(l => l.channel === 'tell' && l.from.startsWith('Cora'))`,
      { timeout: 8000 });

    // tab filtering: 'party' tab shows only party+shout+whisper(+system)
    await page.evaluate(() => {
      [...document.querySelectorAll('#chat-tabs button')]
        .find(b => b.dataset.tab === 'party').click();
    });
    await sleep(300);
    summary.partyTabVisible = await page.evaluate(() =>
      [...document.querySelectorAll('#chat-log .line')]
        .filter(e => e.style.display !== 'none')
        .map(e => e.textContent.slice(0, 34)));
    await page.screenshot({ path: path.join(OUT, 'chatwnd_02_party_tab.png') });

    // 'all' tab shows everything again; channel classes present
    await page.evaluate(() => {
      [...document.querySelectorAll('#chat-tabs button')]
        .find(b => b.dataset.tab === 'all').click();
    });
    await sleep(300);
    // channel colors are inline styles from the DLL-mined table now
    summary.channels = await page.evaluate(() => ([...new Set(
      [...document.querySelectorAll('#chat-log .line')]
        .map(e => e.style.color)
        .filter(Boolean))]));
    summary.sysmsg = await page.evaluate(() =>
      window.__world.chat.lines.filter(l => l.kind === 'sysmsg').slice(-2));
    await page.screenshot({ path: path.join(OUT, 'chatwnd_01_all.png') });

    // whisper display convention
    summary.whisperLines = await page.evaluate(() =>
      window.__world.chat.lines.filter(l => l.channel === 'tell')
        .map(l => ({ from: l.from, text: l.text })));
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY CHAT FAILED:', e.message); process.exit(1); });
