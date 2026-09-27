"""Elbera Tools: qualified NPC sparse keys and bounded built-rig correspondence.

Original inputs are read afresh through recover_selectors and serialized
Mesh.Animation references. Built aliases are only a path locator: admission
requires actual LOD0 triangle POSITION/UV/winding and bone-parent-path checks.
Skin weights, inverse binds, actor placement and native playback stay separate.
All returned game records are private data; this module writes nothing.
"""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
INDEX_FORMAT = 'elbera-original-npc-animation-runtime-index-v1'


def npc_model_id(mesh_ref):
    if not isinstance(mesh_ref, str) or not re.fullmatch(
            r'[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+', mesh_ref):
        raise ValueError('qualified original NPC mesh reference required')
    return 'npc_' + hashlib.sha256(mesh_ref.lower().encode('utf8')).hexdigest()[:32]


def name_bindings(mesh_bones, animation_bones, mesh_package, animation_package):
    """Conservative decoded-name equivalence, not package-local token equality.

    Each participating spelling must have one casefold-unique source name-table
    token. Different exact spellings with the same casefold key are rejected by
    the shared adapter. Only same-package tokens are compared as integers.
    """
    from check_animation_linkup_native import decoded_name_linkup, first_interned_linkup
    bindings = decoded_name_linkup([b['name'] for b in mesh_bones],
                                   [b['name'] for b in animation_bones])
    def tokens(package, bones):
        table = {}
        for i, name in enumerate(package.names):
            table.setdefault(name.casefold(), []).append(i)
        result = []
        for bone in bones:
            matches = table.get(bone['name'].casefold(), [])
            if len(matches) != 1:
                raise ValueError('missing or ambiguous original NPC name-table token')
            result.append(matches[0])
        return result
    mesh_tokens, animation_tokens = tokens(mesh_package, mesh_bones), tokens(animation_package, animation_bones)
    if mesh_package is animation_package and bindings != first_interned_linkup(mesh_tokens, animation_tokens):
        raise ValueError('NPC decoded linkup differs from original name-table tokens')
    return bindings


def _local_file(base, name):
    if not isinstance(name, str) or not name or '\\' in name or any(c in name for c in '?#%:'):
        raise ValueError('local built NPC path required')
    relative = PurePosixPath(name)
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError('built NPC path escapes its directory')
    path = (base / relative).resolve()
    if not path.is_relative_to(base.resolve()) or not path.is_file():
        raise ValueError('missing or escaped built NPC file')
    return path


def built_correspondence(base, diagnostic, source):
    """Hash actual bytes after independent source geometry and bone matching."""
    from build_hair import built_binding, original_bone_paths, built_bone_paths
    if not isinstance(diagnostic, dict) or 'gltf' not in diagnostic:
        raise ValueError('no existing NPC model path to verify')
    manifest = json.loads((base / 'manifest.json').read_bytes())
    entries = [row for row in manifest['models'] if row.get('gltf') == diagnostic['gltf']]
    if (len(entries) != 1 or not isinstance(entries[0].get('id'), str)
            or not re.fullmatch(r'[A-Za-z0-9_]+', entries[0]['id'])):
        raise ValueError('ambiguous or invalid built NPC manifest identity')
    path = _local_file(base, diagnostic['gltf'])
    raw = path.read_bytes()
    gltf = json.loads(raw)
    buffers, fingerprints = [], []
    for row in gltf.get('buffers', []):
        data = _local_file(path.parent, row.get('uri')).read_bytes()
        if type(row.get('byteLength')) is not int or len(data) != row['byteLength']:
            raise ValueError('built NPC buffer byte length differs')
        buffers.append(data)
        fingerprints.append({'uri': row['uri'], 'byteLength': len(data),
                             'SHA256': hashlib.sha256(data).hexdigest()})
    binding = built_binding(gltf, buffers, source)
    paths = built_bone_paths(gltf)
    nodes = []
    for path_key in original_bone_paths(source['bones']):
        found = [i for i, p in enumerate(paths) if p == path_key]
        if len(found) != 1:
            raise ValueError('missing or ambiguous original NPC bone-parent path')
        nodes.append(found[0])
    joints = gltf['skins'][binding['skinIndex']]['joints']
    if len(set(joints)) != len(joints) or len(set(nodes)) != len(nodes) or set(joints) != set(nodes):
        raise ValueError('built NPC skin does not uniquely cover original bones')
    return {'modelId': entries[0]['id'], 'gltf': diagnostic['gltf'], 'gltfSHA256': hashlib.sha256(raw).hexdigest(),
        'buffers': fingerprints, 'meshIndex': binding['meshIndex'], 'skinIndex': binding['skinIndex'],
        'boneNodes': nodes, 'sourceBones': len(nodes), 'sourceVertices': len(source['vertices']),
        'sourceTriangles': sum(s['numFaces'] for s in source[source['stream'] + 'Sections']),
        'sourceLOD0SHA256': source['sourceLOD0']['SHA256'],
        'geometryProof': {'status': 'triangle-position-uv-winding-exact',
                          'method': binding['geometryProof']},
        'boneProof': 'unique source name/parent paths; every source bone maps to one built skin joint',
        'skinProof': {'status': 'unverified',
            'checkedVertices': binding['skinProof']['checkedVertices'],
            'differentInfluenceVertices': binding['skinProof']['differentInfluenceVertices'],
            'limits': ['existing weights retained; no native weight, inverse-bind or actor-placement certification']}}


def collect_npcs(npc_ids):
    """Return complete catalog/skeleton dictionaries and an index, no writes."""
    if (not isinstance(npc_ids, (list, tuple)) or not npc_ids
            or any(type(i) is not int or not 0 < i <= 0x7fffffff for i in npc_ids)
            or len(set(npc_ids)) != len(npc_ids)):
        raise ValueError('distinct explicit positive NPC IDs required')
    sys.path[:0] = [str(ROOT / p) for p in ('tools/dat', 'tools/ui', 'tools/src/char_pipeline')]
    from build_hair import Sources, source_lod0
    from build_npc_variants import recover_selectors, unique_source_export, mesh_animation_reference
    from build_pawnanim import original_animation, source_ref_path
    with tempfile.TemporaryDirectory(prefix='elbera-npc-source-') as tmp:
        selectors = recover_selectors(tmp, npc_ids)
    if set(selectors['npcs']) != {str(i) for i in npc_ids}:
        raise ValueError('source selector NPC set differs from request')
    sources, catalogs, skeletons, models, npcs = Sources(), {}, {}, {}, {}
    def package(reference):
        npc_model_id(reference)  # Same qualified-reference syntax, not identity assignment.
        return sources.get('animations', reference.split('.', 1)[0])
    for npc_id in sorted(selectors['npcs'], key=int):
        row = selectors['npcs'][npc_id]
        mesh_ref = row['meshName']
        model_id = npc_model_id(mesh_ref)
        mesh_record = selectors['meshes'].get(mesh_ref.casefold())
        if row.get('status') != 'source-animation' or not mesh_record or mesh_record.get('status') != 'source-animation':
            raise ValueError('NPC has no resolved original animation source: ' + npc_id)
        animation_ref = mesh_record['animation']
        if model_id not in models:
            mesh_package = package(mesh_ref)
            mesh_export = unique_source_export(mesh_package, mesh_ref, 'SkeletalMesh')
            stored_ref, reference_proof = mesh_animation_reference(mesh_package, mesh_export)
            if stored_ref.casefold() != animation_ref.casefold():
                raise ValueError('NPC source Animation reference changed during collection')
            mesh = source_lod0(mesh_package, mesh_export)
            full_mesh_ref = source_ref_path(mesh_package, mesh_export.index + 1, Path(mesh_package.path).stem)
            lod_ref = source_ref_path(mesh_package, mesh['animationReference'], Path(mesh_package.path).stem)
            if (full_mesh_ref.casefold() != mesh_ref.casefold() or not lod_ref
                    or lod_ref.casefold() != stored_ref.casefold()
                    or mesh['sourceExportSHA256'] != reference_proof['sourceExportSHA256']
                    or mesh['sourceExportSHA256'] != mesh_record['sourceExportSHA256']):
                raise ValueError('NPC original mesh/reference readers disagree')
            animation_package = package(animation_ref)
            animation_export = unique_source_export(animation_package, animation_ref, 'MeshAnimation')
            animation = original_animation(animation_package, animation_export, include_tracks=True)
            start, size = animation_export.serial_offset, animation_export.serial_size
            animation_sha = hashlib.sha256(animation_package.data[start:start + size]).hexdigest()
            selected_animation = selectors['animations'].get(animation_ref.casefold(), {})
            if animation_sha != selected_animation.get('sourceExportSHA256'):
                raise ValueError('NPC source animation changed during collection')
            source = {'meshPackageSHA256': hashlib.sha256(Path(mesh_package.path).read_bytes()).hexdigest(),
                'animationPackageSHA256': hashlib.sha256(Path(animation_package.path).read_bytes()).hexdigest(),
                'meshExportSHA256': mesh['sourceExportSHA256'], 'animationExportSHA256': animation_sha}
            for pkg, key in ((mesh_package, 'meshPackageSHA256'), (animation_package, 'animationPackageSHA256')):
                if selectors['sources'].get('animations/' + Path(pkg.path).name) != source[key]:
                    raise ValueError('NPC original package changed during collection')
            catalogs[model_id] = {'format': 'elbera-original-animation-tracks-v1',
                'modelId': model_id, 'meshRef': full_mesh_ref, 'animationRef': stored_ref,
                'source': {'packageSHA256': source['animationPackageSHA256'], 'exportSHA256': animation_sha,
                    'fileVersion': animation_package.file_version, 'licenseeVersion': animation_package.licensee_version,
                    'exportOffset': start, 'exportSize': size}, **animation}
            skeletons[model_id] = {'format': 'elbera-original-npc-skeleton-v1', 'modelId': model_id,
                'meshRef': full_mesh_ref, 'animationRef': stored_ref, 'bones': mesh['bones'],
                'animationBones': animation['bones'],
                'trackBindings': name_bindings(mesh['bones'], animation['bones'], mesh_package, animation_package),
                'source': source, 'animationReferenceProof': reference_proof}
            models[model_id] = {'meshRef': full_mesh_ref, 'animationRef': stored_ref, 'source': source,
                'bundle': 'animation-tracks/runtime/' + model_id + '.l2anim',
                'built': built_correspondence(ROOT / 'editor/characters/monsters', mesh_record.get('built'), mesh)}
        elif (models[model_id]['meshRef'].casefold() != mesh_ref.casefold()
              or models[model_id]['animationRef'].casefold() != animation_ref.casefold()):
            raise ValueError('conflicting original NPC bundle identity')
        npcs[npc_id] = {'className': row['className'], 'meshRef': models[model_id]['meshRef'],
            'animationRef': models[model_id]['animationRef'], 'modelId': model_id,
            'inheritance': row['inheritance'], 'selectors': row['selectors']}
    index = {'format': INDEX_FORMAT, 'edition': 'Interlude', 'npcs': npcs, 'models': models,
        'sources': selectors['sources'], 'sourceSHA256': selectors['sourceSHA256'],
        'scope': {'selection': 'explicit requested NPC IDs; index replaced as one selected set',
            'transport': 'authored ELBA transport; all original sparse sequences and keys retained',
            'built': 'source LOD0 geometry and bone-parent paths; skin weights and actor placement unverified',
            'playback': 'source inputs only; original NPC state, rate and modifier admission remains separate'}}
    return catalogs, skeletons, index
