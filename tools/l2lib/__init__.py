"""l2lib - unified parser core for Lineage 2 Interlude file formats.

Canonical Python 3 stdlib library for every L2 file format reverse-
engineered in this project. See README.md for the format knowledge base.

Quick start:

    from l2lib import load_package, parse_texture, extract_texture_rgba

    pkg, protocol = load_package("assets/interlude/textures/T_20_20.utx")
    for e in pkg.exports_by_class("Texture"):
        w, h, rgba, info = extract_texture_rgba(pkg, e)
        print(pkg.export_name(e), info.format_name, w, h)

    from l2lib.l2dat import load_dat
    reader, protocol = load_dat("assets/interlude/system/chargrp.dat")
"""

from .ue2package import (
    PACKAGE_TAG, RF_HAS_STACK, L2Error, Reader, encode_compact,
    Export, Import, Package, StateFrame, read_state_frame,
    read_properties, read_fstring, read_lineage_material_block,
    parse_texture, parse_palette, mip_bytes, Mip, TextureInfo,
    resolve_material, mesh_material_slots,
    detect_protocol, decode_121, run_l2encdec, decrypt_file_bytes,
    load_package,
    TEXF_P8, TEXF_RGBA7, TEXF_RGB16, TEXF_DXT1, TEXF_RGB8, TEXF_RGBA8,
    TEXF_NODATA, TEXF_DXT3, TEXF_DXT5, TEXF_L8, TEXF_G16, FORMAT_NAMES,
    L2ENCDEC,
)
from .l2dat import DatReader, decrypt_dat, load_dat
from .textures import (
    decode_pixels, decode_dxt1, decode_dxt3, decode_dxt5,
    decode_rgba8, decode_rgb8, decode_l8, decode_p8, decode_g16,
    extract_texture_rgba, write_png, DECODERS,
)

__version__ = "1.0.0"

__all__ = [
    "PACKAGE_TAG", "RF_HAS_STACK", "L2Error", "Reader", "encode_compact",
    "Export", "Import", "Package", "StateFrame", "read_state_frame",
    "read_properties", "read_fstring", "read_lineage_material_block",
    "parse_texture", "parse_palette", "mip_bytes", "Mip", "TextureInfo",
    "resolve_material", "mesh_material_slots",
    "detect_protocol", "decode_121", "run_l2encdec", "decrypt_file_bytes",
    "load_package", "L2ENCDEC",
    "DatReader", "decrypt_dat", "load_dat",
    "decode_pixels", "decode_dxt1", "decode_dxt3", "decode_dxt5",
    "decode_rgba8", "decode_rgb8", "decode_l8", "decode_p8", "decode_g16",
    "extract_texture_rgba", "write_png", "DECODERS",
    "TEXF_P8", "TEXF_RGBA7", "TEXF_RGB16", "TEXF_DXT1", "TEXF_RGB8",
    "TEXF_RGBA8", "TEXF_NODATA", "TEXF_DXT3", "TEXF_DXT5", "TEXF_L8",
    "TEXF_G16", "FORMAT_NAMES",
]
