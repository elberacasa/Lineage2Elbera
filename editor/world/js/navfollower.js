// A bounded browser adapter for a geodata-proven route, not a native movement
// simulation. aCis PlayerMove broadcasts an order's current origin but ordinary
// arrival emits no StopMove (CreatureMove.registerMoveTask -> AI idle after task
// cancellation). Reissuing the same destination exposes a new actual origin.
// Only that origin, never elapsed time or the drawn body, completes a waypoint.
// Callers must cancel on any other action, new order, death, wait-state change,
// teleport or session change, and supply already bounded raw-L2 route segments.

// Operational safeguards, not movement speed, collision or arrival rules.
// The probe allowance is one configured aCis CreatureMove scheduling tick
// (100ms); its expiry requests another origin and never certifies arrival.
export const NAV_FOLLOW_LIMITS = Object.freeze({
  responseTimeoutMs: 8000, probeAllowanceMs: 100,
  operationTimeoutMs: 120000, maxSends: 2048, maxPoints: 2048,
});

const point = p => p && ['x', 'y', 'z'].every(k => Number.isSafeInteger(p[k]) &&
  p[k] >= -2147483648 && p[k] <= 2147483647);
const copy = p => ({x:p.x, y:p.y, z:p.z});
const sameXY = (a, b) => a.x === b.x && a.y === b.y;

export class NavFollower {
  constructor({lineOk, send, onPosition = () => {}, onComplete = () => {}, onStop = () => {}}) {
    if (typeof lineOk !== 'function' || typeof send !== 'function') throw new TypeError('lineOk and send are required');
    Object.assign(this, {lineOk, send, onPosition, onComplete, onStop});
    this.status = 'idle'; this.stopReason = null; this.generation = 0;
  }

  get active() { return this.status === 'active'; }

  cancel(reason = 'cancelled') {
    if (!this.active) return;
    this.status = 'stopped'; this.stopReason = reason; this.pending = null; this.generation++;
    this.onStop(reason);
  }

  start(points, actual, speeds, now) {
    this.cancel('replaced');
    this.status = 'active'; this.stopReason = null; this.pending = null; this.generation++;
    if (!Array.isArray(points) || points.length < 2 || points.length > NAV_FOLLOW_LIMITS.maxPoints ||
        !points.every(point) || !point(actual) || !Number.isFinite(now) ||
        ![true,false,0,1].includes(speeds?.running) ||
        ![speeds?.runSpeed,speeds?.walkSpeed,speeds?.speedMul].every(v => Number.isFinite(v) && v > 0)) {
      this.cancel('invalid-route-or-movement-state'); return false;
    }
    // PlayerMove uses walk speed during its first five updates, even in running
    // stance. The slower supplied speed only schedules a probe; it never proves
    // arrival or dictates interpolation. Actual server origins remain decisive.
    this.probeSpeed = Math.min(speeds.walkSpeed, speeds.running ? speeds.runSpeed : speeds.walkSpeed) * speeds.speedMul;
    if (!(this.probeSpeed > 0) || !Number.isFinite(this.probeSpeed)) {
      this.cancel('invalid-route-or-movement-state'); return false;
    }
    this.points = points.map(copy); this.position = copy(actual); this.index = 1;
    this.startedAt = now; this.now = now; this.sends = 0;
    if (!sameXY(this.points[0], actual) || !this._supported(actual, this.points[0])) {
      this.cancel('route-start-does-not-match-server'); return false;
    }
    this._advance(now);
    return this.status !== 'stopped';
  }

  _supported(a, b) {
    const reached = this.lineOk(copy(a), copy(b));
    return Number.isFinite(reached) && reached === b.z;
  }

  _advance(now) {
    while (this.active && this.index < this.points.length && sameXY(this.position, this.points[this.index])) {
      if (!this._supported(this.position, this.points[this.index])) {
        this.cancel('server-arrival-on-different-floor'); return;
      }
      this.index++;
    }
    if (!this.active) return;
    if (this.index === this.points.length) {
      this.status = 'complete'; this.pending = null;
      this.onComplete(copy(this.position)); return;
    }
    this.pending = {target:this.points[this.index], received:false};
    this._send(now);
  }

  _send(now) {
    const p = this.pending;
    if (!this._supported(this.position, p.target)) {
      this.cancel('segment-no-longer-supported'); return;
    }
    if (++this.sends > NAV_FOLLOW_LIMITS.maxSends) {
      this.cancel('operational-send-limit'); return;
    }
    p.sentAt = now; p.received = false; p.origin = copy(this.position);
    const travelMs = Math.hypot(p.target.x - this.position.x, p.target.y - this.position.y) / this.probeSpeed * 1000;
    p.probeAt = now + travelMs + NAV_FOLLOW_LIMITS.probeAllowanceMs;
    // Set state before calling out: a synchronous test transport may answer.
    const generation = this.generation;
    try {
      if (this.send(copy(p.target), copy(this.position)) === false && generation === this.generation)
        this.cancel('send-failed');
    }
    catch { if (generation === this.generation) this.cancel('send-failed'); }
  }

  observe(actual, now) {
    if (!this.active || !point(actual) || !Number.isFinite(now) || now < this.now) return false;
    this.now = now; this.position = copy(actual);
    const generation = this.generation;
    this.onPosition(copy(actual));
    if (!this.active || generation !== this.generation) return true; // callback can replace this operation
    this.pending.received = true;
    if (sameXY(actual, this.pending.target)) this._advance(now);
    return true;
  }

  update(now) {
    if (!this.active || !Number.isFinite(now) || now < this.now) return;
    this.now = now;
    if (now - this.startedAt >= NAV_FOLLOW_LIMITS.operationTimeoutMs) {
      this.cancel('operational-time-limit'); return;
    }
    const p = this.pending;
    if (!p.received && now - p.sentAt >= NAV_FOLLOW_LIMITS.responseTimeoutMs) {
      this.cancel('no-server-position-response'); return;
    }
    if (p.received && now >= p.probeAt) this._send(now);
  }
}
