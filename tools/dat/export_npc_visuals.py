#!/usr/bin/env python3
"""Recover NPC visual scale from original class defaults and mesh packages.

No collision-size fitting, guessed default, or unqualified class-name fallback.
Missing classes/parents remain unresolved. Original inputs are only read.
Class defaults require tags matching the class's inherited declared fields.
Ambiguous maximal streams may supply visual fields only when all candidates
agree; every candidate remains hashed, with no selected boundary invented.
The native draw-transform rule is documented in native-actor-evidence.md.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import tempfile

from extract_gamedata import decrypt, parse_npcgrp, SYSTEM_DIR, OUT_DIR

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/src/char_pipeline'))
import uclass_defaults as defaults
import scale_util

FORMAT = 'l2-interlude-npc-visuals-v1'
PROPERTY_TYPES = {'ByteProperty': 'byte', 'IntProperty': 'int', 'BoolProperty': 'bool',
    'FloatProperty': 'float', 'ObjectProperty': 'object', 'NameProperty': 'name',
    'ClassProperty': 'class', 'ArrayProperty': 'array', 'StructProperty': 'struct',
    'StrProperty': 'str', 'MapProperty': 'map', 'FixedArrayProperty': 'fixedarray',
    'StringProperty': 'string'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def terminal_defaults(pkg, export, property_types):
    body = pkg.data[export.serial_offset:export.serial_offset + export.serial_size]
    candidates = []
    for start in range(len(body)):
        try:
            props, end = defaults._parse_packed(pkg, body, start)
        except (ValueError, IndexError, struct.error, UnicodeDecodeError, defaults.up.L2Error):
            continue
        # UClassProperty's saved defaults use an object-reference tag in
        # these original packages (e.g. Actor.MessageClass/Pawn.ControllerClass).
        # ClassProperty remains a typed field; arbitrary names/functions do not.
        if end == len(body) and all(property_types.get(name.casefold()) == kind
                or (property_types.get(name.casefold()) == 'class' and kind == 'object')
                for name, kind, _ in props):
            candidates.append((start, props))
    if not candidates:
        raise ValueError('no complete default-property stream')
    count = max(len(props) for _, props in candidates)
    best = [(start, props) for start, props in candidates if len(props) == count]
    start, props = best[0]
    evidence = {'exportOffset': export.serial_offset, 'exportLength': export.serial_size,
                'exportSHA256': sha(body), 'propertyCount': count}
    streams = [{'offset': at, 'length': len(body) - at, 'sha256': sha(body[at:])} for at, _ in best]
    evidence['defaultsCandidates'] = streams
    if len(best) != 1:
        visuals = [visual_properties(candidate) for _, candidate in best]
        if any(value != visuals[0] for value in visuals[1:]):
            raise ValueError('ambiguous visual default properties')
        # Original giant_spider has two equally long valid candidates; they
        # disagree on an unrelated leading property but both contain no visual
        # overrides. Preserve that ambiguity and resolve only the unanimous
        # visual fields, never select a boundary or export the other fields.
        evidence['defaultsBoundary'] = 'ambiguous-visual-consensus'
        return [p for p in props if p[0] in ('DrawScale', 'DrawScale3D')], evidence
    evidence.update(defaultsBoundary='unique-validated-candidate', defaultsOffset=start,
                    defaultsLength=len(body) - start, defaultsSHA256=sha(body[start:]))
    return props, evidence


def visual_properties(props):
    found = {}
    for name, kind, value in props:
        if name not in ('DrawScale', 'DrawScale3D'):
            continue
        if name in found:
            raise ValueError('duplicate visual property: ' + name)
        if name == 'DrawScale':
            if kind != 'float' or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError('invalid DrawScale')
        else:
            if kind != 'struct' or value[0] != 'Vector':
                raise ValueError('invalid DrawScale3D type')
            value = list(struct.unpack('<3f', bytes.fromhex(value[1])))
            if not all(math.isfinite(v) for v in value):
                raise ValueError('nonfinite DrawScale3D')
        found[name] = value
    return found


def original_mesh_scale(pkg, export):
    # Original ULodMesh::Serialize: UMesh bounds (FBox25 + FSphere16),
    # version, vertex count, uint32 vertex array, object texture array,
    # then MeshScale FVector. Pre-v2 has another array and is not accepted.
    r = pkg.body_reader(export)
    defaults.up.read_properties(pkg, r)
    r.bytes(25 + 16)
    version, vertex_count = r.i32(), r.i32()
    if version < 2 or vertex_count < 0:
        raise ValueError('unsupported native LodMesh serialization version')
    count = r.compact()
    if count < 0:
        raise ValueError('negative native mesh vertex-array length')
    r.bytes(4 * count)
    count = r.compact()
    if count < 0:
        raise ValueError('negative native mesh texture-array length')
    for _ in range(count):
        pkg.resolve_ref(r.compact())
    offset = r.pos
    scale = [r.f32(), r.f32(), r.f32()]
    if not all(math.isfinite(v) for v in scale):
        raise ValueError('nonfinite original MeshScale')
    return scale, version, offset


def resolve_visual(class_name, get_class):
    """Resolve both fields through exact qualified parents, retaining owners."""
    fields, owners, chain = {}, {}, []
    key = class_name
    seen = set()
    while key:
        if key.casefold() in seen:
            raise ValueError('cyclic class inheritance at ' + key)
        seen.add(key.casefold())
        node = get_class(key)
        if node is None:
            raise ValueError('missing class ' + key)
        chain.append(node['name'])
        for field, value in node['visual'].items():
            if field not in fields:
                fields[field], owners[field] = value, node['name']
        if len(fields) == 2:
            return {'drawScale': fields['DrawScale'], 'drawScale3D': fields['DrawScale3D'],
                    'fieldOwners': owners, 'classChain': chain}
        key = node['super']
    raise ValueError('unresolved visual properties for ' + class_name)


class OriginalClasses:
    def __init__(self):
        self.files = {p.stem.casefold(): p for p in Path(SYSTEM_DIR).glob('*.u')}
        self.packages, self.classes, self.sources, self.definitions = {}, {}, {}, {}
        self.failures = {}

    def get(self, qualified):
        key = qualified.casefold()
        if key in self.failures:
            raise ValueError(self.failures[key])
        try:
            return self._get(qualified)
        except ValueError as error:
            self.failures[key] = str(error)
            raise

    def _get(self, qualified):
        if qualified.casefold() in self.classes:
            return self.classes[qualified.casefold()]
        if qualified.count('.') != 1:
            return None
        package, name = qualified.split('.')
        source = self.files.get(package.casefold())
        if source is None:
            return None
        if source.stem not in self.packages:
            pkg = defaults.load(source.name)
            self.packages[source.stem] = pkg
            self.sources[source.name] = sha(source.read_bytes())
        pkg = self.packages[source.stem]
        matches = [e for e in pkg.exports if pkg.class_name_of(e) == 'Class'
                   and pkg.export_name(e).casefold() == name.casefold()]
        if len(matches) != 1:
            return None
        ex = matches[0]
        parent = pkg.ref_name(ex.super_index)
        canonical = source.stem + '.' + pkg.export_name(ex)
        parent_name = ((parent[0] or source.stem) + '.' + parent[1]) if parent else None
        property_types = self.property_types(canonical, set())
        props, evidence = terminal_defaults(pkg, ex, property_types)
        node = {'name': canonical, 'visual': visual_properties(props),
                'super': parent_name,
                'source': source.name, **evidence}
        self.classes[qualified.casefold()] = node
        return node

    def property_types(self, qualified, seen):
        """Only fields declared on this class or its exact ancestors qualify.

        Without this gate, bytes before the defaults can masquerade as
        package-name properties, or a continuation byte of a real field name
        can masquerade as a function name (observed on original Engine.Pawn).
        """
        key = qualified.casefold()
        if key in self.definitions:
            return self.definitions[key]
        if key in seen:
            raise ValueError('cyclic declared-property inheritance: ' + qualified)
        seen = seen | {key}
        package, name = qualified.split('.')
        source = self.files.get(package.casefold())
        if source is None:
            raise ValueError('missing declared-property package: ' + qualified)
        if source.stem not in self.packages:
            self.packages[source.stem] = defaults.load(source.name)
            self.sources[source.name] = sha(source.read_bytes())
        pkg = self.packages[source.stem]
        matches = [e for e in pkg.exports if pkg.class_name_of(e) == 'Class'
                   and pkg.export_name(e).casefold() == name.casefold()]
        if len(matches) != 1:
            raise ValueError('missing declared-property class: ' + qualified)
        ex = matches[0]
        parent = pkg.ref_name(ex.super_index)
        fields = dict(self.property_types((parent[0] or source.stem) + '.' + parent[1], seen)) if parent else {}
        for prop in pkg.exports:
            if prop.package_index != ex.index + 1:
                continue
            kind = PROPERTY_TYPES.get(pkg.class_name_of(prop))
            if kind:
                fields[pkg.export_name(prop).casefold()] = kind
        self.definitions[key] = fields
        return fields


def build(data, original, *, include_meshes=True):
    rows = parse_npcgrp(data)
    catalog = OriginalClasses()
    entries, unresolved = {}, {}
    for row in rows:
        key = str(row['npc_id'])
        if key in entries or key in unresolved:
            raise ValueError('duplicate NPC id ' + key)
        try:
            visual = resolve_visual(row['class_name'], catalog.get)
        except ValueError as error:
            unresolved[key] = str(error)
            continue
        entries[key] = {'class': row['class_name'], 'mesh': row['mesh_name'], **visual}

    meshes, missing_meshes = {}, {}
    if include_meshes:
        # Only build scale records for mesh assets the browser can currently
        # load. Full qualified names still identify the original package.
        manifest = json.loads((ROOT / 'editor/characters/monsters/manifest.json').read_text())
        built = {m['id'].casefold() for m in manifest['models']}
        files = {p.stem.casefold(): p for p in (ROOT / 'assets/interlude/animations').glob('*.ukx')}
        source_hashes = {}
        for name in sorted({r['mesh'] for r in entries.values()}):
            if name.count('.') != 1:
                continue
            package, mesh = name.split('.')
            if mesh.casefold() not in built:
                continue
            source = files.get(package.casefold())
            if source is None:
                missing_meshes[name] = 'missing original mesh package'
                continue
            pkg = scale_util.load_ukx_path(str(source))
            matches = [e for e in pkg.exports if pkg.export_name(e).casefold() == mesh.casefold()
                       and pkg.class_name_of(e) == 'SkeletalMesh']
            if len(matches) != 1:
                missing_meshes[name] = 'missing or ambiguous original skeletal mesh'
                continue
            ex = matches[0]
            try:
                scale, version, scale_offset = original_mesh_scale(pkg, ex)
            except (ValueError, defaults.up.L2Error) as error:
                missing_meshes[name] = str(error)
                continue
            if source.name not in source_hashes:
                source_hashes[source.name] = sha(source.read_bytes())
            meshes[name.casefold()] = {'source': source.name, 'sourceSHA256': source_hashes[source.name],
                'mesh': pkg.export_name(ex), 'meshScale': scale,
                'lodMeshVersion': version, 'meshScaleOffset': scale_offset,
                'exportOffset': ex.serial_offset, 'exportLength': ex.serial_size,
                'exportSHA256': sha(pkg.data[ex.serial_offset:ex.serial_offset + ex.serial_size])}
    return {'format': FORMAT, 'provenance': {'edition': 'Interlude',
        'source': 'assets/interlude/system/npcgrp.dat', 'sourceSHA256': sha(original),
        'decryptedSHA256': sha(data), 'packages': catalog.sources,
        'defaultsMethod': 'declared-fields-terminal-visual-consensus-v1',
        'recordCount': len(rows)}, 'npcs': entries, 'classes': catalog.classes,
        'meshes': meshes, 'unresolved': unresolved, 'unresolvedMeshes': missing_meshes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path(OUT_DIR) / 'npcvisual.json')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as temp:
        data = decrypt('npcgrp.dat', temp)
    result = build(data, (Path(SYSTEM_DIR) / 'npcgrp.dat').read_bytes())
    if args.check:
        if json.loads(args.output.read_text()) != result:
            raise SystemExit('NPC visual export differs from original inputs')
    else:
        args.output.write_text(json.dumps(result, indent=1, allow_nan=False) + '\n')
    print(f"{len(result['npcs'])} resolved NPCs; {len(result['unresolved'])} unresolved; "
          f"{len(result['meshes'])} built-mesh transforms; {len(result['unresolvedMeshes'])} unresolved meshes")


if __name__ == '__main__':
    main()
