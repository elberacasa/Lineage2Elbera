#!/usr/bin/env python3
"""Elbera Tools: original class/structure offsets versus the portable decoder.

Reads caller-owned Core images; interprets instructions without executing DLLs.
Parent size, reflection and completed Preload are explicit supplied inputs.
The default offset check stops before property lists. Optional --property-lists
continues through the original return. --replication additionally executes
loaded expression traversal, grouping and the original temporary-map lifecycle
with an explicit successful allocator; it requires --property-lists.
"""

import argparse
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "tools"), str(ROOT / "tools/world")]
from l2lib.propertylayout import (
    property_offsets,
    linked_properties,
    structure_layouts,
    property_link_flags,
    property_lists,
    structure_links,
    replication_links,
)
from actor_transform_source import qualify_property_declarations
from actor_octree_admission_machine import AdmissionMachine
from check_static_sweep_native import PreparationProgram
from check_tutorial_quest_native import Image
from check_supplemental_engine import CORE_SHA, CANDIDATE_CORE_SHA, CANDIDATE_ENGINE_SHA
from static_collision_source import ENGINE_SHA
from static_mesh_class_source import (
    qualify_property_offsets,
    qualify_class_default_prefix,
    qualify_registration,
    qualify_property_lists,
    reference_class_loading_bits,
    qualify_script_expressions,
    qualify_replication_linking,
)
from supplemental_pe import PEImage


def source_program(
    core,
    comparison,
    include_lists=False,
    include_scripts=False,
    include_replication=False,
):
    if include_replication and not include_lists:
        raise ValueError("replication requires the complete property-list program")
    proof = (qualify_property_lists if include_lists else qualify_property_offsets)(
        core, comparison
    )
    proof["classPrefix"] = qualify_class_default_prefix(core, comparison)
    proof["declarations"] = qualify_property_declarations(core, comparison)
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
    for block in proof["blocks"]:
        start, end = int(block["start"], 16), int(block["end"], 16)
        PreparationProgram.add(
            program,
            core,
            start,
            end,
            bytes(core.data[core.offset(start) : core.offset(end)]),
        )
    if include_scripts or include_replication:
        scripts = qualify_script_expressions(core, comparison)
        proof["scriptExpressions"] = scripts
        program.membership_targets.update(
            {int(k, 16): int(v, 16) for k, v in scripts["thunkTargets"].items()}
        )
        for block in scripts["blocks"]:
            start, end = int(block["start"], 16), int(block["end"], 16)
            PreparationProgram.add(
                program,
                core,
                start,
                end,
                bytes(core.data[core.offset(start) : core.offset(end)]),
            )
    if include_replication:
        linked = qualify_replication_linking(core, comparison)
        proof["replication"] = linked
        proof["limits"] = proof["limits"][:2] + [
            "Game-mode replication grouping and the complete temporary map execute with successful allocation/reallocation/free providers and explicit loaded class scripts.",
            "No condition truth evaluation, object resolution, allocation failures or alternate preserve-offset Link mode is claimed.",
        ]
        program.membership_targets.update(
            {int(k, 16): int(v, 16) for k, v in linked["thunkTargets"].items()}
        )
        for block in linked["blocks"]:
            start, end = int(block["start"], 16), int(block["end"], 16)
            PreparationProgram.add(
                program,
                core,
                start,
                end,
                bytes(core.data[core.offset(start) : core.offset(end)]),
            )
    return program


class PropertyLayoutMachine(AdmissionMachine):
    def read(self, operand):
        if operand in ("al", "bl", "cl", "dl"):
            return self.registers["e" + operand[0] + "x"] & 0xFF
        return super().read(operand)

    def __init__(self, program, fields, parent_size, owner_kind="class"):
        super().__init__(program)
        self.owner, self.archive = 0x100000, 0xA90000
        self.preloads, self.properties, self.expected_preloads = [], [], []
        assert owner_kind in ("class", "struct")
        table, parent = 0x110000, 0x120000
        self.memory.update(
            {
                self.owner: table,
                self.owner + 0x34: parent if parent_size is not None else 0,
                self.owner + 0x4C: 0xDEADBEEF,
                table + 0x6C: 0x10101FC3 if owner_kind == "class" else 0x10101A23,
                table + 0x78: 0x10102199,
                table + 0x7C: 0x10104890 if owner_kind == "class" else 0x10101ABE,
                parent: table,
                parent + 0x4C: parent_size,
                self.archive: 0xA91000,
                0xA91010: 0xA92000,
                0x10336DB4: 0,
                0x10338274: 0x10336D80,
            }
        )
        if parent_size is not None:
            self.expected_preloads.append(parent)
        self.memory[self.owner + 0x48] = 0x200000 if fields else 0
        for index, field in enumerate(fields):
            at, vtable = 0x200000 + index * 0x200, 0x400000 + index * 0x100
            kind = field["kind"]
            self.expected_preloads.append(at)
            is_property = kind in program.receipt["propertyMethods"]
            assert is_property or kind in (
                "Function",
                "State",
                "Struct",
                "Enum",
                "Const",
            ), "unadmitted field kind"
            descriptor = (
                0x10338240
                if kind == "BoolProperty"
                else 0x10336D80 if is_property else 0
            )
            self.memory.update(
                {
                    at: vtable,
                    at + 0x18: self.owner,
                    at + 0x24: descriptor,
                    at + 0x38: at + 0x200 if index + 1 < len(fields) else 0,
                    at + 0x40: field.get("arrayDim", 0),
                    at + 0x44: 0xDEADBEEF,
                    at + 0x54: 0xDEADBEEF,
                    at + 0x48: field.get("propertyFlags", 0),
                }
            )
            if is_property:
                self.properties.append((at, kind))
                self.memory[vtable + 0x80] = int(
                    program.receipt["propertyMethods"][kind], 16
                )
            if kind in ("ObjectProperty", "ClassProperty"):
                reference = 0x800000 + index * 0x1000
                self.memory[at + 0x78] = reference
                self.memory[reference + 0x4A4] = field.get(
                    "referenceFlagsNative", field.get("referenceFlags", 0)
                )
            elif kind == "StructProperty":
                reference = 0x800000 + index * 0x1000
                self.memory[at + 0x78] = reference
                self.memory[reference + 0x4C] = field["structSize"]
                self.memory[reference + 0x78] = field.get("structCleanupHead", 0)
                self.expected_preloads.append(reference)

    def step(self, instruction):
        if instruction.mnemonic == "nop":
            self.visited.append(instruction.address)
            return instruction.address + instruction.size
        if instruction.mnemonic == "not":
            self.write(
                instruction.op_str, (~self.read(instruction.op_str)) & 0xFFFFFFFF
            )
            self.visited.append(instruction.address)
            return instruction.address + instruction.size
        if instruction.mnemonic == "setl":
            assert instruction.op_str == "dl"
            self.registers["edx"] = (self.registers["edx"] & 0xFFFFFF00) | int(
                self.less
            )
            self.visited.append(instruction.address)
            return instruction.address + instruction.size
        if instruction.address in (0x10135E91, 0x10135EC5, 0x101726C9):
            assert instruction.mnemonic == "call"
            assert self.read(instruction.op_str) == 0xA92000
            assert self.registers["ecx"] == self.archive
            self.preloads.append(self.memory[self.registers["esp"]])
            self.registers["esp"] += 4
            self.visited.append(instruction.address)
            return instruction.address + instruction.size
        return super().step(instruction)

    def offsets(self):
        # This is a deliberate mid-method stop; do not use invoke(), whose
        # return/stack/SEH assertions would imply a full Link execution.
        self.push(1)
        self.push(self.archive)
        self.push(0)
        self.registers["ecx"] = self.owner
        self.execute_until(0x10135E30, 0x10135F12)
        rows = []
        for at, kind in self.properties:
            row = dict(
                elementSize=self.memory[at + 0x44], offset=self.memory[at + 0x54]
            )
            if kind == "BoolProperty":
                row["boolMask"] = self.memory[at + 0x78]
            rows.append(row)
        return dict(propertiesSize=self.memory[self.owner + 0x4C], fields=rows)


class ScriptExpressionMachine(PropertyLayoutMachine):
    """Original loaded expression traversal over explicit bounded byte buffers."""

    def __init__(
        self, program, data=None, *, fields=(), parent_size=None, owner_kind="class"
    ):
        super().__init__(program, fields, parent_size, owner_kind)
        self.byte_buffers = {}
        if "scriptExpressions" not in program.receipt:
            return
        proof = program.receipt["scriptExpressions"]
        self.memory.update(
            {int(at, 16): value for at, value in proof["constants"].items()}
        )
        start, end = int(proof["dispatch"]["start"], 16), int(
            proof["dispatch"]["end"], 16
        )
        self.put_bytes(
            start,
            bytes(
                program.engine.data[
                    program.engine.offset(start) : program.engine.offset(end)
                ]
            ),
        )
        if data is not None:
            self.put_bytes(0xC00000, data)
            self.memory.update(
                {
                    self.owner + 0x54: 0xC00000,
                    self.owner + 0x58: len(data),
                    0x110090: 0x10102248,
                }
            )
            self.invoke(0x10108B20, self.archive)

    def put_bytes(self, at, data):
        for index, byte in enumerate(data):
            assert at + index not in self.byte_buffers
            self.byte_buffers[at + index] = byte

    def read(self, operand):
        if operand.startswith(("byte ptr", "word ptr", "dword ptr")):
            at = self.address(operand)
            if at in self.byte_buffers:
                size = (
                    1
                    if operand.startswith("byte")
                    else 2 if operand.startswith("word") else 4
                )
                return int.from_bytes(
                    bytes(self.byte_buffers[at + n] for n in range(size)), "little"
                )
            if operand.startswith("word ptr"):
                return (
                    super().read(f"byte ptr [{at:#x}]")
                    | super().read(f"byte ptr [{at+1:#x}]") << 8
                )
        return super().read(operand)

    def write(self, operand, value, floating=False):
        if operand.startswith(("byte ptr", "word ptr", "dword ptr")):
            assert (
                self.address(operand) not in self.byte_buffers
            ), "read-only supplied script/source bytes"
        return super().write(operand, value, floating)

    def expression(self, offset):
        saved = {reg: self.registers[reg] for reg in ("ebx", "esi", "edi", "ebp")}
        cursor = 0xB10000
        self.memory[cursor] = offset
        self.invoke(0x10131B90, self.owner, (cursor, self.archive))
        assert {reg: self.registers[reg] for reg in saved} == saved
        return dict(token=self.registers["eax"], end=self.memory[cursor])

    def step(self, instruction):
        if instruction.mnemonic == "movzx":
            dest, source = instruction.op_str.split(", ")
            assert source.startswith(("byte ptr", "word ptr"))
            self.write(dest, self.read(source))
            self.visited.append(instruction.address)
            return instruction.address + instruction.size
        if instruction.mnemonic == "jmp" and instruction.op_str.startswith("dword ptr"):
            target = self.read(instruction.op_str)
            assert target in self.program
            self.visited.append(instruction.address)
            return target
        if instruction.mnemonic == "jmp" and instruction.op_str.startswith("0x"):
            target = int(instruction.op_str, 16)
            if target in self.source.membership_targets:
                self.visited.append(instruction.address)
                return self.source.membership_targets[target]
        return super().step(instruction)


def compare_script_cases(program, cases):
    from l2lib.classdata import read_class_script, materialize_class_script
    from l2lib import Reader

    count, expressions, instructions, addresses = 0, 0, 0, set()
    for row in cases:
        script = read_class_script(
            row["package"], Reader(row["saved"]), row["memorySize"]
        )
        loaded = materialize_class_script(script, row["referenceValues"])
        machine = ScriptExpressionMachine(program, loaded)
        for token in script["tokens"]:
            actual = machine.expression(token["memoryOffset"])
            assert actual == dict(token=token["token"], end=token["expressionEnd"]), (
                row,
                token,
                actual,
            )
            expressions += 1
        assert (
            bytes(machine.byte_buffers[0xC00000 + n] for n in range(len(loaded)))
            == loaded
        )
        count += 1
        instructions += len(machine.visited)
        addresses.update(machine.visited)
    return dict(
        cases=count,
        expressions=expressions,
        instructions=instructions,
        addresses=len(addresses),
    )


def authored_script_cases():
    from l2lib import encode_compact
    from l2lib.classdata import (
        NO_OPERAND_TOKENS,
        REFERENCE_TOKENS,
        REFERENCE_EXPRESSION_TOKENS,
        WORD_EXPRESSION_TOKENS,
        BYTE_TOKENS,
    )

    package = SimpleNamespace(imports=[None] * 130, exports=[None] * 130)
    rows = [(bytes([token]), 1) for token in sorted(NO_OPERAND_TOKENS)]
    for token in sorted(REFERENCE_TOKENS | REFERENCE_EXPRESSION_TOKENS):
        for reference in (-65, 0, 128):
            nested = token in REFERENCE_EXPRESSION_TOKENS
            rows.append(
                (
                    bytes([token])
                    + encode_compact(reference)
                    + (b"\x25" if nested else b""),
                    6 if nested else 5,
                )
            )
    rows += [
        (bytes([token]) + b"\xff\x80\x26", 4)
        for token in sorted(WORD_EXPRESSION_TOKENS)
    ]
    rows += [
        (bytes([token, value]), 2)
        for token in sorted(BYTE_TOKENS)
        for value in (0, 255)
    ]
    rows += [
        (b"\x39\x04\x25", 3),
        (b"\x70\x16", 2),
        (b"\xff\x25\x24\x02\x16", 5),
        (
            b"\x77\x39\x04\x01"
            + encode_compact(-65)
            + b"\x18\x34\x12\x2e"
            + encode_compact(128)
            + b"\x24\x99\x16",
            19,
        ),
    ]
    for saved, size in rows:
        # A trailing expression exercises the original native-call lookahead
        # and rewind, as well as the end-of-buffer path without that suffix.
        for suffix in (b"", b"\x25"):
            yield dict(
                package=package,
                saved=saved + suffix,
                memorySize=size + len(suffix),
                referenceValues={-65: 0xFFFFFFFF, 0: 0, 128: 0x81234567},
            )


def original_script_comparisons(program, sources):
    from l2lib import load_package, qualified_ref
    from l2lib.classdata import read_class_default_prefix

    cases, records = [], []
    for filename, names in (
        ("Engine.u", ("Volume", "BlockingVolume", "MusicVolume", "PhysicsVolume")),
        ("GamePlay.u", ("WaterVolume",)),
    ):
        path = ROOT / "assets/interlude/system" / filename
        assert hashlib.sha256(path.read_bytes()).hexdigest() == sources[filename]
        package = load_package(path)[0]
        for name in names:
            matches = [
                ex
                for ex in package.exports
                if package.class_name_of(ex) == "Class"
                and package.export_name(ex) == name
            ]
            assert len(matches) == 1
            export = matches[0]
            script = read_class_default_prefix(package, export)["script"]
            refs = {row["reference"] for row in script["tokens"] if "reference" in row}
            identities = {
                ref: qualified_ref(package, ref) if ref else None for ref in refs
            }
            by_identity = {
                identity: 0x710000 + index * 4
                for index, identity in enumerate(
                    sorted({v for v in identities.values() if v is not None})
                )
            }
            values = {
                ref: by_identity[identity] if identity else 0
                for ref, identity in identities.items()
            }
            start, size = script["sourceOffset"], script["sourceBytes"]
            cases.append(
                dict(
                    package=package,
                    saved=package.data[start : start + size],
                    memorySize=script["memoryBytes"],
                    referenceValues=values,
                )
            )
            records.append(
                dict(
                    identity=qualified_ref(package, export.index + 1),
                    sourceSHA256=script["sourceSHA256"],
                    sourceBytes=size,
                    memoryBytes=script["memoryBytes"],
                    expressions=len(script["tokens"]),
                    referenceIdentities=identities,
                )
            )
    return dict(
        comparisons=compare_script_cases(program, cases),
        records=records,
        sources=sources,
        limits=[
            "Original scripts with explicit authored opaque DWORD bindings shared by identical source reference identities. Cursor traversal is compared; the actual object loader and live pointer values are not inferred."
        ],
    )


def authored_replication_cases():
    from l2lib import Reader, encode_compact
    from l2lib.classdata import read_class_script, materialize_class_script

    package = SimpleNamespace(imports=[None] * 130, exports=[None] * 130)
    # Equal multiword expressions and a difference confined to a trailing
    # reference byte exercise both the DWORD loop and final-byte comparison.
    first = b"\x77\x01\x01\x39\x04\x01\x02\x16"
    second = b"\x77\x01\x01\x39\x04\x01\x03\x16"
    decoded = read_class_script(package, Reader(first + second), 28)
    values = {1: 0x01020304, 2: 0x12345678, 3: 0x92345678}
    yield dict(
        parent=None,
        fields=[
            dict(
                identity=name,
                kind="IntProperty",
                arrayDim=1,
                propertyFlags=0x20,
                replicationOffset=offset,
                ownerClass="Owner",
            )
            for name, offset in (("First", 0), ("DifferentTail", 14), ("Last", 0))
        ],
        scripts={"Owner": dict(decoded=decoded, referenceValues=values)},
        loadedScripts={0: materialize_class_script(decoded, values)},
    )
    for count in (0, 1, 2, 5, 11, 48):
        for collide in (False, True):
            for same_reference in (False, True):
                for editor in (False, True):
                    scripts, loaded, levels = {}, {}, []
                    for level in range(3):
                        ref = -65 if level == 0 else 70
                        saved = (
                            b"\x25\x26\x24"
                            + bytes([5 if level == 0 else 6])
                            + b"\x01"
                            + encode_compact(ref)
                            + b"\x70\x25\x16"
                        )
                        bindings = {
                            ref: (
                                0x81234567
                                if level == 0 or same_reference
                                else 0x12345678
                            )
                        }
                        decoded = read_class_script(package, Reader(saved), 12)
                        scripts["Owner" + str(level)] = dict(
                            decoded=decoded, referenceValues=bindings
                        )
                        loaded[level] = materialize_class_script(decoded, bindings)
                        fields = []
                        # Include an empty immediate parent and deeper fields.
                        for index in range(count if level != 1 else 0):
                            fields.append(
                                dict(
                                    identity=f"Owner{level}.Field{index}",
                                    kind="IntProperty",
                                    arrayDim=1,
                                    propertyFlags=0 if index % 7 == 6 else 0x20,
                                    replicationOffset=(0, 1, 2, 4, 9)[index % 5],
                                    ownerClass="Owner" + str(level),
                                    objectIndex=0 if collide else index * 17 + level,
                                )
                            )
                        levels.append(fields)
                    yield dict(
                        parent=0x34,
                        fields=levels[0],
                        inherited=levels[1:],
                        scripts=scripts,
                        loadedScripts=loaded,
                        isEditor=editor,
                    )
    # The serialized WORD offset is unsigned. A supported expression may end
    # beyond 65535 even though its starting offset cannot exceed that value.
    data = b"\x25" * 65535 + b"\x24\xff"
    decoded = read_class_script(package, Reader(data), len(data))
    yield dict(
        parent=None,
        fields=[
            dict(
                identity="HighOffset",
                kind="IntProperty",
                arrayDim=1,
                propertyFlags=0x20,
                replicationOffset=65535,
                ownerClass="Owner",
            )
        ],
        loadedScripts={0: data},
        scripts={"Owner": dict(decoded=decoded, referenceValues={})},
    )
    yield dict(
        parent=None,
        ownerKind="struct",
        fields=[
            dict(
                identity="Nested.Field",
                kind="IntProperty",
                arrayDim=1,
                propertyFlags=0x20,
                replicationOffset=0,
                ownerClass="Container",
            )
        ],
        loadedScripts={0: b"\x25"},
        scripts={
            "Container": dict(
                decoded=read_class_script(package, Reader(b"\x25"), 1),
                referenceValues={},
            )
        },
    )


class PropertyLinkMachine(ScriptExpressionMachine):
    """Original Link with current ancestors and optional native replication."""

    def __init__(self, program, row):
        super().__init__(
            program,
            fields=row["fields"],
            parent_size=row["parent"],
            owner_kind=row.get("ownerKind", "class"),
        )
        self.replication = "replication" in program.receipt
        self.identities, self.map_calls = {}, []
        self.inherited = row.get("inherited", [])
        editor = row.get("isEditor", False)
        assert type(editor) is bool
        self.memory[0x1023E8C4] = int(editor)
        descriptors = program.receipt["propertyDescriptors"]
        for kind, address in descriptors.items():
            self.memory[address + 0x4A4] = 0x8000
            self.memory[address + 0x34] = (
                0
                if kind == "Property"
                else descriptors[
                    "ObjectProperty" if kind == "ClassProperty" else "Property"
                ]
            )
        nonproperty = 0x500000
        self.memory.update({nonproperty + 0x4A4: 0, nonproperty + 0x34: 0})

        def field_header(at, field):
            kind = field["kind"]
            self.memory[at + 0x24] = descriptors.get(kind, nonproperty)
            if kind in descriptors:
                assert self.replication or editor or not field["propertyFlags"] & 0x20
                self.identities[at] = field["identity"]
                if self.replication:
                    self.memory.update(
                        {
                            at + 4: field.get("objectIndex", 0),
                            at + 0x50: field.get("replicationOffset", 0),
                            at + 0x68: 0xDEADBEEF,
                        }
                    )
                    self.memory.setdefault(at, at + 0x1000000)
                    self.memory[self.memory[at] + 0x74] = 0x1010173A
            # Stale link sentinels verify that reachable lists get terminated.
            for offset in (0x58, 0x5C, 0x60, 0x64):
                self.memory[at + offset] = 0xDEADBEEF

        for index, field in enumerate(row["fields"]):
            at = 0x200000 + index * 0x200
            field_header(at, field)
            if field["kind"] == "StructProperty":
                referenced = self.memory[at + 0x78]
                self.memory[referenced + 0x78] = (
                    0xD00000 if field["structConstructorLink"] else 0
                )
        # Parent size is an explicit current input, even with no exposed fields.
        table = self.memory[self.owner]
        parent = self.memory[self.owner + 0x34]
        assert not self.inherited or parent
        for level, fields in enumerate(self.inherited or ([[]] if parent else [])):
            owner = parent if level == 0 else 0x130000 + level * 0x10000
            next_owner = 0x130000 + (level + 1) * 0x10000
            first = 0x300000 + level * 0x10000
            self.memory.update(
                {
                    owner: table,
                    owner + 0x34: next_owner if level + 1 < len(self.inherited) else 0,
                    owner + 0x48: first if fields else 0,
                }
            )
            for index, field in enumerate(fields):
                at = first + index * 0x200
                self.memory.update(
                    {
                        at + 0x18: owner,
                        at + 0x38: at + 0x200 if index + 1 < len(fields) else 0,
                        at + 0x48: field.get("propertyFlags", 0),
                    }
                )
                field_header(at, field)
        if self.replication:
            owners = [self.owner] + [
                parent if level == 0 else 0x130000 + level * 0x10000
                for level in range(len(self.inherited))
            ]
            for level, owner in enumerate(owners):
                if level == 0 and row.get("ownerKind") == "struct":
                    # GetOwnerClass must traverse the actual outer chain.
                    self.memory[owner + 0x24] = nonproperty
                    self.memory[owner + 0x18] = 0xD80000
                    owner = 0xD80000
                    self.memory[owner] = table
                self.memory[owner + 0x24] = 0x1027D770
                self.memory[self.memory[owner] + 0x90] = 0x10102248
                data = row.get("loadedScripts", {}).get(level, b"")
                buffer = 0xC00000 + level * 0x10000
                self.put_bytes(buffer, data)
                self.memory.update({owner + 0x54: buffer, owner + 0x58: len(data)})
        for offset in (0x6C, 0x70, 0x74, 0x78):
            self.memory[self.owner + offset] = 0xDEADBEEF

    def step(self, instruction):
        if instruction.address in (0x10136026, 0x101361E3, 0x101361EF):
            assert instruction.mnemonic == "call"
            expected = {
                0x10136026: "0x10103445",
                0x101361E3: "0x101017a3",
                0x101361EF: "0x10101db1",
            }
            assert instruction.op_str == expected[instruction.address]
            self.map_calls.append((instruction.address, self.registers["ecx"]))
            if not self.replication:
                self.visited.append(instruction.address)
                return instruction.address + instruction.size
        if self.replication and instruction.address in (
            0x10132677,
            0x101326E3,
            0x10135D48,
            0x10134616,
        ):
            sp = self.registers["esp"]
            assert self.registers["ecx"] == 0xA00000
            if instruction.address == 0x10132677:
                assert self.read(instruction.op_str) == 0xA00200
                size, label = self.memory[sp], self.memory[sp + 4]
                self.registers["eax"] = self.allocate(size)
                self.registers["esp"] += 8
                self.events.append(["allocate", size, label])
            else:
                assert self.read(instruction.op_str) == 0xA00208
                self.free(self.memory[sp])
                self.registers["esp"] += 4
                self.events.append(["free"])
            self.visited.append(instruction.address)
            return instruction.address + instruction.size
        if instruction.mnemonic == "mul":
            total = self.registers["eax"] * self.read(instruction.op_str)
            self.registers["eax"], self.registers["edx"] = (
                total & 0xFFFFFFFF,
                total >> 32,
            )
            self.multiply_overflow = bool(total >> 32)
            self.visited.append(instruction.address)
            return instruction.address + instruction.size
        if instruction.mnemonic == "seto":
            assert instruction.op_str == "cl"
            self.registers["ecx"] = (self.registers["ecx"] & 0xFFFFFF00) | int(
                self.multiply_overflow
            )
            self.visited.append(instruction.address)
            return instruction.address + instruction.size
        if instruction.mnemonic == "neg":
            old = self.read(instruction.op_str)
            value = -old & 0xFFFFFFFF
            self.flags(value, old != 0, old == 0x80000000)
            self.write(instruction.op_str, value)
            self.visited.append(instruction.address)
            return instruction.address + instruction.size
        return super().step(instruction)

    def linked(self):
        saved = {reg: self.registers[reg] for reg in ("ebx", "esi", "edi", "ebp")}
        self.invoke(0x10135E30, self.owner, (self.archive, 1))
        assert {reg: self.registers[reg] for reg in saved} == saved
        assert len(self.map_calls) == 3 and len({p for _, p in self.map_calls}) == 1
        lists = {}
        for head, next_offset in (
            (0x6C, 0x64),
            (0x70, 0x58),
            (0x74, 0x5C),
            (0x78, 0x60),
        ):
            at, chain, seen = self.memory[self.owner + head], [], set()
            while at:
                assert at in self.identities and at not in seen
                seen.add(at)
                chain.append(self.identities[at])
                at = self.memory[at + next_offset]
            lists[hex(head)] = chain
        flags = {
            self.identities[at]: self.memory[at + 0x48] for at, _ in self.properties
        }
        offsets = []
        for at, kind in self.properties:
            value = dict(
                elementSize=self.memory[at + 0x44], offset=self.memory[at + 0x54]
            )
            if kind == "BoolProperty":
                value["boolMask"] = self.memory[at + 0x78]
            offsets.append(value)
        result = dict(
            propertyFlags=flags,
            lists=lists,
            layout=dict(propertiesSize=self.memory[self.owner + 0x4C], fields=offsets),
        )
        if self.replication:
            assert not self.blocks, self.blocks
            result["replicationLinks"] = {
                name: self.identities[self.memory[at + 0x68]]
                for at, name in self.identities.items()
                if self.memory[at + 0x68] != 0xDEADBEEF
            }
        return result


def compare_link_cases(program, cases):
    count, instructions, addresses = 0, 0, set()
    for row in cases:
        machine = PropertyLinkMachine(program, row)
        actual = machine.linked()
        own = [
            f for f in row["fields"] if f["kind"] in program.receipt["propertyMethods"]
        ]
        flags = {f["identity"]: property_link_flags(f) for f in own}
        fields = [dict(f, propertyFlags=flags[f["identity"]]) for f in own]
        fields += [
            f
            for level in row.get("inherited", [])
            for f in level
            if f["kind"].endswith("Property")
        ]
        expected = dict(
            propertyFlags=flags,
            lists=property_lists(fields),
            layout=property_offsets(own, 0 if row["parent"] is None else row["parent"]),
        )
        if machine.replication:
            expected["replicationLinks"] = replication_links(
                fields, row.get("scripts", {}), is_editor=row.get("isEditor", False)
            )
        assert actual == expected, (row, actual, expected)
        assert machine.preloads == machine.expected_preloads
        count += 1
        instructions += len(machine.visited)
        addresses.update(machine.visited)
    return dict(cases=count, instructions=instructions, addresses=len(addresses))


def authored_link_cases():
    # Portable metadata knows only the consumed bit. The original instructions
    # receive an independent complete word, including varying unconsumed bits.
    for consumed in (0, 0x200000):
        for noise in (0, 1, 0x400000, 0xFFDFFFFF):
            yield dict(
                parent=None,
                fields=[
                    dict(
                        identity=kind,
                        kind=kind,
                        arrayDim=1,
                        propertyFlags=0,
                        referenceFlags=dict(mask=0x200000, value=consumed),
                        referenceFlagsNative=consumed | noise,
                    )
                    for kind in ("ObjectProperty", "ClassProperty")
                ],
            )
    scalar = (
        "ByteProperty",
        "IntProperty",
        "BoolProperty",
        "FloatProperty",
        "NameProperty",
        "StrProperty",
    )
    for initial in (0, 0x1000, 0x4000, 0x400000, 0x401000, 0x80000000):
        for reference in (0, 0x200000, 0x80000000):
            for nested in (False, True):
                for special in (0, 8, 0x4000000, 0x4000008):
                    fields = [
                        dict(
                            identity=kind, kind=kind, arrayDim=1, propertyFlags=initial
                        )
                        for kind in scalar
                    ]
                    fields += [
                        dict(
                            identity=kind,
                            kind=kind,
                            arrayDim=2,
                            propertyFlags=initial | special,
                            referenceFlags=reference,
                        )
                        for kind in ("ObjectProperty", "ClassProperty")
                    ]
                    fields += [
                        dict(
                            identity="Nested",
                            kind="StructProperty",
                            arrayDim=2,
                            propertyFlags=initial,
                            structSize=12,
                            structConstructorLink=nested,
                        )
                    ]
                    fields.insert(2, dict(kind="Function"))
                    yield dict(
                        parent=0x34,
                        fields=fields,
                        inherited=[
                            [],
                            [
                                dict(
                                    identity="InheritedArray",
                                    kind="ArrayProperty",
                                    propertyFlags=0x400000,
                                ),
                                dict(kind="State"),
                                dict(
                                    identity="InheritedDelegate",
                                    kind="DelegateProperty",
                                    propertyFlags=0x4000,
                                ),
                                dict(
                                    identity="InheritedString",
                                    kind="StrProperty",
                                    propertyFlags=0x400000,
                                ),
                            ],
                        ],
                    )
    # The real editor branch bypasses grouping for replicated properties. It is
    # not a substitute for game-mode replication-condition preparation.
    for inherited in (
        [],
        [[dict(identity="Parent", kind="IntProperty", propertyFlags=0x20)]],
    ):
        yield dict(
            parent=0,
            fields=[
                dict(identity="Net", kind="StrProperty", arrayDim=1, propertyFlags=0x20)
            ],
            inherited=inherited,
            isEditor=True,
        )
    yield dict(parent=None, fields=[])


def authored_cases():
    kinds = (
        "ByteProperty",
        "IntProperty",
        "NameProperty",
        "FloatProperty",
        "StrProperty",
        "ObjectProperty",
        "ClassProperty",
        "BoolProperty",
    )
    for parent in (0, 1, 2, 3, 4, 15, 256):
        yield dict(parent=parent, fields=[])
        for kind in kinds:
            for dimension in (1, 2, 7):
                yield dict(parent=parent, fields=[dict(kind=kind, arrayDim=dimension)])
        for count in (2, 31, 32, 33, 65):
            yield dict(
                parent=parent,
                fields=[dict(kind="BoolProperty", arrayDim=1) for _ in range(count)],
            )
        yield dict(
            parent=parent,
            fields=[
                dict(kind=k, arrayDim=1)
                for k in (
                    "ByteProperty",
                    "ByteProperty",
                    "BoolProperty",
                    "BoolProperty",
                    "Function",
                    "BoolProperty",
                    "StrProperty",
                    "BoolProperty",
                )
            ],
        )
        # Static Boolean arrays still use the preceding Boolean mask/offset;
        # do not impose the common but unsupported arrayDim==1 packing rule.
        yield dict(
            parent=parent,
            fields=[dict(kind="BoolProperty", arrayDim=d) for d in (3, 1, 2)],
        )
    for owner_kind in ("class", "struct"):
        for parent in (None, 0, 1, 2, 3, 4, 15):
            for size in (0, 1, 2, 3, 4, 12, 20):
                for dimension in (1, 3):
                    yield dict(
                        ownerKind=owner_kind,
                        parent=parent,
                        fields=[
                            dict(kind="ByteProperty", arrayDim=1),
                            dict(
                                kind="StructProperty",
                                arrayDim=dimension,
                                structSize=size,
                            ),
                            dict(kind="ByteProperty", arrayDim=1),
                            dict(kind="IntProperty", arrayDim=1),
                        ],
                    )


def compare_cases(program, cases):
    instructions, addresses, preloads, count = 0, set(), 0, 0
    for row in cases:
        machine = PropertyLayoutMachine(
            program, row["fields"], row["parent"], row.get("ownerKind", "class")
        )
        actual = machine.offsets()
        fields = [
            f for f in row["fields"] if f["kind"] in program.receipt["propertyMethods"]
        ]
        expected = property_offsets(
            fields, 0 if row["parent"] is None else row["parent"]
        )
        assert actual == expected, (row, actual, expected)
        assert machine.preloads == machine.expected_preloads
        instructions += len(machine.visited)
        addresses.update(machine.visited)
        preloads += len(machine.preloads)
        count += 1
    return dict(
        cases=count,
        instructions=instructions,
        addresses=len(addresses),
        preloads=preloads,
    )


def original_volume_offsets(program, core, comparison, engine, comparison_engine):
    """Use original linked declarations and independently registered parent sizes.

    The class parents are explicit native-size inputs, not a claim that their
    complete reflection has been loaded. Nested sizes are independently resolved
    from saved structure declarations. No original records enter public source.
    """
    from inspect_actor_declarations import inspect_declarations

    source = qualify_registration(engine, core, comparison_engine, comparison)
    declarations = inspect_declarations(
        [
            "Engine.Volume",
            "Engine.BlockingVolume",
            "Engine.MusicVolume",
            "Engine.PhysicsVolume",
            "Gameplay.WaterVolume",
        ]
    )
    expected_sources = {
        "Engine.u": "9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761",
        "Core.u": "de5f0ee0a773327bce13c96622fd3c654cff7db88b9be065d1232590c140fda0",
        "GamePlay.u": "714639cdad265a7caeaf0f91ce76bb50492390eaa3faea15ed5a28a3e830b64a",
    }
    assert declarations["sources"] == expected_sources
    engine.instruction(0x1083D9D2, "push", "0x418")
    # Registration correspondence above qualifies this image's -0x40 code shift.
    assert engine.u32(0x1083D9D3) == comparison_engine.u32(0x1083D9D3 - 0x40)
    sizes = {"engine.brush": engine.u32(0x1083D9D3)}
    sizes.update(
        {r["sourceClass"].casefold(): r["byteSize"] for r in source["volumeStorage"]}
    )
    structures = structure_layouts(declarations["structures"].values())

    def case_fields(row):
        by_ref = {f["exportRef"]: dict(f) for f in linked_properties(row)}
        for field in by_ref.values():
            if field["kind"] == "StructProperty":
                field["structSize"] = structures[field["reference"].casefold()][
                    "propertiesSize"
                ]
        return [by_ref.get(f["exportRef"], f) for f in row["fieldChain"]["fields"]]

    structure_cases = []
    for key, layout in structures.items():
        row = declarations["structures"][key]
        structure_cases.append(
            dict(
                ownerKind="struct",
                parent=layout["parentSize"] if row["savedSuper"] else None,
                fields=case_fields(row),
            )
        )
    cases, records = [], []
    for key in (
        "engine.volume",
        "engine.blockingvolume",
        "engine.musicvolume",
        "engine.physicsvolume",
        "gameplay.watervolume",
    ):
        row = declarations["classes"][key]
        by_ref = {f["exportRef"]: f for f in linked_properties(row)}
        fields = case_fields(row)
        unsupported = sorted(
            {
                f["kind"]
                for f in fields
                if f["kind"].endswith("Property")
                and f["kind"] not in program.receipt["propertyMethods"]
            }
        )
        record = dict(
            identity=row["identity"],
            parent=row["savedSuper"],
            parentNativeSize=sizes[row["savedSuper"].casefold()],
            savedClassFlags=row["classPrefix"]["fields"]["0x4a4"],
        )
        if unsupported:
            records.append(dict(**record, status="unsupported", kinds=unsupported))
            continue
        case = dict(parent=record["parentNativeSize"], fields=fields)
        cases.append(case)
        layout = property_offsets(
            [f for f in fields if f["exportRef"] in by_ref], case["parent"]
        )
        if key in sizes:
            assert layout["propertiesSize"] == sizes[key]
        linked = [f for f in fields if f["exportRef"] in by_ref]
        records.append(
            dict(
                **record,
                status="pass",
                propertiesSize=layout["propertiesSize"],
                fields=[
                    dict(
                        name=f["name"],
                        kind=f["kind"],
                        exportRef=f["exportRef"],
                        declarationSHA256=f["exportSHA256"],
                        **offset,
                    )
                    for f, offset in zip(linked, layout["fields"])
                ],
            )
        )
    linked = None
    if "propertyDescriptors" in program.receipt:
        from l2lib import load_package

        reference_bits = reference_class_loading_bits(
            engine,
            core,
            load_package(ROOT / "assets/interlude/system/Engine.u")[0],
            load_package(ROOT / "assets/interlude/system/Core.u")[0],
        )
        profiles = reference_bits["records"]
        metadata = structure_links(declarations["structures"].values(), profiles)
        linked_cases = []
        for key, row in metadata.items():
            if row["status"] != "ready":
                continue
            inherited, parent = [], declarations["structures"][key]["savedSuper"]
            while parent:
                inherited.append(metadata[parent.casefold()]["ownFields"])
                parent = declarations["structures"][parent.casefold()]["savedSuper"]
            own = [
                dict(f, propertyFlags=f["savedPropertyFlags"]) for f in row["ownFields"]
            ]
            for f in own:
                if f["kind"] in ("ObjectProperty", "ClassProperty"):
                    f["referenceFlagsNative"] = profiles[f["reference"].casefold()][
                        "evidence"
                    ]["variants"][0]
            linked_cases.append(
                dict(
                    ownerKind="struct",
                    parent=structures[key]["parentSize"] if inherited else None,
                    fields=own,
                    inherited=inherited,
                )
            )
        linked = dict(
            comparisons=compare_link_cases(program, linked_cases),
            records=metadata,
            unsupported=[
                key for key, row in metadata.items() if row["status"] != "ready"
            ],
            referenceClassBits=reference_bits,
        )
        reference_cases = []
        for profile in profiles.values():
            for variant in profile["evidence"]["variants"]:
                for kind in ("ObjectProperty", "ClassProperty"):
                    reference_cases.append(
                        dict(
                            parent=None,
                            fields=[
                                dict(
                                    identity="Reference",
                                    kind=kind,
                                    arrayDim=1,
                                    propertyFlags=0,
                                    referenceFlags=profile,
                                    referenceFlagsNative=variant,
                                )
                            ],
                        )
                    )
        linked["referenceComparisons"] = compare_link_cases(program, reference_cases)
    return dict(
        sources=expected_sources,
        registration=source,
        comparisons=compare_cases(program, cases),
        structureComparisons=compare_cases(program, structure_cases),
        structures=structures,
        records=records,
        structureLinks=linked,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--core", type=Path, default=ROOT / "assets/interlude/system/Core.dll"
    )
    parser.add_argument("--comparison-core", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--original-volumes",
        action="store_true",
        help="also compare original saved volume declarations with native parent sizes",
    )
    parser.add_argument("--comparison-engine", type=Path)
    parser.add_argument(
        "--property-lists",
        action="store_true",
        help="also compare linked flags and four lists with explicit current metadata",
    )
    parser.add_argument(
        "--script-expressions",
        action="store_true",
        help="also compare decoded loaded-script expression boundaries",
    )
    parser.add_argument(
        "--replication",
        action="store_true",
        help="with --property-lists, execute original replication grouping and its temporary map; includes script checks",
    )
    args = parser.parse_args()
    if args.replication and not args.property_lists:
        parser.error("--replication requires --property-lists")
    core = Image(args.core, CORE_SHA, False)
    comparison = PEImage(args.comparison_core, CANDIDATE_CORE_SHA)
    program = source_program(
        core,
        comparison,
        include_lists=args.property_lists,
        include_scripts=args.script_expressions,
        include_replication=args.replication,
    )
    result = dict(
        tool="Elbera Tools original property offsets",
        status="pass",
        source=program.receipt,
        authored=compare_cases(program, authored_cases()),
        sourceFiles={},
    )
    if args.property_lists:
        result["propertyLists"] = compare_link_cases(program, authored_link_cases())
    if args.script_expressions or args.replication:
        result["scriptExpressions"] = compare_script_cases(
            program, authored_script_cases()
        )
    if args.replication:
        result["replicationLinks"] = compare_link_cases(
            program, authored_replication_cases()
        )
    if args.original_volumes:
        if args.comparison_engine is None:
            parser.error("--original-volumes requires --comparison-engine")
        result["originalVolumes"] = original_volume_offsets(
            program,
            core,
            comparison,
            Image(ROOT / "assets/interlude/system/engine.dll", ENGINE_SHA, True),
            PEImage(args.comparison_engine, CANDIDATE_ENGINE_SHA),
        )
        if args.script_expressions or args.replication:
            result["originalScripts"] = original_script_comparisons(
                program, result["originalVolumes"]["sources"]
            )
    for name in (
        "tools/l2lib/propertylayout.py",
        "tools/l2lib/classdata.py",
        "tools/l2lib/declarations.py",
        "tools/world/inspect_actor_declarations.py",
        "tools/ui/static_mesh_class_source.py",
        "tools/ui/check_property_layout_native.py",
    ):
        result["sourceFiles"][name] = hashlib.sha256(
            (ROOT / name).read_bytes()
        ).hexdigest()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    summary = {k: result[k] for k in ("tool", "status", "authored")}
    if "propertyLists" in result:
        summary["propertyLists"] = result["propertyLists"]
    for key in ("scriptExpressions", "replicationLinks"):
        if key in result:
            summary[key] = result[key]
    if "originalScripts" in result:
        summary["originalScripts"] = result["originalScripts"]["comparisons"]
    if "originalVolumes" in result:
        summary["originalVolumes"] = {
            k: result["originalVolumes"][k]
            for k in ("comparisons", "structureComparisons", "records")
        }
        if result["originalVolumes"]["structureLinks"] is not None:
            summary["originalVolumes"]["structureLinks"] = {
                k: result["originalVolumes"]["structureLinks"][k]
                for k in ("comparisons", "unsupported", "referenceComparisons")
            }
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
