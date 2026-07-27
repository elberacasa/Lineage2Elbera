// Quest protocol verification (live, ~8 min):
//  1. questList after enterWorld (EMPTY for a fresh char — the Tutorial chain
//     is quest id -1, a "feature", filtered by isRealQuest(); documented).
//  2. Level to >=3 killing Gremlins (Q006 requirement).
//  3. Walk to Gatekeeper Roxxy in TI town; talk -> quest page -> accept Q006
//     "Step into the Future" via its own bypass links.
//  4. Advance cond 1->2 at Magister Baulro (progress flags change).
//  5. questAbort{6} -> questList without Q006.
'use strict';

const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const deviceId = process.argv[2] || 'verify-quest-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROXXY = { npcId: 30006, x: -84108, y: 244604, z: -3729 };
const BAULRO = { npcId: 30033, x: -84729, y: 245001, z: -3726 };
const WAYPOINTS = [
  // REAL road path village -> TI town (~320-unit hops), A*-computed on the
  // L2OFF geodata (tools/world/geodata.py parse_region; layer-aware,
  // step<=80, seeded with real in-game z; nswe E1/W2/S4/N8). Server pathing
  // only ever routes one short hop at a time — no cliff shortcuts.
  [-71416, 258264, -3104], [-71528, 258056, -3096], [-71704, 257912, -3104],
  [-72024, 257912, -3112], [-72344, 257912, -3112], [-72664, 257912, -3112],
  [-72712, 257640, -3112], [-72712, 257320, -3112], [-72872, 257160, -3120],
  [-73192, 257160, -3120], [-73512, 257160, -3120], [-73832, 257160, -3120],
  [-74152, 257160, -3160], [-74456, 257144, -3176], [-74776, 257144, -3296],
  [-75096, 257144, -3320], [-75192, 256920, -3320], [-75352, 256760, -3192],
  [-75512, 256600, -3160], [-75640, 256408, -3168], [-75800, 256248, -3176],
  [-76024, 256152, -3224], [-76184, 255992, -3248], [-76280, 255768, -3256],
  [-76408, 255576, -3208], [-76504, 255352, -3192], [-76664, 255192, -3224],
  [-76792, 255000, -3288], [-76920, 254808, -3240], [-77048, 254616, -3304],
  [-77080, 254328, -3256], [-77176, 254104, -3256], [-77304, 253912, -3256],
  [-77320, 253608, -3352], [-77320, 253288, -3312], [-77320, 252968, -3344],
  [-77320, 252648, -3360], [-77320, 252328, -3368], [-77320, 252008, -3368],
  [-77416, 251784, -3384], [-77432, 251480, -3352], [-77496, 251300, -3384],
  [-77560, 251200, -3384], [-77560, 251040, -3416], [-77640, 250880, -3416],
  [-77640, 250720, -3448], [-77800, 250720, -3448], [-78000, 250700, -3472],
  [-78136, 250680, -3528], [-78248, 250520, -3544], [-78360, 250376, -3568],
  [-78584, 250072, -3568], [-78712, 249880, -3568], [-78872, 249720, -3568],
  [-78968, 249496, -3568], [-79176, 249384, -3544], [-79320, 249208, -3568],
  [-79480, 249048, -3568], [-79608, 248856, -3568], [-79752, 248680, -3576],
  [-80072, 248680, -3672], [-80392, 248680, -3704], [-80712, 248680, -3720],
  [-81032, 248680, -3720], [-81352, 248680, -3720], [-81672, 248680, -3696],
  [-81992, 248680, -3688], [-82312, 248680, -3656], [-82472, 248520, -3640],
  [-82472, 248200, -3632], [-82552, 247960, -3608], [-82552, 247640, -3600],
  [-82552, 247320, -3608], [-82552, 247000, -3624], [-82552, 246680, -3648],
  [-82552, 246360, -3672], [-82552, 246040, -3688], [-82552, 245720, -3704],
  [-82552, 245400, -3704], [-82552, 245080, -3720], [-82648, 244856, -3728],
  [-82968, 244856, -3728], [-83288, 244856, -3728], [-83608, 244856, -3728],
  [-83928, 244856, -3728], [-84104, 244712, -3728], [-84104, 244600, -3728],
];

const R = {
  me: null, level: 1, npcs: [], npcById: new Map(), htmls: [],
  questLists: [], moves: new Map(), diedIds: new Set(), sysTexts: [],
};
const ws = new WebSocket(url);
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1); });
ws.on('open', () => ws.send(JSON.stringify({ op: 'login', deviceId })));
ws.on('message', async (d) => {
  const m = JSON.parse(d);
  switch (m.op) {
    case 'auth_ok': await sleep(400); ws.send(JSON.stringify({ op: 'enterChar', slot: 0 })); break;
    case 'enterWorld': R.me = m.char; break;
    case 'selfStatus':
      R.level = m.level;
      if (R.me && m.hp === 0) R.selfDead = true;
      break;
    case 'addNpc': R.npcs.push(m); R.npcById.set(m.npcId, m); break;
    case 'npcHtml': R.htmls.push(m.html); break;
    case 'questList': R.questLists.push(m.quests); console.log('questList:', JSON.stringify(m.quests)); break;
    case 'move': R.moves.set(m.id, { x: m.tx, y: m.ty, z: m.tz }); break;
    case 'die':
      R.diedIds.add(m.id);
      if (R.me && m.id === R.me.id) {
        R.selfDead = true;
        console.log('  *** SELF DIED at', JSON.stringify(selfPos()));
      }
      break;
    case 'sysMsg': if (typeof m.params[0] === 'string') R.sysTexts.push(m.params[0]); break;
  }
});
const send = (o) => ws.send(JSON.stringify(o));
const waitFor = (fn, timeout, label) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const v = fn();
    if (v) { clearInterval(iv); resolve(v); }
    else if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new Error('timeout: ' + label)); }
  }, 300);
});
const selfPos = () => R.moves.get(R.me.id) || R.me;
const snippet = (h, n = 130) => h.replace(/\s+/g, ' ').slice(0, n);

async function killGremlinsUntilLevel(level) {
  while (R.level < level) {
    const g = R.npcs
      .filter((n) => n.name === 'Gremlin' && !R.diedIds.has(n.id))
      .map((n) => ({ ...n, ...(R.moves.get(n.id) || n) }))
      .map((n) => ({ ...n, dist: Math.hypot(n.x - selfPos().x, n.y - selfPos().y) }))
      .sort((a, b) => a.dist - b.dist)[0];
    if (!g) throw new Error('no gremlin to level up');
    console.log(`  killing Gremlin ${g.id} (level ${R.level}/${level})...`);
    const t0 = Date.now();
    while (!R.diedIds.has(g.id) && Date.now() - t0 < 150000) {
      const pos = R.moves.get(g.id) || g;
      const me = selfPos();
      send({ op: 'moveTo', x: pos.x + 20, y: pos.y, z: pos.z });
      await sleep(Math.min(12000, (Math.hypot(pos.x - me.x, pos.y - me.y) / 115) * 1000 + 2500));
      const t1 = Date.now();
      while (!R.diedIds.has(g.id) && Date.now() - t1 < 15000) {
        send({ op: 'attack', id: g.id });
        await sleep(4000);
      }
    }
    await sleep(2000);
  }
  console.log(`  level ${R.level} reached`);
}

async function walkTo(target, label, waypoints = WAYPOINTS) {
  console.log(`  walking to ${label} at ${target.x},${target.y}...`);
  const t0 = Date.now();
  let wpIndex = 0;
  let best = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const d = Math.hypot(selfPos().x - waypoints[i][0], selfPos().y - waypoints[i][1]);
    if (d < best) { best = d; wpIndex = i; }
  }
  const chain = waypoints.slice(wpIndex).concat([[target.x, target.y, target.z]]);
  for (let hi = 0; hi < chain.length; hi++) {
    if (R.selfDead) throw new Error(`SELF DIED walking to ${label} at ${JSON.stringify(selfPos())}`);
    const hop = chain[hi];
    const hopStart = Date.now();
    let stalled = false;
    for (;;) {
      const me = selfPos();
      const dist = Math.hypot(me.x - hop[0], me.y - hop[1]);
      if (dist < 260) break;
      if (Date.now() - hopStart > 40000) { stalled = true; break; }
      if (Date.now() - t0 > 500000) throw new Error('walk timeout ' + label);
      send({ op: 'moveTo', x: hop[0], y: hop[1], z: hop[2] });
      await sleep(4000);
    }
    if (stalled) {
      // Local probe navigator: try 8 short directions, keep any move that
      // both works and reduces distance to the NEXT waypoint.
      const me0 = selfPos();
      console.log(`  stall at ${me0.x | 0},${me0.y | 0},${me0.z | 0} -> probing directions...`);
      let recovered = false;
      const DIRS = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
      for (const [dx, dy] of DIRS) {
        const nx = me0.x + dx * 240, ny = me0.y + dy * 240;
        send({ op: 'moveTo', x: nx, y: ny, z: me0.z });
        await sleep(5000);
        const me1 = selfPos();
        const moved = Math.hypot(me1.x - me0.x, me1.y - me0.y);
        if (moved > 80) {
          console.log(`  probe moved ${moved | 0} to ${me1.x | 0},${me1.y | 0}`);
          recovered = true;
          break;
        }
      }
      if (!recovered) throw new Error(`ROAD-BLOCKED at ${me0.x | 0},${me0.y | 0},${me0.z | 0} (hop ${hi}: ${chain[hi]})`);
      hi--; // retry the same hop from the new position
    }
  }
  console.log(`  arrived at ${label} (dist ${Math.hypot(selfPos().x - target.x, selfPos().y - target.y) | 0})`);
}

(async () => {
  await waitFor(() => R.me, 60000, 'enterWorld');
  await sleep(3500);
  console.log('in world as', R.me.name);
  const initialQuests = R.questLists[0];
  console.log('1. initial questList:', JSON.stringify(initialQuests));

  console.log('2. leveling to 3...');
  await killGremlinsUntilLevel(3);

  console.log('3. going to Roxxy (TI town)...');
  await walkTo(ROXXY, 'Roxxy');
  const roxxy = await waitFor(() => R.npcById.get(ROXXY.npcId), 20000, 'Roxxy addNpc');
  const mark1 = R.htmls.length;
  send({ op: 'talk', id: roxxy.id });
  await waitFor(() => R.htmls[mark1], 20000, 'Roxxy html');
  console.log('   Roxxy html:', snippet(R.htmls[mark1]));
  // follow the npc_..._Quest link, then the accept link
  const questLink = /bypass -h (npc_\d+_Quest)/.exec(R.htmls[mark1]);
  if (!questLink) throw new Error('no npc_.._Quest link on Roxxy page');
  console.log('   following:', questLink[1]);
  const mark2 = R.htmls.length;
  send({ op: 'bypass', command: questLink[1] });
  await waitFor(() => R.htmls[mark2], 20000, 'quest page');
  console.log('   quest page:', snippet(R.htmls[mark2]));
  const acceptLink = /bypass -h (Quest Q006_StepIntoTheFuture [^"']+)/.exec(R.htmls[mark2]);
  if (!acceptLink) throw new Error('no Q006 accept link');
  console.log('   accepting:', acceptLink[1]);
  const questsMark = R.questLists.length;
  send({ op: 'bypass', command: acceptLink[1] });
  const started = await waitFor(() => R.questLists.slice(questsMark).find((q) => q.some((e) => e.id === 6)), 20000, 'questList with Q006');
  const q6 = started.find((e) => e.id === 6);
  console.log('   Q006 in questList:', JSON.stringify(q6));

  console.log('4. advancing at Baulro...');
  await walkTo(BAULRO, 'Baulro');
  const baulro = await waitFor(() => R.npcById.get(BAULRO.npcId), 20000, 'Baulro addNpc');
  const mark3 = R.htmls.length;
  send({ op: 'talk', id: baulro.id });
  await waitFor(() => R.htmls[mark3], 20000, 'Baulro html');
  console.log('   Baulro html:', snippet(R.htmls[mark3]));
  let advanceLink = /bypass -h (Quest Q006_StepIntoTheFuture 30033-02[^"']*)/.exec(R.htmls[mark3]);
  if (!advanceLink) {
    // Baulro shows his default page first: follow npc_..._Quest.
    const ql = /bypass -h (npc_\d+_Quest)/.exec(R.htmls[mark3]);
    if (!ql) throw new Error('no npc_.._Quest link on Baulro page');
    console.log('   following:', ql[1]);
    const mark3b = R.htmls.length;
    send({ op: 'bypass', command: ql[1] });
    await waitFor(() => R.htmls[mark3b], 20000, 'Baulro quest page');
    console.log('   Baulro quest page:', snippet(R.htmls[mark3b]));
    advanceLink = /bypass -h (Quest Q006_StepIntoTheFuture 30033-02[^"']*)/.exec(R.htmls[mark3b]);
  }
  if (!advanceLink) throw new Error('no advance link on Baulro page');
  console.log('   advancing:', advanceLink[1]);
  const questsMark2 = R.questLists.length;
  send({ op: 'bypass', command: advanceLink[1] });
  const advanced = await waitFor(() =>
    R.questLists.slice(questsMark2).find((q) => q.some((e) => e.id === 6 && (e.progress & 0x7fffffff) !== (q6.progress & 0x7fffffff))),
    20000, 'questList with changed Q006 progress');
  const q6b = advanced.find((e) => e.id === 6);
  console.log('   Q006 progress changed:', q6.progress, '->', q6b.progress);

  console.log('5. aborting Q006...');
  const questsMark3 = R.questLists.length;
  send({ op: 'questAbort', id: 6 });
  const afterAbort = await waitFor(() =>
    R.questLists.slice(questsMark3).find((q) => !q.some((e) => e.id === 6)),
    20000, 'questList without Q006');
  console.log('   questList after abort:', JSON.stringify(afterAbort));

  console.log('---');
  const pass = Array.isArray(initialQuests) && initialQuests.length === 0 &&
    q6 && q6.name === 'Step into the Future' && (q6.progress & 0x80000000) !== 0 &&
    q6b && (q6b.progress & 0x7fffffff) !== (q6.progress & 0x7fffffff) &&
    !afterAbort.some((e) => e.id === 6);
  console.log(pass ? 'VERIFY-QUEST: PASS' : 'VERIFY-QUEST: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('VERIFY-QUEST: FAIL', e.message); process.exit(1); });

setTimeout(() => { console.error('VERIFY-QUEST: global timeout'); process.exit(1); }, 540000);
