#!/usr/bin/env python3
"""Build the upscale manifest for the world-texture HD pilot.

Writes /tmp/hd_manifest.tsv: <abs LQ src>\t<abs HD dst> per line, one entry
per texture REFERENCED by scene.json (terrain layer diffuses + prop gltf
images). Orphan files and splat maps (blend weights, not art) are skipped;
*_sp specular-alpha textures are refused outright.

Usage: python3 tools/upscale/world_manifest.py [tile ...]
       (default tiles: 17_25 22_22 — the pilot set)
"""
import glob
import json
import os
import sys

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                     "..", ".."))
OUT = "/tmp/hd_manifest.tsv"


def referenced(tile):
    root = os.path.join(REPO, "assets", "world", tile)
    scene = json.load(open(os.path.join(root, "scene.json")))
    ref = set()
    for layer in scene.get("layers", []):
        if layer.get("diffuse"):
            ref.add("textures/" + os.path.basename(layer["diffuse"]))
    for gltf in glob.glob(os.path.join(root, "props", "*.gltf")):
        try:
            g = json.load(open(gltf))
        except (OSError, ValueError):
            continue
        for img in g.get("images", []):
            uri = img.get("uri", "")
            if uri.startswith("textures/"):
                ref.add("props/textures/" + os.path.basename(uri))
    return root, sorted(ref)


def main():
    tiles = sys.argv[1:] or ["17_25", "22_22"]
    n = 0
    with open(OUT, "w") as fh:
        for tile in tiles:
            root, ref = referenced(tile)
            for rel in ref:
                assert not rel.endswith("_sp.png"), f"specular mask: {rel}"
                src = os.path.join(root, rel)
                dst = os.path.join(REPO, "assets", "world-hd", tile, rel)
                assert os.path.isfile(src), f"missing: {src}"
                fh.write(f"{src}\t{dst}\n")
                n += 1
    print(f"{OUT}: {n} entries ({', '.join(tiles)})")


if __name__ == "__main__":
    main()
