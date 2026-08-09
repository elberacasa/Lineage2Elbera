// ElberaSkin runtime — the retail ITEM TOOLTIP.
//
// This file is a transcription of `assets/uscript/Interface/Tooltip.uc`
// (the CLIENT'S OWN script) plus the natives that script calls, decoded out
// of NWindow.dll. Nothing about the content is designed here:
//
//   WHAT IS SHOWN, AND IN WHICH ORDER
//     `ReturnTooltip_NTT_ITEM` (Tooltip.uc:213-820) appends DrawItemInfo
//     records one after another and hands the list back through the native
//     ReturnTooltipInfo. tools/ui/mine_itemtooltip.py extracts that append
//     sequence from the .uc file into assets/gamedata/itemtooltip.json
//     `fieldOrder`, and verify_tooltip.js --check asserts THIS FILE produces
//     exactly that order. So the order is the client's, not a plausible one.
//
//   THE LABELS
//     SysString ids, resolved through assets/gamedata/sysstring.json. The
//     natives reference them as raw blob offsets; the id base 0x6a8dc/12
//     comes out of execGetSystemString (see the miner's docstring).
//
//   THE NUMBERS
//     P.Atk / M.Atk / P.Def / M.Def / shield defence are the BASE value from
//     the client's grp table plus an enchant bonus, and both the step
//     function and the per-grade bonus tables are decoded doubles from
//     NWindow.dll (0x1014e1f0 / 0x1014e290 / 0x1014e330).
//     Atk. Spd. is not a number at all: GetAttackSpeedString maps it through
//     a four-step compare ladder to one of five words.
//
//   THE COLOURS
//     Every literal comes from Tooltip.uc. The label grey is #A3A3A3, the
//     value tan #B09B79 -- and the item NAME is #FFFFFF because
//     AddTooltipItemName sets no colour and FDrawItemInfo's C++ constructor
//     (NWindow.dll 0x10115930) starts every record at opaque white. There is
//     NO grade tint on the name; the grade is a 12x12 symbol after it.
//
//   THE WINDOW
//     L2UI_CH3.Tooltip.Tooltip1..9, a nine-slice with 8px corners, painted
//     by NCTooltip::DrawTooltip 0x10054680. The box is exactly the measured
//     content extent (TooltipInfo::CalculateSize adds no padding) and the
//     DrawList is rendered at (+5,+5) inside it.
//
// ONE DECODED FACT THAT LOOKS WRONG ON SCREEN, STATED SEPARATELY FROM WHAT
// IT MIGHT IMPLY:
//   MEASURED. TooltipInfo::CalculateSize (0x10054120 -> 0x10065570) writes
//   W = max(MinimumWidth, widest line) and H = sum(line heights) with no
//   constant added; TooltipInfo::SetTooltipInfo (0x10054f20) adds none
//   either; DrawTooltip paints the frame at exactly that W x H and renders
//   the DrawList at (+5,+5). Verified three ways (the two writers, the
//   reader, and the call site that supplies the args).
//   CONSEQUENCE AS IMPLEMENTED. The widest line therefore overhangs the
//   right border by 5px, and the last line the bottom border by 5px. You can
//   see it on the grade badge in verify_shots/tooltip_gradedWeapon.png.
//   INFERENCE, NOT MEASURED, ABOUT WHY. The likeliest explanation is that
//   retail's text MEASURE is wider than its DRAW (a trailing advance per
//   glyph that the draw does not emit), which would absorb the 10px. Our
//   Font.measure subtracts exactly one trailing advance, so ours does not.
//   WHAT WOULD SETTLE IT: a retail screenshot of a tooltip whose widest line
//   is a long item name. If the text clears the border there, the gap is in
//   the font metrics, not in this geometry, and the fix belongs in
//   js/ui/font.js -- NOT in padding this box by hand.
//
// GAPS, marked AUTHORED / NOT BRIDGED at their sites below:
//   * which texture the grade symbol name resolves to (build_uiskin.py);
//   * CurrentDurability and RefineryOp1/2 are on the wire but the gateway
//     drops them, so the shadow-item countdown and the augmentation block
//     cannot be drawn;
//   * exact glyph-level line metrics inside a line (see layout()).

import { Skin } from './skin.js';
import { Font } from './font.js';

const SPEC_URL = '/gamedata/itemtooltip.json';
const TIP_URL = '/gamedata/itemtip.json';
const SYSSTR_URL = '/gamedata/sysstring.json';

let _spec = null;      // itemtooltip.json — the decoded contract
let _tip = null;       // itemtip.json — per-item static fields
let _sys = null;       // sysstring id -> text
let _loading = null;

/** Fetch the three tables the tooltip needs. Idempotent. */
export function loadTooltipData() {
  if (_loading) return _loading;
  _loading = Promise.all([
    fetch(SPEC_URL).then(r => r.json()),
    fetch(TIP_URL).then(r => r.json()),
    fetch(SYSSTR_URL).then(r => r.json()),
  ]).then(([spec, tip, sys]) => {
    _spec = spec;
    _tip = tip;
    _sys = new Map(sys.map(e => [e.id, e.string]));
    return true;
  });
  return _loading;
}

export function tooltipReady() { return _spec !== null; }
export function tooltipSpec() { return _spec; }
export function itemTipData(itemId) { return (_tip && _tip[String(itemId)]) || null; }

function S(id) { return (_sys && _sys.get(id)) || ''; }

// --- the natives, transcribed from itemtooltip.json ------------------------

/** GetItemGradeString + AddTooltipItemGrade: "" or a backticked symbol name. */
function gradeSymbol(crystalType) {
  const m = _spec.natives.gradeSymbol.byCrystalType[String(crystalType)];
  return m || '';
}

/** The sprite a grade symbol name draws with.
 *  AUTHORED — see tools/ui/build_uiskin.py: the five names are decoded, the
 *  name -> texture binding is not (the resolver is in Themida-packed
 *  Engine.dll). "graded" -> symbol.Icon.grade_d is the letter match. */
function gradeSprite(name) {
  const letter = name.replace(/^grade/, '');
  return letter ? `symbol.Icon.grade_${letter}` : null;
}

/** GetWeaponTypeString (NWindow.dll 0x10145ab0). */
function weaponTypeString(wt) {
  const id = _spec.natives.weaponType.sysstringByType[String(wt)];
  return id == null ? '' : S(id);
}

/** GetAttackSpeedString (NWindow.dll 0x10145ed0) — a compare ladder. */
function attackSpeedString(spd) {
  for (const step of _spec.natives.attackSpeed.ladder) {
    if (step.below == null || spd < step.below) return S(step.sysstring);
  }
  return '';
}

/** GetSlotTypeString (NWindow.dll 0x10145ba0). */
function slotTypeString(itemType, slotBit, armorType) {
  const n = _spec.natives.slotType;
  const table = n.byItemTypeAndSlotBit[String(itemType)];
  if (!table) return '';
  const id = ('*' in table) ? table['*'] : table[String(slotBit)];
  if (id == null) return '';
  let out = S(id);
  if (n.armorClassSuffixSlots.includes(String(slotBit))) {
    const k = n.armorClassBySysstring[String(armorType)];
    if (k != null) out += n.separator + S(k);
  }
  return out;
}

/** The enchant step functions (NWindow.dll 0x10146910 / 0x101469a0).
 *  These two expressions are the ONLY decoded arithmetic typed out here
 *  rather than read from itemtooltip.json (which carries them as prose in
 *  natives.enchant.weaponStep/armorStep). verify_tooltip.js's FORMAT gate
 *  recomputes P.Atk/M.Atk/P.Def in Node straight from the JSON tables and
 *  compares against what the page drew, so a drift between the two shows
 *  up as a red gate rather than as a wrong number nobody checks. */
function weaponStep(e) { return e <= 3 ? e : 2 * e - 3; }
function armorStep(e) { return e <= 3 ? e : 3 * e - 6; }

function patkTable(weaponType, slotBit) {
  const en = _spec.natives.enchant;
  const which = en.pAtkTableByWeaponType[String(weaponType)];
  if (!which) return null;
  if (which !== 'byHandedness') return en.pAtkTables[which];
  return slotBit === en.twoHandedSlotBit ? en.pAtkTables.twoHanded : en.pAtkTables.oneHanded;
}

function matkTable(weaponType, slotBit) {
  const en = _spec.natives.enchant;
  const which = en.mAtkTableByWeaponType[String(weaponType)];
  if (!which) return null;
  if (which !== 'byHandedness') return en.mAtkTables[which];
  return slotBit === en.twoHandedSlotBit ? en.mAtkTables.twoHanded : en.mAtkTables.oneHanded;
}

function physicalDamage(weaponType, slotBit, crystalType, enchant, base) {
  const t = patkTable(weaponType, slotBit);
  const bonus = t ? (t[crystalType] || 0) : 0;
  return Math.trunc(weaponStep(enchant) * bonus + base);
}

function magicalDamage(weaponType, slotBit, crystalType, enchant, base) {
  const t = matkTable(weaponType, slotBit);
  const bonus = t ? (t[crystalType] || 0) : 0;
  return Math.trunc(weaponStep(enchant) * bonus + base);
}

/** GetPhysicalDefense / GetMagicalDefense / GetShieldDefense — one routine
 *  at 0x1014e330, one table, so all three share this. Note table[0] is 0.0:
 *  a no-grade piece gains nothing from its enchant. */
function defense(crystalType, enchant, base) {
  const bonus = _spec.natives.enchant.defenseTable[crystalType] || 0;
  return Math.trunc(armorStep(enchant) * bonus + base);
}

/** IsStackableItem (NWindow.dll 0x100f6a00): the three compare immediates. */
function isStackable(consumeType) {
  return _spec.natives.predicates.isStackableItem.values.includes(consumeType);
}

/** MakeCostString (NWindow.dll 0x10062590): a ',' every three digits from the
 *  right, never leading (`movw $0x2c` at 0x100626a8, guarded at 0x100626a4). */
export function makeCostString(n) {
  const s = String(n);
  const neg = s.startsWith('-');
  const d = neg ? s.slice(1) : s;
  let out = '';
  for (let i = 0; i < d.length; i++) {
    if (i > 0 && (d.length - i) % 3 === 0) out += ',';
    out += d[i];
  }
  return (neg ? '-' : '') + out;
}

// --- the draw list ---------------------------------------------------------

const DIT = { BLANK: 0, TEXT: 1 };

const LABEL = '#A3A3A3';      // Tooltip.uc:1712 (AddTooltipItemOption title)
const VALUE = '#B09B79';      // Tooltip.uc:1744 (AddTooltipItemOption content)
const SECTION = '#FFFFFF';    // Tooltip.uc:419/459/665 SetTooltipItemColor
const DESC = '#B2BECF';       // Tooltip.uc:719
const ADDNAME = '#FFD969';    // Tooltip.uc:1861
const SETNAME = '#70737B';    // Tooltip.uc:749
const SETEFFECT = '#807F67';  // Tooltip.uc:773
const SETENCHANT = '#4A5C68'; // Tooltip.uc:797

class ListBuilder {
  constructor(defaultColor) {
    this.list = [];
    this.def = defaultColor;
  }

  /** one DrawItemInfo */
  push(o) {
    this.list.push(Object.assign({
      type: DIT.TEXT, offsetY: 0, lineBreak: false, oneLine: false,
      color: this.def, text: '', height: 0,
    }, o));
    return this;
  }

  /** AddTooltipItemOption (Tooltip.uc:1702) — "<label> : <value>". */
  option(titleId, content, { title = true, value = true, first = false } = {}) {
    const oy = first ? 0 : 6;
    if (title) {
      this.push({ offsetY: oy, lineBreak: true, oneLine: true,
        color: LABEL, text: S(titleId) });
    }
    if (value) {
      if (title) {
        this.push({ offsetY: oy, oneLine: true, color: LABEL, text: ' : ' });
      }
      this.push({ offsetY: oy, lineBreak: !title, oneLine: true,
        color: VALUE, text: content });
    }
    return this;
  }

  /** AddTooltipItemOption2 (uc:1755) — the value is a SysString too. */
  option2(titleId, contentId, opts) {
    return this.option(titleId, S(contentId), opts);
  }

  /** SetTooltipItemColor (uc:1807) — retint the Nth-from-last entry. */
  recolor(hex, offset = 0) {
    const i = this.list.length - 1 - offset;
    if (i >= 0) this.list[i].color = hex;
    return this;
  }

  /** AddTooltipItemBlank (uc:1818). */
  blank(h) { return this.push({ type: DIT.BLANK, height: h }); }
}

/**
 * Build the DrawList for one item, in Tooltip.uc:213-820's order.
 *
 * `item` is what the live inventory gives us:
 *   { itemId, name, count, enchant, itemType, slotBit }
 * itemType is the server's ItemList `type2` (aCis Item.TYPE2_*), which IS
 * the client's EItemType; slotBit is ItemList `bodyPart`, which IS
 * ItemInfo.SlotBitType.
 *
 * Only TooltipType "Inventory" is produced here. The five price variants
 * exist in the .uc and are recorded in itemtooltip.json.tooltipTypes; they
 * need GetNumericColor and ConvertNumToText, which are not decoded yet.
 */
export function buildItemDrawList(item) {
  const t = itemTipData(item.itemId) || {};
  const b = new ListBuilder(_spec.window.defaultTextColor);
  const itemType = item.itemType | 0;
  const slotBit = item.slotBit | 0;
  const enchant = item.enchant | 0;
  const ct = t.ct | 0;
  let largeWidth = false;

  // uc:259 AddTooltipItemEnchant. IsEnchantableItem (uc:131) tests
  // EItemParamType(Item.ItemType) against WEAPON/ARMOR/ACCESSARY/SHIELD =
  // 0..3 -- but ItemType is an EItemType, whose 0..3 are WEAPON, ARMOR,
  // ACCESSARY, QUESTITEM. Retail therefore prefixes a quest item with its
  // enchant too. Reproduced deliberately; do not "fix" it.
  if (enchant > 0 && itemType <= 3) {
    b.push({ oneLine: true, color: VALUE, text: `+${enchant} ` });
  }

  // uc:262 AddTooltipItemName. No colour -> the ctor default (white).
  // GetRefineryItemName only alters the name for an augmented weapon, and
  // augmentation is not bridged, so it is the plain name here.
  b.push({ oneLine: true, text: item.name });
  if (t.an) b.push({ oneLine: true, color: ADDNAME, text: ` ${t.an}` });

  // uc:265 AddTooltipItemGrade — a space, then the `symbol` run.
  const grade = gradeSymbol(ct);
  if (grade) {
    b.push({ oneLine: true, text: ' ' });
    b.push({ oneLine: true, symbol: gradeSprite(grade),
      text: `\`${grade}\``, height: _spec.window.gradeSymbolSize,
      width: _spec.window.gradeSymbolSize });
  }

  // uc:269 AddTooltipItemCount
  if (isStackable(t.cons | 0)) {
    b.push({ oneLine: true, text: ` (${makeCostString(item.count | 0)})` });
  }

  // uc:272 the adena read-out. ConvertNumToText spells the number out in
  // words and is NOT decoded, so this entry is skipped rather than faked.
  // (It only ever fires for ClassID 57.)

  // ------------------------------------------------------------------
  // uc:398 SlotString, then the per-category switch
  const slotString = slotTypeString(itemType, slotBit, t.at | 0);

  if (itemType === 0) {                       // ITEM_WEAPON (uc:404)
    largeWidth = true;
    const wtStr = weaponTypeString(t.wt | 0);
    if (wtStr.length > 0) {
      b.option(0, `${wtStr} / ${slotString}`, { title: false });
    }
    b.blank(12);                                                   // uc:415
    b.option(1489, '', { value: false }).recolor(SECTION);          // uc:418
    b.option(94, String(physicalDamage(t.wt | 0, slotBit, ct, enchant, t.pat | 0)));
    b.option(98, String(magicalDamage(t.wt | 0, slotBit, ct, enchant, t.mat | 0)));
    b.option(111, attackSpeedString(t.spd | 0));                   // uc:428
    if ((t.ss | 0) > 0) b.option(404, `X ${t.ss}`);                // uc:433
    if ((t.sps | 0) > 0) b.option(496, `X ${t.sps}`);              // uc:439
    b.option(52, String(t.w | 0));                                 // uc:443
    if ((t.mp | 0) !== 0) b.option(320, String(t.mp));             // uc:448
    // uc:452 the augmentation block needs RefineryOp1/2 — NOT BRIDGED.
  } else if (itemType === 1) {                // ITEM_ARMOR (uc:532)
    largeWidth = true;
    if (_spec.shieldSlotBits.includes(slotBit)) {                  // uc:536
      b.option(95, String(defense(ct, enchant, t.sdef | 0)));
      b.option(317, String(t.srate | 0));
      b.option(97, String(t.avo | 0));
      b.option(52, String(t.w | 0));
    } else if ((t.at | 0) === 3) {            // IsMagicalArmor (uc:552)
      if (slotString.length > 0) b.option(0, slotString, { title: false });
      b.option(388, String(t.mpb | 0));
      b.option(95, String(defense(ct, enchant, t.pdef | 0)));
      b.option(52, String(t.w | 0));
    } else {                                                       // uc:569
      if (slotString.length > 0) b.option(0, slotString, { title: false });
      b.option(95, String(defense(ct, enchant, t.pdef | 0)));
      b.option(52, String(t.w | 0));
    }
  } else if (itemType === 2) {                // ITEM_ACCESSARY (uc:585)
    largeWidth = true;
    if (slotString.length > 0) b.option(0, slotString, { title: false });
    b.option(99, String(defense(ct, enchant, t.mdef | 0)));
    b.option(52, String(t.w | 0));
  } else if (itemType === 3) {                // ITEM_QUESTITEM (uc:600)
    largeWidth = true;
    if (slotString.length > 0) b.option(0, slotString, { title: false });
  } else if (itemType === 5) {                // ITEM_ETCITEM (uc:609)
    largeWidth = true;
    // uc:612-646 pet collar / lord's ticket / lotto / race ticket all read
    // per-instance fields (Enchanted, Blessed, Damaged) that the inventory
    // packet does not carry for etc items; only Weight is unconditional.
    b.option(52, String(t.w | 0));                                 // uc:648
  }
  // ITEM_ASSET (4) has no case in the switch — adena shows name + count only.

  // ------------------------------------------------------------------
  // uc:656 the shadow-item block needs CurrentDurability — NOT BRIDGED.

  // uc:711 the description
  if (t.d) {
    largeWidth = true;
    b.push({ offsetY: 6, lineBreak: true, color: DESC, text: t.d });
  }

  // uc:729 set items. GetSetItemIDList / GetSetItemEffectDescription /
  // GetSetItemEnchantEffectDescription read ItemName-e.dat, which is on disk
  // as itemname.json -> itemtip.json (sid / sd / se).
  // The "enabled" colours (uc:758/783/806) apply when the rest of the set is
  // WORN; that is a NWndUtil::DrawItemApplyCondition decision made against
  // the live paperdoll and is not implemented, so every set line uses its
  // NormalColor.
  if (t.sid) {
    for (const id of t.sid) {
      if (id === item.itemId) continue;
      const nm = setPieceName(id);
      if (!nm) continue;
      largeWidth = true;
      b.push({ offsetY: 6, lineBreak: true, oneLine: true, color: SETNAME, text: nm });
    }
  }
  if (t.sd) {
    largeWidth = true;
    b.push({ offsetY: 6, lineBreak: true, color: SETEFFECT, text: t.sd });
  }
  if (t.se) {
    largeWidth = true;
    b.push({ offsetY: 6, lineBreak: true, color: SETENCHANT, text: t.se });
  }

  return { list: b.list, minWidth: largeWidth ? _spec.minimumWidth : 0 };
}

// Set-piece names come from the caller's item-name table (itemmeta.json),
// injected once so this module keeps a single data dependency of its own.
let _nameLookup = null;
export function setItemNameSource(fn) { _nameLookup = fn; }
function setPieceName(id) { return _nameLookup ? _nameLookup(id) : ''; }

// --- layout ---------------------------------------------------------------

/**
 * Group the DrawList into lines and measure them, following
 * TooltipInfo::CalculateSize -> 0x10065570:
 *   * a DIT_BLANK ends the line and contributes exactly b_nHeight;
 *   * bLineBreak starts a new line;
 *   * line height = max over the line of (nOffSetY + item height);
 *   * W = max(MinimumWidth, widest line), H = sum of line heights, with NO
 *     padding added anywhere.
 *
 * INFERENCE, labelled: within a line each item is drawn at
 * lineTop + nOffSetY. The measure only proves nOffSetY enters the line
 * HEIGHT; the placement routine (0x10068be0) was not decoded that far. It is
 * the only reading consistent with the height rule, and in practice every
 * item on a line carries the same nOffSetY.
 */
export function layout(drawList, minWidth) {
  // The retail SmallFont's own line height. AUTHORED fallback 12 only if
  // the font manifest failed to load, in which case nothing renders anyway.
  const lh = Font.lineHeight('small') || 12;
  const lines = [];
  let cur = { items: [], w: 0, h: 0 };
  let width = minWidth;

  const flush = () => {
    if (cur.items.length) {
      if (cur.w > width) width = cur.w;
      lines.push(cur);
    }
    cur = { items: [], w: 0, h: 0 };
  };

  for (const it of drawList) {
    if (it.type === DIT.BLANK) {
      flush();
      lines.push({ items: [], w: 0, h: it.height });
      continue;
    }
    if (it.lineBreak) flush();

    let w, h, wrapped = null;
    if (it.symbol) {
      w = it.width; h = it.height;
    } else if (it.oneLine) {
      w = Font.measure(it.text, 'small');
      h = lh;
    } else {
      // The wrapping branch: CalculateSize hands the measure the width still
      // available on this line (0x10065712, `ebx - esi`). ebx is the running
      // max, so the very first wrapped block wraps against MinimumWidth.
      wrapped = wrap(it.text, Math.max(width, minWidth) - cur.w);
      w = Math.max(...wrapped.map(s => Font.measure(s, 'small')), 0);
      h = wrapped.length * lh;
    }
    cur.items.push({ src: it, x: cur.w, w, h, wrapped });
    cur.w += w;
    cur.h = Math.max(cur.h, it.offsetY + h);
  }
  flush();

  const height = lines.reduce((a, l) => a + l.h, 0);
  return { lines, width: Math.max(width, minWidth), height };
}

function wrap(text, avail) {
  const words = String(text).split(/(\s+)/);
  const out = [];
  let line = '';
  for (const w of words) {
    const cand = line + w;
    if (line && Font.measure(cand, 'small') > avail && avail > 0) {
      out.push(line.replace(/\s+$/, ''));
      line = w.replace(/^\s+/, '');
    } else {
      line = cand;
    }
  }
  out.push(line);
  return out.filter((s, i) => s.length > 0 || i === 0);
}

// --- the window -----------------------------------------------------------

const SLICE = ['TL', 'T', 'TR', 'L', 'C', 'R', 'BL', 'B', 'BR'];

/** The singleton tooltip. One per document, exactly as NCTooltip is one per
 *  client (NCTooltipManager holds a single NCTooltip). */
class TooltipWindow {
  constructor(parent = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'l2-tooltip';
    Object.assign(this.root.style, {
      // AUTHORED: a DOM stacking order, not retail geometry. NCTooltip is
      // drawn last of all by the client's own render loop, so it must sit
      // above every L2Window (which use z-indexes in the low hundreds).
      position: 'fixed', left: '0', top: '0', zIndex: '9000',
      pointerEvents: 'none', display: 'none',
    });
    this.frame = [];
    for (let i = 0; i < 9; i++) {
      const d = document.createElement('div');
      d.dataset.slice = SLICE[i];
      d.style.position = 'absolute';
      this.root.appendChild(d);
      this.frame.push(d);
    }
    this.content = document.createElement('div');
    Object.assign(this.content.style, { position: 'absolute', left: '0', top: '0' });
    this.root.appendChild(this.content);
    parent.appendChild(this.root);
    this.visible = false;
    this.lastModel = null;
  }

  hide() {
    this.visible = false;
    this.root.style.display = 'none';
  }

  /** Paint `item` and place the box at the cursor, retail-style. */
  show(item, cursorX, cursorY) {
    if (!_spec || !Font.ready || !Skin.ready) return;
    const { list, minWidth } = buildItemDrawList(item);
    const geo = layout(list, minWidth);
    this.lastModel = { item, list, geo };
    this.render(geo);
    this.place(geo, cursorX, cursorY);
    this.visible = true;
    this.root.style.display = 'block';
  }

  render(geo) {
    const s = Skin.scale;
    const W = geo.width, H = geo.height;
    const c = _spec.window.sliceCorner;
    const refs = _spec.window.textureRefs;
    // NCTooltip::DrawTooltip 0x10054680, row-major, corners c x c, edges
    // stretched to W-2c / H-2c, centre filling the rest.
    const cells = [
      [0, 0, c, c], [c, 0, W - 2 * c, c], [W - c, 0, c, c],
      [0, c, c, H - 2 * c], [c, c, W - 2 * c, H - 2 * c], [W - c, c, c, H - 2 * c],
      [0, H - c, c, c], [c, H - c, W - 2 * c, c], [W - c, H - c, c, c],
    ];
    cells.forEach(([x, y, w, h], i) => {
      const d = this.frame[i];
      d.style.left = `${x * s}px`;
      d.style.top = `${y * s}px`;
      d.style.width = `${Math.max(0, w) * s}px`;
      d.style.height = `${Math.max(0, h) * s}px`;
      Skin.apply(d, refs[i], { stretch: true });
    });

    Object.assign(this.root.style, { width: `${W * s}px`, height: `${H * s}px` });
    const inset = _spec.window.contentInset;
    Object.assign(this.content.style, {
      left: `${inset * s}px`, top: `${inset * s}px`,
    });

    this.content.replaceChildren();
    // same AUTHORED fallback as layout(); they must agree or wrapped
    // blocks would be drawn on a different pitch than they were measured
    const lh = Font.lineHeight('small') || 12;
    let y = 0;
    for (const line of geo.lines) {
      for (const cell of line.items) {
        const it = cell.src;
        if (it.symbol) {
          const g = document.createElement('div');
          Object.assign(g.style, {
            position: 'absolute',
            left: `${cell.x * s}px`, top: `${(y + it.offsetY) * s}px`,
            width: `${cell.w * s}px`, height: `${cell.h * s}px`,
          });
          Skin.apply(g, it.symbol, { stretch: true });
          this.content.appendChild(g);
          continue;
        }
        const rows = cell.wrapped || [it.text];
        rows.forEach((text, k) => {
          if (!text) return;
          const e = document.createElement('div');
          Object.assign(e.style, {
            position: 'absolute',
            left: `${cell.x * s}px`,
            top: `${(y + it.offsetY + k * lh) * s}px`,
            whiteSpace: 'pre',
          });
          Font.set(e, text, { color: it.color });
          this.content.appendChild(e);
        });
      }
      y += line.h;
    }
  }

  /** DrawTooltip 0x1005473e-0x1005478d: the box sits ABOVE the cursor; if
   *  that would clip the top it flips to cursorY + 0x20. Horizontally it is
   *  pushed back inside the screen. */
  place(geo, cursorX, cursorY) {
    const s = Skin.scale;
    const W = geo.width * s, H = geo.height * s;
    const sw = window.innerWidth, sh = window.innerHeight;
    let x = cursorX;
    if (x + W > sw) x -= (x + W - sw);
    if (x < 0) x = 0;
    let y = cursorY - H;
    if (y < 0) y = cursorY + _spec.window.flipBelowCursorOffset * s;
    if (y + H > sh) y = Math.max(0, sh - H);
    this.root.style.left = `${Math.round(x)}px`;
    this.root.style.top = `${Math.round(y)}px`;
  }
}

let _wnd = null;

/** The document's one tooltip window, created on first use. */
export function tooltipWindow(parent) {
  if (!_wnd) _wnd = new TooltipWindow(parent);
  return _wnd;
}

/**
 * Make `el` show the item tooltip on hover.
 *
 * `getItem` returns { itemId, name, count, enchant, itemType, slotBit } or
 * null. It is called on every move so an equip/unequip under the cursor
 * repaints rather than going stale.
 */
export function attachItemTooltip(el, getItem) {
  const enter = (ev) => {
    const it = getItem();
    if (!it || !tooltipReady()) return;
    // Park the browser's own `title` bubble while ours is up: retail shows
    // its tooltip immediately and the UA's would fade in a second later on
    // top of it. The attribute is restored on leave because the existing
    // suites (verify_skills, verify_inventorywnd) read it without hovering.
    if (el.title) { el.dataset.uaTitle = el.title; el.title = ''; }
    tooltipWindow().show(it, ev.clientX, ev.clientY);
  };
  const leave = () => {
    if (el.dataset.uaTitle != null) {
      el.title = el.dataset.uaTitle;
      delete el.dataset.uaTitle;
    }
    if (_wnd) _wnd.hide();
  };
  el.addEventListener('mouseenter', enter);
  el.addEventListener('mousemove', enter);
  el.addEventListener('mouseleave', leave);
}

/**
 * The server's ItemList `type2` IS the client's EItemType, and it is what
 * the tooltip switches on. This is the fallback for the offline/mock paths
 * where the field never arrives: it recovers the category from the slot bit
 * and the grp table the item lives in.
 *
 * FALLBACK, NOT A DECODE. It cannot tell a quest item from an etc item —
 * only type2 carries that (gateway/src/gameclient.js parseItemEntry says so).
 * When type2 is present it is used unchanged.
 */
export function itemTypeOf(it) {
  if (it.type2 != null) return it.type2 | 0;
  const t = itemTipData(it.itemId);
  if (!t) return 5;
  const accessorySlots = _spec
    ? Object.keys(_spec.natives.slotType.byItemTypeAndSlotBit['2']).map(Number)
    : [];
  if (accessorySlots.includes(it.slot | 0)) return 2;
  if (t.g === 'armor') return 1;
  if (t.g === 'weapon') return (t.sdef != null) ? 1 : 0;   // shields are ARMOR
  return 5;
}
