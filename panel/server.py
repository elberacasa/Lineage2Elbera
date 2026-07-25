#!/usr/bin/env python3
"""Panel web de configuración — backend (aCis Interlude rev 409).

Servidor HTTP sin dependencias (solo stdlib, Python 3.9) en el puerto 8080.

Endpoints:
  GET  /                    -> panel/index.html
  GET  /api/catalog         -> contenido de panel/config-catalog.json
  GET  /api/values          -> {"<file>:<key>": "<valor crudo>"} leído en vivo
                               de server/aCis_gameserver/config/*.properties
  GET  /api/defaults        -> {"<file>:<key>": "<valor stock>"} con los valores
                               originales de aCis rev 409 (panel/config-defaults.json,
                               generado por panel/.gen_defaults.py desde git HEAD)
  POST /api/save            -> {"changes": [{"file","key","value"}, ...]}
                               reescribe solo las líneas afectadas, hace backup en
                               panel/backups/<timestamp>/ y sincroniza a build/dist.
  GET  /api/status          -> estado de loginserver/gameserver (proceso y puerto)
  POST /api/restart-hint    -> mensaje estático (aCis requiere reinicio manual)
"""

import json
import re
import shutil
import socket
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent          # panel/
ROOT_DIR = BASE_DIR.parent                          # repo root
SOURCE_CONFIG_DIR = ROOT_DIR / "server" / "aCis_gameserver" / "config"
DIST_LOGIN_CONFIG = (
    ROOT_DIR / "server" / "aCis_gameserver" / "build" / "dist" / "login" / "config"
)
DIST_GAME_CONFIG = (
    ROOT_DIR / "server" / "aCis_gameserver" / "build" / "dist" / "gameserver" / "config"
)
CATALOG_PATH = BASE_DIR / "config-catalog.json"
DEFAULTS_PATH = BASE_DIR / "config-defaults.json"
INDEX_PATH = BASE_DIR / "index.html"
BACKUPS_DIR = BASE_DIR / "backups"

HOST = "127.0.0.1"
PORT = 8080

LOGIN_PROC_PATTERN = "net.sf.l2j.loginserver.LoginServer"
GAME_PROC_PATTERN = "net.sf.l2j.gameserver.GameServer"
LOGIN_PORT = 2106
GAME_PORT = 7777

RESTART_HINT_MESSAGE = (
    "Los cambios se guardaron correctamente. aCis carga la configuración "
    "únicamente al arrancar: para aplicar los cambios debes reiniciar "
    "manualmente el loginserver y/o el gameserver (por ejemplo, con los "
    "scripts startLoginServer.sh y startGameServer.sh en build/dist)."
)

MAX_BODY_BYTES = 1 * 1024 * 1024  # 1 MB


# ---------------------------------------------------------------------------
# Catálogo y parsing de .properties
# ---------------------------------------------------------------------------

def load_catalog():
    with open(CATALOG_PATH, "r", encoding="utf-8") as fh:
        entries = json.load(fh)
    by_pair = {}
    files = set()
    for entry in entries:
        pair = (entry["file"], entry["key"])
        by_pair[pair] = entry
        files.add(entry["file"])
    return entries, by_pair, files


CATALOG, CATALOG_BY_PAIR, CATALOG_FILES = load_catalog()


def load_defaults():
    """Carga los valores stock (aCis rev 409) generados por .gen_defaults.py.

    Devuelve None si el archivo no existe todavía; el endpoint responde 503.
    """
    if not DEFAULTS_PATH.exists():
        return None
    with open(DEFAULTS_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


DEFAULTS = load_defaults()


def source_path(filename):
    """Ruta del archivo de origen, validada contra el catálogo (sin traversal)."""
    if filename not in CATALOG_FILES:
        raise ValueError("archivo desconocido: %r" % filename)
    return SOURCE_CONFIG_DIR / filename


def dist_path(filename):
    if filename == "loginserver.properties":
        return DIST_LOGIN_CONFIG / filename
    return DIST_GAME_CONFIG / filename


def is_region_directive(entry):
    """Las regiones de geoengine son líneas sin '=' (presencia = true)."""
    return entry["category"] == "geoengine-regions"


def read_lines(path):
    # surrogateescape garantiza round-trip byte-exacto aunque el archivo no sea UTF-8.
    with open(path, "r", encoding="utf-8", errors="surrogateescape", newline="") as fh:
        return fh.readlines()


def write_lines(path, lines):
    with open(path, "w", encoding="utf-8", errors="surrogateescape", newline="") as fh:
        fh.writelines(lines)


def parse_properties(path):
    """Devuelve {key: value} para un .properties.

    - `key = value` / `key=value` con espacios opcionales.
    - `#`/`!` = comentarios.
    - líneas sin `=` (directivas de región de geoengine) -> valor "true".
    """
    values = {}
    for raw in read_lines(path):
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("!"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip()
        else:
            values[line] = "true"
    return values


# ---------------------------------------------------------------------------
# Aplicación de cambios
# ---------------------------------------------------------------------------

class SaveError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def apply_change_to_lines(lines, entry, value):
    """Modifica `lines` in-place para un cambio. Devuelve True si hubo cambio."""
    key = entry["key"]
    if is_region_directive(entry):
        wanted = value.strip().lower() in ("true", "1", "yes", "on")
        pattern = re.compile(r"^\s*" + re.escape(key) + r"\s*$")
        found = False
        kept = []
        for raw in lines:
            if pattern.match(raw.rstrip("\r\n")):
                found = True
                if wanted:
                    kept.append(raw)  # conservar la línea existente
                # si not wanted: se omite (se elimina)
            else:
                kept.append(raw)
        if wanted and not found:
            if kept and not kept[-1].endswith("\n"):
                kept[-1] = kept[-1] + "\n"
            kept.append(key + "\n")
        elif not wanted and not found:
            return False
        lines[:] = kept
        return True

    # Clave normal `key = value`: reemplazar solo el valor, conservando
    # indentación, espacios alrededor de '=' y el resto del formato.
    pattern = re.compile(
        r"^(\s*" + re.escape(key) + r"\s*=\s*)(.*?)(\s*)((?:#|!).*)?(\r?\n?)$"
    )
    for idx, raw in enumerate(lines):
        match = pattern.match(raw)
        if match:
            prefix, _old, _trail_ws, comment, eol = match.groups()
            new_line = prefix + value
            if comment:
                new_line += " " + comment
            new_line += eol if eol else "\n"
            lines[idx] = new_line
            return True
    raise SaveError(
        "la clave %r no se encontró en %s" % (key, entry["file"]), status=400
    )


def save_changes(changes):
    # Validar TODO antes de tocar ningún archivo.
    if not isinstance(changes, list) or not changes:
        raise SaveError("'changes' debe ser una lista no vacía")
    per_file = {}
    for change in changes:
        if not isinstance(change, dict):
            raise SaveError("cada cambio debe ser un objeto {file, key, value}")
        filename = change.get("file")
        key = change.get("key")
        value = change.get("value")
        if not isinstance(filename, str) or not isinstance(key, str):
            raise SaveError("cada cambio necesita 'file' y 'key' (strings)")
        if not isinstance(value, str):
            value = str(value)
        entry = CATALOG_BY_PAIR.get((filename, key))
        if filename not in CATALOG_FILES:
            raise SaveError("archivo desconocido: %r" % filename)
        if entry is None:
            raise SaveError(
                "clave desconocida: %r en %s" % (key, filename), status=400
            )
        per_file.setdefault(filename, []).append((entry, value))

    # Backup de todos los archivos afectados antes de escribir.
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    backup_dir = BACKUPS_DIR / timestamp
    suffix = 1
    while backup_dir.exists():  # dos saves en el mismo segundo
        backup_dir = BACKUPS_DIR / ("%s-%d" % (timestamp, suffix))
        suffix += 1
    backup_dir.mkdir(parents=True)
    for filename in per_file:
        shutil.copy2(source_path(filename), backup_dir / filename)

    # Aplicar cambios archivo por archivo (una escritura por archivo).
    for filename, file_changes in per_file.items():
        path = source_path(filename)
        lines = read_lines(path)
        for entry, value in file_changes:
            apply_change_to_lines(lines, entry, value)
        write_lines(path, lines)

    # Sincronizar a las copias runtime de build/dist.
    for filename in per_file:
        target = dist_path(filename)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path(filename), target)

    return sorted(per_file.keys())


# ---------------------------------------------------------------------------
# Estado de los servidores
# ---------------------------------------------------------------------------

def process_running(pattern):
    try:
        result = subprocess.run(
            ["pgrep", "-f", pattern],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
        return result.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def port_open(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False


def server_status():
    return {
        "loginserver": {
            "running": process_running(LOGIN_PROC_PATTERN),
            "port_open": port_open(LOGIN_PORT),
        },
        "gameserver": {
            "running": process_running(GAME_PROC_PATTERN),
            "port_open": port_open(GAME_PORT),
        },
    }


# ---------------------------------------------------------------------------
# Handler HTTP
# ---------------------------------------------------------------------------

class PanelHandler(BaseHTTPRequestHandler):
    server_version = "L2Panel/1.0"

    def log_message(self, fmt, *args):
        sys.stdout.write(
            "%s - %s\n" % (self.log_date_time_string(), fmt % args)
        )
        sys.stdout.flush()

    # -- helpers -----------------------------------------------------------

    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, status, message):
        self._send_json({"ok": False, "error": message}, status=status)

    def _read_body(self):
        length = self.headers.get("Content-Length")
        if length is None:
            raise SaveError("falta Content-Length", status=411)
        try:
            length = int(length)
        except ValueError:
            raise SaveError("Content-Length inválido", status=400)
        if length > MAX_BODY_BYTES:
            raise SaveError("cuerpo demasiado grande", status=413)
        return self.rfile.read(length)

    # -- routing -----------------------------------------------------------

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/":
            self._serve_index()
        elif path == "/api/catalog":
            self._send_json(CATALOG)
        elif path == "/api/values":
            self._serve_values()
        elif path == "/api/defaults":
            self._serve_defaults()
        elif path == "/api/status":
            self._send_json(server_status())
        else:
            self._send_error_json(404, "ruta no encontrada: %s" % path)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/save":
            self._handle_save()
        elif path == "/api/restart-hint":
            self._send_json({"ok": True, "message": RESTART_HINT_MESSAGE})
        elif path.startswith("/api/"):
            self._send_error_json(404, "ruta no encontrada: %s" % path)
        else:
            self._send_error_json(405, "método no permitido en %s" % path)

    def _method_not_allowed(self):
        self._send_error_json(405, "método no permitido")

    do_PUT = _method_not_allowed
    do_DELETE = _method_not_allowed
    do_PATCH = _method_not_allowed

    # -- endpoints ---------------------------------------------------------

    def _serve_index(self):
        if not INDEX_PATH.exists():
            self._send_error_json(404, "panel/index.html no existe todavía")
            return
        body = INDEX_PATH.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_values(self):
        values = {}
        per_file = {}
        for (filename, _key) in CATALOG_BY_PAIR:
            per_file.setdefault(filename, None)  # lazy
        for filename in per_file:
            path = source_path(filename)
            if not path.exists():
                continue
            per_file[filename] = parse_properties(path)
        for (filename, key), entry in CATALOG_BY_PAIR.items():
            file_values = per_file.get(filename) or {}
            raw = file_values.get(key)
            if raw is None:
                # Directiva de región ausente -> false; clave normal ausente -> ""
                raw = "false" if is_region_directive(entry) else ""
            values["%s:%s" % (filename, key)] = raw
        self._send_json(values)

    def _serve_defaults(self):
        if DEFAULTS is None:
            self._send_error_json(
                503,
                "panel/config-defaults.json no existe: "
                "ejecuta /usr/bin/python3 panel/.gen_defaults.py",
            )
            return
        self._send_json(DEFAULTS)

    def _handle_save(self):
        try:
            body = self._read_body()
            try:
                payload = json.loads(body.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                raise SaveError("JSON inválido")
            if not isinstance(payload, dict) or "changes" not in payload:
                raise SaveError("se esperaba un objeto con 'changes'")
            written = save_changes(payload["changes"])
        except SaveError as exc:
            self._send_error_json(exc.status, str(exc))
            return
        except Exception as exc:  # noqa: BLE001 - no exponer trazas al cliente
            self._send_error_json(500, "error interno: %s" % exc)
            return
        self._send_json({"ok": True, "written": written})


def main():
    server = ThreadingHTTPServer((HOST, PORT), PanelHandler)
    print("Panel de configuración escuchando en http://%s:%d" % (HOST, PORT))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
