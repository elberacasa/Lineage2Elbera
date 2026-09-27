#!/usr/bin/env python3
"""Elbera Tools: original player hair tables, materials and unmodified LOD0 data.

No rigid-head repair, skin-weight normalization, geometry welding or guessed
material fallback is used. Outputs are private derived inputs, not source code.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import tempfile
from collections import Counter
import os

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools', 'tools/ui', 'tools/src/char_pipeline')]
from l2lib import load_package, textures
from l2lib import ue2package as up
from build_appearance import exact_file, unique

FORMAT = 'l2-interlude-player-hair-v1'
OUTPUT = ROOT / 'assets/gamedata/hair.json'
ASSETS = ROOT / 'editor/characters/hair'
BYTE_PROPERTIES = {'Format', 'UBits', 'VBits', 'AlphaRef', 'FrameBufferBlending', 'UClampMode', 'VClampMode'}
INT_PROPERTIES = {'USize', 'VSize', 'UClamp', 'VClamp', 'InternalTime'}
BOOL_PROPERTIES = {'bMasked', 'bAlphaTexture', 'bTwoSided', 'AlphaTest', 'ZWrite', 'ZTest', 'TwoSided', 'TreatAsTwoSided'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()


def qualified(package, export, package_name):
    names, seen = [package.export_name(export)], set()
    parent = export.package_index
    while parent:
        if parent < 0 or parent in seen or parent > len(package.exports):
            raise ValueError('invalid original object outer chain')
        seen.add(parent)
        outer = package.exports[parent - 1]
        names.insert(0, package.export_name(outer))
        parent = outer.package_index
    return package_name + '.' + '.'.join(names)


def object_reference(package, reference):
    names, seen, last_import = [], set(), False
    while reference:
        if reference in seen:
            raise ValueError('cyclic original object reference')
        seen.add(reference)
        item = package.resolve_ref(reference)
        last_import = reference < 0
        names.append(package.import_name(item) if last_import else package.export_name(item))
        reference = item.package_index
    if not names:
        return None
    if not last_import:
        names.append(Path(package.path).stem)
    return '.'.join(reversed(names))


class Sources:
    def __init__(self):
        self.cache, self.receipts = {}, {}

    def get(self, directory, name):
        key = (directory, name.casefold())
        if key not in self.cache:
            suffix = '.ukx' if directory == 'animations' else '.utx'
            path = exact_file(ROOT / 'assets/interlude' / directory, name + suffix)
            self.cache[key], _ = load_package(str(path))
            self.receipts[str(path.relative_to(ROOT))] = sha(path.read_bytes())
        return self.cache[key]


def read_material_properties(package, reader):
    """Strict scalar subset of the original packed property format.

    Unlike a dictionary-only reader, duplicates and array tags cannot silently
    replace a source value. Extra properties require explicit decoder support.
    """
    result = {}
    while True:
        name = package.name(reader.compact())
        if name == 'None':
            return result
        if name in result and name != 'InternalTime':
            raise ValueError('duplicate original material property: ' + name)
        info = reader.u8()
        kind, size_selector, array = info & 15, (info >> 4) & 7, bool(info & 128)
        expected = (1 if name in BYTE_PROPERTIES else 2 if name in INT_PROPERTIES else
                    3 if name in BOOL_PROPERTIES else 5 if name == 'Material' else None)
        if expected is None or kind != expected or (kind != 3 and array and name != 'InternalTime'):
            raise ValueError('unsupported original material property type/array: ' + name)
        sizes = {0: 1, 1: 2, 2: 4, 3: 12, 4: 16}
        size = sizes[size_selector] if size_selector in sizes else (reader.u8() if size_selector == 5 else
               reader.u16() if size_selector == 6 else reader.u32())
        array_index = 0
        if kind != 3 and array:
            array_index = reader.u8()
            if array_index >= 128:
                raise ValueError('unsupported material array index encoding')
        if kind == 3:
            if size != 0:
                raise ValueError('original material boolean must have zero payload size')
            result[name] = array
        else:
            if kind in (1, 2, 4) and size != (1 if kind == 1 else 4):
                raise ValueError('wrong original material scalar width: ' + name)
            raw = reader.bytes(size)
            if name == 'InternalTime':
                elements = result.setdefault(name, {})
                if array_index not in (0, 1) or array_index in elements:
                    raise ValueError('duplicate/unsupported original InternalTime element')
                elements[array_index] = raw
            else:
                result[name] = raw


def material_graph(sources, reference, nodes, requested=None):
    """Retain the entire serialized property stream; bind only exact references.

    Top-level native references omit a group. Their unique package-leaf join is
    stated explicitly; this is not a proof of the erased native group resolver.
    """
    package_name, leaf = reference.split('.', 1)
    package = sources.get('systextures', package_name)
    export = requested or unique([e for e in package.exports
        if package.export_name(e).casefold() == leaf.casefold()
        and package.class_name_of(e) != 'Package'], 'hair material ' + reference)
    key = qualified(package, export, package_name)
    if key in nodes:
        return key
    reader = up.Reader(memoryview(package.data)[:export.serial_offset + export.serial_size], export.serial_offset)
    start = reader.pos
    props = read_material_properties(package, reader)
    values = {}
    node = {'class': package.class_name_of(export), 'properties': values,
            'propertyStreamSHA256': sha(package.data[start:reader.pos]),
            'sourceExportSHA256': sha(package.data[export.serial_offset:export.serial_offset + export.serial_size])}
    nodes[key] = node
    for name, raw in props.items():
        if isinstance(raw, bool):
            values[name] = raw
        elif name == 'InternalTime':
            values[name] = {'elements': {str(i): {'raw': value.hex()} for i, value in raw.items()}}
        elif name == 'Material':
            r = up.Reader(raw)
            ref = r.compact()
            if r.pos != len(raw):
                raise ValueError('trailing material object reference bytes')
            target = package.resolve_ref(ref)
            if not isinstance(target, up.Export):
                raise ValueError('external/null hair material child is not admitted')
            values[name] = {'reference': material_graph(sources, package_name + '.' + package.export_name(target), nodes, target)}
        else:
            values[name] = {'raw': raw.hex()}
    return key


def typed_properties(props):
    result = {}
    for name, value in props.items():
        if isinstance(value, bool) or name == 'Material':
            result[name] = value
            continue
        if name == 'InternalTime':
            result[name] = {i: struct.unpack('<i', bytes.fromhex(item['raw']))[0]
                            for i, item in value['elements'].items()}
            continue
        raw = bytes.fromhex(value['raw'])
        if name in BYTE_PROPERTIES:
            if len(raw) != 1:
                raise ValueError('invalid original material byte property: ' + name)
            result[name] = raw[0]
        elif name in INT_PROPERTIES:
            if len(raw) != 4:
                raise ValueError('invalid original material scalar property: ' + name)
            result[name] = struct.unpack('<i', raw)[0]
        else:
            # Unknown serialized fields remain visible for strict admission.
            result[name] = value
    return result


def source_lod0(package, export):
    """Read bounded version-5 L2 raw section/vertex streams and RefSkeleton.

    Each lazy array is checked against its absolute serialized end. Original
    indices, normals, UVs, local bone maps and all four weights are preserved.
    Layout: original package framing; independently compared with UEViewer's
    FStaticLODModel/FLineageWedge/FMeshBone serializers, not assembled output.
    """
    from export_npc_visuals import original_mesh_scale
    if (package.file_version, package.licensee_version) not in ((123, 28), (123, 30)):
        raise ValueError('unsupported original skeletal archive version')
    scale, version, offset = original_mesh_scale(package, export)
    if version != 5:
        raise ValueError('unsupported original skeletal mesh version')
    end = export.serial_offset + export.serial_size
    if not 0 <= export.serial_offset < end <= len(package.data) or not export.serial_offset <= offset <= end - 36:
        raise ValueError('source skeletal export/transform bounds invalid')
    r = up.Reader(memoryview(package.data)[:end], offset)

    def count():
        n = r.compact()
        if not 0 <= n <= 1000000:
            raise ValueError('invalid original skeletal array count')
        return n

    def array(size):
        n = count()
        return r.bytes(n * size), n

    def lazy(size):
        saved_end = r.i32()
        data, n = array(size)
        if saved_end != r.pos or not export.serial_offset <= saved_end <= end:
            raise ValueError('original skeletal lazy-array boundary mismatch')
        return {'count': n, 'SHA256': sha(data), 'savedEnd': saved_end}

    transform = {'scale': list(struct.unpack('<3f', r.bytes(12))),
                 'origin': list(struct.unpack('<3f', r.bytes(12))),
                 'rotOrigin': list(struct.unpack('<3i', r.bytes(12)))}
    for size in (2, 8, 2, 10):
        array(size)
    material_data, material_count = array(8)
    material_slots = [dict(zip(('polyFlags', 'textureIndex'), struct.unpack_from('<Ii', material_data, i * 8)))
                      for i in range(material_count)]
    r.bytes(24); r.i32(); r.compact(); r.bytes(52); r.f32(); r.i32()
    array(12)
    bones = []
    for _ in range(count()):
        name = package.name(r.compact())
        flags = r.u32()
        orientation = list(struct.unpack('<4f', r.bytes(16)))
        position = list(struct.unpack('<3f', r.bytes(12)))
        length = r.f32()
        size = list(struct.unpack('<3f', r.bytes(12)))
        children, parent = r.i32(), r.i32()
        bones.append({'name': name, 'flags': flags, 'orientation': orientation,
                      'position': position, 'length': length, 'size': size,
                      'children': children, 'parent': parent})
    animation_ref, skeletal_depth = r.compact(), r.i32()
    for _ in range(count()):
        array(2); r.i32()
    array(4)
    for _ in range(2):
        for _ in range(count()):
            package.name(r.compact())
    array(48)
    lod_count = count()
    if not 0 < lod_count < 10:
        raise ValueError('invalid original LOD count')
    start = r.pos
    array(4); array(16); num_soft_wedges = r.i32()
    section_sets = []
    for _ in range(2):
        sections = []
        for _ in range(count()):
            values = struct.unpack('<9H', r.bytes(18))
            raw, n = array(4)
            sections.append(dict(zip(('material', 'minStream', 'minWedge', 'maxWedge', 'numStream',
                'bone', 'unused', 'firstFace', 'numFaces'), values), boneMap=list(struct.unpack('<' + str(n) + 'i', raw))))
        section_sets.append(sections)
    indices = []
    for _ in range(2):
        raw, n = array(2)
        indices.append(list(struct.unpack('<' + str(n) + 'H', raw)))
        r.i32()
    stream_header = r.bytes(12)
    rigid, nr = array(32)
    lazy_arrays = [lazy(size) for size in (8, 10, 8, 12)]
    r.bytes(24)
    use_new_wedges = r.i32()
    soft, ns = array(52)
    if bool(ns) == bool(nr):
        raise ValueError('mixed/empty original LOD0 vertex streams require separate support')
    vertices = []
    source, stride, n = (soft, 52, ns) if ns else (rigid, 32, nr)
    for i in range(n):
        data = source[i * stride:(i + 1) * stride]
        values = struct.unpack_from('<8f', data)
        vertex = {'position': list(values[:3]), 'normal': list(values[3:6]), 'uv': list(values[6:8])}
        if ns:
            vertex.update(localBones=list(data[32:36]), weights=list(struct.unpack_from('<4f', data, 36)))
        vertices.append(vertex)
    result = {'format': 'l2-interlude-hair-lod0-v1', 'name': package.export_name(export),
              'transform': transform, 'bones': bones, 'animationReference': animation_ref,
              'skeletalDepth': skeletal_depth, 'sourceLodCount': lod_count,
              'stream': 'soft' if ns else 'rigid', 'vertices': vertices,
              'softSections': section_sets[0], 'rigidSections': section_sets[1],
              'softIndices': indices[0], 'rigidIndices': indices[1],
              'numSoftWedges': num_soft_wedges, 'useNewWedges': use_new_wedges,
              'streamHeaderHex': stream_header.hex(), 'lazyArrays': lazy_arrays,
              'materialSlots': material_slots,
              'sourceLOD0': {'start': start, 'end': r.pos,
                             'SHA256': sha(package.data[start:r.pos])},
              'sourceExportSHA256': sha(package.data[export.serial_offset:end])}
    validate_lod0(result)
    return result


def source_texture_slots(package, export, mesh):
    """Independently cross-check ULodMesh material indices and exact object refs."""
    end = export.serial_offset + export.serial_size
    reader = up.Reader(memoryview(package.data)[:end], export.serial_offset)
    properties = up.read_properties(package, reader, fmt='packed')
    if properties:
        raise ValueError('source hair mesh has unadmitted object property overrides')
    reader.bytes(41)
    if reader.i32() != 5 or reader.i32() < 0:
        raise ValueError('unverified source hair ULodMesh prefix')
    count = reader.compact()
    if not 0 <= count <= 1000000:
        raise ValueError('invalid source hair vertex-prefix count')
    reader.bytes(count * 4)
    count = reader.compact()
    if not 0 <= count <= 256:
        raise ValueError('invalid source hair texture count')
    references = [object_reference(package, reader.compact()) for _ in range(count)]
    _, _, indices = up.mesh_material_slots(package, export)
    if indices != [m['textureIndex'] for m in mesh['materialSlots']] or any(
            not 0 <= i < len(references) for i in indices):
        raise ValueError('independent original material slot decoder disagrees')
    return references


def validate_lod0(mesh):
    bones, vertices = mesh['bones'], mesh['vertices']
    if not bones or not vertices:
        raise ValueError('empty source hair skeleton/vertices')
    for i, bone in enumerate(bones):
        if not isinstance(bone['parent'], int) or not 0 <= bone['parent'] <= i or (i and bone['parent'] == i):
            raise ValueError('invalid source hair skeleton parent')
        if not all(math.isfinite(v) for v in bone['orientation'] + bone['position']):
            raise ValueError('nonfinite source hair bind pose')
    ownership = [None] * len(vertices)
    for kind in ('soft', 'rigid'):
        sections, indices = mesh[kind + 'Sections'], mesh[kind + 'Indices']
        if sections and mesh['stream'] != kind:
            raise ValueError('section/vertex stream mismatch')
        used = set()
        for si, section in enumerate(sections):
            if not 0 <= section['material'] < len(mesh['materialSlots']):
                raise ValueError('source section refers outside material slots')
            first, stop = section['firstFace'] * 3, (section['firstFace'] + section['numFaces']) * 3
            if not 0 <= first <= stop <= len(indices) or any(i in used for i in range(first, stop)):
                raise ValueError('overlapping/out-of-range source triangle section')
            used.update(range(first, stop))
            for vi in indices[first:stop]:
                if not 0 <= vi < len(vertices) or not section['minWedge'] <= vi <= section['maxWedge']:
                    raise ValueError('source triangle index outside section vertices')
                if ownership[vi] not in (None, si):
                    raise ValueError('source vertex belongs to conflicting bone maps')
                ownership[vi] = si
        if used != set(range(len(indices))):
            raise ValueError('unclaimed original triangle indices')
    if any(si is None for si in ownership):
        raise ValueError('unreferenced original hair vertices')
    sections = mesh[mesh['stream'] + 'Sections']
    for vi, vertex in enumerate(vertices):
        if not all(math.isfinite(v) for v in vertex['position'] + vertex['normal'] + vertex['uv']):
            raise ValueError('nonfinite original hair vertex')
        section = sections[ownership[vi]]
        if mesh['stream'] == 'rigid':
            joint_weights = [[section['bone'], 1.0]]
        else:
            joint_weights = []
            for local, weight in zip(vertex['localBones'], vertex['weights']):
                if not math.isfinite(weight) or weight < 0:
                    raise ValueError('invalid original hair skin weight')
                if local == 255:
                    if weight != 0:
                        raise ValueError('sentinel bone has a nonzero source weight')
                    continue
                if not 0 <= local < len(section['boneMap']):
                    raise ValueError('original hair local bone outside map')
                joint_weights.append([section['boneMap'][local], weight])
        if not joint_weights or any(not 0 <= joint < len(bones) for joint, _ in joint_weights):
            raise ValueError('original hair skin joint outside skeleton')
        vertex['sourceInfluences'] = joint_weights


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def accessor(gltf, buffers, index):
    ac = gltf['accessors'][index]
    if ac.get('sparse') or ac.get('normalized'):
        raise ValueError('unsupported built hair accessor')
    fmt, size = {5126: ('f', 4), 5123: ('H', 2), 5125: ('I', 4), 5121: ('B', 1)}[ac['componentType']]
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[ac['type']]
    view = gltf['bufferViews'][ac['bufferView']]
    offset, stride = ac.get('byteOffset', 0), view.get('byteStride', width * size)
    if stride < width * size or offset + max(0, ac['count'] - 1) * stride + width * size > view['byteLength']:
        raise ValueError('built hair accessor outside buffer view')
    raw = buffers[view['buffer']]
    start = view.get('byteOffset', 0) + offset
    if view.get('byteOffset', 0) + view['byteLength'] > len(raw):
        raise ValueError('built hair buffer view outside buffer')
    return [tuple(struct.unpack_from('<' + str(width) + fmt, raw, start + i * stride)) for i in range(ac['count'])]


def source_vertex_key(vertex):
    x, y, z = vertex['position']
    return (f32(x * .01), f32(z * .01), f32(y * .01), *vertex['uv'])


def triangle_key(vertices):
    """Cyclic rotation is irrelevant; reversed winding is not."""
    return min(tuple(vertices[i:] + vertices[:i]) for i in range(3))


def original_bone_paths(bones):
    paths = []
    for i, bone in enumerate(bones):
        path = () if bone['parent'] == i else paths[bone['parent']]
        paths.append((*path, bone['name'].casefold()))
    return paths


def built_bone_paths(gltf):
    parents = {}
    for i, node in enumerate(gltf['nodes']):
        for child in node.get('children', []):
            if child in parents:
                raise ValueError('multiply parented built bone')
            parents[child] = i
    cache = {}
    def path(i, seen):
        if i in seen:
            raise ValueError('cyclic built skeleton')
        if i not in cache:
            parent = path(parents[i], seen | {i}) if i in parents else ()
            cache[i] = (*parent, gltf['nodes'][i].get('name', '').casefold())
        return cache[i]
    return [path(i, set()) for i in range(len(gltf['nodes']))]


def built_binding(gltf, buffers, source):
    """Check actual source triangles/UV and audit (never silently bless) skinning."""
    mi, mesh = unique([(i, mesh) for i, mesh in enumerate(gltf['meshes'])
        if mesh.get('name') == source['name']], 'built hair mesh')
    node = unique([n for n in gltf['nodes'] if n.get('mesh') == mi], 'built hair node')
    if node.get('name') != source['name'] or 'skin' not in node:
        raise ValueError('unbound built hair node')
    skin = gltf['skins'][node['skin']]
    source_paths, built_paths = original_bone_paths(source['bones']), built_bone_paths(gltf)
    sections = source[source['stream'] + 'Sections']
    indices = source[source['stream'] + 'Indices']
    if len(mesh['primitives']) != len(sections):
        raise ValueError('built hair/source section count differs')
    bindings, mismatch, checked = [], 0, 0
    expected_influences = {}
    for vertex in source['vertices']:
        expected_influences.setdefault(source_vertex_key(vertex), set()).add(tuple(sorted(
            (source_paths[joint], weight) for joint, weight in vertex['sourceInfluences'] if weight)))
    for pi, (primitive, section) in enumerate(zip(mesh['primitives'], sections)):
        if primitive.get('mode', 4) != 4:
            raise ValueError('built hair primitive is not triangles')
        attrs = primitive['attributes']
        positions, uvs = accessor(gltf, buffers, attrs['POSITION']), accessor(gltf, buffers, attrs['TEXCOORD_0'])
        joints, weights = accessor(gltf, buffers, attrs['JOINTS_0']), accessor(gltf, buffers, attrs['WEIGHTS_0'])
        if len({len(positions), len(uvs), len(joints), len(weights)}) != 1:
            raise ValueError('built hair attribute lengths differ')
        keys = [(*position, *uv) for position, uv in zip(positions, uvs)]
        built_indices = [v[0] for v in accessor(gltf, buffers, primitive['indices'])]
        if len(built_indices) % 3 or any(i >= len(keys) for i in built_indices):
            raise ValueError('invalid built hair triangle indices')
        first, stop = section['firstFace'] * 3, (section['firstFace'] + section['numFaces']) * 3
        expected = Counter(triangle_key([source_vertex_key(source['vertices'][vi]) for vi in indices[i:i+3]])
                           for i in range(first, stop, 3))
        actual = Counter(triangle_key([keys[vi] for vi in built_indices[i:i+3]]) for i in range(0, len(built_indices), 3))
        if actual != expected:
            raise ValueError('built hair triangle position/UV/winding differs from original LOD0')
        for key, jj, ww in zip(keys, joints, weights):
            observed = tuple(sorted((built_paths[skin['joints'][j]], w) for j, w in zip(jj, ww) if w))
            checked += 1
            mismatch += observed not in expected_influences[key]
        material = gltf['materials'][primitive['material']]
        if any(p.get('material') == primitive['material'] for j, m in enumerate(gltf['meshes']) if j != mi for p in m['primitives']):
            raise ValueError('built hair material shared with another part')
        source_material = source['materialSlots'][section['material']]
        if source_material['textureIndex'] != 0 or source_material['polyFlags'] != 0:
            raise ValueError('hair layer-zero override requires original unmodified texture slot zero')
        bindings.append({'primitiveIndex': pi, 'materialIndex': primitive['material'],
                         'materialName': material['name'], 'sourceMaterialSlot': section['material'],
                         'sourceTextureIndex': source_material['textureIndex']})
    return {'nodeName': node['name'], 'meshIndex': mi, 'skinIndex': node['skin'], 'materials': bindings,
            'geometryProof': 'original LOD0 triangle POSITION/UV/winding multiset equality',
            'skinProof': {'status': 'source-influences-match' if mismatch == 0 else 'built-influences-differ',
                          'checkedVertices': checked, 'differentInfluenceVertices': mismatch,
                          'limits': ['name/parent-path and exact weight comparison; bind matrices/pose remain separate']}}


def collect():
    from check_hair_selection_native import verify
    from check_cast_sound_native import model_voice_source
    proof = verify()
    join = model_voice_source()['modelMeshTypes']
    sources, meshes, nodes, models = Sources(), {}, {}, {}
    for model_id, native_row in join.items():
        row = proof['rows'][native_row]
        package = sources.get('animations', row['meshPackage'])
        slots = []
        for style, pair in enumerate(row['pairs']):
            parts = []
            for part, index in enumerate(pair, 1):
                if index == -1:
                    parts.append({'part': part, 'nativeSlot': 5 if part == 1 else 4, 'status': 'source-absent'})
                    continue
                reference = proof['templates']['mesh' + str(part)] % (row['meshPackage'], row['prefix'], index)
                if reference not in meshes:
                    export = unique([e for e in package.exports_by_class('SkeletalMesh')
                        if package.export_name(e).casefold() == reference.split('.', 1)[1].casefold()
                        and e.package_index == 0], reference)
                    meshes[reference] = source_lod0(package, export)
                    meshes[reference]['textureReferences'] = source_texture_slots(package, export, meshes[reference])
                colors = []
                for color in range(4):
                    material = proof['templates']['texture' + str(part)] % (row['prefix'], row['prefix'], index, color)
                    key = material_graph(sources, material, nodes)
                    colors.append({'index': color, 'reference': material, 'material': key})
                parts.append({'part': part, 'nativeSlot': 5 if part == 1 else 4,
                              'status': 'source-present', 'mesh': reference, 'colors': colors})
            slots.append({'index': style, 'parts': parts})
        models[model_id] = {'nativeRow': native_row, 'slots': slots}
    from extract_charcreate import decrypt
    from check_hair_selection_native import keyed_hair_pairs
    with tempfile.TemporaryDirectory(prefix='elbera-hair-tables-') as temp:
        equipment_tables = {name: keyed_hair_pairs(decrypt(name, temp))
            for name in ('helmetgrp.dat', 'hairaccessarygrp.dat')}
    return {'format': FORMAT, 'proof': proof, 'sourcePackages': sources.receipts,
            'models': models, 'meshes': meshes, 'materials': nodes,
            'equipmentTables': equipment_tables,
            'limits': ['15 stored styles and four texture probes are not creation UI bounds',
                       'native shortened material group resolver is not bound; exact unique package-leaf join only',
                       'LOD0 raw source data; body attachment and renderer admission are separate gates']}, sources


def add_built_bindings(catalog):
    manifest = json.loads((ROOT / 'editor/characters/manifest.json').read_text())
    for model_id, model in catalog['models'].items():
        entry = unique([e for e in manifest['models'] if e['id'] == model_id], 'built player model')
        path = ROOT / 'editor/characters' / entry['gltf']
        data = path.read_bytes()
        gltf = json.loads(data)
        if any(Path(b['uri']).name != b['uri'] for b in gltf['buffers']):
            raise ValueError('nonlocal built player buffer')
        buffers = [(path.parent / b['uri']).read_bytes() for b in gltf['buffers']]
        model['built'] = {'gltf': entry['gltf'], 'gltfSHA256': sha(data),
                          'buffers': [{'uri': b['uri'], 'SHA256': sha(raw)} for b, raw in zip(gltf['buffers'], buffers)]}
        model['builtBindings'] = []
        for part in model['slots'][0]['parts']:
            if part['status'] == 'source-absent':
                continue
            binding = built_binding(gltf, buffers, catalog['meshes'][part['mesh']])
            binding.update(mesh=part['mesh'], nativeSlot=part['nativeSlot'], part=part['part'],
                           admission='material-only-existing-geometry')
            model['builtBindings'].append(binding)


def write_verified(path, data, check):
    if check:
        if not path.is_file() or path.read_bytes() != data:
            raise ValueError('private hair output differs from fresh original: ' + str(path))
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + '.tmp')
        temporary.write_bytes(data)
        os.replace(temporary, path)


def output_path(path):
    resolved = path.resolve()
    original = (ROOT / 'assets/interlude').resolve()
    if resolved == original or original in resolved.parents:
        raise ValueError('hair outputs must not replace original client inputs')
    return resolved


def write_assets(catalog, sources, asset_path, check):
    from check_hair_selection_native import hair_material_state
    # Assets are named by their decoded content, permitting exact pixel reuse
    # across duplicate source colors without changing the source identity map.
    with tempfile.TemporaryDirectory(prefix='elbera-hair-images-') as temp:
        png = Path(temp) / 'image.png'
        for key, node in catalog['materials'].items():
            node['typedProperties'] = typed_properties(node['properties'])
            if node['class'] != 'Texture':
                continue
            package_name = key.split('.', 1)[0]
            package = sources.get('systextures', package_name)
            export = unique([e for e in package.exports if qualified(package, e, package_name) == key], key)
            width, height, rgba, _ = textures.extract_texture_rgba(package, export)
            textures.write_png(str(png), width, height, rgba)
            data = png.read_bytes()
            filename = sha(data) + '.png'
            write_verified(asset_path / 'textures' / filename, data, check)
            node['image'] = {'url': '/characters/hair/textures/' + filename, 'SHA256': sha(data),
                             'rgbaSHA256': sha(rgba), 'width': width, 'height': height,
                             'proof': 'fresh original mip0 decode; no recoloring or alpha repair'}
        for key, node in catalog['materials'].items():
            child = None
            if node['class'] == 'FinalBlend':
                child_node = catalog['materials'][node['properties']['Material']['reference']]
                child = {'class': child_node['class'], 'properties': child_node['typedProperties']}
                node['image'] = child_node.get('image')
            node['renderState'] = hair_material_state(node['class'], node['typedProperties'], child)
    for reference, mesh in list(catalog['meshes'].items()):
        data = encode(mesh)
        filename = sha(data) + '.json'
        write_verified(asset_path / 'meshes' / filename, data, check)
        catalog['meshes'][reference] = {'url': '/characters/hair/meshes/' + filename,
            'SHA256': sha(data), 'sourceExportSHA256': mesh['sourceExportSHA256'],
            'sourceLOD0': mesh['sourceLOD0'], 'vertices': len(mesh['vertices']), 'bones': len(mesh['bones']),
            'sourceStream': mesh['stream'], 'transform': mesh['transform'],
            'attachmentStatus': 'unresolved-native-master-instance-binding',
            'format': mesh['format']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=OUTPUT)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--assets', type=Path, default=ASSETS)
    parser.add_argument('--source-only', action='store_true', help='diagnostic raw catalog; do not create image/mesh sidecars')
    args = parser.parse_args()
    args.output, args.assets = output_path(args.output), output_path(args.assets)
    catalog, sources = collect()
    add_built_bindings(catalog)
    if not args.source_only:
        write_assets(catalog, sources, args.assets, args.check)
    data = encode(catalog)
    write_verified(args.output, data, args.check)
    print(f"PASS Elbera Tools hair source: {len(catalog['models'])} models; "
          f"{len(catalog['meshes'])} meshes; {len(catalog['materials'])} material graph nodes")


if __name__ == '__main__':
    main()
