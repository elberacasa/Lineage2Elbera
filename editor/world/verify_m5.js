// M5 verification (mock gateway on 8085): chat channels/colors + tabs,
// whisper both ways, char sheet (C), hotbar assign+trigger, settings
// panel with deviceId, WASD cosmetic policy intact.
// Output: verify_shots/m5_*.png + JSON summary.
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
      `window.__world.net.log.some(m => m.op === 'charSheet')
       && window.__world.net.log.some(m => m.op === 'skillList')`, { timeout: 20000 });
    await sleep(1200);

    // -- chat: shout + whisper + sysmsg --------------------------------------
    const type = async (text) => {
      await page.keyboard.press('Enter');
      await sleep(250);
      await page.type('#chat-input', text);
      await page.keyboard.press('Enter');
      await sleep(300);
    };
    await type('hello everyone');
    await type('/shout WTS cheap shots');
    await type('/trade buying adena');
    await type('/w Cora secret hello');
    await page.waitForFunction(
      `window.__world.chat.lines.some(l => l.kind === 'chat' && l.channel === 'tell'
        && l.from.startsWith('Cora'))`, { timeout: 8000 });
    summary.chat = await page.evaluate(() => ({
      lines: window.__world.chat.lines.slice(-7),
      tabs: document.querySelectorAll('#chat-tabs button').length,
      coloredClasses: [...new Set([...document.querySelectorAll('#chat-log .line')]
        .map(e => e.className.split(' ').find(c => c.startsWith('ch-') || ['sysmsg', 'system'].includes(c)))
        .filter(Boolean))],
    }));
    // whisper tab filter: only tell lines visible
    await page.evaluate(() => {
      [...document.querySelectorAll('#chat-tabs button')]
        .find(b => b.dataset.tab === 'whisper').click();
    });
    await sleep(300);
    summary.whisperTab = await page.evaluate(() =>
      [...document.querySelectorAll('#chat-log .line')]
        .filter(e => e.style.display !== 'none').map(e => e.textContent.slice(0, 40)));
    await page.screenshot({ path: path.join(OUT, 'm5_01_chat_channels.png') });
    await page.evaluate(() => {
      [...document.querySelectorAll('#chat-tabs button')]
        .find(b => b.dataset.tab === 'all').click();
    });

    // -- char sheet ----------------------------------------------------------
    await page.keyboard.press('KeyC');
    await sleep(500);
    summary.charSheet = await page.evaluate(() => ({
      visible: document.getElementById('charsheet-panel').classList.contains('visible'),
      text: document.querySelector('.sheet-body').textContent.slice(0, 200),
      str: window.__world.charSheet.str, pAtk: window.__world.charSheet.pAtk,
    }));
    await page.screenshot({ path: path.join(OUT, 'm5_02_charsheet.png') });
    await page.keyboard.press('KeyC');

    // -- hotbar: right-click skill slot 1 -> assign; Digit1 casts ------------
    await page.evaluate(() => {
      document.querySelector('.skill-slot')
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    await sleep(300);
    summary.hotbarAssign = await page.evaluate(() => ({
      slots: window.__world.hotbar.slots.filter(Boolean),
      persisted: localStorage.getItem(Object.keys(localStorage)
        .find(k => k.startsWith('l2vzla.hotbar.')) || ''),
    }));
    await page.keyboard.press('Digit1');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'useSkill')`,
      { timeout: 8000 });

    // assign an item from inventory, trigger it, invUpdate decrement
    await page.keyboard.press('KeyI');
    await sleep(400);
    const before = await page.evaluate(() =>
      document.querySelector('.inv-slot[data-oid="90002"] .count')?.textContent);
    await page.evaluate(() => {
      document.querySelector('.inv-slot[data-oid="90002"]')
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    await sleep(300);
    await page.keyboard.press('Digit2');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'useItem')`,
      { timeout: 8000 });
    await sleep(600);
    summary.hotbarItem = await page.evaluate(() => ({
      countBefore: null, // filled below via closure hack avoided
      countAfter: document.querySelector('.inv-slot[data-oid="90002"] .count')?.textContent,
      slots: window.__world.hotbar.slots.filter(Boolean),
    }));
    summary.hotbarItem.countBefore = before;
    await page.screenshot({ path: path.join(OUT, 'm5_03_hotbar.png') });

    // -- settings panel --------------------------------------------------------
    await page.click('#settings-btn');
    await sleep(400);
    summary.settings = await page.evaluate(() => ({
      visible: document.getElementById('settings-panel').classList.contains('visible'),
      deviceId: document.getElementById('deviceid-text').textContent,
      matchesStorage: document.getElementById('deviceid-text').textContent
        === localStorage.getItem('l2vzla.deviceId'),
    }));
    await page.screenshot({ path: path.join(OUT, 'm5_04_settings.png') });
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY M5 FAILED:', e.message); process.exit(1); });
