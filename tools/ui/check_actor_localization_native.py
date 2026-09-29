#!/usr/bin/env python3
"""Elbera Tools: original localization versus the browser's supplied-state port.

Interprets pinned Core instructions using the existing admission interpreter.
CRT formatting/comparison and configuration are explicit authored providers.
The joined string suite executes ImportText and assignment over a supplied
allocator/memcpy provider. No DLL executes; no original payload is embedded.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

from actor_localization_source import (
    qualify_actor_localization,
    qualify_string_property_text,
    qualify_string_property_loading,
    qualify_class_default_initialization,
)
from actor_octree_admission_machine import AdmissionMachine, PartialWord
from actor_octree_machine import MembershipMachine
from check_static_sweep_native import PreparationProgram
from check_static_mesh_native import browser_outputs
from check_tutorial_quest_native import Image
from check_supplemental_engine import CORE_SHA, CANDIDATE_CORE_SHA
from supplemental_pe import PEImage

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from l2lib import encode_compact
from l2lib.stringproperty import decode_string_property


def source_program(core, comparison, engine=None, comparison_engine=None):
    proof = qualify_actor_localization(core, comparison)
    proof["stringImport"] = qualify_string_property_text(core, comparison)
    proof["stringLoading"] = qualify_string_property_loading(core, comparison)
    proof["classDefaultInitialization"] = qualify_class_default_initialization(
        core, comparison
    )
    program = SimpleNamespace(
        engine=core,
        rows=[],
        half=0.5,
        bounds_constants={},
        membership_constants={},
        import_targets={},
        admission_imports={},
        membership_targets={
            int(k, 16): int(v, 16) for k, v in proof["thunkTargets"].items()
        },
        receipt=proof,
    )
    for block in proof["coreBlocks"]:
        start, end = int(block["start"], 16), int(block["end"], 16)
        data = bytes(core.data[core.offset(start) : core.offset(end)])
        PreparationProgram.add(program, core, start, end, data)
    strings = proof["stringImport"]
    for block in strings["coreBlocks"]:
        start, end = int(block["start"], 16), int(block["end"], 16)
        PreparationProgram.add(
            program,
            core,
            start,
            end,
            bytes(core.data[core.offset(start) : core.offset(end)]),
        )
    program.membership_targets.update(
        {int(k, 16): int(v, 16) for k, v in strings["thunkTargets"].items()}
    )
    loading = proof["stringLoading"]
    for block in loading["coreBlocks"]:
        start, end = int(block["start"], 16), int(block["end"], 16)
        PreparationProgram.add(
            program,
            core,
            start,
            end,
            bytes(core.data[core.offset(start) : core.offset(end)]),
        )
    program.membership_targets.update(
        {int(k, 16): int(v, 16) for k, v in loading["thunkTargets"].items()}
    )
    defaults = proof["classDefaultInitialization"]
    for block in defaults["coreBlocks"]:
        start, end = int(block["start"], 16), int(block["end"], 16)
        PreparationProgram.add(
            program,
            core,
            start,
            end,
            bytes(core.data[core.offset(start) : core.offset(end)]),
        )
    program.membership_targets.update(
        {int(k, 16): int(v, 16) for k, v in defaults["thunkTargets"].items()}
    )
    if engine is not None:
        from actor_transform_source import qualify_static_actor_loading
        from static_collision_source import qualify_static_mesh_fresh_load

        fresh = qualify_static_mesh_fresh_load(
            engine, core, comparison_engine, comparison
        )
        actor = qualify_static_actor_loading(
            engine, core, comparison_engine, comparison
        )
        proof["actorStartup"] = dict(fresh=fresh, actor=actor)
        for image, blocks in (
            (core, fresh["coreBlocks"]),
            (core, actor["coreBlocks"]),
            (engine, actor["engineBlocks"]),
        ):
            for block in blocks:
                start, end = int(block["start"], 16), int(block["end"], 16)
                PreparationProgram.add(
                    program,
                    image,
                    start,
                    end,
                    bytes(image.data[image.offset(start) : image.offset(end)]),
                )
        program.import_targets.update(
            {int(k, 16): int(v, 16) for k, v in actor["importTargets"].items()}
        )
        program.membership_targets.update(
            {int(k, 16): int(v, 16) for k, v in actor["thunkTargets"].items()}
        )
        # The actor qualifier binds this erased named import; the localization
        # qualifier above supplies the complete matching Core implementation.
        assert any(
            d.get("ownedVA") == "0x1052f5b3"
            and d.get("binding") == ["core.dll", "?LoadLocalized@UObject@@QAEXXZ"]
            for block in actor["engineBlocks"]
            for d in block.get("comparison", {}).get("differences", [])
        )
        program.import_targets[0x1052F5B3] = 0x1015F5E0
        for block in actor["coreBlocks"]:
            symbol = block["symbol"]
            thunk, start = core.exported(symbol), int(block["start"], 16)
            core.instruction(thunk, "jmp", hex(start))
            assert bytes(
                core.data[core.offset(thunk) : core.offset(thunk) + 5]
            ) == comparison.read(thunk, 5)
            program.membership_targets[thunk] = start
    return program


def config_reply(policy, call):
    if policy == "hit":
        return dict(found=True, value="text:" + call["key"])
    if policy == "empty":
        return dict(found=True, value="")
    if policy == "english":
        return dict(
            found=call["filename"].endswith(".int"),
            value="fallback" if call["filename"].endswith(".int") else None,
        )
    if policy == "write-on-miss":
        return dict(
            found=False, value=None if call["filename"].endswith(".int") else "partial"
        )
    if policy == "unicode":
        return dict(found=True, value="Café / 水 / \U0001f30a")
    assert policy == "missing"
    return dict(found=False, value=None)


class LocalizationMachine(AdmissionMachine):
    def address(self, operand):
        # UTF-16 strcpy uses dest-source plus a moving source pointer. Its
        # negative difference is stored as a DWORD; effective addresses wrap.
        return super().address(operand) & 0xFFFFFFFF

    def __init__(self, program, row):
        super().__init__(program)
        self.lookups, self.imports, self.contexts = [], [], []
        self.policy = row["policy"]
        self.actor = 0x100000
        self.fields = {}
        self.name_count = 0
        self.memory.update(
            {
                0x1023E8C4: int(row["isEditor"]),
                0x1023E8E0: int(row["environment"]["started"]),
                0x1023C68C: 0 if row["environment"]["configAbsent"] else 0xA90000,
                0xA90000: 0xA91000,
                0xA91010: 0xA92000,
                0x10323864: row["scratchCounter"],
                0x10327AE0: 0xB10000,
                0x1033B124: 0,  # StructProperty's parent, unused on cast success
            }
        )
        self.put_text(0x1023A4C8, row["environment"]["language"])
        for at, value in program.receipt["strings"].items():
            self.put_text(int(at, 16), value)
        cls = self.structure(row["classInfo"]["structure"], is_class=True)
        info, obj = row["classInfo"], row["object"]
        self.memory.update(
            {
                cls + 0x4A4: info["flags"],
                cls + 0x18: self.object(info["outer"]),
                cls + 0x20: self.name(info["name"]),
            }
        )
        self.memory.update(
            {
                self.actor + 0x24: cls,
                self.actor + 4: obj["index"] & 0xFFFFFFFF,
                self.actor + 0x1C: obj["flags"],
                self.actor + 0x18: self.object(obj["outer"]),
                self.actor + 0x20: self.name(obj["name"]),
            }
        )

    def read(self, operand):
        if operand in ("ax", "cx", "dx"):
            return self.registers["e" + operand] & 0xFFFF
        if operand.startswith("word ptr"):
            at = self.address(operand)
            return self.byte(at) | self.byte(at + 1) << 8
        return super().read(operand)

    def write(self, operand, value, floating=False):
        if operand in ("ax", "cx", "dx"):
            reg = "e" + operand
            self.registers[reg] = (self.registers[reg] & 0xFFFF0000) | (value & 0xFFFF)
            return
        if operand.startswith("word ptr"):
            at = self.address(operand)
            for offset in range(2):
                super().write(
                    f"byte ptr [{at + offset:#x}]", (value >> (8 * offset)) & 255
                )
            return
        return super().write(operand, value, floating)

    def byte(self, at):
        return super().read(f"byte ptr [{at:#x}]")

    def put_text(self, at, value):
        for index, byte in enumerate(
            value.encode("utf-16le", errors="surrogatepass") + b"\0\0"
        ):
            self.write(f"byte ptr [{at + index:#x}]", byte)

    def text(self, at):
        result = bytearray()
        for index in range(1024):
            pair = bytes((self.byte(at + index * 2), self.byte(at + index * 2 + 1)))
            if pair == b"\0\0":
                return result.decode("utf-16le", errors="surrogatepass")
            result.extend(pair)
        raise AssertionError("unterminated supplied UTF-16 text")

    def name(self, value):
        ptr = self.allocate((len(value.encode("utf-16le")) + 17) & ~3)
        self.put_text(ptr + 12, value)
        index = self.name_count
        self.name_count += 1
        self.memory[0xB10000 + index * 4] = ptr
        return index

    def object(self, obj):
        if obj is None:
            return 0
        ptr = self.allocate(0x28)
        self.memory[ptr + 0x20] = self.name(obj["name"])
        self.memory[ptr + 0x18] = self.object(obj.get("outer"))
        return ptr

    def structure(self, obj, is_class=False):
        if obj is None:
            return 0
        ptr = self.allocate(0x500)
        table = 0x101CF694 if is_class else 0x101CE484
        target = 0x10104890 if is_class else 0x10101ABE
        self.memory[table + 0x7C] = target
        self.memory[ptr] = table
        self.memory[ptr + 0x34] = self.structure(obj["super"], is_class)
        last = ptr + 0x48
        for field in obj["fields"]:
            prop = self.allocate(0x80)
            self.memory[last] = prop
            last = prop + 0x38
            cls = self.allocate(0x500)
            # A synthetic derived class also checks the cast's parent walk.
            self.memory[cls + 0x34] = 0x1033B0F0 if field.get("struct") else 0
            self.memory[cls + 0x4A4] = 0x8000 if field["isProperty"] else 0
            self.memory.update(
                {
                    prop: 0xA60000,
                    0xA6009C: 0xA70000,
                    prop + 0x24: cls,
                    prop + 0x20: self.name(field.get("name", "ignored")),
                }
            )
            if field["isProperty"]:
                for off, key in [
                    (0x40, "arrayDim"),
                    (0x44, "elementSize"),
                    (0x48, "propertyFlags"),
                    (0x54, "offset"),
                ]:
                    self.memory[prop + off] = field.get(key, 0) & 0xFFFFFFFF
                self.memory[prop + 0x78] = self.structure(field["struct"])
                self.fields[prop] = field["identity"]
        self.memory[last] = 0
        return ptr

    def step(self, i):
        sp = self.registers["esp"]
        if i.address == 0x1015F460:
            # Capture actual original caller arguments, not re-derived names.
            _, package, section, prefix, _ = [
                self.memory[sp + n * 4] for n in range(1, 6)
            ]
            self.contexts.append(
                dict(
                    packageName=self.text(package),
                    section=self.text(section),
                    prefix=self.text(prefix) if prefix else None,
                )
            )
        if i.mnemonic == "nop":
            pass
        elif i.mnemonic == "movzx":
            dest, source = i.op_str.split(", ")
            assert source.startswith("word ptr")
            self.write(dest, self.read(source))
        elif i.address == 0x1012E094:
            # Original appSprintf's CRT vsnwprintf call, bounded authored strings.
            assert i.op_str == "0x1017d804"
            dest, capacity, fmt, args = [self.memory[sp + n * 4] for n in range(4)]
            assert capacity == 1024
            fmt = self.text(fmt)
            assert fmt in ("%s.", "%s%s[%d]", "%s%s", "%s.%s")
            values = [self.memory[args + n * 4] for n in range(fmt.count("%"))]
            values = [
                value if fmt.endswith("%d]") and n == 2 else self.text(value)
                for n, value in enumerate(values)
            ]
            result = fmt % tuple(values)
            assert len(result.encode("utf-16le")) // 2 < capacity
            self.put_text(dest, result)
            self.registers["eax"] = len(result.encode("utf-16le")) // 2
        elif i.address == 0x1012DD00:
            # Explicit ASCII language comparison at the original CRT tail call.
            assert i.op_str == "0x1017db3d"
            a, b = [self.text(self.memory[sp + off]) for off in (4, 8)]
            assert a.isascii() and b.isascii()
            self.registers["eax"] = int(a.lower() != b.lower())
            target = self.memory[sp]
            self.registers["esp"] += 4
            self.visited.append(i.address)
            return target
        elif i.address == 0x10153F09:
            assert (
                self.registers["ecx"] == 0xA90000 and self.registers["edx"] == 0xA92000
            )
            section, key, dest, capacity, filename = [
                self.memory[sp + n * 4] for n in range(5)
            ]
            assert capacity == 1024
            call = dict(
                section=self.text(section),
                key=self.text(key),
                filename=self.text(filename),
                capacity=capacity,
            )
            self.lookups.append(call)
            reply = config_reply(self.policy, call)
            if reply["value"] is not None:
                self.put_text(dest, reply["value"])
            self.registers["eax"] = int(reply["found"])
            self.registers["esp"] += 20
        elif i.address == 0x1015C725:
            assert self.registers["edx"] == 0xA70000
            source, dest, port_flags = [self.memory[sp + n * 4] for n in range(3)]
            self.imports.append(
                dict(
                    field=self.fields[self.registers["ecx"]],
                    offset=dest - self.actor,
                    text=self.text(source),
                    portFlags=port_flags,
                )
            )
            # Return a deliberately unrelated value: original caller ignores it.
            self.registers["eax"] = 0xBAADF00D
            self.registers["esp"] += 12
        elif i.address == 0x10153F2E:
            raise AssertionError("nonoptional localization is outside this verifier")
        else:
            return super().step(i)
        self.visited.append(i.address)
        return i.address + i.size


class StringLocalizationMachine(LocalizationMachine):
    """Execute the original string importer over an explicit byte heap/stack.

    The allocator always succeeds and relocates nonzero allocations. Byte memcpy
    admits nonoverlapping regions only. No native allocator/OS behavior is implied.
    """

    def __init__(self, program, row):
        super().__init__(program, row)
        self.memory[0xA6009C] = int(
            program.receipt["stringImport"]["importTextTarget"], 16
        )
        self.copy_sizes, self.stack_probes = [], []
        # Explicit ordinary committed stack. Unknown heap/property bytes remain
        # unknown; these words exist only for the compiler's stack page probes.
        for at in range(self.registers["esp"] - 0x10000, self.registers["esp"], 4):
            self.memory.setdefault(at, 0)

    def allocate(self, size):
        assert type(size) is int and 0 <= size <= 0x1000000
        if size == 0:
            return 0
        ptr = self.next_block
        self.next_block += (size + 255) & ~255
        self.blocks[ptr] = size
        return ptr

    def reallocate(self, ptr, size):
        old_size = self.blocks[ptr] if ptr else 0
        new = self.allocate(size)
        for off in range(min(old_size, size)):
            cell = self.memory.get((ptr + off) & ~3)
            shift = ((ptr + off) & 3) * 8
            if (
                cell is None
                or isinstance(cell, PartialWord)
                and cell.mask & (255 << shift) != 255 << shift
            ):
                continue
            self.write(f"byte ptr [{new + off:#x}]", self.byte(ptr + off))
        self.free(ptr)
        return new

    def seed_string(self, header, value, spare=0, retained_empty=False):
        units = len(value.encode("utf-16le", errors="surrogatepass")) // 2
        count = units + 1 if value or retained_empty else 0
        capacity = count + spare
        data = self.allocate(capacity * 2)
        if count:
            self.put_text(data, value)
        self.memory.update({header: data, header + 4: count, header + 8: capacity})
        return data

    def string_state(self, header):
        data, count, capacity = [self.memory[header + n * 4] for n in range(3)]
        assert 0 <= count <= capacity
        return dict(
            value=self.text(data) if count else "", count=count, capacity=capacity
        )

    def step(self, i):
        sp = self.registers["esp"]
        if i.address == 0x1015C725:
            assert self.registers["edx"] == int(
                self.source.receipt["stringImport"]["importTextTarget"], 16
            )
            source, dest, port_flags = [self.memory[sp + n * 4] for n in range(3)]
            assert port_flags == 0
            self.imports.append(
                dict(
                    field=self.fields[self.registers["ecx"]],
                    offset=dest - self.actor,
                    text=self.text(source),
                    portFlags=port_flags,
                )
            )
            return MembershipMachine.step(self, i)
        if i.address == 0x10173B13:
            assert (
                not self.byte(self.registers["ebp"] + 0x10) & 2
            ), "quoted ImportText is outside this prefix"
        if i.address == 0x1017ED07:
            assert self.registers["eax"] % 4096 == 0
            self.stack_probes.append(self.registers["eax"])
        if i.address == 0x1011500F:
            assert i.op_str == "0x1017ac60"
            dest, source, size = [self.memory[sp + n * 4] for n in range(3)]
            assert 0 <= size <= 2048 and size % 2 == 0
            assert dest + size <= source or source + size <= dest
            assert dest in self.blocks and size <= self.blocks[dest]
            data = [self.byte(source + off) for off in range(size)]
            for off, value in enumerate(data):
                self.write(f"byte ptr [{dest+off:#x}]", value)
            self.copy_sizes.append(size)
            self.registers["eax"] = dest
        elif i.mnemonic == "neg":
            old = self.read(i.op_str) & 0xFFFFFFFF
            value = -old & 0xFFFFFFFF
            self.flags(value, old != 0, old == 0x80000000)
            self.write(i.op_str, value)
        elif i.mnemonic == "sbb":
            dest, source = i.op_str.split(", ")
            a, b = self.read(dest) & 0xFFFFFFFF, self.read(source) & 0xFFFFFFFF
            total = a - b - int(self.carry)
            value = total & 0xFFFFFFFF
            self.flags(value, total < 0, bool((a ^ b) & (a ^ value) & 0x80000000))
            self.write(dest, value)
        elif i.mnemonic == "not":
            self.write(i.op_str, ~self.read(i.op_str) & 0xFFFFFFFF)
        elif i.mnemonic == "xchg":
            a, b = i.op_str.split(", ")
            av, bv = self.read(a), self.read(b)
            self.write(a, bv)
            self.write(b, av)
        else:
            return super().step(i)
        self.visited.append(i.address)
        return i.address + i.size


class StringLoadingMachine(StringLocalizationMachine):
    """Reuse the byte heap; supply only archive reads/accounting and memcpy.

    Original instructions decode the compact count and load every character.
    Stable source storage and a successful, relocating allocator are explicit.
    """

    def __init__(self, program, row=None):
        super().__init__(program, next(fixture_rows()) if row is None else row)
        self.archive, self.cursor, self.payload = 0xD20000, 0, b""
        self.accounting, self.reads = [], []
        self.memory.update(
            {
                self.archive: 0xD21000,
                self.archive + 0x10: 1,
                self.archive + 0x14: 0,
                0xD21004: 0xD22000,
                0xD21014: 0xD22004,
            }
        )
        self.write("word ptr [0x101cdd44]", 0)
        self.initialization_copies, self.initialization_zeros = [], []
        self.resource_flag_writes, self.localization_entries = [], []
        self.default_initialization_calls = []

    def initialize(self, template, size, template_size):
        cls = self.memory[self.actor + 0x24]
        self.memory.update({cls + 0x4F4: template, cls + 0x4F8: template_size})
        props = list(self.fields)
        self.memory[cls + 0x78] = props[0] if props else 0
        for index, prop in enumerate(props):
            self.memory[prop + 0x60] = props[index + 1] if index + 1 < len(props) else 0
            table = self.memory[prop]
            self.memory[table + 0xA8] = 0x1010311B
            self.memory[table + 0xA4] = 0x10102A6D
        # Original cdecl entry; its caller owns these seven arguments.
        sp, link = self.registers["esp"], self.memory[0]
        for value in reversed((self.actor, size, cls, 0, 0, self.actor, 0)):
            self.push(value)
        self.push(0)
        self.execute_until(0x1015FB00)
        assert (
            self.registers["esp"] == sp - 28
            and self.memory[0] == link
            and not self.stack
        )
        self.registers["esp"] = sp

    def read(self, operand):
        if operand in ("al", "bl", "cl", "dl"):
            return self.registers["e" + operand[0] + "x"] & 255
        return super().read(operand)

    def write(self, operand, value, floating=False):
        if operand in ("al", "bl", "cl", "dl"):
            register = "e" + operand[0] + "x"
            self.registers[register] = (self.registers[register] & 0xFFFFFF00) | (
                value & 255
            )
            return
        return super().write(operand, value, floating)

    def stored_units(self, header):
        data, count = self.memory[header], self.memory[header + 4]
        return [self.read(f"word ptr [{data + i * 2:#x}]") for i in range(count)]

    def load(self, payload, header):
        self.payload, self.cursor = payload, 0
        self.invoke(0x1016F040, 0xD30000, (self.archive, header, len(payload)))
        assert self.cursor == len(payload)

    def step(self, i):
        sp = self.registers["esp"]
        op, args = i.mnemonic, i.op_str.split(", ")
        if i.address == 0x1015FB00:
            self.default_initialization_calls.append(
                [self.memory[sp + 4 + n * 4] for n in range(7)]
            )
        if i.address == 0x1012DA20:
            assert i.op_str == "0x1017b980"
            dest, value, size = [self.memory[sp + 4 + n * 4] for n in range(3)]
            assert dest == self.actor and value == 0 and size == 0x34
            for n in range(size):
                self.write(f"byte ptr [{dest + n:#x}]", 0)
            # Explicit CRT memset provider returns to its cdecl caller.
            self.registers["eax"] = dest
            self.visited.append(i.address)
            self.registers["esp"] += 4
            return self.memory[sp]
        if i.address in self.source.import_targets:
            # Dispatch qualified erased imports before the localization-only
            # interpreter's ordinary NOP handler can consume their first byte.
            return AdmissionMachine.step(self, i)
        if i.address == 0x1015F5E0:
            self.localization_entries.append(self.memory[self.actor + 0x1C])
        if i.address == 0x1010A214:
            target = self.registers["ecx"]
            nxt = super().step(i)
            self.resource_flag_writes.append(
                dict(identity=target, objectFlags=self.memory[target + 0x1C])
            )
            return nxt
        if i.address == 0x1015FBFF:
            assert i.op_str == "0x1017ac60"
            dest, source, size = [self.memory[sp + n * 4] for n in range(3)]
            assert 0 <= size <= 0x10000 and (
                dest + size <= source or source + size <= dest
            )
            values = [self.byte(source + n) for n in range(size)]
            for n, value in enumerate(values):
                self.write(f"byte ptr [{dest + n:#x}]", value)
            self.initialization_copies.append(size)
            self.registers["eax"] = dest
            self.visited.append(i.address)
            return i.address + i.size
        if i.address in (0x1015FB8A, 0x1015FC32):
            assert i.op_str == "0x101022e3"
            dest, size = self.memory[sp], self.memory[sp + 4]
            assert 0 <= size <= 0x10000
            for n in range(size):
                self.write(f"byte ptr [{dest + n:#x}]", 0)
            self.initialization_zeros.append(size)
            self.visited.append(i.address)
            return i.address + i.size
        if i.address == 0x101137F8:
            assert (
                self.registers["ecx"] == self.archive
                and self.read(i.op_str) == 0xD22004
            )
            self.accounting.append([self.memory[sp], self.memory[sp + 4]])
            self.registers["esp"] += 8
        elif i.address in (0x101307F3, 0x10130813):
            assert (
                self.registers["ecx"] == self.archive
                and self.read(i.op_str) == 0xD22000
            )
            dest, size = self.memory[sp], self.memory[sp + 4]
            assert size == (1 if i.address == 0x101307F3 else 2)
            end = self.cursor + size
            assert end <= len(self.payload), "archive payload exhausted"
            for index, value in enumerate(self.payload[self.cursor : end]):
                self.write(f"byte ptr [{dest + index:#x}]", value)
            self.reads.append(size)
            self.cursor = end
            self.registers["esp"] += 8
        elif i.address in (0x101753B6, 0x101753CF):
            assert i.op_str == "0x1017ac60"
            dest, source, size = [self.memory[sp + n * 4] for n in range(3)]
            assert size > 0 and size % 2 == 0
            assert size <= self.blocks[dest] and size <= self.blocks[source]
            assert dest + size <= source or source + size <= dest
            for index, value in enumerate([self.byte(source + n) for n in range(size)]):
                self.write(f"byte ptr [{dest + index:#x}]", value)
            self.copy_sizes.append(size)
            self.registers["eax"] = dest
        elif op == "movzx":
            self.write(args[0], self.read(args[1]))
        elif op in ("cmp", "test") and (
            args[0] in ("al", "bl", "cl", "dl", "ax", "cx", "dx")
            or args[0].startswith(("byte ptr", "word ptr"))
        ):
            width = 8 if args[0].endswith("l") or args[0].startswith("byte ptr") else 16
            mask, sign = (1 << width) - 1, 1 << (width - 1)
            a, b = self.read(args[0]) & mask, self.read(args[1]) & mask
            value = (a - b if op == "cmp" else a & b) & mask
            overflow = bool((a ^ b) & (a ^ value) & sign) if op == "cmp" else False
            self.zero, self.sign = value == 0, bool(value & sign)
            self.less, self.carry = self.sign != overflow, (
                a < b if op == "cmp" else False
            )
            self.parity = bin(value & 255).count("1") % 2 == 0
        elif op == "setge":
            self.write(args[0], int(not self.less))
        elif op == "jns":
            self.visited.append(i.address)
            return i.address + i.size if self.sign else int(args[0], 16)
        else:
            return super().step(i)
        self.visited.append(i.address)
        return i.address + i.size


def string_loading_cases(program):
    # Authored wire vectors, including the boundaries of compact continuation,
    # byte values above 127, embedded NUL storage and unmatched UTF-16 units.
    wires = [
        b"\0",
        b"\x80",
        b"\x40\0",
        b"\x40\x80\x80\x80\0",
        b"\x01\0",
        b"\x01Z",
        b"\x81\0\0",
        b"\x81Z\0",
        b"\x04a\0z\0",
        b"\x03\x80\xff\0",
        b"\x82\0\xd8\0\0",
        b"\x82\xff\xdf\0\0",
        b"\x83\x3c\xd8\x0a\xdf\0\0",
    ]
    for count in (63, 64, 65, 8191, 8192):
        for wide in (False, True):
            units = ([0x6C34] if wide else [0xE9]) * (count - 1) + [0]
            wires.append(
                encode_compact(-count if wide else count)
                + b"".join(n.to_bytes(2 if wide else 1, "little") for n in units)
            )
    cases, steps, copies, aliases, reads, visited = 0, 0, 0, 0, 0, set()
    for payload in wires:
        expected = decode_string_property(payload)
        for old, retained in (("", False), ("previous / 水", False), ("", True)):
            m = StringLoadingMachine(program)
            header, dest = 0xD00000, 0xD00100
            m.seed_string(header, old, spare=3, retained_empty=retained)
            previous_count = m.memory[header + 4]
            guards = {header - 4: 0x1234ABCD, header + 12: 0xABCD1234}
            m.memory.update(guards)
            m.registers.update(
                ebx=0xCAFE1234, esi=0xBEEF5678, edi=0x12345678, ebp=0x87654321
            )
            preserved = {key: m.registers[key] for key in ("ebx", "esi", "edi", "ebp")}
            m.load(payload, header)
            assert {key: m.registers[key] for key in preserved} == preserved
            assert {key: m.memory[key] for key in guards} == guards
            assert m.accounting == [[previous_count * 2, (previous_count + 3) * 2]]
            assert m.stored_units(header) == expected["codeUnits"]
            assert m.memory[header + 4] == m.memory[header + 8] == expected["count"]
            m.seed_string(dest, "other allocation", spare=5)
            before = [m.memory[header + i * 4] for i in range(3)]
            m.invoke(0x10175380, 0xD30000, (dest, header, 0))
            assert [m.memory[header + i * 4] for i in range(3)] == before
            assert (
                m.stored_units(dest) == m.stored_units(header) == expected["codeUnits"]
            )
            assert m.memory[dest + 4] == m.memory[dest + 8] == expected["count"]
            events = list(m.events)
            m.invoke(0x10175380, 0xD30000, (header, header, 0))
            assert (
                m.events == events
                and [m.memory[header + i * 4] for i in range(3)] == before
            )
            assert {key: m.registers[key] for key in preserved} == preserved
            cases += 1
            aliases += 1
            copies += len(m.copy_sizes)
            reads += len(m.reads)
            steps += len(m.visited)
            visited.update(m.visited)
    return dict(
        cases=cases,
        instructions=steps,
        uniqueInstructions=len(visited),
        archiveReads=reads,
        byteCopies=copies,
        sameHeaderNoOps=aliases,
        storageUnitsCompared=True,
        nonvolatileRegistersPreserved=True,
        scope="Original SerializeItem/compact/FString loading plus CopySingleValue; supplied archive/allocator and terminated values. No live class initialization claimed.",
    )


def original_string_loading_cases(program):
    """Compare decoded saved defaults with native load/copy, not a CDO lifecycle."""
    sys.path.insert(0, str(ROOT / "tools/world"))
    from inspect_actor_declarations import DEFAULT_CLASSES, inspect_declarations

    report = inspect_declarations(DEFAULT_CLASSES, include_string_defaults=True)
    m = StringLoadingMachine(program)
    storage, tags, copied = {}, 0, 0
    for index, (key, row) in enumerate(report["classes"].items()):
        current = {}
        parent = storage.get((row["savedSuper"] or "").casefold(), {})
        for slot, original in parent.items():
            dest = 0xE00000 + index * 0x1000 + len(current) * 16
            m.seed_string(dest, "authored overwritten storage", spare=3)
            m.invoke(0x10175380, 0xD30000, (dest, original, 0))
            current[slot] = dest
            copied += 1
        for tag in row["savedStringTags"]:
            slot = tag["name"].casefold() + ":" + str(tag["index"])
            if slot not in current:
                current[slot] = 0xE00000 + index * 0x1000 + len(current) * 16
                m.seed_string(current[slot], "authored prior storage")
            payload = bytes.fromhex(tag["payloadHex"])
            assert hashlib.sha256(payload).hexdigest() == tag["payloadSHA256"]
            m.load(payload, current[slot])
            tags += 1
        assert set(current) == set(row["savedStringDefaults"])
        for slot, header in current.items():
            expected = row["savedStringDefaults"][slot]
            assert m.stored_units(header) == expected["codeUnits"]
            assert m.memory[header + 4] == m.memory[header + 8] == expected["count"]
        storage[key] = current
    return dict(
        classes=len(storage),
        classesWithSavedStrings=sum(bool(v) for v in storage.values()),
        ownTags=tags,
        inheritedCopies=copied,
        instructions=len(m.visited),
        uniqueInstructions=len(set(m.visited)),
        sources=report["sources"],
        scope="Known saved string overlays compared with original SerializeItem and CopySingleValue. Supplied ordering/headers; untagged initial values, native property acceptance and the complete class lifecycle remain unknown.",
    )


def actor_string_startup_cases(program, runtime):
    """Join original default copy, Volume construction and localized PostLoad.

    Current class/reflection/CDO/configuration are explicit authored providers.
    This neither builds full reflection lists nor chooses live class flags.
    """
    rows, expected, visited = [], [], set()
    steps = deep_copies = invocations = 0
    native_fields = [
        dict(identity="Title", name="Title", offset=0x424, arrayDim=1),
        dict(identity="Captions", name="Captions", offset=0x430, arrayDim=2),
        dict(identity="NewTail", name="NewTail", offset=0x450, arrayDim=1),
    ]
    fields = [
        dict(f, isProperty=True, propertyFlags=0x8000, elementSize=12, struct=None)
        for f in native_fields
    ]
    layout = [dict(f, kind="StrProperty", elementSize=12) for f in native_fields]
    values = [
        [0x424, "default / 水"],
        [0x430, "embedded\0retained"],
        [0x43C, "\ud800"],
        [0x450, "tail default"],
    ]
    for index in range(192):
        object_flags = 0x100 if index % 2 else 0
        class_flags = 0x32 if index % 4 < 2 else 0x12
        row = dict(
            object=dict(
                index=3,
                flags=object_flags,
                name="Placed",
                outer=dict(name="Outer", outer=dict(name="Map", outer=None)),
            ),
            classInfo=dict(
                flags=class_flags,
                name="ExampleVolume",
                outer=dict(name="Engine", outer=None),
                structure=dict(fields=fields, super=None),
            ),
            isEditor=index % 8 >= 4,
            environment=dict(started=True, configAbsent=False, language="es"),
            policy=["hit", "missing", "empty", "english", "write-on-miss", "unicode"][
                (index // 8) % 6
            ],
            scratchCounter=254,
        )
        m = StringLoadingMachine(program, row)
        actor, template, size = m.actor, 0xE10000, 0x480
        default_size = [0, 0x450, size][(index // 48) % 3]
        header = {
            at: value for at, value in m.memory.items() if actor <= at < actor + 0x34
        }
        for off in range(0x34, size, 4):
            m.memory[actor + off] = 0xA5A5A5A5
            m.memory[template + off] = 0x5A5A5A5A
        for offset, value in values:
            m.seed_string(template + offset, value, spare=3)
        before = {
            at: value
            for at, value in m.memory.items()
            if template + 0x34 <= at < template + size
        }
        preserved = {reg: m.registers[reg] for reg in ("ebx", "esi", "edi", "ebp")}
        m.initialize(template if default_size else 0, size, default_size)
        assert {reg: m.registers[reg] for reg in preserved} == preserved
        assert {at: m.memory[at] for at in header} == header

        # Initialization itself installs the explicitly supplied copy-list links;
        # only template bytes/allocations are compared below, not that metadata.
        def stored():
            return [
                [
                    off,
                    b"".join(
                        n.to_bytes(2, "little")
                        for n in m.stored_units(actor + off)[:-1]
                    ).decode("utf-16le", errors="surrogatepass"),
                ]
                for off, _ in values
            ]

        initialized = stored()
        for iat, address in program.receipt["actorStartup"]["actor"][
            "actorCounters"
        ].items():
            m.memory[int(iat, 16)] = address
            m.memory[address] = 0
        m.memory.update({0x103307E8: 0, 0x103307EC: 0, 0x103307F0: 0})
        m.invoke(0x103D3B50, actor)
        assert stored() == initialized
        # Current non-string payload fields are explicit supplied state; this
        # join does not execute all actor tags, arrays or reference resolution.
        model, polys = 0xD80000, 0xD90000
        reference_mode = (index // 8) % 4
        brush = model if reference_mode else 0
        poly = (0, 0, polys, model)[reference_mode]
        rotation = [index, -index, 32768]
        word = 0xA5A50000 | index
        m.memory.update(
            {
                actor + 0x278: brush,
                actor + 0x1F4: 0,
                actor + 0x5C: word,
                model + 0x1C: 0x40,
                model + 0x60: poly,
                polys + 0x1C: 0x80,
            }
        )
        for n, value in enumerate(rotation):
            m.memory[actor + 0x1C8 + n * 4] = value & 0xFFFFFFFF
        m.invoke(0x1052FDD0, actor)
        assert {reg: m.registers[reg] for reg in preserved} == preserved
        assert {
            at: m.memory[at] for at in before if template + 0x34 <= at < template + size
        } == {
            at: v for at, v in before.items() if template + 0x34 <= at < template + size
        }
        for off, value in values:
            units = m.stored_units(template + off)
            assert (
                b"".join(n.to_bytes(2, "little") for n in units[:-1]).decode(
                    "utf-16le", errors="surrogatepass"
                )
                == value
            )
        calls = int(bool(object_flags & 0x100)) + int(bool(class_flags & 0x20))
        assert len(m.localization_entries) == calls
        assert m.localization_entries == [object_flags | 0x20000000] * calls
        rows.append(
            row
            | dict(
                initialization=dict(
                    size=size, defaultSize=default_size, fields=layout, defaults=values
                ),
                objectFlags=object_flags,
                classFlags=class_flags,
                brushReference=brush or None,
                attachedCount=0,
                rotation=rotation,
                flags5c=dict(mask=0xFFFFFFFF, value=word),
                objects=[
                    [model, dict(objectFlags=0x40, polysReference=poly or None)],
                    [polys, dict(objectFlags=0x80)],
                ],
            )
        )
        expected.append(
            dict(
                status="ready",
                initialized=initialized,
                storage=stored(),
                localizationCalls=calls,
                contexts=m.contexts,
                imports=m.imports,
                lookups=m.lookups,
                writes=dict(
                    objectFlags=m.memory[actor + 0x1C],
                    resourceFlags=m.resource_flag_writes,
                    swayRotationOrig=rotation,
                    flags5c=dict(mask=0xFFFFFFFF, value=word | 0x40),
                ),
            )
        )
        steps += len(m.visited)
        visited.update(m.visited)
        deep_copies += len(m.copy_sizes)
        invocations += calls
    script = r"""
const {importStringPropertyText}=await import(process.argv[1]);
const {initializeActorStringProperties,postLoadBrushActor}=await import(new URL('./actor-loading.js',process.argv[1]));
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
let raw='';for await(const part of process.stdin)raw+=part;
process.stdout.write(JSON.stringify(JSON.parse(raw).map(row=>{
 const initialized=initializeActorStringProperties({...row.initialization,defaults:new Map(row.initialization.defaults)});
 if(initialized.status!=='ready')throw Error(JSON.stringify(initialized));
 const storage=new Map(initialized.values),lookups=[];
 const readConfig=call=>{lookups.push(call);let found=false,value=null;
 switch(row.policy){case 'hit':found=true;value='text:'+call.key;break;case 'empty':found=true;value='';break;
 case 'english':found=call.filename.endsWith('.int');value=found?'fallback':null;break;
 case 'write-on-miss':value=call.filename.endsWith('.int')?null:'partial';break;
 case 'unicode':found=true;value='Café / 水 / 🌊';break;}return {status:'ready',found,value};};
 const result=postLoadBrushActor({...row,objects:new Map(row.objects),localization:{...row,
 classInfo:{...row.classInfo,structure:freeze(row.classInfo.structure)},environment:{...row.environment,readConfig},
 importText:call=>importStringPropertyText({...call,storage,propertyKind:'StrProperty'})}});
 const runs=result.localizationRuns??[];
 return {status:result.status,initialized:initialized.values,storage:[...storage],localizationCalls:runs.length,
 contexts:runs.filter(r=>!r.context.skipped).map(r=>{const{status,skipped,...c}=r.context;return c;}),
 imports:runs.flatMap(r=>r.imports),lookups,writes:result.writes};
})));
"""
    actual = browser_outputs(script, rows, runtime)
    for index, (a, b) in enumerate(zip(actual, expected)):
        assert a == b, ("localized actor startup", index, a, b)
    assert len(actual) == len(expected)
    return dict(
        cases=len(rows),
        instructions=steps,
        uniqueInstructions=len(visited),
        deepCopies=deep_copies,
        localizationInvocations=invocations,
        defaultStoragePreserved=True,
        browserCompared=True,
        scope="Original InitProperties with a supplied string-only copy list, Volume construction and Brush/Actor/Object PostLoad joined to original localization. Current class/CDO/configuration and non-string payload fields remain explicit providers; not live map startup.",
    )


def config_gate_case(program, flags, *, explicit_class=False, other_flags=4):
    """Run only the original gate; enabled classes stop before config work."""
    m = StringLoadingMachine(program)
    cls = m.memory[m.actor + 0x24]
    selected = m.allocate(0x500) if explicit_class else cls
    m.memory[cls + 0x4A4] = other_flags
    m.memory[selected + 0x4A4] = flags
    m.memory.pop(selected + 0x34, None)
    # Deliberately unreadable parent/filename: neither may be used on the skip.
    args = (0xFFFFFFFF, selected if explicit_class else 0, 0xDEADBEEF)
    preserved = {r: m.registers[r] for r in ("ebx", "esi", "edi", "ebp")}
    before = {at: v for at, v in m.memory.items() if at >= m.actor}
    sp, link = m.registers["esp"], m.memory[0]
    for value in reversed(args):
        m.push(value)
    m.push(0)
    m.registers["ecx"] = m.actor
    pc = 0x10166740
    for _ in range(100):
        if pc is None or pc == 0x1016678C:
            break
        pc = m.step(m.program[pc])
    else:
        raise AssertionError("configuration gate did not stop")
    enabled = pc == 0x1016678C
    assert enabled == bool(flags & 4)
    if not enabled:
        assert m.registers["esp"] == sp and m.memory[0] == link and not m.stack
        assert {r: m.registers[r] for r in preserved} == preserved
    assert not m.lookups and not m.imports
    # Exclude the interpreter's authored stack, whose frame is expected to change.
    assert {at: m.memory[at] for at in before if not sp - 0xB00 <= at <= sp} == {
        at: v for at, v in before.items() if not sp - 0xB00 <= at <= sp
    }
    return m.visited, enabled


def config_gate_cases(program):
    visited, steps, enabled = set(), 0, 0
    count = 0
    for low in range(256):
        for high in (0, 0x80000000, 0xFFFF0000):
            for explicit in (False, True):
                trace, result = config_gate_case(
                    program, high | low, explicit_class=explicit, other_flags=low ^ 4
                )
                count += 1
                enabled += int(result)
                steps += len(trace)
                visited.update(trace)
    return dict(
        cases=count,
        instructions=steps,
        uniqueInstructions=len(visited),
        skipped=count - enabled,
        enabledContinuations=enabled,
        configCalls=0,
        skippedStatePreserved=True,
        scope="Original LoadConfig entry/bit-4 test. Null ConfigClass selects object.Class; explicit ConfigClass overrides it. Enabled classes stop before further work; no configuration parser is modeled.",
    )


def class_default_string_cases(program, runtime):
    """Original CDO initializer with authored string-only parent copy lists.

    Compare its string projection to the existing browser initializer. All 13
    header words, untouched parent data and copied/zeroed nonstring bytes are
    checked separately. This is not a full default-property deserializer.
    """
    fields = [
        dict(
            identity=name,
            name=name,
            offset=offset,
            arrayDim=dim,
            elementSize=12,
            isProperty=True,
            propertyFlags=0x8000,
            struct=None,
        )
        for name, offset, dim in (
            ("Title", 0x40, 1),
            ("Captions", 0x4C, 2),
            ("Tail", 0x70, 1),
        )
    ]
    values = [
        [0x40, "parent / 水"],
        [0x4C, "embedded\0tail"],
        [0x58, "\ud800"],
        [0x70, "last"],
    ]
    layout = [dict(f, kind="StrProperty") for f in fields]
    rows, expected, visited = [], [], set()
    steps = deep_copies = 0
    for parent_mode in range(5):
        for outer_arg in (0, 1, 2, 0xFFFFFFFF):
            for initial_byte in (0, 0xA5, 0xFF):
                row = dict(
                    object=dict(
                        index=37, flags=0xFFFFFFFF, name="NotTheClass", outer=None
                    ),
                    classInfo=dict(
                        flags=0x32,
                        name="Example",
                        outer=dict(name="Package", outer=None),
                        structure=dict(fields=fields, super=None),
                    ),
                    isEditor=False,
                    environment=dict(started=True, configAbsent=False, language="int"),
                    policy="missing",
                    scratchCounter=0,
                )
                m = StringLoadingMachine(program, row)
                cls = m.memory[m.actor + 0x24]
                outer, table = m.memory[cls + 0x18], m.memory[cls]
                parent = m.allocate(0x500) if parent_mode else 0
                size, template = 0x80, 0xE10000
                default_size = (0, 0, 0x34, 0x70, size)[parent_mode]
                m.memory[cls + 0x34] = parent
                m.memory[cls + 0x4C] = size
                m.memory[table + 0x78] = 0x10102199
                if parent:
                    m.memory.update(
                        {
                            parent + 0x4F4: template if default_size else 0,
                            parent + 0x4F8: default_size,
                        }
                    )
                    props = [p for p in m.fields if m.memory[p + 0x54] < default_size]
                    m.memory[parent + 0x78] = props[0] if props else 0
                    for index, prop in enumerate(props):
                        m.memory[prop + 0x60] = (
                            props[index + 1] if index + 1 < len(props) else 0
                        )
                        pt = m.memory[prop]
                        m.memory[pt + 0xA8] = 0x1010311B
                        m.memory[pt + 0xA4] = 0x10102A6D
                for offset in range(0, size, 4):
                    m.memory[m.actor + offset] = initial_byte * 0x01010101
                    m.memory[template + offset] = 0x5A5A5A5A
                for offset, value in values:
                    m.seed_string(template + offset, value, spare=3)
                source_before = [m.byte(template + n) for n in range(size)]
                preserved = {r: m.registers[r] for r in ("ebx", "esi", "edi", "ebp")}
                m.invoke(0x1015FE10, m.actor, (cls, outer_arg))
                assert m.default_initialization_calls == [
                    [m.actor, size, parent, 0, 0, m.actor if outer_arg else 0, 0]
                ]
                header = [0] * 13
                header[0], header[1], header[9], header[10] = (
                    table,
                    0xFFFFFFFF,
                    cls,
                    0xFFFFFFFF,
                )
                header[6] = outer if outer_arg else 0
                assert [m.memory[m.actor + n * 4] for n in range(13)] == header
                assert {r: m.registers[r] for r in preserved} == preserved
                assert [m.byte(template + n) for n in range(size)] == source_before
                string_bytes = {n for off, _ in values for n in range(off, off + 12)}
                for offset in range(0x34, size):
                    if offset not in string_bytes:
                        assert m.byte(m.actor + offset) == (
                            0x5A if offset < default_size else 0
                        )
                actual_values = []
                for off, original in values:
                    units = m.stored_units(m.actor + off)
                    value = b"".join(
                        n.to_bytes(2, "little") for n in units[:-1]
                    ).decode("utf-16le", errors="surrogatepass")
                    actual_values.append([off, value])
                    if off < default_size:
                        assert m.memory[m.actor + off] != m.memory[template + off]
                    assert (
                        b"".join(
                            n.to_bytes(2, "little")
                            for n in m.stored_units(template + off)[:-1]
                        ).decode("utf-16le", errors="surrogatepass")
                        == original
                    )
                # Both real CDO call sites use these three zero arguments.
                m.invoke(0x10166740, m.actor, (0, 0, 0))
                assert not m.lookups and not m.imports
                rows.append(
                    dict(
                        size=size,
                        defaultSize=default_size,
                        fields=layout,
                        defaults=values,
                    )
                )
                expected.append(actual_values)
                steps += len(m.visited)
                visited.update(m.visited)
                deep_copies += len(m.copy_sizes)
    script = r"""
const {initializeActorStringProperties}=await import(new URL('./actor-loading.js',process.argv[1]));
let raw='';for await(const part of process.stdin)raw+=part;
process.stdout.write(JSON.stringify(JSON.parse(raw).map(row=>{
 const result=initializeActorStringProperties({...row,defaults:new Map(row.defaults)});
 if(result.status!=='ready')throw Error(JSON.stringify(result));return result.values;
})));
"""
    assert browser_outputs(script, rows, runtime) == expected
    return dict(
        cases=len(rows),
        instructions=steps,
        uniqueInstructions=len(visited),
        deepCopies=deep_copies,
        headerWordsChecked=13,
        parentStoragePreserved=True,
        browserStringProjectionCompared=True,
        scope="Original InitClassDefaultObject and InitProperties joined to the nonconfig return. Authored current classes and string-only parent copy lists; all header words and scalar copy/zero bytes checked. No array/object deep-copy, tagged-property, localization or full class lifecycle claim.",
    )


def original_default_config_cases(program, core, comparison, engine, comparison_engine):
    from l2lib import load_package
    from static_mesh_class_source import class_default_config_bits, qualify_registration

    binding = qualify_registration(engine, core, comparison_engine, comparison)
    root = ROOT / "assets/interlude/system"
    source = class_default_config_bits(
        engine,
        core,
        *[
            load_package(root / name)[0]
            for name in ("Engine.u", "Core.u", "GamePlay.u")
        ],
    )
    visited, steps, count = set(), 0, 0
    for row in source["records"].values():
        for flags in row["evidence"]["variants"]:
            for explicit in (False, True):
                trace, enabled = config_gate_case(
                    program, flags, explicit_class=explicit
                )
                assert not enabled
                count += 1
                steps += len(trace)
                visited.update(trace)
    program.receipt["defaultConfigSource"] = dict(binding=binding, flags=source)
    return dict(
        classes=len(source["records"]),
        cases=count,
        instructions=steps,
        uniqueInstructions=len(visited),
        allSkipped=True,
        scope="Eight pinned source class profiles, including inherited variants, reach the original nonconfig return. Registration/serialization correspondence is qualified; complete live class loading and external mutations are not simulated.",
    )


def fixture_rows():
    def field(identity, offset, **changes):
        return (
            dict(
                identity=identity,
                name=identity,
                offset=offset,
                arrayDim=1,
                elementSize=12,
                propertyFlags=0x8000,
                isProperty=True,
                struct=None,
            )
            | changes
        )

    nested = dict(
        fields=[field("Caption", 4), field("Ignored", 20, propertyFlags=0)], super=None
    )
    parent = dict(fields=[field("Inherited", 0x180)], super=None)
    structure = dict(
        fields=[
            dict(isProperty=False),
            field("Zero", 0, arrayDim=0),
            field("Negative", 0, arrayDim=-1),
            field("Plain", 0x30),
            field(
                "Nested",
                0x60,
                arrayDim=2,
                elementSize=0x30,
                struct=nested,
                propertyFlags=0,
            ),
            field("Array", 0x100, arrayDim=3),
        ],
        super=parent,
    )
    for case in range(144):
        policy = ["hit", "empty", "english", "write-on-miss", "unicode", "missing"][
            case % 6
        ]
        mode = (case // 6) % 6
        obj = dict(
            index=-1 if mode == 0 else 3,
            flags=0x100 if mode in (2, 3, 4) else 0,
            name="" if mode == 4 else "Placed",
            outer=dict(name="Outer", outer=None),
        )
        if mode in (2, 4):
            obj["outer"]["outer"] = dict(name="Map", outer=None)
        row = dict(
            object=obj,
            classInfo=dict(
                flags=0x12 if mode == 5 else 0x32,
                name="Volume",
                outer=dict(name="Engine", outer=None),
                structure=structure,
            ),
            isEditor=case >= 138,
            environment=dict(
                started=not 72 <= case < 108,
                configAbsent=108 <= case < 120,
                language="INT" if 36 <= case < 72 else "es",
            ),
            policy=policy,
            scratchCounter=[0, 254, 0xFFFFFFFF][case % 3],
        )
        yield row
    # More than 256 scratch allocations: ordinary sequential reuse is legal.
    yield row | dict(
        isEditor=False,
        policy="hit",
        environment=dict(started=True, configAbsent=False, language="es"),
        classInfo=row["classInfo"]
        | dict(
            flags=0x32,
            structure=dict(fields=[field("Repeated", 0x100, arrayDim=300)], super=None),
        ),
    )


SCRIPT = r"""
const {loadActorLocalized,importStringPropertyText}=await import(process.argv[1]);
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
let raw='';for await(const part of process.stdin)raw+=part;
process.stdout.write(JSON.stringify(JSON.parse(raw).map(row=>{
 const lookups=[];
 const environment={...row.environment,readConfig:row.environment.configAbsent?null:call=>{
   lookups.push(call);let found=false,value=null;
   switch(row.policy){
    case 'hit':found=true;value='text:'+call.key;break;
    case 'empty':found=true;value='';break;
    case 'english':found=call.filename.endsWith('.int');value=found?'fallback':null;break;
    case 'write-on-miss':value=call.filename.endsWith('.int')?null:'partial';break;
    case 'unicode':found=true;value='Café / 水 / 🌊';break;
   }
   return {status:'ready',found,value};
 }};
 freeze(row.classInfo.structure);
 const storage=row.storage?new Map(row.storage):null;
 const importText=storage?call=>importStringPropertyText({...call,storage,propertyKind:'StrProperty'}):()=>({status:'ready'});
 const result=loadActorLocalized({...row,environment,importText});
 return {status:result.status,context:result.context,imports:result.imports,lookups,...(storage?{storage:[...storage]}:{})};
})));
"""


def string_slots(structure, base=0):
    """Allocate authored storage from the supplied fixture, not game metadata."""
    result = []
    while structure is not None:
        for field in structure["fields"]:
            if not field["isProperty"]:
                continue
            for index in range(field["arrayDim"]):
                offset = base + field["offset"] + index * field["elementSize"]
                if field["struct"] is not None:
                    result.extend(string_slots(field["struct"], offset))
                else:
                    result.append(offset)
        structure = structure["super"]
    return result


def string_localization_cases(program, runtime):
    rows, expected, visited = [], [], set()
    steps = copies = probes = imported = 0
    for index, row in enumerate(fixture_rows()):
        machine = StringLocalizationMachine(program, row)
        offsets = sorted(string_slots(row["classInfo"]["structure"]))
        assert all(b >= a + 12 for a, b in zip(offsets, offsets[1:]))
        meta_end = machine.next_block
        metadata = {
            at: value
            for at, value in machine.memory.items()
            if 0x2000000 <= at < meta_end
        }
        row = row | dict(storage=[])
        for off in offsets:
            value = "" if index % 3 == 0 else f"saved:{off} / \U0001f30a"
            machine.seed_string(machine.actor + off, value, spare=index % 4)
            row["storage"].append([off, value])
        machine.invoke(0x1015F5E0, machine.actor)
        assert {at: machine.memory[at] for at in metadata} == metadata
        context = (
            dict(status="ready", skipped=False, **machine.contexts[0])
            if machine.contexts
            else dict(status="ready", skipped=True)
        )
        storage = [
            [off, machine.string_state(machine.actor + off)["value"]] for off in offsets
        ]
        expected.append(
            dict(
                status="ready",
                context=context,
                imports=machine.imports,
                lookups=machine.lookups,
                storage=storage,
            )
        )
        rows.append(row)
        steps += len(machine.visited)
        visited.update(machine.visited)
        copies += len(machine.copy_sizes)
        probes += len(machine.stack_probes)
        imported += len(machine.imports)
        for call in machine.imports:
            state = machine.string_state(machine.actor + call["offset"])
            assert (
                state["count"]
                == state["capacity"]
                == len(state["value"].encode("utf-16le")) // 2 + 1
            )
    actual = browser_outputs(SCRIPT, rows, runtime)
    assert len(actual) == len(expected)
    for index, (a, b) in enumerate(zip(actual, expected)):
        assert a == b, ("joined string localization", index, a, b)
    return dict(
        cases=len(rows),
        instructions=steps,
        uniqueInstructions=len(visited),
        imports=imported,
        byteCopies=copies,
        stackPageProbes=probes,
        browserValuesCompared=True,
        scope="Original localization joined to original string ImportText; authored current storage and successful allocator/memcpy providers.",
    )


def string_assignment_cases(program, runtime):
    inputs = [
        "",
        "a",
        "ab",
        " keep spaces ",
        '"quotes" \\ path',
        "Café / 水 / \U0001f30a",
        "before\0ignored",
        "\ud800",
        "\udfff",
        "z" * 1023,
    ]
    row = next(fixture_rows())
    rows, expected, visited = [], [], set()
    steps = aliases = clears = probes = 0
    for value in inputs:
        for same_buffer in (False, True):
            if same_buffer and "\0" in value:
                continue
            for flags in (0, 1, 4, 0xFFFFFFFD):
                m = StringLocalizationMachine(program, row)
                header = 0xD00000
                old = value if same_buffer else "previous value"
                pointer = m.seed_string(header, old, spare=3, retained_empty=True)
                before = [m.memory[header + n * 4] for n in range(3)]
                if same_buffer:
                    source = pointer
                else:
                    source = m.allocate(
                        len(value.encode("utf-16le", errors="surrogatepass")) + 2
                    )
                    m.put_text(source, value)
                source_bytes = [
                    m.byte(source + i)
                    for i in range(
                        len(value.encode("utf-16le", errors="surrogatepass")) + 2
                    )
                ]
                m.memory.update({header - 4: 0xCAFE1234, header + 12: 0x5678BEEF})
                m.registers.update(
                    ebx=0x12345678, esi=0xAABBCCDD, edi=0x55667788, ebp=0xAAAABBBB
                )
                preserved = {
                    reg: m.registers[reg] for reg in ("ebx", "esi", "edi", "ebp")
                }
                m.invoke(0x10173AE0, 0xD10000, [source, header, flags])
                assert m.registers["eax"] == source
                assert {reg: m.registers[reg] for reg in preserved} == preserved
                assert (
                    m.memory[header - 4] == 0xCAFE1234
                    and m.memory[header + 12] == 0x5678BEEF
                )
                assert [
                    m.byte(source + i) for i in range(len(source_bytes))
                ] == source_bytes
                state = m.string_state(header)
                if same_buffer:
                    assert [m.memory[header + n * 4] for n in range(3)] == before
                    assert not m.events and not m.copy_sizes
                    aliases += 1
                else:
                    units = (
                        len(state["value"].encode("utf-16le", errors="surrogatepass"))
                        // 2
                    )
                    assert (
                        state["count"]
                        == state["capacity"]
                        == (units + 1 if units else 0)
                    )
                    assert [
                        event[1] for event in m.events if event[0] == "reallocate"
                    ] == [state["count"] * 2]
                    if not units:
                        assert m.memory[header] == 0 and not m.copy_sizes
                        clears += 1
                rows.append(dict(text=value, portFlags=flags, old=old))
                expected.append(dict(status="ready", value=state["value"]))
                steps += len(m.visited)
                visited.update(m.visited)
                probes += len(m.stack_probes)
    script = r"""
const {importStringPropertyText}=await import(process.argv[1]);
let raw='';for await(const part of process.stdin)raw+=part;
process.stdout.write(JSON.stringify(JSON.parse(raw).map(row=>{
 const storage=new Map([[0,row.old]]);
 const result=importStringPropertyText({...row,storage,offset:0,propertyKind:'StrProperty'});
 if(storage.get(0)!==result.value)throw Error('string storage not updated');
 return result;
})));
"""
    actual = browser_outputs(script, rows, runtime)
    assert actual == expected
    return dict(
        cases=len(rows),
        sameBufferCases=aliases,
        emptyReleases=clears,
        instructions=steps,
        uniqueInstructions=len(visited),
        stackPageProbes=probes,
        browserValuesCompared=True,
        inputPointerReturned=True,
        guardsAndSourceBytesPreserved=True,
        scope="Unquoted string value semantics; native count/capacity/pointer behavior checked separately from browser immutable strings.",
    )


def verify(
    core,
    comparison,
    runtime,
    *,
    original_strings=False,
    original_config=False,
    engine=None,
    comparison_engine=None,
):
    if original_config and engine is None:
        raise ValueError("original configuration gates require the Engine comparison")
    program = source_program(core, comparison, engine, comparison_engine)
    rows, expected, visited, steps = [], [], set(), 0
    for row in fixture_rows():
        machine = LocalizationMachine(program, row)
        machine.registers.update(
            ebx=0x12345678, esi=0xABCD0123, edi=0x98765432, ebp=0x6789ABCD
        )
        metadata = {
            at: value
            for at, value in machine.memory.items()
            if machine.actor <= at < machine.actor + 0x500
            or 0x2000000 <= at < machine.next_block
        }
        preserved = {
            reg: machine.registers[reg] for reg in ("ebx", "esi", "edi", "ebp")
        }
        machine.invoke(0x1015F5E0, machine.actor)
        assert {reg: machine.registers[reg] for reg in preserved} == preserved
        assert {at: machine.memory[at] for at in metadata} == metadata
        context = (
            dict(status="ready", skipped=False, **machine.contexts[0])
            if machine.contexts
            else dict(status="ready", skipped=True)
        )
        expected.append(
            dict(
                status="ready",
                context=context,
                imports=machine.imports,
                lookups=machine.lookups,
            )
        )
        rows.append(row)
        steps += len(machine.visited)
        visited.update(machine.visited)
    actual = browser_outputs(SCRIPT, rows, runtime)
    assert len(actual) == len(expected)
    for index, (a, b) in enumerate(zip(actual, expected)):
        assert a == b, (index, a, b)
    assignment = string_assignment_cases(program, runtime)
    joined_strings = string_localization_cases(program, runtime)
    loading = string_loading_cases(program)
    original = original_string_loading_cases(program) if original_strings else None
    startup = (
        actor_string_startup_cases(program, runtime) if engine is not None else None
    )
    source_config = (
        original_default_config_cases(
            program, core, comparison, engine, comparison_engine
        )
        if original_config
        else None
    )
    return dict(
        tool="Elbera Tools",
        status="pass",
        scope="original-actor-localization-control-flow",
        cases=len(rows),
        instructions=steps,
        uniqueInstructions=len(visited),
        imports=sum(len(row["imports"]) for row in expected),
        lookups=sum(len(row["lookups"]) for row in expected),
        browserCompared=True,
        nonvolatileRegistersPreserved=True,
        suppliedMetadataPreserved=True,
        stringAssignment=assignment,
        localizedStringStorage=joined_strings,
        savedStringLoading=loading,
        originalSavedStrings=original,
        actorStringStartup=startup,
        configGate=config_gate_cases(program),
        classDefaultStrings=class_default_string_cases(program, runtime),
        originalDefaultConfig=source_config,
        source=program.receipt,
        sourceSHA256={
            str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (
                Path(__file__).resolve(),
                Path(__file__).with_name("actor_localization_source.py").resolve(),
                runtime.resolve(),
                runtime.resolve().with_name("actor-loading.js"),
                ROOT / "tools/l2lib/stringproperty.py",
                ROOT / "tools/world/inspect_actor_declarations.py",
                ROOT / "tools/ui/static_mesh_class_source.py",
            )
        },
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--core", type=Path, default=ROOT / "assets/interlude/system/Core.dll"
    )
    parser.add_argument("--comparison-core", type=Path, required=True)
    parser.add_argument(
        "--runtime", type=Path, default=ROOT / "editor/world/js/actor-localization.js"
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--original-strings",
        action="store_true",
        help="also compare saved volume strings from caller-owned local packages",
    )
    parser.add_argument(
        "--actor-startup",
        action="store_true",
        help="also join default copying, Volume construction and localized actor PostLoad",
    )
    parser.add_argument(
        "--default-config",
        action="store_true",
        help="with --actor-startup, also check the volume-family config gate from pinned owned packages",
    )
    parser.add_argument(
        "--engine", type=Path, default=ROOT / "assets/interlude/system/engine.dll"
    )
    parser.add_argument("--comparison-engine", type=Path)
    args = parser.parse_args()
    if args.actor_startup != bool(args.comparison_engine):
        parser.error(
            "--actor-startup and --comparison-engine must be supplied together"
        )
    if args.default_config and not args.actor_startup:
        parser.error("--default-config requires --actor-startup")
    from check_tutorial_quest_native import ENGINE_SHA
    from check_supplemental_engine import CANDIDATE_ENGINE_SHA

    result = verify(
        Image(args.core, CORE_SHA),
        PEImage(args.comparison_core, CANDIDATE_CORE_SHA),
        args.runtime,
        original_strings=args.original_strings,
        original_config=args.default_config,
        engine=Image(args.engine, ENGINE_SHA, True) if args.actor_startup else None,
        comparison_engine=(
            PEImage(args.comparison_engine, CANDIDATE_ENGINE_SHA)
            if args.actor_startup
            else None
        ),
    )
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(
        json.dumps(
            {
                key: value
                for key, value in result.items()
                if key not in ("source", "sourceSHA256")
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
