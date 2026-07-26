// M4: skill/item metadata (assets/gamedata/skillmeta.json + itemmeta.json,
// generated in parallel). Degrades gracefully while absent: generic names
// and a placeholder icon tile.

let _skillMeta = null;
let _itemMeta = null;
let _sysMsgMeta = null;

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
