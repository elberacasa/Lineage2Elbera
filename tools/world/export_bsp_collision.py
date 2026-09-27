#!/usr/bin/env python3
"""Elbera Tools: stage original UModel BSP records, never render glTF geometry.

python3 tools/world/export_bsp_collision.py 17_25 --check
python3 tools/world/export_bsp_collision.py 17_25 --stage tmp/restart-audit/bsp-17_25

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
from l2lib import level_model, load_package
from export_static_collision import qualified_ref

FORMAT = 'l2-bsp-collision-source-v1'
sha = lambda data: hashlib.sha256(data).hexdigest()


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
    checks = validate_model(model)
    export = model.export
    start, end = export.serial_offset, export.serial_offset + export.serial_size
    prefix_end = model.source_spans['undecoded_tail'][0]
    def ref(value):
        return None if value == 0 else {'reference': value, 'qualified': qualified_ref(pkg, value)}
    source = {'file': tile + '.unr', 'originalSHA256': original_sha,
              'decodedPackageSHA256': sha(pkg.data), 'protocol': protocol,
              'fileVersion': pkg.file_version, 'licenseeVersion': pkg.licensee_version,
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
                         'serialized model selection uses unique NumZones>0; no runtime Level.Model binding claim']}
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
    args = parser.parse_args()
    if not re.fullmatch(r'\d{2}_\d{2}', args.tile): parser.error('expected original tile name NN_NN')
    target = stage_path(args.stage) if args.stage else None
    path = ROOT / 'assets/interlude/maps' / (args.tile + '.unr')
    pkg, protocol = load_package(path)
    if pkg.file_version != 123: raise ValueError('only the reviewed file-version123 UModel layout is supported')
    model = level_model(pkg)
    if model is None: raise ValueError('no unique zoned level model')
    data = export_model(pkg, model, args.tile, sha(path.read_bytes()), protocol)
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
    print(json.dumps({'tool': 'Elbera Tools', 'tile': args.tile, 'counts': summary['counts'],
                      'validation': summary['validation'], 'stage': str(target) if target else None}))


if __name__ == '__main__':
    main()
