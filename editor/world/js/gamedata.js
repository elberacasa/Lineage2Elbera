// M4: skill/item metadata (assets/gamedata/skillmeta.json + itemmeta.json,
// generated in parallel). Degrades gracefully while absent: generic names
// and a placeholder icon tile.

let _skillMeta = null;
let _itemMeta = null;
let _sysMsgMeta = null;
let _actionMeta = null;

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

export function itemInfo(meta, id) {
  const m = meta && meta[String(id)];
  return {
    name: (m && m.name) || `Item #${id}`,
    icon: (m && m.icon) ? `/gamedata/${m.icon}` : null,
  };
}

// generic placeholder icon: styled div content handled in CSS; callers
// render <div class="icon-fallback">?</div> when icon url is null
