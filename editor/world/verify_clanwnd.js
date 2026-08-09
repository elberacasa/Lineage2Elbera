// ClanWnd verification (mock gateway on 8085). Flow:
//   login -> clanInfo + clanMembers (ElberaGuard, led by Aria) fill the window
//   fields/list/buttons render from the mined ClanWnd geometry
//   Leave click -> clanLeave -> clanInfo{id:0} clears everything
//   '/clanask' -> prompt -> Accept -> clanAnswer{1} -> clan restored
// Output: verify_shots/clan_*.png + JSON summary.
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
  const fail = (msg) => { summary.error = msg; };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', m => summary.consoleLogs.push(m.text()));
    page.on('pageerror', e => summary.consoleLogs.push('PAGEERROR: ' + e.message));

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 30000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'clanInfo')
       && window.__world.clanWnd`, { timeout: 20000 });
    await sleep(1500);   // font sheets + sysstring.json + classicons.json land async

    // -- open the window via the Alt+N keybind -------------------------------
    await page.keyboard.down('Alt');
    await page.keyboard.press('KeyN');
    await page.keyboard.up('Alt');
    await page.waitForFunction('window.__world.clanWnd.visible', { timeout: 8000 });
    await sleep(400);

    summary.state = await page.evaluate(() => {
      const w = window.__world.clanWnd;
      const txt = el => (el && el.__l2text || '').split('|')[0];
      const rows = [...document.querySelectorAll('#l2-clanwnd [data-member]')];
      const btn = (id) => document.querySelector(`#l2-clanwnd [data-btn="${id}"]`);
      const body = document.querySelector('#l2-clanwnd .l2wnd-body');
      const iconOf = (name) => {
        const row = rows.find(r => r.dataset.member === name);
        return row ? [...row.querySelectorAll('div')]
          .map(d => d.style.backgroundImage).filter(Boolean) : [];
      };
      return {
        bodySize: body && { w: body.offsetWidth, h: body.offsetHeight },
        name: txt(w.nameEl), master: txt(w.masterEl), level: txt(w.levelEl),
        agit: txt(w.agitEl), status: txt(w.statusEl), count: txt(w.countEl),
        combo: txt(w.comboEl.firstChild),
        header: [...w.headerEl.children].map(c => txt(c)),
        members: rows.map(r => r.dataset.member),
        selfWhite: null, // filled below
        ariaIcon: iconOf('Aria'),
        borgIcon: iconOf('Borg'),
        leaveOpacity: btn('ClanQuitBtn') && btn('ClanQuitBtn').style.opacity,
        inviteOpacity: btn('ClanAskJoinBtn') && btn('ClanAskJoinBtn').style.opacity,
        boardOpacity: btn('ClanBoardBtn') && btn('ClanBoardBtn').style.opacity,
        oustMarks: [...document.querySelectorAll('#l2-clanwnd [data-member] div')]
          .filter(d => (d.__l2text || '').startsWith('x')).length,
        registered: window.__world.wndMgr.names.includes('ClanWnd'),
      };
    });
    summary.state.selfWhite = await page.evaluate(() => {
      const w = window.__world.clanWnd;
      const self = [...document.querySelectorAll('#l2-clanwnd [data-member]')]
        .find(r => r.dataset.member && r.dataset.member !== 'Aria' && r.dataset.member !== 'Borg');
      if (!self) return null;
      const cell = self.querySelector('div');
      return cell && (cell.__l2text || '').includes('#ffffff');
    });
    await page.screenshot({ path: path.join(OUT, 'clan_window.png') });

    // -- Leave: click -> clanLeave out -> clanInfo{id:0} clears the window ---
    await page.evaluate(() => {
      document.querySelector('#l2-clanwnd [data-btn="ClanQuitBtn"]').click();
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'clanLeave')`,
      { timeout: 8000 });
    await page.waitForFunction(
      `window.__world.clanWnd.clan === null`, { timeout: 8000 });
    await sleep(300);
    summary.afterLeave = await page.evaluate(() => {
      const w = window.__world.clanWnd;
      const txt = el => (el && el.__l2text || '').split('|')[0];
      return {
        name: txt(w.nameEl), count: txt(w.countEl),
        rows: document.querySelectorAll('#l2-clanwnd [data-member]').length,
        leaveOpacity: document.querySelector('#l2-clanwnd [data-btn="ClanQuitBtn"]').style.opacity,
      };
    });
    await page.screenshot({ path: path.join(OUT, 'clan_left.png') });

    // -- '/clanask' -> prompt -> Accept -> clan restored ----------------------
    await page.evaluate(() => {
      const input = document.getElementById('chat-input');
      input.value = '/clanask';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'clanAsk')`, { timeout: 8000 });
    await sleep(400);
    summary.askShown = await page.evaluate(() => {
      const ask = document.getElementById('l2-clanask');
      return ask && ask.style.display !== 'none'
        && (ask.__l2text || document.body.textContent) ? true : false;
    });
    await page.screenshot({ path: path.join(OUT, 'clan_ask.png') });
    // Accept = first small button in the ask window
    await page.evaluate(() => {
      [...document.querySelectorAll('#l2-clanask .l2wnd-body > div:last-child > div')][0].click();
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'clanAnswer'
        && m.accept === 1)`, { timeout: 8000 });
    await page.waitForFunction(
      `window.__world.clanWnd.clan && window.__world.clanWnd.clan.id === 4711`,
      { timeout: 8000 });
    await sleep(300);
    summary.rejoined = await page.evaluate(() => ({
      rows: document.querySelectorAll('#l2-clanwnd [data-member]').length,
      leaveOpacity: document.querySelector('#l2-clanwnd [data-btn="ClanQuitBtn"]').style.opacity,
    }));
    await page.screenshot({ path: path.join(OUT, 'clan_rejoined.png') });

    // -- assertions -----------------------------------------------------------
    const s = summary.state;
    const checks = {
      registered: s.registered === true,
      bodyGeometry: s.bodySize && s.bodySize.w === 256 && s.bodySize.h === 335,
      fields: s.name === 'ElberaGuard' && s.master === 'Aria' && s.level === '5'
        && s.agit === 'None' && s.status === '' && s.count === '(2/3)',
      combo: s.combo === 'Main Clan - ElberaGuard',
      header: s.header.join(',') === 'Name,Lv,Cls,Status',
      members: s.members.length === 3 && s.members.includes('Aria')
        && s.members.includes('Borg'),
      selfWhite: s.selfWhite === true,
      ariaClassIcon: s.ariaIcon.some(u => u.includes('party_styleicon1_2')),
      ariaOnline: s.ariaIcon.some(u => u.includes('BloodHood_Logon')),
      borgOffline: s.borgIcon.some(u => u.includes('BloodHood_Logoff')),
      leaveEnabled: s.leaveOpacity === '1',
      inviteDisabledNoTarget: s.inviteOpacity === '0.45',
      boardDisabled: s.boardOpacity === '0.45',
      noOustForMember: s.oustMarks === 0,
      leaveCleared: summary.afterLeave.name === '' && summary.afterLeave.rows === 0
        && summary.afterLeave.leaveOpacity === '0.45',
      askShown: summary.askShown === true,
      rejoined: summary.rejoined.rows === 3 && summary.rejoined.leaveOpacity === '1',
    };
    summary.checks = checks;
    summary.pass = Object.values(checks).every(Boolean);
    if (!summary.pass) fail('one or more checks failed');
  } catch (e) {
    fail(e.message);
    summary.consoleLogs.push('FATAL: ' + e.message);
  } finally {
    fs.writeFileSync(path.join(OUT, 'clan_summary.json'), JSON.stringify(summary, null, 1));
    await browser.close();
  }
  console.log(JSON.stringify(summary.checks || summary, null, 1));
  process.exit(summary.pass ? 0 : 1);
})();
