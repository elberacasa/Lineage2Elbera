#!/usr/bin/env python3
"""Elbera Tools: original PlaySound packet and ordinary quest-sound evidence.

Read-only: supplied Engine.dll, Core.dll, ALAudio.dll and ItemSound.uax required.
Decodes only in memory; no client execution, sockets, accounts or asset output.
The radius import and full driver-update lifecycle remain explicitly unbound.
"""
import argparse
from fractions import Fraction
import hashlib
import json
import math
import struct
import sys

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA

sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(ROOT / 'tools/audio'))
from l2lib import load_package
from verify_falloff import PE
from sound_reference_aliases import original_path

ALAUDIO_SHA = '1a589f91b748eb0662ef29a0ef62cadcc40a18d56b46bb73a6e72a428f437f23'
CORE_SHA = '9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf'
ITEMSOUND_SHA = 'e16cd1701b485f4b76de4938af5674699b8622cb6e0c418c2c313044c485365d'
QUEST_SOUNDS = ('quest_accept', 'quest_middle', 'quest_finish', 'quest_itemget')
RADIUS_SLOT = 0x11d8dc10


def digest(data):
    return hashlib.sha256(data).hexdigest()


def recovered_span(raw, offset, size, key):
    """Independently recover whole words covering a possibly unaligned span.

    This checks existing bytes, not a missing-call reconstruction. No native
    code is run. The reverse addition must reproduce the exact supplied words.
    """
    begin, end = offset & ~3, (offset + size + 3) & ~3
    if offset < 0 or size <= 0 or end > len(raw):
        raise ValueError('recovery span exceeds original bytes')
    recovered = b''.join(((value - key) & 0xffffffff).to_bytes(4, 'little')
                         for (value,) in struct.iter_unpack('<I', raw[begin:end]))
    roundtrip = b''.join(((value + key) & 0xffffffff).to_bytes(4, 'little')
                        for (value,) in struct.iter_unpack('<I', recovered))
    assert roundtrip == raw[begin:end]
    return recovered[offset - begin:offset - begin + size]


def absolute_load_references(data, base, address):
    """Classify every literal address occurrence as a direct x86 pointer load.

    Deliberately limited to A1 moffs32 and 8B register,[disp32]. An unknown
    occurrence fails instead of silently disappearing from the inventory.
    This is a byte-signature inventory, not control-flow or indirect-write proof.
    """
    needle, offset, rows = struct.pack('<I', address), 0, []
    registers = ('eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi')
    while True:
        offset = data.find(needle, offset)
        if offset < 0:
            return rows
        if offset >= 1 and data[offset - 1] == 0xa1:
            start, register = offset - 1, 'eax'
        elif offset >= 2 and data[offset - 2] == 0x8b and data[offset - 1] & 0xc7 == 5:
            start, register = offset - 2, registers[(data[offset - 1] >> 3) & 7]
        else:
            raise ValueError('unclassified absolute-address occurrence at ' + hex(base + offset))
        rows.append({'VA': base + start, 'register': register})
        offset += 4


def radius_assertion_passes(radius):
    """The native `Radius` assertion is a nonzero test, not a finite/>0 gate.

    Its unordered x87 result takes the nonzero branch too. This small model is
    evidence documentation, not a recommended runtime validation policy.
    """
    return radius != 0


def dry_gain_witness(volume, radius, distance):
    """Exact-real witness for the recovered gain formula, not x87 emulation.

    Explicit finite inputs are required by this analysis, although the native
    assertion does not enforce them. Fraction avoids calling ordinary double
    rounding a proof of native extended-precision arithmetic.
    """
    if not all(math.isfinite(v) for v in (volume, radius, distance)) or radius == 0:
        raise ValueError('gain witness requires finite inputs and nonzero radius')
    v, r, d = map(Fraction, (volume, radius, distance))
    return max(Fraction(0), min(Fraction(1), v * (r * 50 - d) / (r * 50)))


def wave_info(data):
    """Read a complete RIFF/WAVE container; never search arbitrary PCM bytes."""
    if len(data) < 12 or data[:4] != b'RIFF' or data[8:12] != b'WAVE':
        raise ValueError('not a RIFF/WAVE container')
    if struct.unpack_from('<I', data, 4)[0] + 8 != len(data):
        raise ValueError('RIFF size does not match the complete input')
    fields, pcm_size, offset = None, None, 12
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError('truncated RIFF chunk header')
        name, size = struct.unpack_from('<4sI', data, offset)
        start, end = offset + 8, offset + 8 + size
        if end + (size & 1) > len(data):
            raise ValueError('RIFF chunk exceeds container')
        if name == b'fmt ':
            if fields is not None or size != 16:
                raise ValueError('expected one plain PCM format chunk')
            fields = struct.unpack_from('<HHIIHH', data, start)
        elif name == b'data':
            if pcm_size is not None:
                raise ValueError('duplicate data chunk')
            pcm_size = size
        offset = end + (size & 1)
    if fields is None or pcm_size is None:
        raise ValueError('missing format/data chunk')
    encoding, channels, rate, byte_rate, block, bits = fields
    if (encoding != 1 or channels not in (1, 2) or bits not in (8, 16)
            or rate <= 0 or block != channels * (bits // 8)
            or byte_rate != rate * block or pcm_size % block):
        raise ValueError('inconsistent plain PCM format')
    return {'encoding': encoding, 'channels': channels, 'sampleRate': rate,
            'bitsPerSample': bits, 'frames': pcm_size // block,
            'bytes': len(data), 'SHA256': digest(data)}


def collect_quest_waves(source=None):
    """Return metadata plus unchanged PCM containers for the four exact names.

    The configured server uses short package/leaf references. Require that each
    leaf identifies exactly one original Sound export, and preserve its actual
    group path separately. This does not claim a general native name resolver.
    """
    source = source or ROOT / 'assets/interlude/sounds/ItemSound.uax'
    assert digest(source.read_bytes()) == ITEMSOUND_SHA
    package, _ = load_package(str(source))
    sounds, waves = {}, {}
    for export in package.exports_by_class('Sound'):
        name = package.export_name(export)
        if name not in QUEST_SOUNDS:
            continue
        key = 'ItemSound.' + name
        assert key not in sounds, 'ambiguous original Sound basename'
        raw = package.data[export.serial_offset:export.serial_offset + export.serial_size]
        assert raw.find(b'RIFF') == 9
        info = wave_info(raw[9:])
        assert (info['encoding'], info['channels'], info['sampleRate'], info['bitsPerSample']) == (1, 2, 22050, 16)
        sounds[key] = {'sourceReference': original_path(package, export, 'ItemSound'),
            'sourceExport': export.index, 'sourceExportSHA256': digest(raw),
            'waveOffsetInExport': 9, **info}
        waves[key] = raw[9:]
    assert len(sounds) == len(QUEST_SOUNDS)
    return sounds, waves


def verify():
    engine_path = ROOT / 'assets/interlude/system/engine.dll'
    e = Image(engine_path, ENGINE_SHA, True)
    raw_engine = engine_path.read_bytes()
    ep = PE(engine_path)
    a = Image(ROOT / 'assets/interlude/system/ALAudio.dll', ALAUDIO_SHA)
    ap = PE(ROOT / 'assets/interlude/system/ALAudio.dll')
    core = PE(ROOT / 'assets/interlude/system/Core.dll')
    assert digest(core.d) == CORE_SHA
    multiplier_symbol = '?GAudioMaxRadiusMultiplier@@3MA'
    assert core.float_at_rva(core.exports()[multiplier_symbol]) == 50
    assert ap.imports()[multiplier_symbol] == ('Core.dll', 0x1004e7b4)
    count = 0

    def pin(image, va, op, args):
        nonlocal count
        image.instruction(va, op, args)
        count += 1

    # The data slot and missing call survive independent recovery from the
    # supplied raw words. Our shared decoder did not delete a call or a value.
    raw_sites = []
    for va, expected in [(RADIUS_SLOT, b'\0' * 4), (0x1056b250, b'\x90' * 6)]:
        offset = e.offset(va)
        restored = recovered_span(raw_engine, offset, len(expected), 0x7965b551)
        assert restored == expected == e.data[offset:offset + len(expected)]
        raw_sites.append({'VA': hex(va), 'bytes': len(expected), 'recoveredSHA256': digest(restored)})
    ordinary_imports = ep.imports()
    assert {name: dll for name, (dll, _) in ordinary_imports.items()} == {
        'CreateFileA': 'KERNEL32.dll', 'ExitProcess': 'KERNEL32.dll', 'InitCommonControls': 'COMCTL32.dll'}
    # This image's literal references are all in its RVA==file-offset section.
    references = absolute_load_references(e.data, e.base, RADIUS_SLOT)
    assert len(references) == 29
    for row in references:
        assert e.offset(row['VA']) == row['VA'] - e.base
        pin(e, row['VA'], 'mov', f"{row['register']}, dword ptr [{hex(RADIUS_SLOT)}]")
    assert e.exported('?execClientHearSound@APlayerController@@QAEXAAUFFrame@@QAX@Z', True) == 0x106a0ff0

    pin(e, 0x10837b0b, 'mov', 'dword ptr [0x10a60d70], 0x10307923')
    pin(e, 0x10307923, 'jmp', '0x104108e0')
    pos = e.offset(0x10885000)
    assert e.data[pos:pos + 9] == b'dSdddddd\0'
    game = e.exported('??_7UGameEngine@@6BUObject@@@')
    assert e.u32(game + 0x648) == e.exported('?OnPlaySound@UGameEngine@@UAEXAAVL2ParamStack@@@Z')
    assert e.exported('?OnPlaySound@UGameEngine@@UAEXAAVL2ParamStack@@@Z', True) == 0x1049dec0
    assert e.exported('?PrivateStaticClass@USound@@0VUClass@@A') == 0x10c41ce8
    assert e.exported('?ReadWaveInfo@FWaveModInfo@@QAEHAAV?$TArray@E@@@Z', True) == 0x10533e10
    assert e.exported('??0FCameraSceneNode@@QAE@PAVUViewport@@PAVFRenderTarget@@PAVAActor@@VFVector@@VFRotator@@M@Z', True) == 0x10655680
    assert e.exported('??0FPlayerSceneNode@@QAE@PAVUViewport@@PAVFRenderTarget@@PAVAActor@@VFVector@@VFRotator@@M@Z') == 0x1030f533
    pawn = e.exported('??_7APawn@@6B@')
    ambient = e.exported('?IsAAmbientSound@AActor@@UAEHXZ')
    assert e.u32(pawn + 0x2f8) == ambient
    assert e.exported('?IsAAmbientSound@AActor@@UAEHXZ', True) == 0x10328410
    assert e.exported('?PrivateStaticClass@AController@@0VUClass@@A') == 0x10c2a418
    # Reverse varargs decode then parameter-stack insertion preserves all eight
    # fields. In the named handler only the first two and final value survive;
    # object flag/id/location values are consumed without being stored.
    engine = [
        (0x1041093a, 'push', '0x10885000'),
        (0x10410960, 'mov', 'edx, dword ptr [esp + 0x24]'),
        (0x10410971, 'lea', 'eax, [esp + 0x30]'),
        (0x1041097c, 'mov', 'ecx, dword ptr [esp + 0x28]'),
        (0x10410987, 'mov', 'edx, dword ptr [esp + 0x1c]'),
        (0x10410992, 'mov', 'eax, dword ptr [esp + 0x2c]'),
        (0x1041099d, 'mov', 'ecx, dword ptr [esp + 0x14]'),
        (0x104109a8, 'mov', 'edx, dword ptr [esp + 0x18]'),
        (0x104109b3, 'mov', 'eax, dword ptr [esp + 0x20]'),
        (0x104109c9, 'mov', 'edx, dword ptr [edx + 0x648]'),
        (0x104109d4, 'call', 'edx'),
        (0x1049ded9, 'mov', 'ebp, eax'), (0x1049dedf, 'mov', 'ebx, eax'),
        (0x1049def7, 'mov', 'edx, eax'), (0x1049defe, 'je', '0x1049dfd4'),
        (0x1049df07, 'je', '0x1049df74'), (0x1049df0c, 'jne', '0x1049e0a7'),
        (0x1049df55, 'mov', 'edx, dword ptr [esi + 0x374]'),
        (0x1049dfb7, 'mov', 'edx, dword ptr [esi + 0x370]'),
        (0x1049dfd4, 'test', 'ebx, ebx'), (0x1049dfe1, 'push', '0x10c41ce8'),
        (0x1049e02f, 'cmp', 'dword ptr [edx + 0x58], 0'),
        (0x1049e035, 'mov', 'ecx, dword ptr [edx + 0x54]'),
        (0x1049e038, 'mov', 'ecx, dword ptr [ecx + 0x38]'),
        (0x1049e040, 'mov', 'ecx, dword ptr [ecx]'),
        (0x1049e042, 'mov', 'ecx, dword ptr [ecx + 0x3c]'),
        (0x1049e049, 'mov', 'esi, dword ptr [ecx + 0x3bc]'),
        (0x1049e053, 'fldz', ''), (0x1049e058, 'mov', 'edx, dword ptr [0x11d8dc10]'),
        (0x1049e05e, 'mov', 'ebx, dword ptr [esi + 0x1bc]'),
        (0x1049e070, 'push', '0'), (0x1049e072, 'fld1', ''),
        (0x1049e077, 'fst', 'dword ptr [esp + 0x14]'),
        (0x1049e07b, 'fld', 'dword ptr [edx]'),
        (0x1049e07d, 'fstp', 'dword ptr [esp + 0x10]'),
        (0x1049e083, 'fstp', 'dword ptr [esp + 0xc]'),
        (0x1049e089, 'mov', 'ebx, dword ptr [esi + 0x1c0]'),
        (0x1049e090, 'mov', 'eax, dword ptr [edi + 0x80]'),
        (0x1049e099, 'mov', 'ebx, dword ptr [esi + 0x1c4]'),
        (0x1049e09f, 'push', '0'), (0x1049e0a1, 'push', 'esi'),
        (0x1049e0a5, 'call', 'eax'),
        # ReadWaveInfo binds field +c to fmt.bits, +10 to fmt.channels.
        (0x10533ee3, 'add', 'eax, 0xe'), (0x10533ee9, 'mov', 'dword ptr [ecx + 0xc], eax'),
        (0x10533f12, 'add', 'edx, 2'), (0x10533f18, 'mov', 'dword ptr [eax + 0x10], edx'),
        (0x10328410, 'xor', 'eax, eax'), (0x10328412, 'ret', ''),
        # Bounded final caller lead: Draw constructs the player node at this
        # stack address and later passes the same address to Audio.Update.
        # The camera-node controller/pawn branch stores a separate audio
        # position. This does not yet certify every intervening render path.
        (0x1058f1d1, 'lea', 'ecx, [ebp - 0x424]'),
        (0x1058f1d7, 'call', '0x1030f533'),
        # Ordinary draw re-creates this node immediately before Update; the
        # earlier constructor above belongs to the viewport-reset branch.
        (0x1058ee79, 'mov', 'edi, ecx'),
        (0x1058eeba, 'mov', 'ebx, dword ptr [ebp + 0x70]'),
        (0x1058eebd, 'mov', 'ecx, dword ptr [ebx + 0x3c]'),
        (0x1058eec0, 'mov', 'esi, ecx'),
        (0x1058eec2, 'mov', 'dword ptr [ebp + 0x2c], esi'),
        (0x1058fe24, 'mov', 'esi, dword ptr [ebp + 0x2c]'),
        (0x1058feef, 'push', 'esi'),
        (0x1058fef8, 'lea', 'ecx, [ebp - 0x424]'),
        (0x1058fefe, 'call', '0x1030f533'),
        (0x10655938, 'call', '0x10308fe4'),
        (0x1058ff7c, 'mov', 'ecx, dword ptr [edi + 0x58]'),
        (0x1058ff81, 'lea', 'eax, [ebp - 0x424]'),
        (0x1058ff87, 'push', 'eax'),
        (0x1058ff88, 'mov', 'edx, dword ptr [edx + 0x74]'),
        (0x1058ff8b, 'call', 'edx'),
        (0x1058ffce, 'lea', 'ecx, [ebp - 0x424]'),
        (0x1058ffd4, 'call', '0x103122f6'),
        (0x10655702, 'mov', 'dword ptr [esi + 0x194], edi'),
        (0x10655708, 'mov', 'dword ptr [esi + 0x198], ebx'),
        (0x10655711, 'mov', 'dword ptr [esi + 0x19c], eax'),
        (0x1065571b, 'call', '0x10312445'),
        (0x10655723, 'test', 'eax, eax'),
        (0x10655725, 'je', '0x10655757'),
        (0x10655727, 'cmp', 'dword ptr [eax + 0x3bc], 0'),
        (0x1065572e, 'je', '0x10655757'),
        (0x10655730, 'mov', 'eax, dword ptr [eax + 0x3bc]'),
        (0x10655736, 'add', 'eax, 0x1bc'),
        (0x1065573d, 'mov', 'dword ptr [esi + 0x1bc], edx'),
        (0x10655746, 'mov', 'dword ptr [esi + 0x1c0], ecx'),
        (0x1065574f, 'mov', 'dword ptr [esi + 0x1c4], edx'),
        (0x1056b249, 'push', '0x10c2a418'),
        (0x1056b256, 'test', 'eax, eax'),
        (0x1056b258, 'je', '0x1056b25e'),
        (0x1056b25a, 'mov', 'eax, esi'),
        # A named ordinary sound entry substitutes the same unresolved value
        # for a zero radius. This closes its role, not its provider or value.
        (0x106a11af, 'fldz', ''),
        (0x106a11b3, 'fld', 'dword ptr [ebp - 0x20]'),
        (0x106a11b6, 'fucom', 'st(1)'),
        (0x106a11bc, 'test', 'ah, 0x44'),
        (0x106a11bf, 'jp', '0x106a11cb'),
        (0x106a11c9, 'fld', 'dword ptr [ecx]'),
        (0x106a11cb, 'fstp', 'dword ptr [ebp - 0x20]'),
        (0x106a11f1, 'fld', 'dword ptr [ebp - 0x20]'),
        (0x106a11f4, 'fstp', 'dword ptr [esp + 0x10]'),
        (0x106a121b, 'mov', 'edx, dword ptr [edx + 0x80]'),
        (0x106a1221, 'call', 'edx'),
    ]
    # No value from the five ignored packet fields reaches a register/store.
    ignored = list(e.dis.disasm(e.data[e.offset(0x1049dee1):e.offset(0x1049def3)], 0x1049dee1))
    assert [(i.mnemonic, i.op_str) for i in ignored] == [('call', 'edi'), ('mov', 'ecx, esi')] * 4 + [('call', 'edi')]
    for va, op, args in engine:
        pin(e, va, op, args)
    driver_symbol = '?PlaySoundW@UALAudioSubsystem@@UAEHPAVAActor@@HPAVUSound@@VFVector@@MMMHMM@Z'
    avt = a.exported('??_7UALAudioSubsystem@@6BUObject@@@')
    assert a.u32(avt + 0x80) == a.exported(driver_symbol)
    assert a.exported(driver_symbol, True) == 0x1000a6f0
    assert a.u32(avt + 0x74) == a.exported('?Update@UALAudioSubsystem@@UAEXPAVFSceneNode@@@Z')
    assert a.u32(avt + 0x100) == a.exported('?GetViewport@UALAudioSubsystem@@UAEPAVUViewport@@XZ')
    assert ap.imports()['?ReadWaveInfo@FWaveModInfo@@QAEHAAV?$TArray@E@@@Z'] == ('Engine.dll', 0x1004e914)
    assert ap.imports()['?appFailAssert@@YAXPBD0H@Z'] == ('Core.dll', 0x1004e5fc)
    assert bytes(a.data[a.offset(0x1003e988):a.offset(0x1003e988) + 7]) == b'Radius\0'
    assert a.wide(0x1003de04) == 'UseEAX'
    assert bytes(a.data[a.offset(0x1003e6a8):a.offset(0x1003e6a8) + 7]) == b'EAXSet\0'
    assert e.u32(0x11d8dc10) == 0
    assert bytes(e.data[e.offset(0x1056b250):e.offset(0x1056b256)]) == b'\x90' * 6
    driver = [
        (0x1000a72f, 'fldz', ''),
        (0x1000a731, 'fcomp', 'dword ptr [ebp + 0x24]'),
        (0x1000a736, 'test', 'ah, 0x44'), (0x1000a739, 'jp', '0x1000a753'),
        (0x1000a745, 'push', '0x1003e988'),
        (0x1000a74a, 'call', 'dword ptr [0x1004e5fc]'),
        (0x10009378, 'lea', 'ecx, [ebp - 0x64]'),
        (0x1000937b, 'call', 'dword ptr [0x1004e914]'),
        (0x10009381, 'mov', 'ecx, dword ptr [ebp - 0x58]'),
        (0x10009384, 'cmp', 'word ptr [ecx], 8'),
        (0x10009388, 'jne', '0x100093a2'),
        (0x100093a4, 'mov', 'edx, dword ptr [ebp - 0x54]'),
        (0x100093a7, 'cmp', 'word ptr [edx], 1'),
        (0x100093ab, 'setne', 'cl'), (0x100093ae, 'lea', 'ecx, [ecx + ecx + 0x1101]'),
        (0x100093e3, 'mov', 'edx, dword ptr [ebp - 0x14]'),
        (0x100093e6, 'push', 'edx'), (0x100093eb, 'call', 'dword ptr [0x1004c698]'),
        (0x10009465, 'mov', 'dword ptr [esi + 4], 0'),
        # Source gain is multiplied by the ordinary sound-volume field.
        (0x1000a80d, 'fld', 'dword ptr [esi + 0xc4]'),
        (0x1000a813, 'fmul', 'dword ptr [ebp + 0x20]'),
        (0x1000ab0e, 'mov', 'edx, dword ptr [ebp + 8]'),
        (0x1000ab11, 'mov', 'dword ptr [ecx + edi + 8], edx'),
        (0x1000ab1b, 'mov', 'dword ptr [eax + edi + 0xc], 0'),
        (0x1000abe2, 'fstp', 'dword ptr [edx + edi + 0x38]'),
        (0x1000ac37, 'or', 'eax, ecx'),
        (0x1000ac3f, 'mov', 'dword ptr [ecx + edi + 0x4c], eax'),
        (0x1000ac6a, 'mov', 'eax, dword ptr [edx + 0x2f8]'),
        (0x1000ac76, 'je', '0x1000ad41'),
        (0x10004ea8, 'mov', 'eax, dword ptr [ecx + 0x38]'),
        (0x1000ad94, 'mov', 'eax, dword ptr [edx + 0x100]'),
        (0x1000ad9c, 'mov', 'ecx, dword ptr [eax + 0x3c]'),
        (0x1000ad9f, 'mov', 'eax, dword ptr [ecx + 0x3bc]'),
        (0x1000ada5, 'add', 'eax, 0x1bc'),
        (0x1000adf3, 'fsub', 'dword ptr [ebp + 0x2c]'),
        (0x1000adf6, 'fmul', 'dword ptr [ebp + 0x20]'),
        (0x1000adfe, 'fdivp', 'st(1)'),
        # During Update, the owner location is refreshed, but the gain target
        # comes from the supplied FSceneNode. Its identity is NOT assumed.
        (0x1000cfb2, 'mov', 'edi, dword ptr [ebp + 0x7c]'),
        (0x1000cfb5, 'mov', 'eax, dword ptr [edi + 0x1bc]'),
        (0x1000cfbb, 'mov', 'dword ptr [ebp + 0x50], eax'),
        (0x1000de78, 'test', 'byte ptr [ecx + 0x4c], 0x40'),
        (0x1000de82, 'mov', 'eax, dword ptr [ecx + 8]'),
        (0x1000de85, 'add', 'eax, 0x1bc'), (0x1000de8a, 'add', 'ecx, 0x10'),
        (0x1000de8f, 'mov', 'dword ptr [ecx], edx'),
        (0x1000de94, 'mov', 'dword ptr [ecx + 4], edx'),
        (0x1000de9a, 'mov', 'dword ptr [ecx + 8], eax'),
        (0x1000e1fd, 'lea', 'edx, [ebp + 0x50]'),
        (0x1000e14e, 'test', 'al, 0x10'),
        (0x1000e156, 'test', 'al, 0x40'),
        (0x1000e16b, 'mov', 'eax, dword ptr [edx + 0x2f8]'),
        (0x1000e175, 'je', '0x1000e1d7'),
        (0x1000e205, 'call', '0x10001348'),
        (0x1000e223, 'fsub', 'dword ptr [ebp + 0x68]'),
        (0x1000e226, 'fmul', 'dword ptr [ebp + 0x6c]'),
        (0x1000e22e, 'fdivp', 'st(1)'),
        (0x1000e248, 'call', '0x10001357'),
        (0x1000e253, 'push', '0x100a'),
        (0x1000e25c, 'jmp', '0x1000e46c'),
        (0x1000e46c, 'call', 'dword ptr [0x1004c714]'),
        # EAX is optional, but is not bypassed merely because PCM is stereo.
        (0x10004615, 'push', '0xe4'),
        (0x1000caef, 'mov', 'dword ptr [0x1004c708], ebx'),
        (0x1000cb0c, 'cmp', 'dword ptr [esi + 0xe4], ebx'),
        (0x1000cb12, 'je', '0x1000cb82'),
        (0x1000cb18, 'push', '0x1003e6a8'),
        (0x1000cb23, 'mov', 'dword ptr [0x1004c708], eax'),
        (0x1000aad3, 'call', '0x100010ff'),
        (0x1000aae1, 'fstp', 'dword ptr [edx + edi + 0x28]'),
        (0x1000ae2f, 'cmp', 'dword ptr [0x1004c708], 0'),
        (0x1000ae36, 'jne', '0x1000ae54'),
        (0x1000ae71, 'fld', 'dword ptr [ecx + edi + 0x28]'),
        (0x1000ae75, 'fdiv', 'dword ptr [ebp + 0x24]'),
        (0x1000aeb6, 'call', 'dword ptr [0x1004c708]'),
        (0x1000e51e, 'cmp', 'dword ptr [0x1004c708], 0'),
        (0x1000e568, 'fdiv', 'dword ptr [edi + 0x20]'),
        # An ordinary live SFX-volume change also updates existing voices.
        (0x10006dd8, 'fstp', 'dword ptr [esi + 0xc4]'),
        (0x10006e0b, 'fdiv', 'dword ptr [ebp - 0x14]'),
        (0x10006e0e, 'fmul', 'dword ptr [esi + 0xc4]'),
        (0x10006e14, 'fstp', 'dword ptr [ecx + 0x38]'),
    ]
    for va, op, args in driver:
        pin(a, va, op, args)
    sounds, _ = collect_quest_waves()
    return {'tool': 'Elbera Tools', 'status': 'verified-static-original',
        'engineSHA256': ENGINE_SHA, 'audioDriverSHA256': ALAUDIO_SHA, 'coreSHA256': CORE_SHA,
        'soundBankSHA256': ITEMSOUND_SHA, 'instructionChecks': count,
        'packet': {'opcode': '0x98', 'format': 'dSdddddd', 'handlerVA': '0x1049dec0'},
        'mode0': {'owner': 'current viewport controller pawn', 'location': 'owner.Location',
            'gain': 1, 'pitch': 1, 'slot': 0, 'flags': 0,
            'ignoredWireFields': ['objectFlag', 'objectId', 'x', 'y', 'z', 'delay'],
            'radius': {'status': 'unresolved-pointer-slot', 'slotVA': hex(RADIUS_SLOT)}},
        'bindingBoundary': {'status': 'unresolved', 'independentRawRoundTrips': raw_sites,
            'radiusSlotInitialPointer': e.u32(RADIUS_SLOT),
            'radiusLiteralLoadCount': len(references),
            'radiusLiteralLoadVAs': [hex(row['VA']) for row in references],
            'ordinaryImportDLLs': sorted({dll for dll, _ in ordinary_imports.values()}),
            'defaultRole': 'also selected by execClientHearSound when its radius is zero',
            'limits': ['Literal-reference inventory does not exclude indirect/computed writes or later runtime repair.',
                'A named radius default role does not bind this Engine slot to Core.GAudioDefaultRadius.',
                'The raw bytes do not identify who produced the missing-call bytes or whether/how runtime changes them.']},
        'ordinaryGain': {'status': 'conditional-reduction-only',
            'formula': 'clamp(volume * (R*50 - distance) / (R*50), 0, 1)',
            'radiusAssertion': 'nonzero; also admits negative and unordered values',
            'samePawnFiniteRadiusWitness': str(dry_gain_witness(1, Fraction(1, 4), 0)),
            'conditions': ['finite nonzero radius', 'same valid pawn at source and scene-node snapshots',
                'ordinary nonambient flags-zero PCM voice', 'EAX disabled/unavailable'],
            'unclosed': ['Engine radius import binding/value', 'camera-node type-query import target',
                'complete callback/indirect-write closure between node construction and audio update']},
        'questSounds': sounds,
        'limits': ['Static source path only; no original client executed.',
            'Music/voice modes retained on wire but not implemented by this proof.',
            'Ordinary Draw constructs the player node immediately before Audio.Update, ahead of scene Render. Its pawn branch uses Pawn.Location; the protected controller type query is still unbound.',
            'Finite nonzero radius cancels from the dry zero-distance gain formula. The native assertion does not prove finiteness and EAX has a separate radius-dependent path.',
            'Occlusion/reverb, user-volume controls and radius binding remain separate.',
            'Current general audio exporter downmixes these originals to mono; that output is not stereo parity.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='verify pinned supplied original evidence')
    parser.parse_args()
    print(json.dumps(verify(), indent=2))
