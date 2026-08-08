// verify_audio.js — the retail audio layer, checked in a real browser.
//
// Headless Chrome cannot be made to actually emit sound, so what this asserts
// is everything up to the speaker: the build products are served, the engine
// builds its graph, the bindings resolve to real files, and a decode of a real
// game sound succeeds. It also asserts the client still boots when the audio
// build is absent, because assets/audio/ is gitignored and a fresh clone has
// none of it.
//
// Autoplay policy: Chrome refuses to start an AudioContext without a gesture,
// so we launch with --autoplay-policy=no-user-gesture-required. That is a test
// affordance only — in the real client audio.resume() rides the first click.
//
// Usage: node verify_audio.js [base-url]      (default http://127.0.0.1:8083)

const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://127.0.0.1:8083';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    // --use-angle=swiftshader is what the other suites use; --use-gl fails to
    // create a context here and main.js then throws before it can expose
    // window.__world, which reads as an audio failure but is not one.
    args: ['--headless=new', '--use-angle=swiftshader',
           '--autoplay-policy=no-user-gesture-required',
           '--window-size=1400,1200'],
  });
  const page = await browser.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  // The engine is constructed during boot()'s Promise.all; wait for it to
  // report ready rather than sleeping a fixed time.
  await page.waitForFunction(
    () => window.__world && window.__world.audio && window.__world.audio.ready === true,
    { timeout: 30000 }).catch(() => {});

  const state = await page.evaluate(async () => {
    const w = window.__world || {};
    const a = w.audio, g = w.gameSound;
    if (!a) return { noEngine: true };
    a.resume();

    // Decode a real game sound end to end: fetch -> decodeAudioData -> buffer.
    let decoded = null;
    try {
      const buf = await a._buffer('monsound.gremlin_dmg_1');
      decoded = buf ? { channels: buf.numberOfChannels, duration: buf.duration } : null;
    } catch (e) { decoded = { error: String(e) }; }

    // A reference the game data carries but that has no file must resolve to
    // null quietly, not throw — six of NCSoft's own references are malformed.
    let missingHandled = true;
    try { await a._buffer('itemsound.does_not_exist_at_all'); }
    catch { missingHandled = false; }

    const rec = g && g.ready ? g.npc['20001'] : null;

    return {
      ready: a.ready,
      ctxState: a.ctx && a.ctx.state,
      sfxCount: a.manifest ? Object.keys(a.manifest.sfx).length : 0,
      musicCount: a.manifest ? a.manifest.music.length : 0,
      buses: Object.keys(a.buses || {}),
      decoded,
      missingHandled,
      bindingsReady: !!(g && g.ready),
      gremlin: rec ? (rec.m || []).map(i => g.names[i]) : null,
    };
  });

  if (state.noEngine) {
    check('audio engine exposed on window', false,
          'window.__world && window.__world.audio missing — main.js must expose it for this suite');
  } else {
    check('engine ready', state.ready === true);
    check('audio graph built', (state.buses || []).length === 4,
          `buses: ${(state.buses || []).join(',')}`);
    check('manifest complete', state.sfxCount > 5000 && state.musicCount === 250,
          `${state.sfxCount} sfx / ${state.musicCount} music`);
    check('bindings loaded', state.bindingsReady === true);
    check('gremlin damage bank resolves', Array.isArray(state.gremlin) && state.gremlin.length === 3,
          state.gremlin ? state.gremlin.join(', ') : 'none');
    check('real sound decodes to mono', !!state.decoded && state.decoded.channels === 1,
          state.decoded ? `${state.decoded.channels}ch ${state.decoded.duration.toFixed(2)}s` : 'decode failed');
    check('absent reference degrades quietly', state.missingHandled === true);
  }

  // --- the world soundscape ------------------------------------------------
  // Talking Island's tile carries both kinds of placed audio. Assert the tile
  // data loads, that emitters get culled rather than all started, and that
  // standing inside a MusicVolume selects its track.
  await page.waitForFunction(() => window.__world.currentTile, { timeout: 60000 }).catch(() => {});

  const world = await page.evaluate(async () => {
    const w = window.__world;
    await w.worldAudio.load('17_25');
    const total = w.worldAudio.ambient.length;
    const zones = w.worldAudio.music.length;

    // Drive the culler from inside the first music volume, which is also where
    // emitters are dense — the worst case for the live cap.
    const z = w.worldAudio.music[0];
    const p = { x: (z.min.x + z.max.x) / 2, y: (z.min.y + z.max.y) / 2,
                z: (z.min.z + z.max.z) / 2 };
    w.worldAudio.update(10, p);

    return { tile: w.worldAudio.tile, total, zones,
             live: w.worldAudio.liveCount, song: w.worldAudio.currentSong };
  });

  check('tile soundscape loads', world.tile === '17_25' && world.total > 100,
        `${world.total} emitters, ${world.zones} music zones`);
  check('ambient emitters are culled to the live cap', world.live > 0 && world.live <= 16,
        `${world.live} live of ${world.total}`);
  check('standing in a MusicVolume picks its track', !!world.song, world.song || 'none');

  // The whole point of the degrade path: a clone without assets/audio/ must
  // still boot. Simulate by failing every /audio/ request.
  const page2 = await browser.newPage();
  await page2.setRequestInterception(true);
  page2.on('request', r => r.url().includes('/audio/') ? r.abort() : r.continue());
  const errors2 = [];
  page2.on('pageerror', e => errors2.push(String(e)));
  await page2.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page2.waitForFunction(() => !!(window.__world && window.__world.audio), { timeout: 20000 }).catch(() => {});
  const silent = await page2.evaluate(() => {
    const a = (window.__world || {}).audio;
    return { booted: !!document.querySelector('canvas'), ready: a ? a.ready : null };
  });
  check('client boots with no audio build', silent.booted === true && silent.ready === false,
        `canvas=${silent.booted} audioReady=${silent.ready}`);
  check('no page errors without audio build', errors2.length === 0,
        errors2.slice(0, 2).join(' | '));

  const audioErrors = errors.filter(e => /audio|gamesound/i.test(e));
  check('no audio errors on the console', audioErrors.length === 0,
        audioErrors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error('SUITE ERROR', err); process.exit(1); });
