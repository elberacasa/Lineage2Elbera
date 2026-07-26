// Headless verification for the ElberaSkin foundation (Phase A+B).
//
// Loads ui-preview.html in real Chrome, which exercises every part of the
// skin runtime against the staged retail art: both bitmap fonts, the window
// frame, the StatusWnd gauges at their xdat geometry, and the shortcut bar.
// Fails loudly if any sprite or metric is missing rather than rendering a
// blank box.
//
// Usage: node verify_ui.js          (needs editor/world/server.py on :8083)
// Output: verify_shots/ui_skin.png + JSON summary on stdout.

const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1400,1200'],
  });
  const summary = { logs: [] };
  let failed = false;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1200 });
    page.on('console', m => summary.logs.push(m.text()));
    page.on('pageerror', e => { summary.logs.push('PAGEERROR: ' + e.message); failed = true; });
    page.on('requestfailed', r =>
      summary.logs.push('REQFAIL: ' + r.url() + ' ' + r.failure().errorText));

    await page.goto(BASE + 'ui-preview.html', { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__uiPreview', { timeout: 20000 });

    const res = await page.evaluate(() => window.__uiPreview);
    summary.result = res;

    // Sprite/metric sanity straight out of the runtime
    summary.detail = await page.evaluate(async () => {
      const { Skin } = await import('./js/ui/skin.js');
      const { Font } = await import('./js/ui/font.js');
      const { Layout } = await import('./js/ui/layout.js');
      return {
        uiScale: Skin.scale,
        statusWnd: Layout.size('StatusWnd'),
        targetWnd: Layout.size('TargetStatusWnd'),
        shortcutH: Layout.size('ShortcutWnd', 'ShortcutWndHorizontal'),
        menuWnd: Layout.size('MenuWnd'),
        chatWnd: Layout.size('ChatWnd'),
        smallLine: Font.lineHeight('small'),
        largeLine: Font.lineHeight('large'),
        windows: Layout.windowNames.length,
      };
    });

    // Measured geometry of the assembled StatusWnd — catches layout drift
    // that a screenshot only hints at.
    summary.statusGeom = await page.evaluate(() => {
      const root = document.getElementById('l2-statuswnd');
      if (!root) return null;
      const r = root.getBoundingClientRect();
      const kids = [...root.children].map(c => {
        const k = c.getBoundingClientRect();
        return { top: Math.round(k.top - r.top), h: Math.round(k.height),
                 w: Math.round(k.width) };
      });
      return { rootW: Math.round(r.width), rootH: Math.round(r.height), kids };
    });

    const shot = path.join(OUT, 'ui_skin.png');
    await page.screenshot({ path: shot, fullPage: true });
    summary.screenshot = shot;

    // Retail facts these numbers must match (decoded from Interface.xdat)
    const d = summary.detail;
    const expect = {
      'StatusWnd 176x84': d.statusWnd && d.statusWnd.w === 176 && d.statusWnd.h === 84,
      'TargetStatusWnd 176x46': d.targetWnd && d.targetWnd.w === 176 && d.targetWnd.h === 46,
      'ShortcutWnd 504x46': d.shortcutH && d.shortcutH.w === 504 && d.shortcutH.h === 46,
      'MenuWnd 173x46': d.menuWnd && d.menuWnd.w === 173 && d.menuWnd.h === 46,
      'ChatWnd 348x187': d.chatWnd && d.chatWnd.w === 348 && d.chatWnd.h === 187,
      'fonts loaded': d.smallLine === 13 && d.largeLine === 14,
      'windows decoded': d.windows >= 130,
      'preview checks': res.ok,
      'StatusWnd children inside the window': !!summary.statusGeom
        && summary.statusGeom.kids.every(
             k => k.top >= 0 && k.top + k.h <= summary.statusGeom.rootH),
    };
    summary.expect = expect;
    failed = failed || Object.values(expect).some(v => !v);

    for (const [k, v] of Object.entries(expect)) {
      console.log(`  ${v ? 'ok  ' : 'FAIL'}  ${k}`);
    }
  } catch (e) {
    summary.error = e.message;
    failed = true;
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
  console.log(failed ? 'VERIFY UI: FAIL' : 'VERIFY UI: PASS');
  process.exit(failed ? 1 : 0);
})();
