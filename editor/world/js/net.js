// M2 netcode: WebSocket client speaking the frozen JSON gateway contract.
//
// Wire format: one JSON object per message, discriminated by `op`.
//   client -> server: login{deviceId}, enterChar{slot},
//                     moveTo{x,y,z}, say{channel,text}
//   server -> client: auth_ok{chars[]},
//                     enterWorld{char{name,race,classId,x,y,z,heading}},
//                     addPlayer{id,name,race,classId,x,y,z,heading},
//                     addNpc{id,npcId,name,x,y,z,heading},
//                     move{id,tx,ty,tz}, remove{id}, chat{from,channel,text}
// Coordinates are L2 world units (~cm, Z-up); convert with coords.js.
//
// The gateway URL is configurable: ?ws=ws://host:port query param, or
// localStorage 'l2vzla.wsUrl'. Default depends on where the page is served:
// localhost/127.0.0.1 keeps the legacy ws://127.0.0.1:8090 (the real M2
// gateway); any other host (e.g. the public tunnel) uses a same-origin
// WebSocket at /ws (wss: for https pages, ws: for http).

export const DEFAULT_WS_URL = 'ws://127.0.0.1:8090';

export function gatewayUrl() {
  const q = new URLSearchParams(location.search).get('ws');
  if (q) return q;
  const stored = localStorage.getItem('l2vzla.wsUrl');
  if (stored) return stored;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    return DEFAULT_WS_URL;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export function deviceId() {
  let id = localStorage.getItem('l2vzla.deviceId');
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID())
      || Array.from(crypto.getRandomValues(new Uint8Array(16)),
        b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('l2vzla.deviceId', id);
  }
  return id;
}

export class NetClient {
  constructor() {
    this.ws = null;
    this.url = null;
    this.handlers = {};       // op -> fn(msg); special ops: 'open', 'close', 'error'
    this.connected = false;
    this.log = [];            // raw message ring (verification/debug)
    this.logMax = 200;
  }

  _log(dir, msg) {
    this.log.push({ dir, ...msg });
    if (this.log.length > this.logMax) this.log.shift();
  }

  on(op, fn) { this.handlers[op] = fn; }

  _emit(op, msg) {
    const fn = this.handlers[op];
    if (fn) {
      try { fn(msg); } catch (e) { console.error(`net handler ${op}:`, e); }
    } else if (op !== 'open' && op !== 'close') {
      console.warn('net: unhandled op', op, msg);
    }
  }

  connect(url = gatewayUrl()) {
    this.disconnect();
    this.url = url;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this._emit('open', {});
      this.send('login', { deviceId: deviceId() });
    };
    ws.onclose = () => {
      this.connected = false;
      this.ws = null;
      this._emit('close', {});
    };
    ws.onerror = () => this._emit('error', {});
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { console.warn('net: bad JSON', ev.data); return; }
      if (msg && typeof msg.op === 'string') { this._log('in', msg); this._emit(msg.op, msg); }
      else console.warn('net: message without op', msg);
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.onclose = null;   // deliberate close: no 'close' event
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  send(op, fields = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this._log('out', { op, ...fields });
    this.ws.send(JSON.stringify({ op, ...fields }));
    return true;
  }
}
