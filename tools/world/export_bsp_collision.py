#!/usr/bin/env python3
"""Elbera Tools: stage original UModel BSP records, never render glTF geometry.

python3 tools/world/export_bsp_collision.py 17_25 --check
python3 tools/world/export_bsp_collision.py 17_25 --stage tmp/restart-audit/bsp-17_25
python3 tools/world/export_bsp_collision.py 17_25 --check --native-binding-check

Default/check is read-only. --stage creates a NEW ignored directory under
tmp/restart-audit; no live scene adoption is implemented. Raw node/surface
flags retain their source bits without assigning collision semantics.
The prefix is decoded through RootOutside/Linked; the remaining render and
lightmap tail is fingerprinted, not exported or claimed decoded here.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
from l2lib import load_package, read_model, Reader, RF_HAS_STACK
from export_static_collision import qualified_ref

FORMAT = 'l2-bsp-collision-source-v1'
sha = lambda data: hashlib.sha256(data).hexdigest()


def native_binding_evidence(comparison_engine=None):
    """Optional original-input check; Capstone is loaded only on this path.

    The pinned supplement can name erased imports, not authenticate the vendor
    original or restore the owned image. No binary code is executed.
    """
    sys.path.insert(0, str(ROOT / 'tools/ui'))
    from check_tutorial_quest_native import Image, ENGINE_SHA
    from check_hair_attachment_native import compare_call_block
    from supplemental_pe import PEImage
    core_sha = '9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf'
    candidate_sha = '508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d'
    engine = Image(ROOT/'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    core = Image(ROOT/'assets/interlude/system/core.dll', core_sha)
    read = lambda va, n: bytes(engine.data[engine.offset(va):engine.offset(va)+n])
    anchors = [
        (0x105cf18c, 'cmp', 'eax, 0x17'), (0x105cf18f, 'jl', '0x105cf1ae'),
        (0x105cf19b, 'je', '0x105cf224'), (0x105cf1b8, 'je', '0x105cf29a'),
        (0x105cf224, 'mov', 'eax, dword ptr [edi + 0x4c]'),
        (0x105cf227, 'mov', 'dword ptr [ebp + 8], eax'),
        (0x105cf22a, 'mov', 'dword ptr [ebp - 0x18], eax'),
        (0x105cf244, 'call', '0x1030599d'), (0x105cf24d, 'call', '0x1030599d'),
        (0x105cf27c, 'cmp', 'ebx, dword ptr [edi + 0x4c]'), (0x105cf28d, 'call', '0x10312aa3'),
        (0x105cf29a, 'mov', 'eax, dword ptr [edi + 0x3c]'),
        (0x105cf2ba, 'call', '0x1030599d'), (0x105cf2c3, 'call', '0x1030599d'),
        (0x105cf2f2, 'cmp', 'ebx, dword ptr [edi + 0x3c]'),
        (0x105cf2f5, 'jge', '0x105cf1cb'), (0x105cf303, 'call', '0x10312698'),
        (0x105cf1cb, 'lea', 'edx, [edi + 0x78]'), (0x105cf1d0, 'call', '0x10313020'),
        (0x105cf1e2, 'jne', '0x105cf20a'), (0x105d0860, 'call', '0x1030f326'),
        (0x105d086e, 'lea', 'eax, [ebx + 0xc0]'), (0x105d0876, 'call', '0x10308788'),
        (0x105c98ea, 'mov', 'eax, dword ptr [eax + 0x18]'), (0x105c98ee, 'call', 'eax'),
        (0x1074dabe, 'call', 'esi'), (0x1074dac4, 'call', 'esi'),
        (0x1074daca, 'call', 'esi'), (0x1074dad0, 'call', 'esi'),
        (0x1074dad6, 'call', '0x1031460f'), (0x1074dadf, 'call', '0x1030599d'),
        (0x1074dae8, 'call', '0x1030599d'), (0x105ccdd2, 'jge', '0x105cce3b'),
        (0x10330049, 'push', '4'), (0x105c5e48, 'mov', 'ecx, dword ptr [eax + 0xc0]'),
        (0x105c5e9e, 'mov', 'edx, dword ptr [edx + 0x6c]'), (0x105c5ea1, 'call', 'edx')]
    for va, mnemonic, operands in anchors: engine.instruction(va, mnemonic, operands)
    named = [('?Serialize@ULevel@@UAEXAAVFArchive@@@Z', 0x105d0830),
             ('?Serialize@ULevelBase@@UAEXAAVFArchive@@@Z', 0x105cf150),
             ('??6@YAAAVFArchive@@AAV0@AAVFURL@@@Z', 0x1074da70)]
    for name, address in named:
        if engine.exported(name, True) != address: raise ValueError('native serializer identity mismatch')
    for stub, body in [(0x1030f326,0x105cf150),(0x10308788,0x105c98e0),
                       (0x1030599d,0x10330040),(0x10312aa3,0x10354a70),
                       (0x10312698,0x1033e5e0),(0x10313020,0x1074da70),(0x1031460f,0x105ccd70)]:
        engine.instruction(stub, 'jmp', hex(body))
    object_op = '??6ULinkerLoad@@EAEAAVFArchive@@AAPAVUObject@@@Z'
    if (core.exported(object_op, True) != 0x10113370 or
            core.u32(core.exported('??_7ULinkerLoad@@6BFArchive@@@')+0x18) != core.exported(object_op)):
        raise ValueError('ULinkerLoad object-reference virtual mismatch')
    core_anchors = [(0x101133a9,'call','0x10101f41'), (0x101133af,'call','0x10102315'),
                    (0x101133bd,'call','0x10102540'), (0x101133c8,'mov','dword ptr [edx], eax')]
    for va, mnemonic, operands in core_anchors: core.instruction(va, mnemonic, operands)
    for stub, name in [(0x10101f41,'?GetReader@ULinkerLoad@@QAEPAVFArchive@@XZ'),
                       (0x10102315,'??6@YAAAVFArchive@@AAV0@AAVFCompactIndex@@@Z'),
                       (0x10102540,'?IndexToObject@ULinkerLoad@@AAEPAVUObject@@H@Z')]:
        core.instruction(stub, 'jmp', hex(core.exported(name, True)))
    blocks = []
    if comparison_engine:
        candidate = PEImage(Path(comparison_engine), candidate_sha)
        for name, address in named:
            if candidate.body(name) != address-0x40: raise ValueError('supplemental serializer body mismatch')
        compact = '??6@YAAAVFArchive@@AAV0@AAVFCompactIndex@@@Z'
        string = '??6@YAAAVFArchive@@AAV0@AAVFString@@@Z'
        for label, lo, hi, delta, calls in [
            ('base version/transaction gate',0x105cf17a,0x105cf1be,-0x40,{
                0x105cf17e:'?Serialize@UObject@@UAEXAAVFArchive@@@Z',0x105cf186:'?LicenseeVer@FArchive@@QAEHXZ',
                0x105cf193:'?IsTrans@FArchive@@QAEHXZ',0x105cf1b0:'?IsTrans@FArchive@@QAEHXZ'}),
            ('first reference array',0x105cf224,0x105cf29a,-0x40,{
                0x105cf235:'?CountBytes@FArray@@QAEXAAVFArchive@@H@Z',0x105cf257:'?IsLoading@FArchive@@QAEHXZ'}),
            ('second reference array',0x105cf29a,0x105cf310,-0x40,{
                0x105cf2ab:'?CountBytes@FArray@@QAEXAAVFArchive@@H@Z',0x105cf2cd:'?IsLoading@FArchive@@QAEHXZ'}),
            ('URL then loading return',0x105cf1cb,0x105cf1f0,-0x40,{
                0x105cf1da:'?IsLoading@FArchive@@QAEHXZ',0x105cf1e6:'?IsSaving@FArchive@@QAEHXZ'}),
            ('derived model field',0x105d085c,0x105d087e,-0x40,{}),
            ('fixed DWORD serializer',0x10330040,0x10330058,0,{
                0x1033004e:'?ByteOrderSerialize@FArchive@@QAEAAV1@PAXH@Z'}),
            ('URL arguments',0x1074da98,0x1074dab8,-0x40,{}),
            ('URL serialization order',0x1074dabe,0x1074daed,-0x40,{}),
            ('URL option count',0x105ccda7,0x105ccdc1,-0x40,{
                0x105ccda9:'?IsLoading@FArchive@@QAEHXZ',0x105ccdb8:compact}),
            ('URL option value',0x105ccdeb,0x105ccdfb,-0x40,{0x105ccded:string})]:
            raw = read(lo,hi-lo)
            direct = [i.address-lo for i in engine.dis.disasm(raw,lo)
                      if i.mnemonic == 'call' and bytes(i.bytes)[:1] == b'\xe8']
            result = compare_call_block(raw,candidate.read(lo+delta,hi-lo),owned_va=lo,candidate_va=lo+delta,
                sites=[(a-lo,('core.dll',symbol)) for a,symbol in calls.items()],direct_calls=direct,imports=candidate.imports)
            blocks.append({'label':label,'range':[hex(lo),hex(hi)],**result})
        # Named FString binding loads the IAT into ESI rather than using FF15.
        if (read(0x1074dab8,2) != b'\x8b\x35' or candidate.read(0x1074da78,2) != b'\x8b\x35' or
                candidate.imports[candidate.u32(0x1074da7a)] != ('core.dll',string)):
            raise ValueError('URL FString IAT binding mismatch')
    return {'ownedEngineSHA256':ENGINE_SHA,'ownedCoreSHA256':core_sha,
            'instructionChecks':len(anchors)+len(core_anchors),'directBindings':10,
            'serializedField':'ULevel+0xc0','collisionField':'ULevel+0xc0',
            'comparisonEngineSHA256':candidate_sha if comparison_engine else None,'comparisons':blocks,
            'limits':['ordinary saved archive version123/licensee>=23; prefix only',
                      'owned erased archive imports identified only with explicit supplemental comparison',
                      'supplemental copy not vendor authenticated; no owned executable restoration',
                      'serialized pointer binding does not observe later runtime reassignment or loading']}


def level_model_binding(pkg):
    """Read the ordinary saved ULevel prefix through its actual Model reference.

    Owned Interlude ULevelBase::Serialize 105cf150 writes two fixed-count
    reference arrays (the first for LicenseeVer >= 23), then FURL. The derived
    ULevel::Serialize 105d086e passes field+c0 to the archive object-reference
    operator. This same field is the BSP receiver in MultiLineCheck105c5e48.
    The qualified supplemental import comparison is reproducible with
    --native-binding-check; no engine code is executed.

    This bounded reader admits the reviewed version123 ordinary saved-level
    layout, with an empty UObject property stream and canonical duplicate
    array counts. It does not decode the later ULevel tail, transaction archives,
    external Model imports, runtime reassignment or arbitrary Level subclasses.
    """
    if pkg.file_version != 123 or pkg.licensee_version < 23:
        raise ValueError('unsupported serialized Level layout (requires version123/licensee>=23)')
    levels = [e for e in pkg.exports if e.class_index and
              qualified_ref(pkg, e.class_index).lower() == 'engine.level']
    if len(levels) != 1:
        raise ValueError('expected exactly one qualified Engine.Level export')
    level = levels[0]
    if level.package_index != 0 or level.object_flags & RF_HAS_STACK:
        raise ValueError('unsupported Level outer or state-frame prefix')
    start, end = level.serial_offset, level.serial_offset + level.serial_size
    if start < 0 or level.serial_size <= 0 or end > len(pkg.data):
        raise ValueError('Level export outside package')
    raw = pkg.data[start:end]
    r = Reader(raw, path=str(pkg.path) + ':Level')
    spans = {}
    if pkg.name(r.compact()) != 'None':
        raise ValueError('unsupported nonempty Level property stream')
    spans['properties'] = [start, start+r.pos]
    arrays = []
    for field in ('0x48', '0x38'):
        begin = r.pos
        count, duplicate = r.i32(), r.i32()
        # Both words are initialized from ArrayNum in the writer. The loader
        # uses the first; noncanonical unequal pairs stay outside this reader.
        if count < 0 or count != duplicate or count > len(raw)-r.pos:
            raise ValueError('invalid or noncanonical Level actor-array counts')
        references = []
        for _ in range(count):
            value = r.compact()
            if value: pkg.resolve_ref(value)  # preserve legal null slots
            references.append(value)
        spans['array'+field] = [start+begin, start+r.pos]
        arrays.append({'nativeField': field, 'count': count, 'duplicateCount': duplicate,
                       'references': references})

    def string():
        size = r.compact()
        if size == 0: return
        width = 2 if size < 0 else 1
        value = r.bytes(abs(size)*width)
        if value[-width:] != bytes(width):
            raise ValueError('unterminated Level URL string')
        if width == 2: value[:-2].decode('utf-16-le', 'strict')

    begin = r.pos
    for _ in range(4): string()  # FURL +0,+c,+1c,+34
    options = r.compact()
    if options < 0 or options > len(raw)-r.pos:
        raise ValueError('invalid Level URL option count')
    for _ in range(options): string()
    r.i32(); r.i32()  # FURL +18 and +40, not world coordinates
    spans['url'] = [start+begin, start+r.pos]
    begin = r.pos
    reference = r.compact()
    if reference <= 0:
        raise ValueError('Level.Model must reference a local Model export')
    model = pkg.resolve_ref(reference)
    if (qualified_ref(pkg, model.class_index).lower() != 'engine.model' or
            model.serial_size <= 0):
        raise ValueError('Level.Model does not reference a serialized Engine.Model')
    spans['modelReference'] = [start+begin, start+r.pos]
    evidence = {'selection': 'serialized ULevel.Model', 'nativeField': '0xc0',
                'level': {'reference': level.index+1, 'qualified': qualified_ref(pkg, level.index+1)},
                'levelSerialOffset': start, 'levelSerialSize': level.serial_size,
                'levelSHA256': sha(raw), 'decodedPrefixSHA256': sha(raw[:r.pos]),
                'decodedPrefixBytes': r.pos, 'remainingTailBytes': len(raw)-r.pos,
                'remainingTailSHA256': sha(raw[r.pos:]), 'spans': spans,
                'actorArrays': arrays, 'urlOptionCount': options,
                'model': {'reference': reference, 'qualified': qualified_ref(pkg, reference)}}
    return model, evidence


def finite(values, size, label):
    if len(values) != size or not all(math.isfinite(v) for v in values):
        raise ValueError('nonfinite or malformed ' + label)


def index(value, size, label, nullable=False):
    if type(value) is not int or not (0 <= value < size or nullable and value == -1):
        raise ValueError('out-of-range ' + label)


def validate_graph(nodes):
    """Validate all three serialized links, rejecting cycles even off root0."""
    links = [(n.i_front, n.i_back, n.i_plane) for n in nodes]
    for row in links:
        for child in row: index(child, len(nodes), 'BSP child', nullable=True)
    colors = bytearray(len(nodes))
    reached = set()
    for root in range(len(nodes)):
        if colors[root]: continue
        stack = [(root, False)]
        while stack:
            current, leaving = stack.pop()
            if leaving:
                colors[current] = 2
                continue
            if colors[current] == 1: raise ValueError('cyclic BSP node graph')
            if colors[current] == 2: continue
            colors[current] = 1
            if root == 0: reached.add(current)
            stack.append((current, True))
            stack.extend((child, False) for child in reversed(links[current]) if child != -1)
    return len(reached)


def validate_model(model):
    reached = validate_graph(model.nodes)
    finite(model.bounds[0], 3, 'model minimum'); finite(model.bounds[1], 3, 'model maximum')
    if model.bounds[2] not in (0, 1): raise ValueError('invalid model bounds flag')
    if model.bounds[2] and any(a > b for a, b in zip(model.bounds[0], model.bounds[1])):
        raise ValueError('inverted model bounds')
    finite(model.bounding_sphere, 4, 'model sphere')
    if model.root_outside not in (0, 1): raise ValueError('unsupported RootOutside value')
    for v in model.points: finite(v, 3, 'point')
    for v in model.vectors: finite(v, 3, 'vector')
    used = set()
    for node in model.nodes:
        finite(node.plane, 4, 'node plane'); finite(node.exclusive_sphere, 4, 'node sphere')
        if abs(sum(v*v for v in node.plane[:3]) - 1) > .002:
            raise ValueError('non-unit node plane')
        if len(node.reserved) != 16: raise ValueError('invalid reserved node span')
        index(node.i_surf, len(model.surfs), 'node surface')
        if node.i_vert_pool < 0 or node.i_vert_pool + node.num_vertices > len(model.verts):
            raise ValueError('out-of-range node vertex span')
        for slot in range(node.i_vert_pool, node.i_vert_pool + node.num_vertices):
            index(model.verts[slot][0], len(model.points), 'active vertex point'); used.add(slot)
        for leaf in node.i_leaf: index(leaf, len(model.leaves), 'node leaf', nullable=True)
        for zone in node.i_zone: index(zone, len(model.zones), 'node zone')
    for surface in model.surfs:
        finite(surface.plane, 4, 'surface plane')
        if not math.isfinite(surface.light_map_scale): raise ValueError('nonfinite lightmap scale')
        index(surface.p_base, len(model.points), 'surface base point')
        for v in (surface.v_normal, surface.v_texture_u, surface.v_texture_v):
            index(v, len(model.vectors), 'surface vector')
    for bound in model.model_bounds:
        finite(bound[:6], 6, 'saved bounds')
        if bound[6] not in (0, 1): raise ValueError('invalid saved bounds flag')
        if bound[6] and any(a > b for a, b in zip(bound[:3], bound[3:6])):
            raise ValueError('inverted saved bounds')
    for leaf in model.leaves: index(leaf[0], len(model.zones), 'leaf zone')
    spans = model.source_spans
    cursor = model.export.serial_offset
    for name, (start, end) in spans.items():
        if start != cursor or end < start: raise ValueError('noncontiguous model source spans: ' + name)
        cursor = end
    if cursor != model.export.serial_offset + model.export.serial_size:
        raise ValueError('model source span does not end at export boundary')
    if spans['undecoded_tail'][1] - spans['undecoded_tail'][0] != model.lightmap_tail:
        raise ValueError('model tail span mismatch')
    return {'root0ReachableNodes': reached, 'unreachableNodes': len(model.nodes)-reached,
            'activeVertexSlots': len(used), 'unusedVertexSlots': len(model.verts)-len(used),
            # The original retains unused vertices that no longer index Points.
            # They are preserved, never followed or silently discarded.
            'unusedOutOfRangePointSlots': sum(i not in used and not 0 <= v[0] < len(model.points)
                                               for i, v in enumerate(model.verts)),
            'nodeFlagHistogram': dict(sorted(Counter(n.flags for n in model.nodes).items()))}


def export_model(pkg, model, tile, original_sha, protocol):
    selected, binding = level_model_binding(pkg)
    if selected.index != model.export.index:
        raise ValueError('provided BSP model differs from serialized Level.Model')
    checks = validate_model(model)
    export = model.export
    start, end = export.serial_offset, export.serial_offset + export.serial_size
    prefix_end = model.source_spans['undecoded_tail'][0]
    def ref(value):
        return None if value == 0 else {'reference': value, 'qualified': qualified_ref(pkg, value)}
    source = {'file': tile + '.unr', 'originalSHA256': original_sha,
              'decodedPackageSHA256': sha(pkg.data), 'protocol': protocol,
              'fileVersion': pkg.file_version, 'licenseeVersion': pkg.licensee_version,
              'levelBinding': binding,
              'model': ref(export.index + 1), 'modelExportIndex': export.index,
              'modelSerialOffset': start, 'modelSerialSize': export.serial_size,
              'modelSHA256': sha(pkg.data[start:end]), 'decodedPrefixBytes': prefix_end-start,
              'decodedPrefixSHA256': sha(pkg.data[start:prefix_end]),
              'unparsedTailBytes': end-prefix_end, 'unparsedTailSHA256': sha(pkg.data[prefix_end:end]),
              'spans': {key: list(span) for key, span in model.source_spans.items()}}
    nodes = [{ 'plane': n.plane, 'flags': n.flags, 'front': n.i_front, 'back': n.i_back,
               'planeChild': n.i_plane, 'surface': n.i_surf, 'vertexPool': n.i_vert_pool,
               'numVertices': n.num_vertices, 'zoneMask': f'{n.zone_mask:016x}',
               'zones': n.i_zone, 'leaves': n.i_leaf, 'collisionBound': n.i_collision_bound,
               'renderBound': n.i_render_bound, 'exclusiveSphere': n.exclusive_sphere,
               'reservedHex': n.reserved.hex(), 'section': n.i_section,
               'sectionVertexOffset': n.i_vert_offset, 'lightMap': n.i_light_map } for n in model.nodes]
    surfaces = [{'plane': s.plane, 'flags': s.flags, 'basePoint': s.p_base,
                 'normalVector': s.v_normal, 'textureU': s.v_texture_u, 'textureV': s.v_texture_v,
                 'brushPoly': s.i_brush_poly, 'actor': ref(s.actor), 'material': ref(s.material),
                 'lightMapScale': s.light_map_scale, 'lightmapIndex': s.i_lightmap_index} for s in model.surfs]
    result = {'tool': 'Elbera Tools', 'format': FORMAT, 'tile': tile,
              'coordinates': 'original L2 world units, Z up; no render filtering or basis conversion',
              'source': source, 'rootOutside': model.root_outside, 'linked': model.linked,
              'bounds': model.bounds, 'boundingSphere': model.bounding_sphere,
              'nodes': nodes, 'surfaces': surfaces, 'points': model.points, 'vectors': model.vectors,
              'vertices': model.verts, 'numSharedSides': model.num_shared_sides,
              'savedBounds': model.model_bounds, 'leafHulls': model.leaf_hulls,
              'leaves': [{'zone': z, 'permeating': p, 'volumetric': v, 'visibleZones': f'{mask:016x}'}
                         for z, p, v, mask in model.leaves],
              'zones': [{'actor': ref(a), 'connectivity': f'{c:016x}', 'visibility': f'{v:016x}',
                         'lastRenderTime': t} for a, c, v, t in model.zones],
              'lights': [ref(a) for a in model.lights], 'polys': ref(model.polys),
              'validation': checks,
              'limits': ['no collision flag interpretation or native trace implementation',
                         'collisionBound/leafHulls stream semantics are retained, not decoded',
                         'remaining render/lightmap tail is fingerprinted only',
                         'serialized Level.Model is bound; later runtime reassignment/loading is not observed']}
    # Also checks finite values in less frequently used serialized fields.
    json.dumps(result, allow_nan=False)
    return result


def stage_path(path):
    target = Path(path).resolve()
    try: target.relative_to((ROOT / 'tmp/restart-audit').resolve())
    except ValueError: raise ValueError('stage must be under ignored tmp/restart-audit') from None
    if target == (ROOT / 'tmp/restart-audit').resolve() or target.exists():
        raise ValueError('stage must be a new dedicated directory')
    ignored = subprocess.run(['git', 'check-ignore', '--quiet', str(target / 'bsp-collision.json')], cwd=ROOT)
    if ignored.returncode != 0: raise ValueError('stage is not gitignored')
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('tile')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='read-only validation (default)')
    mode.add_argument('--stage', help='new ignored directory, never a live scene output')
    parser.add_argument('--native-binding-check', action='store_true',
                        help='also check owned Engine/Core Level.Model anchors (requires Capstone)')
    parser.add_argument('--comparison-engine', help='explicit pinned supplemental Engine for erased archive import comparison')
    args = parser.parse_args()
    if args.comparison_engine and not args.native_binding_check:
        parser.error('--comparison-engine requires --native-binding-check')
    if not re.fullmatch(r'\d{2}_\d{2}', args.tile): parser.error('expected original tile name NN_NN')
    target = stage_path(args.stage) if args.stage else None
    path = ROOT / 'assets/interlude/maps' / (args.tile + '.unr')
    pkg, protocol = load_package(path)
    if pkg.file_version != 123: raise ValueError('only the reviewed file-version123 UModel layout is supported')
    model_export, _ = level_model_binding(pkg)
    model = read_model(pkg, model_export)
    data = export_model(pkg, model, args.tile, sha(path.read_bytes()), protocol)
    if args.native_binding_check:
        data['source']['levelBinding']['nativeEvidence'] = native_binding_evidence(args.comparison_engine)
    summary = {'tool': 'Elbera Tools', 'tile': args.tile, 'source': data['source'],
               'counts': {key: len(data[key]) for key in ('nodes', 'surfaces', 'points', 'vectors',
                                                        'vertices', 'savedBounds', 'leafHulls', 'leaves')},
               'validation': data['validation'], 'limits': data['limits']}
    if target:
        payload = json.dumps(data, separators=(',', ':'), allow_nan=False).encode()
        summary['outputSHA256'] = sha(payload)
        summary['outputBytes'] = len(payload)
        target.mkdir(parents=True, exist_ok=False)
        (target / 'bsp-collision.json').write_bytes(payload)
        (target / 'receipt.json').write_text(json.dumps(summary, indent=2) + '\n')
    output = {'tool': 'Elbera Tools', 'tile': args.tile, 'counts': summary['counts'],
              'levelModel': data['source']['levelBinding']['model'],
              'validation': summary['validation'], 'stage': str(target) if target else None}
    if args.native_binding_check:
        evidence = data['source']['levelBinding']['nativeEvidence']
        output['nativeBinding'] = {'instructionChecks': evidence['instructionChecks'],
                                  'comparisons': len(evidence['comparisons'])}
    print(json.dumps(output))


if __name__ == '__main__':
    main()
