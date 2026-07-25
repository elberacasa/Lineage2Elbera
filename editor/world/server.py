#!/usr/bin/env python3
"""L2Vzla walkable-world demo server (M1).

Python 3.9 stdlib only. Port 8083.

Routes:
  GET /scenes                 -> JSON list of tile dir names under assets/world/
  GET /scenes/<tile>/<file>   -> static scene package files under
                                 assets/world/<tile>/ (scene.json, heightmap.u16,
                                 textures, props/...)
  GET /characters/<path>      -> static files under editor/characters/
                                 (manifest.json, models/*.gltf/bin/png)
  GET /gamedata/npcname.json  -> compact {npcId: name} map from
                                 assets/gamedata/npcname.json (M2 NPC labels)
  GET /<path>                 -> the app itself, served from this directory

All filesystem access is confined to its root (path-traversal safe).
"""

import json
import os
import posixpath
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WORLD_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "..", "assets", "world"))
CHARACTERS_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "characters"))
GAMEDATA_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "..", "assets", "gamedata"))
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


def npc_meshes():
    global _npc_meshes
    if _npc_meshes is None:
        _npc_meshes = {}
        src = os.path.join(GAMEDATA_DIR, "npcgrp.json")
        try:
            with open(src, "r", encoding="utf-8") as fh:
                for entry in json.load(fh):
                    mesh = entry.get("mesh_name") or ""
                    # "LineageMonsters.gremlin_m00" -> "gremlin_m00"
                    _npc_meshes[str(entry["npc_id"])] = mesh.rsplit(".", 1)[-1]
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

        if path.startswith("/scenes/"):
            rel = path[len("/scenes/"):]
            self._send_file(safe_join(WORLD_DIR, rel))
            return

        if path.startswith("/characters/"):
            rel = path[len("/characters/"):]
            self._send_file(safe_join(CHARACTERS_DIR, rel))
            return

        if path == "/gamedata/npcname.json":
            self._send_json(npc_names())
            return

        if path == "/gamedata/npcgrp.json":
            self._send_json(npc_meshes())
            return

        if path == "/" or path == "":
            path = "/index.html"
        self._send_file(safe_join(BASE_DIR, path.lstrip("/")))


if __name__ == "__main__":
    os.makedirs(WORLD_DIR, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("L2World demo on http://127.0.0.1:%d/ (scenes from %s)" % (PORT, WORLD_DIR))
    server.serve_forever()
