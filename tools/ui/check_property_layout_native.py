#!/usr/bin/env python3
"""Elbera Tools: original class/structure offsets versus the portable decoder.

Reads caller-owned Core images; interprets instructions without executing DLLs.
Parent size, reflection and completed Preload are explicit supplied inputs.
The offset prefix deliberately stops before UStruct.Link's later property lists.
"""

import argparse
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "tools"), str(ROOT / "tools/world")]
from l2lib.propertylayout import property_offsets, linked_properties, structure_layouts
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
)
from supplemental_pe import PEImage


def source_program(core, comparison):
    proof = qualify_property_offsets(core, comparison)
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
                self.memory[reference + 0x4A4] = field.get("referenceFlags", 0)
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
    return dict(
        sources=expected_sources,
        registration=source,
        comparisons=compare_cases(program, cases),
        structureComparisons=compare_cases(program, structure_cases),
        structures=structures,
        records=records,
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
    args = parser.parse_args()
    core = Image(args.core, CORE_SHA, False)
    comparison = PEImage(args.comparison_core, CANDIDATE_CORE_SHA)
    program = source_program(core, comparison)
    result = dict(
        tool="Elbera Tools original property offsets",
        status="pass",
        source=program.receipt,
        authored=compare_cases(program, authored_cases()),
        sourceFiles={},
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
    if "originalVolumes" in result:
        summary["originalVolumes"] = {
            k: result["originalVolumes"][k]
            for k in ("comparisons", "structureComparisons", "records")
        }
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
