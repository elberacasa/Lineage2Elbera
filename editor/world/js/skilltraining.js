// SkillTrainListWnd.uc / SkillTrainInfoWnd.uc and native 0x8a/0x8b/0x8e.
// This controller never grants skills or subtracts SP/items. Those changes
// arrive separately from the authoritative server. See native-skill-training.
const positive = n => Number.isInteger(n) && n > 0 && n <= 0x7fffffff;
const mode = n => Number.isInteger(n) && n >= 0 && n <= 2;
const same = (a, b) => a && b && a.id === b.id && a.level === b.level && a.type === b.type;

export class SkillTraining {
  constructor({ send = () => false, changed = () => {} } = {}) {
    this.send = send;
    this.changed = changed;
    this.revision = 0;
    this.reset();
  }

  reset() {
    this.revision++;
    this.type = null;
    this.skills = [];
    this.info = null;
    this.requested = null;
    this.view = null;
    this.changed(this);
  }

  list(message) {
    if (!mode(message.type) || !Array.isArray(message.skills)) return false;
    if (!message.skills.every(s => positive(s.id) && positive(s.level) && Number.isInteger(s.cost))) return false;
    this.revision++;
    this.type = message.type;
    this.skills = message.skills.map(s => ({ ...s }));
    this.info = null;
    this.requested = null;
    this.view = 'list';
    this.changed(this);
    return true;
  }

  select(id, level) {
    if (this.view !== 'list' || !this.skills.some(s => s.id === id && s.level === level)) return false;
    const request = { id, level, type: this.type };
    if (!this.send('acquireSkillInfo', request)) return false;
    this.requested = request;
    this.info = null;
    // Original OnClickButton hides the list immediately after the request.
    this.view = null;
    this.revision++;
    this.changed(this);
    return true;
  }

  details(message) {
    // Browser adaptation: a retired list/session cannot reopen a stale
    // asynchronous response. No protocol request-id is invented.
    if (!same(this.requested, message) || !Array.isArray(message.requirements)) return false;
    if (!Number.isInteger(message.cost)) return false;
    this.info = { ...message, requirements: message.requirements.map(r => ({ ...r })) };
    this.requested = null;
    this.view = 'info';
    this.revision++;
    this.changed(this);
    return true;
  }

  learn() {
    if (this.view !== 'info' || !this.info) return false;
    const { id, level, type } = this.info;
    // Native OnLearn leaves the dialog visible. Do not optimistically
    // close it, change its costs or lock it after a server refusal.
    return this.send('acquireSkill', { id, level, type });
  }

  back() {
    if (this.view !== 'info') return false;
    this.info = null;
    this.view = 'list';
    this.revision++;
    this.changed(this);
    return true;
  }

  close() {
    this.requested = null;
    this.view = null;
    this.revision++;
    this.changed(this);
  }

  done() { this.reset(); }
}
