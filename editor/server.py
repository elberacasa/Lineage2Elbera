#!/usr/bin/env python3
"""L2Vzla Asset Editor — spike backend (Phase A + Phase B wiring).

Dependency-free HTTP server (Python 3.9 stdlib only) on 127.0.0.1:8081.

Endpoints:
  GET  /                     -> editor/index.html
  GET  /api/config           -> current config (asset root, tool readiness)
  POST /api/config           -> {"assetRoot": "<path>"} change the asset root
                               (relative to repo root or absolute). Persisted
                               to editor/settings.json.
  GET  /api/packages         -> [.utx files under the asset root] (may be empty)
  GET  /api/contents?pkg=    -> texture list of one package, parsed from
                               `umodel -game=l2 -list` stdout (cached on disk)
  GET  /api/thumbs?pkg=      -> ensures thumbnail + full-size PNG cache for the
                               package (umodel -export + sips), returns URLs
  GET  /api/image?pkg=&name=&kind=thumb|full -> serves one cached PNG
  POST /api/replace          -> {"pkg","texture","imageBase64"} Phase B hook.
                               Calls tools/utx/utxedit.py through replace_texture();
                               returns 503 "writer-not-ready" while the tool
                               does not exist.

Cache layout (editor/cache/):
  lists/<sha>.json           parsed umodel -list output, keyed by path+mtime+size
  pkg/<key>/                 umodel export dir (TGA) + thumbs/ + full/ PNGs
"""

import base64
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

BASE_DIR = Path(__file__).resolve().parent          # editor/
ROOT_DIR = BASE_DIR.parent                          # repo root
INDEX_PATH = BASE_DIR / "index.html"
CACHE_DIR = BASE_DIR / "cache"
LIST_CACHE_DIR = CACHE_DIR / "lists"
PKG_CACHE_DIR = CACHE_DIR / "pkg"
SETTINGS_PATH = BASE_DIR / "settings.json"

UMODEL = ROOT_DIR / "tools" / "bin" / "umodel"
SIPS = "/usr/bin/sips"

# --- Phase B adapter contract (frozen with the parallel agent) -------------
#   python3 tools/utx/utxedit.py list    <pkg.utx>
#   python3 tools/utx/utxedit.py replace <pkg.utx> <TextureName> <image.png>
# In-place swap with .bak backup. May not exist yet -> writer-not-ready.
UTXEDIT = ROOT_DIR / "tools" / "utx" / "utxedit.py"

HOST = "127.0.0.1"
PORT = 8081

DEFAULT_ASSET_ROOT = "tools/samples"   # relative to repo root
MAX_BODY_BYTES = 40 * 1024 * 1024      # 40 MB (a 4096x4096 PNG is big)
SUBPROCESS_TIMEOUT = 120               # seconds

EXPORT_LOCK = threading.Lock()         # serialize umodel/sips cache builds


class ApiError(Exception):
    def __init__(self, message, status=400, code=None):
        super().__init__(message)
        self.status = status
        self.code = code


# ---------------------------------------------------------------------------
# Settings (configurable asset root)
# ---------------------------------------------------------------------------

def load_settings():
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict) and data.get("assetRoot"):
            return data
    except (OSError, ValueError):
        pass
    return {"assetRoot": DEFAULT_ASSET_ROOT}


def save_settings(settings):
    with open(SETTINGS_PATH, "w", encoding="utf-8") as fh:
        json.dump(settings, fh, indent=2)


SETTINGS = load_settings()


def asset_root():
    """Asset root as an absolute Path (may not exist)."""
    raw = SETTINGS.get("assetRoot", DEFAULT_ASSET_ROOT)
    p = Path(raw)
    if not p.is_absolute():
        p = ROOT_DIR / p
    return p.resolve()


# ---------------------------------------------------------------------------
# Path safety
# ---------------------------------------------------------------------------

def resolve_package(rel):
    """Resolve a package-relative path against the asset root, no traversal."""
    if not rel or rel.startswith("/") or rel.startswith("~"):
        raise ApiError("invalid package path: %r" % rel)
    root = asset_root()
    candidate = (root / rel).resolve()
    if root != candidate and root not in candidate.parents:
        raise ApiError("path escapes the asset root: %r" % rel)
    if not candidate.is_file():
        raise ApiError("package not found: %s" % rel, status=404)
    if candidate.suffix.lower() != ".utx":
        raise ApiError("not a .utx package: %s" % rel)
    return candidate


def safe_texture_name(name):
    if not name or "/" in name or "\\" in name or ".." in name:
        raise ApiError("invalid texture name: %r" % name)
    return name


# ---------------------------------------------------------------------------
# External tools
# ---------------------------------------------------------------------------

def run(cmd, timeout=SUBPROCESS_TIMEOUT):
    """Run a command, return (rc, stdout, stderr). Never raises on rc != 0."""
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, shell=False
        )
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "timeout after %ds" % timeout


# umodel -list line: "   0      38B    AAB98 Texture AS_N_02"
LIST_LINE_RE = re.compile(
    r"^\s*(\d+)\s+([0-9A-Fa-f]+)\s+([0-9A-Fa-f]+)\s+(\w+)\s+(.+?)\s*$"
)
LIST_HEADER_RE = re.compile(
    r"^Loading package:\s+(\S+)\s+Ver:\s+(\d+)/(\d+)\s+Names:\s+(\d+)\s+"
    r"Exports:\s+(\d+)\s+Imports:\s+(\d+)",
    re.MULTILINE,
)


def parse_umodel_list(stdout):
    header = LIST_HEADER_RE.search(stdout)
    info = {
        "ver": None, "licenseeVer": None,
        "names": None, "exports": None, "imports": None,
    }
    if header:
        info = {
            "ver": int(header.group(2)),
            "licenseeVer": int(header.group(3)),
            "names": int(header.group(4)),
            "exports": int(header.group(5)),
            "imports": int(header.group(6)),
        }
    textures = []
    for line in stdout.splitlines():
        m = LIST_LINE_RE.match(line)
        if not m:
            continue
        textures.append({
            "index": int(m.group(1)),
            "offset": m.group(2),
            "size": int(m.group(3), 16),
            "class": m.group(4),
            "name": m.group(5),
        })
    return info, textures


def cache_key(path):
    st = path.stat()
    raw = "%s|%d|%d" % (str(path), int(st.st_mtime), st.st_size)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def get_contents(pkg_abs):
    """Parsed `umodel -list` for a package, cached on disk by content key."""
    key = cache_key(pkg_abs)
    cache_file = LIST_CACHE_DIR / ("%s.json" % key)
    if cache_file.is_file():
        with open(cache_file, "r", encoding="utf-8") as fh:
            return json.load(fh)
    if not UMODEL.is_file():
        raise ApiError("umodel binary not found at %s" % UMODEL, status=500)
    rc, out, err = run([str(UMODEL), "-game=l2", "-list", str(pkg_abs)])
    if rc != 0:
        raise ApiError("umodel -list failed (rc=%d): %s" % (rc, err or out),
                       status=500)
    info, textures = parse_umodel_list(out)
    payload = {
        "package": pkg_abs.name,
        "relPath": None,  # filled by caller
        "info": info,
        "textures": textures,
        "cachedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    LIST_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with open(cache_file, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)
    return payload


def ensure_export(pkg_abs):
    """Export the whole package once and build PNG thumbs + full-size images.

    Returns the package cache dir. Layout:
      pkg/<key>/export/<pkgbase>/Texture/*.tga   (umodel -export output)
      pkg/<key>/thumbs/<name>.png                (sips -Z 128)
      pkg/<key>/full/<name>.png                  (sips, original size)
    """
    key = cache_key(pkg_abs)
    dest = PKG_CACHE_DIR / key
    marker = dest / ".done"
    if marker.is_file():
        return dest
    with EXPORT_LOCK:
        if marker.is_file():   # another thread finished while we waited
            return dest
        if not UMODEL.is_file():
            raise ApiError("umodel binary not found at %s" % UMODEL, status=500)
        export_dir = dest / "export"
        export_dir.mkdir(parents=True, exist_ok=True)
        # -out MUST be absolute (umodel resolves relative paths against $HOME)
        rc, out, err = run([
            str(UMODEL), "-game=l2", "-export",
            "-out=%s" % export_dir, str(pkg_abs),
        ])
        if rc != 0:
            shutil.rmtree(dest, ignore_errors=True)
            raise ApiError("umodel -export failed (rc=%d): %s" % (rc, err or out),
                           status=500)
        tga_dir = export_dir / pkg_abs.stem / "Texture"
        thumbs_dir = dest / "thumbs"
        full_dir = dest / "full"
        thumbs_dir.mkdir(parents=True, exist_ok=True)
        full_dir.mkdir(parents=True, exist_ok=True)
        if tga_dir.is_dir():
            for tga in sorted(tga_dir.glob("*.tga")):
                name = tga.stem
                run([SIPS, "-Z", "128", "-s", "format", "png", str(tga),
                     "--out", str(thumbs_dir / ("%s.png" % name))])
                run([SIPS, "-s", "format", "png", str(tga),
                     "--out", str(full_dir / ("%s.png" % name))])
        marker.write_text("ok\n")
    return dest


# ---------------------------------------------------------------------------
# Phase B adapter — texture replace via tools/utx/utxedit.py
# ---------------------------------------------------------------------------

def writer_ready():
    return UTXEDIT.is_file()


def replace_texture(pkg_abs, texture_name, png_bytes):
    """Swap one texture inside a .utx via the utxedit CLI (frozen contract).

    Raises ApiError(503, code="writer-not-ready") while tools/utx/utxedit.py
    does not exist, so the UI can show a graceful Phase-B-pending state.
    """
    if not writer_ready():
        raise ApiError(
            "texture writer not ready: %s does not exist yet (Phase B tool "
            "is being built separately)" % UTXEDIT,
            status=503, code="writer-not-ready",
        )
    tmp_dir = tempfile.mkdtemp(prefix="l2editor-")
    try:
        png_path = Path(tmp_dir) / "replacement.png"
        png_path.write_bytes(png_bytes)
        rc, out, err = run([
            sys.executable, str(UTXEDIT), "replace",
            str(pkg_abs), texture_name, str(png_path),
        ])
        if rc != 0:
            raise ApiError("utxedit replace failed (rc=%d): %s"
                           % (rc, (err or out).strip()), status=500)
        return out.strip()
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def invalidate_cache(pkg_abs):
    """Drop all cached data for a package after a successful replace."""
    key = cache_key(pkg_abs)
    shutil.rmtree(PKG_CACHE_DIR / key, ignore_errors=True)
    stale = LIST_CACHE_DIR / ("%s.json" % key)
    if stale.is_file():
        stale.unlink()


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class EditorHandler(BaseHTTPRequestHandler):
    server_version = "L2AssetEditor/0.1"

    def log_message(self, fmt, *args):
        sys.stdout.write("%s - %s\n" % (self.log_date_time_string(), fmt % args))
        sys.stdout.flush()

    # -- helpers -----------------------------------------------------------

    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, status, message, code=None):
        payload = {"ok": False, "error": message}
        if code:
            payload["code"] = code
        self._send_json(payload, status=status)

    def _read_body(self):
        length = self.headers.get("Content-Length")
        if length is None:
            raise ApiError("missing Content-Length", status=411)
        try:
            length = int(length)
        except ValueError:
            raise ApiError("invalid Content-Length")
        if length > MAX_BODY_BYTES:
            raise ApiError("body too large", status=413)
        return self.rfile.read(length)

    def _query(self):
        parsed = urlparse(self.path)
        return parsed.path, {
            k: v[0] for k, v in parse_qs(parsed.query).items()
        }

    # -- routing -----------------------------------------------------------

    def do_GET(self):
        path, qs = self._query()
        try:
            if path == "/":
                self._serve_index()
            elif path == "/api/config":
                self._serve_config()
            elif path == "/api/packages":
                self._serve_packages()
            elif path == "/api/contents":
                self._serve_contents(qs)
            elif path == "/api/thumbs":
                self._serve_thumbs(qs)
            elif path == "/api/image":
                self._serve_image(qs)
            else:
                self._send_error_json(404, "route not found: %s" % path)
        except ApiError as exc:
            self._send_error_json(exc.status, str(exc), code=exc.code)
        except Exception as exc:  # noqa: BLE001 - do not leak tracebacks
            self._send_error_json(500, "internal error: %s" % exc)

    def do_POST(self):
        path, _qs = self._query()
        try:
            if path == "/api/config":
                self._handle_config()
            elif path == "/api/replace":
                self._handle_replace()
            elif path.startswith("/api/"):
                self._send_error_json(404, "route not found: %s" % path)
            else:
                self._send_error_json(405, "method not allowed on %s" % path)
        except ApiError as exc:
            self._send_error_json(exc.status, str(exc), code=exc.code)
        except Exception as exc:  # noqa: BLE001
            self._send_error_json(500, "internal error: %s" % exc)

    def _method_not_allowed(self):
        self._send_error_json(405, "method not allowed")

    do_PUT = _method_not_allowed
    do_DELETE = _method_not_allowed
    do_PATCH = _method_not_allowed

    # -- endpoints ---------------------------------------------------------

    def _serve_index(self):
        if not INDEX_PATH.exists():
            self._send_error_json(404, "editor/index.html is missing")
            return
        body = INDEX_PATH.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _config_payload(self):
        root = asset_root()
        return {
            "assetRoot": SETTINGS.get("assetRoot", DEFAULT_ASSET_ROOT),
            "assetRootAbs": str(root),
            "assetRootExists": root.is_dir(),
            "defaultAssetRoot": DEFAULT_ASSET_ROOT,
            "umodelReady": UMODEL.is_file(),
            "writerReady": writer_ready(),
        }

    def _serve_config(self):
        self._send_json(self._config_payload())

    def _handle_config(self):
        body = self._read_body()
        try:
            payload = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise ApiError("invalid JSON")
        raw = payload.get("assetRoot", "").strip()
        if not raw:
            raise ApiError("assetRoot is required")
        p = Path(raw)
        if not p.is_absolute():
            p = (ROOT_DIR / p).resolve()
        if not p.is_dir():
            raise ApiError("directory does not exist: %s" % raw, status=404)
        SETTINGS["assetRoot"] = raw
        save_settings(SETTINGS)
        self._send_json({"ok": True, "config": self._config_payload()})

    def _serve_packages(self):
        root = asset_root()
        packages = []
        if root.is_dir():
            for path in sorted(root.rglob("*")):
                if path.is_file() and path.suffix.lower() == ".utx":
                    st = path.stat()
                    packages.append({
                        "relPath": path.relative_to(root).as_posix(),
                        "name": path.name,
                        "sizeBytes": st.st_size,
                        "mtime": int(st.st_mtime),
                    })
        self._send_json({
            "assetRoot": str(root),
            "assetRootExists": root.is_dir(),
            "packages": packages,
        })

    def _serve_contents(self, qs):
        pkg_abs = resolve_package(unquote(qs.get("pkg", "")))
        payload = get_contents(pkg_abs)
        payload["relPath"] = qs.get("pkg", "")
        self._send_json(payload)

    def _serve_thumbs(self, qs):
        pkg_abs = resolve_package(unquote(qs.get("pkg", "")))
        contents = get_contents(pkg_abs)
        dest = ensure_export(pkg_abs)
        thumbs_dir = dest / "thumbs"
        textures = []
        for tex in contents["textures"]:
            if tex["class"] != "Texture":
                continue
            thumb = thumbs_dir / ("%s.png" % tex["name"])
            textures.append({
                "name": tex["name"],
                "size": tex["size"],
                "hasThumb": thumb.is_file(),
            })
        self._send_json({
            "package": pkg_abs.name,
            "textures": textures,
        })

    def _serve_image(self, qs):
        pkg_abs = resolve_package(unquote(qs.get("pkg", "")))
        name = safe_texture_name(unquote(qs.get("name", "")))
        kind = qs.get("kind", "thumb")
        kind_dir = {"thumb": "thumbs", "full": "full"}.get(kind)
        if kind_dir is None:
            raise ApiError("kind must be thumb or full")
        dest = ensure_export(pkg_abs)
        png = dest / kind_dir / ("%s.png" % name)
        if not png.is_file():
            raise ApiError("image not found: %s (%s)" % (name, kind), status=404)
        body = png.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def _handle_replace(self):
        body = self._read_body()
        try:
            payload = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise ApiError("invalid JSON")
        pkg_abs = resolve_package(payload.get("pkg", ""))
        texture = safe_texture_name(payload.get("texture", ""))
        image_b64 = payload.get("imageBase64", "")
        if not image_b64:
            raise ApiError("imageBase64 is required")
        try:
            png_bytes = base64.b64decode(image_b64, validate=True)
        except (ValueError, TypeError):
            raise ApiError("imageBase64 is not valid base64")
        if not png_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ApiError("replacement image must be a PNG")
        output = replace_texture(pkg_abs, texture, png_bytes)
        invalidate_cache(pkg_abs)
        self._send_json({"ok": True, "output": output})


def main():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), EditorHandler)
    print("L2Vzla Asset Editor listening on http://%s:%d" % (HOST, PORT))
    print("asset root: %s" % asset_root())
    print("umodel: %s | writer (utxedit): %s" % (
        "ready" if UMODEL.is_file() else "MISSING",
        "ready" if writer_ready() else "not ready (Phase B pending)",
    ))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
