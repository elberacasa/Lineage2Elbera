// Headless render check for assembled character glTFs.
// Serves editor/characters/ and this directory from one local origin, loads the
// glTF in three.js (system Chrome, SwiftShader), poses an animation, screenshots.
//
// Setup:  cd tools/src/char_pipeline && npm install three puppeteer-core
// Usage:  node render_check.js <model-id> [animName] [timeSec] [out.png]
//         node render_check.js human_fighter_m idle 0.5 /tmp/shot.png
const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHARS = path.resolve(__dirname, '../../../editor/characters');
const PORT = 8123;

const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
              '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png'};

(async () => {
  const [id, anim = 'idle', t = '0.5', out = `/tmp/${id}_${anim}.png`, view = 'full', hide = '', ry = '0'] = process.argv.slice(2);
  if (!id) { console.error('usage: node render_check.js <model-id> [anim] [t] [out]'); process.exit(1); }

  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    let file;
    if (p === '/') file = path.join(__dirname, 'render_check.html');
    else if (p.startsWith('/chars/')) file = path.join(CHARS, p.slice(7));
    else file = path.join(__dirname, p);
    if (!file.startsWith(CHARS) && !file.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream'});
      res.end(data);
    });
  }).listen(PORT, '127.0.0.1');

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader'],
  });
  try {
    const page = await browser.newPage();
    page.on('console', m => console.error('[page]', m.text()));
    await page.goto(`http://127.0.0.1:${PORT}/?gltf=${encodeURIComponent('/chars/' + (id.includes('/') ? id : 'models/' + id) + '.gltf')}&anim=${anim}&t=${t}&view=${view}&hide=${encodeURIComponent(hide)}&ry=${ry}`);
    await page.waitForFunction('window.__done === true', {timeout: 60000});
    const err = await page.evaluate('window.__err');
    if (err) { console.error('LOAD ERROR:', err); process.exit(1); }
    const anims = await page.evaluate('window.__animCount');
    await page.screenshot({path: out});
    console.log('rendered', out, '| animations in file:', anims);
  } finally {
    await browser.close();
    server.close();
  }
})();
