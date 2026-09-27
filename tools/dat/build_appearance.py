#!/usr/bin/env python3
"""Elbera Tools: exact ordinary player face bindings, from original chargrp.

--check freshly decrypts original data and compares the private catalog. The
default writes assets/gamedata/appearance.json; it does not convert any model,
image or hair asset. Original LOD0 positions independently identify the built
face part; no suffix matching or nearest appearance is used at runtime.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools', 'tools/ui', 'tools/src/char_pipeline')]
from extract_charcreate import parse_chargrp, decrypt

OUTPUT = ROOT / 'assets/gamedata/appearance.json'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def unique(items, label):
    if len(items) != 1:
        raise ValueError('missing or ambiguous ' + label)
    return items[0]


def exact_file(directory, name):
    return unique([p for p in directory.iterdir() if p.name.casefold() == name.casefold()], name)


def face_binding(gltf, mesh_name):
    """Exact proven part -> one primitive/material; reject broader schemas."""
    index, mesh = unique([(i, m) for i, m in enumerate(gltf['meshes'])
                          if m.get('name') == mesh_name], 'built face mesh')
    node = unique([n for n in gltf['nodes'] if n.get('mesh') == index], 'built face node')
    if node.get('name') != mesh_name or 'skin' not in node:
        raise ValueError('unbound face node identity')
    primitive = unique(mesh['primitives'], 'face primitive')
    if primitive.get('mode', 4) != 4 or 'TEXCOORD_0' not in primitive['attributes']:
        raise ValueError('unsupported face primitive')
    material_index = primitive['material']
    if any(p.get('material') == material_index for i, m in enumerate(gltf['meshes'])
           if i != index for p in m['primitives']):
        raise ValueError('face material shared with another part')
    material = gltf['materials'][material_index]
    if not material.get('name'):
        raise ValueError('missing face material identity')
    texture = material['pbrMetallicRoughness']['baseColorTexture']
    if texture.get('texCoord', 0) != 0 or texture.get('extensions'):
        raise ValueError('unsupported face texture coordinates')
    image = gltf['images'][gltf['textures'][texture['index']]['source']]['uri']
    if Path(image).name != image:
        raise ValueError('nonlocal built face image')
    return {'nodeName': node['name'], 'materialName': material['name'], 'defaultImage': image}


def verify_face_pixels(width, height, rgba, image_size, pixels):
    if image_size != (width, height) or len(rgba) != width * height * 4 or len(pixels) != len(rgba):
        raise ValueError('face PNG dimensions differ from source mip0')
    if rgba != pixels:
        delta = max(abs(a - b) for a, b in zip(rgba, pixels))
        raise ValueError(f'face PNG pixels differ from source mip0 (maximum channel difference {delta})')


def build():
    from check_cast_sound_native import model_voice_source
    from check_face_selection_native import verify
    from check_player_transform_native import original_lod0_points, accessor_positions, converted_position
    from export_player_visuals import built_model
    from l2lib import load_package, extract_texture_rgba
    proof = verify()
    join = model_voice_source()
    with tempfile.TemporaryDirectory() as temp:
        raw = decrypt('chargrp.dat', temp)
        rows = parse_chargrp(raw)
    manifest = json.loads((ROOT / 'editor/characters/manifest.json').read_text())
    models = {}
    for entry in manifest['models']:
        model_id = entry['id']
        if model_id not in join['modelMeshTypes']:
            raise ValueError('unbound ordinary model: ' + model_id)
        row_index = join['modelMeshTypes'][model_id]
        row = rows[row_index]
        ref = unique(row['face_mesh'], 'source face mesh')
        package_name, mesh_name = ref.split('.')
        source_path = exact_file(ROOT / 'assets/interlude/animations', package_name + '.ukx')
        package, _ = load_package(str(source_path))
        export = unique([e for e in package.exports_by_class('SkeletalMesh')
                         if package.export_name(e).casefold() == mesh_name.casefold()
                         and e.package_index == 0], 'original qualified face mesh')
        source_positions = {converted_position(p) for p in original_lod0_points(package, export)}
        _, receipt = built_model(entry, ROOT / 'editor/characters')
        path = ROOT / 'editor/characters' / receipt['gltf']
        gltf = json.loads(path.read_text())
        buffers = [(path.parent / b['uri']).read_bytes() for b in gltf['buffers']]
        built_name = unique([m['name'] for m in gltf['meshes']
                             if m.get('name', '').casefold() == mesh_name.casefold()], 'built exact face part')
        if source_positions != accessor_positions(gltf, buffers, built_name):
            raise ValueError('face geometry differs from original: ' + model_id)
        binding = face_binding(gltf, built_name)
        faces = []
        texture_package_cache = None
        for index, texture_ref in enumerate(row['face_texture']):
            texture_package, texture_name = texture_ref.split('.')
            texture_path = exact_file(ROOT / 'assets/interlude/systextures', texture_package + '.utx')
            if texture_package_cache is None or texture_package_cache[0] != texture_path:
                textures, _ = load_package(str(texture_path))
                texture_package_cache = (texture_path, textures, sha(texture_path.read_bytes()))
            _, textures, texture_package_sha = texture_package_cache
            texture_export = unique([e for e in textures.exports
                                     if textures.export_name(e).casefold() == texture_name.casefold()], 'original unique face texture reference')
            if textures.class_name_of(texture_export) != 'Texture':
                raise ValueError('face reference is not a direct source Texture')
            names, outer, seen = [textures.export_name(texture_export)], texture_export.package_index, set()
            while outer:
                if outer < 0 or outer in seen:
                    raise ValueError('unsupported face texture outer chain')
                seen.add(outer); parent = textures.exports[outer - 1]
                names.insert(0, textures.export_name(parent)); outer = parent.package_index
            library = exact_file(ROOT / 'assets/library', texture_package)
            png = exact_file(library, texture_name + '.png')
            from PIL import Image
            width, height, rgba, texture_info = extract_texture_rgba(textures, texture_export)
            with Image.open(png) as image:
                pixels = image.convert('RGBA').tobytes()
                verify_face_pixels(width, height, rgba, image.size, pixels)
            if index == 0 and png.read_bytes() != (path.parent / binding['defaultImage']).read_bytes():
                raise ValueError('built default face is not the exact original-reference PNG: ' + model_id)
            faces.append({'index': index, 'texture': texture_ref,
                          'url': '/faces/' + texture_package + '/' + texture_name + '.png',
                          'packageSHA256': texture_package_sha,
                          'sourceObject': '.'.join([texture_package, *names]),
                          'referenceResolution': 'unique original package leaf; native group resolver unverified',
                          'width': width, 'height': height, 'rgbaSHA256': sha(rgba),
                          'sourceExportSHA256': sha(textures.data[texture_export.serial_offset:texture_export.serial_offset + texture_export.serial_size]),
                          'pngSHA256': sha(png.read_bytes())})
        if not faces:
            raise ValueError('no source faces: ' + model_id)
        models[model_id] = {**binding, 'row': row_index, 'faceMesh': ref, 'faces': faces,
                           'built': receipt, 'sourceMeshPackageSHA256': sha(source_path.read_bytes()),
                           'sourceMeshExportSHA256': sha(package.data[export.serial_offset:export.serial_offset + export.serial_size]),
                           'sourcePositionCount': len(source_positions)}
    if set(models) != set(join['modelMeshTypes']):
        raise ValueError('ordinary model set incomplete')
    return {'format': 'l2-interlude-player-appearance-v1', 'source': {
        'engineSHA256': proof['engineSHA256'], 'chargrpSHA256': join['chargrpSHA256'],
        'decryptedChargrpSHA256': sha(raw), 'selector': 'PMS_Face=9; first face_mesh; face_texture[User+248]; layer=0',
        'geometryCheck': 'exact LOD0 position-set equality in the audited built basis; not full skinning/material parity'},
        'models': models, 'unsupported': ['hair selection', 'face item overrides', 'transformed pawns']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = build()
    if args.check:
        if json.loads(OUTPUT.read_text()) != result:
            raise SystemExit('appearance catalog differs from original/current models; regenerate explicitly')
    else:
        OUTPUT.write_text(json.dumps(result, indent=2) + '\n')
    print(f"PASS Elbera Tools face catalog: {len(result['models'])} source-bound models, "
          f"{sum(len(m['faces']) for m in result['models'].values())} exact face choices")
