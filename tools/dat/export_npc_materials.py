#!/usr/bin/env python3
"""Elbera Tools: export original NPC material variants, keeping unknown graphs explicit.

Builds the audited ghost/gold-pig records and Angel corpse wing alpha state.
Ghost diffuse/slot/brighten bindings are verified; specular graphs stay unresolved.
The current browser lighting model is not claimed to reproduce D3D9 lighting.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/src/char_pipeline'))
sys.path.insert(0, str(ROOT / 'tools/ui'))
sys.path.insert(0, str(ROOT / 'tools'))
import build_monsters as builder
import build_characters as characters
import assemble
import ue2package as up
from l2lib import textures
from extract_gamedata import decrypt, parse_npcgrp

ANGEL_IDS = {30980, 31752}
TARGET_IDS = {13035, 31538, 31919, 31920, 32011, 31452, 31454, 31524} | ANGEL_IDS
FORMAT = 'l2-interlude-npc-materials-v1'
REFERENCE_FIELDS = {'Diffuse', 'Opacity', 'Specular', 'SpecularityMask', 'SelfIllumination',
                    'SelfIlluminationMask', 'Detail', 'Material', 'NormalMap', 'FallbackMaterial'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def classify_shader(node):
    """Only this fully observed diffuse-only Shader shape is activated."""
    props = node['properties']
    if node['class'] != 'Shader':
        return 'unsupported material class: ' + node['class']
    if set(props) - {'Diffuse', 'SpecularityMask', 'OutputBlending', 'TwoSided'}:
        return 'shader graph requires unimplemented properties: ' + ', '.join(sorted(set(props) - {
            'Diffuse', 'SpecularityMask', 'OutputBlending', 'TwoSided'}))
    if props.get('OutputBlending') != {'raw': '05'} or props.get('TwoSided') is not True:
        return 'shader is not the verified two-sided OB_Brighten case'
    if not props.get('Diffuse', {}).get('reference'):
        return 'shader has no explicit original diffuse reference'
    if props.get('SpecularityMask') != props['Diffuse']:
        return 'unverified independent specularity mask'
    return None


def angel_alpha_binding(nodes, keys):
    """Recover only the observed Angel wing's FinalBlend alpha/render state.

    The body and specular branches remain in the graph but are not implemented
    by this correction. Extra opacity modifiers are rejected, not flattened.
    """
    if len(keys) != 2:
        raise ValueError('Angel material requires the two original mesh slots')
    final = nodes[keys[1]]
    props = final['properties']
    if final['class'] != 'FinalBlend' or props.keys() != {
            'FrameBufferBlending', 'AlphaTest', 'TwoSided', 'AlphaRef', 'TreatAsTwoSided', 'Material'}:
        raise ValueError('unverified Angel FinalBlend graph')
    if props['FrameBufferBlending'] != {'raw': '02'} or props['AlphaTest'] is not True \
            or props['TwoSided'] is not True or props['TreatAsTwoSided'] is not True \
            or props['AlphaRef'] != {'raw': 'a0'}:
        raise ValueError('unverified Angel FinalBlend state')
    shader_key = props['Material']['reference']
    shader = nodes[shader_key]
    sp = shader['properties']
    if shader['class'] != 'Shader' or sp.keys() != {'Diffuse', 'Opacity', 'Specular', 'SpecularityMask'} \
            or sp['Diffuse'] != sp['Opacity']:
        raise ValueError('Angel diffuse/opacity are not the same unmodified source Texture')
    diffuse_key = sp['Diffuse']['reference']
    if nodes[diffuse_key]['class'] != 'Texture':
        raise ValueError('Angel opacity subgraph is not a plain Texture')
    return {'kind': 'finalblend-alpha', 'textureIndex': 1, 'material': keys[1],
            'shader': shader_key, 'diffuse': diffuse_key,
            'alphaRef': int(props['AlphaRef']['raw'], 16)}


def validate_converted_binding(gltf, binary, fresh, base_binary):
    if not binary.startswith(base_binary) or gltf['meshes'] != fresh['meshes']:
        raise ValueError('current model geometry/material mapping differs from original PSK conversion')
    if gltf['nodes'] != fresh['nodes'] or gltf['skins'] != fresh['skins']:
        raise ValueError('current model skeleton differs from original PSK conversion')


def model_binding(mesh_name, entry, stage):
    package, requested = mesh_name.split('.', 1)
    ukx, _ = builder.ukx_for_package(package)
    if not ukx:
        raise ValueError('original mesh package missing: ' + package)
    names = [name for name in builder.list_objects(ukx).get('SkeletalMesh', [])
             if name.casefold() == requested.casefold()]
    if len(names) != 1:
        raise ValueError('original mesh reference is absent/ambiguous: ' + mesh_name)
    mesh = names[0]
    package_data = builder.load_ukx(package)
    export = package_data.find_export(mesh)
    version, texture_slots, materials = up.mesh_material_slots(package_data, export)
    # These audited meshes have identity mappings. Reject others rather than
    # silently interpreting section order as an arbitrary TextureIndex mapping.
    if materials != list(range(len(texture_slots))):
        raise ValueError('this bounded exporter requires native identity TextureIndex mapping')
    builder.export_one(ukx, mesh, [], stage)
    psk = builder.find_exported(stage, mesh, '.psk')
    if not psk:
        raise ValueError('original PSK export missing')
    data = assemble.parse_psk(psk)
    if len(data['materials']) != len(materials) or any(f[3] >= len(materials) for f in data['faces']):
        raise ValueError('source PSK section/ULodMesh material mismatch')
    path = ROOT / 'editor/characters/monsters' / entry['gltf']
    model_bytes = path.read_bytes()
    gltf = json.loads(model_bytes)
    if len(gltf['buffers']) != 1:
        raise ValueError('expected one model buffer')
    binary_path = path.parent / gltf['buffers'][0]['uri']
    binary = binary_path.read_bytes()
    fresh, base_binary, _ctx = assemble.merge_parts([
        {'psk': psk, 'name': mesh, 'sections': []}], str(path))
    # Independent original PSK conversion must reproduce the current geometry
    # and every primitive's material index before a new texture can touch it.
    validate_converted_binding(gltf, binary, fresh, base_binary)
    active_slots = sorted({face[3] for face in data['faces']})
    bindings = []
    for index, slot in enumerate(active_slots):
        primitive = gltf['meshes'][0]['primitives'][index]
        bindings.append({'meshIndex': 0, 'primitiveIndex': index,
                         'materialIndex': primitive['material'], 'textureIndex': materials[slot],
                         'sourceSection': slot})
    return {'meshName': mesh_name, 'gltf': entry['gltf'], 'gltfSHA256': sha(model_bytes),
            'buffer': str(binary_path.relative_to(path.parent.parent)), 'bufferSHA256': sha(binary),
            'sourcePackage': ukx, 'sourcePackageSHA256': sha((ROOT / 'assets/interlude' / ukx).read_bytes()),
            'sourceExportSHA256': sha(package_data.data[export.serial_offset:export.serial_offset + export.serial_size]),
            'pskSHA256': sha(Path(psk).read_bytes()), 'lodMeshVersion': version,
            'textureSlots': texture_slots, 'materialTextureIndices': materials, 'bindings': bindings,
            'geometryProof': 'original-PSK-conversion-byte-prefix-and-mesh-skin-node-equality'}


class MaterialGraph:
    def __init__(self, output):
        self.output, self.nodes, self.images, self.sources = output, {}, {}, {}

    def read(self, package_name, object_name, export=None):
        package = characters.load_utx(package_name)
        path = ROOT / 'assets/interlude' / characters.find_utx(package_name)
        source_key = str(path.relative_to(ROOT))
        if source_key not in self.sources:
            self.sources[source_key] = sha(path.read_bytes())
        if export is None:
            matches = [e for e in package.exports if package.export_name(e).casefold() == object_name.casefold()
                       and package.class_name_of(e) != 'Package']
            if len(matches) != 1:
                raise ValueError('original material reference absent/ambiguous: ' + package_name + '.' + object_name)
            export = matches[0]
        key = package_name.casefold() + ':' + str(export.serial_offset)
        if key in self.nodes:
            return key
        reader = package.body_reader(export)
        props = up.read_properties(package, reader, fmt='packed')
        node = {'package': package_name, 'object': package.export_name(export),
                'class': package.class_name_of(export), 'properties': {},
                'exportSHA256': sha(package.data[export.serial_offset:export.serial_offset + export.serial_size])}
        self.nodes[key] = node
        for name, raw in props.items():
            if isinstance(raw, bool):
                node['properties'][name] = raw
            elif name in REFERENCE_FIELDS:
                reference = package.resolve_ref(up.Reader(raw).compact())
                if isinstance(reference, up.Export):
                    target = self.read(package_name, package.export_name(reference), reference)
                elif reference is None:
                    target = None
                else:
                    target_package, target_name = package.ref_name(up.Reader(raw).compact())
                    target = self.read(target_package, target_name)
                node['properties'][name] = {'reference': target}
            else:
                node['properties'][name] = {'raw': raw.hex()}
        if node['class'] == 'Texture':
            width, height, rgba, _info = textures.extract_texture_rgba(package, export)
            filename = sha((package_name + '.' + node['object']).encode()) + '.png'
            png_path = self.output / filename
            textures.write_png(str(png_path), width, height, rgba)
            node['image'] = {'url': '/characters/monsters/models/npc-materials/' + filename,
                             'sha256': sha(png_path.read_bytes()), 'width': width, 'height': height,
                             'rgbaSHA256': sha(rgba)}
        return key


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/gamedata/npcmaterials.json')
    args = parser.parse_args()
    from check_npc_material_native import verify as verify_native
    proof = verify_native()
    manifest = json.loads((ROOT / 'editor/characters/monsters/manifest.json').read_text())
    entries = {entry['id'].casefold(): entry for entry in manifest['models']}
    with tempfile.TemporaryDirectory(prefix='elbera-npc-materials-') as temp:
        stage = Path(temp)
        image_stage = stage / 'images'
        image_stage.mkdir()
        graph = MaterialGraph(image_stage)
        rows = parse_npcgrp(decrypt('npcgrp.dat', temp))
        catalog = {'format': FORMAT, 'edition': 'Interlude', 'proof': proof,
                   'npcgrpSHA256': sha((ROOT / 'assets/interlude/system/npcgrp.dat').read_bytes()),
                   'npcs': {}, 'models': {}}
        for row in rows:
            if row['npc_id'] not in TARGET_IDS:
                continue
            if row['textures_second']:
                raise ValueError('alternate abnormal-state textures are outside this correction')
            mesh = row['mesh_name'].split('.', 1)[1].casefold()
            if mesh not in catalog['models']:
                catalog['models'][mesh] = model_binding(row['mesh_name'], entries[mesh], str(stage / mesh))
            model = catalog['models'][mesh]
            if len(row['textures']) != len(model['textureSlots']):
                raise ValueError('original npcgrp and mesh texture-slot counts differ')
            material_keys = [graph.read(*ref.split('.', 1)) for ref in row['textures']]
            unresolved = [reason for key in material_keys if (reason := classify_shader(graph.nodes[key]))]
            for key in material_keys:
                if classify_shader(graph.nodes[key]) is None:
                    diffuse = graph.nodes[key]['properties']['Diffuse']['reference']
                    if graph.nodes[diffuse]['class'] != 'Texture':
                        unresolved.append('diffuse subgraph is not a plain original Texture')
            catalog['npcs'][str(row['npc_id'])] = {
                'className': row['class_name'], 'meshName': row['mesh_name'], 'meshId': mesh,
                'originalTextures': row['textures'], 'materials': material_keys,
                'status': 'unresolved' if unresolved else 'diffuse-slot-and-brighten-verified',
                'unresolved': unresolved,
                'remainingRendererGap': 'Browser lighting/color pipeline parity with original D3D9 is not established.'}
            if row['npc_id'] in ANGEL_IDS:
                if row['mesh_name'].casefold() != 'lineagemonsters.angel_m00':
                    raise ValueError('original Angel corpse mesh changed')
                correction = angel_alpha_binding(graph.nodes, material_keys)
                catalog['npcs'][str(row['npc_id'])].update(
                    status='wing-alpha-and-blend-verified-partial', unresolved=[],
                    corrections=[correction],
                    limitations=['Body Shader specular and wing TexEnvMap/specularity are not implemented.'],
                    remainingRendererGap='Only wing diffuse/opacity, alpha comparison, blending, depth and culling are corrected; original specular and lighting/color parity remain unresolved.')
        if set(map(int, catalog['npcs'])) != TARGET_IDS:
            raise ValueError('missing original target NPC record')
        catalog.update(materials=graph.nodes, sources=graph.sources)
        output_dir = ROOT / 'editor/characters/monsters/models/npc-materials'
        output_dir.mkdir(parents=True, exist_ok=True)
        for path in image_stage.iterdir():
            (output_dir / path.name).write_bytes(path.read_bytes())
        args.output.write_bytes(encode(catalog))
        ready = sum(n['status'] == 'diffuse-slot-and-brighten-verified' for n in catalog['npcs'].values())
        partial = sum(n['status'] == 'wing-alpha-and-blend-verified-partial' for n in catalog['npcs'].values())
        print(f'Original NPC materials: {ready} verified ghost bindings; {partial} partial Angel wing corrections; {len(TARGET_IDS)-ready-partial} unresolved graph; {len(graph.nodes)} graph nodes -> {args.output}')


if __name__ == '__main__':
    main()
