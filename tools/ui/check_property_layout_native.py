#!/usr/bin/env python3
"""Elbera Tools: original class/structure offsets versus the portable decoder.

Reads caller-owned Core images; interprets instructions without executing DLLs.
Parent size, reflection and completed Preload are explicit supplied inputs.
The default offset check stops before property lists. Optional --property-lists
continues through the original return, excluding replication grouping and using
an explicit empty temporary-map lifecycle provider.
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
)
from supplemental_pe import PEImage


def source_program(core, comparison, include_lists=False):
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


class PropertyLinkMachine(PropertyLayoutMachine):
    """Original Link with explicit current ancestors; no replication grouping."""

    def __init__(self, program, row):
        super().__init__(
            program, row["fields"], row["parent"], row.get("ownerKind", "class")
        )
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
                assert editor or not field["propertyFlags"] & 0x20
                self.identities[at] = field["identity"]
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
        return dict(
            propertyFlags=flags,
            lists=lists,
            layout=dict(propertiesSize=self.memory[self.owner + 0x4C], fields=offsets),
        )


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
                        **offset
                    )
                    for f, offset in zip(linked, layout["fields"])
                ]
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
    args = parser.parse_args()
    core = Image(args.core, CORE_SHA, False)
    comparison = PEImage(args.comparison_core, CANDIDATE_CORE_SHA)
    program = source_program(core, comparison, include_lists=args.property_lists)
    result = dict(
        tool="Elbera Tools original property offsets",
        status="pass",
        source=program.receipt,
        authored=compare_cases(program, authored_cases()),
        sourceFiles={},
    )
    if args.property_lists:
        result["propertyLists"] = compare_link_cases(program, authored_link_cases())
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
    for name in (
        "tools/l2lib/propertylayout.py",
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
