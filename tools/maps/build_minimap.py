#!/usr/bin/env python3
"""Stage the retail minimap imagery and write the minimap manifest.

Inputs (NCSoft assets, gitignored, already extracted from the client):
  assets/library/L2Font-e/int_worldmap{1..6}.png     6x 1024x1024 world-map pieces
  assets/library/town_map/town_map_*_t00.png         512x512 starting-village maps
  assets/library/T_Giran/{22_21,23_21,24_21}_map.png 512x512 Giran-area town maps

Outputs:
  assets/world/minimap/worldmap.png        assembled 2048x3072 world map  (gitignored)
  assets/world/minimap/tiles/<tx>_<ty>.png uniform 256x256 per-tile crops (gitignored)
  assets/world/minimap/towns/<name>.png    town map copies                (gitignored)
  assets/gamedata/minimap.json             tracked manifest: georeference,
                                           per-tile rects, town signboards

Georeference of the assembled world map (derivation + error bars and the
TI-village cross-check live in docs/minimap-mapping.md):

    px = (x - X0) / S      py = (y - Y0) / S
    X0 = -127750   Y0 = -250000   S = 196.3 world-units per pixel

Piece layout (verified by terrain/label continuity across seams):

    [ int_worldmap1  int_worldmap2 ]     y rows: 1-2 = piece rows 0..1023
    [ int_worldmap3  int_worldmap4 ]     3-4 = 1024..2047
    [ int_worldmap5  int_worldmap6 ]     5-6 = 2048..3071
"""
import json
import os
import re
import xml.etree.ElementTree as ET

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIB = os.path.join(ROOT, "assets/library")
WORLD = os.path.join(ROOT, "assets/world")
OUT = os.path.join(WORLD, "minimap")
MANIFEST = os.path.join(ROOT, "assets/gamedata/minimap.json")
STATIC_OBJECTS = os.path.join(ROOT, "server/aCis_datapack/data/xml/staticObjects.xml")

# Georeference (see module docstring / docs/minimap-mapping.md)
X0, Y0, S = -127750.0, -250000.0, 196.3
MAP_W, MAP_H = 2048, 3072
PIECE_LAYOUT = {1: (0, 0), 2: (1024, 0), 3: (0, 1024),
                4: (1024, 1024), 5: (0, 2048), 6: (1024, 2048)}
TILE_PX = 256          # uniform output size of per-tile crops
T = 32768              # world units per map tile

TOWN_MAPS = {
    "town_map_talking_t00": ("town_map/town_map_talking_t00.png", "Talking Island Village"),
    "town_map_elf_t00":     ("town_map/town_map_elf_t00.png",     "Elven Village"),
    "town_map_darkelf_t00": ("town_map/town_map_darkelf_t00.png", "Dark Elven Village"),
    "town_map_orc_t00":     ("town_map/town_map_orc_t00.png",     "Orc Village"),
    "town_map_dwarf_t00":   ("town_map/town_map_dwarf_t00.png",   "Dwarven Village"),
    "22_21_map":            ("T_Giran/22_21_map.png",             "Giran area tile 22_21"),
    "23_21_map":            ("T_Giran/23_21_map.png",             "Giran area tile 23_21"),
    "24_21_map":            ("T_Giran/24_21_map.png",             "Giran area tile 24_21"),
}

# Independent anchors for client-side self-tests (world coords verified in
# docs/tile-map.md from aCis teleports; pixel values produced by this script).
ANCHORS = {
    "talking_island_village": (-84141, 244623),
    "elven_ruins_ti": (-112367, 234703),
    "gludin_village": (-80826, 149775),
    "town_of_giran": (83314, 148012),
    "town_of_aden": (144635, 26664),
    "dwarven_village": (115120, -178224),
}


def world_to_px(x, y):
    return (x - X0) / S, (y - Y0) / S


def tile_world_rect(tx, ty):
    return [(tx - 20) * T, (ty - 18) * T, (tx - 19) * T, (ty - 17) * T]


def assemble_worldmap():
    world = Image.new("RGB", (MAP_W, MAP_H))
    for n, (ox, oy) in PIECE_LAYOUT.items():
        path = os.path.join(LIB, "L2Font-e", f"int_worldmap{n}.png")
        piece = Image.open(path).convert("RGB")
        assert piece.size == (1024, 1024), f"{path}: unexpected size {piece.size}"
        world.paste(piece, (ox, oy))
    return world


def converted_tiles():
    tiles = set()
    for f in os.listdir(WORLD):
        if re.fullmatch(r"\d+_\d+", f) and os.path.isdir(os.path.join(WORLD, f)):
            tx, ty = f.split("_")
            tiles.add((int(tx), int(ty)))
    return sorted(tiles)


def read_signboards():
    """aCis staticObjects.xml: map signboards carry (world x,y) -> town-map
    pixel (mapX,mapY) pairs — the only town-map georeference evidence."""
    boards = {}
    if not os.path.exists(STATIC_OBJECTS):
        return boards
    tree = ET.parse(STATIC_OBJECTS)
    for obj in tree.getroot().iter("object"):
        tex = obj.get("texture", "")
        if not tex.startswith("town_map_"):
            continue
        boards.setdefault(tex, []).append({
            "world": [int(obj.get("x")), int(obj.get("y"))],
            "mapPx": [int(obj.get("mapX")), int(obj.get("mapY"))],
            "comment": (obj.get("comment") or "").strip(),
        })
    return boards


def main():
    os.makedirs(os.path.join(OUT, "tiles"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "towns"), exist_ok=True)

    world = assemble_worldmap()
    world.save(os.path.join(OUT, "worldmap.png"))

    tiles = converted_tiles()
    tile_entries = {}
    clipped = []
    for tx, ty in tiles:
        wx0, wy0, wx1, wy1 = tile_world_rect(tx, ty)
        px0, py0 = world_to_px(wx0, wy0)
        px1, py1 = world_to_px(wx1, wy1)
        # tiles at the map's west edge spill a thin strip off the image
        # (retail cuts the far-west ocean margin); fill it with parchment
        cx0, cy0 = max(px0, 0.0), max(py0, 0.0)
        cx1, cy1 = min(px1, float(MAP_W)), min(py1, float(MAP_H))
        assert cx1 > cx0 and cy1 > cy0, f"tile {tx}_{ty} fully outside world map"
        crop = world.crop((int(cx0), int(cy0), int(cx1) + 1, int(cy1) + 1))
        is_clipped = (cx0, cy0, cx1, cy1) != (px0, py0, px1, py1)
        if is_clipped:
            clipped.append(f"{tx}_{ty}")
        canvas = Image.new("RGB", (TILE_PX, TILE_PX), (190, 182, 165))  # parchment
        dx = int(round((cx0 - px0) / (px1 - px0) * TILE_PX))
        dy = int(round((cy0 - py0) / (py1 - py0) * TILE_PX))
        dw = int(round((cx1 - cx0) / (px1 - px0) * TILE_PX))
        dh = int(round((cy1 - cy0) / (py1 - py0) * TILE_PX))
        canvas.paste(crop.resize((max(dw, 1), max(dh, 1)), Image.LANCZOS), (dx, dy))
        name = f"{tx}_{ty}"
        canvas.save(os.path.join(OUT, "tiles", f"{name}.png"))
        tile_entries[name] = {
            "file": f"tiles/{name}.png",
            "size": [TILE_PX, TILE_PX],
            "worldRect": [wx0, wy0, wx1, wy1],
            "srcPxRect": [round(px0, 2), round(py0, 2), round(px1, 2), round(py1, 2)],
        }
        if is_clipped:
            tile_entries[name]["clipped"] = True

    boards = read_signboards()
    town_entries = {}
    for tex, (src, label) in TOWN_MAPS.items():
        src_path = os.path.join(LIB, src)
        if not os.path.exists(src_path):
            print(f"  WARN missing {src_path}")
            continue
        img = Image.open(src_path).convert("RGB")
        out_name = f"{tex}.png"
        img.save(os.path.join(OUT, "towns", out_name))
        town_entries[tex] = {
            "file": f"towns/{out_name}",
            "label": label,
            "size": list(img.size),
            "signboards": boards.get(tex, []),
        }

    manifest = {
        "comment": "Retail minimap imagery + georeference. Regenerate: "
                   "python3 tools/maps/build_minimap.py. Spec: docs/minimap-mapping.md.",
        "worldmap": {
            "file": "worldmap.png",
            "size": [MAP_W, MAP_H],
            "source": "assets/library/L2Font-e/int_worldmap{1..6}.png (L2Font-e.utx)",
            "pieceLayout": {str(n): [ox, oy] for n, (ox, oy) in PIECE_LAYOUT.items()},
            "georeference": {
                "formula": "px=(x-X0)/S, py=(y-Y0)/S (assembled 2048x3072 image)",
                "X0": X0, "Y0": Y0, "S": S,
                "unitsPerPixel": S,
                "tilePixels": round(T / S, 2),
                "uncertainty": "X0 +/-1500, Y0 +/-2000 world units, S +/-1 (see docs)",
            },
            "coveredWorldRect": [X0, Y0, X0 + MAP_W * S, Y0 + MAP_H * S],
        },
        "anchors": {
            name: {"world": [x, y], "px": [round(v, 1) for v in world_to_px(x, y)]}
            for name, (x, y) in ANCHORS.items()
        },
        "tiles": tile_entries,
        "townMaps": town_entries,
    }
    with open(MANIFEST, "w") as f:
        json.dump(manifest, f, indent=1)
        f.write("\n")

    print(f"  worldmap.png           {MAP_W}x{MAP_H}")
    print(f"  tiles/                 {len(tile_entries)} tile crops ({TILE_PX}x{TILE_PX})"
          f", clipped at map edge: {clipped}")
    print(f"  towns/                 {len(town_entries)} town maps")
    print(f"  {os.path.relpath(MANIFEST, ROOT)}  manifest, {len(tile_entries)} tiles, "
          f"{len(ANCHORS)} anchors")
    print("done.")


if __name__ == "__main__":
    main()
