#!/usr/bin/env python3
"""Elbera Tools: export a bounded original driver profile for browser audio.

Reads pinned supplied client configuration and ALAudio.dll. Only selected audio
fields are emitted; saved Option.ini and unrelated configuration are excluded.
The supplied configuration is not asserted to be untouched retail defaults.
New-user option fallbacks are recovered from the original Init instructions.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
FORMAT = 'l2-interlude-native-audio-profile-v1'
CONFIGS = {
    'ALAudio.int': '25f4e583409d798cd10cdca79eb8620395ca383a50cdecedd2ab3d501eba803c',
    'l2.ini': '377ff9e4a08d3657781d218e192dcdf1fba34348812e213d8613d6c609cf177c',
}


def selected_config(text, section, keys):
    """Admit unambiguous literal entries only; no general INI emulation."""
    current, result = None, {}
    for line in text.splitlines():
        match = re.fullmatch(r'\s*\[([^\]]+)\]\s*', line)
        if match:
            current = match[1]
        if current != section or '=' not in line or line.lstrip().startswith((';', '#')):
            continue
        key, value = (part.strip() for part in line.split('=', 1))
        if key not in keys:
            continue
        if key in result:
            raise ValueError('ambiguous repeated audio entry: ' + key)
        result[key] = value
    if result.keys() != set(keys):
        raise ValueError('missing source audio entries')
    return result


def literal_bool(value):
    if value.casefold() not in ('true', 'false'):
        raise ValueError('unsupported source Boolean literal')
    return value.casefold() == 'true'


def extract_profile():
    sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'tools/ui')]
    from l2lib import decrypt_file_bytes
    from check_tutorial_quest_native import Image
    from check_playsound_native import ALAUDIO_SHA, CORE_SHA
    from supplemental_pe import PEImage
    system = ROOT / 'assets/interlude/system'
    texts, sources = {}, {}
    for name, expected in CONFIGS.items():
        raw = (system / name).read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected:
            raise ValueError('unsupported supplied audio profile: ' + name)
        plain, protocol = decrypt_file_bytes(raw, name)
        texts[name] = plain.decode('utf-16') if plain.startswith(b'\xff\xfe') else plain.decode('cp1252')
        sources[name] = {'SHA256': expected, 'protocol': protocol,
                         'plaintextSHA256': hashlib.sha256(plain).hexdigest()}
    ambient = selected_config(texts['ALAudio.int'], 'AmbientSound', ['UseAmbientSlot', 'AmbientSoundSlot'])
    driver = selected_config(texts['l2.ini'], 'ALAudio.ALAudioSubsystem', ['Channels', 'UseEAX', 'Rolloff'])
    image = Image(system / 'ALAudio.dll', ALAUDIO_SHA)
    pe = PEImage(system / 'ALAudio.dll', ALAUDIO_SHA)
    core = PEImage(system / 'Core.dll', CORE_SHA)
    radius, = struct.unpack('<f', core.read(core.exports['?GAudioDefaultRadius@@3MA'], 4))
    assert image.exported('?Init@UALAudioSubsystem@@UAEHXZ', True) == 0x1000c600
    for va, op, args in [
        (0x100047b3, 'push', '0x1003dee0'), (0x100047f2, 'push', '0xd8'),
        (0x1000c623, 'xor', 'ebx, ebx'), (0x1000c651, 'push', 'edi'),
        (0x1000c644, 'lea', 'edi, [esi + 0xc4]'),
        (0x1000c652, 'push', '0x1003e13c'), (0x1000c657, 'push', '0x1003e154'),
        (0x1000c663, 'jne', '0x1000c66d'), (0x1000c665, 'fld', 'dword ptr [0x100409bc]'),
        (0x1000c66b, 'fstp', 'dword ptr [edi]'),
        (0x1000c70b, 'push', '0x1004c770'), (0x1000c737, 'push', '0x1004c774'),
        (0x1000c9ed, 'mov', 'eax, dword ptr [esi + 0xd8]'),
        (0x1000c9f3, 'cmp', 'eax, 0x20'), (0x1000c9f6, 'jle', '0x1000c9fd'),
        (0x1000c9f8, 'mov', 'eax, 0x20'), (0x1000ca20, 'jne', '0x1000ca5d'),
        (0x1000ca05, 'push', '1'), (0x1000ca07, 'call', 'dword ptr [0x1004c748]'),
        (0x1000ca24, 'push', '0x5c'), (0x1000ca28, 'call', 'dword ptr [0x1004e76c]'),
        (0x1000ca38, 'mov', 'dword ptr [ecx + edx + 4], eax'),
        (0x1000ca3d, 'fld', 'dword ptr [esi + 0xcc]'),
        (0x1000ca46, 'push', '0x1021'), (0x1000ca4f, 'call', 'dword ptr [0x1004c714]'),
    ]:
        image.instruction(va, op, args)
    for va, text in [(0x1003dee0, 'Channels'), (0x1003e124, 'Option.ini'),
                     (0x1003e13c, 'SoundVolume'), (0x1003e154, 'Audio'),
                     (0x1003e23c, 'UseAmbientSlot'), (0x1003e290, 'AmbientSoundSlot')]:
        assert image.wide(va) == text
    assert pe.imports[0x1004e76c][1] == '?AddZeroed@FArray@@QAEHHH@Z'
    # Same original named-export loader already checked by the StopSound tool.
    # These are requested API identities, not execution of a loaded driver.
    for name, string, push, slot, call in [
        ('alGenSources', 0x1003f194, 0x10005d6b, 0x1004c748, 0x10005d77),
        ('alSourcef', 0x1003f1dc, 0x10005ddb, 0x1004c714, 0x10005de7),
        ('alSourcePlay', 0x1003f298, 0x10005ef3, 0x1004c70c, 0x10005eff),
        ('alGetSourcei', 0x1003f20c, 0x10005e2f, 0x1004c68c, 0x10005e3b),
    ]:
        assert pe.read(string, len(name) + 1) == name.encode() + b'\0'
        image.instruction(push, 'push', hex(string))
        image.instruction(push + 5, 'push', hex(slot))
        image.instruction(call, 'call', '0x10001177')
    image.instruction(0x10001177, 'jmp', '0x10005930')
    assert pe.read(0x1004ce10, 4) == b'\0' * 4
    volume, = struct.unpack('<f', pe.read(0x100409bc, 4))
    return {'format': FORMAT, 'sources': {**sources, 'ALAudio.dll': {'SHA256': ALAUDIO_SHA},
                                        'Core.dll': {'SHA256': CORE_SHA}},
            'profileKind': 'supplied-driver-config-with-absent-user-options',
            'channels': int(driver['Channels']), 'channelLimit': 32,
            'partitionFlag': int(literal_bool(ambient['UseAmbientSlot'])),
            'splitCount': int(ambient['AmbientSoundSlot']),
            'useEAX': literal_bool(driver['UseEAX']), 'rolloff': float(driver['Rolloff']),
            'soundVolume': volume, 'initialCounter': 0, 'defaultRadius': radius,
            'limits': ['Supplied local configuration; not authenticated retail defaults.',
                       'New browser profile has no saved Option.ini; SoundVolume uses the original missing-option branch.',
                       'Pool allocation and driver callbacks still require a browser platform adapter.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/audio/native-profile.json')
    args = parser.parse_args()
    encoded = (json.dumps(extract_profile(), sort_keys=True, separators=(',', ':')) + '\n').encode()
    if args.check:
        if args.output.read_bytes() != encoded:
            raise ValueError('source audio profile differs from export')
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(encoded)
    print('CHECK PASS' if args.check else 'EXPORTED: selected original audio profile')


if __name__ == '__main__':
    main()
