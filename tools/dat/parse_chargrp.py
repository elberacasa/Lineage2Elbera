#!/usr/bin/env python3
"""Dump a decrypted Interlude chargrp.dat (summary per record).

Usage: python3 parse_chargrp.py <chargrp.dat.dec>

The authoritative parser lives in extract_charcreate.py; this is a thin
debugging/inspection CLI around the same schema.
"""

import sys

from extract_charcreate import parse_chargrp, parse_hairgrp, parse_classinfo


def main(path):
    with open(path, "rb") as f:
        data = f.read()
    if "hairgrp" in path:
        for i, rec in enumerate(parse_hairgrp(data)):
            print(f"record {i}: {rec}")
        return
    if "classinfo" in path:
        for cid, desc in parse_classinfo(data).items():
            print(f"id={cid}: {desc!r}")
        return
    for i, rec in enumerate(parse_chargrp(data)):
        print(f"--- record {i} icon={rec['face_icon']}")
        for key in ("hair_mesh", "hair_texture", "face_mesh", "face_texture",
                    "body_mesh", "body_texture"):
            print(f"  {key}: {rec[key]}")
        print(f"  attack_effect: {rec['attack_effect']} "
              f"walkanimframe: {rec['walkanimframe']}")


if __name__ == "__main__":
    main(sys.argv[1])
