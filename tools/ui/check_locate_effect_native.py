#!/usr/bin/env python3
"""Elbera Tools: original SkillAction_LocateEffect placement boundaries.

Reads pinned original binaries/packages; evaluates small call-free arithmetic
slices. No original code is executed or emitted. This proves actor selection,
offset inputs and selected attachment branches, not erased rotation helpers,
world actor placement, complete emitter simulation or native render parity.
"""
import argparse
import ast
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
from pathlib import Path
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
ENGINE_PACKAGE_SHA = '9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761'
SKILL_PACKAGE_SHA = '30b9a60d2a27c12d7fb9826a38772b3932c4ad66ab5f0638e8128813898463f5'


def f32(value):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        raise ValueError('finite source scalar required')
    try:
        result = struct.unpack('<f', struct.pack('<f', value))[0]
    except OverflowError as error:
        raise ValueError('finite Float32 required') from error
    if not math.isfinite(result):
        raise ValueError('finite Float32 required')
    return result


def vector(value):
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError('three source components required')
    return list(map(f32, value))


def relative_offset_input(offset, collision_radius, collision_height=None, *,
                          skeletal=False, mesh_origin_z=None, draw_scale=None):
    """Native vector BEFORE its erased rotation/coordinate transform.

    Caller must establish the original skeletal gate; missing fields do not
    substitute visual height. Float64 intermediates approximate finite x87
    tests; every native Float32 store is retained.
    """
    if type(skeletal) is not bool:
        raise ValueError('explicit skeletal classification required')
    x, y, z = vector(offset)
    radius = f32(collision_radius)
    height = f32(mesh_origin_z) if skeletal else f32(collision_height)
    z_value = height * z
    if skeletal:
        z_value *= f32(draw_scale)
    return [f32(radius * x), y, f32(z_value)]


def raw_offset(offset):
    """bRelativeToCylinder=false bypasses scaling AND offset rotation."""
    return vector(offset)


def added_location(base, processed_offset):
    """Native addition only: no visual half-height or actor-origin invention."""
    return [f32(a + b) for a, b in zip(vector(base), vector(processed_offset))]


def read_alias_arrays(reader, names, skeleton_names):
    """Exact serialized parallel arrays, independent of native name lookup.

    This is a data decoder, not a replacement for either erased FName call.
    It rejects truncated, mismatched and ambiguous arrays instead of zip's
    truncation or an invented identity coordinate record.
    """
    start = reader.pos
    def count(width=1):
        n = reader.compact()
        if n < 0 or n > (len(reader.data) - reader.pos) // width:
            raise ValueError('invalid attachment array count')
        return n
    def name():
        index = reader.compact()
        if not 0 <= index < len(names) or not isinstance(names[index], str):
            raise ValueError('invalid attachment name index')
        return index, names[index]
    aliases = [name() for _ in range(count())]
    bones = [name() for _ in range(count())]
    coords = [[reader.f32() for _ in range(12)] for _ in range(count(48))]
    if len(aliases) != len(bones) or len(aliases) != len(coords):
        raise ValueError('attachment parallel arrays differ in length')
    if len({name.casefold() for _, name in aliases}) != len(aliases):
        raise ValueError('duplicate or case-ambiguous attachment alias')
    records = []
    for (alias_index, alias), (bone_index, bone), coord in zip(aliases, bones, coords):
        matching = [i for i, name in enumerate(skeleton_names) if name == bone]
        if len(matching) != 1 or alias == 'None':
            raise ValueError('attachment bone missing or ambiguous in original skeleton')
        if not all(math.isfinite(v) for v in coord):
            raise ValueError('nonfinite original attachment coordinates')
        records.append({'alias': alias, 'aliasNameIndex': alias_index, 'bone': bone,
                        'boneNameIndex': bone_index, 'skeletonIndex': matching[0],
                        'origin': coord[:3], 'axes': [coord[3:6], coord[6:9], coord[9:12]]})
    return {'records': records, 'start': start, 'end': reader.pos,
            'SHA256': hashlib.sha256(reader.data[start:reader.pos]).hexdigest()}


def original_mesh_aliases(package, export):
    """Bounded original version-5 mesh prefix through its three alias arrays."""
    from l2lib import Reader, read_properties
    if (package.file_version, package.licensee_version) not in ((123, 28), (123, 30)):
        raise ValueError('unsupported original attachment mesh package version')
    raw = package.data[export.serial_offset:export.serial_offset + export.serial_size]
    r = Reader(raw)
    read_properties(package, r)
    r.bytes(41)  # UMesh FBox and FSphere.
    version, vertices = r.i32(), r.i32()
    if version != 5 or vertices < 0:
        raise ValueError('unsupported original attachment LOD version')
    def count(width=1):
        value = r.compact()
        if value < 0 or value > (len(raw) - r.pos) // width:
            raise ValueError('invalid original mesh array count')
        return value
    def array(width):
        return r.bytes(count(width) * width)
    array(4)
    for _ in range(count()): package.resolve_ref(r.compact())
    transform = [r.f32() for _ in range(6)] + [r.i32() for _ in range(3)]
    if not all(math.isfinite(v) for v in transform):
        raise ValueError('nonfinite original mesh transform')
    for size in (2, 8, 2, 10, 8): array(size)
    r.bytes(24); r.i32(); r.compact(); r.bytes(52); r.f32(); r.i32()
    array(12)  # Points2, no lazy-array skip word in this package version.
    skeleton = []
    for _ in range(count()):
        index = r.compact()
        if not 0 <= index < len(package.names): raise ValueError('invalid original skeleton name')
        skeleton.append(package.names[index]); r.bytes(56)
    if not skeleton or len(set(skeleton)) != len(skeleton):
        raise ValueError('empty or duplicate original skeleton')
    package.resolve_ref(r.compact()); r.i32()
    for _ in range(count()): array(2); r.i32()
    array(4)
    aliases = read_alias_arrays(r, package.names, skeleton)
    # The following original LOD count also bounds the table endpoint. The
    # independent placement reader verifies later lazy-array framing below.
    if not 0 < count() < 10: raise ValueError('invalid following original LOD count')
    return {'mesh': package.export_name(export), 'meshVersion': version,
            'exportOffset': export.serial_offset, 'exportLength': export.serial_size,
            'exportSHA256': hashlib.sha256(raw).hexdigest(), 'skeletonNames': skeleton,
            'meshScale': transform[:3], 'meshOrigin': transform[3:6],
            'rotationOrigin': transform[6:], 'aliases': aliases}


def player_alias_evidence():
    """Fresh class Mesh defaults select all 14 primary meshes; no mesh-name guess."""
    sys.path[:0] = [str(ROOT / p) for p in ('tools', 'tools/dat', 'tools/src/char_pipeline')]
    from l2lib import load_package
    from export_npc_visuals import OriginalClasses, terminal_defaults
    from check_cast_sound_native import model_voice_source
    from check_player_transform_native import original_lod0_points
    from parse_skillfx import parse_skill_usk
    original = OriginalClasses()
    tree = ast.parse((ROOT / 'tools/src/char_pipeline/build_characters.py').read_text())
    combos = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                  and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name) and n.targets[0].id == 'COMBOS')
    binding = model_voice_source()  # Re-decrypt original chargrp, independently joining model identities.
    paths = {p.stem.casefold(): p for p in (ROOT / 'assets/interlude/animations').glob('*.ukx')}
    packages, rows = {}, []
    skill = load_package(str(ROOT / 'assets/interlude/animations/Skill.usk'))[0]
    _, actions = parse_skill_usk(skill)
    requests = [(ref, action['bone']) for ref, action in actions.items() if action.get('attachOn') == 4]
    for model, _, _, _, _, cls, _ in combos:
        qualified = 'LineageWarrior.' + cls
        node = original.get(qualified)
        package = original.packages['LineageWarrior']
        export = package.find_export(cls)
        props, proof = terminal_defaults(package, export, original.property_types(qualified, set()))
        if proof['defaultsBoundary'] != 'unique-validated-candidate':
            raise ValueError('ambiguous original pawn Mesh default')
        selected = [value for name, kind, value in props if name == 'Mesh' and kind == 'object']
        if len(selected) != 1: raise ValueError('missing or duplicate original pawn Mesh default')
        pkg_name, mesh_name = selected[0]
        path = paths[pkg_name.casefold()]
        if path not in packages: packages[path] = load_package(str(path))[0]
        mesh_package = packages[path]
        matches = [e for e in mesh_package.exports if mesh_package.class_name_of(e) == 'SkeletalMesh'
                   and mesh_package.export_name(e) == mesh_name]
        if len(matches) != 1: raise ValueError('ambiguous or missing original primary mesh')
        mesh = original_mesh_aliases(mesh_package, matches[0])
        points = original_lod0_points(mesh_package, matches[0])
        aliases = {r['alias'] for r in mesh['aliases']['records']}
        rows.append({'modelId': model, 'pawnClass': node['name'], 'classDefaultEvidence': proof,
                     'packageSHA256': hashlib.sha256(path.read_bytes()).hexdigest(),
                     'meshPath': pkg_name + '.' + mesh_name, 'mesh': mesh,
                     'independentLOD0PointCount': len(points),
                     'exactSerializedAliasRequests': [ref for ref, alias in requests if alias in aliases]})
    return {'models': rows, 'classPackageSHA256': original.sources, 'modelBinding': binding,
            'requestedAliases': dict(Counter(alias for _, alias in requests)),
            'limits': 'Exact serialized primary-mesh data only; erased lookup predicates, runtime mesh replacement/alias mutation and attachment transforms are not resolved.'}


def core_coordinate_transform(coords, point, mode):
    """Named surviving Core methods; never selects an erased Engine target."""
    if not isinstance(coords, (list, tuple)) or len(coords) != 4:
        raise ValueError('four original coordinate vectors required')
    origin, *axes = [vector(row) for row in coords]
    point = vector(point)
    if mode == 'point': point = [a-b for a,b in zip(point, origin)]
    elif mode not in ('vector', 'transpose', 'pivot'):
        raise ValueError('explicit named Core transform required')
    if mode == 'transpose': axes = list(zip(*axes))
    result = [f32((point[0]*axis[0] + point[1]*axis[1]) + point[2]*axis[2]) for axis in axes]
    return [f32(a+b) for a,b in zip(result, origin)] if mode == 'pivot' else result


def alias_and_coordinate_evidence(image):
    from check_tutorial_quest_native import Image
    from check_player_transform_native import CORE_SHA
    from check_legacy_skill_effects_native import LinearX87
    core = Image(ROOT / 'assets/interlude/system/Core.dll', CORE_SHA)
    assert image.exported('?Serialize@USkeletalMesh@@UAEXAAVFArchive@@@Z', True) == image.base+0x3e61c0
    get_mesh = '?GetMesh@ULodMeshInstance@@UAEPAVUMesh@@XZ'
    assert image.u32(image.exported('??_7USkeletalMeshInstance@@6B@')+0x94) == image.exported(get_mesh)
    assert image.exported(get_mesh, True) == image.base+0x60cf0
    anchors = [
        (0x60cf0,'mov','eax, dword ptr [ecx + 0x60]'),
        # Two FName arrays, then one 48-byte coordinate array, in source order.
        (0x3e6244,'lea','eax, [edi + 0x318]'), (0x3e624c,'call','0x103028ce'),
        (0x3e6251,'lea','ecx, [edi + 0x324]'), (0x3e6259,'call','0x103028ce'),
        (0x3e6261,'lea','edx, [edi + 0x330]'), (0x3e6269,'call','0x1030536c'),
        (0x2e55e6,'push','4'), (0x2e5643,'mov','eax, dword ptr [edx + 0x1c]'),
        (0x3c3086,'push','0x30'), (0x3c30ef,'call','0x10311301'),
        (0x3c3124,'lea','ecx, [esi + esi*2]'), (0x3c3127,'shl','ecx, 4'),
        (0x3af20b,'push','4'), (0x3af218,'lea','eax, [edi + 4]'),
        (0x3af226,'lea','ecx, [edi + 8]'), (0x3af234,'lea','ebx, [edi + 0xc]'),
        (0x3af25e,'lea','ebx, [edi + 0x18]'), (0x3af288,'add','edi, 0x24'),
        # LocateEffect requests the alias on a classified pawn's +134 instance.
        (0x1ecbb0,'call','0x10310c1c'), (0x1ecbbc,'mov','eax, dword ptr [eax + 0x134]'),
        (0x1ecbc7,'call','0x103029aa'), (0x1b42a9,'push','0x10daf7d8'),
        (0x1b4249,'push','0x10dd3290'),
        (0x1ecbd5,'mov','ecx, dword ptr [edi + 0x40]'),
        (0x1ecc1a,'mov','ecx, dword ptr [eax]'), (0x1ecc22,'mov','dword ptr [esp + 0x54], ecx'),
        # Absent alias uses an erased FName(0)-shaped constructor, not its input.
        (0x3b4190,'push','0'), (0x3b4192,'mov','esi, dword ptr [ebp + 8]'),
        (0x3b4093,'fldz',''),
        # First helper: coordinates receiver + rotation ref + hidden return.
        (0x1ec8db,'mov','ecx, dword ptr [0x11d8d73c]'),
        (0x1ec8e5,'lea','edx, [esp + 0x28]'), (0x1ec8e9,'push','edx'),
        (0x1ec8ee,'push','eax'), (0x1ec8ef,'add','ecx, 0x18'),
        # Second helper: vector receiver + returned coords ref + hidden return.
        (0x1ec8f8,'push','eax'), (0x1ec8fd,'push','ecx'),
        (0x1ec8fe,'lea','ecx, [esp + 0x50]'),
    ]
    for rva, op, arg in anchors: image.instruction(image.base+rva,op,arg)
    for stub, target in [(0x28ce,0x2e55c0),(0x536c,0x3c3060),(0x11301,0x3af200),
                         (0x10c1c,0x1b42a0),(0x29aa,0x1b4240)]:
        assert image.data[stub] == 0xe9
        assert stub+5+struct.unpack_from('<i',image.data,stub+1)[0] == target
    assert image.exported('?PrivateStaticClass@USkeletalMeshInstance@@0VUClass@@A') == 0x10dd3290
    erased = [0x3b4160,0x3b407e,0x3b4197,0x3b40ac,0x1ecc00,0x1eccb7,0x1b42b0,0x1b4250,0x1ec8f2,0x1ec902]
    for rva in erased: assert image.data[rva:rva+6] == b'\x90'*6
    methods = {
        '??8FName@@QBEHABV0@@Z': (0x9d40,0x9d52),
        '??9FName@@QBEHABV0@@Z': (0x9d60,0x9d72),
        '??0FCoords@@QAE@ABVFVector@@000@Z': (0xdde0,0xde38),
        '??0FCoords@@QAE@ABVFVector@@@Z': (0xdd90,0xddcc),
        '??DFCoords@@QBE?AV0@ABVFRotator@@@Z': (0x10150,0x10187),
        '??KFCoords@@QBE?AV0@ABVFRotator@@@Z': (0x105b0,0x105e7),
        '?TransformPointBy@FVector@@QBE?AV1@ABVFCoords@@@Z': (0xf640,0xf65a),
        '?TransformVectorBy@FVector@@QBE?AV1@ABVFCoords@@@Z': (0xf660,0xf67a),
        '?TransformVectorByTranspose@FVector@@QBE?AV1@ABVFCoords@@@Z': (0xf680,0xf6d2),
        '?PivotTransform@FVector@@QBE?AV1@ABVFCoords@@@Z': (0xf6f0,0xf766),
    }
    ranges = []
    for symbol,(a,b) in methods.items():
        assert core.exported(symbol,True) == core.base+a
        ranges.append({'method':symbol,'startRVA':hex(a),'endRVA':hex(b),
                       'SHA256':hashlib.sha256(core.data[a:b]).hexdigest()})
    for rva, op, arg in [(0x9d4a,'sete','cl'),(0x9d6a,'setne','cl'),
                         (0x9d4f,'ret','4'),(0x9d6f,'ret','4'),
                         (0x10184,'ret','8'),(0x105e4,'ret','8'),
                         (0xf657,'ret','8'),(0xf677,'ret','8'),
                         (0xf6cf,'ret','8'),(0xf763,'ret','8'),
                         (0xf64c,'call','0x10101424'),(0xf66c,'call','0x10101dd4')]:
        core.instruction(core.base+rva,op,arg)
    for stub,target in [(0x1424,0xf510),(0x1dd4,0xf5b0)]:
        assert core.data[stub] == 0xe9
        assert stub+5+struct.unpack_from('<i',core.data,stub+1)[0] == target
        end = 0xf584 if target == 0xf510 else 0xf618
        ranges.append({'method':'call-free coordinate helper','startRVA':hex(target),'endRVA':hex(end),
                       'SHA256':hashlib.sha256(core.data[target:end]).hexdigest()})
    cases=[]
    coords_list=[[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],
                 [[10,-7,3],[0,1,0],[-1,0,0],[0,0,2]],
                 [[.2,-.3,.5],[1,2,3],[0,-1,2],[.5,0,-2]]]
    source,coordinate,output,stack=0x1000,0x2000,0x3000,0x4000
    for coords in coords_list:
        point=vector([2,-5,7])
        for mode,(a,b) in {'point':(0xf51e,0xf581),'vector':(0xf5be,0xf615),
                            'transpose':(0xf684,0xf6cf),'pivot':(0xf6f7,0xf760)}.items():
            memory={source+i*4:v for i,v in enumerate(point)}
            memory.update({coordinate+i*4:f32(v) for i,v in enumerate(sum(coords,[]))})
            memory[stack+4]=memory[stack+0x10]=output
            evaluator=LinearX87(memory,{'esi':source,'edx':coordinate,'edi':output,'ecx':source,'eax':output,'esp':stack})
            evaluator.run(core.dis.disasm(core.data[a:b],core.base+a))
            actual=[evaluator.memory[output+i*4] for i in range(3)]
            assert actual == core_coordinate_transform(coords,point,mode)
            assert evaluator.stack == []
            cases.append({'namedMethod':mode,'coords':coords,'point':point,'result':actual})
    return {'engineInstructionAnchors':len(anchors),'coreSHA256':CORE_SHA,
            'engineRanges':[{'name':name,'startRVA':hex(a),'endRVA':hex(b),
                             'SHA256':hashlib.sha256(image.data[a:b]).hexdigest()}
                            for name,a,b in [('SkeletalMesh Serialize',0x3e61c0,0x3e6465),
                                             ('coordinate array serializer',0x3c3060,0x3c3154),
                                             ('coordinate component serializer',0x3af200,0x3af2b6)]],
            'coreMethodRanges':ranges,'actualCoreArithmeticCases':cases,
            'lookupPredicateCandidates':['FName::operator==','FName::operator!='],
            'rotationCandidates':['FCoords::operator*(FRotator)','FCoords::operator/(FRotator)'],
            'vectorCandidates':['TransformPointBy','TransformVectorBy','TransformVectorByTranspose','PivotTransform'],
            'engineImportTargetsVerified':False,
            'limits':'Surviving named Core arithmetic is proven independently; ABI compatibility does not bind any erased Engine call.'}


def source_evidence():
    sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'tools/dat')]
    from l2lib import Reader, load_package
    from uscript.extract_uscript import sources_from_package
    from parse_skillfx import parse_skill_usk, read_packed, decode_value
    from build_skillvfx import pack_action
    engine_path = ROOT / 'assets/interlude/system/Engine.u'
    skill_path = ROOT / 'assets/interlude/animations/Skill.usk'
    assert hashlib.sha256(engine_path.read_bytes()).hexdigest() == ENGINE_PACKAGE_SHA
    assert hashlib.sha256(skill_path.read_bytes()).hexdigest() == SKILL_PACKAGE_SHA
    package = load_package(str(engine_path))[0]
    owner = next(e for e in package.exports_by_class('Class')
                 if package.export_name(e) == 'SkillAction_LocateEffect')
    expected = [('AttachOn', 'ByteProperty', 0x3c, None),
                ('AttachBoneName', 'NameProperty', 0x40, None),
                ('bAbsolute', 'BoolProperty', 0x44, 1),
                ('SpawnDelay', 'FloatProperty', 0x48, None),
                ('bUseCharacterRotation', 'BoolProperty', 0x4c, 1),
                ('offset', 'StructProperty', 0x50, None),
                ('bRelativeToCylinder', 'BoolProperty', 0x5c, 1),
                ('bSpawnOnTarget', 'BoolProperty', 0x5c, 2),
                ('bSizeScale', 'BoolProperty', 0x5c, 4)]
    fields = [e for e in package.exports if e.package_index == owner.index + 1
              and package.class_name_of(e).endswith('Property')]
    assert [(package.export_name(e), package.class_name_of(e)) for e in fields] == [x[:2] for x in expected]
    evidence = []
    for i, (export, (name, kind, offset, mask)) in enumerate(zip(fields, expected)):
        raw = package.data[export.serial_offset:export.serial_offset + export.serial_size]
        r = Reader(raw)
        assert package.name(r.compact()) == 'None' and r.compact() == 0
        next_ref, dim, flags = r.compact(), r.u32(), r.u32()
        category = package.name(r.compact())
        assert dim == 1 and flags == 1
        if kind in ('ByteProperty', 'StructProperty'):
            target = package.ref_name(r.compact())[-1]
            assert target == ('EAttachMethod' if kind == 'ByteProperty' else 'Vector')
        assert r.pos == len(raw)
        assert package.ref_name(next_ref)[-1] == (expected[i+1][0] if i+1 < len(expected) else 'EAttachMethod')
        evidence.append({'name': name, 'kind': kind, 'nativeOffset': hex(offset), 'nativeMask': mask,
                         'export': export.index, 'SHA256': hashlib.sha256(raw).hexdigest()})
    source = next(text for name, text in sources_from_package(package) if name == 'SkillAction_LocateEffect')
    enum = re.search(r'enum\s+EAttachMethod\s*\{([^}]+)\}', source).group(1)
    enum = re.sub(r'//[^\n]*', '', enum)
    attach_names = re.findall(r'\bEAM_\w+\b', enum)
    assert attach_names == ['EAM_None', 'EAM_RH', 'EAM_LH', 'EAM_BoneSpecified',
                            'EAM_AliasSpecified', 'EAM_Trail', 'EAM_RF', 'EAM_LF']
    raw_class = package.data[owner.serial_offset:owner.serial_offset + owner.serial_size]
    assert hashlib.sha256(raw_class).hexdigest() == '83ee5b5ff2125253fc96dd5ef6572be4ee6fe3290137ff59268d6d71c277afc8'
    # Independently established unique declared-field terminal stream in the
    # pinned class. Re-read its bounded bytes; no generated JSON is an oracle.
    default_reader = Reader(raw_class[97:])
    defaults = {n: decode_value(package, *v) for n, v in read_packed(package, default_reader).items()}
    assert default_reader.pos == 5 and defaults == {'bRelativeToCylinder': True}
    skill = load_package(str(skill_path))[0]
    _, actions = parse_skill_usk(skill)
    assert len(actions) == 524
    records = []
    for ref, action in actions.items():
        # This checks transport of EVERY freshly decoded action flag, including
        # false relative defaults. The decoder and native property order remain
        # separately fingerprinted above.
        packed = pack_action(dict(action, sourceIndex=0), lambda _: 0)
        expected_flags = sum(bit for key, bit in [('onTarget', 1), ('onMultiTarget', 2),
                             ('sizeScale', 4), ('useCharRotation', 8), ('absolute', 16)] if action.get(key))
        if action.get('relativeToCylinder') is False:
            expected_flags |= 32
        assert packed.get('g', 0) == expected_flags
        assert packed.get('at', 0) == action.get('attachOn', 0)
        records.append((ref, action))
    counts = {'actions': len(actions), 'attach': dict(sorted(Counter(a.get('attachOn', 0) for a in actions.values()).items())),
              'relativeFalse': sum(a.get('relativeToCylinder') is False for a in actions.values()),
              'negativeSpawnDelay': sum(a.get('spawnDelay', 0) < 0 for a in actions.values()),
              'rawOffsetAndCharacterRotation': sum(bool(a.get('relativeToCylinder') is False and a.get('useCharRotation')
                 and any(a.get('offset', []))) for a in actions.values())}
    assert counts['relativeFalse'] == 31 and counts['negativeSpawnDelay'] == 0
    return {'enginePackageSHA256': ENGINE_PACKAGE_SHA, 'skillPackageSHA256': SKILL_PACKAGE_SHA,
            'declarationsAndGeneratedCopyLayout': evidence, 'attachNames': attach_names,
            'sourceTextSHA256': hashlib.sha256(source.encode()).hexdigest(),
            'classDefaultStreamSHA256': hashlib.sha256(raw_class[97:]).hexdigest(),
            'declaredDefaults': defaults, 'sourceCounts': counts,
            'actionCatalogSHA256': hashlib.sha256(json.dumps(records, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}


def verify():
    from check_tutorial_quest_native import Image, ENGINE_SHA
    from check_legacy_skill_effects_native import LinearX87, Dispatch
    from check_pawn_notify_native import IntegerSlice
    image = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    methods = {
        '?Notify@USkillAction_LocateEffect@@UAEPAVAEmitter@@PAVAActor@@0@Z': (0x1ec6f0, 0x1ecdbf),
        '??0USkillAction_LocateEffect@@QAE@ABV0@@Z': (0x559b0, 0x55a68),
        '?SetDrawScale@AActor@@QAEXM@Z': (0x22d780, 0x22d7d8),
        '?SetCollisionSize@AActor@@QAEXMM@Z': (0x22d650, 0x22d6ba),
        '?Serialize@ULodMesh@@UAEXAAVFArchive@@@Z': (0x2ddee0, 0x2ddfad),
        '?GetMagicInfo@APawn@@UAEPAUFNMagicInfo@@XZ': (0x42740, 0x42747),
        '?AttachToBone@AActor@@QAEHPAV1@VFName@@H@Z': (0x22e3e0, 0x22e4d7),
        '?GetAliasesTagBoneName@USkeletalMeshInstance@@QAE?AVFName@@V2@@Z': (0x3b4110, 0x3b41b2),
        '?GetAliasesTagCoords@USkeletalMeshInstance@@QAE?AVFCoords@@VFName@@@Z': (0x3b4050, 0x3b40df),
    }
    ranges = []
    for name, (a, b) in methods.items():
        assert image.exported(name, True) == image.base+a
        ranges.append({'method': name, 'startRVA': hex(a), 'endRVA': hex(b),
                       'SHA256': hashlib.sha256(image.data[a:b]).hexdigest()})
    anchors = [
        # Typed generated copy matches the complete original declared order.
        (0x559e6, 'mov', 'al, byte ptr [edi + 0x3c]'), (0x559ec, 'mov', 'ecx, dword ptr [edi + 0x40]'),
        (0x559f8, 'and', 'edx, 1'), (0x559fe, 'fld', 'dword ptr [edi + 0x48]'),
        (0x55a0a, 'and', 'eax, 1'), (0x55a10, 'mov', 'ecx, dword ptr [edi + 0x50]'),
        (0x55a16, 'mov', 'edx, dword ptr [edi + 0x54]'), (0x55a1f, 'mov', 'eax, dword ptr [edi + 0x58]'),
        (0x55a28, 'and', 'ecx, 1'), (0x55a36, 'and', 'eax, 2'), (0x55a43, 'and', 'edx, 4'),
        (0x1ec70a, 'test', 'byte ptr [edi + 0x5c], 2'), (0x1ec710, 'mov', 'esi, ebp'),
        (0x1ec71c, 'mov', 'esi, ebx'), (0x1ec759, 'test', 'esi, esi'), (0x1ec75b, 'je', '0x104ecd5c'),
        (0x1ec775, 'test', 'byte ptr [edi + 0x4c], 1'),
        (0x1ec77f, 'mov', 'eax, dword ptr [esi + 0x1c8]'),
        (0x1ec785, 'mov', 'ecx, dword ptr [esi + 0x1cc]'), (0x1ec78b, 'mov', 'edx, dword ptr [esi + 0x1d0]'),
        (0x1ec7e7, 'cmp', 'ebp, ebx'), (0x1ec7eb, 'fld', 'dword ptr [ebp + 0x1bc]'),
        (0x1ec7f5, 'fsub', 'dword ptr [ebx + 0x1bc]'),
        (0x1ec85a, 'test', 'byte ptr [edi + 0x5c], 1'), (0x1ec86c, 'je', '0x104ec916'),
        (0x1ec885, 'fld', 'dword ptr [esi + 0x2f0]'), (0x1ec893, 'fmul', 'dword ptr [ebp]'),
        (0x1ec89a, 'fld', 'dword ptr [edi + 0x54]'),
        (0x1ec8be, 'fld', 'dword ptr [eax + 0x98]'), (0x1ec8c4, 'fmul', 'dword ptr [edi + 0x58]'),
        (0x1ec8ca, 'fmul', 'dword ptr [esi + 0x27c]'),
        (0x1ec8d2, 'fld', 'dword ptr [esi + 0x2f4]'), (0x1ec8d8, 'fmul', 'dword ptr [edi + 0x58]'),
        (0x1ec8e1, 'fstp', 'dword ptr [esp + 0x50]'),
        (0x1ec916, 'mov', 'eax, dword ptr [edi + 0x50]'),
        (0x1ec919, 'mov', 'ecx, dword ptr [edi + 0x54]'), (0x1ec91c, 'mov', 'edx, dword ptr [edi + 0x58]'),
        (0x1ec935, 'cmp', 'byte ptr [edi + 0x3c], cl'), (0x1ec93c, 'mov', 'dword ptr [esp + 0x28], ecx'),
        (0x1ec94a, 'add', 'eax, 0x4e8'), (0x1ec951, 'lea', 'eax, [esi + 0x1bc]'),
        (0x1ec95f, 'fadd', 'dword ptr [esp + 0x34]'),
        (0x1ec9be, 'mov', 'ebp, dword ptr [ebx + 0xe4]'), (0x1ec9c9, 'push', 'edx'),
        (0x1eca0f, 'mov', 'edx, dword ptr [edi + 0x34]'), (0x1eca17, 'call', 'eax'),
        (0x1eca23, 'push', '0x10dadef0'), (0x1eca32, 'je', '0x104ecd5c'),
        (0x1eca4c, 'movzx', 'eax, byte ptr [edi + 0x3c]'), (0x1eca59, 'jmp', 'dword ptr [eax*4 + 0x104ecdc0]'),
        (0x1eca93, 'push', '0xa'), (0x1ecba0, 'push', '0'),
        (0x1ecaff, 'mov', 'eax, dword ptr [edi + 0x40]'),
        (0x1ecb2f, 'mov', 'edx, dword ptr [edx + 0x21c]'),
        (0x1ecb11, 'mov', 'edx, dword ptr [edx + 0x220]'),
        (0x1ecbe0, 'call', '0x1031075d'), (0x1ecc15, 'call', '0x1030f010'),
        (0x1ecccc, 'and', 'eax, 1'), (0x1eccd6, 'call', '0x10305f79'),
        (0x1eccdd, 'je', '0x104ecd47'), (0x1ecce3, 'fadd', 'dword ptr [esp + 0x54]'),
        (0x1eccf3, 'mov', 'dword ptr [esi + 0x1fc], edx'),
        (0x1ecd09, 'mov', 'dword ptr [esi + 0x200], eax'),
        (0x1ecd1b, 'mov', 'dword ptr [esi + 0x204], ecx'),
        (0x1ecd23, 'mov', 'eax, dword ptr [edx + 0x2b0]'),
        (0x1ecd31, 'je', '0x104ecd47'), (0x1ecd4f, 'mov', 'eax, dword ptr [edx + 0xac]'),
        (0x1ecd5a, 'call', 'eax'), (0x1ecd5c, 'xor', 'eax, eax'),
        (0x1ecdb1, 'mov', 'eax, esi'),
        (0x22d7d5, 'fstp', 'dword ptr [esi + 0x27c]'),
        (0x22d6ab, 'fstp', 'dword ptr [esi + 0x2f0]'), (0x22d6b4, 'fstp', 'dword ptr [esi + 0x2f4]'),
        (0x2ddf88, 'lea', 'edx, [esi + 0x90]'), (0x2ddf8f, 'lea', 'eax, [esi + 0x84]'),
        (0x22e3e7, 'mov', 'ecx, dword ptr [edi + 0x104]'), (0x22e3ef, 'je', '0x1052e4cd'),
        (0x22e420, 'call', '0x103017c6'), (0x22e425, 'cmp', 'eax, -1'),
        (0x22e428, 'jle', '0x1052e497'), (0x22e48a, 'mov', 'eax, 1'),
        (0x22e4ce, 'xor', 'eax, eax'),
        (0x3b4145, 'cmp', 'esi, dword ptr [edi + 0x31c]'),
        (0x3b4154, 'mov', 'ecx, dword ptr [edi + 0x318]'),
        (0x3b416a, 'mov', 'ecx, dword ptr [edi + 0x324]'),
        (0x3b4170, 'mov', 'edx, dword ptr [ebx + ecx]'),
        (0x3b40bf, 'mov', 'esi, dword ptr [edi + 0x330]'),
        (0x3b40c5, 'shl', 'eax, 4'), (0x3b40ce, 'mov', 'ecx, 0xc'),
        (0x3b40d5, 'rep movsd', 'dword ptr es:[edi], dword ptr [esi]'),
    ]
    for rva, op, args in anchors:
        image.instruction(image.base+rva, op, args)
    table = [image.u32(image.base+0x1ecdc0+i*4)-image.base for i in range(8)]
    assert table == [0x1ecb6d, 0x1ecb29, 0x1ecb0b, 0x1ecaff, 0x1ecbab, 0x1eca60, 0x1ecb5a, 0x1ecb47]
    slots = {}
    for cls, entries in [('AActor', [0x1c8, 0x21c, 0x220, 0x2b0]), ('ULevel', [0xac, 0xc0])]:
        vt = image.exported('??_7'+cls+'@@6BUObject@@@' if cls == 'ULevel' else '??_7'+cls+'@@6B@')
        for slot in entries:
            names = [name for name in image.exports if image.exported(name) == image.u32(vt+slot)]
            assert len(names) == 1
            slots[f'{cls}+{slot:x}'] = names[0]
    assert slots['ULevel+ac'].startswith('?DestroyActor@') and slots['ULevel+c0'].startswith('?SpawnActor@')
    assert slots['AActor+1c8'].startswith('?setPhysics@') and slots['AActor+2b0'].startswith('?GetMagicInfo@')
    assert image.exported('?MatchRefBone@USubSkeletalMeshInstance@@QAEHVFName@@@Z') == image.base+0x17c6
    erased = [(0x1ec73b, 'selected Pawn classification'), (0x1ec7ad, 'BaseActor projectile classification'),
              (0x1ec824, 'target delta to rotation'), (0x1ec877, 'relative offset zero predicate'),
              (0x1ec8a8, 'selected mesh classification'), (0x1b4280, 'mesh cast classification'),
              (0x1ec8f2, 'rotation coordinate construction'), (0x1ec902, 'relative vector transform'),
              (0x1eca2a, 'returned emitter classification'),
              (0x3b4160, 'alias name comparison'), (0x3b407e, 'alias coords name comparison')]
    for rva, _ in erased:
        assert image.data[rva:rva+6] == b'\x90'*6
    for value, name in [(0x10daf7d8, 'APawn'), (0x10bdd1d8, 'ANSkillProjectile'),
                        (0x10dd2d60, 'USkeletalMesh'), (0x10dadef0, 'AEmitter')]:
        assert image.exported('?PrivateStaticClass@'+name+'@@0VUClass@@A') == value
    # Evaluate actual call-free arithmetic, with no transform replacement.
    def native(parts, memory, registers):
        evaluator = LinearX87(memory, registers)
        for start, end in parts:
            evaluator.run(image.dis.disasm(image.data[start:end], image.base+start))
        return evaluator
    stack, actor, action, mesh = 0x1000, 0x2000, 0x3000, 0x4000
    cases = []
    for offset in [(1, 2, -1), (-.35, 19.25, .4), (0, 0, 0)]:
        for radius, height, origin, scale in [(9, 23, 23, 1), (15.5, 31, 45.25, .75), (0, 0, -3, 2)]:
            for skeletal in (False, True):
                memory = {actor+0x2f0:f32(radius), actor+0x2f4:f32(height), actor+0x27c:f32(scale),
                          mesh+0x98:f32(origin)}
                memory.update({action+0x50+i*4:f32(v) for i,v in enumerate(offset)})
                parts = [(0x1ec885,0x1ec88b),(0x1ec893,0x1ec8a1)]
                parts += [(0x1ec8be,0x1ec8c7),(0x1ec8ca,0x1ec8d0)] if skeletal else [(0x1ec8d2,0x1ec8db)]
                parts += [(0x1ec8e1,0x1ec8e5)]
                output = native(parts,memory,{'esi':actor,'edi':action,'ebp':action+0x50,'eax':mesh,'esp':stack})
                actual = [output.memory[stack+0x48+i*4] for i in range(3)]
                expected = relative_offset_input(offset,radius,height,skeletal=skeletal,mesh_origin_z=origin,draw_scale=scale)
                assert actual == expected
                cases.append({'kind':'relative-pre-transform','skeletal':skeletal,'offset':offset,'result':actual})
        memory = {action+0x50+i*4:f32(v) for i,v in enumerate(offset)}
        output = native([(0x1ec916,0x1ec933),(0x1ec938,0x1ec93c)],memory,{'edi':action,'esp':stack})
        actual = [output.memory[stack+0x34+i*4] for i in range(3)]
        assert actual == raw_offset(offset)
        cases.append({'kind':'raw-offset','offset':offset,'result':actual})
    for base, offset in [([100,-70,600],[9,2,-23]), ([-.3,.5,1.7],[.1,-.2,.4])]:
        memory={stack+0x34+i*4:f32(v) for i,v in enumerate(base)}
        memory.update({stack+0x54+i*4:f32(v) for i,v in enumerate(offset)})
        output=native([(0x1eccdf,0x1ecd21)],memory,{'esi':actor,'esp':stack})
        actual=[output.memory[actor+0x1fc+i*4] for i in range(3)]
        assert actual == added_location(base,offset)
        cases.append({'kind':'attached-relative-addition','result':actual})
    def decode(pc):
        return next(image.dis.disasm(image.data[pc-image.base:pc-image.base+16],pc))
    selection = IntegerSlice(decode,[(image.base+0x1ec70a,image.base+0x1ec71e)])
    for flags in range(8):
        for target in (0,0x9000):
            result=selection.run(image.base+0x1ec70a,{image.base+0x1ec71e},
                {'edi':action,'ebp':target,'ebx':actor,'esp':stack},{action+0x5c:flags})
            assert result['registers']['esi'] == (target if flags & 2 else actor)
    lookup_flow = Dispatch(decode,lambda *_: None,[(image.base+0x22e425,image.base+0x22e42a)])
    failure_flow = IntegerSlice(decode,[(image.base+0x1eccdb,image.base+0x1eccdf)])
    for index in (-2,-1,0,11):
        result=lookup_flow.run(image.base+0x22e425,index,{image.base+0x22e497,image.base+0x22e42a})
        assert result['target'] == image.base+(0x22e497 if index<=-1 else 0x22e42a)
    for attached in (0,1):
        result=failure_flow.run(image.base+0x1eccdb,{image.base+0x1ecd47,image.base+0x1eccdf},
                                {'eax':attached}, {})
        assert result['stop'] == image.base+(0x1ecd47 if attached==0 else 0x1eccdf)
    return {'tool':'Elbera Tools / original LocateEffect boundaries','engineSHA256':ENGINE_SHA,
            'source':source_evidence(),'instructionAnchors':len(anchors),'methodRanges':ranges,
            'playerAliases':player_alias_evidence(),
            'aliasAndCoordinateEvidence':alias_and_coordinate_evidence(image),
            'attachSwitchRVAs':list(map(hex,table)),'namedVirtualSlots':slots,
            'actualArithmeticCases':cases,'actualActorSelectionCases':16,
            'actualAttachmentFailureCases':6,
            'erasedImportBoundaries':[{'RVA':hex(rva),'role':role,'bound':False} for rva,role in erased],
            'limits':['Offset scaling results precede erased coordinate transformation; no guessed matrix is supplied.',
                      'Actor world Location and mesh classification must come from independently verified native state.',
                      'Float64 intermediates approximate bounded x87 cases; this is not universal extended-precision parity.',
                      'Attachment following, emitter delay/lifetime, size scale and returned projectile handling are separate.']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true')
    parser.add_argument('--output',type=Path,help='write the detailed private evidence receipt')
    args=parser.parse_args(); result=verify()
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(result,indent=2)+'\n')
    if args.check:
        print(f"PASS {result['instructionAnchors']} anchors, {len(result['methodRanges'])} pinned ranges, "
              f"{len(result['actualArithmeticCases'])} actual arithmetic cases, "
              f"{result['actualActorSelectionCases']} actor-selection cases, "
              f"{result['actualAttachmentFailureCases']} attachment-failure cases, 524 original packed actions")
        print(f"PASS {len(result['playerAliases']['models'])} exact primary-mesh alias tables, "
              f"{result['aliasAndCoordinateEvidence']['engineInstructionAnchors']} additional native anchors, "
              f"{len(result['aliasAndCoordinateEvidence']['actualCoreArithmeticCases'])} surviving Core arithmetic cases; "
              "erased lookup/transform targets remain unbound")
    else:
        print(json.dumps(result,indent=2))


if __name__ == '__main__':
    main()
