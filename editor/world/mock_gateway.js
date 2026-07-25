// M2 mock gateway — implements the frozen browser<->gateway JSON contract
// so the web client can be verified before the real gateway lands.
//
//   node mock_gateway.js [port]        (default 8085)
//
// Behavior per connection:
//   login{deviceId}   -> auth_ok{chars:[one char]}
//   enterChar{slot}   -> enterWorld{char{...}} at tile 17_24 center,
//                        then addNpc x3, addPlayer x3 (2 standing, 1 walker)
//   moveTo{x,y,z}     -> echoed back as move{id:<self>} (server-authoritative)
//   say{channel,text} -> echoed back as chat{from:<self name>}
//   periodic: walker move ops (square patrol) + ambient chat lines
//
// M3 combat simulation:
//   target{id}      -> target_ok{id} + status{id,hp,maxHp}
//   attack{id}      -> combat loop on the gremlin (70001): player hits
//                      (attack/status ops), gremlin counters, selfStatus
//                      ticks; gremlin dies -> die + exp gain, revives 6 s
//                      later (revive + full status)
//   say "/die"      -> selfStatus hp 0 (death overlay test)
//   say "/revive"   -> selfStatus full (overlay clears)
//   selfStatus      -> sent once after enterChar
//
// Coordinates are L2 world units. Tile 17_24 center: origin
// [-98304, 196608] + 127.5*128 = (-81984, 212928).

const path = require('path');
const { WebSocketServer } = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/ws');

const PORT = Number(process.argv[2]) || 8085;

// z is deliberately far underground: the web client takes
// max(terrainHeight, serverZ), so entities ground-clamp to the converted
// terrain (the mock has no geodata; the real gateway sends true z).
const SPAWN = { x: -81984, y: 212928, z: -100000 };

const NPCS = [
  { id: 70001, npcId: 20001, name: 'Gremlin', x: SPAWN.x + 800, y: SPAWN.y + 400, z: SPAWN.z, heading: 32768 },
  { id: 70002, npcId: 20003, name: 'Goblin', x: SPAWN.x - 600, y: SPAWN.y + 900, z: SPAWN.z, heading: 16384 },
  // name intentionally blank: exercises the client's /gamedata/npcname.json enrichment
  { id: 70003, npcId: 20004, name: '', x: SPAWN.x + 300, y: SPAWN.y - 700, z: SPAWN.z, heading: 49152 },
];

const PLAYERS = [
  { id: 80001, name: 'Aria', race: 'Elf', classId: 25, x: SPAWN.x + 1000, y: SPAWN.y + 1200, z: SPAWN.z, heading: 32768 },
  { id: 80002, name: 'Borg', race: 'Orc', classId: 44, x: SPAWN.x - 1100, y: SPAWN.y - 500, z: SPAWN.z, heading: 0 },
];
const WALKER = { id: 80003, name: 'Cora', race: 'Human', classId: 0, x: SPAWN.x - 400, y: SPAWN.y + 400, z: SPAWN.z, heading: 0 };
const SQUARE = 800;        // L2 units per side (8 m -> ~5 s per side at walk speed)
const WALK_PERIOD = 5000;  // ms per side

const AMBIENT = [
  'welcome to the L2Vzla web port',
  'this is the mock gateway talking',
  'the real gateway speaks this same JSON',
  'try click-walking near me',
];

// M3: combat state for the targetable gremlin
const MOBS = {
  70001: { hp: 500, maxHp: 500, dead: false },
};
const SELF_BASE = {
  hp: 800, maxHp: 800, mp: 200, maxMp: 200,
  cp: 400, maxCp: 400, level: 1, exp: 0, sp: 0,
};

let nextPlayerId = 1000001;
const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
console.log(`mock gateway on ws://127.0.0.1:${PORT}`);

wss.on('connection', (ws) => {
  const timers = [];
  const self = { id: nextPlayerId++, name: `WebTester${Math.floor(Math.random() * 900 + 100)}` };
  const selfStats = { ...SELF_BASE };
  let combatTimer = null;
  console.log(`+ connection, player id ${self.id}`);

  const send = (op, fields = {}) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ op, ...fields }));
  };

  // M3 combat loop: player whacks the gremlin, gremlin counters
  const startCombat = (mobId) => {
    const mob = MOBS[mobId];
    if (!mob || mob.dead || combatTimer) return;
    let tick = 0;
    combatTimer = setInterval(() => {
      tick++;
      if (mob.dead) { clearInterval(combatTimer); combatTimer = null; return; }
      const miss = Math.random() < 0.1;
      const critical = !miss && Math.random() < 0.15;
      const damage = miss ? 0 : Math.round((40 + Math.random() * 40) * (critical ? 2 : 1));
      send('attack', { id: self.id, targetId: mobId, damage, critical, miss });
      if (!miss) mob.hp = Math.max(0, mob.hp - damage);
      send('status', { id: mobId, hp: mob.hp, maxHp: mob.maxHp });
      // gremlin counters every other tick; keeps player hp above ~30%
      if (tick % 2 === 0 && !mob.dead) {
        const md = 8 + Math.round(Math.random() * 8);
        send('attack', { id: mobId, targetId: self.id, damage: md, critical: false, miss: false });
        selfStats.hp = Math.max(240, selfStats.hp - md);
        send('selfStatus', selfStats);
      }
      if (mob.hp <= 0) {
        mob.dead = true;
        send('die', { id: mobId });
        selfStats.exp = Math.min(1, +(selfStats.exp + 0.35).toFixed(2));
        selfStats.sp += 50;
        send('selfStatus', selfStats);
        clearInterval(combatTimer); combatTimer = null;
        // respawn the gremlin 6 s later
        timers.push(setTimeout(() => {
          mob.dead = false; mob.hp = mob.maxHp;
          send('revive', { id: mobId });
          send('status', { id: mobId, hp: mob.hp, maxHp: mob.maxHp });
        }, 6000));
      }
    }, 1200);
    timers.push(combatTimer);
  };

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    console.log('  <-', JSON.stringify(msg));

    if (msg.op === 'login') {
      send('auth_ok', {
        chars: [{ slot: 0, name: self.name, race: 'Human', classId: 0 }],
      });
    } else if (msg.op === 'enterChar') {
      send('enterWorld', {
        char: {
          id: self.id, name: self.name, race: 'Human', classId: 0,
          x: SPAWN.x, y: SPAWN.y, z: SPAWN.z, heading: 32768,
        },
      });
      for (const n of NPCS) send('addNpc', n);
      for (const p of PLAYERS) send('addPlayer', p);
      send('addPlayer', WALKER);
      send('selfStatus', selfStats);

      // walker: patrol a square, one move op per side
      let corner = 0;
      const corners = [
        [WALKER.x + SQUARE, WALKER.y],
        [WALKER.x + SQUARE, WALKER.y + SQUARE],
        [WALKER.x, WALKER.y + SQUARE],
        [WALKER.x, WALKER.y],
      ];
      timers.push(setInterval(() => {
        const [tx, ty] = corners[corner % corners.length];
        corner++;
        send('move', { id: WALKER.id, tx, ty, tz: SPAWN.z });
      }, WALK_PERIOD));

      // ambient chat
      let ci = 0;
      timers.push(setInterval(() => {
        send('chat', { from: WALKER.name, channel: 'all', text: AMBIENT[ci++ % AMBIENT.length] });
      }, 8000));
    } else if (msg.op === 'moveTo') {
      // server-authoritative echo: client reconciles its own movement
      send('move', { id: self.id, tx: msg.x, ty: msg.y, tz: msg.z });
    } else if (msg.op === 'say') {
      send('chat', { from: self.name, channel: msg.channel || 'all', text: msg.text });
      if (msg.text === '/die') send('selfStatus', { ...selfStats, hp: 0 });
      if (msg.text === '/revive') send('selfStatus', selfStats);
    } else if (msg.op === 'target') {
      send('target_ok', { id: msg.id });
      const mob = MOBS[msg.id];
      send('status', { id: msg.id, hp: mob ? mob.hp : 300, maxHp: mob ? mob.maxHp : 300 });
    } else if (msg.op === 'attack') {
      startCombat(msg.id);
    }
  });

  ws.on('close', () => {
    timers.forEach(clearInterval);
    console.log(`- connection closed (player ${self.id})`);
  });
});
