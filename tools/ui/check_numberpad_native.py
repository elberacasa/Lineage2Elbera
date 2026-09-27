#!/usr/bin/env python3
"""Elbera Tools: original NumberPad input and English magnitude evidence.

Reads pinned originals in memory, never runs native binaries. The bounded
instruction interpreter covers the English magnitude emission loop; imported
string primitives have explicit synthetic contracts, verified by import name.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
NWINDOW_SHA = 'af6c3437f3ccf1b26af8b066e0bbd791c7909c94bd3c7d9e3c68c5edcfe059a7'

CORE_SHA = '9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf'
INTERFACE_SHA = '5da491d8234863a94bfa1959bcb0be2cd5cdf81110003785436eecc04c86decd'
NWINDOW_U_SHA = '6f3171147d83e447f2427e249c2ad73428e2b385d1557b86c53effa1062ea791'
SYSSTRING_SHA = '33053b17ca8e1d157aec8fb40b4ef8542626338858ce6c7b4d799c7609554135'


def group_digits(value):
    """10062ee0 inserts literal commas from right to left, without parsing."""
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]*', value):
        raise ValueError('bounded digit domain only')
    return ','.join([value[:len(value) % 3]] * bool(len(value) % 3)
                    + [value[i:i+3] for i in range(len(value) % 3, len(value), 3)])


def number_color(value):
    """1005a050 counts characters other than commas, including leading zeroes."""
    if not isinstance(value, str) or not re.fullmatch(r'[0-9,]*', value):
        raise ValueError('bounded displayed-digit domain only')
    count = len(value.replace(',', ''))
    return '#DCDCDC' if count < 5 else ['#FF80FF', '#FFFF00', '#00FF00', '#00FFFF'][(count-2) % 4]


def reading_english(value, labels):
    """Independent bounded model of English GLanguageType=1, no Adena suffix.

    Literal label whitespace and native trailing spaces are significant.
    The >12-character branch groups the original input before digit validation.
    Public callers here accept only digits: native invalid/long strings and
    fixed stack-buffer overflow are deliberately outside this evaluator.
    """
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]*', value):
        raise ValueError('bounded digit domain only')
    if len(value) > 12:
        return group_digits(value)
    value = value.lstrip('0')
    if not value:
        return ''
    pieces = []
    for i in range((len(value)-1)//3, -1, -1):
        end = len(value) - i * 3
        digits = value[max(0, end-3):end].lstrip('0')
        if not digits:
            continue
        if i <= len(labels):
            digits += ' ' + (labels[i-1] if i else '')
        pieces.append(digits)
    return ','.join(pieces)


def import_names(image):
    """Resolve named IAT slots from this ordinary PE's original descriptors."""
    raw = image.data
    pe = struct.unpack_from('<I', raw, 60)[0]
    pointer = image.offset(image.base + struct.unpack_from('<I', raw, pe + 128)[0])
    result = {}
    while any(raw[pointer:pointer+20]):
        original, _, _, name, first = struct.unpack_from('<5I', raw, pointer)
        dll_at = image.offset(image.base + name)
        dll = raw[dll_at:raw.index(0, dll_at)].decode('ascii')
        table = image.offset(image.base + (original or first))
        index = 0
        while (value := struct.unpack_from('<I', raw, table + index*4)[0]):
            if not value & 0x80000000:
                name_at = image.offset(image.base + value) + 2
                result[image.base + first + index*4] = (dll, raw[name_at:raw.index(0, name_at)].decode('ascii'))
            index += 1
        pointer += 20
    return result


def instruction_number_color(image, digit_count):
    """Evaluate the original finite count-to-color branch, not a color table oracle."""
    if not isinstance(digit_count, int) or not 0 <= digit_count <= 100:
        raise ValueError('bounded digit count required')
    registers = {'eax': digit_count, 'edi': 0xffdcdcdc}
    pc, compared = 0x1005a0b9, (0, 0)
    for _ in range(30):
        if pc == 0x1005a0f6:
            return '#%06X' % (registers['edi'] & 0xffffff)
        ins = next(image.dis.disasm(image.data[image.offset(pc):image.offset(pc)+16], pc))
        pc += ins.size
        args = ins.op_str.split(', ')
        if ins.mnemonic == 'cmp': compared = registers[args[0]], int(args[1], 0)
        elif ins.mnemonic in ('add', 'and'):
            r, v = args[0], int(args[1], 0)
            registers[r] = registers[r]+v if ins.mnemonic == 'add' else registers[r] & v
            compared = registers[r], 0
        elif ins.mnemonic == 'mov':
            if args[0] == 'edi': registers['edi'] = int(args[1], 0)
            else: assert ins.address == 0x1005a0f3  # redundant saved local
        elif ins.mnemonic.startswith('j'):
            a, b = compared
            take = {'jmp': True, 'jl': a < b, 'jns': a >= 0, 'ja': a > b}[ins.mnemonic]
            if take:
                pc = image.u32(0x1005a13c+registers['eax']*4) if '[' in args[0] else int(args[0], 0)
        else: raise AssertionError((hex(ins.address), ins.mnemonic))
    raise AssertionError('number color branch did not terminate')


def instruction_reading_loop(image, value, labels):
    """Interpret the surviving 10067d3d..10067e76 integer emission loop.

    Inputs are the already validated, leading-zero-stripped source digits and
    exact ParseIntoArray labels. appItoa/appStrcat/FString dereference are
    modeled explicitly; this is not execution of imports or a native client.
    """
    if not re.fullmatch(r'[1-9][0-9]{0,11}', value):
        raise ValueError('native loop requires nonzero normalized digits <=12')
    frame, source, output, array = 0x20000, 0x30000, 0x40000, 0x50000
    registers = dict(eax=0, ebx=output, ecx=0, edx=0, esi=0, edi=len(value), ebp=frame, esp=0x90000)
    memory = {frame-0x20: 1, frame-0x24: 3, frame-0x2c: len(value),
              frame-0x14: len(value) % 3, frame-0x1c: (len(value)-1)//3,
              frame-0x3c: len(labels), frame-0x40: array, frame-0x4c: source,
              frame-0x48: 0, frame-0x44: 0, 0x1022c4b8: 0x1022c4b8}
    memory.update({source+i*2: ord(c) for i, c in enumerate(value)})
    strings = {output: '', frame-0x30: ',', 0x1023d5d0: ' '}
    strings.update({array+i*12: label for i, label in enumerate(labels)})
    cmp = (0, 0)

    def address(op):
        expression = op[op.index('[')+1:op.index(']')]
        total = 0
        for sign, term in re.findall(r'([+-]?)\s*([^+-]+)', expression):
            parts = term.strip().split('*')
            v = registers[parts[0]] if parts[0] in registers else int(parts[0], 0)
            if len(parts) == 2: v *= int(parts[1], 0)
            total += -v if sign == '-' else v
        return total

    def read(op):
        if '[' in op: return memory[address(op)]
        return registers[op] if op in registers else int(op, 0)

    def write(op, value):
        if '[' in op: memory[address(op)] = value
        else: registers[op] = value

    pc, visited = 0x10067d3d, set()
    for _ in range(3000):
        if pc == 0x10067c88: return strings[output], visited
        if not 0x10067d3d <= pc < 0x10067e7b: raise AssertionError(hex(pc))
        ins = next(image.dis.disasm(image.data[image.offset(pc):image.offset(pc)+16], pc))
        visited.add(pc)
        op, args, pc = ins.mnemonic, ins.op_str.split(', '), pc + ins.size
        if op in ('mov', 'movzx', 'lea'):
            write(args[0], address(args[1]) if op == 'lea' else read(args[1]))
        elif op in ('add', 'sub', 'xor'):
            a, b = read(args[0]), read(args[1])
            result = a+b if op == 'add' else a-b if op == 'sub' else a^b
            write(args[0], result); cmp = (result, 0)
        elif op == 'cmp': cmp = tuple(map(read, args))
        elif op == 'test': cmp = (read(args[0]) & read(args[1]), 0)
        elif op.startswith('j'):
            a, b = cmp
            take = {'jmp': True, 'je': a == b, 'jne': a != b, 'jg': a > b,
                    'jge': a >= b, 'jl': a < b, 'jle': a <= b}[op]
            if take: pc = int(args[0], 0)
        elif op == 'push':
            registers['esp'] -= 4; memory[registers['esp']] = read(args[0])
        elif op == 'call':
            target = read(args[0]) if args[0] == 'esi' else int(args[0][args[0].index('[')+1:-1], 0)
            if target == 0x1022c280:  # appItoa(int); caller pops argument.
                strings[0x60000] = str(memory[registers['esp']]); registers['eax'] = 0x60000
            elif target == 0x1022c3e4:  # FString::operator*() const
                assert registers['ecx'] in strings
                registers['eax'] = registers['ecx']
            elif target == 0x1022c4b8:  # appStrcat(destination, source)
                dest, src = memory[registers['esp']], memory[registers['esp']+4]
                strings[dest] += strings[src]; registers['eax'] = dest
            else: raise AssertionError(('unmodeled import', hex(target)))
        else: raise AssertionError((hex(ins.address), op, args))
    raise AssertionError('bounded original loop did not terminate')


RANGES = (
    (0x100dafed, 0x100db024, '78938f9098dfcdadd6001683eb1b1109703bba8064138e7728039b82340a13c6'),
    (0x100db2cc, 0x100db31f, 'b3e11009358bb65a0e4f8bdce0295189a2245f9121e89eb206d179349bb13de4'),
    (0x100131e0, 0x10013238, '33c53d1a3bea95065be5da9db385b6d16f2375c5d4435d9e041adf2de45afb47'),
    (0x10014174, 0x1001421e, 'f4cdbf0483e24fb22a05f1e801988fd75b1cddcd1e3d4e5c69269509534b0d0b'),
    (0x10062f24, 0x10062fc8, '6471d8e9dac4e7761b35c16de63d9ccfc69b4eb76dbe5af8a65f41d9b30134f2'),
    (0x10067736, 0x100677b6, '960d02c944851722fa40410ab12096f46ae73af6ac26e69be020c884d41faba5'),
    (0x100677b6, 0x10067e7b, 'd7b79829f82f2d42a683fe142fec3fb49a40d912b534a5b2ad8b29c78914dea8'),
    (0x10014b94, 0x10014c90, 'c529552d08dbe49ca89f7d8c6cec5d67881d525d69ec85150757c2c7319a497c'),
    (0x10016ed5, 0x10016f6b, 'f1d526b5ba88c56cf5f89470963ee28e57708a502ce8fe93d5f56f46fbfb0090'),
    (0x1005a050, 0x1005a14c, '1199d898a5f6124bd37c41a25bffcf9281ae30ede9f79ad3e2270f973bea3c0a'),
    (0x10015d09, 0x10015d8f, 'c7a7df7a51cc77acc4a94273b68174fd4db2f51f066eca0f76375c68fd677691'),
    (0x100183fc, 0x1001843e, 'e08cdc9fc38b379f8753be4ed8cc5ed7b61328f73702f9c48c4fb5929c0009e9'),
    (0x1001843e, 0x100185cd, 'fe44596d95bea3e1d19cbe663607898803b696379cb57a007e69240076d59c1a'),
    (0x10018614, 0x100186ef, '70ad6d9ad0c5acf550750974d2fc20f3f412a0a2e0171e97f57a5d3d053d985c'),
    (0x10018747, 0x1001879e, 'd3342a24b44cbdef7636e00fb07b5d38fa95708c2073448aa56dbc398f373585'),
)


def verify():
    # Pure reference tests do not import Capstone, read binaries, or need any
    # third-party dependency. Original verification opts into these imports.
    from check_tutorial_quest_native import Image
    sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'tools/uscript'), str(ROOT / 'tools/dat')]
    from l2lib import load_package
    from extract_uscript import sources_from_package
    from extract_gamedata import decrypt, parse_sysstring
    from check_inventory_native import script_function
    w = Image(ROOT / 'assets/interlude/system/NWindow.dll', NWINDOW_SHA)
    c = Image(ROOT / 'assets/interlude/system/Core.dll', CORE_SHA)
    imports = import_names(w)
    expected_imports = {0x1022c250: '?ParseIntoArray@FString@@QAEHPBGPAV?$TArray@VFString@@@@@Z',
        0x1022c280: '?appItoa@@YAPAGH@Z', 0x1022c470: '?GLanguageType@@3HA',
        0x1022c4b8: '?appStrcat@@YAPAGPAGPBG@Z', 0x1022c3e4: '??DFString@@QBEPBGXZ',
        0x1022c468: '?Delete@FString@@QAEXHH@Z'}
    for address, name in expected_imports.items(): assert imports[address] == ('Core.dll', name)
    assert c.exported(expected_imports[0x1022c250], True) == 0x101220a0
    # Named Left/Mid operations preserve leading spaces in comma-separated labels.
    assert c.exported('?Left@FString@@QBE?AV1@H@Z') == 0x10102f95
    assert c.exported('?Mid@FString@@QBE?AV1@HH@Z') == 0x10103b4d
    for a, op, arg in [(0x10122120, 'call', '0x10102f95'),
                       (0x10122134, 'add', 'esi, 1'), (0x1012213f, 'call', '0x10103b4d')]:
        c.instruction(a, op, arg)
    for start, end, digest in RANGES:
        assert hashlib.sha256(w.data[w.offset(start):w.offset(end)]).hexdigest() == digest
    checks = [
        (0x100db30f, 'cmp', 'ecx, 0xffffd8f1'), (0x100db31a, 'call', '0x100131e0'),
        (0x1001a997, 'mov', 'dword ptr [esi + 0x374], edi'),
        (0x1001a855, 'xor', 'edi, edi'),
        (0x1012d7e7, 'call', '0x100131e0'), (0x10013219, 'mov', 'dword ptr [ecx + 0x374], eax'),
        (0x1012d4aa, 'push', '0x1024d694'), (0x1012d4d8, 'push', '3'),
        (0x10014b04, 'mov', 'dword ptr [ecx + 0x334], eax'),
        (0x10014bea, 'cmp', 'word ptr [eax], 0x30'), (0x10014c17, 'cmp', 'word ptr [eax], 0x39'),
        (0x1012d060, 'mov', 'eax, dword ptr [edx + 0x1f8]'),
        (0x100141b7, 'cmp', 'dword ptr [edi + 0x334], 3'),
        (0x100141da, 'cmp', 'word ptr [eax], 0x2c'),
        (0x100141e5, 'call', 'dword ptr [0x1022c468]'),
        (0x10016f5b, 'cmp', 'dword ptr [esi + 0x334], 3'), (0x10016f66, 'call', '0x100145a0'),
        (0x1001462a, 'call', '0x10062ee0'),
        (0x10062f9d, 'mov', 'word ptr [ebx + ecx*2], 0x2c'),
        (0x1010025d, 'push', 'ebx'), (0x1010020d, 'mov', 'byte ptr [ebp - 4], bl'),
        (0x10100208, 'mov', 'ebx, 1'), (0x1010026c, 'call', '0x100676e0'),
        (0x10067763, 'cmp', 'esi, 0xc'), (0x1006776a, 'call', '0x10062ee0'),
        (0x10067871, 'mov', 'edx, dword ptr [0x1022c470]'),
        (0x1006787c, 'cmp', 'eax, 1'), (0x100678c0, 'mov', 'dword ptr [ebp - 0x24], 3'),
        (0x1006797a, 'mov', 'ecx, dword ptr [0x1022c790]'), (0x10067980, 'add', 'ecx, 0x6e4e8'),
        (0x100679f0, 'call', 'dword ptr [0x1022c250]'),
        (0x10067a22, 'cmp', 'word ptr [edi + ecx*2], 0x30'),
        (0x10067d94, 'mov', 'eax, dword ptr [ebp - 0x20]'),
        (0x10067de9, 'push', 'edi'), (0x10067dea, 'call', 'dword ptr [0x1022c280]'),
        (0x10067e28, 'push', '0x1023d5d0'),
        (0x10067caa, 'cmp', 'dword ptr [ebp + 0x114], 0'),
        (0x10018445, 'cmp', 'dword ptr [esi + 0x334], 3'),
        (0x10018475, 'call', '0x1005a050'),
        (0x1005a0a5, 'cmp', 'word ptr [esi + ecx*2], 0x2c'),
        (0x1005a0b7, 'sub', 'eax, edx'), (0x1005a0b9, 'cmp', 'eax, 5'),
        (0x1005a0be, 'add', 'eax, -2'), (0x1005a0d2, 'jmp', 'dword ptr [eax*4 + 0x1005a13c]'),
        (0x10018791, 'push', '2'), (0x10018793, 'push', '2'),
        (0x10018797, 'call', '0x100217a0'),
        (0x100184b0, 'push', '0x11'), (0x100184b2, 'push', '8'),
        (0x100184c4, 'push', '8'), (0x100184cc, 'call', '0x10021970'),
        (0x100184fb, 'fsub', 'qword ptr [0x10231ce0]'), (0x10018509, 'push', '8'),
        (0x100185ba, 'fsub', 'qword ptr [0x10231cd8]'),
        (0x100186bc, 'cmp', 'dword ptr [esi + 0x374], eax'),
        (0x100186ca, 'sub', 'ecx, 0xc'), (0x100186d1, 'setl', 'dl'),
        (0x100186d4, 'mov', 'dword ptr [esi + 0x340], edx'),
        (0x10018fa9, 'cmp', 'dword ptr [esi + 0x334], 3'),
        (0x10018fb2, 'cmp', 'ebx, 0x30'), (0x10018fbb, 'cmp', 'ebx, 0x39'),
        (0x1001900f, 'call', '0x10018040'),
        (0x10016ef9, 'lea', 'edi, [esi + 0x378]'),
        (0x10016f05, 'call', 'dword ptr [0x1022c47c]'),
        (0x1012d6ee, 'push', '0'), (0x1012d6f0, 'push', '8'), (0x1012d6f2, 'push', '0x100'),
    ]
    for address, op, arg in checks: w.instruction(address, op, arg)
    assert w.u32(0x102351dc + 0x1f8) == 0x10014140
    assert w.u32(0x102351dc + 0x18c) == 0x100183b0
    for index, address in enumerate((0x1005a0d9, 0x1005a0e0, 0x1005a0e7, 0x1005a0ee)):
        assert w.u32(0x1005a13c + index*4) == address
        w.instruction(address, 'mov', 'edi, ' + hex((0xffff80ff, 0xffffff00, 0xff00ff00, 0xff00ffff)[index]))
    for address, number in ((0x10231ce0, 16.0), (0x10231cd8, 8.0)):
        assert struct.unpack_from('<d', w.data, w.offset(address))[0] == number
    frame_refs = [w.wide(a) for a in (0x10234dc0, 0x10234d90, 0x10234d60)]
    assert frame_refs == [f'L2UI_CH3.Etc.inputbox{i}' for i in (1, 2, 3)]
    for count in range(31):
        assert instruction_number_color(w, count) == number_color('0' * count)
    assert w.wide(0x1024d694) == 'number' and w.wide(0x10233714) == '0'
    assert w.wide(0x10246d48) == ',' and w.wide(0x1023d5d0) == ' '
    assert w.exported('?execConvertNumToTextNoAdena@UUIScript@@QAEXAAUFFrame@@QAX@Z') == 0x101001b0
    # Native GetLanguage maps configured index1 to script LANG_English=2.
    assert w.u32(0x100fb40c + 4) == 0x100fb379
    w.instruction(0x100fb379, 'mov', 'esi, 2')
    package_path = ROOT / 'assets/interlude/system/Interface.u'
    assert hashlib.sha256(package_path.read_bytes()).hexdigest() == INTERFACE_SHA
    package, _ = load_package(package_path)
    script = dict(sources_from_package(package))['DialogBox']
    action = script_function(script, 'HandleNumberClick')
    for digit in range(10): assert f'case "num{digit}": m_dialogEdit.AddString( "{digit}" ); break;' in action
    for token in ('if( m_paramInt >= 0 ) m_dialogEdit.SetString( string(m_paramInt) );',
                  'm_dialogEdit.SimulateBackspace();', 'm_dialogEdit.SetString( "0" );'):
        assert token in action
    assert 'm_paramInt = 0;' in script_function(script, 'Initialize')
    assert 'm_dialogEditMaxLength = -1;' in script_function(script, 'Initialize')
    assert 'ConvertNumToTextNoAdena(strInput)' in script_function(script, 'OnChangeEditBox')
    ok = script_function(script, 'HandleOK')
    assert 'm_strEditMessage = m_dialogEdit.GetString();' in ok
    assert ok.index('HideWindow') < ok.index('ExecuteEvent( EV_DialogOK )')
    assert not any(token in ok for token in ('m_paramInt', 'Clamp(', 'int('))
    native_scripts = ROOT / 'assets/interlude/system/NWindow.u'
    assert hashlib.sha256(native_scripts.read_bytes()).hexdigest() == NWINDOW_U_SHA
    package, _ = load_package(native_scripts)
    enums = dict(sources_from_package(package))['UIEventManager']
    assert re.search(r'enum\s+ELanguageType\s*{\s*LANG_None,\s*LANG_Korean,\s*LANG_English,', enums)
    dat = ROOT / 'assets/interlude/system/sysstring-e.dat'
    assert hashlib.sha256(dat.read_bytes()).hexdigest() == SYSSTRING_SHA
    with tempfile.TemporaryDirectory(prefix='elbera-numberpad-') as tmp:
        rows = parse_sysstring(decrypt('sysstring-e.dat', tmp))
    strings = {row['id']: row['string'] for row in rows}
    assert len(strings) == len(rows)
    labels = strings[1281].split(',')
    assert len(labels) == 3
    cases, visited = [], set()
    for digits in ['1', '9', '10', '99', '100', '101', '999', '1000', '1001', '1010',
                   '10001', '123456', '1000000', '1000001', '2147483647', '999999999999']:
        result, trace = instruction_reading_loop(w, digits, labels)
        assert result == reading_english(digits, labels), (digits, result, reading_english(digits, labels))
        cases.append({'digits': digits, 'reading': result}); visited.update(trace)
    return {'status': 'verified', 'nwindowSHA256': NWINDOW_SHA, 'coreSHA256': CORE_SHA,
            'interfaceSHA256': INTERFACE_SHA, 'nwindowPackageSHA256': NWINDOW_U_SHA,
            'systemStringsSHA256': SYSSTRING_SHA, 'instructionChecks': len(checks)+4,
            'rangeChecks': len(RANGES), 'originalLoopCases': len(cases),
            'originalColorCases': 31,
            'input': {'editType': 'number', 'nativeEditType': 3, 'maxLength': 0,
                      'maxLengthMeaning': 'no explicit character-count limit; paint width gate still applies', 'initialText': '',
                      'paintWidthGate': {'margin': 12, 'predicate': 'measuredTextWidth < effectiveWidth - margin'},
                      'groupSeparator': ',', 'groupSize': 3, 'returnGrouping': False,
                      'allUsesParamIntWhenNonnegative': True, 'clearText': '0',
                      'quantityValidation': 'caller-owned'},
            'editRender': {'color': '#DCDCDC', 'textInsetX': 2, 'textInsetY': 2,
                           'numberColor': {'minimumDigits': 5, 'indexSubtract': 2,
                                           'colors': ['#FF80FF', '#FFFF00', '#00FF00', '#00FFFF'],
                                           'ignoredCharacter': ','},
                           'frame': dict(zip(('left', 'middle', 'right'), frame_refs),
                                         capWidth=8, sourceHeight=17)},
            'reading': {'status': 'verified-english', 'languageType': 1,
                        'sysStringId': 1281, 'labels': labels, 'groupSize': 3,
                        'maximumMagnitudeDigits': 12, 'zeroText': '',
                        'longInput': 'literal comma grouping', 'preserveLabelWhitespace': True,
                        'preserveTrailingSpace': True, 'cases': cases},
            'limits': ['Only bounded ASCII digit input and English magnitude emission checked.',
                       'Keyboard ASCII-digit filtering and selection removal are traced; pad-click focus/selection lifecycle is separate.',
                       'Full cursor, IME, paste and width-gate font parity are separate.',
                       'Native fixed-size buffers are not reproduced as browser limits.',
                       'Normal edit frame/color/insets are verified; disabled/focus/selection/caret rendering is separate.',
                       'Native button texture state selection is not verified here.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--output')
    args = parser.parse_args()
    result = verify()
    if args.output:
        from pathlib import Path
        Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
    print('NumberPad native: PASS (%d anchors, %d source ranges, %d original-loop cases)' %
          (result['instructionChecks'], result['rangeChecks'], result['originalLoopCases']))
