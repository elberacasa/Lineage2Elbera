#!/usr/bin/env python3
"""unrparse - deep-parse Lineage 2 Interlude .unr map packages.

Stage 1 (this file): decrypt + parse the UE2 package tables (names, imports,
exports) and list every export with its class, size and offset. Reuses the
verified package parser from tools/utx/utxedit.py.

Usage:
    python3 unrparse.py tables <map.unr> [<map2.unr> ...]
"""

import os
import sys

TOOLS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(TOOLS, "utx"))

import utxedit  # noqa: E402


class MapPackage(utxedit.Package):
    """utxedit.Package with the version check relaxed: Interlude .unr maps
    are package version 123 (licensee 25) but use the exact same summary and
    table layout as v117 .utx files (verified against 16_10.unr)."""

    def __init__(self, data):
        version = utxedit.struct.unpack_from("<H", data, 4)[0]
        saved = utxedit.SUPPORTED_VERSION
        utxedit.SUPPORTED_VERSION = version
        try:
            super().__init__(data)
        finally:
            utxedit.SUPPORTED_VERSION = saved


def load_map(path):
    with open(path, "rb") as f:
        data = f.read()
    protocol = utxedit.detect_protocol(data)
    if protocol == 121:
        plain = utxedit.decode_121(data)
    elif protocol is not None:
        plain = utxedit.run_l2encdec("decode", protocol, data,
                                     os.path.basename(path))
    else:
        plain = data
    return MapPackage(plain), protocol


def object_full_name(pkg, index):
    """Resolve a compact object index: >0 export, <0 import, 0 = None."""
    if index == 0:
        return "None"
    if index > 0:
        e = pkg.exports[index - 1]
        return "exp:%s" % pkg.export_name(e)
    imp = pkg.imports[-index - 1]
    return "imp:%s (%s)" % (pkg.name(imp.object_name),
                            pkg.name(imp.class_name))


def cmd_tables(paths):
    for path in paths:
        pkg, protocol = load_map(path)
        print("=" * 78)
        print("%s  (protocol=%s, %d bytes decrypted)"
              % (path, protocol, len(pkg.data)))
        print("  package v%d licensee %d flags 0x%08X"
              % (pkg.file_version, pkg.licensee_version, pkg.package_flags))
        print("  names=%d imports=%d exports=%d"
              % (len(pkg.names), len(pkg.imports), len(pkg.exports)))
        # class histogram
        hist = {}
        for e in pkg.exports:
            cn = pkg.class_name_of(e)
            hist[cn] = hist.get(cn, 0) + 1
        print("  export classes: %s" % sorted(hist.items(),
                                              key=lambda kv: -kv[1]))
        # import package histogram (what other packages this map needs)
        ph = {}
        for imp in pkg.imports:
            cp = pkg.name(imp.class_package)
            ph[cp] = ph.get(cp, 0) + 1
        print("  import class-packages: %s" % sorted(ph.items(),
                                                     key=lambda kv: -kv[1]))
        print("  exports:")
        for e in pkg.exports:
            print("    [%4d] %-28s %-32s size=%-9d off=%-9d super=%s"
                  % (e.index, pkg.class_name_of(e), pkg.export_name(e),
                     e.serial_size, e.serial_offset,
                     object_full_name(pkg, e.super_index)
                     if e.super_index else "-"))
        print("  imports (sample, up to 40):")
        for i, imp in enumerate(pkg.imports[:40]):
            print("    [%4d] %-24s %-24s %s"
                  % (i, pkg.name(imp.class_package), pkg.name(imp.class_name),
                     pkg.name(imp.object_name)))
        if len(pkg.imports) > 40:
            print("    ... %d more" % (len(pkg.imports) - 40))


def main(argv):
    if len(argv) < 3 or argv[1] != "tables":
        print(__doc__)
        return 1
    cmd_tables(argv[2:])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
