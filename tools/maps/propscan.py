#!/usr/bin/env python3
"""Scan every export of a map for a valid tagged-property list, trying
candidate start offsets 0..24. Prints which offset yields a clean parse
(list ends in 'None' within export bounds), per class."""

import os
import sys

TOOLS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(TOOLS, "utx"))
import utxedit  # noqa: E402
from unrparse import load_map  # noqa: E402

SIZE_SEL = {0: 1, 1: 2, 2: 4, 3: 12, 4: 16}


def try_props(pkg, exp, start):
    """Returns (prop_list, end_pos) or None if the parse is invalid."""
    r = utxedit.Reader(pkg.data, exp.serial_offset + start)
    end = exp.serial_offset + exp.serial_size
    props = []
    try:
        for _ in range(400):
            ni = r.compact()
            if ni < 0 or ni >= len(pkg.names):
                return None
            nm = pkg.names[ni]
            if nm == "None":
                return props, r.pos
            info = r.u8()
            ptype = info & 0xF
            sel = (info >> 4) & 7
            if ptype == 0 or ptype > 15:
                return None
            if ptype == 10:
                si = r.compact()
                if si < 0 or si >= len(pkg.names):
                    return None
                sname = pkg.names[si]
            else:
                sname = None
            if sel in SIZE_SEL:
                ds = SIZE_SEL[sel]
            elif sel == 5:
                ds = r.u8()
            elif sel == 6:
                ds = r.u16()
            else:
                ds = r.u32()
            if ds > exp.serial_size:
                return None
            if ptype != 3 and (info & 0x80):
                b = r.u8()
                if b >= 128:
                    if b & 0x40:
                        r.u8(); r.u8(); r.u8()
                    else:
                        r.u8()
            if ptype != 3:
                if r.pos + ds > end:
                    return None
                r.pos += ds
            props.append((nm, ptype, ds, sname))
        return None
    except (IndexError, utxedit.UtxError):
        return None


def main():
    path = sys.argv[1]
    pkg, _ = load_map(path)
    by_class = {}
    for e in pkg.exports:
        cn = pkg.class_name_of(e)
        if cn in by_class and by_class[cn] is not None:
            continue
        found = None
        for start in range(0, 25):
            res = try_props(pkg, e, start)
            if res is None:
                continue
            props, endpos = res
            rel_end = endpos - e.serial_offset
            # require at least 1 prop or exact end match to accept
            if props or rel_end == e.serial_size:
                found = (start, props, rel_end, e.serial_size)
                break
        by_class[cn] = (pkg.export_name(e), found)
    for cn, (ename, found) in sorted(by_class.items()):
        if found is None:
            print("%-22s %-22s NO PROP LIST FOUND" % (cn, ename))
            continue
        start, props, rel_end, size = found
        tail = size - rel_end
        print("%-22s %-22s start=+%-3d props=%-3d tail=%d" %
              (cn, ename, start, len(props), tail))
        for p in props[:12]:
            print("      %-28s type=%-2d size=%-7d struct=%s" % p)
        if len(props) > 12:
            print("      ... %d more" % (len(props) - 12))


if __name__ == "__main__":
    main()
