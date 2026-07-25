#!/usr/bin/env python3
"""Generates panel/config-defaults.json with the STOCK aCis rev 409 defaults.

Source of truth: the git history of server/ (HEAD still has the untouched
configs). For each config file we read `git show HEAD:aCis_gameserver/config/
<file>.properties` and parse it with the same logic the backend uses
(panel/server.py parse_properties):
  - `key = value` -> value
  - bare lines (geoengine region directives) -> "true" when present,
    "false" when absent from the HEAD file.

Keys that exist in the catalog but not at HEAD (custom mods added after the
clone, e.g. OfflineTrade*) fall back to the value in the current working-tree
file, which is the default the mod itself introduced. Those keys are listed
when the script runs.

Re-run after changing the catalog or the stock configs:
  /usr/bin/python3 panel/.gen_defaults.py
"""
import json
import os
import subprocess
import sys

PANEL_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(PANEL_DIR)
SERVER_REPO = os.path.join(ROOT_DIR, "server")
SOURCE_CONFIG_DIR = os.path.join(SERVER_REPO, "aCis_gameserver", "config")
CATALOG_PATH = os.path.join(PANEL_DIR, "config-catalog.json")
OUT_PATH = os.path.join(PANEL_DIR, "config-defaults.json")


def parse_properties_text(text):
    """Same parsing rules as panel/server.py parse_properties."""
    values = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("!"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip()
        else:
            values[line] = "true"
    return values


def git_show_head(filename):
    rel = "aCis_gameserver/config/%s" % filename
    result = subprocess.run(
        ["git", "-C", SERVER_REPO, "show", "HEAD:%s" % rel],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        sys.exit(
            "git show HEAD:%s fallo: %s"
            % (rel, result.stderr.decode("utf-8", "replace").strip())
        )
    return result.stdout.decode("utf-8", "surrogateescape")


def read_live(filename):
    path = os.path.join(SOURCE_CONFIG_DIR, filename)
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8", errors="surrogateescape") as fh:
        return parse_properties_text(fh.read())


def main():
    with open(CATALOG_PATH, "r", encoding="utf-8") as fh:
        catalog = json.load(fh)

    files = sorted({entry["file"] for entry in catalog})
    head_values = {f: parse_properties_text(git_show_head(f)) for f in files}
    live_values = {}

    defaults = {}
    mod_added = []
    for entry in catalog:
        filename, key = entry["file"], entry["key"]
        pair = "%s:%s" % (filename, key)
        stock = head_values[filename]
        if key in stock:
            defaults[pair] = stock[key]
        elif entry["category"] == "geoengine-regions":
            defaults[pair] = "false"  # directiva ausente en HEAD = region off
        else:
            # Clave añadida por mods posteriores al clon (no existe en HEAD):
            # el valor por defecto es el que el propio mod introdujo (working tree).
            if filename not in live_values:
                live_values[filename] = read_live(filename)
            defaults[pair] = live_values[filename].get(key, "")
            mod_added.append(pair)

    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(defaults, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")

    print("Escritos %d defaults en %s" % (len(defaults), OUT_PATH))
    if mod_added:
        print("Claves sin valor en HEAD (default del propio mod):")
        for pair in mod_added:
            print("  %s = %r" % (pair, defaults[pair]))


if __name__ == "__main__":
    main()
