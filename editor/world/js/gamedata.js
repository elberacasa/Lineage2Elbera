// M4: skill/item metadata (assets/gamedata/skillmeta.json + itemmeta.json,
// generated in parallel). Degrades gracefully while absent: generic names
// and a placeholder icon tile.
import { mergeSkillText, exactSkillText, skillDisplayTypeId } from './skilltext.js';

let _skillMeta = null;
let _actionMeta = null;
let _skillAnim = null;
const _metadataRequests = new Map();

function loadMeta(path) {
  if (!_metadataRequests.has(path)) {
    // Keep successful results and share pending requests. An unavailable or
    // invalid-JSON response stays null for its callers, but a later request
    // may retry; no automatic retry loop or substitute data is introduced.
    const request = Promise.resolve().then(() => fetch(path))
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(value => {
        if (value === null) _metadataRequests.delete(path);
        return value;
      });
    _metadataRequests.set(path, request);
  }
  return _metadataRequests.get(path);
}

export function skillMeta() {
  if (!_skillMeta) {
    _skillMeta = Promise.all([
      loadMeta('/gamedata/skillmeta.json'), loadMeta('/gamedata/skilltext.json'),
    ]).then(([legacy, exact]) => {
      if (exact) {
        try {
          const merged = mergeSkillText(legacy, exact);
          if (legacy === null) _skillMeta = null;
          return merged;
        } catch (error) {
          _metadataRequests.delete('/gamedata/skilltext.json');
          console.warn('Exact skill text unavailable:', error.message);
        }
      }
      // Preserve id-only callers, but retry exact data on a later request.
      _skillMeta = null;
      return legacy;
    });
  }
  return _skillMeta;
}

export function itemMeta() {
  return loadMeta('/gamedata/itemmeta.json');
}

export function sysMsgMeta() {
  return loadMeta('/gamedata/systemmsg.json');
}

// skillweapons.json / itemtypes.json (tools/dat/export_skillweapons.py,
// straight from the aCis XMLs): per-skill weaponsAllowed + target routing,
// per-item weapon type + shield flags. Degrade to "no restrictions" while
// absent, like the rest of the metadata layer.
export function skillWeapons() {
  return loadMeta('/gamedata/skillweapons.json');
}

export function itemTypes() {
  return loadMeta('/gamedata/itemtypes.json');
}

// Shot items, mined from the datapack's default_action by
// tools/dat/export_shots.py — the client's own etcitemgrp cannot distinguish a
// soulshot from any other etcitem. Needed because clicking a shot toggles
// AUTOMATIC use (RequestAutoSoulShot), it does not consume one.
// {itemId: {kind: 'soulshot'|'spiritshot', blessed, grade, name}}
let _shots = null;
let _shotsLoaded = null;
export function shotMeta() {
  if (!_shots) _shots = loadMeta('/gamedata/shots.json').then(value => {
    _shotsLoaded = value;
    if (value === null) _shots = null;
    return value;
  });
  return _shots;
}

export function shotsReady() { return _shotsLoaded; }
export function isShot(itemId) {
  return !!(_shotsLoaded && _shotsLoaded[String(itemId)]);
}
shotMeta();

// sysstring-e.dat UI strings (tools/dat extraction): {id: {id, string}}.
// UI labels cite the retail string by ID, never a retyped translation.
export function sysStringMeta() {
  return loadMeta('/gamedata/sysstring.json');
}

// classicons.json (tools/ui/mine_classicons.py, tier 5 — NWindow.dll):
// {icons: [16 texture refs], classes: {classId: iconIndex}} — the native
// GetClassIconName table, for every member-list class glyph.
export function classIcons() {
  return loadMeta('/gamedata/classicons.json');
}

// actionname.json is a LIST (not a map): index it once by action id.
// {list, byId} so ActionWnd can keep retail order while slot lookups stay O(1).
export function actionMeta() {
  if (!_actionMeta) {
    _actionMeta = loadMeta('/gamedata/actionname.json')
      .then(list => {
        if (list === null) _actionMeta = null;
        const byId = {};
        for (const a of list || []) byId[a.id] = a;
        return { list: list || [], byId };
      });
  }
  return _actionMeta;
}

export function actionInfo(meta, id) {
  const m = meta && meta.byId[String(id)];
  // icons are named icon.actionNNN; the pngs are copied next to the
  // skill/item icons by build_meta.py (missing files degrade on <img> error)
  const icon = m && m.icon ? m.icon.replace(/^icon\./, '') : null;
  return {
    name: (m && m.name) || `Action #${id}`,
    icon: icon ? `/gamedata/icons/${icon}.png` : null,
    desc: (m && m.desc) || '',
  };
}

// SystemMessage supplies each parameter's type on the wire. Do not infer it
// from a mined list of message IDs: the same number can be a quantity, skill,
// item or literal text. Skill names use the exact level carried with the ID.
// Plain params remain supported for local dialogs that already provide text.
export function renderSysMsg(meta, id, params = [], skills = null, typedParams = null, items = null) {
  const values = Array.isArray(typedParams) ? typedParams.map((p, i) => {
    if (p?.type === 4 && p.value && Number.isInteger(p.value.id)) {
      return skillInfo(skills, p.value.id, p.value.level ?? null).name;
    }
    if (p?.type === 3 && Number.isInteger(p.value)) {
      return itemInfo(items, p.value).name;
    }
    const value = p?.value ?? params[i];
    return value == null ? null : String(value);
  }) : params;
  const entry = meta && meta[String(id)];
  if (!entry || !entry.text) {
    return `sysmsg ${id}${values.length ? ': ' + values.join(', ') : ''}`;
  }
  // Original strings can reorder or repeat numbered parameters. For example
  // message29 uses $s2 before $s1; message1228 uses $s1 twice. Occurrence order
  // is therefore not the parameter index, nor are $s/$c separate queues.
  return entry.text.replace(/\$([sc])(\d+)/g, (placeholder, kind, number) => {
    const value = values[Number(number) - 1];
    return value == null ? placeholder : String(value);
  });
}

/** The sysmsg's own color from systemmsg-e.dat (tier 4), or null. */
export function sysMsgColor(meta, id) {
  const entry = meta && meta[String(id)];
  return (entry && entry.color) || null;
}

export function skillInfo(meta, id, level = undefined) {
  const exact = level !== undefined;
  const m = exact ? exactSkillText(meta, id, level) : meta && meta[String(id)];
  return {
    name: (m && m.name) || `Skill #${id}`,
    icon: (m && m.icon) ? `/gamedata/${m.icon}` : null,
    desc: m?.desc ?? '', enchantName: m?.enchantName ?? '', enchantDesc: m?.enchantDesc ?? '',
    hp: exact ? m?.hp ?? null : null, mp: exact ? m?.mp ?? null : null,
    range: exact ? m?.range ?? null : null,
    operateType: exact ? m?.operateType ?? null : null,
    isMagic: exact ? m?.isMagic ?? null : null,
    displayTypeId: exact ? skillDisplayTypeId(m) : null,
    exactLevel: exact && !!m, hasText: exact && !!m?.hasText,
  };
}

// skillanim.json (tools/dat/build_skillanim.py — skillgrp.anim code +
// is_magic/cast_range/cast_style + skillsoundgrp sounds, one entry per
// skill id plus per-level overrides where they differ). Degrades to null
// while absent; callers keep their generic fallbacks.
let _skillAnimData = null;   // resolved content, for sync accessors

export function skillAnimMeta() {
  if (!_skillAnim) {
    _skillAnim = loadMeta('/gamedata/skillanim.json')
      .then(j => {
        _skillAnimData = j;
        if (j === null) _skillAnim = null;
        return j;
      });
  }
  return _skillAnim;
}

/** Resolved skillanim.json content, or null until the first fetch lands. */
export function skillAnimLoaded() { return _skillAnimData; }

export function skillAnimInfo(meta, id, level = 1) {
  if (!meta || !Number.isInteger(level) || level <= 0) return null;
  const base = meta[String(id)];
  // Overrides compress equal source rows; absent levels must not inherit one.
  if (!Array.isArray(base?.levels) || !base.levels.includes(level)) return null;
  return Object.hasOwn(meta, `${id}_${level}`) ? meta[`${id}_${level}`] : base;
}

export function itemInfo(meta, id) {
  const m = meta && meta[String(id)];
  return {
    name: (m && m.name) || `Item #${id}`,
    icon: (m && m.icon) ? `/gamedata/${m.icon}` : null,
  };
}

// generic placeholder icon: styled div content handled in CSS; callers
// render <div class="icon-fallback">?</div> when icon url is null
