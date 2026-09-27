#!/usr/bin/env python3
"""Elbera Tools: pinned original SetupGauge state and actor-depth-bar evidence.

Run: python3 tools/ui/check_gauge_native.py --check
Requires the owner's original Engine.dll, D3DDrv.dll, Engine.u,
L2UI_CH3.utx and capstone. Decode is in memory;
no executable is run, no asset is emitted, and no server is contacted. This
does not certify the complete renderer, imported helper identities or UI parity.
"""
import argparse
import hashlib
import json
import math
import re
import struct
import sys

from check_tutorial_quest_native import ENGINE_SHA, Image, ROOT


RANGES = [
    (0x10492690, 0x1049276e, 'a1f61ae25f3f9f71d6df9ab9b254059bdc892d4507991ac54468a41c9e182bee'),
    (0x10358710, 0x103587ca, 'ee4a7ec3146e93d18565e8d31f452966bc67fabbc9644c4ffb0d7e48fc09eab7'),
    (0x105974d0, 0x10597524, 'e06f74536c1722a8d1cc082a551814ac884f7491a40da1389c5e63ea7321c817'),
    (0x1065d73b, 0x1065db2c, '59751fa4d9fc395d42fe091f563579547f645ce1d5347b77871be807c38c8267'),
    (0x1065ab09, 0x1065ab11, 'babbd34c066c9a864ae6aa262c3a0a24f3ec6c411ee7ee0557112ba2d87f1ebf'),
    (0x1065d2b9, 0x1065d2c8, 'c6dc9d08219b4fc51771b836ef768fb01e21b4b0fe314185ef0366afc9544595'),
    (0x1065d39f, 0x1065d3da, '819dd79ec9af0708c3ce1df053878e2596980ccb433f96e632156a6957ef5b5f'),
    (0x10558014, 0x10558288, 'a0463e6823a8addc97f393e53147f5456aaa0d6f7ee69aa238391e4163d79290'),
    (0x105582d3, 0x105582f4, '8548ab8f0c157a6092f52504b772e773017290707d84ac6d0828995cd02cd284'),
    (0x1055846a, 0x10558784, '3862b393bc23ef7d2b69d1402f9283c7a9a766fff7aff7bce1b6a8dd3617786f'),
    (0x105582f4, 0x1055838b, '15fcf51afcf4bab5e31b58b379a31f9c8fed9dad9d23a0b359cfe831bdca3cbd'),
    (0x1065d78b, 0x1065d8a9, '413269e81fada6592204e9f37701f36637c0620ca9041c1dc048ba24d566ef46'),
    (0x1065d926, 0x1065da33, '06c1aa348a6ef55f076eb4c01b41a2af4e616cfbdc3cf9febf16c58fd5734755'),
]


def finite_example(time, maximum, delta, width=96):
    """Finite equations with observed Float32 stores; NOT an x87 emulator.

    Deliberately excludes invalid/zero denominator examples and exceptional
    x87 values. The original methods themselves have no such input guard.
    """
    f32 = lambda x: struct.unpack('<f', struct.pack('<f', x))[0]
    assert isinstance(time, int) and isinstance(maximum, int) and maximum > 0
    assert all(math.isfinite(x) for x in (time, maximum, delta, width))
    total = f32(maximum)
    elapsed = f32(total - time)  # Reset uses FISUB on the original integer.
    elapsed = f32(elapsed + f32(delta))
    return {'active': elapsed < total, 'elapsed': elapsed,
            'length': f32(f32(total - elapsed) * f32(width) / total)}


def verify_draw_arithmetic(image):
    """Run the original bounded draw-argument instructions, not a renderer.

    Projected/transformed point and texture dimensions are explicit synthetic
    inputs. The only intercepted calls are the named bitmap size accessors and
    UCanvas::DrawTile; no erased import or guessed projection is evaluated.
    Float64 intermediates approximate x87; source Float32/Float64 stores remain.
    """
    from check_legacy_skill_effects_native import LinearX87, f32

    class DrawArguments(LinearX87):
        def __init__(self, memory, registers):
            super().__init__(memory, registers)
            self.draws, self.visited, self.flags = [], set(), {}

        def address(self, operand):
            expression = operand[operand.index('[') + 1:operand.index(']')]
            total = 0
            for sign, term in re.findall(r'([+-]?)\s*([^+-]+)', expression):
                term = term.strip()
                value = self.registers[term] if term in self.registers else int(term, 0)
                total += -value if sign == '-' else value
            return total

        def read(self, operand):
            if operand.startswith('st('): return self.stack[int(operand[3:-1])]
            if '[' in operand:
                address = self.address(operand)
                if address in self.memory: return self.memory[address]
                offset = image.offset(address)
                return struct.unpack_from('<d' if operand.startswith('qword') else '<f', image.data, offset)[0]
            return self.registers[operand] if operand in self.registers else int(operand, 0)

        def write(self, operand, value, floating=False):
            if operand in self.registers:
                self.registers[operand] = value
            else:
                super().write(operand, value, floating)

        def execute(self):
            start, end = 0x1055846a, 0x10558784
            instructions = {i.address: i for i in image.dis.disasm(
                image.data[image.offset(start):image.offset(end)], start)}
            pc = start
            for _ in range(400):
                if pc == end: return
                i = instructions[pc]
                self.visited.add(pc)
                op, args = i.mnemonic, i.op_str.split(', ')
                next_pc = pc + i.size
                if op in ('cmp', 'test'):
                    a, b = map(self.read, args)
                    v = a - b if op == 'cmp' else a & b
                    self.flags = {'z': v == 0, 'negative': v < 0 or bool(v & 0x80000000)}
                elif op in ('je', 'jne', 'jge'):
                    take = self.flags['z'] if op == 'je' else not self.flags['z'] if op == 'jne' else not self.flags['negative']
                    if take: next_pc = int(args[0], 0)
                elif op == 'push':
                    value = self.read(args[0])
                    self.registers['esp'] -= 4
                    self.memory[self.registers['esp']] = value
                elif op == 'sub':
                    assert args[0] == 'esp'
                    self.registers['esp'] -= int(args[1], 0)
                elif op == 'fild':
                    self.stack.insert(0, float(self.read(args[0])))
                elif op in ('fsubp', 'fsubr'):
                    if op == 'fsubp':
                        target = int(args[0][3:-1])
                        self.stack[target] -= self.stack[0]
                        self.stack.pop(0)
                    else:
                        self.stack[0] = self.read(args[0]) - self.stack[0]
                elif op == 'call':
                    target, obj = self.read(args[0]), self.registers['ecx']
                    if target == image.exported('?MaterialUSize@UBitmapMaterial@@UAEHXZ'):
                        self.registers['eax'] = self.memory[obj + 0x580]
                    elif target == image.exported('?MaterialVSize@UBitmapMaterial@@UAEHXZ'):
                        self.registers['eax'] = self.memory[obj + 0x584]
                    else:
                        assert target == image.exported('?DrawTile@UCanvas@@UAEXPAVUMaterial@@MMMMMMMMMVFPlane@@1@Z')
                        sp = self.registers['esp']
                        self.draws.append([self.memory[sp + n * 4] for n in range(14)])
                        self.registers['esp'] += 0x48
                else:
                    super().run([i])
                pc = next_pc
            raise AssertionError('draw argument slice did not terminate')

    texture_table = image.exported('??_7UTexture@@6B@')
    canvas_table = image.exported('??_7UCanvas@@6B@')
    # Full texture dimensions and transformed canvas point are intentionally
    # independent fixtures; no currently exported atlas supplies the oracle.
    cases, visited = 0, set()
    for x, y, z in [(320., 240., .9), (-17.25, 0., .2), (623.125, 760.5, 1.)]:
        for length in (0, 1, 48, 96):
            for selector, special in [(0, False), (1, True), (2, False), (2, True), (3, True)]:
                frame, stack, canvas = 0x10000, 0x20000, 0x30000
                textures = [0x40000 + n * 0x1000 for n in range(4)]
                dims = [(3, 4), (2, 4), (5, 4), (128, 4)]
                memory = {frame + 0x40: f32(x - 44), frame + 0x44: f32(y), frame + 0x48: f32(z),
                          frame + 0x58: f32(dims[0][0]), frame + 0x54: f32(dims[2][0]),
                          frame + 0x68: length, frame + 0x6c: 2, frame + 0x74: 96.,
                          frame + 0x78: int(special), frame + 0x1c: 1., frame + 0x20: 1.,
                          frame + 0x24: 1., frame + 0x28: 128., canvas: canvas_table,
                          canvas_table + 0x70: image.u32(canvas_table + 0x70),
                          texture_table + 0x78: image.u32(texture_table + 0x78),
                          texture_table + 0x7c: image.u32(texture_table + 0x7c)}
                for obj, dimensions, global_ref in zip(textures, dims, [0x10c48150, 0x10c48154, 0x10c48158, 0x10c4813c]):
                    memory.update({global_ref: obj, obj: texture_table, obj + 0x580: dimensions[0], obj + 0x584: dimensions[1]})
                machine = DrawArguments(memory, {'eax': 0, 'ecx': 0, 'edx': 0, 'ebx': selector,
                    'edi': 0, 'esi': canvas, 'ebp': frame, 'esp': stack})
                machine.execute()
                sx, sy = f32(x - 44), f32(y - (5 if selector == 2 and special else 0))
                left, right, full, height = dims[0][0], dims[2][0], 96., 2.
                specs = [(sx - 1, sy - 1, left, height + 2),
                         (sx - 1 + left, sy - 1, full + 2 - left - right, height + 2),
                         (sx - 1 + full + 2 - right, sy - 1, right, height + 2),
                         (sx, sy, length, height)]
                expected = [[obj, *map(f32, rectangle), 0., 0., float(uv[0]), float(uv[1]), f32(z),
                             1., 1., 1., 128.]
                            for obj, rectangle, uv in zip(textures, specs, dims)]
                assert machine.draws == expected, (x, y, length, selector, special, machine.draws, expected)
                assert machine.stack == [] and machine.registers['esp'] == stack
                visited.update(machine.visited)
                cases += 1
    return {'drawArgumentCases': cases, 'drawArgumentInstructions': len(visited)}


def verify_material_sources(engine, texture_names):
    """Bound original source assets and the conditional non-editor material path.

    This does not assert Canvas.Style at gauge draw time, bind allocation/matrix
    imports, or emulate a GPU. D3D imports below survive in the original PE.
    """
    from check_npc_material_native import D3D_SHA
    from check_numberpad_native import import_names
    from check_cast_agent_native import checked_package, qualified_export, ENGINE_PACKAGE_SHA
    sys.path[:0] = [str(ROOT / 'tools/dat'), str(ROOT / 'tools/uscript')]
    from export_npc_visuals import OriginalClasses, terminal_defaults
    from extract_uscript import sources_from_package
    from l2lib import Reader
    from l2lib.ue2package import read_properties

    d3d = Image(ROOT / 'assets/interlude/system/D3DDrv.dll', D3D_SHA)
    imports = import_names(d3d)
    expected_imports = {
        0x100dd3d8: ('Engine.dll', '?StaticClass@UL2ColorModifier@@SAPAVUClass@@XZ'),
        0x100dd130: ('Core.dll', '?IsA@UObject@@QBEHPAVUClass@@@Z'),
        0x100dd388: ('Engine.dll', '??BFColor@@QBEKXZ'),
    }
    for address, expected in expected_imports.items():
        assert imports[address] == expected
    assert engine.exported('?PrivateStaticClass@UL2ColorModifier@@0VUClass@@A') == 0x10c6d178
    assert engine.exported('?PrivateStaticClass@UTexture@@0VUClass@@A') == 0x11d7c1f0
    assert engine.exported('?Plane@FColor@@QBE?AVFPlane@@XZ') == 0x1030c8d8
    assert engine.exported('?Plane@FColor@@QBE?AVFPlane@@XZ', True) == 0x10331880
    assert engine.exported('??0FColor@@QAE@EEEE@Z', True) == 0x10331600
    copy_name, = [name for name in engine.exports if name.startswith('??0UL2ColorModifier@@')
                 and engine.exported(name, True) == 0x1034c630]
    assert engine.exported(copy_name, True) == 0x1034c630
    assert struct.unpack_from('<f', engine.data, engine.offset(0x108b9a88))[0] == 128.
    assert struct.unpack_from('<d', engine.data, engine.offset(0x10853b38))[0] == 255.

    ranges = [
        (engine, 0x10554a6b, 0x10554b64, 'bf558b5016d035a5becb19c0d1fc08abc79e683e4d590d812ec28b239561fdf0'),
        (engine, 0x10554ba3, 0x10554c4d, '9f8542276e9f05aa078ac1fccdc6409d61e6cf446ed405e8fe1a2f304ed1cd6b'),
        (engine, 0x1034c66c, 0x1034c6b8, 'a2dd7e7ddb74f07ff0c76d6c9329409db78fc20bbc3c7976d7352d02a34de8c0'),
        (d3d, 0x100111d6, 0x1001122d, '7952c02e9060743e21e7e4fc1f6d0206f94ead14603332bfbe48b8feca8d9e54'),
        (d3d, 0x1000ce3c, 0x1000cedd, '94c9098da927fc1322367d4a885e9e4bb42bb86269dad4ae6ae06c71c407e7f1'),
        (d3d, 0x1000d25a, 0x1000d34c, 'e3d33c3f404fc72e9a23ed3550d2579e21b6fed5679c43adb2969d70ee88d1ea'),
        (d3d, 0x10007e86, 0x10007f44, '1076a495bbacc46945d93a11dd6e6b328c4c8773b8d41a953ef174494ca4b456'),
    ]
    for image, start, end, expected in ranges:
        assert hashlib.sha256(image.data[image.offset(start):image.offset(end)]).hexdigest() == expected
    engine_anchors = [
        (0x1035a878, 'mov', 'cl, byte ptr [ebp + 0x5c]'),
        (0x1035a87b, 'mov', 'byte ptr [ebx + 0x5c], cl'),
        (0x105549d3, 'xor', 'ebx, ebx'),
        (0x105549f4, 'call', '0x103152fd'),
        (0x103152fd, 'jmp', '0x1040b4c0'),
        (0x10558422, 'mov', 'dword ptr [ebp + 0x70], 0xffffffff'),
        (0x10558430, 'call', '0x1030c8d8'),
        (0x10558435, 'fld', 'dword ptr [0x108b9a88]'), (0x1055843b, 'fstp', 'dword ptr [ebp + 0x28]'),
        (0x10331613, 'mov', 'dl, byte ptr [esp + 0x10]'), (0x1033161a, 'mov', 'byte ptr [eax + 3], dl'),
        (0x103318a2, 'movzx', 'ecx, byte ptr [ecx + 3]'), (0x103318ca, 'fstp', 'dword ptr [eax + 0xc]'),
        (0x1040b4c8, 'mov', 'ecx, dword ptr [eax + 0x24]'),
        (0x1040b4d0, 'cmp', 'ecx, 0x11d7c1f0'), (0x1040b4d8, 'mov', 'ecx, dword ptr [ecx + 0x34]'),
        (0x10554a9b, 'movzx', 'eax, byte ptr [edi + 0x5c]'), (0x10554a9f, 'add', 'eax, -2'),
        (0x10554aa2, 'cmp', 'eax, 5'), (0x10554aa5, 'ja', '0x10554b64'),
        (0x10554ba3, 'mov', 'eax, dword ptr [0x11d8dbe4]'),
        (0x10554ba8, 'cmp', 'dword ptr [eax], ebx'), (0x10554baa, 'jne', '0x10554c4d'),
        (0x10554bc9, 'push', '0x10c6d178'),
        (0x10554bf0, 'or', 'dword ptr [eax + 0x580], 2'),
        (0x10554bfd, 'mov', 'byte ptr [ecx + 0x585], 1'),
        (0x10554c0a, 'mov', 'byte ptr [edx + 0x584], 2'),
        (0x10554c11, 'fld', 'dword ptr [ebp + 0x3c]'),
        (0x10554c1b, 'or', 'eax, 0xc00'), (0x10554c26, 'fistp', 'dword ptr [ebp - 0x14]'),
        (0x10554c35, 'mov', 'byte ptr [ecx + 0x57f], al'),
        (0x10554c41, 'mov', 'dword ptr [edx + 0x578], esi'), (0x10554c47, 'mov', 'esi, dword ptr [0x10c49ad8]'),
        (0x1034c66c, 'mov', 'eax, dword ptr [edi + 0x57c]'),
        (0x1034c672, 'mov', 'dword ptr [esi + 0x57c], eax'),
        (0x1034c67e, 'and', 'ecx, 1'), (0x1034c695, 'and', 'edx, 2'),
        (0x1034c6a0, 'mov', 'al, byte ptr [edi + 0x584]'),
        (0x1034c6a6, 'mov', 'byte ptr [esi + 0x584], al'),
        (0x1034c6ac, 'mov', 'cl, byte ptr [edi + 0x585]'),
        (0x1034c6b2, 'mov', 'byte ptr [esi + 0x585], cl'),
    ]
    d3d_anchors = [
        (0x100111d6, 'call', 'dword ptr [0x100dd3d8]'),
        (0x100111df, 'call', 'dword ptr [0x100dd130]'),
        (0x100111e9, 'mov', 'dword ptr [edi + 0x84], esi'),
        (0x100111f5, 'shr', 'eax, 1'), (0x100111f9, 'or', 'dword ptr [edi + 0x74], eax'),
        (0x10011204, 'or', 'dword ptr [edi + 0x68], ecx'),
        (0x1001120d, 'mov', 'dword ptr [edi + 0x88], edx'),
        (0x10011213, 'movzx', 'eax, byte ptr [ebx + 0x584]'),
        (0x1001121a, 'mov', 'dword ptr [edi + 0x8c], eax'),
        (0x10011220, 'movzx', 'ecx, byte ptr [ebx + 0x585]'),
        (0x10011227, 'mov', 'dword ptr [edi + 0x90], ecx'),
        (0x1000d25a, 'cmp', 'dword ptr [ebp + 0x90], 0'),
        (0x1000d275, 'cmp', 'dword ptr [ebp + 0x80], 0'),
        (0x1000d295, 'mov', 'dword ptr [ecx + 0x24], 5'),
        (0x1000d2a8, 'mov', 'dword ptr [eax + 0x28], 6'),
        (0x1000d2cf, 'call', '0x10007cf0'),
        (0x1000d2da, 'call', 'dword ptr [0x100dd388]'),
        (0x1000d2ec, 'mov', 'dword ptr [ecx + 0x20], eax'),
        (0x1000d301, 'or', 'dword ptr [eax + 4], ecx'),
        (0x1000d313, 'or', 'dword ptr [eax + 0x18], ecx'),
        (0x1000d32a, 'mov', 'dword ptr [eax + 8], edi'),
        (0x1000d339, 'mov', 'byte ptr [edx + 0xc], 0'),
        (0x10007e86, 'cmp', 'ecx, 5'), (0x10007e8b, 'cmp', 'dword ptr [eax + 0x28], 6'),
        (0x10007e97, 'call', 'dword ptr [0x100dd388]'),
        (0x10007ed9, 'mov', 'dword ptr [esi + 0x118], 4'),
        (0x10007ee3, 'mov', 'dword ptr [esi + 0x114], 2'),
        (0x10007ef2, 'cmp', 'dword ptr [edi + 0x90], edx'),
        (0x10007f34, 'mov', 'dword ptr [esi + 0x100], 0'),
    ]
    for image, anchors in [(engine, engine_anchors), (d3d, d3d_anchors)]:
        for anchor in anchors:
            image.instruction(*anchor)

    package = checked_package(ROOT / 'assets/interlude/system/Engine.u', ENGINE_PACKAGE_SHA)
    sources = dict(sources_from_package(package))
    enum = re.search(r'enum EL2TextureOp\s*\{([^}]+)\}', sources['L2ColorModifier']).group(1)
    assert re.findall(r'P_\w+', enum)[:3] == ['P_DISABLE', 'P_SELECTARG1', 'P_SELECTARG2']
    assert re.search(r'Style\s*=\s*Default.Style\s*;', sources['Canvas'])
    # Reflected NEXT links, not the incidental order of ScriptText declarations,
    # join typed copy writes to the Color / packed-bool / byte field names.
    owner, = [ex for ex in package.exports_by_class('Class') if package.export_name(ex) == 'L2ColorModifier']
    rows = {}
    for ex in package.exports:
        kind = package.class_name_of(ex)
        if ex.package_index != owner.index + 1 or not kind.endswith('Property'):
            continue
        raw = package.data[ex.serial_offset:ex.serial_offset + ex.serial_size]
        reader = Reader(raw)
        assert package.name(reader.compact()) == 'None' and reader.compact() == 0
        next_ref, dim, flags = reader.compact(), reader.u32(), reader.u32()
        reader.compact()  # category
        if kind in ('StructProperty', 'ByteProperty'):
            reader.compact()  # exact struct / enum reference retained by package
        assert reader.pos == len(raw) and dim == 1 and not flags & 0x20
        rows[ex.index + 1] = (package.export_name(ex), kind, next_ref)
    ref, = [ref for ref, row in rows.items() if row[0] == 'Color']
    field_chain = []
    for name, kind in [('Color', 'StructProperty'), ('RenderTwoSided', 'BoolProperty'),
                       ('AlphaBlend', 'BoolProperty'), ('AlphaOp', 'ByteProperty'), ('ColorOp', 'ByteProperty')]:
        row = rows[ref]
        assert row[:2] == (name, kind)
        field_chain.append({'ref': ref, 'name': name, 'kind': kind})
        ref = row[2]
    enum_export = package.resolve_ref(ref)
    assert (package.class_name_of(enum_export), package.export_name(enum_export), enum_export.package_index) == (
        'Enum', 'EL2TextureOp', owner.index + 1)
    classes, defaults = OriginalClasses(), {}
    for name in ('Canvas', 'L2ColorModifier'):
        types = classes.property_types('Engine.' + name, set())
        ex, = [ex for ex in package.exports_by_class('Class') if package.export_name(ex) == name]
        props, proof = terminal_defaults(package, ex, types)
        assert proof['defaultsBoundary'] == 'unique-validated-candidate'
        defaults[name] = {'properties': props, 'proof': proof}
    assert ('Style', 'byte', 1) in defaults['Canvas']['properties']
    assert defaults['L2ColorModifier']['properties'] == [
        ('Color', 'struct', ('Color', 'ffffffff')), ('RenderTwoSided', 'bool', True), ('AlphaBlend', 'bool', True)]

    texture_sha = '3cf853b9672a39811c5b956eca79459272e5e355435a6e5753a597503bea2f44'
    textures = checked_package(ROOT / 'assets/interlude/systextures/L2UI_CH3.utx', texture_sha)
    wanted, records = {name.casefold() for name in texture_names}, {}
    for ex in textures.exports:
        path = qualified_export(textures, ex, 'L2UI_CH3')
        if path.casefold() not in wanted:
            continue
        assert path.casefold() not in records and textures.class_name_of(ex) == 'Texture'
        props = read_properties(textures, textures.body_reader(ex), fmt='packed')
        dimensions = {key: struct.unpack('<i', props[key])[0] for key in ('USize', 'VSize', 'UClamp', 'VClamp')}
        height = 8 if path.casefold().split('.')[-1].startswith('minibar_back') else 4
        assert dimensions == {'USize': 8, 'VSize': height, 'UClamp': 8, 'VClamp': height}
        assert props['bAlphaTexture'] is True and props['Format'] == b'\x07'
        raw = textures.data[ex.serial_offset:ex.serial_offset + ex.serial_size]
        records[path.casefold()] = {'path': path, **dimensions, 'bAlphaTexture': True, 'formatOrdinal': 7,
            'exportOffset': ex.serial_offset, 'exportLength': ex.serial_size, 'exportSHA256': hashlib.sha256(raw).hexdigest()}
    assert set(records) == wanted
    return {'nativeAnchors': len(engine_anchors) + len(d3d_anchors), 'pinnedRanges': len(ranges),
        'd3dSHA256': d3d.sha, 'enginePackageSHA256': ENGINE_PACKAGE_SHA, 'texturePackageSHA256': texture_sha,
        'namedImports': {hex(address): imports[address] for address in expected_imports},
        'modifierFields': field_chain, 'defaults': defaults, 'textures': list(records.values()),
        'drawColorPlane': [1., 1., 1., 128.], 'modifierAlphaByte': 128,
        'scope': 'conditional non-editor DrawTile path; live Canvas.Style and projection remain unproved'}


def verify():
    e = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    bindings = [
        ('?OnSetupGaugePacket@UGameEngine@@UAEXAAVL2ParamStack@@@Z', 0x10492690),
        ('??0FL2ResueOrCast@@QAE@XZ', 0x10358710),
        ('?CanUse@FL2ResueOrCast@@QAEHXZ', 0x10358720),
        ('?Reset@FL2ResueOrCast@@QAEXHH@Z', 0x10358730),
        ('?Disable@FL2ResueOrCast@@QAEXXZ', 0x10358760),
        ('?GetLength@FL2ResueOrCast@@QAEMM@Z', 0x10358770),
        ('?Add@FL2ResueOrCast@@QAEXM@Z', 0x103587a0),
        ('?Tick@UGameEngine@@UAEXM@Z', 0x105972d0),
        ('?Render@FDynamicActor@@QAEXPAVFLevelSceneNode@@PAV?$TList@PAVFDynamicLight@@@@PAV?$TList@PAUFProjectorRenderInfo@@@@PAVFRenderInterface@@@Z', 0x1065aae0),
        ('?DrawDepthBar@UCanvas@@UAEXPAVFLevelSceneNode@@PAVFRenderInterface@@VFVector@@KKHM_N@Z', 0x10557fc0),
        ('?Project@FSceneNode@@QAE?AVFPlane@@VFVector@@@Z', 0x1064f6b0),
        ('?DrawTile@UCanvas@@UAEXPAVUMaterial@@MMMMMMMMMVFPlane@@1@Z', 0x105549b0),
        ('?MaterialUSize@UBitmapMaterial@@UAEHXZ', 0x10333a30),
        ('?MaterialVSize@UBitmapMaterial@@UAEHXZ', 0x10333a40),
    ]
    for name, address in bindings:
        assert e.exported(name, True) == address, name
    assert e.exported(bindings[3][0]) == 0x10303c83
    assert e.exported(bindings[5][0]) == 0x10307e05
    assert e.exported(bindings[6][0]) == 0x1030f8a8
    assert e.exported(bindings[10][0]) == 0x103153e3
    assert e.u32(e.exported('??_7UCanvas@@6B@') + 0xe8) == e.exported(bindings[9][0])
    assert e.u32(e.exported('??_7UCanvas@@6B@') + 0x70) == e.exported(bindings[11][0])
    assert e.u32(e.exported('??_7UTexture@@6B@') + 0x78) == e.exported(bindings[12][0])
    assert e.u32(e.exported('??_7UTexture@@6B@') + 0x7c) == e.exported(bindings[13][0])
    assert e.exported('?PrivateStaticClass@UFinalBlend@@0VUClass@@A') == 0x10c72ed8
    for start, end, expected in RANGES:
        assert hashlib.sha256(e.data[e.offset(start):e.offset(end)]).hexdigest() == expected, hex(start)

    anchors = [
        (0x104926b4, 'cmp', 'dword ptr [edx + 0x3bc], 0'),
        (0x104926f7, 'call', 'edi'), (0x104926fb, 'mov', 'dword ptr [esp + 0x14], eax'),
        (0x104926ff, 'call', 'edi'), (0x10492703, 'mov', 'ebp, eax'), (0x10492705, 'call', 'edi'),
        (0x1049270b, 'test', 'ecx, ecx'), (0x10492723, 'cmp', 'ecx, 1'),
        (0x1049273c, 'cmp', 'ecx, 2'), (0x10492755, 'cmp', 'ecx, 3'),
        (0x10358712, 'mov', 'dword ptr [eax], 0'),
        (0x10358730, 'fild', 'dword ptr [esp + 8]'), (0x10358734, 'mov', 'dword ptr [ecx], 1'),
        (0x1035873a, 'fstp', 'dword ptr [esp + 8]'), (0x10358742, 'fst', 'dword ptr [ecx + 4]'),
        (0x10358745, 'fisub', 'dword ptr [esp + 4]'), (0x10358749, 'fstp', 'dword ptr [ecx + 8]'),
        (0x10358760, 'mov', 'dword ptr [ecx], 0'),
        (0x10358771, 'fld', 'dword ptr [ecx + 4]'), (0x10358774, 'fsub', 'dword ptr [ecx + 8]'),
        (0x10358777, 'fstp', 'dword ptr [esp]'), (0x1035877d, 'fmul', 'dword ptr [esp + 8]'),
        (0x10358781, 'fdiv', 'dword ptr [ecx + 4]'), (0x10358784, 'fstp', 'dword ptr [esp + 8]'),
        (0x103587a0, 'cmp', 'dword ptr [ecx], 0'), (0x103587a3, 'je', '0x103587c9'),
        (0x103587a5, 'fld', 'dword ptr [ecx + 8]'), (0x103587a8, 'fadd', 'dword ptr [esp + 4]'),
        (0x103587ac, 'fstp', 'dword ptr [esp + 4]'), (0x103587b4, 'fst', 'dword ptr [ecx + 8]'),
        (0x103587b7, 'fld', 'dword ptr [ecx + 4]'), (0x103587ba, 'fcompp', ''),
        (0x103587be, 'test', 'ah, 0x41'), (0x103587c1, 'jp', '0x103587c9'),
        (0x103587c3, 'mov', 'dword ptr [ecx], 0'),
        (0x105974d0, 'fld', 'dword ptr [ebp + 0x7c]'),
        (0x105974d3, 'fmul', 'qword ptr [0x10888760]'),
        (0x105974d9, 'fstp', 'dword ptr [ebp + 0x6c]'),
        (0x1065ab09, 'mov', 'edi, ecx'), (0x1065ab0b, 'mov', 'dword ptr [ebp + 0x64], edi'),
        (0x1065d2b9, 'mov', 'ecx, dword ptr [ebx + 4]'),
        (0x1065d2bc, 'mov', 'edx, dword ptr [ecx + 0x3c]'),
        (0x1065d2bf, 'mov', 'esi, dword ptr [edx + 0x3bc]'),
        (0x1065d2c5, 'mov', 'dword ptr [ebp + 0x78], esi'),
        (0x1065d73b, 'mov', 'eax, dword ptr [ebp + 0x78]'),
        (0x1065d73e, 'mov', 'ecx, dword ptr [ebp + 0x64]'),
        (0x1065d741, 'cmp', 'eax, dword ptr [ecx]'), (0x1065d743, 'jne', '0x1065db29'),
        (0x1065d3a1, 'fld', 'dword ptr [eax + 0x1bc]'),
        (0x1065d3b6, 'fadd', 'dword ptr [eax + 0x1c0]'),
        (0x1065d3c5, 'fadd', 'dword ptr [eax + 0x1c4]'),
        (0x1065da77, 'or', 'eax, 0xc00'), (0x1065da82, 'fistp', 'qword ptr [ebp + 0x30]'),
        (0x1065daa7, 'mov', 'edx, dword ptr [edx + 0xe8]'), (0x1065daad, 'call', 'edx'),
        (0x105582d8, 'mov', 'ecx, dword ptr [ebp + 0x5c]'),
        (0x105582dd, 'mov', 'edx, dword ptr [ebp + 0x60]'),
        (0x105582e3, 'mov', 'ecx, dword ptr [ebp + 0x64]'),
        (0x105582ef, 'call', '0x103153e3'),
        (0x10333a30, 'mov', 'eax, dword ptr [ecx + 0x580]'),
        (0x10333a40, 'mov', 'eax, dword ptr [ecx + 0x584]'),
        (0x10554ce4, 'ret', '0x48'),
        (0x10558382, 'fsub', 'qword ptr [0x108bb378]'),
        (0x1055846a, 'cmp', 'byte ptr [ebp + 0x78], 0'),
        (0x10558470, 'cmp', 'ebx, 2'),
        (0x10558478, 'fsub', 'qword ptr [0x10891850]'),
        (0x105583a6, 'push', '0x10c72ed8'),
        (0x105583d3, 'mov', 'dword ptr [ecx + 0x578], eax'),
        (0x105583de, 'or', 'dword ptr [eax + 0x580], 8'),
        (0x105583eb, 'mov', 'byte ptr [edx + 0x57c], 0'),
        (0x105583f7, 'or', 'dword ptr [eax + 0x580], 1'),
        (0x10558403, 'or', 'dword ptr [eax + 0x580], 2'),
        (0x1055840f, 'or', 'dword ptr [eax + 0x580], 4'),
        (0x1055841b, 'mov', 'byte ptr [eax + 0x584], 0x7f'),
        (0x10558551, 'mov', 'ecx, dword ptr [0x10c48150]'),
        (0x10558615, 'mov', 'eax, dword ptr [0x10c48154]'),
        (0x105586c9, 'mov', 'eax, dword ptr [0x10c48158]'),
        (0x10558776, 'mov', 'edx, dword ptr [0x10c4813c]'),
        (0x10554a3e, 'mov', 'al, byte ptr [edi + 0x5c]'),
        (0x1065d7d1, 'call', '0x10304e08'), (0x1065d7fc, 'call', '0x10304e08'),
        (0x1065d848, 'fild', 'dword ptr [ebp + 0x3c]'),
        (0x1065d84b, 'fdiv', 'qword ptr [0x10888760]'),
        (0x1065d854, 'fmul', 'qword ptr [0x10854ba0]'),
        (0x1065d929, 'fmul', 'qword ptr [0x10853b28]'),
        (0x1065d9f6, 'fmul', 'qword ptr [0x10853b28]'),
        (0x1065da04, 'fmul', 'dword ptr [ebp + 0x24]'),
        (0x1065da07, 'fstp', 'dword ptr [ebp + 0x24]'),
    ]
    for offset, lea, call in [(0x1e0, 0x10492710, 0x10492717), (0x1d4, 0x10492729, 0x10492730),
                              (0x1ec, 0x10492742, 0x10492749), (0x1f8, 0x1049275b, 0x10492762)]:
        anchors += [(lea, 'lea', f'ecx, [ebx + {hex(offset)}]'), (call, 'call', '0x10303c83')]
    for offset, lea, call in [(0x1d4, 0x105974e3, 0x105974e9), (0x1e0, 0x105974f5, 0x105974fb),
                              (0x1ec, 0x10597507, 0x1059750d), (0x1f8, 0x10597519, 0x1059751f)]:
        anchors += [(lea, 'lea', f'ecx, [edi + {hex(offset)}]'), (call, 'call', '0x1030f8a8')]
    for call, color_at, color, height_at in [(0x1065d8c2, 0x1065d8e0, 0, 0x1065d8e2),
            (0x1065d98c, 0x1065d9ad, 1, 0x1065d9af), (0x1065da48, 0x1065da69, 2, 0x1065da6b),
            (0x1065dac6, 0x1065dae4, 3, 0x1065dae6)]:
        anchors += [(call, 'call', '0x10307e05'), (color_at, 'push', str(color)), (height_at, 'push', '2')]
    textures = [(0x10558029, 0x108bb510, 'L2UI_CH3.etc.Minibar_water'),
                (0x10558095, 0x108bb4d0, 'L2UI_CH3.Etc.Minibar_Arrow'),
                (0x10558101, 0x108bb490, 'L2UI_CH3.Etc.Minibar_Magic'),
                (0x10558162, 0x108bb450, 'L2UI_CH3.Etc.Minibar_Food'),
                (0x105581c8, 0x108bb40c, 'L2UI_CH3.etc.Minibar_Back21'),
                (0x1055821a, 0x108bb3c8, 'L2UI_CH3.etc.Minibar_Back22'),
                (0x1055826c, 0x108bb384, 'L2UI_CH3.etc.Minibar_Back23')]
    for at, literal, value in textures:
        anchors.append((at, 'push', hex(literal)))
        assert e.wide(literal) == value
    for anchor in anchors:
        e.instruction(*anchor)
    assert struct.unpack_from('<d', e.data, e.offset(0x10888760))[0] == 1000
    assert struct.unpack_from('<f', e.data, e.offset(0x108dc64c))[0] == 96
    for va, expected in [(0x108bb378, 44), (0x10891850, 5), (0x1085b788, 2),
                         (0x10854ba0, 6), (0x10853b28, 3)]:
        assert struct.unpack_from('<d', e.data, e.offset(va))[0] == expected
    # World-anchor and canvas-transform helpers remain unbound. Do not make
    # the comparison silently assign Normalize, Box.GetCenter, inverse, etc.
    for va in (0x1065d4d7, 0x1065d830, 0x106831de, 0x10683305, 0x10683379):
        assert e.data[e.offset(va):e.offset(va) + 6] == b'\x90' * 6
    examples = [finite_example(500, 500, 0), finite_example(500, 500, 100),
                finite_example(250, 1000, 0), finite_example(500, 500, 500), finite_example(0, 1000, 0)]
    assert examples[0]['length'] == 96 and examples[0]['active']
    assert examples[1]['length'] == struct.unpack('<f', struct.pack('<f', 76.8))[0]
    assert examples[2]['length'] == 24 and examples[2]['elapsed'] == 750
    assert examples[3]['length'] == examples[4]['length'] == 0
    assert not examples[3]['active'] and not examples[4]['active']
    material = verify_material_sources(e, [row[2] for row in textures])
    return {'tool': 'Elbera Tools / original gauge evidence', 'sourceSHA256': e.sha,
            'nativeAnchors': len(anchors) + material['nativeAnchors'], 'namedBodies': len(bindings),
            'pinnedRanges': len(RANGES) + material['pinnedRanges'],
            'finiteEquationExamples': len(examples), **verify_draw_arithmetic(e),
            'material': material,
            'textures': [row[2] for row in textures],
            'scope': 'independent countdown state and local-actor depth-bar call; complete renderer unported'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='print a compact verification result')
    args = parser.parse_args()
    result = verify()
    if args.check:
        print(f"PASS: {result['nativeAnchors']} native anchors, {result['namedBodies']} named bodies, "
              f"{result['pinnedRanges']} pinned ranges, {result['finiteEquationExamples']} finite equation examples; "
              f"{result['drawArgumentCases']} native draw-argument comparisons / {result['drawArgumentInstructions']} instructions; "
              f"{len(result['material']['textures'])} original texture records, alpha {result['material']['modifierAlphaByte']}")
    else:
        print(json.dumps(result, indent=2))
