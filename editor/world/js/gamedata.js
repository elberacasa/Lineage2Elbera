// M4: skill/item metadata (assets/gamedata/skillmeta.json + itemmeta.json,
// generated in parallel). Degrades gracefully while absent: generic names
// and a placeholder icon tile.

let _skillMeta = null;
let _itemMeta = null;
let _sysMsgMeta = null;
let _actionMeta = null;
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
  if (!_itemMeta) _itemMeta = loadMeta('/gamedata/itemmeta.json');
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
  // icons are named icon.actionNNN but only action102.png was mined; the
  // url is returned anyway and callers degrade on <img> error
  const icon = m && m.icon ? m.icon.replace(/^icon\./, '') : null;
  return {
    name: (m && m.name) || `Action #${id}`,
    icon: icon ? `/gamedata/icons/${icon}.png` : null,
    desc: (m && m.desc) || '',
  };
}

// render SystemMessage text: positional substitution of $s1/$s2/$c1/$c2
// style placeholders; graceful fallback while systemmsg.json is absent
export function renderSysMsg(meta, id, params = []) {
  const entry = meta && meta[String(id)];
  if (!entry || !entry.text) {
    return `sysmsg ${id}${params.length ? ': ' + params.join(', ') : ''}`;
  }
  let si = 0, ci = 0;
  const text = entry.text.replace(/\$([sc])(\d+)/g, (m, kind) => {
    const idx = kind === 's' ? si++ : ci++;
    return params[idx] != null ? String(params[idx]) : m;
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
export function skillAnimMeta() {
  if (!_skillAnim) _skillAnim = loadMeta('/gamedata/skillanim.json');
  return _skillAnim;
}

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
