// Dump three.js-skinned outlier vertices for a model (see debug_skin.html).
// Usage: node debug_skin.js <model-id> [anim] [t] [meshName]
const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHARS = path.resolve(__dirname, '../../../editor/characters');
const PORT = 8124;
const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
              '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png'};

(async () => {
  const [id, anim = 'idle', t = '0.5', mesh = ''] = process.argv.slice(2);
  if (!id) { console.error('usage: node debug_skin.js <model-id> [anim] [t] [mesh]'); process.exit(1); }
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    let file;
    if (p === '/') file = path.join(__dirname, 'debug_skin.html');
    else if (p.startsWith('/chars/')) file = path.join(CHARS, p.slice(7));
    else file = path.join(__dirname, p);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream'});
      res.end(data);
    });
  }).listen(PORT, '127.0.0.1');
  const browser = await puppeteer.launch({executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/?gltf=${encodeURIComponent('/chars/models/' + id + '.gltf')}&anim=${anim}&t=${t}&mesh=${encodeURIComponent(mesh)}`);
    await page.waitForFunction('window.__done === true', {timeout: 60000});
    const err = await page.evaluate('window.__err');
    if (err) { console.error('LOAD ERROR:', err); process.exit(1); }
    console.log(JSON.stringify(await page.evaluate('window.__report'), null, 1));
    console.log('BONEWORLD', JSON.stringify(await page.evaluate('window.__boneworld')));
  } finally {
    await browser.close();
    server.close();
  }
})();
