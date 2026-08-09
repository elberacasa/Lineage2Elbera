// PartyWnd LIVE pass: two headless clients on the REAL stack
// (aCis :2106/:7777 + gateway :8090), separate profiles -> separate
// deviceIds -> separate accounts/characters.
//   A invites B by NAME (partyInvite is name-based, RequestJoinParty) ->
//   B gets partyAsk -> B accepts -> BOTH see a 2-row party window with
//   bars -> screenshots from both sides.
// Output: verify_shots/pw_live_A.png, pw_live_B.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
  await page.click('#online-toggle');
  await page.waitForFunction(
    'window.__world.net.connected && window.__world.net.log.some(m => m.op === "enterWorld")',
    { timeout: 120000 });
  return { browser, page };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const summary = {};
  const A = await launch();
  const B = await launch();
  try {
    const nameA = await A.page.evaluate(
      () => window.__world.net.log.find(m => m.op === 'enterWorld').char.name);
    const nameB = await B.page.evaluate(
      () => window.__world.net.log.find(m => m.op === 'enterWorld').char.name);
    summary.names = { A: nameA, B: nameB };
    await sleep(2000);

    // A invites B by name
    await A.page.evaluate((n) => {
      window.__world.net.sendOp('partyInvite', { name: n });
    }, nameB);

    // B gets the ask prompt and accepts
    await B.page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'partyAsk')
       && window.__world.partyWnd.askWin.visible`, { timeout: 30000 });
    summary.bAsk = await B.page.evaluate(() => ({
      from: window.__world.partyWnd.askFrom,
    }));
    await B.page.evaluate(() => {
      const btns = [...document.querySelectorAll('#l2-partyask .l2wnd-body div')]
        .filter(d => d.style.cursor === 'pointer');
      btns[0].click();   // Accept
    });

    for (const [tag, c] of [['A', A], ['B', B]]) {
      await c.page.waitForFunction(
        'window.__world.partyWnd.members.length === 2', { timeout: 30000 });
      await sleep(500);
      summary['party' + tag] = await c.page.evaluate(() => ({
        members: window.__world.partyWnd.members.map(m => ({
          name: m.name, leader: m.leader,
          hpFrac: +(m.hp / m.maxHp).toFixed(2),
        })),
        rows: document.querySelectorAll('.l2-party-row').length,
        visible: document.getElementById('l2-partywnd').style.display === 'block',
      }));
      await c.page.screenshot({ path: path.join(OUT, `pw_live_${tag}.png`) });
    }
  } finally {
    await A.browser.close();
    await B.browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY PARTYWND LIVE FAILED:', e.stack || e.message); process.exit(1); });
