#!/usr/bin/env python3
"""L2Vzla walkable-world demo server (M1).

Python 3.9 stdlib only. Port 8083.

Routes:
  GET /scenes                 -> JSON list of tile dir names under assets/world/
  GET /scenes/<tile>/<file>   -> static scene package files under
                                 assets/world/<tile>/ (scene.json, heightmap.u16,
                                 textures, props/...)
  GET /scenes-hd/<tile>/<file> -> HD variant: assets/world-hd/<tile>/ when the
                                 file exists there, else the LQ file under
                                 assets/world/ (pilot tiles: 17_25, 22_22)
  GET /characters/<path>      -> static files under editor/characters/
                                 (manifest.json, models/*.gltf/bin/png)
  GET /create/<path>          -> the character-creation app under
                                 editor/charcreate/ (index.html, app.js,
                                 style.css, vendor/) — embedded as an iframe
                                 by the world client when an account has no
                                 characters
  GET /faces/<pkg>/<name>.png -> face-variant textures from
                                 assets/library/<pkg>/<name>.png (game texture
                                 refs like "MFighter.MFighter_m000_t01_f";
                                 package and file names resolved
                                 case-insensitively)
  GET /gamedata/npcname.json  -> compact {npcId: name} map from
                                 assets/gamedata/npcname.json (M2 NPC labels)
  GET /minimap/<path>         -> static minimap imagery under
                                 assets/world/minimap/ (worldmap.png,
                                 tiles/*.png, towns/*.png — gitignored, staged
                                 by tools/maps/build_minimap.py)
  GET /<path>                 -> the app itself, served from this directory

All filesystem access is confined to its root (path-traversal safe).
"""

import json
import os
import re
import posixpath
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WORLD_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "..", "assets", "world"))
# HD texture mirror (pilot: 17_25 + 22_22, 4x Real-ESRGAN). Only upscaled
# PNGs live here; /scenes-hd/<tile>/<file> falls back to the LQ file under
# assets/world/ for everything else (scene.json, heightmaps, gltf, splats).
WORLD_HD_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "..", "assets", "world-hd"))
CHARACTERS_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "characters"))
CHARCREATE_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "charcreate"))
LIBRARY_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "..", "assets", "library"))
GAMEDATA_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "..", "assets", "gamedata"))
MINIMAP_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "..", "assets", "world", "minimap"))
AUDIO_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "..", "assets", "audio"))
NPCS_XML_DIR = os.path.normpath(os.path.join(
    BASE_DIR, "..", "..", "server", "aCis_gameserver", "build", "dist",
    "gameserver", "data", "xml", "npcs"))
PORT = 8083

# compact npcId -> display name map, built once from assets/gamedata/npcname.json
_npc_names = None
# compact npcId -> short mesh name (e.g. "gremlin_m00"), from npcgrp.json
_npc_meshes = None


def npc_names():
    global _npc_names
    if _npc_names is None:
        _npc_names = {}
        src = os.path.join(GAMEDATA_DIR, "npcname.json")
        try:
            with open(src, "r", encoding="utf-8") as fh:
                for entry in json.load(fh):
                    _npc_names[str(entry["id"])] = entry.get("name", "")
        except (OSError, ValueError, KeyError):
            pass
    return _npc_names


_NPC_BLOCK_RE = re.compile(r'<npc id="\d+"[^>]*>.*?</npc>', re.S)
_NPC_HEIGHT_RE = re.compile(r'height" val="([\d.]+)"')


_NPC_TYPE_RE = re.compile(r'type" val="([^"]+)"')


def _server_npc_meta():
    """npcId -> {height, type} from the aCis npc XMLs
    (height per docs/npc-visual-data.md §3; type = Monster/Folk/... used
    to decide the talk-vs-attack path for NPC clicks)."""
    out = {}
    if not os.path.isdir(NPCS_XML_DIR):
        return out
    for name in os.listdir(NPCS_XML_DIR):
        if not name.endswith(".xml"):
            continue
        try:
            with open(os.path.join(NPCS_XML_DIR, name), "r", encoding="utf-8") as fh:
                src = fh.read()
        except OSError:
            continue
        for block in _NPC_BLOCK_RE.findall(src):
            m = _NPC_HEIGHT_RE.search(block)
            t = _NPC_TYPE_RE.search(block)
            if m:
                out[block.split('"')[1]] = {
                    "height": float(m.group(1)),
                    "type": t.group(1) if t else None,
                }
    return out


def npc_meshes():
    """npcId -> {mesh, height, type}: npcgrp mesh name + server collision
    height + server NPC type (Monster/Folk/...)."""
    global _npc_meshes
    if _npc_meshes is None:
        meta = _server_npc_meta()
        _npc_meshes = {}
        src = os.path.join(GAMEDATA_DIR, "npcgrp.json")
        try:
            with open(src, "r", encoding="utf-8") as fh:
                for entry in json.load(fh):
                    mesh = entry.get("mesh_name") or ""
                    # "LineageMonsters.gremlin_m00" -> "gremlin_m00"
                    nid = str(entry["npc_id"])
                    m = meta.get(nid) or {}
                    _npc_meshes[nid] = {
                        "mesh": mesh.rsplit(".", 1)[-1],
                        "height": m.get("height"),
                        "type": m.get("type"),
                    }
        except (OSError, ValueError, KeyError):
            pass
    return _npc_meshes

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".gltf": "model/gltf+json",
    ".glb": "model/gltf-binary",
    ".bin": "application/octet-stream",
    ".u16": "application/octet-stream",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ogg": "audio/ogg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
}


def safe_join(root, url_path):
    """Resolve url_path inside root; return None if it escapes root."""
    url_path = posixpath.normpath(urllib.parse.unquote(url_path))
    parts = [p for p in url_path.split("/") if p and p not in (".", "..")]
    full = os.path.normpath(os.path.join(root, *parts))
    if full != root and not full.startswith(root + os.sep):
        return None
    return full


class Handler(BaseHTTPRequestHandler):
    server_version = "L2World/1.0"

    def log_message(self, fmt, *args):
        # default stderr logging (nohup redirects it to world.log)
        super().log_message(fmt, *args)

    # -- helpers -----------------------------------------------------------

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, full_path):
        if not full_path or not os.path.isfile(full_path):
            self._send_json({"error": "not found"}, status=404)
            return
        ext = os.path.splitext(full_path)[1].lower()
        ctype = CONTENT_TYPES.get(ext, "application/octet-stream")
        try:
            with open(full_path, "rb") as fh:
                body = fh.read()
        except OSError:
            self._send_json({"error": "not found"}, status=404)
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if ext in (".js", ".css", ".html"):
            self.send_header("Cache-Control", "no-store")
        else:
            self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        self.wfile.write(body)

    # -- routing -----------------------------------------------------------

    def _send_face(self, rel):
        """Serve assets/library/<pkg>/<name>.png, case-insensitively.

        Game texture refs ('MFighter.MFighter_m000_t01_f') use varying case
        for both the package dir (melf, FShaman, ...) and the file names.
        """
        rel = posixpath.normpath(urllib.parse.unquote(rel))
        parts = [p for p in rel.split("/") if p and p not in (".", "..")]
        if len(parts) != 2:
            self._send_json({"error": "not found"}, status=404)
            return
        pkg, name = parts
        try:
            pkg_dir = next((d for d in os.listdir(LIBRARY_DIR)
                            if d.lower() == pkg.lower()), None)
            if not pkg_dir:
                raise OSError
            full_dir = os.path.join(LIBRARY_DIR, pkg_dir)
            if not os.path.isdir(full_dir):
                raise OSError
            fname = next((f for f in os.listdir(full_dir)
                          if f.lower() == name.lower()), None)
            if not fname:
                raise OSError
        except OSError:
            self._send_json({"error": "not found"}, status=404)
            return
        self._send_file(os.path.join(full_dir, fname))

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path

        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return

        if path == "/scenes" or path == "/scenes/":
            tiles = []
            if os.path.isdir(WORLD_DIR):
                for name in sorted(os.listdir(WORLD_DIR)):
                    full = os.path.join(WORLD_DIR, name)
                    if os.path.isdir(full) and os.path.isfile(
                        os.path.join(full, "scene.json")
                    ):
                        tiles.append(name)
            self._send_json(tiles)
            return

        if path.startswith("/scenes-hd/"):
            rel = path[len("/scenes-hd/"):]
            full = safe_join(WORLD_HD_DIR, rel)
            if not full or not os.path.isfile(full):
                full = safe_join(WORLD_DIR, rel)   # LQ fallback
            self._send_file(full)
            return

        if path.startswith("/scenes/"):
            rel = path[len("/scenes/"):]
            self._send_file(safe_join(WORLD_DIR, rel))
            return

        if path.startswith("/characters/"):
            rel = path[len("/characters/"):]
            self._send_file(safe_join(CHARACTERS_DIR, rel))
            return

        # character-creation app (embedded by the world client as
        # /create/?embed=1); data + models load from /characters/ above
        if path == "/create":
            path = "/create/"
        if path.startswith("/create/"):
            rel = path[len("/create/"):] or "index.html"
            self._send_file(safe_join(CHARCREATE_DIR, rel))
            return

        # face-variant textures for the embedded creator (app.js builds
        # /faces/<pkg>/<name>.png from chargrp faceTextures refs)
        if path == "/faces" or path.startswith("/faces/"):
            self._send_face(path[len("/faces"):])
            return

        if path == "/gamedata/npcname.json":
            self._send_json(npc_names())
            return

        if path == "/gamedata/npcgrp.json":
            self._send_json(npc_meshes())
            return

        # M4: static gamedata (skillmeta.json, itemmeta.json, icons/*.png);
        # 404 when the pipeline hasn't delivered yet — client degrades
        if path.startswith("/gamedata/"):
            rel = path[len("/gamedata/"):]
            self._send_file(safe_join(GAMEDATA_DIR, rel))
            return

        # retail audio: manifest.json, music/*.ogg, sfx/<pkg>/*.ogg (gitignored;
        # 404 until tools/audio/build_audio.py stages it — the client checks the
        # manifest first and runs silent rather than failing when it is absent)
        if path.startswith("/audio/"):
            rel = path[len("/audio/"):]
            self._send_file(safe_join(AUDIO_DIR, rel))
            return

        # minimap imagery (gitignored; 404 until build_minimap.py stages it)
        if path.startswith("/minimap/"):
            rel = path[len("/minimap/"):]
            self._send_file(safe_join(MINIMAP_DIR, rel))
            return

        if path == "/" or path == "":
            path = "/index.html"
        self._send_file(safe_join(BASE_DIR, path.lstrip("/")))


if __name__ == "__main__":
    os.makedirs(WORLD_DIR, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("L2World demo on http://127.0.0.1:%d/ (scenes from %s)" % (PORT, WORLD_DIR))
    server.serve_forever()
