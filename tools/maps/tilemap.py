#!/usr/bin/env python3
"""Build the definitive Interlude tile -> named-region map.

Sources (all cross-checked):
  a) aCis spawnlist   server/aCis_datapack/data/xml/spawnlist/<tile>.xml
     - header comment names the AREA and hunting grounds of the tile
     - territory node coords are verified to fall inside the tile rect
  b) aCis teleports   server/aCis_datapack/data/xml/teleports.xml (+instantTeleports.xml)
     - named destinations with world coords -> tile indices
  c) aCis zones       server/aCis_datapack/data/xml/zones/*.xml
     - zone name comments + polygon nodes -> tile indices
  d) aCis castles/clanHalls world coords

World transform (validated in docs/map-format.md):
  tile (tx,ty) corner = ((tx-20)*32768, (ty-18)*32768); tile size 32768.

Output:
  assets/world/tile-map.json
  stdout: verification report
"""
import os, re, json, sys, math
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MAPS = os.path.join(ROOT, "assets/interlude/maps")
DATA = os.path.join(ROOT, "server/aCis_datapack/data/xml")
OUT  = os.path.join(ROOT, "assets/world")

T = 32768
def tile_of(x, y):
    return (int(math.floor(x / T)) + 20, int(math.floor(y / T)) + 18)

def rect_of(tx, ty):
    return [(tx - 20) * T, (ty - 18) * T, (tx - 20) * T + T, (ty - 18) * T + T]

def in_rect(x, y, r):
    return r[0] <= x < r[2] and r[1] <= y < r[3]

# ---------------------------------------------------------------- tiles on disk
tiles = set()
for f in os.listdir(MAPS):
    m = re.fullmatch(r"(\d+)_(\d+)\.unr", f)
    if m:
        tiles.add((int(m.group(1)), int(m.group(2))))

info = {}  # (tx,ty) -> dict
def entry(tx, ty):
    return info.setdefault((tx, ty), {
        "areas": [], "places": [], "zones": [], "sources": set(),
        "spawn_coords_in": 0, "spawn_coords_out": 0,
        "territory_embed_match": None,
    })

# ---------------------------------------------------------------- (a) spawnlist
def parse_comment_header(text):
    """Top <!-- ... --> block of a spawnlist file -> area/bullet labels."""
    m = re.search(r"<!--(.*?)-->", text, re.S)
    if not m:
        return []
    labels = []
    for line in m.group(1).splitlines():
        line = line.strip().lstrip("*").strip()
        if line:
            labels.append(line)
    return labels

spawn_dir = os.path.join(DATA, "spawnlist")
for f in sorted(os.listdir(spawn_dir)):
    m = re.fullmatch(r"(\d+)_(\d+)\.xml", f)
    if not m:
        continue
    tx, ty = int(m.group(1)), int(m.group(2))
    text = open(os.path.join(spawn_dir, f), encoding="utf-8").read()
    e = entry(tx, ty)
    e["sources"].add("spawnlist")
    for lab in parse_comment_header(text):
        if lab not in e["areas"]:
            e["areas"].append(lab)
    r = rect_of(tx, ty)
    # territory names embed the tile: e.g. gludio15_1621_01 -> "1621".
    # Seven Signs files are dungeon interiors: their territory names embed the
    # SURFACE tile (e.g. ssq06_2122_* in 18_10) — mismatch is expected there.
    embeds = set(re.findall(r'territory name="[a-z0-9]*?_(\d{2})(\d{2})_', text))
    if embeds:
        e["territory_embed_match"] = any(
            int(a) == tx and int(b) == ty for a, b in embeds)
    # verify all territory node coords fall in this tile's rect
    for nx, ny in re.findall(r'<node x="(-?\d+)" y="(-?\d+)"/>', text):
        if in_rect(int(nx), int(ny), r):
            e["spawn_coords_in"] += 1
        else:
            e["spawn_coords_out"] += 1

# ---------------------------------------------------------------- (b) teleports
def parse_teleports(path, with_desc):
    out = []
    text = open(path, encoding="utf-8").read()
    if with_desc:
        for desc, x, y, z in re.findall(
                r'<loc desc="([^"]+)"[^>]*?x="(-?\d+)" y="(-?\d+)" z="(-?\d+)"', text):
            out.append((desc, int(x), int(y)))
    else:
        # instant teleports: nearest preceding comment is the label
        for cm in re.finditer(r'<!--\s*([^>]+?)\s*-->|<loc x="(-?\d+)" y="(-?\d+)"', text):
            pass
        # simpler: walk blocks
        last_label = None
        for line in text.splitlines():
            cm = re.search(r"<!--\s*(.+?)\s*-->", line)
            if cm and "<loc" not in line:
                last_label = cm.group(1)
            lm = re.search(r'<loc x="(-?\d+)" y="(-?\d+)"', line)
            if lm and last_label:
                out.append((last_label, int(lm.group(1)), int(lm.group(2))))
    return out

named_points = []  # (desc, x, y) for the verification report
for desc, x, y in parse_teleports(os.path.join(DATA, "teleports.xml"), True):
    tx, ty = tile_of(x, y)
    e = entry(tx, ty)
    e["sources"].add("teleports")
    if desc not in e["places"]:
        e["places"].append(desc)
    named_points.append((desc, x, y))
for desc, x, y in parse_teleports(os.path.join(DATA, "instantTeleports.xml"), False):
    tx, ty = tile_of(x, y)
    e = entry(tx, ty)
    e["sources"].add("teleports")
    if desc not in e["places"]:
        e["places"].append(desc)
    named_points.append((desc, x, y))

# ---------------------------------------------------------------- (c) zones
zone_dir = os.path.join(DATA, "zones")
ZONE_SKIP = {"residence_territory"}
for f in sorted(os.listdir(zone_dir)):
    if not f.endswith(".xml"):
        continue
    text = open(os.path.join(zone_dir, f), encoding="utf-8").read()
    # zones are: <zone ...><!-- name -->  <node .../> ... </zone>  (comment inside or after open tag)
    for zm in re.finditer(r"<zone [^>]*>(?:<!--\s*([a-z0-9_]+)\s*-->)?(.*?)</zone>", text, re.S):
        name = zm.group(1)
        body = zm.group(2)
        if not name:
            cm = re.search(r"<!--\s*([a-z0-9_]+)\s*-->", body)
            name = cm.group(1) if cm else None
        if not name or name in ZONE_SKIP:
            continue
        nodes = [(int(a), int(b)) for a, b in
                 re.findall(r'<node x="(-?\d+)" y="(-?\d+)"/>', body)]
        if not nodes:
            continue
        cx = sum(n[0] for n in nodes) / len(nodes)
        cy = sum(n[1] for n in nodes) / len(nodes)
        tx, ty = tile_of(cx, cy)
        e = entry(tx, ty)
        e["sources"].add("zones")
        if name not in e["zones"]:
            e["zones"].append(name)

# ---------------------------------------------------------------- (d) castles
text = open(os.path.join(DATA, "castles.xml"), encoding="utf-8").read()
for cm in re.finditer(r'<castle id="\d+"[^>]*?name="([^"]+)"[^>]*?>(.*?)</castle>', text, re.S):
    name, body = cm.group(1), cm.group(2)
    am = re.search(r'<artifact id="\d+" pos="(-?\d+);(-?\d+);', body)
    if am:
        tx, ty = tile_of(int(am.group(1)), int(am.group(2)))
        e = entry(tx, ty)
        e["sources"].add("castles")
        if name not in e["places"]:
            e["places"].append(name)

# ---------------------------------------------------------------- synthesize
def pretty(zone):
    return zone.replace("_", " ").strip()

result = {}
report = []
for (tx, ty), e in sorted(info.items()):
    if (tx, ty) not in tiles:
        continue  # spawns outside the shipped map set (e.g. 26_15 catacombs interior ok to skip)
    r = rect_of(tx, ty)
    name = None
    confidence = "low"
    if e["areas"]:
        name = e["areas"][0].replace(" Area", "")
        nsrc = len(e["sources"])
        total = e["spawn_coords_in"] + e["spawn_coords_out"]
        # territory polygons may spill a few nodes across a tile border
        coords_ok = total == 0 or e["spawn_coords_out"] / total <= 0.01
        interior = e["areas"][0] == "Seven Signs"
        embed_ok = interior or e["territory_embed_match"] in (True, None)
        if nsrc >= 2 and coords_ok and embed_ok:
            confidence = "high"
        elif coords_ok:
            confidence = "medium"
    elif e["zones"] or e["places"]:
        # off-world utility tiles (instanced content stored in far tiles)
        ztxt = pretty(" ".join(e["zones"]))
        if "gm room" in ztxt:
            name, confidence = "GM Room (off-world)", "high"
        elif "olympiad stadium" in ztxt:
            name, confidence = "Olympiad Stadium (off-world)", "high"
        else:
            cand = e["zones"][0] if e["zones"] else e["places"][0]
            name = pretty(cand)
            confidence = "medium" if len(e["sources"]) >= 2 else "low"
    else:
        continue
    notable = []
    for lab in e["areas"][1:]:
        notable.append(lab)
    for z in e["zones"]:
        pz = pretty(z)
        if pz not in notable:
            notable.append(pz)
    for p in e["places"]:
        if p not in notable:
            notable.append(p)
    result["%d_%d" % (tx, ty)] = {
        "name": name,
        "notable": notable,
        "worldRect": r,
        "confidence": confidence,
        "sources": sorted(e["sources"]),
    }
    report.append(((tx, ty), e, name, confidence))

os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- pass 2: terrain
# Classify map tiles no game data named, using the extracted G16 heightmaps
# (tools/maps/out/<tile>.heightmap.u16). Constant 16384 = flat ocean/stub.
import struct
OUTDIR = os.path.join(ROOT, "tools/maps/out")

MANUAL = {
    # NE quadrant of the Talking Island landmass: real relief, no spawns/zones.
    "17_24": ("Talking Island", ["Talking Island, north-east quadrant (terrain only)"], "medium"),
    # aCis PeaceZone 'gludio_platform_peace1' (-151k..-147k, 252k..257k): boat platform
    "15_25": ("Ocean (Talking Island approach)", ["boat platform (gludio_platform peace zone)"], "low"),
    "19_11": ("Off-world (no terrain data)", [], "low"),
    "20_11": ("Off-world (no terrain data)", [], "low"),
    "20_24": ("South Dion coast (retail 'beres' zone)", ["20_24_beres_01 zone (retail zone names embed the tile index)"], "low"),
}

def heightmap_range(tile):
    p = os.path.join(OUTDIR, tile + ".heightmap.u16")
    if not os.path.exists(p):
        return None
    data = open(p, "rb").read()
    vals = struct.unpack("<%dH" % (len(data) // 2), data)
    return min(vals), max(vals)

for (tx, ty) in sorted(tiles):
    key = "%d_%d" % (tx, ty)
    r = rect_of(tx, ty)
    if key in MANUAL:
        name, notable, conf = MANUAL[key]
        result[key] = {"name": name, "notable": notable, "worldRect": r,
                       "confidence": conf,
                       "sources": sorted(set(result.get(key, {}).get("sources", [])) | {"terrain"})}
        continue
    if key in result:
        continue
    hr = heightmap_range(key)
    if hr is None:
        continue
    if hr[0] == hr[1] == 16384:
        result[key] = {"name": "Ocean", "notable": [], "worldRect": r,
                       "confidence": "medium", "sources": ["terrain"]}
    elif hr[1] > 16384:
        result[key] = {"name": "Unnamed terrain", "notable": ["relief present; no game data"], "worldRect": r,
                       "confidence": "low", "sources": ["terrain"]}
    else:
        result[key] = {"name": "Ocean (flat seabed)", "notable": [], "worldRect": r,
                       "confidence": "low", "sources": ["terrain"]}

with open(os.path.join(OUT, "tile-map.json"), "w") as fh:
    json.dump(result, fh, indent=1, ensure_ascii=False, sort_keys=True)


# ---------------------------------------------------------------- verification report
print("== spawnlist coordinate verification (nodes outside own tile rect) ==")
bad = 0
for (tx, ty), e, name, conf in report:
    if e["spawn_coords_out"]:
        bad += 1
        print("  %d_%d: %d/%d nodes OUTSIDE rect (%s)" % (
            tx, ty, e["spawn_coords_out"],
            e["spawn_coords_in"] + e["spawn_coords_out"], name))
    if e["territory_embed_match"] is False:
        print("  %d_%d: territory-name tile embed MISMATCH" % (tx, ty))
print("  files with out-of-rect nodes: %d / %d" % (bad, len(report)))

print("\n== named teleport destinations -> tile ==")
seen = set()
for desc, x, y in sorted(set(named_points)):
    tx, ty = tile_of(x, y)
    key = (desc, tx, ty)
    if key in seen:
        continue
    seen.add(key)
    mark = "" if (tx, ty) in tiles else "  [no .unr]"
    print("  %-55s (%7d,%7d) -> %d_%d%s" % (desc, x, y, tx, ty, mark))

print("\n== tiles named: %d (of %d map tiles) ==" % (len(result), len(tiles)))
for k in sorted(result, key=lambda s: (int(s.split("_")[0]), int(s.split("_")[1]))):
    v = result[k]
    print("  %-6s %-9s %-28s src=%s" % (k, v["confidence"], v["name"], ",".join(v["sources"])))
