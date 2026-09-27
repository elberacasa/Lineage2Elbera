#!/usr/bin/env python3
"""Elbera Tools: original pawn slots, sequence timing and notify inputs.

This exports source inputs for the native scheduler, not a replacement timing
rule or proof that the browser implements complete native playback.

---------------------------------------------------------------------------
1. THE CLIENT SHIPS ITS OWN PAWN ANIMATION TABLE
---------------------------------------------------------------------------
`Engine.Pawn` declares the pawn animation slots as `var localized name`
arrays — the same declaration shape as `PcSocialAnimName`, which
tools/anim/creature_anim_table.py already decrypts for the twelve social
emotes.  The values live in

    assets/interlude/system/lineagewarrior.int      (Lineage2Ver111)

one section per race/sex prefix (14 of them: MFighter … FDwarf), and every
animation-name slot is indexed by the WEAPON STANCE:

    [MFighter]
    CastShortAnimName[1]=CastShort_MFighter
    MagicThrowAnimName[1]=MagicThrow_MFighter
    SpAtk01AnimName[1]=SpAtk01_1HS_MFighter
    SpAtk25AnimName[3]=SpAtk03_1HS_MFighter        <-- slot 25 is clip 03
    SpAtk15AnimName[3]=shieldatk_1HS_MFighter      <-- and slot 15 a shield bash
    SpAtk05AnimName[0..5]=Social_dance_MFighter    <-- the dance IS a SpAtk slot

The index domain is the client's own handness enumeration, already recovered
into editor/characters/stances.json from NWindow.dll's pawn-viewer literals:

    0(HAND) 1(1HS) 2(2HS) 3(DUAL) 4(POLE) 5(BOW) 7(DUALFIST)

and lineagewarrior.int agrees with it independently — index 4 carries every
pawn's `*_Pole_*` clips and index 5 every `*_Bow_*` clip, checked for all 14
prefixes (see check_stance_order()).  NOTE for readers of
tools/src/char_pipeline/anim_stances.py and tools/audio/build_stepnotify.py:
both hold the six tokens in the order `Hand 1HS 2HS Dual Bow Pole` under a
comment calling that "the client's handness order".  It is not — Pole is 4
and Bow is 5.  Neither file indexes by position, so nothing is broken there,
but the comment is wrong and this file does not copy it.

SitAnimName/SitWaitAnimName/StandAnimName and WaitAnimName are retained too.
SitAnimRate and StandAnimRate are scalar localized floats, separately parsed
and stored with original Float32 precision as rates.sit/rates.stand. See
docs/sitting-animation-audit.md for original transition and waiting selection.

Two consequences, both MEASURED here rather than reasoned from names:

  * the seven magic slots (CastShort/CastMid/CastLong/CastEnd/MagicShot/
    MagicThrow/MagicNoTarget) hold the SAME clip at every one of the six
    stances, for every pawn — 98/98 (pawn, slot) pairs.  A magic cast does
    not vary with the equipped weapon.
  * the physical SpAtk slots DO vary by stance, and slot number is NOT clip
    number.  Building the clip name by pasting "spatk%02d_%s" is wrong for a
    measurable share of the table (audit_castanim.py counts it).

---------------------------------------------------------------------------
2. THE CLIPS CARRY THE PHASE KEYFRAMES
---------------------------------------------------------------------------
Every original MeshAnimation is traversed to its declared end, including all
compressed movement chunks and version-specific sequence trailers. This
replaces PSA-guided byte scanning in the production exporter. The independent
older reader remains a regression comparison for all 14 original exports.

Source NumFrames, Rate and normalized notify Time are preserved without
rounding. Notify arrays retain serialized order, object/function identity and
null objects. isAttackShot follows the original qualified class/superclass
chain; a similarly named unrelated class cannot masquerade as AttackShot.
The source contains two null-object Elf notifies with times above 1; those
remain intact instead of being clamped or silently discarded.

`t` is the original Float32 normalized sequence time. The legacy diagnostic
`u = t*NumFrames/(NumFrames-1)` describes exported one-shot sample span only;
it is NOT the input for native scheduling. `sec` and `dur` are unrounded
arithmetic conveniences, not independent original fields. See
 docs/native-animation-terminal-evidence.md for endpoint/loop distinctions.

---------------------------------------------------------------------------
3. ORIGINAL SELECTOR PROOF AND REMAINING LIMITS
---------------------------------------------------------------------------
Engine.dll's SetSkillAnim has now been statically recovered. Its original
skillgrp animation code -> ordered pawn-slot selection is verified by
 tools/ui/check_skillanim_native.py and docs/native-skill-animation-evidence.md.
This exporter supplies each selected slot's exact .int sequence and original
notify data. It does not establish the runtime's phase-transition scheduling,
playback-rate calculation, interruption semantics or NPC overrides. The
browser's supported ordinary phase scheduler consumes these source inputs;
native pose interpolation and notify effects remain separate work. No duration
threshold is claimed as an original selector rule.

---------------------------------------------------------------------------
WHAT THIS WRITES
---------------------------------------------------------------------------
    editor/characters/pawnanim.json      (served at /characters/pawnanim.json)

    {"format": "l2-interlude-pawn-animation-v2", "source": {...},
     "stanceIndex": ["hand","1hs","2hs","dual","pole","bow"],
     "magicSlots": [...], "physicalSlots": [...],
     "models": {"<id>": {
        "prefix": "MFighter",
        "slots": {"<slot>": {"<stance>": {"seq","clip"}}},
        "unshipped": {"<slot>": {"<stance>": "<retail seq with no glTF clip>"}},
        "slotSource": {"<slot>": {"<stance>": {"seq","clip","status"}}},
        "rates": {"atk01": 0.8333, ...}}},
     "clips": {"<id>": {"<glTF clip>": {
        "seq","frames","rate","dur","originalTiming":true,"source":{...},
        "notifies":[{"index","kind","t","u","sec","function","objectRef",
                     "classPath","isAttackShot","sound"}]}}},
     "sequences": {"<id>": {"<original lowercase name>": {same source metadata}}}}

Present originalTiming:true + notifies:[] is verified empty source, not missing
metadata. sequences retains source even when no browser clip was exported.
slotSource distinguishes source-none, source-sequence and missing-source-sequence.
Missing slots remain absent; they are not invented as empty source sequences.

Usage:
  python3 tools/anim/build_pawnanim.py            # write it
  python3 tools/anim/build_pawnanim.py --check    # re-derive, diff, no write
  python3 tools/anim/build_pawnanim.py --selftest # prove the gates can fail
"""

import argparse
import collections
import hashlib
import json
import math
import os
import re
import struct
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                     "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tools", "world"))
sys.path.insert(0, os.path.join(ROOT, "tools", "audio"))

from l2lib import load_package, read_properties, L2Error      # noqa: E402
from l2lib.ue2package import decrypt_file_bytes, Reader       # noqa: E402

CLIENT = os.path.join(ROOT, "assets", "interlude")
WARRIOR_INT = os.path.join(CLIENT, "system", "lineagewarrior.int")
ANIMS = os.path.join(CLIENT, "animations")
CHARACTERS = os.path.join(ROOT, "editor", "characters")
MANIFEST = os.path.join(CHARACTERS, "manifest.json")
OUT = os.path.join(CHARACTERS, "pawnanim.json")
FORMAT = "l2-interlude-pawn-animation-v2"


def _require(condition, message):
    if not condition:
        raise L2Error(message)


def file_sha256(path):
    with open(path, 'rb') as stream:
        return hashlib.sha256(stream.read()).hexdigest()


def source_ref_path(pkg, ref, package_name):
    """Resolve the serialized outer chain without dropping its package."""
    if not ref:
        return None
    parts, seen, local = [], set(), ref > 0
    while ref:
        _require(ref not in seen, "cyclic source object outer chain")
        seen.add(ref)
        obj = pkg.resolve_ref(ref)
        parts.append(pkg.export_name(obj) if ref > 0 else pkg.import_name(obj))
        ref = obj.package_index
    return '.'.join(([package_name] if local else []) + list(reversed(parts)))


def original_sequences(pkg, exp):
    """Existing timing/notify API; does not retain or emit source pose arrays."""
    return original_animation(pkg, exp)['sequences']


def original_animation(pkg, exp, *, include_tracks=False):
    """Traverse version123/licensee28-or30 MeshAnimation1 within declared bounds.

    This follows every compressed movement/sequence trailer to its endpoint;
    there is no PSA oracle, byte search or guessed per-record padding. The
    independent terminal verifier implements the same original serializer
    layout separately and measures source key tails. Optional pose retention
    keeps original sparse keys, flags, indices and root tracks unchanged;
    it does not resample, normalize, match bones or infer playback semantics.
    """
    # Elf.ukx is licensee28; the six other player packages are licensee30.
    # Both use the same >=27 Lineage FLineageUnk4 sequence trailer and >=25
    # absolute movement endpoints (UnMesh2.h / SerializeLineageMoves).
    _require(pkg.file_version == 123 and pkg.licensee_version in (28, 30),
             "unsupported original MeshAnimation package version")
    _require(pkg.class_name_of(exp) == 'MeshAnimation', "not a MeshAnimation export")
    start, end = exp.serial_offset, exp.serial_offset + exp.serial_size
    _require(0 <= start < end <= len(pkg.data), "invalid MeshAnimation export bounds")
    reader = Reader(pkg.data[:end], start, path=pkg.path)
    read_properties(pkg, reader)
    _require(reader.i32() == 1, "unsupported MeshAnimation version")

    def count(width=1):
        value = reader.compact()
        _require(0 <= value <= (end - reader.pos) // width, "invalid bounded array count")
        return value

    def name():
        return pkg.name(reader.compact())

    def array(width):
        n = count(width)
        return reader.bytes(n * width), n

    def track(allow_empty=False):
        track_start = reader.pos
        flags = reader.i32()
        quat_raw, quats = array(16)
        pos_raw, positions = array(12)
        raw, times = array(4)
        values = struct.unpack('<%df' % times, raw)
        _require((values or allow_empty) and quats in (1, times) and positions in (1, times),
                 "invalid source animation track cardinality")
        _require(all(math.isfinite(t) and t >= 0 for t in values)
                 and all(a <= b for a, b in zip(values, values[1:])), "invalid source key times")
        if include_tracks:
            quaternion_keys = list(struct.iter_unpack('<4f', quat_raw))
            position_keys = list(struct.iter_unpack('<3f', pos_raw))
            _require(all(math.isfinite(v) for row in quaternion_keys + position_keys for v in row),
                     "nonfinite source pose component")
            return {'flags': flags, 'quaternions': quaternion_keys, 'positions': position_keys,
                    'times': values, 'source': {'offset': track_start, 'size': reader.pos - track_start,
                        'SHA256': hashlib.sha256(pkg.data[track_start:reader.pos]).hexdigest()}}

    bones = count(9)
    bone_rows = []
    for index in range(bones):
        bone_name, flags, parent = name(), reader.i32(), reader.i32()
        _require(0 <= parent <= index, "invalid source bone parent")
        bone_rows.append({'name': bone_name, 'flags': flags, 'parent': parent})
    moves_end = reader.i32()
    _require(reader.pos < moves_end <= end, "invalid source movement endpoint")
    moves = []
    for _ in range(count(28)):
        move_start = reader.pos
        local_end = reader.i32()
        _require(reader.pos < local_end <= moves_end, "invalid source movement chunk endpoint")
        root_speed = struct.unpack('<3f', reader.bytes(12))
        duration = reader.f32()
        _require(math.isfinite(duration) and duration > 0, "invalid source movement duration")
        start_bone, flags = reader.i32(), reader.i32()
        index_raw, _ = array(4)
        ntracks = count(7)
        _require(ntracks == bones, "source movement/bone count mismatch")
        tracks = [track() for _ in range(ntracks)]
        root_track = track(allow_empty=True)
        _require(reader.pos == local_end, "source movement chunk not fully consumed")
        movement = {'duration': duration}
        if include_tracks:
            _require(all(math.isfinite(v) for v in root_speed), "nonfinite source root speed")
            movement.update(rootSpeed=root_speed, startBone=start_bone, flags=flags,
                boneIndices=struct.unpack('<%di' % (len(index_raw) // 4), index_raw),
                tracks=tracks, rootTrack=root_track,
                source={'offset': move_start, 'size': reader.pos - move_start,
                        'SHA256': hashlib.sha256(pkg.data[move_start:reader.pos]).hexdigest()})
        moves.append(movement)
    _require(reader.pos == moves_end, "source movements not fully consumed")
    _require(count(18) == len(moves), "source sequence/movement count mismatch")
    rows, seen = [], set()
    for index, movement in enumerate(moves):
        duration = movement['duration']
        record_start = reader.pos
        reader.f32()
        sequence = name()
        _require(sequence.lower() not in seen, "duplicate source sequence name")
        seen.add(sequence.lower())
        groups = [name() for _ in range(count())]
        start_frame, frames = reader.i32(), reader.i32()
        notifies = []
        for order in range(count(6)):
            t, function, ref = reader.f32(), name(), reader.compact()
            _require(math.isfinite(t), "nonfinite source notify time")
            if ref: pkg.resolve_ref(ref)
            notifies.append({'index': order, 't': t, 'function': function, 'objectRef': ref})
        rate = reader.f32()
        _require(frames > 0 and math.isfinite(rate) and rate > 0, "invalid source frames/rate")
        reader.i32(); reader.i32(); reader.i32(); reader.compact(); reader.i32(); reader.i32()
        reader.u8(); array(8)
        for _ in range(count(5)): reader.i32(); array(8)
        reader.i32(); reader.i32(); array(8)
        rows.append({'name': sequence, 'frames': frames, 'rate': rate,
                     'startFrame': start_frame, 'groups': groups, 'movementDuration': duration,
                     'notifies': notifies, 'source': {'index': index, 'offset': record_start,
                         'size': reader.pos - record_start,
                         'SHA256': hashlib.sha256(pkg.data[record_start:reader.pos]).hexdigest()}})
        if include_tracks:
            rows[-1]['movement'] = movement
    _require(reader.pos == end, "source MeshAnimation export not fully consumed")
    return {'bones': bone_rows, 'sequences': rows}


def class_parents(pkg, package_name):
    return {source_ref_path(pkg, e.index + 1, package_name).lower():
            source_ref_path(pkg, e.super_index, package_name)
            for e in pkg.exports if pkg.class_name_of(e) == 'Class'}


def is_notify_subtype(class_path, parents, target):
    """Original IsA semantics: identity or a serialized superclass chain."""
    seen = set()
    while class_path:
        key = class_path.lower()
        _require(key not in seen, "cyclic notify class ancestry")
        seen.add(key)
        _require(key in parents, "unresolved notify class ancestry: " + class_path)
        if key == target.lower(): return True
        if key == 'engine.animnotify': return False
        class_path = parents[key]
    raise L2Error('notify object is not an original AnimNotify subtype')


def is_attack_shot(class_path, parents):
    return is_notify_subtype(class_path, parents, 'Engine.AnimNotify_AttackShot')


def sound_class_defaults(engine):
    """Recover the original Sound class's unique typed default stream.

    Only explicit source defaults are returned. An absent Radius is not
    converted to a guessed zero or audio-driver default.
    """
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'dat'))
    from export_npc_visuals import OriginalClasses, terminal_defaults
    owners = [e for e in engine.exports_by_class('Class')
              if engine.export_name(e) == 'AnimNotify_Sound']
    _require(len(owners) == 1, 'missing or ambiguous original Sound notify class')
    catalog = OriginalClasses()
    props, evidence = terminal_defaults(engine, owners[0],
                                        catalog.property_types('Engine.AnimNotify_Sound', set()))
    _require(evidence['defaultsBoundary'] == 'unique-validated-candidate',
             'ambiguous Sound notify class defaults')
    values = {}
    for name, kind, value in props:
        if name not in ('Volume', 'Radius', 'Random'):
            continue
        _require(name not in values and kind == ('float' if name == 'Volume' else 'int')
                 and math.isfinite(value), 'invalid Sound notify default')
        values[name] = value
    return {'classPath': 'Engine.AnimNotify_Sound', 'values': values, 'source': evidence}


def sound_properties(props, defaults, class_path, sound):
    """Preserve authored scalars and proven inherited defaults, with gaps explicit."""
    values, sources = {}, {}
    for field in ('Volume', 'Radius', 'Random'):
        value, source = None, None
        if field in props:
            _require(len(props[field]) == 4, 'invalid Sound notify scalar width')
            value = struct.unpack('<f' if field == 'Volume' else '<i', props[field])[0]
            _require(math.isfinite(value), 'nonfinite Sound notify scalar')
            source = 'object'
        elif defaults and class_path.lower() == defaults['classPath'].lower() and field in defaults['values']:
            value, source = defaults['values'][field], defaults['classPath']
        values[field.lower()], sources[field.lower()] = value, source
    resolved = (class_path.lower() == 'engine.animnotify_sound'
                and all(v is not None for v in values.values()))
    return dict(values, fieldSources=sources, status=(
        'source-direct' if resolved and sound else 'source-surface' if resolved
        else 'unresolved-source-properties'))


def original_notify(pkg, note, package_name, parents, sound_defaults=None):
    """Keep null/function-only entries and source order; bound object tags."""
    row = dict(note, kind=None, classPath=None, isAttackShot=False, isBoneScale=False,
               isSound=False, objectName=None, objectPath=None)
    ref = note['objectRef']
    if not ref:
        return row
    _require(ref > 0, "imported notify objects are not decoded")
    exp = pkg.resolve_ref(ref)
    class_path = source_ref_path(pkg, exp.class_index, package_name)
    cls = pkg.class_name_of(exp)
    row.update(kind=cls.removeprefix('AnimNotify_'), classPath=class_path,
               isAttackShot=is_attack_shot(class_path, parents),
               isBoneScale=is_notify_subtype(class_path, parents, 'Engine.AnimNotify_BoneScale'),
               isSound=is_notify_subtype(class_path, parents, 'Engine.AnimNotify_Sound'),
               objectName=pkg.export_name(exp), objectPath=source_ref_path(pkg, ref, package_name))
    start, end = exp.serial_offset, exp.serial_offset + exp.serial_size
    _require(0 <= start < end <= len(pkg.data), 'invalid notify export bounds')
    reader = Reader(pkg.data[:end], start, path=pkg.path)
    props = read_properties(pkg, reader, fmt='packed')
    _require(reader.pos == end, 'source notify export not fully consumed')
    if 'Sound' in props:
        sound = Reader(props['Sound'])
        row['sound'] = source_ref_path(pkg, sound.compact(), package_name)
        _require(sound.pos == len(props['Sound']), 'invalid source sound reference')
    if row['isSound']:
        row['soundInfo'] = sound_properties(props, sound_defaults, class_path, row.get('sound'))
    row['source'] = {'export': exp.index, 'SHA256': hashlib.sha256(pkg.data[start:end]).hexdigest()}
    return row


def sequence_metadata(pkg, sequence, package_name, parents, sound_defaults=None):
    frames, rate = sequence['frames'], sequence['rate']
    duration = frames / rate
    scale = frames / (frames - 1.0) if frames > 1 else 1.0
    notes = [original_notify(pkg, n, package_name, parents, sound_defaults) for n in sequence['notifies']]
    for note in notes:
        note.update(u=note['t'] * scale, sec=note['t'] * duration)
    return {'seq': sequence['name'], 'frames': frames, 'rate': rate, 'dur': duration,
            'originalTiming': True, 'movementDuration': sequence['movementDuration'],
            'source': sequence['source'], 'notifies': notes}

# (client model id, .ukx package, lineagewarrior.int section / sequence
# prefix).  Same 14 rows as build_characters.COMBOS and
# build_stepnotify.PAWNS; asserted against the shipped manifest in build().
PAWNS = [
    ("human_fighter_m", "Fighter", "MFighter"),
    ("human_fighter_f", "Fighter", "FFighter"),
    ("human_mystic_m",  "Magic",   "MMagic"),
    ("human_mystic_f",  "Magic",   "FMagic"),
    ("elf_m",           "Elf",     "MElf"),
    ("elf_f",           "Elf",     "FElf"),
    ("darkelf_m",       "DarkElf", "MDarkElf"),
    ("darkelf_f",       "DarkElf", "FDarkElf"),
    ("orc_fighter_m",   "Orc",     "MOrc"),
    ("orc_fighter_f",   "Orc",     "FOrc"),
    ("orc_mystic_m",    "Shaman",  "MShaman"),
    ("orc_mystic_f",    "Shaman",  "FShaman"),
    ("dwarf_m",         "Dwarf",   "MDwarf"),
    ("dwarf_f",         "Dwarf",   "FDwarf"),
]

# The client's handness enumeration (NWindow.dll pawn-viewer literals, already
# in editor/characters/stances.json), CONFIRMED against lineagewarrior.int by
# check_stance_order().  6 is absent from the client's own list; 7 (DUALFIST)
# repeats the Hand clips and has no suffix of its own.
STANCE_INDEX = ["hand", "1hs", "2hs", "dual", "pole", "bow"]

# The seven slots that never vary with the stance (asserted, not assumed).
MAGIC_SLOTS = ["castShort", "castMid", "castLong", "castEnd",
               "magicShot", "magicThrow", "magicNoTarget"]

# lineagewarrior.int key -> the name used in the emitted table.
KEY_SLOT = {
    "WaitAnimName": "idle",
    "CastShortAnimName": "castShort", "CastMidAnimName": "castMid",
    "CastLongAnimName": "castLong", "CastEndAnimName": "castEnd",
    "MagicShotAnimName": "magicShot", "MagicThrowAnimName": "magicThrow",
    "MagicNoTargetAnimName": "magicNoTarget",
    "PicItemAnimName": "picItem",
    "SitAnimName": "sitDown", "SitWaitAnimName": "sitWait", "StandAnimName": "standUp",
    "ShieldAtkAnimName": "shieldAtk",
    "Atk01AnimName": "atk01", "Atk02AnimName": "atk02", "Atk03AnimName": "atk03",
    "AtkWaitAnimName": "atkWait",
}
for _i in range(1, 29):
    KEY_SLOT["SpAtk%02dAnimName" % _i] = "spAtk%02d" % _i

RATE_KEYS = {"Atk01AnimRate": "atk01", "Atk02AnimRate": "atk02",
             "Atk03AnimRate": "atk03"}

_SECTION_RE = re.compile(r"^\[(\w+)\]$")
_ENTRY_RE = re.compile(r"^(\w+)\[(\d+)\]=(.*)$")
_WAIT_RATE_RE = re.compile(r"^(sitanimrate|standanimrate)\s*=(.*)$", re.I)


# --------------------------------------------------------------------------
# lineagewarrior.int
# --------------------------------------------------------------------------
def read_warrior_int(path=WARRIOR_INT):
    """-> {prefix: {(key, index): value}}.  Lineage2Ver111, plain ASCII once
    decrypted (NOT UTF-16, unlike the .dat tables)."""
    with open(path, "rb") as fh:
        plain, _proto = decrypt_file_bytes(fh.read(), os.path.basename(path))
    return parse_warrior_int(plain.decode("latin1"))


def parse_warrior_int(text):
    """Keep indexed names and original scalar wait rates (index -1).

    SitAnimRate/StandAnimRate are scalar localized floats in Engine.Pawn;
    they must not be looked up as weapon-stance arrays.
    """
    out, cur = collections.defaultdict(dict), None
    for line in text.splitlines():
        line = line.strip()
        m = _SECTION_RE.match(line)
        if m:
            cur = m.group(1)
            continue
        m = _ENTRY_RE.match(line)
        if m and cur:
            out[cur][(m.group(1), int(m.group(2)))] = m.group(3).strip()
            continue
        m = _WAIT_RATE_RE.match(line)
        if m and cur:
            key = (m.group(1).lower(), -1)
            _require(key not in out[cur], "duplicate source wait-animation rate")
            out[cur][key] = m.group(2).strip()
    if not out:
        raise L2Error("parsed 0 animation sections")
    return out


def source_wait_rates(section):
    """Exact Float32 source scalars, without a missing-field/rate fallback."""
    result = {}
    for field, name in [('sitanimrate', 'sit'), ('standanimrate', 'stand')]:
        _require((field, -1) in section, 'missing source scalar ' + field)
        try:
            value = struct.unpack('<f', struct.pack('<f', float(section[field, -1])))[0]
        except (ValueError, OverflowError) as error:
            raise L2Error('invalid source scalar ' + field) from error
        _require(math.isfinite(value), 'nonfinite source scalar ' + field)
        result[name] = value
    return result


def check_stance_order(tbl, stats):
    """The stance index is the client's handness enum, not a name guess.
    Falsifiable: every WaitAnimName[i] must end in the suffix STANCE_INDEX[i]
    names.  Fails loudly if the order is wrong."""
    seen = 0
    for _mid, _pkg, prefix in PAWNS:
        for i, token in enumerate(STANCE_INDEX):
            v = tbl[prefix].get(("WaitAnimName", i))
            if v is None:
                raise L2Error("%s WaitAnimName[%d] missing" % (prefix, i))
            want = "_%s_" % token if token != "hand" else "_hand_"
            if want.lower() not in v.lower():
                raise L2Error("stance order wrong: %s WaitAnimName[%d]=%s "
                              "is not a '%s' clip" % (prefix, i, v, token))
            seen += 1
    if seen != len(PAWNS) * len(STANCE_INDEX):
        raise L2Error("stance-order gate evaluated %d assertions" % seen)
    stats["stance_order_checked"] = seen
    return seen


# --------------------------------------------------------------------------
# retail sequence name -> shipped glTF clip id
# --------------------------------------------------------------------------
# Reproduces tools/src/char_pipeline/build_characters.py exactly:
#   frozen unstanced names come from ANIM_CANDIDATES (first candidate that the
#   package ships wins), stanced ones from anim_stances.stance_clips()
#   ('<action>_<stance>' lowercase, Wait -> idle), social ones from
#   social_slot().  Rather than trust that reproduction, build() ASSERTS the
#   derived clip-id set equals the shipped manifest's animation list for all
#   14 models — if the pipeline ever renames a clip this file fails.
ANIM_CANDIDATES = {
    'idle':   ['Wait_Hand_{P}', 'Wait_1HS_{P}', 'SitWait_{P}'],
    'walk':   ['Walk_Hand_{P}', 'Walk_1HS_{P}'],
    'run':    ['Run_Hand_{P}', 'Run_1HS_{P}'],
    'sit':    ['SitWait_{P}'],
    'sitDown': ['Sit_{P}'],
    'standUp': ['Stand_{P}'],
    'dance':  ['Social_dance_{P}'],
    'attack': ['Atk01_Hand_{P}', 'Atk01_1HS_{P}'],
    'castShort':  ['CastShort_{P}'],
    'castMid':    ['CastMid_{P}'],
    'castLong':   ['CastLong_{P}'],
    'magicThrow': ['MagicThrow_{P}'],
    'spAtk01': ['SpAtk01_1HS_{P}', 'SpAtk02_1HS_{P}', 'SpAtk06_Hand_{P}'],
    'spAtk02': ['SpAtk02_1HS_{P}', 'SpAtk02_Bow_{P}', 'SpAtk01_2HS_{P}'],
    'die':    ['Death_{P}'],
    'damage': ['Damagefly_{P}', 'Damegefly_{P}'],
    # Exact additional slots verified against original .int and PSA.
    'castEnd':    ['CastEnd_{P}'],
    'magicShot':  ['MagicShot_{P}'],
    'magicNoTarget': ['MagicNoTarget_{P}'],
    'picItem':    ['PicItem_{P}'],
}
STANCE_ACTION_RE = re.compile(
    r'^(Wait|Walk|Run|AtkWait|ShieldAtk|Atk\d+|SpAtk\d+)_(Hand|1HS|2HS|Dual|Bow|Pole)$',
    re.I)
CLIP_ACTION = {'wait': 'idle', 'walk': 'walk', 'run': 'run',
               'atkwait': 'atkwait', 'shieldatk': 'shieldatk'}


def clip_index(seq_names, prefix):
    """-> {retail sequence name (lower): [glTF clip ids]}.

    One-to-MANY on purpose.  build_characters.py emits the same retail
    sequence under two clip ids when a frozen ANIM_CANDIDATES name and a
    stanced name both select it — `Atk01_Hand_MFighter` is shipped as both
    `attack` and `atk01_hand`, `SpAtk01_1HS_MFighter` as both `spAtk01` and
    `spatk01_1hs`.  Collapsing that to one id was the first version of this
    function and it dropped 3 clips per pawn; `pick()` chooses per stance."""
    have = {n.lower(): n for n in seq_names}
    idx = {}

    def claim(seq, clip):
        row = idx.setdefault(seq.lower(), [])
        if clip not in row:
            row.append(clip)

    for clip, cands in ANIM_CANDIDATES.items():
        for c in cands:
            hit = have.get(c.format(P=prefix).lower())
            if hit:
                claim(hit, clip)
                break
    suffix = "_" + prefix.lower()
    for low, orig in have.items():
        if not low.endswith(suffix):
            continue
        base = orig[:-len(suffix)]
        m = STANCE_ACTION_RE.match(base)
        if m:
            action, stance = m.group(1).lower(), m.group(2).lower()
            claim(orig, "%s_%s" % (CLIP_ACTION.get(action, action), stance))
        elif base.lower().startswith("social_"):
            claim(orig, "social_" + base[len("Social_"):].lower())
    return idx


def pick(cidx, seq, stance):
    """The glTF clip id to play for a retail sequence at a given stance:
    the stanced id when the model ships one, else the unstanced id.  Both
    name the SAME retail sequence, so this only decides which of the two
    duplicate glTF tracks is used — never which motion plays."""
    row = cidx.get(seq.lower())
    if not row:
        return None
    for c in row:
        if c.lower().endswith("_" + stance):
            return c
    return row[0]


# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------
def build(stats):
    tbl = read_warrior_int()
    check_stance_order(tbl, stats)

    with open(MANIFEST) as stream:
        manifest = {m["id"]: m for m in json.load(stream)["models"]}
    if sorted(manifest) != sorted(p[0] for p in PAWNS):
        raise L2Error("PAWNS and the shipped manifest disagree: %s vs %s"
                      % (sorted(p[0] for p in PAWNS), sorted(manifest)))

    models, clips, sequences = {}, {}, {}
    engine_path = os.path.join(CLIENT, 'system', 'Engine.u')
    engine, _ = load_package(engine_path)
    engine_parents = class_parents(engine, 'Engine')
    sound_defaults = sound_class_defaults(engine)
    package_cache = {}
    invariant_ok = invariant_tot = 0
    unshipped_magic = []
    notify_rows = 0
    for model_id, package, prefix in PAWNS:
        source_path = os.path.join(ANIMS, "%s.ukx" % package)
        if package not in package_cache:
            package_cache[package] = load_package(source_path)[0]
        pkg = package_cache[package]
        exp = [e for e in pkg.exports if pkg.export_name(e) == prefix + "_anim"
               and pkg.class_name_of(e) == 'MeshAnimation']
        if len(exp) != 1:
            raise L2Error("%s: no MeshAnimation %s_anim" % (package, prefix))
        seqs = original_sequences(pkg, exp[0])
        by_seq = {s["name"]: s for s in seqs}
        parents = dict(engine_parents, **class_parents(pkg, package))
        sequences[model_id] = {s['name'].lower(): sequence_metadata(pkg, s, package, parents, sound_defaults)
                               for s in seqs}
        notify_rows += sum(len(s['notifies']) for s in seqs)
        cidx = clip_index(by_seq, prefix)

        shipped = {a.lower(): a for a in manifest[model_id]["animations"]}
        # The pipeline ships only the twelve PcSocialAnimName emotes, not every
        # Social_* sequence in the package: retail's Social_SpWait01..04 are
        # real sequences with no glTF clip.  Drop derivations the model does
        # not carry — they belong in `unshipped`, which is the honest place
        # for "retail has it, we do not".
        cidx = {seq: [c for c in row if c.lower() in shipped]
                for seq, row in cidx.items()}
        cidx = {seq: row for seq, row in cidx.items() if row}
        # The gate that matters, and it is the strict direction: every cast,
        # attack and stanced clip the manifest DOES ship must be reachable
        # from a retail sequence name here.  A rename in the pipeline breaks
        # this instead of silently emptying the table.
        want = {c for c in shipped
                if c.startswith(("spatk", "atk0", "atkwait", "shieldatk",
                                 "cast", "magicthrow", "magicshot", "magicnotarget", "picitem"))}
        got = {c.lower() for row in cidx.values() for c in row}
        if not want <= got:
            raise L2Error("%s: shipped clips no retail sequence maps to: %s"
                          % (model_id, sorted(want - got)[:8]))
        stats["clip_ids_mapped"] = stats.get("clip_ids_mapped", 0) + len(want)

        # ---- slot table
        slots, unshipped, slot_source = {}, {}, {}
        for (key, si), value in sorted(tbl[prefix].items()):
            slot = KEY_SLOT.get(key)
            if slot is None or si >= len(STANCE_INDEX):
                continue
            stance = STANCE_INDEX[si]
            clip = pick(cidx, value, stance)
            status = ('source-none' if value.lower() in ('', 'none') else
                      'source-sequence' if value.lower() in sequences[model_id] else 'missing-source-sequence')
            slot_source.setdefault(slot, {})[stance] = {'seq': value, 'clip': clip, 'status': status}
            if clip is None:
                unshipped.setdefault(slot, {})[stance] = value
            else:
                slots.setdefault(slot, {})[stance] = {"seq": value, "clip": clip}
        # Stance-invariance is a claim about the CLIENT'S table, so it is
        # measured on the raw lineagewarrior.int values — not on the resolved
        # glTF clips, which would silently pass whenever a slot is unshipped.
        key_of = {v: k for k, v in KEY_SLOT.items()}
        for slot in MAGIC_SLOTS:
            raw = [tbl[prefix].get((key_of[slot], i))
                   for i in range(len(STANCE_INDEX))]
            invariant_tot += 1
            if any(v is None for v in raw):
                raise L2Error("%s %s: missing a stance entry" % (model_id, slot))
            if len({v.lower() for v in raw}) == 1:
                invariant_ok += 1
            else:
                raise L2Error("%s %s varies by stance: %s"
                              % (model_id, slot, sorted(set(raw))))
            if slot not in slots:
                unshipped_magic.append("%s.%s" % (model_id, slot))

        rates = {}
        for (key, si), value in tbl[prefix].items():
            if key in RATE_KEYS and si == 1:
                rates[RATE_KEYS[key]] = float(value)
        rates.update(source_wait_rates(tbl[prefix]))

        export = exp[0]
        models[model_id] = {"prefix": prefix, "slots": slots, 'slotSource': slot_source,
                            "unshipped": unshipped, "rates": rates,
                            'source': {'package': package + '.ukx',
                                'packageSHA256': file_sha256(source_path),
                                'export': export.index, 'fileVersion': pkg.file_version,
                                'licenseeVersion': pkg.licensee_version, 'animationVersion': 1,
                                'exportSHA256': hashlib.sha256(pkg.data[export.serial_offset:
                                    export.serial_offset + export.serial_size]).hexdigest()}}

        # ---- clip keyframes (only clips the glTF actually ships)
        cl = {}
        for seq_name, seq in by_seq.items():
            targets = cidx.get(seq_name.lower(), [])
            if not targets:
                continue
            for clip in targets:
                cl[clip] = sequences[model_id][seq_name.lower()]
        clips[model_id] = cl

    stats["magic_stance_invariant"] = "%d/%d" % (invariant_ok, invariant_tot)
    stats["magic_slots_not_shipped"] = unshipped_magic
    stats["notify_rows"] = notify_rows
    if invariant_ok != invariant_tot:
        raise L2Error("magic slots are not stance-invariant: %s"
                      % stats["magic_stance_invariant"])
    if notify_rows == 0:
        raise L2Error("0 notify rows — the gate would be vacuous")

    return {
        'format': FORMAT,
        "source": {
            'slotTableSHA256': file_sha256(WARRIOR_INT),
            'notifyClassPackage': {'file': 'Engine.u',
                'SHA256': file_sha256(engine_path)},
            'notifySoundDefaults': sound_defaults,
            "slot_table": "assets/interlude/system/lineagewarrior.int "
                          "(Lineage2Ver111) — Engine.Pawn's localized "
                          "*AnimName[stance] arrays, 14 sections",
            "stance_enum": "editor/characters/stances.json / NWindow.dll "
                           "0 HAND 1 1HS 2 2HS 3 DUAL 4 POLE 5 BOW, "
                           "re-confirmed against lineagewarrior.int",
            "keyframes": "assets/interlude/animations/<Pkg>.ukx "
                         "FMeshAnimSeq.Notifys; bounded original traversal, "
                         "version123/licensee28-or30/MeshAnimation1; compared with "
                         "tools/ui/check_anim_terminal_native.py",
            "slot_count": "engine.dll exports GetSpAtk01..28AnimName + "
                          "GetCastShort/Mid/Long/End + GetMagicShot/Throw/"
                          "NoTarget + GetShieldAtk",
            "selector": "Original SetSkillAnim code -> ordered slots: "
                        "tools/ui/check_skillanim_native.py; "
                        "docs/native-skill-animation-evidence.md",
            "limits": "Source sequence/notify inputs, not a runtime scheduler or pose parity proof. "
                      "See native-cast-scheduler-evidence.md and native-animation-terminal-evidence.md.",
        },
        "stanceIndex": STANCE_INDEX,
        "magicSlots": MAGIC_SLOTS,
        "physicalSlots": ["spAtk%02d" % i for i in range(1, 29)],
        "models": models,
        "clips": clips,
        'sequences': sequences,
    }


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="re-derive and diff against the written file")
    ap.add_argument("--selftest", action="store_true",
                    help="prove the gates fail on corrupted input")
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    stats = {}
    out = build(stats)
    print("pawns %d  stance-order assertions %d  magic stance-invariant %s  "
          "notify keyframes %d"
          % (len(out["models"]), stats["stance_order_checked"],
             stats["magic_stance_invariant"], stats["notify_rows"]))

    if args.check:
        if not os.path.exists(OUT):
            print("FAIL: %s does not exist" % OUT)
            return 1
        with open(OUT) as stream:
            have = json.load(stream)
        if canonical(have) != canonical(out):
            print("FAIL: %s differs from a fresh derivation" % OUT)
            return 1
        print("OK: %s matches a fresh derivation" % OUT)
        return 0

    with open(OUT, "w") as fh:
        json.dump(out, fh, sort_keys=True, separators=(",", ":"))
    print("wrote %s (%d bytes)" % (OUT, os.path.getsize(OUT)))
    return 0


def selftest():
    """Each gate must FAIL on input that breaks it — a gate that cannot go
    red is not a gate."""
    fails = 0

    # 1. stance order: swap Pole and Bow and the WaitAnimName gate must fire.
    tbl = read_warrior_int()
    global STANCE_INDEX
    good = STANCE_INDEX
    STANCE_INDEX = ["hand", "1hs", "2hs", "dual", "bow", "pole"]
    try:
        check_stance_order(tbl, {})
        print("SELFTEST FAIL: stance-order gate accepted a swapped order")
        fails += 1
    except L2Error as e:
        print("SELFTEST ok: stance order rejected (%s)" % str(e)[:70])
    finally:
        STANCE_INDEX = good

    # 2. the gate must count what it checked, not pass on an empty table.
    try:
        check_stance_order(collections.defaultdict(dict), {})
        print("SELFTEST FAIL: stance-order gate passed on an EMPTY table")
        fails += 1
    except L2Error:
        print("SELFTEST ok: empty table rejected (no vacuous pass)")

    # 3. clip_index must not invent a clip the package does not ship.
    idx = clip_index(["Wait_Hand_MFighter"], "MFighter")
    if "castshort_mfighter" in idx:
        print("SELFTEST FAIL: clip_index invented a cast clip")
        fails += 1
    else:
        print("SELFTEST ok: clip_index claims only shipped sequences")

    print("selftest: %d failure(s)" % fails)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
