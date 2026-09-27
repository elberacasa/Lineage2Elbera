#!/usr/bin/env python3
"""Elbera Tools: verify original Pawn animation-event consumption.

Recovers the pinned owner's Engine only in memory. Runs small, call-bounded
integer instruction slices against synthetic state, never native code. Opaque
calls are explicit boundaries, not simulated asset rendering or FName proof.
"""
import argparse
from collections import defaultdict
import hashlib
import json
import re
import struct
import sys

MASK, SIGN = 0xffffffff, 0x80000000
CORE_SHA = '9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf'


def identity_domain(rows):
    """Measure identity equivalence, never infer an erased imported target.

    Rows are original AttackShot objects in one selected model's source set.
    Full/path/leaf string candidates must distinguish the same objects within
    that set. Reused object exports remain the same identity across sequences;
    object references and leaf names must never be treated as global keys.
    ASCII is an explicit domain bound, avoiding an invented Unicode name fold.
    """
    names, objects, refs, leaves, uses = defaultdict(dict), {}, {}, defaultdict(set), defaultdict(int)
    for row in rows:
        model, path, leaf, cls, ref = (row[k] for k in ('model', 'objectPath', 'objectName', 'classPath', 'objectRef'))
        if (not model or type(ref) is not int or ref <= 0 or cls != 'Engine.AnimNotify_AttackShot'
            or not isinstance(path, str) or not isinstance(leaf, str)
            or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+', path)
            or path.rsplit('.', 1)[-1] != leaf):
            raise ValueError('outside measured original AttackShot identity domain')
        key = (cls.lower(), path.lower())
        local = (model, ref)
        if local in refs and refs[local] != key:
            raise ValueError('one source reference identifies different objects')
        refs[local] = key
        for mode, value in [('leaf', leaf), ('path', path), ('full', cls.rsplit('.', 1)[-1] + ' ' + path)]:
            old = names[(model, mode)].setdefault(value.lower(), key)
            if old != key:
                raise ValueError('candidate identity collision inside one model source set')
        objects[key] = True
        leaves[leaf.lower()].add(key)
        uses[key] += 1
    return {'entries': len(rows), 'models': len({r['model'] for r in rows}),
            'distinctObjects': len(objects), 'reusedObjects': sum(n > 1 for n in uses.values()),
            'crossModelAmbiguousLeafGroups': sum(len(v) > 1 for v in leaves.values()),
            'maxObjectsSharingLeaf': max(map(len, leaves.values()), default=0),
            'withinModelCandidateCollisions': 0,
            'candidateEquivalence': ['leaf', 'path', 'class-leaf plus space plus path'],
            'importTargetVerified': False}


def source_identity_domain():
    """Fresh original package extraction; generated pawnanim is not the oracle."""
    from check_tutorial_quest_native import ROOT
    sys.path.insert(0, str(ROOT / 'tools/anim'))
    from build_pawnanim import build
    table = build({})
    rows = []
    for model, sequences in sorted(table['sequences'].items()):
        for sequence, info in sorted(sequences.items()):
            for note in info['notifies']:
                if note['isAttackShot']:
                    rows.append(dict(note, model=model, sequence=sequence))
    result = identity_domain(rows)
    assert (result['models'], result['entries'], result['distinctObjects']) == (14, 497, 496)
    sources = {model: data['source'] for model, data in table['models'].items()}
    catalog = [(r['model'], r['sequence'], r['index'], r['objectRef'], r['classPath'], r['objectPath']) for r in rows]
    result.update(sourcePackages=sources, catalogSHA256=hashlib.sha256(
        json.dumps(catalog, ensure_ascii=True, separators=(',', ':')).encode()).hexdigest())
    return result


def direct_call_rvas(image, symbol):
    targets = {image.exported(symbol, body) for body in (False, True)}
    positions, position = [], -1
    while True:
        position = image.data.find(b'\xe8', position + 1)
        if position < 0 or position + 5 > len(image.data):
            return positions
        destination = image.base + position + 5 + struct.unpack_from('<i', image.data, position + 1)[0]
        if destination in targets:
            positions.append(position)


def identity_abi_evidence(image):
    from check_tutorial_quest_native import Image, ROOT
    core = Image(ROOT / 'assets/interlude/system/core.dll', CORE_SHA)
    candidates = sorted(name for name in core.exports if '@UObject@@QBEPBG' in name)
    assert candidates == sorted([
        '?GetName@UObject@@QBEPBGXZ', '?GetFullName@UObject@@QBEPBGPAG@Z',
        '?GetPathName@UObject@@QBEPBGPAV1@PAG@Z'])
    methods = {
        '?GetName@UObject@@QBEPBGXZ': (0x158a0, 0x158b0),
        '?GetFName@UObject@@QBE?BVFName@@XZ': (0xa230, 0xa23c),
        '?GetFullName@UObject@@QBEPBGPAG@Z': (0x5e300, 0x5e395),
        '?GetPathName@UObject@@QBEPBGPAV1@PAG@Z': (0x5e200, 0x5e29b),
        '??DFName@@QBEPBGXZ': (0x15760, 0x1576f),
        '??0FName@@QAE@PBGW4EFindName@@@Z': (0x570e0, 0x57253),
        '??0FName@@QAE@W4EName@@@Z': (0x9d80, 0x9d8b),
        '??8FName@@QBEHABV0@@Z': (0x9d40, 0x9d52),
        '??9FName@@QBEHABV0@@Z': (0x9d60, 0x9d72),
    }
    ranges = []
    for name, (a, b) in methods.items():
        assert core.exported(name, True) == core.base + a
        ranges.append({'method': name, 'startRVA': hex(a), 'endRVA': hex(b),
                       'SHA256': hashlib.sha256(core.data[a:b]).hexdigest()})
    anchors = [
        (0xa233, 'mov', 'eax, dword ptr [esp + 4]'), (0xa237, 'mov', 'dword ptr [eax], ecx'),
        (0xa239, 'ret', '4'), (0x158af, 'ret', ''),
        (0x5e32a, 'mov', 'esi, dword ptr [ebp + 8]'),
        (0x5e331, 'call', hex(core.exported('?appStaticString1024@@YAPAGXZ'))),
        (0x5e33c, 'mov', 'eax, dword ptr [edi + 0x24]'),
        (0x5e33f, 'mov', 'eax, dword ptr [eax + 0x20]'),
        (0x5e34f, 'push', '0x101d93e8'), (0x5e355, 'call', '0x10102e23'),
        (0x5e367, 'push', '0'), (0x5e36b, 'call', hex(core.exported('?GetPathName@UObject@@QBEPBGPAV1@PAG@Z'))),
        (0x5e392, 'ret', '4'), (0x5e244, 'mov', 'ecx, dword ptr [edi + 0x18]'),
        (0x5e24d, 'call', '0x10103f5d'), (0x5e252, 'push', '0x101d93d0'),
        (0x5e260, 'mov', 'eax, dword ptr [edi + 0x20]'), (0x5e298, 'ret', '8'),
        (0x5718c, 'call', hex(core.exported('?appStricmp@@YAHPBG0@Z'))),
        (0x571a6, 'mov', 'esi, dword ptr [ebp + 0xc]'), (0x571ab, 'jne', '0x101571b1'),
        (0x57250, 'ret', '8'), (0x9d4a, 'sete', 'cl'), (0x9d6a, 'setne', 'cl'),
        (0x9d4f, 'ret', '4'), (0x9d6f, 'ret', '4'), (0x9d86, 'mov', 'dword ptr [eax], ecx'),
    ]
    for rva, op, operands in anchors:
        core.instruction(core.base + rva, op, operands)
    assert core.wide(0x101d93e8) == '%s '
    assert core.wide(0x101d93d0) == '.'
    assert core.wide(0x101d93d4) == core.wide(0x101d93f0) == 'None'
    erased = [0x3ba669, 0x3ba673, 0x3bd16d, 0x3bd178, 0x3bd17f, 0x211e6f, 0x211e7f]
    for rva in erased:
        assert image.data[rva:rva + 6] == b'\x90' * 6
    pe = struct.unpack_from('<I', image.data, 60)[0]
    descriptor = struct.unpack_from('<I', image.data, pe + 24 + 104)[0]
    imports = []
    while True:
        fields = struct.unpack_from('<5I', image.data, image.offset(image.base + descriptor))
        if not any(fields):
            break
        start = image.offset(image.base + fields[3])
        imports.append(bytes(image.data[start:image.data.index(0, start)]).decode('ascii'))
        descriptor += 20
    assert imports == ['KERNEL32.dll', 'COMCTL32.dll']
    # No ordinary PE import descriptor or literal source symbol can bind the
    # erased call. This does not assert that all protector metadata is decoded.
    assert not any(value in image.data for value in (b'GetFullName', b'GetPathName', b'Core.dll', b'core.dll'))
    return {'coreSHA256': CORE_SHA, 'methodRanges': ranges, 'instructionAnchors': len(anchors),
            'uobjectWideStringCandidates': candidates, 'ret4StringCandidate': '?GetFullName@UObject@@QBEPBGPAG@Z',
            'erasedCallRVAs': list(map(hex, erased)), 'remainingPEImportDLLs': imports,
            'objectNameTargetVerified': False, 'completionComparisonPolarityVerified': False,
            'limits': ['Compatible named ABI is evidence, not a recovered import binding.',
                       'Completion comparison can call either FName equality or inequality with the same surviving ABI.']}


def tick_order_evidence(image):
    methods = {
        '?Tick@APawn@@UAEHMW4ELevelTick@@@Z': (0x2d3f60, 0x2d3f78),
        '?Tick@AActor@@UAEHMW4ELevelTick@@@Z': (0x2d3560, 0x2d37ef),
        '?UpdateAnimation@APawn@@UAEXM@Z': (0x32fb20, 0x32fb62),
        '?UpdateAnimation@AActor@@UAEXM@Z': (0x2258b0, 0x2258e3),
        '?TickSpecial@APawn@@UAEXM@Z': (0x2d2fb0, 0x2d3010),
        '?NActionProcess@APawn@@QAEXM@Z': (0x331e30, 0x332016),
    }
    ranges = []
    for name, (a, b) in methods.items():
        assert image.exported(name, True) == image.base + a
        ranges.append({'method': name, 'startRVA': hex(a), 'endRVA': hex(b),
                       'SHA256': hashlib.sha256(image.data[a:b]).hexdigest()})
    for vtable, offset, name in [
        ('??_7APawn@@6B@', 0x174, '?UpdateAnimation@APawn@@UAEXM@Z'),
        ('??_7APawn@@6B@', 0x18c, '?TickSpecial@APawn@@UAEXM@Z'),
        ('??_7USkeletalMesh@@6B@', 0x98, '?MeshGetInstance@UMesh@@UAEPAVUMeshInstance@@PBVAActor@@@Z'),
        ('??_7USkeletalMeshInstance@@6B@', 0xa8, '?UpdateAnimation@USkeletalMeshInstance@@UAEHM@Z'),
    ]:
        assert image.u32(image.exported(vtable) + offset) == image.exported(name)
    anchors = [
        (0x2d3f73, 'call', '0x103073b5'), (0x2d3653, 'mov', 'eax, dword ptr [edx + 0x174]'),
        (0x2d3659, 'call', 'eax'), (0x2d365b, 'cmp', 'dword ptr [ebp + 0xc], 1'),
        (0x2d37d2, 'test', 'byte ptr [esi + 0x64], 0x80'), (0x2d37d6, 'jne', '0x105d35e5'),
        (0x2d37e7, 'mov', 'eax, dword ptr [edx + 0x18c]'), (0x2d37ed, 'call', 'eax'),
        (0x32fb5d, 'call', '0x1030fd4e'), (0x2258b0, 'cmp', 'dword ptr [ecx + 0x104], 0'),
        (0x2258c4, 'mov', 'eax, dword ptr [edx + 0x98]'), (0x2258ca, 'call', 'eax'),
        (0x2258d8, 'mov', 'eax, dword ptr [edx + 0xa8]'), (0x2258de, 'call', 'eax'),
        (0x2d300b, 'call', '0x1030820b'), (0x331e59, 'mov', 'eax, dword ptr [esi + 0x62c]'),
        (0x331f97, 'cmp', 'eax, 5'), (0x331f9a, 'jne', '0x10631fac'),
        (0x331fa5, 'call', '0x103024d7'),
        # Clear(1) resets both stage counters; it is not a guessed UI default.
        (0x8e6a0, 'mov', 'dword ptr [esi + 0x18], edi'),
        (0x8e6a3, 'mov', 'dword ptr [esi + 0x1c], edi'),
        (0x211e24, 'fcom', 'dword ptr [esi + 0x51c]'), (0x211e2f, 'jnp', '0x10511e51'),
        (0x211e51, 'add', 'dword ptr [esi + 0x500], edi'),
        (0x211f21, 'push', 'edi'), (0x211f28, 'call', '0x103091a1'),
        (0x211f4a, 'jmp', '0x10511fac'),
        (0x211fac, 'fld', 'dword ptr [ebp + 8]'),
        (0x211faf, 'fadd', 'dword ptr [esi + 0x51c]'),
        (0x211fb5, 'fstp', 'dword ptr [esi + 0x51c]'),
    ]
    for rva, op, operands in anchors:
        image.instruction(image.base + rva, op, operands)
    action_calls = direct_call_rvas(image, '?NActionProcess@APawn@@QAEXM@Z')
    process_calls = direct_call_rvas(image, '?MagicProcess@APawn@@QAEXM@Z')
    assert action_calls == [0x2d300b] and process_calls == [0x331fa5]
    from check_cast_scheduler_native import Arithmetic, f32
    pawn, frame = 0x2000, 0x3000
    zero = Arithmetic(image, {pawn + 0x51c: 0.}, [], {'esi': pawn})
    zero.run(0x211e1d, 0x211e51)
    assert zero.trace[-1] == 0x211e2f  # ActiveTime==0 selects increment even after a prior zero-delta activation.
    suffixes = []
    for elapsed, delta in [(0., 0.), (0., .125), (.25, .125)]:
        machine = Arithmetic(image, {pawn + 0x51c: elapsed, frame + 8: delta}, [], {'esi': pawn, 'ebp': frame})
        machine.run(0x211fac, 0x211fbb)
        assert machine.memory[pawn + 0x51c] == f32(elapsed + delta)
        suffixes.append({'elapsedBeforeSuffix': elapsed, 'delta': delta, 'elapsedAfterSuffix': machine.memory[pawn + 0x51c]})
    return {'methodRanges': ranges, 'instructionAnchors': len(anchors),
            'directActionProcessCallRVAs': list(map(hex, action_calls)),
            'directMagicProcessCallRVAs': list(map(hex, process_calls)),
            'zeroElapsedSelectsPhaseIncrement': True, 'actualFloatSuffixCases': suffixes,
            'order': ['existing skeletal channel UpdateAnimation and notifies',
                      'TickSpecial / NActionProcess / MagicProcess pending consumption',
                      'MagicProcess phase choice and ActiveTime addition'],
            'limits': ['Order applies when the actor tick reaches both calls and action5 remains active.',
                       'Actor early exits, callback mutation/destruction and non-skeletal actors are not emulated.',
                       'A phase started by MagicProcess does not receive this same tick delta again.']}


def action_struct_zero_evidence():
    """Bind omitted SkillActionInfo fields to the original loading zero-fill."""
    from check_tutorial_quest_native import Image, ROOT
    core = Image(ROOT / 'assets/interlude/system/core.dll', CORE_SHA)
    methods = {
        '?SerializeItem@UArrayProperty@@UBEXAAVFArchive@@PAXH@Z': (0x6f8b0, 0x6f93e),
        '?AddZeroed@FArray@@QAEHHH@Z': (0x9110, 0x917c),
        '?SerializeItem@UStructProperty@@UBEXAAVFArchive@@PAXH@Z': (0x727d0, 0x72843),
        '?SerializeTaggedProperties@UStruct@@UAEXAAVFArchive@@PAEPAVUClass@@@Z': (0x346e0, 0x34793),
    }
    ranges = []
    for name, (a, b) in methods.items():
        assert core.exported(name, True) == core.base + a
        ranges.append({'method': name, 'startRVA': hex(a), 'endRVA': hex(b),
                       'SHA256': hashlib.sha256(core.data[a:b]).hexdigest()})
    for vtable, slot, name in [
        ('??_7UStructProperty@@6B@', 0x90, '?SerializeItem@UStructProperty@@UBEXAAVFArchive@@PAXH@Z'),
        ('??_7UStruct@@6B@', 0x88, '?SerializeTaggedProperties@UStruct@@UAEXAAVFArchive@@PAEPAVUClass@@@Z'),
    ]:
        assert core.u32(core.exported(vtable) + slot) == core.exported(name)
    anchors = [
        (0x6f8db, 'cmp', 'dword ptr [edi + 0x10], eax'), (0x6f8de, 'je', '0x1016f8fb'),
        (0x6f8e3, 'mov', 'dword ptr [esi + 4], eax'), (0x6f8e6, 'mov', 'dword ptr [esi + 8], eax'),
        (0x6f8f6, 'call', '0x1010433b'), (0x6f91b, 'mov', 'edx, dword ptr [edx + 0x90]'),
        (0x6f928, 'call', 'edx'), (0x9163, 'xor', 'eax, eax'),
        (0x916d, 'rep stosd', 'dword ptr es:[edi], eax'), (0x9171, 'rep stosb', 'byte ptr es:[edi], al'),
        (0x727e4, 'cmp', 'dword ptr [esi + 4], 0x76'), (0x727e8, 'jl', '0x10172819'),
        (0x72808, 'mov', 'edx, dword ptr [edx + 0x88]'), (0x7280e, 'push', '0'),
        (0x72812, 'call', 'edx'), (0x34740, 'mov', 'eax, dword ptr [ebp + 0x10]'),
        (0x34745, 'je', '0x10134759'), (0x34778, 'call', '0x1010380a'),
        (0x34783, 'test', 'ecx, ecx'), (0x34785, 'jne', '0x10134793'),
        (0x3478e, 'jmp', '0x10134cbd'),
    ]
    for rva, op, operands in anchors:
        core.instruction(core.base + rva, op, operands)
    sys.path.insert(0, str(ROOT / 'tools/dat'))
    from parse_skillfx import SKILL_USK, PHASES, load_package, parse_skill_usk
    from l2lib import Reader, read_properties
    package, _ = load_package(SKILL_USK)
    assert package.file_version >= 118
    agents, _ = parse_skill_usk(package)
    entries = [action for agent in agents.values() for actions in agent['phases'].values() for action in actions]
    assert len(entries) == 524
    assert all(action['stage'] == 0 and action['stageSerialized'] for action in entries)
    # An independent generic property reader checks the actual four-byte tag
    # payloads. Do not confuse an explicit source zero with an absent default.
    explicit_zero = 0
    for export in package.exports_by_class('SkillVisualEffect'):
        end = export.serial_offset + export.serial_size
        reader = Reader(package.data[:end], export.serial_offset)
        properties = read_properties(package, reader, fmt='packed')
        assert reader.pos == end
        for name, _ in PHASES:
            if name not in properties:
                continue
            values = Reader(properties[name])
            for _ in range(values.compact()):
                item = read_properties(package, values, fmt='packed')
                assert item['SpecificStage'] == b'\x00' * 4
                explicit_zero += 1
            assert values.pos == len(properties[name])
    assert explicit_zero == len(entries)
    with open(SKILL_USK, 'rb') as stream:
        package_sha = hashlib.sha256(stream.read()).hexdigest()
    return {'coreSHA256': CORE_SHA, 'methodRanges': ranges, 'instructionAnchors': len(anchors),
            'sourcePackageSHA256': package_sha,
            'sourceFileVersion': package.file_version, 'arrayEntries': len(entries),
            'serializedZeroSpecificStageEntries': explicit_zero, 'omittedSpecificStageEntries': 0, 'loadedSpecificStage': 0,
            'limits': ['Loading of these original tagged struct arrays; not arbitrary class-default substitution.']}


def protector_target_boundary(image):
    """Record the bounded failed binding attempt, not a general unpacker claim."""
    image.instruction(image.base + 0x1a9b014, 'jmp', '0x11d9e535')
    image.instruction(image.base + 0x1a9e539, 'pushal', '')
    image.instruction(image.base + 0x1a9e540, 'sub', 'ebp, 0x8c5352b')
    sites = [0x211e7f, 0x3ba669, 0x3bd178]
    references = {}
    for site in sites:
        references[hex(site)] = {kind: image.data.count(struct.pack('<I', value))
                                for kind, value in [('rva', site), ('va', image.base + site)]}
    assert all(not count for row in references.values() for count in row.values())
    return {'section': 'Themida', 'startRVA': '0x1a9b000', 'endRVA': '0x1cf9000',
            'SHA256': hashlib.sha256(image.data[0x1a9b000:0x1cf9000]).hexdigest(),
            'entryRVA': '0x1a9b014', 'bootstrapRVA': '0x1a9e535',
            'plainCallsiteAddressReferencesInRecoveredImage': references,
            'resolvedTargets': {},
            'limits': ['No plain site-address repair records were found; this is not proof none exist in encoded metadata.',
                       'The protected bootstrap and its runtime import restoration are not executed or fully decoded.']}


def association_append_evidence(image):
    """Both compatible named Core allocation helpers preserve duplicates.

    The actual Engine import remains erased. This is a bounded equivalence of
    the named Core APIs accepting the surviving two integer arguments, followed
    by the actual Engine pointer write, not a claim to recover the import.
    """
    from check_tutorial_quest_native import Image, ROOT
    from check_cast_scheduler_native import Arithmetic
    core = Image(ROOT / 'assets/interlude/system/core.dll', CORE_SHA)
    candidates = sorted(n for n in core.exports if '@FArray@@QAEHHH@Z' in n)
    assert candidates == sorted(['?Add@FArray@@QAEHHH@Z', '?AddZeroed@FArray@@QAEHHH@Z'])
    assert image.data[0x1109f] == 0xe9
    assert 0x1109f + 5 + struct.unpack_from('<i', image.data, 0x110a0)[0] == 0x7ae60
    assert image.data[0x7ae67:0x7ae6d] == b'\x90' * 6
    engine_anchors = [(0x7ae61, 'push', '4'), (0x7ae63, 'push', '1'),
                      (0x7ae6d, 'mov', 'edx, dword ptr [esp + 8]'),
                      (0x7ae73, 'mov', 'edx, dword ptr [edx]'),
                      (0x7ae75, 'mov', 'dword ptr [ecx + eax*4], edx')]
    for rva, op, operands in engine_anchors:
        image.instruction(image.base + rva, op, operands)
    core_anchors = [(0x90c6, 'mov', 'edi, dword ptr [ecx + 4]'),
                    (0x90c9, 'lea', 'esi, [edi + eax]'), (0x90cf, 'mov', 'dword ptr [ecx + 4], esi'),
                    (0x90f1, 'mov', 'eax, edi'), (0x90f5, 'ret', '8'),
                    (0x9119, 'mov', 'ebp, dword ptr [esi + 4]'),
                    (0x911c, 'lea', 'ecx, [ebx + ebp]'), (0x9127, 'mov', 'dword ptr [esi + 4], ecx'),
                    (0x9175, 'mov', 'eax, ebp'), (0x9179, 'ret', '8')]
    for rva, op, operands in core_anchors:
        core.instruction(core.base + rva, op, operands)
    for symbol, body in zip(candidates, [0x90c0, 0x9110]):
        assert core.exported(symbol, True) == core.base + body
    cases = []
    for existing in [[], [7], [7, 7], [8, 7]]:
        array, buffer, stack, actor_argument = 0x2000, 0x3000, 0x4000, 0x5000
        memory = {array: buffer, array + 4: len(existing), array + 8: 16}
        memory.update({buffer + index * 4: value for index, value in enumerate(existing)})
        allocate = Arithmetic(core, memory, [], {'ecx': array, 'eax': 1})
        allocate.run(0x90c6, 0x90f1)  # Existing-capacity branch: no allocator is simulated.
        allocate.run(0x90f1, 0x90f3)
        memory = dict(allocate.memory)
        memory.update({stack + 8: actor_argument, actor_argument: 7})
        store = Arithmetic(image, memory, [], {'esi': array, 'esp': stack, 'eax': allocate.registers['eax']})
        store.run(0x7ae6d, 0x7ae78)
        count = store.memory[array + 4]
        result = [store.memory[buffer + index * 4] for index in range(count)]
        assert result == existing + [7]
        cases.append({'before': existing, 'incoming': 7, 'after': result})
    return {'coreSHA256': CORE_SHA, 'compatibleCoreAPIs': candidates,
            'engineHelperRVA': '0x7ae60', 'erasedAllocationCallRVA': '0x7ae67',
            'engineHelperSHA256': hashlib.sha256(image.data[0x7ae60:0x7ae7c]).hexdigest(),
            'coreAddSHA256': hashlib.sha256(core.data[0x90c0:0x90f8]).hexdigest(),
            'coreAddZeroedSHA256': hashlib.sha256(core.data[0x9110:0x917c]).hexdigest(),
            'instructionAnchors': len(engine_anchors) + len(core_anchors), 'actualInstructionCases': cases,
            'importTargetVerified': False, 'duplicatePolicyWithinNamedAPIDomain': 'append-preserving-duplicates',
            'limits': ['Ordinary nonnull actor association only; MagicType12 uses a different path.',
                       'Allocation failure, arbitrary external helpers and erased cleanup allocation imports are not modeled.']}


def initial_target_evidence(image):
    """Pin the normal supplied-User target path, without actor lookup fallback."""
    methods = {
        '?OnReceiveMagicSkillUse@UGameEngine@@UAEXPAUUser@@0AAVL2ParamStack@@@Z': (0x19c4a0, 0x19c9bc),
        '?SetMagicInfo@APawn@@QAEHHHMMPAVAActor@@MPAUFL2MagicSkillData@@@Z': (0x1f2840, 0x1f29dd),
    }
    ranges = []
    for symbol, (a, b) in methods.items():
        assert image.exported(symbol, True) == image.base + a
        ranges.append({'method': symbol, 'startRVA': hex(a), 'endRVA': hex(b),
                       'SHA256': hashlib.sha256(image.data[a:b]).hexdigest()})
    anchors = [
        (0x19c4a0, 'sub', 'esp, 0x30'), (0x19c4a3, 'push', 'ebx'),
        (0x19c4b5, 'push', 'ebp'), (0x19c4b6, 'push', 'esi'), (0x19c4b7, 'push', 'edi'),
        # Second User* argument stays at stable ESP+48 after the prologue.
        (0x19c67c, 'mov', 'ecx, dword ptr [esp + 0x48]'),
        (0x19c680, 'cmp', 'dword ptr [ecx + 0x204], 0'), (0x19c687, 'je', '0x1049c9b2'),
        # Two pushes temporarily move that same argument to ESP+50.
        (0x19c855, 'push', 'eax'), (0x19c860, 'push', 'ecx'),
        (0x19c861, 'mov', 'ecx, dword ptr [esp + 0x50]'),
        (0x19c865, 'mov', 'edx, dword ptr [ecx + 0x204]'), (0x19c87a, 'push', 'edx'),
        (0x19c87b, 'sub', 'esp, 8'), (0x19c895, 'push', 'eax'), (0x19c896, 'push', 'ebx'),
        (0x19c897, 'call', '0x10310b7c'),
        (0x1f2840, 'sub', 'esp, 0xc'), (0x1f2843, 'push', 'ebx'), (0x1f2844, 'push', 'esi'),
        (0x1f29a7, 'mov', 'eax, dword ptr [esp + 0x28]'),
        (0x1f29d7, 'mov', 'dword ptr [esi + 0x520], eax'),
        (0x19c91c, 'call', '0x103048e5'), (0x19c921, 'test', 'eax, eax'),
        (0x19c923, 'je', '0x1049c93f'), (0x19c925, 'mov', 'eax, dword ptr [esp + 0x48]'),
        (0x19c929, 'mov', 'dword ptr [ebp + 0x62c], 5'),
        (0x19c933, 'mov', 'ecx, dword ptr [eax + 0x204]'),
        (0x19c939, 'mov', 'dword ptr [ebp + 0x63c], ecx'),
    ]
    for rva, op, operands in anchors:
        image.instruction(image.base + rva, op, operands)
    def decode(pc):
        return next(image.dis.disasm(image.data[pc-image.base:pc-image.base+16], pc))
    vm = IntegerSlice(decode, [(image.base+a, image.base+b) for a, b in
                              [(0x19c67c, 0x19c68d), (0x19c861, 0x19c86b),
                               (0x1f29a7, 0x1f29ab), (0x1f29d7, 0x1f29dd),
                               (0x19c921, 0x19c93f)]])
    stack, wrapper, pawn = 0x2000, 0x3000, 0x4000
    cases = []
    for actor in [0, pawn, 0x5000]:
        for initialized in [0, 1]:
            memory = {stack+0x48: wrapper, wrapper+0x204: actor,
                      pawn+0x520: 71, pawn+0x63c: 72, pawn+0x62c: 3}
            gate = vm.run(image.base+0x19c67c, {image.base+0x19c68d, image.base+0x19c9b2},
                          {'esp': stack}, memory)
            if actor == 0:
                assert gate['stop'] == image.base+0x19c9b2
                assert gate['memory'] == memory
            else:
                # Actual load at the caller, then the callee's independent arg5
                # load/store. Stack-frame mapping is stated, not simulated ABI.
                incoming = vm.run(image.base+0x19c861, {image.base+0x19c86b},
                                  {'esp': stack-8}, memory)['registers']['edx']
                memory[stack+0x28] = incoming
                loaded = vm.run(image.base+0x1f29a7, {image.base+0x1f29ab}, {'esp': stack}, memory)
                stored = vm.run(image.base+0x1f29d7, {image.base+0x1f29dd},
                                {'esi': pawn, 'eax': loaded['registers']['eax']}, memory)
                adopted = vm.run(image.base+0x19c921, {image.base+0x19c93f},
                                 {'esp': stack, 'ebp': pawn, 'eax': initialized}, stored['memory'])
                assert adopted['memory'][pawn+0x520] == actor
                assert adopted['memory'][pawn+0x63c] == (actor if initialized else 72)
                assert adopted['memory'][pawn+0x62c] == (5 if initialized else 3)
            cases.append({'suppliedActor': actor, 'initSkillProcessResult': initialized,
                          'targetGatePassed': actor != 0, 'actionAdopted': actor != 0 and bool(initialized)})
    return {'instructionAnchors': len(anchors), 'ranges': ranges, 'actualInstructionCases': cases,
            'sameResolvedActorForMainAndActionTargets': True, 'nullActorAdmitted': False,
            'limits': ['Supplied nonnull User wrapper and synchronous ordinary handler only; not a packet-ID resolver proof.',
                       'Ground-target overload, temporary targets and special skill paths are not covered.',
                       'Successful InitSkillProcess is required before action5/current-action-target adoption.']}


class IntegerSlice:
    """Fail-closed DWORD control flow with explicit opaque-call callbacks.

    Pushes are recorded; calls do not emulate an ABI or allocate a stack. The
    selected slices inspect no pushed values after a call. Memory must be
    supplied explicitly, so a missing source input cannot silently become 0.
    """
    def __init__(self, decode, ranges):
        self.decode, self.ranges = decode, ranges

    def run(self, start, stops, registers, memory, calls=None, limit=300):
        registers, memory = dict(registers), dict(memory)
        calls, trace, pushes, flags, pc = calls or {}, [], [], None, start

        def address(operand):
            match = re.fullmatch(r'(?:dword ptr |byte ptr )?\[([a-z]{3})(?: \+ (0x[0-9a-f]+|[0-9]+))?\]', operand)
            if not match or match[1] not in registers:
                raise ValueError('unsupported or missing address: ' + operand)
            return (registers[match[1]] + int(match[2] or '0', 0)) & MASK

        def read(operand):
            if '[' in operand:
                value = memory[address(operand)]
                return value & (255 if operand.startswith('byte ptr ') else MASK)
            if operand in registers:
                return registers[operand] & MASK
            try:
                return int(operand, 0) & MASK
            except ValueError:
                raise ValueError('unsupported or missing operand: ' + operand) from None

        def write(operand, value):
            if operand.startswith('dword ptr '):
                memory[address(operand)] = value & MASK
            elif operand in ('eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp', 'esp'):
                registers[operand] = value & MASK
            else:
                raise ValueError('unsupported destination: ' + operand)

        for _ in range(limit):
            if pc in stops:
                return {'stop': pc, 'registers': registers, 'memory': memory,
                        'trace': trace, 'pushes': pushes}
            if not any(a <= pc < b for a, b in self.ranges):
                raise ValueError('instruction slice escaped declared code')
            instruction = self.decode(pc)
            op, args = instruction.mnemonic, instruction.op_str.split(', ')
            trace.append(pc)
            nxt = pc + instruction.size
            if op == 'mov':
                write(args[0], read(args[1]))
            elif op == 'lea':
                write(args[0], address(args[1]))
            elif op in ('cmp', 'test', 'add', 'xor'):
                a, b = read(args[0]), read(args[1])
                total = (a - b if op == 'cmp' else a + b if op == 'add'
                         else a & b if op == 'test' else a ^ b)
                value = total & MASK
                overflow = bool((a ^ b) & (a ^ value) & SIGN) if op == 'cmp' else (
                    bool(~(a ^ b) & (a ^ value) & SIGN) if op == 'add' else False)
                flags = {'z': value == 0, 's': bool(value & SIGN), 'o': overflow}
                if op in ('add', 'xor'):
                    write(args[0], value)
            elif op == 'jmp':
                nxt = int(args[0], 0)
            elif op in ('je', 'jne', 'jge', 'jl'):
                if flags is None:
                    raise ValueError('branch has no flags')
                take = {'je': flags['z'], 'jne': not flags['z'],
                        'jge': flags['s'] == flags['o'], 'jl': flags['s'] != flags['o']}[op]
                if take:
                    nxt = int(args[0], 0)
            elif op == 'push':
                pushes.append(read(args[0]))
            elif op == 'call':
                target = int(args[0], 0)
                if target not in calls:
                    raise ValueError('unmodeled call boundary: ' + args[0])
                calls[target](registers, memory, pushes)
                flags = None  # do not invent preservation across a callback
            elif op != 'nop':
                raise ValueError('unsupported instruction: ' + op)
            pc = nxt
        raise ValueError('instruction slice exceeded step bound')


def source_names():
    """Original declared names, bounded ScriptText hashes, no source output."""
    from check_tutorial_quest_native import ROOT
    from check_cast_scheduler_native import verify_source_fields
    base = verify_source_fields()
    sys.path.insert(0, str(ROOT / 'tools'))
    from l2lib import load_package
    from uscript.extract_uscript import source_text
    package, _ = load_package(str(ROOT / 'assets/interlude/system/Engine.u'))
    texts, evidence = {}, {}
    for name in ('Pawn', 'SkillAction', 'SkillVisualEffect'):
        owner = next(e for e in package.exports_by_class('Class') if package.export_name(e) == name)
        rows = [e for e in package.exports if package.export_name(e) == 'ScriptText'
                and e.package_index == owner.index + 1]
        assert len(rows) == 1
        export = rows[0]
        raw = package.data[export.serial_offset:export.serial_offset + export.serial_size]
        actual, value = source_text(raw)
        assert actual == name
        texts[name] = re.sub(r'//[^\n]*', '', value)
        evidence[name] = {'export': export.index, 'SHA256': hashlib.sha256(raw).hexdigest()}
    actions = re.search(r'enum NActionList\s*\{(.*?)\}', texts['Pawn'], re.S)[1]
    actions = re.findall(r'\bNACT_\w+', actions)
    assert actions[5] == 'NACT_SKILLUSE'
    assert re.search(r'class<Emitter>\s+EffectClass', texts['SkillAction'])
    assert re.search(r'bool\s+bOnMultiTarget', texts['SkillAction'])
    info = re.search(r'struct native SkillActionInfo\s*\{(.*?)\}', texts['SkillVisualEffect'], re.S)[1]
    assert re.findall(r'(?:SkillAction|int)\s+(\w+)\s*;', info) == ['Action', 'SpecificStage']
    return {'enginePackageSHA256': base['enginePackageSHA256'], 'exports': evidence,
            'skillActionId': actions.index('NACT_SKILLUSE'), 'multiTargetFlag': 'bOnMultiTarget'}


def evaluated_cases(image):
    base, pawn, action, frame = image.base, 0x2000, 0x3000, 0x4000

    def flow(a, b):
        return IntegerSlice(lambda pc: next(image.dis.disasm(image.data[pc-base:pc-base+16], pc)),
                            [(base+a, base+b)])

    counts = {}
    # The externally supplied global-mode and Actor->Pawn conversion gates are
    # outside these slices; all remaining action/target gates execute below.
    for name, start, stop, offset in [('preshot', 0x3bd71f, 0x3bd73f, 0x5a0),
                                       ('channeling', 0x3bd7ff, 0x3bd81f, 0x5a4)]:
        count = 0
        for present in (False, True):
            for action_id in (0, 1, 5, 6):
                for target in (0, 99):
                    memory = {pawn+0x62c: action_id, pawn+0x63c: target, pawn+offset: 0}
                    actual = flow(start, stop).run(base+start, {base+stop},
                        {'eax': pawn if present else 0}, memory)
                    assert actual['memory'][pawn+offset] == int(present and action_id == 5 and bool(target))
                    count += 1
        counts[name+'Gates'] = count

    # Erased native name comparison remains an explicit input. The multishot
    # callee itself is evaluated from original instructions, not an ID table.
    shot_cases = 0
    for same_name in (False, True):
        for magic_type in range(16):
            for previous in (0, 1, 2):
                memory = {pawn+0x52c: magic_type, pawn+0x59c: previous}
                def multishot(registers, _, __):
                    result = flow(0x1ed8e0, 0x1ed8fe).run(base+0x1ed8e0,
                        {base+0x1ed8f7, base+0x1ed8fd}, {'ecx': pawn}, memory)
                    registers['eax'] = result['registers']['eax']
                actual = flow(0x3bd188, 0x3bd1ad).run(base+0x3bd188, {base+0x3bd1ad},
                    {'eax': 0 if same_name else 1, 'esi': pawn}, memory, {base+0x3486: multishot})
                expected = 2 if same_name else 1 if magic_type in (8, 9, 10) else previous
                assert actual['memory'][pawn+0x59c] == expected
                shot_cases += 1
    counts['shotIdentityBoundary'] = shot_cases

    calls = {0xad3f: 'channelingAgent', 0x113bf: 'channelingLegacy',
             0x11130: 'preshotAgent', 0x13610: 'preshotLegacy', 0xf457: 'finalize'}
    count = 0
    for agent in (0, 99):
        for channeling in (0, 1):
            for preshot in (0, 1):
                for shot in (0, 1, 2):
                    events = []
                    hooks = {base+rva: (lambda r, m, p, name=name: events.append(name))
                             for rva, name in calls.items()}
                    memory = {pawn+0x4f0: agent, pawn+0x520: 7, pawn+0x50c: 4,
                              pawn+0x59c: shot, pawn+0x5a0: preshot, pawn+0x5a4: channeling}
                    actual = flow(0x211c2d, 0x211c9e).run(base+0x211c2d, {base+0x211c9e},
                        {'esi': pawn, 'ebx': 0}, memory, hooks)
                    suffix = 'Agent' if agent else 'Legacy'
                    expected = (['channeling'+suffix] if channeling else []) + (
                        ['preshot'+suffix] if preshot else []) + (['finalize'] if shot else [])
                    assert events == expected
                    assert actual['memory'][pawn+0x50c] == 4 + preshot
                    assert all(actual['memory'][pawn+o] == 0 for o in (0x59c, 0x5a0, 0x5a4))
                    count += 1
    counts['pendingConsumption'] = count

    count = 0
    for specific in (0, 1, 2, -1):
        for stage in (1, 2):
            for pending in (1, 2):
                for multi in (0, 1):
                    for target in (0, 99):
                        for associated in (0, 2):
                            memory = {pawn+0x59c: pending, pawn+0x508: stage,
                                      pawn+0x520: target, pawn+0x554: associated, action+0x38: multi}
                            actual = flow(0x1ed474, 0x1ed4ae).run(base+0x1ed474,
                                {base+0x1ed556, base+0x1ed58a, base+0x1ed4ae},
                                {'eax': specific, 'esi': pawn, 'ebx': action}, memory)
                            selected = specific == stage or (specific == 0 and pending == 2)
                            expected = 0x1ed556 if not selected else (
                                0x1ed58a if (multi and associated) or not target else 0x1ed4ae)
                            assert actual['stop'] == base+expected
                            count += 1
    counts['shotActionSelection'] = count

    count = 0
    for action_id in (1, 5):
        for incoming_id in (7, 8):
            for target in (0, 99):
                for magic_type in (2, 12):
                    memory = {pawn+0x62c: action_id, pawn+0x4f8: 7, pawn+0x520: target,
                              pawn+0x52c: magic_type, frame+8: incoming_id}
                    actual = flow(0x21325a, 0x213280).run(base+0x21325a,
                        {base+0x2132bb, base+0x21328d, base+0x213280},
                        {'esi': pawn, 'ebp': frame}, memory)
                    expected = 0x2132bb if action_id != 5 or incoming_id != 7 or not target else (
                        0x213280 if magic_type == 12 else 0x21328d)
                    assert actual['stop'] == base+expected
                    count += 1
    counts['associationAcceptance'] = count
    # A second Agent TriggerShot after pending2 cleanup has no main/associated
    # targets, but still reaches the unconditional shot sound request.
    no_target = flow(0x1ed58f, 0x1ed5ab).run(base + 0x1ed58f,
        {base + 0x1ed556}, {'edi': 0, 'esi': pawn}, {pawn + 0x554: 0})
    assert no_target['stop'] == base + 0x1ed556
    count = 0
    for effect_count in (0, 1):
        for first_effect in (0, 99):
            sound_calls = []
            def sound(registers, memory, pushes):
                sound_calls.append(tuple(pushes[-3:]))
            memory = {pawn + 0x56c: effect_count, pawn + 0x568: action,
                      pawn + 0x520: 0, action: first_effect}
            actual = flow(0x1ed5b0, 0x1ed5ef).run(base + 0x1ed5b0, {base + 0x1ed5ef},
                {'esi': pawn}, memory, {base + 0x7360: sound})
            assert sound_calls == [(2, pawn, pawn)]
            assert base + 0x1ed5df not in actual['trace']
            count += 1
    counts['targetlessAgentStillRequestsShotSound'] = count
    return counts


def verify():
    from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA
    image = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    methods = {
        '?Notify@UAnimNotify_AttackPreShot@@UAEXPAVUMeshInstance@@PAVAActor@@@Z': (0x3bd6e0, 0x3bd759),
        '?Notify@UAnimNotify_Channeling@@UAEXPAVUMeshInstance@@PAVAActor@@@Z': (0x3bd7c0, 0x3bd839),
        '?Notify@UAnimNotify_AttackShot@@UAEXPAVUMeshInstance@@PAVAActor@@@Z': (0x3bd100, 0x3bd20b),
        '?Notify@UAnimNotify_AttackItem@@UAEXPAVUMeshInstance@@PAVAActor@@@Z': (0x3bce80, 0x3bd04c),
        '?Notify@UAnimNotify_AttackVoice@@UAEXPAVUMeshInstance@@PAVAActor@@@Z': (0x3bd8a0, 0x3bda62),
        '?IsCastingMultiShotSkill@APawn@@QAEHXZ': (0x1ed8e0, 0x1ed8fe),
        '?MagicProcess@APawn@@QAEXM@Z': (0x211ab0, 0x211fd6),
        '?SkillEffectFinalize@APawn@@QAEXXZ': (0x211640, 0x2119c7),
        '?AddAssociatedActorNotify@APawn@@QAEXHHPAVAActor@@H@Z': (0x213230, 0x2132d5),
        '?TriggerCasting@USkillVisualEffect@@QAEXPAVAPawn@@PAVAActor@@@Z': (0x1ed030, 0x1ed131),
        '?TriggerChanneling@USkillVisualEffect@@QAEXPAVAPawn@@PAVAActor@@@Z': (0x1ed1b0, 0x1ed327),
        '?TriggerPreshot@USkillVisualEffect@@QAEXPAVAPawn@@@Z': (0x1ec250, 0x1ec292),
        '?TriggerShot@USkillVisualEffect@@QAEXPAVAPawn@@@Z': (0x1ed420, 0x1ed60a),
        '?Clear@FNMagicInfo@@QAEXH@Z': (0x8e630, 0x8e735),
        '?MagicCancel@APawn@@QAEXXZ': (0x212760, 0x212b67),
        '?MagicStop@APawn@@QAEXXZ': (0x212160, 0x212573),
    }
    ranges = []
    for name, (a, b) in methods.items():
        assert image.exported(name, True) == image.base+a
        ranges.append({'method': name, 'startRVA': hex(a), 'endRVA': hex(b),
                       'SHA256': hashlib.sha256(image.data[a:b]).hexdigest()})
    anchors = [
        # Common normal-client/action gates and distinct pending slots.
        (0x3bd71d, 'jne', '0x106bd73f'), (0x3bd735, 'mov', 'dword ptr [eax + 0x5a0], 1'),
        (0x3bd7fd, 'jne', '0x106bd81f'), (0x3bd815, 'mov', 'dword ptr [eax + 0x5a4], 1'),
        (0x3bd155, 'cmp', 'dword ptr [esi + 0x63c], 0'),
        (0x3bd15e, 'cmp', 'dword ptr [esi + 0x62c], 5'),
        (0x3bd18c, 'mov', 'dword ptr [esi + 0x59c], 2'),
        (0x3bd1a3, 'mov', 'dword ptr [esi + 0x59c], 1'),
        # Initial process is distinct from subsequent pending consumption.
        (0x211adb, 'fcomp', 'dword ptr [esi + 0x51c]'),
        (0x211b12, 'mov', 'dword ptr [esi + 0x59c], ebx'),
        (0x211b18, 'mov', 'dword ptr [esi + 0x5a0], ebx'),
        (0x211b30, 'call', '0x10306c35'), (0x211b39, 'call', '0x10311cca'),
        (0x211c47, 'call', '0x1030ad3f'), (0x211c50, 'call', '0x103113bf'),
        (0x211c63, 'add', 'dword ptr [esi + 0x50c], 1'),
        (0x211c75, 'call', '0x10311130'), (0x211c7e, 'call', '0x10313610'),
        (0x211c93, 'call', '0x1030f457'),
        # Completion fallback tests LastShotName, not a ShotTime comparison.
        (0x211e5d, 'cmp', 'dword ptr [esi + 0x534], ecx'),
        (0x211e63, 'jg', '0x10511f4c'), (0x211e79, 'lea', 'ecx, [esi + 0x598]'),
        (0x211e85, 'test', 'eax, eax'), (0x211e87, 'je', '0x10511ea0'),
        (0x211e89, 'mov', 'dword ptr [esi + 0x59c], 2'),
        (0x211e95, 'call', '0x1030f457'), (0x211f28, 'call', '0x103091a1'),
        # Selected-name output is written even for a zero-time notify.
        (0x3ba663, 'push', '1'), (0x3ba665, 'push', '0'),
        (0x3ba667, 'mov', 'ecx, eax'), (0x3ba67f, 'mov', 'dword ptr [ecx], edx'),
        (0x3ba68d, 'call', 'edx'), (0x3ba68f, 'fstp', 'dword ptr [ebp - 0x14]'),
        (0x3bd174, 'push', '0'), (0x3bd176, 'mov', 'ecx, edi'),
        # Finalize always invokes the trigger before last-shot cleanup.
        (0x21173a, 'add', 'dword ptr [esi + 0x508], 1'),
        (0x21174a, 'call', '0x10305051'),
        (0x21184e, 'mov', 'ecx, esi'), (0x211850, 'call', '0x10307cf7'),
        (0x21183c, 'push', '0'), (0x211844, 'call', '0x103091a1'),
        (0x21193c, 'lea', 'edi, [esi + 0x4f0]'), (0x211946, 'call', '0x103091a1'),
        # Server launch registers actors; neither pending flags nor time are set.
        (0x1925ff, 'call', '0x10306aa0'), (0x19c46f, 'call', '0x10306aa0'),
        (0x213297, 'call', '0x1031109f'), (0x2132ac, 'call', '0x1031109f'),
        (0x2132b1, 'mov', 'dword ptr [esi + 0x530], 1'),
        # Original Action field and generated bitfield assignment.
        (0x55467, 'mov', 'eax, dword ptr [edi + 0x34]'),
        (0x5546d, 'mov', 'ecx, dword ptr [edi + 0x38]'), (0x55473, 'and', 'ecx, 1'),
        # Casting/channeling array order and direct main-target arguments.
        (0x1ed060, 'cmp', 'ebx, dword ptr [ecx + 0x3c]'),
        (0x1ed06c, 'mov', 'ecx, dword ptr [eax + ebx*8]'),
        (0x1ed079, 'mov', 'eax, dword ptr [ebp + 0xc]'),
        (0x1ed081, 'call', 'edx'), (0x1ed10b, 'push', '1'), (0x1ed111, 'call', '0x10307360'),
        (0x1ed1e3, 'cmp', 'esi, dword ptr [ecx + 0x48]'),
        (0x1ed1ef, 'mov', 'ecx, dword ptr [eax + esi*8]'),
        (0x1ed1fc, 'mov', 'eax, dword ptr [ebp + 0xc]'), (0x1ed204, 'call', 'edx'),
        (0x1ed459, 'mov', 'ecx, dword ptr [ecx + 0x5c]'),
        (0x1ed45c, 'lea', 'eax, [ecx + eax*8]'),
        (0x1ed4b4, 'mov', 'eax, dword ptr [edx + 0x68]'),
        (0x1ed597, 'mov', 'eax, dword ptr [ebx]'),
        (0x1ed59f, 'mov', 'edx, dword ptr [ecx + edi*4]'),
        (0x1ed5a9, 'call', 'eax'), (0x1ed5e4, 'push', '2'), (0x1ed5ea, 'call', '0x10307360'),
        # Clear(0) shares pending/target clearing; Clear(1) also clears identity.
        (0x8e65c, 'je', '0x1038e6b3'), (0x8e68f, 'mov', 'dword ptr [esi + 8], edi'),
        (0x8e692, 'mov', 'dword ptr [esi + 0xc], edi'),
        (0x8e698, 'mov', 'dword ptr [esi + 0x14], ebx'),
        (0x8e6a6, 'mov', 'dword ptr [esi + 0x10], ebx'),
        (0x8e6a9, 'mov', 'dword ptr [esi], edi'),
        (0x8e6ab, 'fst', 'dword ptr [esi + 0x2c]'),
        (0x8e6be, 'mov', 'dword ptr [esi + 0x30], edi'),
        (0x8e70c, 'mov', 'dword ptr [esi + 0xac], edi'),
        (0x8e712, 'mov', 'dword ptr [esi + 0xb0], edi'),
        (0x8e718, 'mov', 'dword ptr [esi + 0xb4], edi'),
        (0x212b09, 'push', '1'), (0x212b11, 'call', '0x103091a1'),
        (0x212513, 'push', '1'), (0x21251b, 'call', '0x103091a1'),
        # AttackItem and AttackVoice are separately named audio getters.
        (0x3bcf2b, 'mov', 'eax, dword ptr [eax + 0x1fc]'),
        (0x3bd93d, 'mov', 'edx, dword ptr [eax + 0x20c]'),
        (0x3bd029, 'mov', 'eax, dword ptr [edx + 0x80]'),
        (0x3bda3f, 'mov', 'eax, dword ptr [edx + 0x80]'),
    ]
    for rva, op, operands in anchors:
        image.instruction(image.base+rva, op, operands)
    for slot, symbol in [(0x1fc, '?GetAttackItemSound@APawn@@UAEPAVUSound@@AAM0@Z'),
                         (0x20c, '?GetAttackVoiceSound@APawn@@UAEPAVUSound@@M@Z')]:
        assert image.u32(image.exported('??_7APawn@@6B@')+slot) == image.exported(symbol)
    assert image.u32(image.exported('??_7USkillAction@@6B@')+0x68) == image.exported(
        '?Notify@USkillAction@@UAEPAVAEmitter@@PAVAActor@@0@Z')
    assert image.exported('?Audio@USound@@2PAVUAudioSubsystem@@A') == 0x10c41ce0
    # This entire exported method is bookkeeping only: even a future extra
    # instruction must fail, not turn the current no-op into an assumed rule.
    preshot = list(image.dis.disasm(image.data[0x1ec250:0x1ec292], image.base+0x1ec250))
    assert all(i.mnemonic in ('push', 'mov', 'sub', 'pop', 'ret') for i in preshot)
    assert not any('[ecx' in i.op_str or '[eax' in i.op_str or '[esi' in i.op_str for i in preshot)
    finalize_targets = {image.exported('?SkillEffectFinalize@APawn@@QAEXXZ', body)
                        for body in (False, True)}
    finalize_calls, position = [], -1
    while True:
        position = image.data.find(b'\xe8', position+1)
        if position < 0 or position+5 > len(image.data):
            break
        destination = image.base+position+5+struct.unpack_from('<i', image.data, position+1)[0]
        if destination in finalize_targets:
            finalize_calls.append(position)
    assert finalize_calls == [0x211c93, 0x211e95]
    return {'tool': 'Elbera Tools / Pawn notify lifecycle', 'engineSHA256': ENGINE_SHA,
            'source': source_names(), 'methodRanges': ranges, 'instructionAnchors': len(anchors),
            'identityABI': identity_abi_evidence(image), 'identitySourceDomain': source_identity_domain(),
            'actorTickOrder': tick_order_evidence(image),
            'actionStructZeroInitialization': action_struct_zero_evidence(),
            'protectorTargetBoundary': protector_target_boundary(image),
            'ordinaryAssociationAppend': association_append_evidence(image),
            'initialTarget': initial_target_evidence(image),
            'directFinalizeCallRVAs': list(map(hex, finalize_calls)),
            'evaluatedCases': evaluated_cases(image),
            'limits': ['Opaque imported object-name comparison and completion comparison polarity remain input boundaries.',
                       'Integer slices do not execute calls, render effects, or emulate cleanup internals.',
                       'Normal client skill-use branch only; editor/other attack branches are not ported.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='print compact result')
    args = parser.parse_args()
    result = verify()
    if args.check:
        print(f"PASS {result['instructionAnchors']} anchors, {len(result['methodRanges'])} pinned-build ranges, "
              f"{sum(result['evaluatedCases'].values())} actual-instruction cases; "
              f"{result['identitySourceDomain']['entries']} source shot identities; "
              f"{sum(result[key]['instructionAnchors'] for key in ('identityABI', 'actorTickOrder', 'actionStructZeroInitialization', 'ordinaryAssociationAppend', 'initialTarget'))} additional identity/tick/array/target anchors; "
              f"{len(result['ordinaryAssociationAppend']['actualInstructionCases'])} append and "
              f"{len(result['initialTarget']['actualInstructionCases'])} initial-target cases")
    else:
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
