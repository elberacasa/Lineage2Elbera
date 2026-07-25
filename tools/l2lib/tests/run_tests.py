#!/usr/bin/env python3
"""l2lib test runner: stdlib unittest over tools/l2lib/tests, then a
coverage summary (packages parsed, exports listed, textures decoded...).

Usage:  python3 tools/l2lib/tests/run_tests.py [-v]
"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS_DIR = os.path.dirname(os.path.dirname(HERE))
if TOOLS_DIR not in sys.path:
    sys.path.insert(0, TOOLS_DIR)

from l2lib.tests.common import STATS  # noqa: E402


def main(argv):
    verbosity = 2 if "-v" in argv else 1
    suite = unittest.defaultTestLoader.discover(HERE, pattern="test_*.py",
                                                top_level_dir=TOOLS_DIR)
    result = unittest.TextTestRunner(verbosity=verbosity).run(suite)
    print("\n--- l2lib coverage ---")
    labels = [
        ("packages_parsed", "packages parsed"),
        ("exports_listed", "exports listed"),
        ("umodel_offsets_checked", "export offsets cross-checked vs umodel"),
        ("textures_decoded", "textures decoded to RGBA"),
        ("dat_records_read", ".dat records read"),
    ]
    for key, label in labels:
        print("  %-40s %d" % (label + ":", STATS[key]))
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
