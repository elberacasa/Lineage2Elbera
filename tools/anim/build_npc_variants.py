#!/usr/bin/env python3
"""Build bounded NPC-class animation overrides from the owner's original client.

The old mesh-keyed table cannot represent classes sharing a mesh. This helper
recovers qualified UClass ancestry and localized fields per NPC, then appends
the explicitly named original sequences to four existing private glTFs. It
does not choose clips by keywords, overwrite geometry, or infer a missing bind.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/dat'))
sys.path.insert(0, str(ROOT / 'tools/src/char_pipeline'))
import extract_gamedata as dat
import build_monsters as builder
import assemble
import uclass_defaults as classes
import creature_anim_table as localized

FORMAT = 'l2-interlude-npc-animations-v1'
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
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


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


def original_catalog(tmp):
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
                parents[qualified] = ((parent[0] or path.stem) + '.' + parent[1]).casefold() if parent else None
            loaded.add(pkg)
        if key not in parents:
            raise ValueError('missing original UClass export: ' + key)
        return parents[key]

    # Include every localized package in an actual ancestry, including Engine.
    for name in TARGETS:
        key = name
        while key:
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
    record(files['npcgrp.dat'])
    rows = dat.parse_npcgrp(dat.decrypt('npcgrp.dat', tmp))
    npcs = {}
    for row in rows:
        target = TARGETS.get(row['class_name'].casefold())
        if target is None:
            continue
        fields, chain = resolve_fields(row['class_name'], tables, parent_of)
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
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/gamedata/npcanimations.json')
    args = parser.parse_args()
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
