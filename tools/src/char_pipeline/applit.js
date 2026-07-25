const puppeteer = require('puppeteer-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHARS = path.resolve(__dirname, '../../../editor/characters');
const MIME = {'.html':'text/html','.js':'text/javascript','.gltf':'model/gltf+json','.bin':'application/octet-stream','.png':'image/png'};
(async () => {
  const [id, out] = process.argv.slice(2);
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    let file = p === '/applit.html' ? path.join(__dirname, 'applit.html')
      : (p.startsWith('/chars/') ? path.join(CHARS, p.slice(7)) : path.join(__dirname, p));
    fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, {'Content-Type': MIME[path.extname(file)]||'application/octet-stream'}); res.end(data); });
  }).listen(8126, '127.0.0.1');
  const browser = await puppeteer.launch({executablePath: CHROME, args: ['--headless=new','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:8126/applit.html?gltf=${encodeURIComponent('/chars/models/'+id+'.gltf')}`);
  await page.waitForFunction('window.__done === true', {timeout: 60000});
  await page.screenshot({path: out});
  console.log('rendered', out);
  await browser.close(); server.close();
})();
