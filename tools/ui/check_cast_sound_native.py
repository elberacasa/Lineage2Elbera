#!/usr/bin/env python3
"""Elbera Tools: original cast sound layers, lookup order and notify evidence.

Read-only; requires supplied pinned Interlude Engine.dll/Engine.u and sound DAT.
Decodes Engine only in memory. JSON contains evidence/hashes, not game assets.
Source-free tests exercise matrix/order rules; native audio playback, erased RNG
and foot-surface dispatch are not emulated.
"""
import argparse
import ast
from collections import Counter
import hashlib
import json
import math
import re
import struct
import sys
import tempfile

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA

sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(ROOT / 'tools/dat'))
from l2dat import Reader as DatReader
from l2lib import Reader, load_package
from extract_gamedata import decrypt

DAT_SHA = '14c9df542ccb0b342f1fd091b7177438cdf3705fb43581d0fc69b6c9ceeb14f5'
PACKAGE_SHA = '9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761'
TRAILER = b'\x0cSafePackage\0'
VOICE_MODELS = ['mfighter', 'ffighter', 'mdarkelf', 'fdarkelf', 'mdwarf', 'fdwarf',
                'melf', 'felf', 'mmagic', 'fmagic', 'morc', 'forc', 'mshaman', 'fshaman']


def digest(data):
    return hashlib.sha256(data).hexdigest()


def parse_source_rows(data):
    """Binary field order independently derived from RVA 0x14ec30.

    The three outer groups are layers. Within each group the three references
    and their interleaved gain pairs are cast/shot/explosion, respectively.
    Empty references, zero gains and duplicate records remain in source order.
    """
    if not data.endswith(TRAILER):
        raise ValueError('missing original sound DAT trailer')
    r = DatReader(data[:-len(TRAILER)], 'original skill sound data')
    count = r.u32()
    if count > len(data) // 8:
        raise ValueError('invalid source record count')
    rows = []
    for index in range(count):
        row = {'index': index, 'id': r.u32(), 'level': r.u32(), 'layers': []}
        for _ in range(3):
            refs = [r.ustr() for _ in range(3)]
            layer = [{'sound': sound, 'volume': r.f32(), 'radius': r.f32()} for sound in refs]
            if any(not math.isfinite(v) for p in layer for k, v in p.items() if k != 'sound'):
                raise ValueError('nonfinite source gain')
            row['layers'].append(layer)
        row['voices'] = [[r.ustr() for _ in range(15)] for _ in range(2)]
        row['voiceVolume'], row['voiceRadius'] = r.f32(), r.f32()
        if not all(math.isfinite(row[k]) for k in ('voiceVolume', 'voiceRadius')):
            raise ValueError('nonfinite source voice gain')
        rows.append(row)
    if not r.done():
        raise ValueError('unconsumed source sound data')
    return rows


def select_source_row(rows, skill_id, level):
    """Effective original DAT order: newest exact match, oldest level-1 fallback.

    Native multimap Add and Rehash build reverse insertion-order bucket chains.
    MultiFind preserves that traversal; GetSkillSoundData returns its first exact
    level, otherwise its last level-1 candidate. It never borrows another level.
    """
    fallback = None
    for row in reversed(rows):
        if row['id'] != skill_id:
            continue
        if row['level'] == level:
            return row
        if row['level'] == 1:
            fallback = row
    return fallback


def phase_layers(row, phase):
    if phase not in (1, 2, 3):
        raise ValueError('unsupported PlaySkillSound type')
    return [layer[phase - 1] for layer in row['layers']]


def random_gate(random_property, integer_result):
    """Only the original signed IDIV comparison, not an invented RNG."""
    if not -(2 ** 31) <= integer_result < 2 ** 31:
        raise ValueError('RNG operand must be signed DWORD')
    remainder = integer_result - math.trunc(integer_result / 100) * 100
    return remainder < random_property


def match_model_records(records, creation, creation_keys):
    """Join exact original asset arrays, never infer race from a filename."""
    races = {row['id']: row for row in creation['races']}
    result = {}
    for model, (race, gender, class_key) in creation_keys.items():
        assets = races[race]['creationAssets'][gender][class_key]
        matches = [i for i, row in enumerate(records)
                   if row['face_mesh'] == assets['faceMesh']
                   and row['body_mesh'] == assets['bodyMeshes']]
        if len(matches) != 1:
            raise ValueError('missing or ambiguous original model asset identity: ' + model)
        result[model] = matches[0]
    return result


def model_voice_source():
    from extract_charcreate import parse_chargrp
    builder = ROOT / 'tools/src/char_pipeline/build_characters.py'
    creation_path = ROOT / 'editor/characters/charcreate-data.json'
    tree = ast.parse(builder.read_text())
    constants = {node.targets[0].id: ast.literal_eval(node.value)
                 for node in tree.body if isinstance(node, ast.Assign)
                 and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)
                 and node.targets[0].id in ('COMBOS', 'CREATION_KEY')}
    with tempfile.TemporaryDirectory() as temp:
        raw = decrypt('chargrp.dat', temp)
        records = parse_chargrp(raw)
    slots = match_model_records(records, json.loads(creation_path.read_text()), constants['CREATION_KEY'])
    assert sorted(slots.values()) == list(range(14))
    # The builder's source pawn class, not its browser model-id spelling,
    # agrees with the independently named native voice-bank stores.
    for model, _, _, _, _, pawn_class, _ in constants['COMBOS']:
        assert pawn_class.casefold() == VOICE_MODELS[slots[model]]
    return {'modelMeshTypes': slots,
            'chargrpSHA256': digest((ROOT / 'assets/interlude/system/chargrp.dat').read_bytes()),
            'decryptedChargrpSHA256': digest(raw), 'creationMetadataSHA256': digest(creation_path.read_bytes()),
            'builderSHA256': digest(builder.read_bytes()),
            'method': 'exact original chargrp body/face arrays joined to the builder creation bindings; native named voice stores agree with source pawn classes',
            'limits': 'ordinary built player models only; no transformed/linked pawn or NPC index inference'}


def notify_source():
    from export_npc_visuals import OriginalClasses, terminal_defaults
    from extract_uscript import sources_from_package
    path = ROOT / 'assets/interlude/system/Engine.u'
    assert digest(path.read_bytes()) == PACKAGE_SHA
    package, _ = load_package(str(path))
    owner = next(e for e in package.exports_by_class('Class') if package.export_name(e) == 'AnimNotify_Sound')
    fields = []
    for e in package.exports:
        if e.package_index != owner.index + 1 or not package.class_name_of(e).endswith('Property'):
            continue
        raw = package.data[e.serial_offset:e.serial_offset + e.serial_size]
        r = Reader(raw)
        assert package.name(r.compact()) == 'None' and r.compact() == 0
        nxt, count, flags = r.compact(), r.u32(), r.u32()
        r.compact()  # category
        kind = package.class_name_of(e)
        assert not flags & 0x20
        if kind == 'ObjectProperty':
            assert package.ref_name(r.compact())[-1] == 'Sound'
        assert r.pos == len(raw)
        fields.append({'name': package.export_name(e), 'kind': kind, 'count': count,
                       'next': nxt, 'ref': e.index + 1, 'SHA256': digest(raw)})
    by_ref = {row['ref']: row for row in fields}
    current = next(row for row in fields if row['name'] == 'Sound')
    ordered = []
    while current:
        assert current not in ordered
        ordered.append(current)
        current = by_ref.get(current['next'])
    assert len(ordered) == len(fields) == 12
    assert [(r['name'], r['kind'], r['count']) for r in ordered[:4]] == [
        ('Sound', 'ObjectProperty', 1), ('Volume', 'FloatProperty', 1),
        ('Radius', 'IntProperty', 1), ('Random', 'IntProperty', 1)]
    assert all(r['kind'] == 'ObjectProperty' and r['count'] == 3 for r in ordered[4:])
    catalog = OriginalClasses()
    defaults, evidence = terminal_defaults(package, owner, catalog.property_types('Engine.AnimNotify_Sound', set()))
    assert evidence['defaultsBoundary'] == 'unique-validated-candidate'
    assert defaults == [('Volume', 'float', 1.0), ('Random', 'int', 100)]
    # Source text establishes field names independently of native access uses.
    scripts = {name: text for name, text in sources_from_package(package) if name == 'AnimNotify_Sound'}
    assert len(scripts) == 1
    return {'enginePackageSHA256': PACKAGE_SHA, 'orderedFields': ordered,
            'defaultOverrides': defaults, 'defaultsEvidence': evidence,
            'scriptTextSHA256': digest(scripts['AnimNotify_Sound'].encode('latin1')),
            'limits': ['no full foot-surface or imported RNG implementation',
                       'zero radius reads a protector-erased imported global; its identity is not established here']}


def verify():
    sys.path.insert(0, str(ROOT / 'tools/uscript'))
    image = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    anchors = []
    def pin(rva, op, args):
        image.instruction(image.base + rva, op, args)
        anchors.append(hex(rva))
    exports = {
        '?SkillSndDataLoad@FL2GameData@@IAEHH@Z': 0x173370,
        '?GetSkillSoundData@FL2GameData@@QAEPAUFL2SkillSoundData@@HH@Z': 0x178280,
        '?PlaySkillSound@APawn@@QAEXPAVAActor@@0H@Z': 0x1ee5a0,
        '?StopSpellSound@APawn@@QAEXXZ': 0x1eec60,
        '?Notify@UAnimNotify_Sound@@UAEXPAVUMeshInstance@@PAVAActor@@@Z': 0x3be900,
        '?GetMeshType@User@@QAEHXZ': 0x180bb0,
        '?SetTargetActor@ANProjectile@@QAEXPAVAActor@@@Z': 0x42df0,
        '?SkillEffectInit@APawn@@QAEXXZ': 0x1f2ed0,
        '?SkillEffectShot@APawn@@QAEPAVANSkillProjectile@@XZ': 0x1fe660,
    }
    for name, rva in exports.items():
        assert image.exported(name, True) == image.base + rva
    # Serialized record loop and its object serializer.
    for a, op, arg in [(0x1734bb, 'call', '0x1030f5dd'), (0x1734ce, 'call', '0x1030be33'),
                       (0x1734d3, 'add', 'dword ptr [ebp + 0x54], 1'),
                       (0x14ec72, 'cmp', 'esi, 3'), (0x14ece0, 'add', 'esi, 1'),
                       (0x14ecf4, 'cmp', 'esi, 0xf'), (0x14ecea, 'cmp', 'eax, 2')]: pin(a, op, arg)
    for a, reg, offset in [(0x14ec77, 'ecx', 8), (0x14ec82, 'edx', 0x14), (0x14ec8d, 'eax', 0x20),
                           (0x14ec98, 'ecx', 0x2c), (0x14eca3, 'edx', 0x38), (0x14ecae, 'eax', 0x44),
                           (0x14ecb9, 'ecx', 0x50), (0x14ecc4, 'edx', 0x5c), (0x14ecd2, 'eax', 0x68)]:
        pin(a, 'lea', '%s, [edi + esi*4 + %s]' % (reg, hex(offset) if offset > 9 else offset))
    # Independently named text columns bind those three memory arrays.
    for a, text, store, reg, offset in [(0x1736df, 'spelleffect_sound_%d', 0x173715, 'edx', 8),
                                       (0x173789, 'shoteffect_sound_%d', 0x1737bf, 'eax', 0x14),
                                       (0x173833, 'expeffect_sound_%d', 0x173869, 'ecx', 0x20)]:
        instruction = next(image.dis.disasm(image.data[a:a+5], image.base+a))
        assert instruction.mnemonic == 'push' and image.wide(int(instruction.op_str, 16)) == text
        pin(store, 'mov', 'dword ptr [edi + ebx*4 + %s], %s' % (hex(offset) if offset > 9 else offset, reg))
    # Append/prepend, rehash in ascending entry order, newest-first collection.
    for a, op, arg in [(0x15a541, 'mov', 'dword ptr [edi], ecx'),
        (0x15a549, 'sub', 'edx, 1'), (0x15a54c, 'mov', 'dword ptr [ecx + eax*4], edx'),
        (0x15a43f, 'xor', 'edx, edx'), (0x15a463, 'mov', 'dword ptr [eax], ebp'),
        (0x15a465, 'mov', 'dword ptr [edi + ecx*4], edx'), (0x15a468, 'add', 'edx, 1'),
        (0x15a46b, 'add', 'ebx, 0xc'), (0x158bb4, 'mov', 'eax, dword ptr [ecx + eax*4]'),
        (0x158bef, 'mov', 'dword ptr [eax], ecx'), (0x158bf3, 'mov', 'eax, dword ptr [esi + edx]'),
        (0x1782e6, 'cmp', 'ecx, edi'), (0x1782e8, 'je', '0x10478320'),
        (0x1782ea, 'cmp', 'ecx, 1'), (0x1782ef, 'mov', 'ebp, edx'),
        (0x1782f1, 'add', 'eax, 1'), (0x17830b, 'mov', 'eax, ebp'),
        (0x178320, 'mov', 'esi, edx'), (0x178338, 'mov', 'eax, esi')]: pin(a, op, arg)
    # All layers of each selected phase, followed by the appropriate voice.
    for a, offset in [(0x1ee89f, 8), (0x1ee781, 0x14), (0x1ee663, 0x20)]:
        pin(a, 'mov', ('ecx' if offset == 8 else 'eax') + ', dword ptr [edi + esi*4 + '
            + (hex(offset) if offset > 9 else str(offset)) + ']')
    for a in (0x1ee65a, 0x1ee778, 0x1ee896): pin(a, 'cmp', 'esi, 3')
    for a in (0x1ee726, 0x1ee844, 0x1ee962, 0x1eea7c): pin(a, 'fdiv', 'qword ptr [0x10853b38]')
    assert struct.unpack_from('<d', image.data, image.offset(0x10853b38))[0] == 255
    for a, op, arg in [(0x1ee9c3, 'mov', 'eax, dword ptr [ebx + 0x698]'),
        (0x1ee9bb, 'mov', 'eax, dword ptr [eax + 0x698]'), (0x1ee9ce, 'shl', 'edx, 4'),
        (0x1ee9d1, 'sub', 'edx, ecx'), (0x1ee9d3, 'add', 'edx, eax'),
        (0x1ee9d5, 'mov', 'eax, dword ptr [edi + edx*4 + 0x38]'),
        (0x18fe91, 'call', '0x103052fe'), (0x18fe9c, 'mov', 'dword ptr [ecx + 0x698], eax')]: pin(a, op, arg)
    assert image.exported('?GetMeshType@User@@QAEHXZ') == 0x103052fe
    # Native user race/class/gender switch and every ordinary return value.
    for a, op, arg in [(0x180bd8, 'mov', 'eax, dword ptr [ecx + 0x4c]'),
        (0x180bdb, 'cmp', 'eax, 4'), (0x180be4, 'jmp', 'dword ptr [eax*4 + 0x10480db0]'),
        (0x180beb, 'mov', 'eax, dword ptr [ecx + 0x54]'), (0x180bee, 'cmp', 'eax, 0x62'),
        (0x180bf7, 'movzx', 'eax, byte ptr [eax + 0x10480dd0]'),
        (0x180bfe, 'jmp', 'dword ptr [eax*4 + 0x10480dc4]'),
        (0x180cca, 'mov', 'eax, dword ptr [ecx + 0x54]'), (0x180ccd, 'add', 'eax, -0x2c'),
        (0x180cd0, 'cmp', 'eax, 0x48'), (0x180cd9, 'movzx', 'edx, byte ptr [eax + 0x10480e40]'),
        (0x180ce0, 'jmp', 'dword ptr [edx*4 + 0x10480e34]')]: pin(a, op, arg)
    for a in (0x180c05,0x180c34,0x180c66,0x180c98,0x180ce7,0x180d19,0x180d4b):
        pin(a, 'cmp', 'dword ptr [ecx + 0x50], 0')
    pin(0x180c0b, 'xor', 'eax, eax')
    for a,value in [(0x180c1e,1),(0x180c9e,2),(0x180cb4,3),(0x180d51,4),(0x180d67,5),
                    (0x180c6c,6),(0x180c82,7),(0x180c3a,8),(0x180c50,9),(0x180ced,10),
                    (0x180d03,11),(0x180d1f,12),(0x180d35,13)]:
        pin(a, 'mov', 'eax, ' + (hex(value) if value > 9 else str(value)))
    assert [image.u32(0x10480db0+i*4) for i in range(5)] == [
        image.base+i for i in (0x180beb,0x180c66,0x180c98,0x180cca,0x180d4b)]
    for address, expected in [(0x10480dc4,(0x180c05,0x180c34,0x180d67)),
                              (0x10480e34,(0x180ce7,0x180d19,0x180d67))]:
        assert [image.u32(address+i*4) for i in range(3)] == [image.base+i for i in expected]
    # Read every named voice store, rather than borrow a third-party race order.
    voice_fields = {}
    pending = None
    for ins in image.dis.disasm(image.data[0x1738e1:0x173d80], image.base+0x1738e1):
        if ins.mnemonic == 'push' and ins.op_str.startswith('0x1089'):
            name = image.wide(int(ins.op_str, 16))
            if name.endswith(('_cast', '_magic')): pending = name
        match = re.fullmatch(r'dword ptr \[edi \+ (0x[0-9a-f]+)\], (?:eax|ecx|edx)', ins.op_str)
        if pending and ins.mnemonic == 'mov' and match:
            voice_fields[pending] = int(match[1],16); pending = None
    for index, model in enumerate(VOICE_MODELS):
        assert voice_fields[model+'_cast'] == 0x74+index*4
        assert voice_fields[model+'_magic'] == 0xb0+index*4
    # Native event paths and cast-layer cleanup; not packet-derived timers.
    for a, op, arg in [(0x1ed10b, 'push', '1'), (0x1ed111, 'call', '0x10307360'),
        (0x1ed5e4, 'push', '2'), (0x1ed5ea, 'call', '0x10307360'),
        (0x42df4, 'mov', 'dword ptr [ecx + 0x4e4], eax'),
        (0x1ed4e2, 'mov', 'eax, dword ptr [esi + 0x520]'),
        (0x1ed4e8, 'mov', 'dword ptr [edi + 0x4e4], eax'),
        (0x1ec5e8, 'mov', 'ecx, dword ptr [edi + 0x4e4]'),
        (0x1ec5e4, 'push', '3'), (0x1ec5ee, 'call', '0x10307360'),
        (0x1f2efe, 'mov', 'ebx, ecx'), (0x1fa6a3, 'test', 'esi, esi'),
        (0x1fa6a5, 'je', '0x104fa6b2'), (0x1fa6a7, 'push', '1'),
        (0x1fa6a9, 'push', 'esi'), (0x1fa6aa, 'push', 'ebx'),
        (0x1fa6ab, 'mov', 'ecx, ebx'), (0x1fa6ad, 'call', '0x10307360'),
        (0x1fe68e, 'mov', 'ebx, ecx'), (0x20cea5, 'mov', 'eax, dword ptr [ebp + 0x68]'),
        (0x20cea8, 'test', 'eax, eax'), (0x20ceaa, 'je', '0x1050ceb7'),
        (0x20ceac, 'push', '2'), (0x20ceae, 'push', 'eax'), (0x20ceaf, 'push', 'ebx'),
        (0x20ceb0, 'mov', 'ecx, ebx'), (0x20ceb2, 'call', '0x10307360'),
        (0x1eece0, 'cmp', 'esi, 3'), (0x1eece9, 'mov', 'eax, dword ptr [eax + esi*4 + 8]'),
        (0x1eed72, 'mov', 'edx, dword ptr [edx + 0x88]')]: pin(a, op, arg)
    # Direct named-sound notify branch. Null Sound follows separate surface logic.
    for a, op, arg in [(0x3be96b, 'mov', 'ecx, 0x64'), (0x3be970, 'idiv', 'ecx'),
        (0x3be972, 'cmp', 'edx, dword ptr [edi + 0x44]'), (0x3be975, 'jge', '0x106bede2'),
        (0x3be97b, 'mov', 'esi, dword ptr [edi + 0x38]'), (0x3be980, 'je', '0x106beae2'),
        (0x3be9ad, 'mov', 'edx, dword ptr [edi + 0x40]'),
        (0x3bea54, 'je', '0x106bea5b'), (0x3bea5b, 'mov', 'edx, dword ptr [0x11d8dc10]'),
        (0x3bea8c, 'fld', 'dword ptr [edi + 0x3c]'), (0x3bea8f, 'fdiv', 'qword ptr [0x10853b38]'),
        (0x3beabf, 'mov', 'edx, dword ptr [ebx + 0x80]')]: pin(a, op, arg)
    path = ROOT / 'assets/interlude/system/skillsoundgrp.dat'
    assert digest(path.read_bytes()) == DAT_SHA
    with tempfile.TemporaryDirectory() as temp:
        decoded = decrypt('skillsoundgrp.dat', temp)
        rows = parse_source_rows(decoded)
    assert len(rows) == 1398
    duplicate_keys = Counter((r['id'],r['level']) for r in rows)
    examples = []
    for skill_id, level in [(3, 1), (1177, 1), (1177, 999), (1216, 1)]:
        row = select_source_row(rows, skill_id, level)
        examples.append({'id': skill_id, 'requestedLevel': level, 'selectedIndex': row and row['index'],
                         'selectedLevel': row and row['level'], 'phaseLayerCounts': row and [
                             sum(bool(v['sound']) for v in phase_layers(row,p)) for p in (1,2,3)]})
    ranges = [('sound DAT serializer',0x14ec30,0x14ed57),('sound lookup',0x178280,0x17834a),
              ('sound multimap insert',0x15a500,0x15a56f),('sound multimap rehash',0x15a3f0,0x15a492),
              ('sound multimap find',0x158ba0,0x158c02),('play skill sound',0x1ee5a0,0x1eeacf),
              ('ordinary mesh-type selection',0x180bb0,0x180e89),
              ('legacy init sound tail',0x1fa69e,0x1fa6ce),('legacy shot sound tail',0x20cea5,0x20cecf),
              ('stop spell sound',0x1eec60,0x1eeda0),('direct sound notify',0x3be900,0x3beae2)]
    return {'tool': 'Elbera Tools', 'engineSHA256': ENGINE_SHA, 'anchors': len(anchors),
            'ranges': [{'name': n, 'startRVA': hex(a), 'endRVAExclusive': hex(b),
                        'SHA256': digest(image.data[a:b])} for n,a,b in ranges],
            'soundDatSHA256': DAT_SHA, 'decryptedSHA256': digest(decoded), 'records': len(rows),
            'duplicateKeys': sum(v>1 for v in duplicate_keys.values()), 'examples': examples,
            'voiceSlots': dict(enumerate(VOICE_MODELS)), 'reservedVoiceSlot': 14,
            'browserModels': model_voice_source(),
            'notify': notify_source(), 'limits': ['static instruction evidence, not original audio execution',
                'erased sound loading helpers, RNG and sound-null foot/surface path remain unresolved',
                'voice transform/linked-pawn cases and non-player flow need separate runtime coverage']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    result = verify()
    print(json.dumps(result, indent=2) if args.json else
          'Verified %d original anchors, %d sound rows and source Sound notify defaults.' %
          (result['anchors'], result['records']))
