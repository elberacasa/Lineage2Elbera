// M4: skill/item metadata (assets/gamedata/skillmeta.json + itemmeta.json,
// generated in parallel). Degrades gracefully while absent: generic names
// and a placeholder icon tile.

let _skillMeta = null;
let _itemMeta = null;
let _itemMetaData = null;   // resolved itemmeta, for sync accessors (sysMsg)
let _sysMsgMeta = null;
let _actionMeta = null;
let _sysStringMeta = null;
let _classIcons = null;
let _skillWeapons = null;
let _itemTypes = null;
let _skillAnim = null;

function loadMeta(path) {
  return fetch(path)
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null);
}

export function skillMeta() {
  if (!_skillMeta) _skillMeta = loadMeta('/gamedata/skillmeta.json');
  return _skillMeta;
}

export function itemMeta() {
  if (!_itemMeta) {
    _itemMeta = loadMeta('/gamedata/itemmeta.json')
      .then(j => { _itemMetaData = j; return j; });
  }
  return _itemMeta;
}

export function sysMsgMeta() {
  if (!_sysMsgMeta) _sysMsgMeta = loadMeta('/gamedata/systemmsg.json');
  return _sysMsgMeta;
}

// skillweapons.json / itemtypes.json (tools/dat/export_skillweapons.py,
// straight from the aCis XMLs): per-skill weaponsAllowed + target routing,
// per-item weapon type + shield flags. Degrade to "no restrictions" while
// absent, like the rest of the metadata layer.
export function skillWeapons() {
  if (!_skillWeapons) _skillWeapons = loadMeta('/gamedata/skillweapons.json');
  return _skillWeapons;
}

export function itemTypes() {
  if (!_itemTypes) _itemTypes = loadMeta('/gamedata/itemtypes.json');
  return _itemTypes;
}

// Shot items, mined from the datapack's default_action by
// tools/dat/export_shots.py — the client's own etcitemgrp cannot distinguish a
// soulshot from any other etcitem. Needed because clicking a shot toggles
// AUTOMATIC use (RequestAutoSoulShot), it does not consume one.
// {itemId: {kind: 'soulshot'|'spiritshot', blessed, grade, name}}
let _shots = null;
export function shotMeta() {
  if (!_shots) _shots = loadMeta('/gamedata/shots.json');
  return _shots;
}

let _shotsLoaded = null;
export function shotsReady() { return _shotsLoaded; }
export function isShot(itemId) {
  return !!(_shotsLoaded && _shotsLoaded[String(itemId)]);
}
shotMeta().then(m => { _shotsLoaded = m; }).catch(() => { _shotsLoaded = {}; });

// sysstring-e.dat UI strings (tools/dat extraction): {id: {id, string}}.
// UI labels cite the retail string by ID, never a retyped translation.
export function sysStringMeta() {
  if (!_sysStringMeta) _sysStringMeta = loadMeta('/gamedata/sysstring.json');
  return _sysStringMeta;
}

// classicons.json (tools/ui/mine_classicons.py, tier 5 — NWindow.dll):
// {icons: [16 texture refs], classes: {classId: iconIndex}} — the native
// GetClassIconName table, for every member-list class glyph.
export function classIcons() {
  if (!_classIcons) _classIcons = loadMeta('/gamedata/classicons.json');
  return _classIcons;
}

// actionname.json is a LIST (not a map): index it once by action id.
// {list, byId} so ActionWnd can keep retail order while slot lookups stay O(1).
export function actionMeta() {
  if (!_actionMeta) {
    _actionMeta = loadMeta('/gamedata/actionname.json')
      .then(list => {
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

// sysMsg ids whose $s params are SKILL_NAME values (aCis sends 46 USE_S1
// only from PlayerCast/CreatureCast with .addSkillName; 48 is the reuse
// denial of the same cast path). The gateway flattens params to raw
// values, so the skill id arrives as a bare number — resolve it to the
// skill name when skillmeta is passed. Fallback set for while
// sysmsg_paramtypes.json is absent; once loaded, the mined map below
// covers these ids too (46/48 mine as skill slot 0 from the same source).
const SKILL_PARAM_MSGS = new Set([46, 48]);

// sysmsg_paramtypes.json (tools/dat/build_sysmsg_paramtypes.py — mined
// from the aCis SystemMessage call sites): per message id, which $s slots
// carry ITEM_NAME / SKILL_NAME values ("You have obtained $s1." etc. pass
// item ids through the same flattening). Sync cache like skillAnim: the
// fetch is kicked on first renderSysMsg call; until it lands the fallback
// above reproduces the old behavior exactly.
let _sysMsgParamTypes = null;
let _sysMsgParamTypesData = null;

function sysMsgParamTypes() {
  if (!_sysMsgParamTypes) {
    _sysMsgParamTypes = loadMeta('/gamedata/sysmsg_paramtypes.json')
      .then(j => { _sysMsgParamTypesData = j; return j; });
  }
  return _sysMsgParamTypes;
}

// render SystemMessage text: positional substitution of $s1/$s2/$c1/$c2
// style placeholders; graceful fallback while systemmsg.json is absent.
// skills: optional skillmeta.json content for SKILL_NAME params (above).
export function renderSysMsg(meta, id, params = [], skills = null) {
  const entry = meta && meta[String(id)];
  if (!entry || !entry.text) {
    return `sysmsg ${id}${params.length ? ': ' + params.join(', ') : ''}`;
  }
  sysMsgParamTypes();
  const pt = _sysMsgParamTypesData && _sysMsgParamTypesData[String(id)];
  let si = 0, ci = 0;
  const text = entry.text.replace(/\$([sc])(\d+)/g, (m, kind) => {
    const idx = kind === 's' ? si++ : ci++;
    const v = params[idx];
    if (v == null) return m;
    if (kind === 's') {
      if (pt && pt.item && pt.item.includes(idx)) {
        if (!_itemMetaData) itemMeta();   // kick the fetch on first item param
        const it = _itemMetaData && _itemMetaData[String(v)];
        if (it && it.name) return it.name;
      } else if (skills && (pt ? (pt.skill && pt.skill.includes(idx))
                               : SKILL_PARAM_MSGS.has(id))) {
        const s = skills[String(v)];
        if (s && s.name) return s.name;
      }
    }
    return String(v);
  });
  return text;
}

/** The sysmsg's own color from systemmsg-e.dat (tier 4), or null. */
export function sysMsgColor(meta, id) {
  const entry = meta && meta[String(id)];
  return (entry && entry.color) || null;
}

export function skillInfo(meta, id) {
  const m = meta && meta[String(id)];
  return {
    name: (m && m.name) || `Skill #${id}`,
    icon: (m && m.icon) ? `/gamedata/${m.icon}` : null,
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
      .then(j => { _skillAnimData = j; return j; });
  }
  return _skillAnim;
}

/** Resolved skillanim.json content, or null until the first fetch lands. */
export function skillAnimLoaded() { return _skillAnimData; }

export function skillAnimInfo(meta, id, level = 1) {
  if (!meta) return null;
  return meta[`${id}_${level}`] || meta[String(id)] || null;
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
