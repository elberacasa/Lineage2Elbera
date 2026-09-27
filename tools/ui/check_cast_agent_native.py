#!/usr/bin/env python3
"""Elbera Tools: bind native casting Agent/FlyingTime to original source objects.

Read-only original-binary checks, fresh DAT decoding and qualified package
joins. Emits provenance/counts, never binary/source dumps or generated assets.
Imported object-find/load call targets are protector-erased; unresolved source
paths stay unresolved and must not be interpreted as native no-Agent proof.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
import struct
import sys
import tempfile

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA
from check_skillanim_native import CORE_SHA

sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(ROOT / 'tools/dat'))
from l2lib import Reader, load_package
from extract_gamedata import decrypt, parse_skillgrp

ENGINE_PACKAGE_SHA = '9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761'
SKILL_PACKAGE_SHA = '30b9a60d2a27c12d7fb9826a38772b3932c4ad66ab5f0638e8128813898463f5'
SKILL_DAT_SHA = '4e245e914048cee34ada7fb6ed6b499976cbe961ad5bd0a8bfdcf00a1e2288d9'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def checked_package(path, expected):
    assert digest(path.read_bytes()) == expected, 'unsupported original package: ' + str(path)
    return load_package(str(path))[0]


def qualified_export(package, export, package_name):
    """Preserve every serialized outer; never alias a leaf or skill ID."""
    parts, ref, visited = [package.export_name(export)], export.package_index, set()
    while ref:
        if ref in visited:
            raise ValueError('cyclic original object outer chain')
        visited.add(ref)
        outer = package.resolve_ref(ref)
        parts.append(package.export_name(outer) if ref > 0 else package.import_name(outer))
        ref = outer.package_index
    return '.'.join([package_name] + list(reversed(parts)))


def resolve_binding(source_path, objects):
    if not isinstance(source_path, str):
        raise ValueError('missing exact-level original binding field')
    if source_path.lower() in ('', 'none'):
        return {'status': 'source-none', 'path': source_path}
    record = objects.get(source_path.lower())
    if record is None:
        return {'status': 'unresolved-source-path', 'path': source_path}
    return {'status': 'resolved-source-object', 'path': source_path, 'object': record}


def property_record(package, export):
    raw = package.data[export.serial_offset:export.serial_offset + export.serial_size]
    reader = Reader(raw)
    assert package.name(reader.compact()) == 'None'  # UObject tagged-property terminator
    assert reader.compact() == 0                    # UField super-field
    next_ref, count, flags = reader.compact(), reader.u32(), reader.u32()
    category = package.name(reader.compact())
    assert not flags & 0x20                         # no replication tail in these fields
    kind = package.class_name_of(export)
    if kind == 'ArrayProperty':
        inner = reader.compact()
        assert inner > 0 and package.class_name_of(package.resolve_ref(inner)) == 'StructProperty'
    assert reader.pos == len(raw), 'unconsumed reflected property bytes'
    return {'name': package.export_name(export), 'kind': kind, 'arrayDim': count,
            'next': next_ref, 'category': category, 'export': export.index, 'SHA256': digest(raw)}


def verify_layout(engine, core):
    package = checked_package(ROOT / 'assets/interlude/system/Engine.u', ENGINE_PACKAGE_SHA)
    owner = next(e for e in package.exports_by_class('Class') if package.export_name(e) == 'SkillVisualEffect')
    fields = [e for e in package.exports if e.package_index == owner.index + 1
              and package.class_name_of(e).endswith('Property')]
    declared = {e.index + 1: property_record(package, e) for e in fields}
    first = next(ref for ref, row in declared.items() if row['name'] == 'Desc')
    # Starting member is independently observed in the native constructor;
    # sizes/alignment come from original Core property-link implementations.
    engine.instruction(engine.base + 0xea99d, 'lea', 'ecx, [esi + 0x34]')
    sizes = {'NameProperty': (0x71a1d, 4), 'ArrayProperty': (0x7221d, 12), 'FloatProperty': (0x7153d, 4)}
    for _, (rva, size) in sizes.items():
        operand = hex(size) if size > 9 else str(size)
        core.instruction(core.base + rva, 'mov', 'dword ptr [esi + 0x44], ' + operand)
    offsets, cursor, ref = [], 0x34, first
    while ref:
        assert ref in declared and all(row['export'] != declared[ref]['export'] for row in offsets)
        row = dict(declared[ref])
        cursor = (cursor + 3) & ~3
        row['offset'] = hex(cursor)
        assert row['arrayDim'] == 1
        cursor += sizes[row['kind']][1] * row['arrayDim']
        offsets.append(row)
        ref = row['next']
    assert len(offsets) == len(fields) == 7
    assert [r['name'] for r in offsets] == ['Desc', 'CastingActions', 'ChannelingActions',
        'PreshotActions', 'ShotActions', 'ExplosionActions', 'FlyingTime']
    assert offsets[-1]['offset'] == '0x74' and offsets[-1]['kind'] == 'FloatProperty'
    # Typed generated assignment independently copies these array starts and
    # exactly one final float at the derived offset.
    for rva, offset in [(0xa7806, 0x38), (0xa7815, 0x44), (0xa7821, 0x50), (0xa782d, 0x5c), (0xa7839, 0x68)]:
        engine.instruction(engine.base + rva, 'lea', 'ecx, [esi + ' + hex(offset) + ']')
    engine.instruction(engine.base + 0xa7841, 'fld', 'dword ptr [edi + 0x74]')
    engine.instruction(engine.base + 0xa7845, 'fstp', 'dword ptr [esi + 0x74]')
    # Class defaults: retain boundary ambiguity, but require every maximal
    # complete typed candidate to contain no override. No boundary is guessed.
    from export_npc_visuals import terminal_defaults
    props, defaults = terminal_defaults(package, owner,
        {row['name'].lower(): {'NameProperty': 'name', 'ArrayProperty': 'array', 'FloatProperty': 'float'}[row['kind']] for row in offsets})
    assert props == []
    return {'enginePackageSHA256': ENGINE_PACKAGE_SHA, 'properties': offsets,
            'derivedObjectSize': hex(cursor), 'classDefaultOverrides': props,
            'classDefaultsEvidence': defaults, 'flyingTimeDefault': 0.0}


def strict_agent_properties(package, export):
    """Bounded top-level tags; reject duplicate fields instead of overwriting."""
    raw = package.data[export.serial_offset:export.serial_offset + export.serial_size]
    reader, names, flying = Reader(raw), set(), None
    while True:
        name = package.name(reader.compact())
        if name == 'None':
            break
        if name in names:
            raise ValueError('duplicate source Agent property: ' + name)
        names.add(name)
        info = reader.u8()
        kind, size_tag, indexed = info & 15, (info >> 4) & 7, bool(info & 128)
        if kind == 10:
            reader.compact()
        size = (1, 2, 4, 12, 16)[size_tag] if size_tag < 5 else (
            reader.u8() if size_tag == 5 else reader.u16() if size_tag == 6 else reader.u32())
        if kind == 3:
            raise ValueError('unexpected bool in original Agent definition')
        if indexed:
            raise ValueError('unexpected fixed-array Agent property')
        value = reader.bytes(size)
        if name == 'FlyingTime':
            assert kind == 4 and size == 4
            flying = struct.unpack('<f', value)[0]
            assert math.isfinite(flying)
    assert reader.pos == len(raw), 'source Agent export trailing bytes'
    return {'export': export.index, 'SHA256': digest(raw), 'flyingTimeAuthored': flying is not None,
            'flyingTime': flying if flying is not None else 0.0}


def audit_source_bindings():
    path = ROOT / 'assets/interlude/system/skillgrp.dat'
    assert digest(path.read_bytes()) == SKILL_DAT_SHA
    package = checked_package(ROOT / 'assets/interlude/animations/Skill.usk', SKILL_PACKAGE_SHA)
    objects = {}
    for export in package.exports_by_class('SkillVisualEffect'):
        name = qualified_export(package, export, 'Skill')
        assert name.lower() not in objects, 'duplicate qualified source Agent'
        objects[name.lower()] = {'path': name, **strict_agent_properties(package, export)}
    with tempfile.TemporaryDirectory() as temp:
        rows = parse_skillgrp(decrypt('skillgrp.dat', temp))
    states, mismatches, variants, unresolved, used = Counter(), [], defaultdict(set), set(), set()
    examples = []
    for row in rows:
        path = row['description']  # established decoder mislabel; native field is skill_visual_effect
        result = resolve_binding(path, objects)
        states[result['status']] += 1
        variants[row['skill_id']].add(path)
        if result['status'] == 'unresolved-source-path':
            unresolved.add(path)
        if path and path.lower() != 'none':
            used.add(path.lower())
            if path.split('.')[-1] != str(row['skill_id']):
                mismatches.append(row['skill_id'])
        if row['skill_level'] == 1 and row['skill_id'] in (21, 1012, 1177, 1217, 1234):
            examples.append({'id': row['skill_id'], 'level': 1, **result})
    return {'skillDatSHA256': SKILL_DAT_SHA, 'skillPackageSHA256': SKILL_PACKAGE_SHA,
            'rows': len(rows), 'sourceObjects': len(objects), 'states': dict(states),
            'idLeafMismatchRows': len(mismatches), 'idLeafMismatchSkillIds': len(set(mismatches)),
            'levelVariantPaths': {str(k): sorted(v) for k, v in variants.items() if len(v) > 1},
            'unresolvedSourcePaths': sorted(unresolved), 'unusedSourceObjects': len(set(objects) - used),
            'authoredFlyingTimeObjects': sum(o['flyingTimeAuthored'] for o in objects.values()), 'examples': examples}


def verify():
    engine = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    core = Image(ROOT / 'assets/interlude/system/core.dll', CORE_SHA)
    assert engine.exported('?PrivateStaticClass@USkillVisualEffect@@0VUClass@@A') == 0x10bdeee0
    assert engine.exported('??4USkillVisualEffect@@QAEAAV0@ABV0@@Z', True) == engine.base + 0xa77f0
    assert engine.wide(0x1089a370) == 'skill_visual_effect'
    assert engine.wide(0x108a07b8) == 'none'
    assert engine.wide(0x1089a498) == 'Skillgrp.dat'
    engine_anchors = [
        # Exact DAT binary path uses the same record serializer as save.
        (0x16e212, 'push', '0x1089a498'), (0x16e314, 'push', '0'), (0x16e319, 'call', '0x1030366b'),
        (0x16f346, 'push', '0'), (0x16f34b, 'call', '0x1030366b'),
        (0x14e93d, 'lea', 'ecx, [esi + 0x40]'), (0x14e942, 'call', '0x10303ce2'),
        (0x14e947, 'lea', 'edx, [esi + 0x44]'), (0x14e94c, 'call', '0x10303ce2'),
        (0x14e951, 'lea', 'eax, [esi + 0x48]'), (0x14e956, 'call', '0x10303ce2'),
        # Native second string field's text-column identity.
        (0x16e5fd, 'push', '0x1089a370'), (0x16e611, 'call', '0x10309fa2'),
        (0x16e619, 'mov', 'dword ptr [esi + 0x44], edx'),
        # Binary FName string reader: zero length takes zero-name constructor.
        (0x14c142, 'push', '4'), (0x14c152, 'cmp', 'edi, ebx'), (0x14c154, 'jle', '0x1044c19f'),
        (0x14c174, 'push', 'edi'), (0x14c181, 'call', 'edx'), (0x14c19f, 'push', 'ebx'),
        # Clear and exact-level GetMSData precede source-path decisions.
        (0x1f284d, 'push', '1'), (0x1f2851, 'call', '0x103091a1'),
        (0x8e6a9, 'mov', 'dword ptr [esi], edi'),
        (0x1781f8, 'cmp', 'dword ptr [edi + 0x1c], esi'),
        (0x1781fb, 'je', '0x1047822a'), (0x178216, 'xor', 'eax, eax'),
        (0x178242, 'mov', 'eax, esi'),
        (0x1f2888, 'push', 'edx'), (0x1f2889, 'push', 'ecx'), (0x1f288f, 'call', '0x1030b816'),
        (0x1f28af, 'push', '0x108a07b8'), (0x1f28c9, 'add', 'ecx, 0x44'),
        (0x1f28d4, 'je', '0x104f2994'),
        # Imported find/load calls erased; class arguments and result gates remain.
        (0x1f2905, 'push', '0'), (0x1f2908, 'push', '-1'), (0x1f290a, 'push', '0x10bdeee0'),
        (0x1f291e, 'push', '0x10bdeee0'), (0x1f2933, 'mov', 'dword ptr [ebx], edi'),
        (0x1f2935, 'jne', '0x104f2993'), (0x1f296a, 'push', '0x10bdeee0'),
        (0x1f297e, 'push', '0x10bdeee0'), (0x1f298f, 'xor', 'edi, edi'),
        (0x1f2991, 'mov', 'dword ptr [ebx], edi'),
        # Scheduler's two separate Agent-present / Agent-absent branches.
        (0x1ef65d, 'mov', 'eax, dword ptr [esi + 0x4f0]'),
        (0x1ef665, 'je', '0x104ef6de'), (0x1ef667, 'fld', 'dword ptr [eax + 0x74]'),
        (0x1ef67d, 'jp', '0x104ef736'), (0x1ef685, 'cmp', 'dword ptr [esi + 0x52c], 3'),
    ]
    core_anchors = [
        # Link computes aligned field offsets from the owner's current size.
        (0x7154e, 'add', 'eax, 3'), (0x71551, 'and', 'eax, 0xfffffffc'),
        (0x71554, 'mov', 'dword ptr [esi + 0x54], eax'),
        (0x7222e, 'add', 'eax, 3'), (0x72231, 'and', 'eax, 0xfffffffc'),
        (0x72234, 'mov', 'dword ptr [esi + 0x54], eax'),
        (0x71a2e, 'add', 'eax, 3'), (0x71a31, 'and', 'eax, 0xfffffffc'),
        (0x71a34, 'mov', 'dword ptr [esi + 0x54], eax'),
        (0x35ef1, 'mov', 'eax, dword ptr [esi + 0x44]'),
        (0x35ef4, 'imul', 'eax, dword ptr [esi + 0x40]'),
        (0x35ef8, 'add', 'eax, dword ptr [esi + 0x54]'),
        (0x35efb, 'mov', 'dword ptr [ebx + 0x4c], eax'),
        (0x35f01, 'mov', 'edi, dword ptr [edi + 0x38]'),
        # Initial native property storage is zero; existing defaults are copied.
        (0x5fb45, 'mov', 'ecx, 0x34'), (0x5fb8a, 'call', '0x101022e3'),
        (0x842a, 'xor', 'eax, eax'), (0x8434, 'rep stosd', 'dword ptr es:[edi], eax'),
        (0x8438, 'rep stosb', 'byte ptr es:[edi], al'),
    ]
    for image, anchors in [(engine, engine_anchors), (core, core_anchors)]:
        for rva, mnemonic, operands in anchors:
            image.instruction(image.base + rva, mnemonic, operands)
    assert engine.data[0x366b] == 0xe9
    assert 0x366b + 5 + struct.unpack_from('<i', engine.data, 0x366c)[0] == 0x14e890
    assert engine.data[0x3ce2] == 0xe9
    assert 0x3ce2 + 5 + struct.unpack_from('<i', engine.data, 0x3ce3)[0] == 0x14c100
    return {'status': 'verified', 'engineSHA256': ENGINE_SHA, 'coreSHA256': CORE_SHA,
            'instructionAnchors': len(engine_anchors) + len(core_anchors),
            'layout': verify_layout(engine, core), 'sourceBindings': audit_source_bindings(),
            'limits': ['static source evidence; imported object-find/load and class tests are NOP-erased',
                       'unresolved source object path is not proof that native runtime has no Agent',
                       'this does not verify complete renderer/effect scheduling or other speed modifiers']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    result = verify()
    print(json.dumps(result if args.json else {'status': result['status'],
          'instructionAnchors': result['instructionAnchors'], 'FlyingTimeOffset': result['layout']['properties'][-1]['offset'],
          'sourceBindings': {k: result['sourceBindings'][k] for k in ['rows', 'sourceObjects', 'states', 'idLeafMismatchRows', 'idLeafMismatchSkillIds']}}, indent=2))
