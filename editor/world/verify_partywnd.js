// PartyWnd verification (mock gateway on 8085). Mock fixtures: an
// incoming partyAsk (Aria) 3s after enterChar; accept forms a 2-member
// party (self + Aria, Aria leader) with a 3s status tick; partyInvite
// forms a party with SELF leader; kick/leave send updated snapshots
// (a party of one disbands, like aCis).
// Flow: ask -> accept -> 2 rows w/ bars -> in-place status tick -> leave
// -> hidden -> target Aria -> invite row appears -> invite -> self
// leader -> kick -> empty -> clear target -> hidden.
// Output: verify_shots/pw_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0';
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
      'window.__world.net.connected && window.__world.net.selfId', { timeout: 15000 });

    // -- empty: window hidden, docked at the WindowsInfo.ini spot -------------
    summary.empty = await page.evaluate(() => {
      const el = document.getElementById('l2-partywnd');
      return {
        hidden: el.style.display === 'none',
        dock: { left: el.style.left, top: el.style.top },
        registered: window.__world.wndMgr.names.includes('PartyWnd'),
      };
    });

    // -- incoming ask -> Accept (fixture triggered on demand) --------------
    await page.evaluate(
      () => window.__world.net.sendOp('say', { channel: 0, text: '/partyask' }));
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'partyAsk')`, { timeout: 20000 });
    await sleep(400);
    summary.ask = await page.evaluate(() => ({
      promptVisible: window.__world.partyWnd.askWin.visible,
      from: window.__world.partyWnd.askFrom,
    }));
    await page.screenshot({ path: path.join(OUT, 'pw_01_ask.png') });
    await page.evaluate(() => {
      // the ask window's small buttons, in append order: Accept, Refuse
      const btns = [...document.querySelectorAll('#l2-partyask .l2wnd-body div')]
        .filter(d => d.style.cursor === 'pointer');
      btns[0].click();
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'partyAnswer'
        && m.accept === 1)`, { timeout: 8000 });
    await page.waitForFunction(
      'window.__world.partyWnd.members.length === 2', { timeout: 8000 });
    await sleep(400);
    summary.party = await page.evaluate(() => ({
      visible: document.getElementById('l2-partywnd').style.display === 'block',
      members: window.__world.partyWnd.members.map(m => ({
        name: m.name, leader: m.leader, hpFrac: +(m.hp / m.maxHp).toFixed(2),
      })),
      rows: document.querySelectorAll('.l2-party-row').length,
      kickButtons: document.querySelectorAll('.l2-party-kick').length,
    }));
    await page.screenshot({ path: path.join(OUT, 'pw_02_members.png') });

    // -- status tick updates the bar IN PLACE (no row rebuild) ---------------
    // element identity can't cross evaluate() (handles serialize), so tag
    // the live row in-page and check the tag survives the tick
    await page.evaluate(() => {
      window.__world.partyWnd._rows.get(80001).root.dataset.identityTag = '1';
    });
    await page.waitForFunction(
      'window.__world.partyWnd._rows.get(80001).data.hp === 450', { timeout: 10000 });
    summary.statusTick = await page.evaluate(() => ({
      hpAfter: window.__world.partyWnd._rows.get(80001).data.hp,
      sameElement:
        window.__world.partyWnd._rows.get(80001).root.dataset.identityTag === '1',
    }));
    await page.screenshot({ path: path.join(OUT, 'pw_03_tick.png') });

    // -- leave -> empty -> hidden ---------------------------------------------
    await page.evaluate(() => window.__world.partyWnd.leaveBtn.click());
    await page.waitForFunction(
      'window.__world.partyWnd.members.length === 0', { timeout: 8000 });
    summary.afterLeave = await page.evaluate(() => ({
      hidden: document.getElementById('l2-partywnd').style.display === 'none',
    }));

    // -- target Aria -> invite row appears; invite; self leader; kick ---------
    await page.evaluate(() => {
      window.__world.combat.setTarget(80001, 'Aria', { kind: 'player', level: 20 });
    });
    await sleep(400);
    summary.inviteRow = await page.evaluate(() => ({
      visible: document.getElementById('l2-partywnd').style.display === 'block',
      rows: document.querySelectorAll('.l2-party-row').length,
      inviteArmed: window.__world.partyWnd.inviteBtn.style.opacity === '1',
    }));
    await page.evaluate(() => window.__world.partyWnd.inviteBtn.click());
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'partyInvite'
        && m.name === 'Aria')`, { timeout: 8000 });
    await page.waitForFunction(
      'window.__world.partyWnd.members.length === 2', { timeout: 8000 });
    await sleep(300);
    summary.leader = await page.evaluate(() => ({
      selfLeader: window.__world.partyWnd.members[0].leader === true,
      kickButtons: document.querySelectorAll('.l2-party-kick').length,
    }));
    await page.screenshot({ path: path.join(OUT, 'pw_04_leader.png') });

    await page.evaluate(() => {
      document.querySelector('.l2-party-kick').click();
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'partyKick'
        && m.name === 'Aria')`, { timeout: 8000 });
    await page.waitForFunction(
      'window.__world.partyWnd.members.length === 0', { timeout: 8000 });
    await page.evaluate(() => window.__world.combat.clearTarget());
    await sleep(300);
    summary.afterKick = await page.evaluate(() => ({
      members: window.__world.partyWnd.members.length,
      hidden: document.getElementById('l2-partywnd').style.display === 'none',
    }));
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY PARTYWND FAILED:', e.stack || e.message); process.exit(1); });
