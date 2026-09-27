"""Preserve UE2 terrain topology without guessing native rendering conventions.

The serialized arrays are uint32 bit patterns, even though Unreal exposes
array<int>. Word order and every bit are preserved, including the Orig variants
used by the client. A separate native sector table verifies ordinary-quad
visibility per map. Only the exact investigated engine can additionally prove
diagonal selection and PostLoad bitmap rules. This does not establish the
complete native streaming, height transformation or lighting behavior.
"""

import array
import copy
import hashlib
import json
import math
import os
import struct
import tempfile

from l2lib import L2Error, Reader

FORMAT = "ue2-terrain-topology-v1"
FILENAME = "terrain-topology.json"
PROPERTIES = {
    "QuadVisibilityBitmap": "visibility",
    "EdgeTurnBitmap": "edgeTurn",
    "QuadVisibilityBitmapOrig": "visibilityOrig",
    "EdgeTurnBitmapOrig": "edgeTurnOrig",
}
UNVERIFIED = {
    "status": "unverified",
    "indexOrder": None,
    "visibleBit": None,
    "bitSetDiagonal": None,
    "bitmapVariant": None,
    "boundary": None,
}
VISIBILITY_VERIFIED = dict(UNVERIFIED, status="visibility-verified",
                           indexOrder="row-major", visibleBit=1,
                           bitmapVariant="visibility")
NATIVE_VERIFIED = dict(VISIBILITY_VERIFIED, status="native-topology-verified",
                      bitSetDiagonal="b-c", boundary="postload-visible")

# Bind recovered rules to this exact private engine, not to a generic UE2 build.
# The additive key is DERIVED from its exported UTF-16 function-name sentinel.
# Original x86 evidence: GetEdgeTurnBitmap is y*HeightmapX+x, LSB first;
# TriangulateLayer and GenerateCompleteIndexBuffer independently emit
# bit 1: (a,c,b),(c,d,b); bit 0: (a,c,d),(a,d,b).
# PostLoad overwrites Orig with current arrays and sets outer visibility bits.
# Unknown/changed engines retain the older visibility-only gate.
NATIVE_ENGINE_SHA256 = "07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0"
NATIVE_CORE_SHA256 = "9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf"
_NATIVE_SENTINEL = "?__FUNC_NAME__@?2??IsTriangleAll@UTerrainSector@@QAEHHHHHHE@Z@4QBGB"
_NATIVE_DECODER = {"operation": "uint32-le-subtract", "key": 0x7965b551,
                   "sectionRVA": 0x1000, "rawOffset": 0x1000,
                   "byteLength": 0x1a98000, "sentinelExport": _NATIVE_SENTINEL}
_NATIVE_FUNCTIONS = (
    ("?GetEdgeTurnBitmap@ATerrainInfo@@QAEHHH@Z", 0x78460, 56, "eb536188f732951c7a931496b1c78185c4c709d0a930abae9c6d975a0475bc8b"),
    ("?GetEdgeTurnBitmapOrig@ATerrainInfo@@QAEHHH@Z", 0x78590, 56, "90452ac3d5d1bfde4161f969a830934cb98219586fa1397becff89d5a4c3b9e0"),
    ("?TriangulateLayer@UTerrainSector@@QAEXH@Z", 0x428070, 1057, "42bc912c8765c303d035e007d5b72339fdad57f4fdbd91b89defaacf0afa7692"),
    ("?GenerateCompleteIndexBuffer@UTerrainSector@@QAEXXZ", 0x4285a0, 720, "21b7833c4673cd919276cb34e68c455f11c5b1e46715f7470cc08abfc2b9932f"),
    ("?PostLoad@ATerrainInfo@@UAEXXZ", 0x42ded0, 1574, "417c0c0d07bbd0875e11e872d0bbf326e8ae5f1acaffc7075f1cc81b72c26c28"),
    ("?Serialize@UTerrainSector@@UAEXAAVFArchive@@@Z", 0x430fe0, 1474, "06f6d7ae6b9e66eeff2f0fb93e3b56ab82cb2b002e95c7b205bbd1207ea0581a"),
    ("?UpdateVTGroup@ATerrainInfo@@QAEXXZ", 0x42b680, 893, "63df6b3270e069eb9a9d8a09bee03509121b867d6fb3d7b965a72f85b0e628d2"),
    ("?SetVertiEdge@ATerrainInfo@@QAEXPAV1@@Z", 0x4275c0, 776, "4b2a77d54fa602b9d1e35d141bce20418d6215e8b334c3ac0b20869c2b422feb"),
    ("?SetHoriEdge@ATerrainInfo@@QAEXPAV1@@Z", 0x427990, 841, "78032be8ab36784c518b13a9d03b3d111793e6285bea422f15c4b3d4fd49bb82"),
    ("?SetEndVertexZ@ATerrainInfo@@QAEXPAV1@@Z", 0x427db0, 557, "10b880d69cc136fcd74f8cc86bd70f949bf783818b12be32bc0782cb860cb9c3"),
)
_NATIVE_PROOF = None


def native_engine_evidence(path):
    """Recover only in memory; return provenance after every exported body matches.

    No executable is run or written. PE RVAs are resolved through section headers.
    This intentionally recognizes one investigated binary; other inputs need a
    new review, not a guessed rule or automatically accepted opcode pattern.
    """
    global _NATIVE_PROOF
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as source:
        raw = source.read()
    if hashlib.sha256(raw).hexdigest() != NATIVE_ENGINE_SHA256:
        return None
    # Bulk map export still rechecks the full DLL identity for every call.
    # Recovering its identical code again cannot add per-map evidence.
    if _NATIVE_PROOF is not None:
        return copy.deepcopy(_NATIVE_PROOF)
    pe = struct.unpack_from("<I", raw, 60)[0]
    optional = pe + 24
    sections_start = optional + struct.unpack_from("<H", raw, pe + 20)[0]
    sections = [struct.unpack_from("<4I", raw, sections_start + i * 40 + 8)
                for i in range(struct.unpack_from("<H", raw, pe + 6)[0])]

    def offset(rva):
        for _virtual_size, address, size, start in sections:
            if address <= rva < address + size:
                return start + rva - address
        raise L2Error("native terrain evidence RVA outside file-backed section")

    export_rva = struct.unpack_from("<I", raw, optional + 96)[0]
    directory = struct.unpack_from("<IIHH7I", raw, offset(export_rva))
    count, functions, names, ordinals = directory[7:]
    exports = {}
    for i in range(count):
        name_rva = struct.unpack_from("<I", raw, offset(names) + i * 4)[0]
        start = offset(name_rva)
        name = raw[start:raw.index(b"\0", start)].decode("ascii")
        ordinal = struct.unpack_from("<H", raw, offset(ordinals) + i * 2)[0]
        exports[name] = struct.unpack_from("<I", raw, offset(functions) + ordinal * 4)[0]
    sentinel = _NATIVE_SENTINEL
    sentinel_rva = exports[sentinel]
    expected = "UTerrainSector::IsTriangleAll\0".encode("utf-16-le")
    key = (struct.unpack_from("<I", raw, offset(sentinel_rva))[0]
           - struct.unpack_from("<I", expected)[0]) & 0xffffffff
    _vs, section_rva, section_size, section_offset = next(
        s for s in sections if s[1] <= sentinel_rva < s[1] + s[2])
    decoded = bytearray(raw)
    # Explicit little-endian decode, including on a big-endian Python host.
    words = array.array("I", raw[section_offset:section_offset + section_size])
    import sys
    if sys.byteorder != "little":
        words.byteswap()
    words = array.array("I", ((word - key) & 0xffffffff for word in words))
    if sys.byteorder != "little":
        words.byteswap()
    decoded[section_offset:section_offset + section_size] = words.tobytes()
    if decoded[offset(sentinel_rva):offset(sentinel_rva) + len(expected)] != expected:
        raise L2Error("native terrain function-name sentinel did not decode")
    functions_proof = []
    for name, expected_rva, size, digest in _NATIVE_FUNCTIONS:
        stub = exports[name]
        start = offset(stub)
        if decoded[start] != 0xe9:
            raise L2Error("native terrain export is not the inspected jump stub")
        rva = stub + 5 + struct.unpack_from("<i", decoded, start + 1)[0]
        body = decoded[offset(rva):offset(rva) + size]
        if rva != expected_rva or hashlib.sha256(body).hexdigest() != digest:
            raise L2Error("native terrain method differs from inspected evidence")
        functions_proof.append({"export": name, "codeRVA": rva,
                                "byteLength": size, "codeSHA256": digest})
    proof = {"method": "interlude-native-terrain-v1", "sourceFile": "engine.dll",
            "sourceSHA256": NATIVE_ENGINE_SHA256,
            "imageBase": struct.unpack_from("<I", raw, optional + 28)[0],
            "decoder": {"operation": "uint32-le-subtract", "key": key,
                        "sectionRVA": section_rva, "rawOffset": section_offset,
                        "byteLength": section_size, "sentinelExport": sentinel},
            "functions": functions_proof,
            "postLoadOrig": "copy-current", "outerVisibility": "visible",
            "bitSetDiagonal": "b-c", "bitClearDiagonal": "a-d"}
    _NATIVE_PROOF = copy.deepcopy(proof)
    return proof


def file_sha256(path):
    with open(path, "rb") as source:
        hasher = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def words_sha256(words):
    return hashlib.sha256(struct.pack("<%dI" % len(words), *words)).hexdigest()


def float32(value):
    return struct.unpack("<f", struct.pack("<f", value))[0]


def native_height_transform(pkg, raw_height, origin, spacing, height_scale):
    """Read saved FCoords and prove its geometry against native sector corners.

    Engine TerrainInfo::Serialize stores these coordinates after the sector
    references/counts. Core FVector::TransformPointBy applies (point-Origin)
    dot each axis and stores float32. CalcLocation bounds FOUR corners only.
    An unknown engine or an unsupported map keeps its prior unverified path.
    The input samples and serialized coordinates are never rewritten.
    """
    import convert
    system = os.path.join(os.path.dirname(os.path.dirname(pkg.path)), "system")
    for name, expected in (("engine.dll", NATIVE_ENGINE_SHA256),
                           ("Core.dll", NATIVE_CORE_SHA256)):
        path = os.path.join(system, name)
        if not os.path.isfile(path) or file_sha256(path) != expected:
            return None
    info = [e for e in pkg.exports if pkg.class_name_of(e) == "TerrainInfo"]
    if len(info) != 1 or len(raw_height) != 256 * 256 * 2:
        return None
    info = info[0]
    start = convert.actor_prop_offset(pkg, info)
    if start is None:
        return None
    props, end = convert.read_props_ordered(pkg, info.serial_offset + start)
    if not props or props[0]["name"] != "TerrainMap":
        return None
    reader = Reader(pkg.data, end)
    count = reader.compact()
    sectors = [e for e in pkg.exports if pkg.class_name_of(e) == "TerrainSector"]
    if count != 256 or set(reader.compact() for _ in range(count)) != {e.index + 1 for e in sectors}:
        return None
    if (reader.i32(), reader.i32()) != (16, 16):
        return None
    matrix_bytes = reader.bytes(48)
    matrix = struct.unpack("<12f", matrix_bytes)
    reader.bytes(48)  # independently serialized inverse FCoords
    if (reader.i32(), reader.i32()) != (256, 256):
        return None
    axes = [list(matrix[i:i + 3]) for i in (3, 6, 9)]
    # No rotated/sheared map is silently coerced into the browser's grid.
    if axes != [[spacing, 0, 0], [0, spacing, 0], [0, 0, float32(height_scale)]]:
        return None
    def vertex(x, y, height):
        point = (x, y, height)
        return [float32(sum((point[j] - matrix[j]) * axes[i][j]
                            for j in range(3))) for i in range(3)]
    for x, y in ((0, 0), (255, 255), (256, 256)):
        if vertex(x, y, 0)[:2] != [origin[0] + x * spacing, origin[1] + y * spacing]:
            return None
    heights = struct.unpack("<65536H", raw_height)
    records, covered = [], set()
    for export in sectors:
        reader = Reader(pkg.data, export.serial_offset)
        if pkg.name(reader.compact()) != "None" or reader.compact() != info.index + 1:
            return None
        qx, qy, ox, oy = (reader.i32() for _ in range(4))
        if (ox, oy) in covered or ox not in range(0, 256, 16) or oy not in range(0, 256, 16):
            return None
        if qx != min(16, 255 - ox) or qy != min(16, 255 - oy):
            return None
        covered.add((ox, oy))
        bounds = struct.unpack("<6f", reader.bytes(24))
        if reader.u8() != 1:
            return None
        corners = [vertex(x, y, heights[y * 256 + x])
                   for y in (oy, oy + qy) for x in (ox, ox + qx)]
        expected = tuple(fn(v[i] for v in corners) for fn in (min, max) for i in range(3))
        if bounds != expected:
            return None
        records.append(struct.pack("<4I6f", ox, oy, qx, qy, *bounds))
    if len(covered) != 256:
        return None
    return {"method": "native-fcoords-v1", "origin": list(matrix[:3]), "axes": axes,
            "sourceSHA256": file_sha256(pkg.path),
            "coordsSHA256": hashlib.sha256(matrix_bytes).hexdigest(),
            "engineSHA256": NATIVE_ENGINE_SHA256, "coreSHA256": NATIVE_CORE_SHA256,
            "verification": {"method": "native-sector-four-corners-v1",
                             "sectors": 256, "boundsMatched": 1536,
                             "boundsSHA256": hashlib.sha256(b"".join(sorted(records))).hexdigest()}}


def validate_height_transform(transform, metadata):
    """Check the source-transform sidecar contract and exact float32 bytes."""
    def require(condition):
        if not condition:
            raise L2Error("terrain height transform differs from native source proof")
    require(isinstance(transform, dict) and transform.get("method") == "native-fcoords-v1")
    origin, axes = transform.get("origin"), transform.get("axes")
    require(isinstance(origin, list) and len(origin) == 3
            and all(type(v) in (float, int) and math.isfinite(v) and float32(v) == v for v in origin))
    spacing, scale = metadata["spacing"], metadata["heightScale"]
    require(axes == [[spacing, 0, 0], [0, spacing, 0], [0, 0, float32(scale)]])
    require(transform.get("sourceSHA256") == metadata["rawMapSHA256"]
            and transform.get("engineSHA256") == NATIVE_ENGINE_SHA256
            and transform.get("coreSHA256") == NATIVE_CORE_SHA256)
    matrix = origin + [value for axis in axes for value in axis]
    require(transform.get("coordsSHA256") == hashlib.sha256(struct.pack("<12f", *matrix)).hexdigest())
    for i in (0, 1):
        for sample in (0, 255, 256):
            require(float32((sample - origin[i]) * spacing)
                    == metadata["origin"][i] + sample * spacing)
    proof = transform.get("verification", {})
    require(proof.get("method") == "native-sector-four-corners-v1"
            and proof.get("sectors") == 256 and proof.get("boundsMatched") == 1536
            and isinstance(proof.get("boundsSHA256"), str)
            and len(proof["boundsSHA256"]) == 64
            and all(c in "0123456789abcdef" for c in proof["boundsSHA256"]))


def verify_sector_visibility(pkg, bitmaps, grid_size):
    """Cross-check the bitmap against a separate native per-quad table.

    Native TerrainSector exports finish with a compact count of 256 followed
    by 256 uint16 per-quad values, preceded by 64 other bytes. This is NOT the
    previously documented 289-entry vertex array. The row-major table is zero
    exactly at invisible quads. Every ordinary quad must have unique sector
    coverage and agree; malformed/ambiguous sources keep unverified metadata.
    This proves the saved ordinary sectors' visibility, not seamless runtime
    reconstruction or either triangle diagonal convention.
    """
    expected = (grid_size - 1) ** 2
    evidence = {
        "method": "native-sector-quad-table-v1", "passed": False,
        "sourceSHA256": file_sha256(pkg.path),
        "sectorCount": 0, "expectedQuads": expected, "coveredQuads": 0,
        "duplicateQuads": 0, "missingQuads": expected,
        "visibilityMismatches": 0, "origVisibilityMismatches": 0,
        "hiddenQuads": 0, "errors": [],
        "visibilityWordsSHA256": words_sha256(bitmaps["visibility"]["words"]),
    }
    orig = bitmaps.get("visibilityOrig")
    if orig is not None:
        evidence["origVisibilityWordsSHA256"] = words_sha256(orig["words"])
    else:
        evidence["errors"].append("missing original visibility variant")
    covered = set()
    records = []
    terrain_refs = {e.index + 1 for e in pkg.exports
                    if pkg.class_name_of(e) == "TerrainInfo"}
    for export in pkg.exports:
        if pkg.class_name_of(export) != "TerrainSector":
            continue
        evidence["sectorCount"] += 1
        raw = pkg.data[export.serial_offset:export.serial_offset + export.serial_size]
        try:
            reader = Reader(raw)
            if pkg.name(reader.compact()) != "None" or reader.compact() not in terrain_refs:
                raise L2Error("unexpected native sector object header")
            qx, qy, ox, oy = (reader.i32() for _ in range(4))
            if not (1 <= qx <= 16 and 1 <= qy <= 16 and ox >= 0 and oy >= 0
                    and ox % 16 == oy % 16 == 0
                    and ox + qx < grid_size and oy + qy < grid_size):
                raise L2Error("invalid native sector quad coordinates")
            # The trailing array's framing is checked independently of its
            # values. The preceding 64 bytes are kept outside this array.
            if len(raw) < reader.pos + 25 + 64 + 514:
                raise L2Error("native sector is too short")
            tail = Reader(raw, len(raw) - 514)
            if tail.compact() != 256 or len(raw) - tail.pos != 512:
                raise L2Error("native per-quad table framing differs")
            table = struct.unpack_from("<256H", raw, tail.pos)
            records.append((ox, oy, qx, qy, raw[tail.pos:]))
            for y in range(qy):
                for x in range(qx):
                    cell = (ox + x, oy + y)
                    if cell in covered:
                        evidence["duplicateQuads"] += 1
                    covered.add(cell)
                    bit_index = (oy + y) * grid_size + ox + x
                    expected_visible = int(table[y * 16 + x] != 0)
                    evidence["hiddenQuads"] += 1 - expected_visible
                    for name, counter in (("visibility", "visibilityMismatches"),
                                          ("visibilityOrig", "origVisibilityMismatches")):
                        if name not in bitmaps:
                            continue
                        words = bitmaps[name]["words"]
                        actual = (words[bit_index // 32] >> (bit_index % 32)) & 1
                        evidence[counter] += actual != expected_visible
        except (L2Error, IndexError, struct.error) as exc:
            evidence["errors"].append("%s: %s" % (pkg.export_name(export), exc))
    hasher = hashlib.sha256()
    for ox, oy, qx, qy, raw in sorted(records):
        hasher.update(struct.pack("<4I", ox, oy, qx, qy))
        hasher.update(raw)
    evidence["tableSHA256"] = hasher.hexdigest()
    evidence["coveredQuads"] = len(covered)
    evidence["missingQuads"] = expected - len(covered)
    evidence["currentPassed"] = (not evidence["errors"]
                          and evidence["coveredQuads"] == expected
                          and evidence["duplicateQuads"] == 0
                          and evidence["visibilityMismatches"] == 0)
    evidence["passed"] = (evidence["currentPassed"]
                          and evidence["origVisibilityMismatches"] == 0)
    return evidence


def read_bitmaps(properties, grid_size):
    """Decode tagged array payloads; reject truncation and unexplained bytes."""
    expected_words = (grid_size * grid_size + 31) // 32
    bitmaps = {}
    for prop in properties:
        name = prop["name"]
        if name not in PROPERTIES:
            continue
        key = PROPERTIES[name]
        if key in bitmaps:
            raise L2Error("duplicate TerrainInfo.%s" % name)
        if prop["type"] != 9:
            raise L2Error("TerrainInfo.%s is not an Array property" % name)
        raw = prop["raw"]
        reader = Reader(raw)
        count = reader.compact()
        if count != expected_words:
            raise L2Error("TerrainInfo.%s: %d words, expected %d for grid %d"
                          % (name, count, expected_words, grid_size))
        if len(raw) - reader.pos != count * 4:
            raise L2Error("TerrainInfo.%s: truncated array or trailing bytes"
                          % name)
        bitmaps[key] = {
            "sourceProperty": name,
            "wordCount": count,
            "words": list(struct.unpack_from("<%dI" % count, raw, reader.pos)),
            "sourcePropertySHA256": hashlib.sha256(raw).hexdigest(),
        }
    for key in ("visibility", "edgeTurn"):
        if key not in bitmaps:
            raise L2Error("TerrainInfo missing topology array %s" % key)
    return bitmaps


def build(bitmaps, grid_size, source_path, source_map, source_package=None):
    """Preserve words; bind per-map tables and recovered rules to their sources."""
    source_hash = file_sha256(source_path)
    result = {
        "format": FORMAT,
        "gridSize": grid_size,
        "bitmaps": bitmaps,
        "conventions": dict(UNVERIFIED),
        "provenance": {"sourceMap": source_map, "sourceSHA256": source_hash},
    }
    if source_package is not None:
        evidence = verify_sector_visibility(source_package, bitmaps, grid_size)
        if evidence["sourceSHA256"] != source_hash:
            raise L2Error("topology source package differs from provenance file")
        result["verification"] = evidence
        if evidence["passed"]:
            result["conventions"] = dict(VISIBILITY_VERIFIED)
        engine_path = os.path.join(os.path.dirname(os.path.dirname(source_path)),
                                   "system", "engine.dll")
        native = native_engine_evidence(engine_path) if grid_size == 256 else None
        if native is not None and evidence["currentPassed"]:
            # PostLoad copies current arrays over serialized Orig. Preserve
            # both raw variants and their disagreements, but render current.
            result["nativeEngine"] = native
            result["conventions"] = dict(NATIVE_VERIFIED)
            evidence["edgeTurnWordsSHA256"] = words_sha256(bitmaps["edgeTurn"]["words"])
            if "edgeTurnOrig" in bitmaps:
                evidence["origEdgeTurnWordsSHA256"] = words_sha256(bitmaps["edgeTurnOrig"]["words"])
    validate(result, grid_size)
    return result


def validate(data, grid_size):
    """Validate preservation and the exact evidence needed by each convention."""
    def require(condition, reason):
        if not condition:
            raise L2Error("terrain topology: " + reason)

    def digest(value):
        return (isinstance(value, str) and len(value) == 64
                and all(c in "0123456789abcdef" for c in value))

    require(isinstance(data, dict), "object required")
    require(data.get("format") == FORMAT, "unknown format")
    require(type(grid_size) is int and grid_size > 1, "invalid grid size")
    require(data.get("gridSize") == grid_size, "grid size differs from scene")
    require(data.get("conventions") in (UNVERIFIED, VISIBILITY_VERIFIED, NATIVE_VERIFIED),
            "unsupported or unverified native conventions")
    provenance = data.get("provenance")
    require(isinstance(provenance, dict), "missing provenance")
    require(isinstance(provenance.get("sourceMap"), str)
            and bool(provenance["sourceMap"]), "missing source map")
    require(digest(provenance.get("sourceSHA256")), "invalid source digest")
    bitmaps = data.get("bitmaps")
    require(isinstance(bitmaps, dict), "missing bitmaps")
    require(set(bitmaps).issubset(PROPERTIES.values()), "unknown bitmap")
    require(all(k in bitmaps for k in ("visibility", "edgeTurn")),
            "missing required bitmap")
    expected_words = (grid_size * grid_size + 31) // 32
    for name, bitmap in bitmaps.items():
        require(isinstance(bitmap, dict), "invalid bitmap " + name)
        require(isinstance(bitmap.get("sourceProperty"), str)
                and PROPERTIES.get(bitmap["sourceProperty"]) == name,
                "source property mismatch: " + name)
        words = bitmap.get("words")
        require(isinstance(words, list) and len(words) == expected_words,
                "word length mismatch: " + name)
        require(type(bitmap.get("wordCount")) is int
                and bitmap["wordCount"] == expected_words,
                "word count mismatch: " + name)
        require(all(type(word) is int and 0 <= word <= 0xffffffff
                    for word in words), "invalid uint32: " + name)
        require(digest(bitmap.get("sourcePropertySHA256")),
                "invalid property digest: " + name)
    native = data["conventions"] == NATIVE_VERIFIED
    if data["conventions"] in (VISIBILITY_VERIFIED, NATIVE_VERIFIED):
        evidence = data.get("verification")
        require(isinstance(evidence, dict), "missing visibility evidence")
        require(evidence.get("method") == "native-sector-quad-table-v1"
                and evidence.get("currentPassed" if native else "passed") is True,
                "visibility proof failed")
        require(evidence.get("sourceSHA256") == provenance["sourceSHA256"],
                "visibility evidence source mismatch")
        require(evidence.get("expectedQuads") == (grid_size - 1) ** 2
                and evidence.get("coveredQuads") == (grid_size - 1) ** 2,
                "incomplete visibility coverage")
        counters = ["duplicateQuads", "missingQuads", "visibilityMismatches"]
        if not native:
            counters.append("origVisibilityMismatches")
        require(all(evidence.get(k) == 0 for k in counters) and evidence.get("errors") == [],
                "visibility proof contains mismatches")
        require(digest(evidence.get("tableSHA256")), "invalid sector table digest")
        require("visibilityOrig" in bitmaps, "missing original visibility proof")
        for name, field in (("visibility", "visibilityWordsSHA256"),
                            ("visibilityOrig", "origVisibilityWordsSHA256")):
            require(evidence.get(field) == words_sha256(bitmaps[name]["words"]),
                    "visibility bitmap differs from verified source: " + name)
    if native:
        proof = data.get("nativeEngine", {})
        require(grid_size == 256 and proof.get("method") == "interlude-native-terrain-v1"
                and proof.get("sourceSHA256") == NATIVE_ENGINE_SHA256
                and proof.get("sourceFile") == "engine.dll"
                and proof.get("imageBase") == 0x10300000
                and proof.get("decoder") == _NATIVE_DECODER
                and proof.get("postLoadOrig") == "copy-current"
                and proof.get("outerVisibility") == "visible"
                and proof.get("bitSetDiagonal") == "b-c"
                and proof.get("bitClearDiagonal") == "a-d", "native engine identity/rules differ")
        require(proof.get("functions") == [
            {"export": name, "codeRVA": rva, "byteLength": size, "codeSHA256": digest}
            for name, rva, size, digest in _NATIVE_FUNCTIONS], "native method evidence differs")
        require(evidence.get("edgeTurnWordsSHA256") == words_sha256(bitmaps["edgeTurn"]["words"]),
                "edge-turn bitmap differs from verified source")
        if "edgeTurnOrig" in bitmaps:
            require(evidence.get("origEdgeTurnWordsSHA256") == words_sha256(bitmaps["edgeTurnOrig"]["words"]),
                    "original edge-turn bitmap differs from preserved source")


def write_json(path, data):
    """Replace a complete JSON file atomically; never publish partial words."""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", dir=os.path.dirname(path),
                                         prefix=".topology-", delete=False) as out:
            temporary = out.name
            json.dump(data, out, separators=(",", ":"))
            out.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def write(bitmaps, grid_size, source_path, source_map, out_dir, source_package=None):
    record = build(bitmaps, grid_size, source_path, source_map, source_package)
    write_json(os.path.join(out_dir, FILENAME), record)
    return record
