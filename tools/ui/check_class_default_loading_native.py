#!/usr/bin/env python3
"""Elbera Tools: original inherited CDO initialization and saved tag loading.

Requires the pinned caller-owned Interlude DLLs/packages and comparison Core.
Reuses the loading interpreter. Archive reads, current name/object identities,
linked metadata, successful allocation and already-preloaded structures remain
explicit providers. No native DLL executes. Full receipts contain private data.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

from check_actor_localization_native import StringLoadingMachine, source_program
from actor_transform_source import qualify_actor_transform_loading, raw
from static_collision_source import qualify_packed_property_tags
from check_static_sweep_native import PreparationProgram
from check_static_mesh_native import browser_outputs
from check_tutorial_quest_native import Image
from check_supplemental_engine import CORE_SHA, CANDIDATE_CORE_SHA
from supplemental_pe import PEImage

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "tools"), str(ROOT / "tools/world")]
from l2lib import Reader, qualified_ref
from inspect_actor_declarations import inspect_declarations, DEFAULT_CLASSES
from export_static_collision import OriginalClasses, serialized_class_record


def tag_program(core, comparison):
    program = source_program(core, comparison)
    packed = qualify_packed_property_tags(core, comparison)
    transforms = qualify_actor_transform_loading(
        core,
        comparison,
        ROOT / "assets/interlude/system/Engine.u",
        ROOT / "assets/interlude/system/Core.u",
    )
    proof = dict(
        packed=packed,
        transforms=transforms,
        methods=[],
        thunks={},
        names=[],
        vtables=[],
    )
    program.receipt["defaultTagLoading"] = proof
    for source in (packed, transforms):
        for block in source.get("coreBlocks", source.get("blocks")):
            if "table" in block.get("label", "") or "targets" in block.get("label", ""):
                continue
            a, b = int(block["start"], 16), int(block["end"], 16)
            PreparationProgram.add(program, core, a, b, raw(core, a, b))
        program.membership_targets.update(
            {int(a, 16): int(b, 16) for a, b in source.get("thunkTargets", {}).items()}
        )
        for row in source.get("thunks", []):
            program.membership_targets[int(row["thunk"], 16)] = int(row["target"], 16)
    methods = [
        (
            "?SerializeItem@UByteProperty@@UBEXAAVFArchive@@PAXH@Z",
            0x10170C00,
            0x10170C15,
        ),
        (
            "?SerializeItem@UNameProperty@@UBEXAAVFArchive@@PAXH@Z",
            0x1016EF60,
            0x1016EF73,
        ),
        ("?GetID@UProperty@@UBEEXZ", 0x10170AE0, 0x10170AE7),
        ("?GetID@UClassProperty@@UBEEXZ", 0x1010B970, 0x1010B973),
    ]
    for name, a, b in methods:
        assert core.exported(name, True) == comparison.body(name) == a
    for a, b in [(a, b) for _, a, b in methods] + [
        (0x10132A60, 0x10132A82),
        (0x10134670, 0x101346CA),
    ]:
        data = raw(core, a, b)
        assert data == comparison.read(a, b - a)
        rows = list(core.dis.disasm(data, a))
        assert sum(r.size for r in rows) == len(data) and rows[-1].mnemonic == "ret"
        PreparationProgram.add(program, core, a, b, data)
        proof["methods"].append(
            dict(start=hex(a), end=hex(b), SHA256=hashlib.sha256(data).hexdigest())
        )
    for thunk in [
        0x101042D2,
        0x10101613,
        0x10104403,
        0x1010243C,
        0x101016F9,
        0x1010345E,
        0x101017CB,
        0x101031F7,
        0x101039EA,
    ]:
        data = raw(core, thunk, thunk + 5)
        assert data == comparison.read(thunk, 5)
        row = next(core.dis.disasm(data, thunk))
        assert row.mnemonic == "jmp"
        target = int(row.op_str, 16)
        program.membership_targets[thunk] = target
        proof["thunks"][hex(thunk)] = hex(target)
    # Fixed names select property IDs and Vector/Rotator/Color binary loading.
    # Bind the original registration calls and text; package name indices are
    # separately resolved by the supplied current-name provider.
    for name, index, at, text_at, length in [
        ("None", 0, 0x10157398, 0x101D6FF0, 25),
        ("ByteProperty", 1, 0x101573B1, 0x101D6FFC, 25),
        ("IntProperty", 2, 0x101573CA, 0x101D7018, 25),
        ("BoolProperty", 3, 0x101573E3, 0x101D7030, 28),
        ("FloatProperty", 4, 0x101573FF, 0x101D704C, 25),
        ("ObjectProperty", 5, 0x10157418, 0x101D7068, 25),
        ("NameProperty", 6, 0x10157431, 0x101D7088, 25),
        ("ArrayProperty", 9, 0x1015747F, 0x101D70E4, 25),
        ("StructProperty", 10, 0x10157498, 0x101D7100, 28),
        ("StrProperty", 13, 0x101574E6, 0x101D7160, 25),
        ("Vector", 87, 0x10157650, 0x101D7250, 25),
        ("Rotator", 88, 0x1015766C, 0x101D7260, 25),
        ("Color", 90, 0x10157685, 0x101D7270, 25),
    ]:
        data = raw(core, at, at + length)
        assert data == comparison.read(at, length)
        core.instruction(at + 7, "push", hex(index) if index > 9 else str(index))
        core.instruction(at + 9, "push", hex(text_at))
        core.instruction(at + 14, "call", "0x101036f2")
        core.instruction(at + length - 5, "call", "0x1010180c")
        assert core.wide(text_at) == name
        assert raw(core, text_at, text_at + (len(name) + 1) * 2) == comparison.read(
            text_at, (len(name) + 1) * 2
        )
        proof["names"].append(
            dict(
                name=name,
                index=index,
                start=hex(at),
                end=hex(at + length),
                SHA256=hashlib.sha256(data).hexdigest(),
            )
        )
    for kind in (
        "Byte",
        "Int",
        "Bool",
        "Float",
        "Object",
        "Class",
        "Name",
        "Array",
        "Struct",
        "Str",
    ):
        name = "??_7U" + kind + "Property@@6B@"
        table = core.exported(name)
        descriptor = "?PrivateStaticClass@U" + kind + "Property@@0VUClass@@A"
        assert core.exported(descriptor) == comparison.exports[descriptor]
        for slot in (0x90, 0xA4, 0xA8, 0xB4):
            target = core.u32(table + slot)
            assert target == comparison.u32(comparison.exports[name] + slot)
            proof["vtables"].append(dict(name=name, slot=hex(slot), target=hex(target)))
    return program


class DefaultLoadingMachine(StringLoadingMachine):

    def name(self, value):
        if not hasattr(self, "names"):
            self.names = {}
            self.name_values = {}
        key = value.casefold()
        if key in self.names:
            return self.names[key]
        index = self.reserved.get(key, 0x1000 + len(self.names))
        ptr = self.allocate((len(value.encode("utf-16le")) + 17) & ~3)
        self.put_text(ptr + 12, value)
        self.memory[0xB10000 + index * 4] = ptr
        self.names[key] = index
        self.name_values[index] = value
        return index

    def __init__(self, program, declarations):
        self.reserved = {
            r["name"].casefold(): r["index"]
            for r in program.receipt["defaultTagLoading"]["names"]
        }
        self.declarations = declarations
        super().__init__(
            program,
            dict(
                object=dict(index=0, flags=0, name="Authored", outer=None),
                classInfo=dict(
                    flags=0x32,
                    name="Authored",
                    outer=None,
                    structure=dict(fields=[], super=None),
                ),
                isEditor=False,
                environment=dict(started=True, configAbsent=True, language="int"),
                policy="missing",
                scratchCounter=0,
            ),
        )
        self.name_reads = []
        self.reference_reads = []
        self.property_pointers = {}
        self.structures = {}
        self.ref_values = {0: None}
        self.applied = []
        self.memory[self.archive + 4] = 123
        self.memory[self.archive + 0x1C] = 0
        for slot, target in [
            (4, 0xD22000),
            (0x18, 0xD22008),
            (0x1C, 0xD2200C),
            (0x28, 0xD22010),
            (0x10, 0xD22014),
        ]:
            self.memory[0xD21000 + slot] = target
        self.memory[0x10235020] = 0
        for a in range(0x101331D0, 0x101331F4, 4):
            self.memory[a] = self.source.engine.u32(a)
        for a in range(0x101331F4, 0x10133265):
            self.write(
                f"byte ptr [{a:#x}]",
                self.source.engine.data[self.source.engine.offset(a)],
            )

    def property(self, f):
        key = f["identity"]
        if key in self.property_pointers:
            return self.property_pointers[key]
        ptr = self.allocate(0x80)
        self.property_pointers[key] = ptr
        self.fields[ptr] = key
        kind = f["kind"]
        table = self.source.engine.exported("??_7U" + kind + "@@6B@")
        cls = self.source.engine.exported(
            "?PrivateStaticClass@U" + kind + "@@0VUClass@@A"
        )
        self.memory.update(
            {
                ptr: table,
                ptr + 0x24: cls,
                ptr + 0x20: self.name(f["name"]),
                cls + 0x34: 0,
                cls + 0x4A4: 0x8000,
                cls + 0x20: self.name(kind),
            }
        )
        for off, key in [
            (0x40, "arrayDim"),
            (0x44, "elementSize"),
            (0x48, "propertyFlags"),
            (0x54, "offset"),
        ]:
            self.memory[ptr + off] = f[key]
        for slot in [0x90, 0xA4, 0xA8, 0xB4]:
            self.memory[table + slot] = self.source.engine.u32(table + slot)
        if kind == "BoolProperty":
            self.memory[ptr + 0x78] = f["boolMask"]
        if kind == "StructProperty":
            self.memory[ptr + 0x78] = self.structure_source(
                f["reference"].casefold(), False
            )
        if kind == "ArrayProperty":
            inner = f["inner"]
            innerptr = self.allocate(0x80)
            self.memory[ptr + 0x78] = innerptr
            self.memory[innerptr + 0x44] = inner["elementSize"]
            self.memory[innerptr + 0x48] = inner["propertyFlags"]
        return ptr

    def structure_source(self, key, is_class=True):
        if key in self.structures:
            return self.structures[key]
        layout = self.declarations["classLinks" if is_class else "structureLinks"][key]
        ptr = self.allocate(0x500)
        self.structures[key] = ptr
        table = self.source.engine.exported(
            "??_7UClass@@6B@" if is_class else "??_7UStruct@@6B@"
        )
        for slot in [0x78, 0x7C, 0x84, 0x88]:
            self.memory[table + slot] = self.source.engine.u32(table + slot)
        self.memory.update(
            {
                ptr: table,
                ptr + 0x20: self.name(layout["identity"].split(".")[-1]),
                ptr + 0x4C: layout["propertiesSize"],
                ptr + 0x4A4: 0x32,
            }
        )
        sup = self.declarations["classes" if is_class else "structures"][key][
            "savedSuper"
        ]
        self.memory[ptr + 0x34] = (
            self.structure_source(sup.casefold(), is_class) if sup else 0
        )
        fields = {f["identity"]: self.property(f) for f in layout["fields"]}
        for head, link in [(0x70, 0x58), (0x78, 0x60)]:
            ids = layout["lists"][hex(head)]
            self.memory[ptr + head] = fields[ids[0]] if ids else 0
            for n, identity in enumerate(ids):
                self.memory[fields[identity] + link] = (
                    fields[ids[n + 1]] if n + 1 < len(ids) else 0
                )
        ids = [f["identity"] for f in layout["ownFields"]]
        self.memory[ptr + 0x48] = fields[ids[0]] if ids else 0
        for n, identity in enumerate(ids):
            self.memory[fields[identity] + 0x38] = (
                fields[ids[n + 1]] if n + 1 < len(ids) else 0
            )
        return ptr

    def step(self, i):
        sp = self.registers["esp"]
        if i.address == 0x10131090:
            self.applied.append(
                (self.fields[self.memory[sp + 8]], self.memory[sp + 12], self.cursor)
            )
        if i.mnemonic == "call":
            target = self.read(i.op_str)
            if target in (0xD22000, 0xD22008, 0xD2200C, 0xD22010, 0xD22014):
                assert self.registers["ecx"] == self.archive
                if target == 0xD22010:
                    self.registers["eax"] = self.cursor
                elif target == 0xD22014:
                    assert self.memory[sp] in self.structures.values()
                    self.registers["esp"] += 4
                elif target == 0xD22000:
                    dest, size = self.memory[sp], self.memory[sp + 4]
                    assert self.cursor + size <= len(self.payload)
                    for n, v in enumerate(
                        self.payload[self.cursor : self.cursor + size]
                    ):
                        self.write(f"byte ptr [{dest+n:#x}]", v)
                    self.cursor += size
                    self.registers["esp"] += 8
                else:
                    reader = Reader(self.payload, self.cursor)
                    value = reader.compact()
                    self.cursor = reader.pos
                    if target == 0xD2200C:
                        index = value
                        value = self.name(self.package.name(value))
                        self.name_reads.append([index, value])
                    else:
                        identity = qualified_ref(self.package, value) if value else None
                        self.reference_reads.append([value, identity])
                        if identity not in self.ref_values.values():
                            self.ref_values[0xDB0000 + len(self.ref_values) * 4] = (
                                identity
                            )
                        value = next(
                            k for k, v in self.ref_values.items() if v == identity
                        )
                    self.memory[self.memory[sp]] = value
                    self.registers["eax"] = self.archive
                    self.registers["esp"] += 4
                self.visited.append(i.address)
                return i.address + i.size
        if i.mnemonic == "sete":
            self.write(i.op_str, int(self.zero))
            self.visited.append(i.address)
            return i.address + i.size
        if i.mnemonic == "jmp" and i.op_str.startswith("dword ptr"):
            self.visited.append(i.address)
            return self.read(i.op_str)
        return super().step(i)


def leaf_fields(layout, declarations, base=0):
    for field in layout["fields"]:
        for index in range(field["arrayDim"]):
            offset = base + field["offset"] + index * field["elementSize"]
            if field["kind"] == "StructProperty":
                yield from leaf_fields(
                    declarations["structureLinks"][field["reference"].casefold()],
                    declarations,
                    offset,
                )
            else:
                yield offset, field


def project_storage(machine, declarations, layout, destination):
    size = layout["propertiesSize"]
    image = [0] * size
    for offset in range(0x34, size):
        image[offset] = machine.byte(destination + offset)
    values = []
    for offset, field in leaf_fields(layout, declarations):
        kind = field["kind"]
        if offset < 0x34 or kind not in (
            "ObjectProperty",
            "ClassProperty",
            "NameProperty",
            "StrProperty",
            "ArrayProperty",
        ):
            continue
        if kind == "StrProperty":
            value = b"".join(
                unit.to_bytes(2, "little")
                for unit in machine.stored_units(destination + offset)[:-1]
            ).decode("utf-16le", errors="surrogatepass")
        elif kind == "ArrayProperty":
            # This source corpus has no array tags. Nonempty raw copies are
            # separately covered by the existing CDO copy verifier.
            assert [machine.memory[destination + offset + n * 4] for n in range(3)] == [
                0,
                0,
                0,
            ]
            value = []
        elif kind == "NameProperty":
            value = machine.memory[destination + offset]
        else:
            value = machine.ref_values[machine.memory[destination + offset]]
        values.append([offset, value])
        image[offset : offset + field["elementSize"]] = [0] * field["elementSize"]
    return dict(bytes=image, values=sorted(values))


BROWSER_SCRIPT = r"""
const {loadClassDefaultProperties}=await import(process.argv[1]);
let raw='';for await(const part of process.stdin)raw+=part;
const states=new Map();process.stdout.write(JSON.stringify(JSON.parse(raw).map(row=>{
 const names=[],references=[];
 const result=loadClassDefaultProperties({...row,parent:row.parent?states.get(row.parent):null,
  structures:new Map(row.structures.map(s=>[s.identity,s])),
  resolveName:i=>{const v=row.names[i];names.push([i,v]);return v;},
  resolveReference:i=>{const v=row.references[i];references.push([i,v]);return v;}});
 if(result.status!=='ready')throw Error(row.identity+': '+JSON.stringify(result));
 states.set(row.identity,result);
 return {bytes:result.bytes,values:[...result.values].sort((a,b)=>a[0]-b[0]),applied:result.applied,names,references};
})));
"""


def verify(core, comparison, runtime):
    program = tag_program(core, comparison)
    report = inspect_declarations(
        DEFAULT_CLASSES, include_class_links=True, include_reference_flags=True
    )
    assert report["sources"] == {
        "Engine.u": "9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761",
        "Core.u": "de5f0ee0a773327bce13c96622fd3c654cff7db88b9be065d1232590c140fda0",
        "GamePlay.u": "714639cdad265a7caeaf0f91ce76bb50492390eaa3faea15ed5a28a3e830b64a",
        "Core.dll": CORE_SHA,
        "engine.dll": "07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0",
    }
    machine = DefaultLoadingMachine(program, report)
    catalog = OriginalClasses()
    records, browser_rows, expected = [], [], []
    initialized = []
    for key, layout in report["classLinks"].items():
        cls = machine.structure_source(key)
        size = layout["propertiesSize"]
        destination = machine.allocate(size)
        # Include every initialized ancestor/sibling body and dynamic allocation
        # in the preserved-parent check. Source-name tables may grow separately.
        before = {}
        for prior, prior_layout in initialized:
            ranges = [(prior, prior_layout["propertiesSize"])]
            for offset, field in leaf_fields(prior_layout, report):
                if offset >= 0x34 and field["kind"] == "StrProperty":
                    ptr = machine.memory[prior + offset]
                    if ptr:
                        ranges.append((ptr, machine.blocks[ptr]))
            for ptr, length in ranges:
                before.update({ptr + n: machine.byte(ptr + n) for n in range(length)})
        preserved = {
            reg: machine.registers[reg] for reg in ("ebx", "esi", "edi", "ebp")
        }
        machine.actor = destination
        machine.invoke(0x1015FE10, destination, (cls, 0))
        header = [0] * 13
        header[0], header[1], header[9], header[10] = (
            machine.memory[cls],
            0xFFFFFFFF,
            cls,
            0xFFFFFFFF,
        )
        assert [machine.memory[destination + n * 4] for n in range(13)] == header
        package, export, record = serialized_class_record(catalog, layout["identity"])
        start = export.serial_offset + record["defaults"]["defaultsOffset"]
        machine.package = package
        machine.payload = bytes(
            package.data[start : export.serial_offset + export.serial_size]
        )
        machine.cursor = 0
        machine.name_reads = []
        machine.reference_reads = []
        applied_start = len(machine.applied)
        machine.invoke(
            0x101346E0, cls, (machine.archive, destination, machine.memory[cls + 0x34])
        )
        assert machine.cursor == len(machine.payload)
        assert {reg: machine.registers[reg] for reg in preserved} == preserved
        assert [machine.memory[destination + n * 4] for n in range(13)] == header
        assert all(machine.byte(at) == value for at, value in before.items())
        machine.memory[cls + 0x4F4] = destination
        machine.memory[cls + 0x4F8] = size
        projected = project_storage(machine, report, layout, destination)
        projected["applied"] = [
            dict(field=field, offset=at - destination, cursor=cursor)
            for field, at, cursor in machine.applied[applied_start:]
        ]
        projected["names"] = machine.name_reads
        projected["references"] = machine.reference_reads
        expected.append(projected)

        def bind(current):
            return dict(
                current,
                parentSize=report["classLayouts"]
                .get(current["identity"].casefold(), {})
                .get("parentSize", 0),
                nameId=machine.name(current["identity"].split(".")[-1]),
                fields=[
                    dict(field, nameId=machine.name(field["name"]))
                    for field in current["fields"]
                ],
            )

        browser_rows.append(
            dict(
                identity=key,
                parent=(report["classes"][key]["savedSuper"] or "").casefold(),
                layout=bind(layout),
                structures=[bind(value) for value in report["structureLinks"].values()],
                names=dict(machine.name_reads),
                references=dict(machine.reference_reads),
                payload=list(machine.payload),
                archiveFlags1c=0,
            )
        )
        records.append(
            dict(
                identity=layout["identity"],
                size=size,
                ownTags=len(record["tags"]),
                appliedProperties=len(projected["applied"]),
                source=record["defaults"],
                storage=projected,
            )
        )
        initialized.append((destination, layout))
    actual = browser_outputs(BROWSER_SCRIPT, browser_rows, runtime)
    assert len(actual) == len(expected)
    for index, (got, wanted) in enumerate(zip(actual, expected)):
        assert got == wanted, (
            "default loading differs",
            browser_rows[index]["identity"],
            [key for key in wanted if got[key] != wanted[key]],
        )
    paths = [
        Path(__file__).resolve(),
        ROOT / "tools/ui/actor_localization_source.py",
        ROOT / "tools/ui/check_actor_localization_native.py",
        ROOT / "tools/ui/actor_transform_source.py",
        ROOT / "tools/ui/static_collision_source.py",
        ROOT / "tools/ui/actor_octree_admission_machine.py",
        ROOT / "tools/l2lib/propertylayout.py",
        ROOT / "tools/l2lib/classdata.py",
        ROOT / "tools/world/inspect_actor_declarations.py",
        ROOT / "tools/world/convert.py",
        runtime.resolve(),
        runtime.resolve().with_name("actor-loading.js"),
    ]
    return dict(
        tool="Elbera Tools",
        status="pass",
        scope="original-class-default-tag-loading",
        classes=len(records),
        ownTags=sum(row["ownTags"] for row in records),
        appliedProperties=len(machine.applied),
        instructions=len(machine.visited),
        uniqueInstructions=len(set(machine.visited)),
        browserStorageCompared=True,
        parentStoragePreserved=True,
        nonvolatileRegistersPreserved=True,
        headerWordsChecked=13,
        sources=report["sources"],
        source=program.receipt,
        records=records,
        sourceSHA256={
            str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in paths
        },
        limits=[
            "Original initialization plus matching-type file-123 saved tags, before LoadConfig/LoadLocalized; not complete class binding or world startup.",
            "Current recomputed metadata and preloaded structures are supplied from the separately verified inherited linker. Property-class descriptors retain only consumed flags and identity behavior.",
            "Archive bytes are original; name indices and object references use explicit synchronous identity providers, not an executed ULinkerLoad factory or native name registry.",
            "Header fields are checked natively. Browser scalar bytes retain exact bits; native pointers/headers are projected into independent strings, raw arrays and supplied reference/name identities.",
            "Unknown/rejected tags, type conversions, nonempty saved arrays, other editions, saving and exception paths remain outside browser admission. Payload length and string termination checks are safety admission, not invented original rules.",
            "Full output contains private decoded default values and must not be published.",
        ],
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--core", type=Path, default=ROOT / "assets/interlude/system/Core.dll"
    )
    parser.add_argument("--comparison-core", type=Path, required=True)
    parser.add_argument(
        "--runtime", type=Path, default=ROOT / "editor/world/js/class-defaults.js"
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = verify(
        Image(args.core, CORE_SHA),
        PEImage(args.comparison_core, CANDIDATE_CORE_SHA),
        args.runtime,
    )
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(
        json.dumps(
            {
                key: value
                for key, value in result.items()
                if key not in ("source", "sourceSHA256", "records")
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
