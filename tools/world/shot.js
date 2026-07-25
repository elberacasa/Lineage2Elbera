// shot.js - screenshot tools/world/preview.html for a given gltf.
// usage: node shot.js <gltf-url-path> <out.png>
const path = require('path');
const puppeteer = require(path.join(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules',
  'puppeteer-core'));
const CHROME =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  const [src, out] = process.argv.slice(2);
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME,
    args: ['--use-angle=metal', '--enable-webgl',
           '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  });
  const page = await browser.newPage();
  await page.setViewport({width: 660, height: 660});
  page.on('console', m => console.log('[page]', m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('http://127.0.0.1:8777/tools/world/preview.html?src=' +
                  encodeURIComponent(src));
  await page.waitForFunction(
    "window.__status && window.__status !== 'loading'", {timeout: 30000});
  const status = await page.evaluate('window.__status');
  console.log('status:', status);
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({path: out});
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
