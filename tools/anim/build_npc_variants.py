#!/usr/bin/env python3
"""Elbera Tools: recover original per-NPC selectors or build bounded overrides.

The old mesh-keyed table cannot represent classes sharing a mesh. This helper
recovers qualified UClass ancestry and localized fields per NPC, then appends
the explicitly named original sequences to four existing private glTFs. It
does not choose clips by keywords, overwrite geometry, or infer a missing bind.

--selectors-only reads qualified class/.int fields, each mesh's serialized
Animation reference and original sequence timing. It does not rebuild models.
Existing manifest/glTF aliases are diagnostics, not native pose-byte proof.
Original inputs and generated catalogs remain private; see npc-animation-variants.md.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/dat'))
sys.path.insert(0, str(ROOT / 'tools/src/char_pipeline'))
import extract_gamedata as dat
import uclass_defaults as classes
import creature_anim_table as localized

FORMAT = 'l2-interlude-npc-animations-v1'
SELECTOR_FORMAT = 'l2-interlude-npc-selectors-v1'
# Audit scope, not animation values. All values are read afresh from .int.
TARGETS = {
    'lineagenpc.e_guard_mdwarf_death': {'idle': 'WaitAnimName'},
    'lineagenpc.e_trader_morc_death': {'idle': 'WaitAnimName'},
    'lineagenpc.angel_death': {'idle': 'WaitAnimName'},
    'lineagenpc.a_tradera_mhuman_deco': {
        'idle': 'WaitAnimName', 'social': 'NpcSocialAnimName'},
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()


def resolve_fields(class_name, tables, parent_of):
    """Child wins per array element; package qualification is never discarded."""
    fields, chain, seen = {}, [], set()
    key = class_name.casefold()
    while key:
        if key in seen:
            raise ValueError('cyclic UClass ancestry: ' + key)
        if '.' not in key:
            raise ValueError('unqualified UClass: ' + key)
        seen.add(key)
        chain.append(key)
        pkg, cls = key.split('.', 1)
        for var, elements in tables.get(pkg, {}).get(cls, {}).items():
            for index, value in elements.items():
                fields.setdefault(var, {}).setdefault(index, {
                    'value': value, 'declaredBy': key})
        key = parent_of(key)
    return fields, chain


def localized_classes(tmp, class_names):
    """Read each qualified ancestry once; never collapse records by mesh."""
    system = ROOT / 'assets/interlude/system'
    files = {p.name.casefold(): p for p in system.iterdir() if p.is_file()}
    source_hashes, tables, parents, loaded = {}, {}, {}, set()

    def record(path):
        source_hashes[path.name] = sha(path.read_bytes())

    def parent_of(key):
        pkg, _cls = key.split('.', 1)
        if pkg not in loaded:
            path = files.get(pkg + '.u')
            if path is None:
                raise ValueError('missing original class package: ' + pkg)
            record(path)
            p = classes.load(path.name)
            for ex in p.exports:
                if p.class_name_of(ex) != 'Class':
                    continue
                parent = p.ref_name(ex.super_index)
                qualified = pkg + '.' + p.export_name(ex).casefold()
                if qualified in parents:
                    raise ValueError('ambiguous original UClass export: ' + qualified)
                parents[qualified] = ((parent[0] or path.stem) + '.' + parent[1]).casefold() if parent else None
            loaded.add(pkg)
        if key not in parents:
            raise ValueError('missing original UClass export: ' + key)
        return parents[key]

    # Include every localized package in an actual ancestry, including Engine.
    for name in class_names:
        key, seen = name.casefold(), set()
        while key:
            if key in seen:
                raise ValueError('cyclic UClass ancestry: ' + key)
            if key.count('.') != 1:
                raise ValueError('unqualified original UClass: ' + key)
            seen.add(key)
            pkg = key.split('.', 1)[0]
            if pkg not in tables:
                path = files.get(pkg + '.int')
                tables[pkg] = {}
                if path:
                    record(path)
                    decoded = str(Path(tmp) / (pkg + '.int'))
                    localized.decrypt(str(path), decoded)
                    tables[pkg] = localized.parse_int(decoded)
            key = parent_of(key)
    return {name.casefold(): resolve_fields(name, tables, parent_of) for name in class_names}, source_hashes


def original_catalog(tmp):
    resolved, source_hashes = localized_classes(tmp, TARGETS)
    files = {p.name.casefold(): p for p in (ROOT / 'assets/interlude/system').iterdir() if p.is_file()}
    source_hashes['npcgrp.dat'] = sha(files['npcgrp.dat'].read_bytes())
    rows = dat.parse_npcgrp(dat.decrypt('npcgrp.dat', tmp))
    npcs = {}
    for row in rows:
        target = TARGETS.get(row['class_name'].casefold())
        if target is None:
            continue
        fields, chain = resolved[row['class_name'].casefold()]
        overrides = {}
        for slot, var in target.items():
            source = fields.get(var, {}).get('0')
            if not source or source['value'].casefold() in ('', 'none'):
                raise ValueError(f"{row['class_name']}: original {var}[0] is absent")
            overrides[slot] = {'property': var, 'index': 0, **source}
        npcs[str(row['npc_id'])] = {
            'className': row['class_name'], 'meshName': row['mesh_name'],
            'meshId': row['mesh_name'].split('.', 1)[1],
            'inheritance': chain, 'fields': fields, 'overrides': overrides}
    if {r['className'].casefold() for r in npcs.values()} != set(TARGETS):
        raise ValueError('original npcgrp does not cover the requested classes')
    return npcs, source_hashes


def exact_sequence(names, requested):
    found = [n for n in names if n.casefold() == requested.casefold()]
    if len(found) != 1:
        raise ValueError(f'original sequence {requested!r}: {len(found)} exact matches')
    return found[0]


def unique_source_export(package, reference, kind):
    """Match the entire qualified source path, including object outers."""
    from build_pawnanim import source_ref_path
    package_name = Path(package.path).stem
    found = [ex for ex in package.exports if package.class_name_of(ex) == kind
             and source_ref_path(package, ex.index + 1, package_name).casefold() == reference.casefold()]
    if len(found) != 1:
        raise ValueError(f'original {kind} {reference}: {len(found)} exact matches')
    return found[0]


def mesh_animation_reference(package, export):
    """Read only the bounded original SkeletalMesh prefix through Animation.

    Same version-five prefix as build_hair.source_lod0, without requiring a
    hair-shaped LOD or loading its vertices. The reference is serialized data,
    not a mesh-name suffix or an existing UModel/bindings.json cache.
    """
    if (package.file_version, package.licensee_version) not in ((123, 28), (123, 30)):
        raise ValueError('unsupported original skeletal package version')
    if package.class_name_of(export) != 'SkeletalMesh':
        raise ValueError('not an original SkeletalMesh')
    start, end = export.serial_offset, export.serial_offset + export.serial_size
    if not 0 <= start < end <= len(package.data):
        raise ValueError('invalid original skeletal export bounds')
    r = classes.up.Reader(memoryview(package.data)[:end], start)
    classes.up.read_properties(package, r)

    def count(width=1):
        n = r.compact()
        if not 0 <= n <= (end - r.pos) // width:
            raise ValueError('invalid bounded original skeletal array')
        return n

    def array(width):
        r.bytes(count(width) * width)

    r.bytes(25 + 16)  # UMesh FBox/FSphere.
    if r.i32() != 5 or r.i32() < 0:
        raise ValueError('unsupported original LodMesh version/vertex count')
    array(4)
    for _ in range(count()):
        ref = r.compact()
        if ref:
            package.resolve_ref(ref)
    r.bytes(36)  # MeshScale, MeshOrigin, RotOrigin.
    for width in (2, 8, 2, 10, 8):
        array(width)
    r.bytes(24); r.i32(); r.compact(); r.bytes(52); r.f32(); r.i32()
    array(12)
    for _ in range(count(57)):
        package.name(r.compact())
        r.bytes(56)  # RefSkeleton flags, quaternion, position, bounds and links.
    at = r.pos
    reference = r.compact()
    if reference:
        package.resolve_ref(reference)
    from build_pawnanim import source_ref_path
    return source_ref_path(package, reference, Path(package.path).stem), {
        'sourceExportSHA256': sha(package.data[start:end]),
        'animationReferenceOffset': at,
        'animationReferenceBytesSHA256': sha(package.data[at:r.pos]),
    }


def selector_elements(fields, sequences):
    """Names only: no weapon-stance, attack-variant or state-machine choice."""
    by_name = {}
    for sequence in sequences:
        key = sequence['name'].casefold()
        if key in by_name:
            raise ValueError('ambiguous original sequence name: ' + sequence['name'])
        by_name[key] = sequence
    result = {}
    for field, elements in fields.items():
        if not field.endswith('AnimName'):
            continue
        result[field] = {}
        for index, original in elements.items():
            if not index.isdecimal() or int(index) < 0:
                raise ValueError('invalid localized animation array index')
            value = original['value']
            record = {**original}
            if value.casefold() == 'none':
                record['status'] = 'source-none'
            elif value == '':
                record['status'] = 'source-empty-localized-value'
            elif value.casefold() not in by_name:
                record['status'] = 'unresolved-sequence'
            else:
                sequence = by_name[value.casefold()]
                record.update(status='source-sequence', sequence=sequence['name'],
                              frames=sequence['frames'], rate=sequence['rate'])
            result[field][index] = record
    return result


def exported_aliases(entry, gltf, sequences):
    """Diagnostic legacy labels only; their baked pose bytes are NOT certified.

    A named source clip can have several frozen-contract labels, e.g. both
    attack and special. Preserve explicit clipAlias chains; never infer an
    alias from keyword search, first clip, or identical-looking poses.
    """
    result = {}
    names = [a.get('name') for a in gltf.get('animations', [])]
    aliases = entry.get('clipAlias', {})
    for slot, requested in entry.get('clips', {}).items():
        try:
            sequence = exact_sequence([s['name'] for s in sequences], requested)
        except ValueError:
            continue
        clip, seen = slot, set()
        while clip in aliases:
            if clip in seen:
                raise ValueError('cyclic existing clip alias')
            seen.add(clip)
            clip = aliases[clip]
            if not isinstance(clip, str):
                raise ValueError('invalid existing clip alias')
        if entry.get('clips', {}).get(clip, '').casefold() != sequence.casefold():
            continue  # The destination must declare this very same source sequence.
        if names.count(clip) != 1:
            continue
        result[slot] = {'sequence': sequence, 'clip': clip,
                        'status': 'legacy-manifest-alias-pose-unverified'}
    return result


def built_alias_record(entry, sequences):
    """Optional build diagnostics cannot invalidate recovered source identity."""
    base = (ROOT / 'editor/characters/monsters').resolve()
    try:
        path = (base / entry['gltf']).resolve()
        if not path.is_relative_to(base):
            raise ValueError('existing model path escapes monster directory')
        raw = path.read_bytes()
        gltf = json.loads(raw)
        buffers = []
        for buffer in gltf.get('buffers', []):
            p = (path.parent / buffer['uri']).resolve()
            if not p.is_relative_to(base):
                raise ValueError('existing buffer path escapes monster directory')
            data = p.read_bytes()
            if len(data) != buffer['byteLength']:
                raise ValueError('existing buffer size mismatch')
            buffers.append({'uri': buffer['uri'], 'SHA256': sha(data)})
        return {'status': 'legacy-model-id-match-source-mesh-unverified',
                'gltf': entry['gltf'], 'gltfSHA256': sha(raw), 'buffers': buffers,
                'aliases': exported_aliases(entry, gltf, sequences)}
    except (ValueError, OSError, KeyError, TypeError) as error:
        return {'status': 'unresolved-existing-export', 'reason': str(error)}


def recover_selectors(tmp, npc_ids=None):
    """Recover source choices without rebuilding or editing any model assets."""
    from build_pawnanim import original_animation
    rows = dat.parse_npcgrp(dat.decrypt('npcgrp.dat', tmp))
    if npc_ids is not None:
        selected = set(npc_ids)
        rows = [r for r in rows if r['npc_id'] in selected]
        if {r['npc_id'] for r in rows} != selected:
            raise ValueError('requested NPC absent from original npcgrp')
    if len({r['npc_id'] for r in rows}) != len(rows):
        raise ValueError('duplicate original NPC identifier')
    resolved, sources = localized_classes(tmp, sorted({r['class_name'] for r in rows}))
    system = ROOT / 'assets/interlude/system'
    npc_file = next(p for p in system.iterdir() if p.name.casefold() == 'npcgrp.dat')
    sources['system/' + npc_file.name] = sha(npc_file.read_bytes())
    sources = {('system/' + k if '/' not in k else k): v for k, v in sources.items()}
    files = {}
    for path in (ROOT / 'assets/interlude/animations').glob('*'):
        if path.suffix.casefold() == '.ukx':
            if path.stem.casefold() in files:
                raise ValueError('ambiguous original animation package: ' + path.stem)
            files[path.stem.casefold()] = path
    packages, animations, meshes = {}, {}, {}

    def package_for(reference):
        if not isinstance(reference, str) or '.' not in reference:
            raise ValueError('unqualified original object reference')
        key = reference.split('.', 1)[0].casefold()
        if key not in packages:
            path = files.get(key)
            if path is None:
                raise ValueError('missing original animation package: ' + key)
            packages[key], _ = classes.up.load_package(str(path))
            sources['animations/' + path.name] = sha(path.read_bytes())
        return packages[key]

    manifest_path = ROOT / 'editor/characters/monsters/manifest.json'
    manifest = json.loads(manifest_path.read_text())['models'] if manifest_path.is_file() else []
    built_entries = {}
    for entry in manifest:
        key = entry['id'].casefold()
        if key in built_entries:
            raise ValueError('ambiguous existing monster model: ' + key)
        built_entries[key] = entry
    for reference in sorted({r['mesh_name'] for r in rows}):
        if not reference:
            continue
        key = reference.casefold()
        try:
            package = package_for(reference)
            export = unique_source_export(package, reference, 'SkeletalMesh')
            animation_ref, provenance = mesh_animation_reference(package, export)
            record = {'meshName': reference, **provenance, 'animation': animation_ref}
            if not animation_ref:
                record['status'] = 'source-no-animation-reference'
            else:
                animation_key = animation_ref.casefold()
                if animation_key not in animations:
                    animation_package = package_for(animation_ref)
                    animation_export = unique_source_export(animation_package, animation_ref, 'MeshAnimation')
                    data = original_animation(animation_package, animation_export)
                    start = animation_export.serial_offset
                    animations[animation_key] = {
                        'reference': animation_ref,
                        'sourceExportSHA256': sha(animation_package.data[start:start + animation_export.serial_size]),
                        'sequences': [{k: s[k] for k in ('name', 'frames', 'rate', 'source')}
                                      for s in data['sequences']],
                    }
                record['status'] = 'source-animation'
                entry = built_entries.get(reference.split('.')[-1].casefold())
                if entry:
                    record['built'] = built_alias_record(entry, animations[animation_key]['sequences'])
            meshes[key] = record
        except (ValueError, classes.up.L2Error, struct.error) as error:
            meshes[key] = {'meshName': reference, 'status': 'unresolved-source', 'reason': str(error)}

    npcs = {}
    for row in rows:
        fields, chain = resolved[row['class_name'].casefold()]
        mesh = meshes.get(row['mesh_name'].casefold())
        animation = animations.get((mesh.get('animation') or '').casefold()) if mesh else None
        npcs[str(row['npc_id'])] = {
            'className': row['class_name'], 'meshName': row['mesh_name'], 'inheritance': chain,
            'localizedFields': fields,
            'status': mesh['status'] if mesh else 'source-empty-mesh-name',
            'selectors': selector_elements(fields, animation['sequences']) if animation else None,
        }
    return {'format': SELECTOR_FORMAT, 'edition': 'Interlude', 'npcs': npcs,
            'meshes': meshes, 'animations': animations, 'sources': sources,
            'sourceSHA256': sha(encode(sources)),
            'scope': {'selection': 'qualified-localized-array-elements; no stance or action-state choice',
                      'missingField': 'unresolved; serialized-default fallback not recovered here',
                      'builtAliases': 'exact legacy labels only; pose bytes and native playback unverified'}}


def check_skeleton(gltf, fresh, ctx, psa_bones):
    # Do not enter assemble's normalized-name or partial-bone fallback.
    if not any([b['name'].casefold() for b in data['bones']] ==
               [b.casefold() for b in psa_bones] for data, _perm in ctx['parts']):
        raise ValueError('PSA/PSK bones do not agree positionally; no guessed bone mapping')
    count = len(ctx['skeleton'].bones)
    if gltf.get('nodes', [])[:count] != fresh['nodes'][:count]:
        raise ValueError('existing glTF skeleton differs from original PSK conversion')
    for skin in gltf.get('skins', []):
        if skin.get('joints') != list(range(count)):
            raise ValueError('existing glTF skin uses a different node mapping')


def build_mesh(mesh_name, records, entry, stage):
    # Legacy model conversion is not needed for source-only selector recovery.
    import build_monsters as builder
    import assemble
    pkg, requested = mesh_name.split('.', 1)
    ukx, _ = builder.ukx_for_package(pkg)
    if not ukx:
        raise ValueError('original mesh package missing: ' + pkg)
    objects = builder.list_objects(ukx)
    mesh = exact_sequence(objects.get('SkeletalMesh', []), requested)
    anim, anim_ukx = builder.bound_animation(ukx, mesh)
    if not anim or not anim_ukx:
        raise ValueError(mesh_name + ': no serialized animation reference; no fallback')
    builder.export_one(ukx, mesh, [], stage)
    builder.export_one(anim_ukx, anim, [], stage)
    psk = builder.find_exported(stage, mesh, '.psk')
    psa = builder.find_exported(stage, anim, '.psa')
    if not psk or not psa:
        raise ValueError('original mesh/animation export missing')
    bones, sequences = assemble.parse_psa(psa)
    selected = {}
    for record in records:
        for override in record['overrides'].values():
            sequence = exact_sequence(sequences, override['value'])
            if not sequences[sequence]['frames'] or sequences[sequence]['rate'] <= .001:
                raise ValueError(sequence + ': invalid original timing; no fallback rate')
            clip = 'native:' + sequence
            override.update(clip=clip, sequence=sequence)
            selected[clip] = sequence
    path = ROOT / 'editor/characters/monsters' / entry['gltf']
    gltf = json.loads(path.read_text())
    if len(gltf.get('buffers', [])) != 1:
        raise ValueError('expected one external model buffer')
    binary_path = path.parent / gltf['buffers'][0]['uri']
    binary = binary_path.read_bytes()
    if len(binary) != gltf['buffers'][0]['byteLength']:
        raise ValueError('existing glTF buffer length mismatch')
    fresh, _unused, ctx = assemble.merge_parts([
        {'psk': psk, 'name': mesh, 'sections': []}], str(path))
    check_skeleton(gltf, fresh, ctx, bones)
    provenance = {
        'meshPackage': ukx, 'meshPackageSHA256': sha((ROOT / 'assets/interlude' / ukx).read_bytes()),
        'animationPackage': anim_ukx, 'animationPackageSHA256': sha((ROOT / 'assets/interlude' / anim_ukx).read_bytes()),
        'animationObject': anim, 'pskSHA256': sha(Path(psk).read_bytes()),
        'psaSHA256': sha(Path(psa).read_bytes()), 'clips': selected,
        'boneMapping': 'complete-positional-PSA-PSK-agreement',
    }
    previous = gltf.get('extras', {}).get('originalNpcAnimations')
    if previous is not None:
        if previous != provenance or not set(selected).issubset({a['name'] for a in gltf.get('animations', [])}):
            raise ValueError('existing animation patch differs; rebuild original model before refreshing')
    else:
        if set(selected) & {a['name'] for a in gltf.get('animations', [])}:
            raise ValueError('original clip name collision without matching provenance')
        original_binary = binary
        binary = assemble.inject_animations(gltf, binary, psa, selected, ctx)
        assert binary.startswith(original_binary), 'animation append changed existing geometry/clip bytes'
        gltf.setdefault('extras', {})['originalNpcAnimations'] = provenance
    return path, gltf, binary_path, binary, provenance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--selectors-only', action='store_true', help='Recover source fields/timing; never rebuild models')
    parser.add_argument('--npc', type=int, nargs='+', help='Original NPC IDs for --selectors-only (otherwise all)')
    parser.add_argument('--check', action='store_true', help='Compare selectors with fresh original inputs; write nothing')
    args = parser.parse_args()
    if (args.check or args.npc is not None) and not args.selectors_only:
        parser.error('--check/--npc require --selectors-only')
    if args.npc is not None and (any(i <= 0 for i in args.npc) or len(args.npc) != len(set(args.npc))):
        parser.error('--npc requires distinct positive original IDs')
    if args.selectors_only:
        output = args.output or ROOT / 'assets/gamedata/npcselectors.json'
        with tempfile.TemporaryDirectory(prefix='l2-npc-selectors-') as tmp:
            catalog = recover_selectors(tmp, args.npc)
        encoded = encode(catalog)
        if args.check:
            if not output.is_file() or output.read_bytes() != encoded:
                raise ValueError('NPC source selectors missing or stale: ' + str(output))
            print(f'CHECK PASS: {len(catalog["npcs"])} original NPC selectors')
        else:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(encoded)
            print(f'Recovered {len(catalog["npcs"])} NPC selectors; {len(catalog["animations"])} original animation objects -> {output}')
        return
    args.output = args.output or ROOT / 'assets/gamedata/npcanimations.json'
    with tempfile.TemporaryDirectory(prefix='l2-npc-animations-') as tmp:
        npcs, sources = original_catalog(tmp)
        manifest = json.loads((ROOT / 'editor/characters/monsters/manifest.json').read_text())
        entries = {entry['id'].casefold(): entry for entry in manifest['models']}
        groups = {}
        for record in npcs.values():
            groups.setdefault(record['meshName'].casefold(), []).append(record)
        products, models = [], {}
        for name, records in sorted(groups.items()):
            entry = entries.get(records[0]['meshId'].casefold())
            if entry is None:
                raise ValueError('existing built mesh missing: ' + name)
            product = build_mesh(records[0]['meshName'], records, entry, str(Path(tmp) / entry['id']))
            path, gltf, binary_path, binary, provenance = product
            encoded = encode(gltf)
            products.append((path, encoded, binary_path, binary))
            models[entry['id'].casefold()] = {
                'gltf': entry['gltf'], 'gltfSHA256': sha(encoded),
                'buffer': str(binary_path.relative_to(path.parent.parent)),
                'bufferSHA256': sha(binary), **provenance}
        catalog = {'format': FORMAT, 'edition': 'Interlude', 'sources': sources,
                   'sourceSHA256': sha(encode(sources)), 'npcs': npcs, 'models': models,
                   'scope': 'Four audited shared-mesh class variants; original array index 0 only.'}
        # Finish all original-source validation before changing private outputs.
        for path, data, binary_path, binary in products:
            binary_path.write_bytes(binary)
            path.write_bytes(data)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(encode(catalog))
        print(f'Built {len(models)} original mesh clip supplements; {len(npcs)} NPC class mappings -> {args.output}')


if __name__ == '__main__':
    main()
