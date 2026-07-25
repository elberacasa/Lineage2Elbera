#!/usr/bin/env python3
"""L2Vzla character-creation showcase server.

Python 3.9 stdlib only. Port 8082.

Routes:
  GET /api/manifest         -> editor/characters/manifest.json
                               ({"models": []} when the file does not exist yet)
  GET /api/charcreate-data  -> editor/characters/charcreate-data.json
                               (404 when missing; the frontend has built-in defaults)
  GET /faces/<pkg>/<name>.png -> face-variant textures from
                               assets/library/<pkg>/<name>.png (game texture
                               refs like "MFighter.MFighter_m000_t01_f";
                               package and file names resolved case-insensitively)
  GET /characters/<path>    -> static files under editor/characters/
                               (glTF/bin/textures referenced by the manifest)
  GET /<path>               -> the app itself, served from this directory

All filesystem access is confined to its root (path-traversal safe).
"""

import json
import os
import posixpath
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHARACTERS_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "characters"))
LIBRARY_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "..", "assets", "library"))
PORT = 8082

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".gltf": "model/gltf+json",
    ".glb": "model/gltf-binary",
    ".bin": "application/octet-stream",
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
    server_version = "L2CharCreate/1.0"

    def log_message(self, fmt, *args):
        # keep default stderr logging (nohup redirects it to charcreate.log)
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

    def _send_api_file(self, full_path):
        """API payloads are produced/updated by an external pipeline — never cache."""
        ext = os.path.splitext(full_path)[1].lower()
        try:
            with open(full_path, "rb") as fh:
                body = fh.read()
        except OSError:
            self._send_json({"error": "not found"}, status=404)
            return
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
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
        path = urllib.parse.urlparse(self.path).path

        if path == "/api/manifest":
            full = os.path.join(CHARACTERS_DIR, "manifest.json")
            if os.path.isfile(full):
                self._send_api_file(full)
            else:
                # contract: always a valid manifest, empty until the pipeline runs
                self._send_json({"models": []})
            return

        if path == "/api/charcreate-data":
            full = os.path.join(CHARACTERS_DIR, "charcreate-data.json")
            if os.path.isfile(full):
                self._send_api_file(full)
            else:
                self._send_json({"error": "charcreate-data.json not available"}, status=404)
            return

        if path == "/characters" or path.startswith("/characters/"):
            rel = path[len("/characters"):]
            full = safe_join(CHARACTERS_DIR, rel)
            if full is None:
                self._send_json({"error": "forbidden"}, status=403)
                return
            if os.path.isfile(full):
                self._send_file(full)
            else:
                self._send_json({"error": "not found"}, status=404)
            return

        if path == "/faces" or path.startswith("/faces/"):
            self._send_face(path[len("/faces"):])
            return

        # app static files
        if path == "/" or path == "":
            path = "/index.html"
        full = safe_join(BASE_DIR, path)
        if full is None:
            self._send_json({"error": "forbidden"}, status=403)
            return
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if os.path.isfile(full):
            self._send_file(full)
        else:
            self._send_json({"error": "not found"}, status=404)

    def do_HEAD(self):
        # cheap liveness check support
        path = urllib.parse.urlparse(self.path).path
        self.send_response(200 if path == "/" else 404)
        self.send_header("Content-Length", "0")
        self.end_headers()


def main():
    os.makedirs(CHARACTERS_DIR, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("charcreate server on http://127.0.0.1:%d" % PORT, flush=True)
    print("serving app from %s" % BASE_DIR, flush=True)
    print("serving characters from %s" % CHARACTERS_DIR, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
