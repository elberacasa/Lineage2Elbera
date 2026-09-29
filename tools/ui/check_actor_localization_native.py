#!/usr/bin/env python3
"""Elbera Tools: original localization versus the browser's supplied-state port.

Interprets pinned Core instructions using the existing admission interpreter.
CRT formatting/comparison, configuration and virtual ImportText are explicit
authored providers. No DLL executes; no original payload is embedded or written.
"""

import argparse
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

from actor_localization_source import qualify_actor_localization
from actor_octree_admission_machine import AdmissionMachine
from check_static_sweep_native import PreparationProgram
from check_static_mesh_native import browser_outputs
from check_tutorial_quest_native import Image
from check_supplemental_engine import CORE_SHA, CANDIDATE_CORE_SHA
from supplemental_pe import PEImage

ROOT = Path(__file__).resolve().parents[2]


def source_program(core, comparison):
    proof = qualify_actor_localization(core, comparison)
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
        for index, byte in enumerate(value.encode("utf-16le") + b"\0\0"):
            self.write(f"byte ptr [{at + index:#x}]", byte)

    def text(self, at):
        result = bytearray()
        for index in range(1024):
            pair = bytes((self.byte(at + index * 2), self.byte(at + index * 2 + 1)))
            if pair == b"\0\0":
                return result.decode("utf-16le")
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
const {loadActorLocalized}=await import(process.argv[1]);
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
 const result=loadActorLocalized({...row,environment,importText:()=>({status:'ready'})});
 return {status:result.status,context:result.context,imports:result.imports,lookups};
})));
"""


def verify(core, comparison, runtime):
    program = source_program(core, comparison)
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
        source=program.receipt,
        sourceSHA256={
            str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (
                Path(__file__).resolve(),
                Path(__file__).with_name("actor_localization_source.py").resolve(),
                runtime.resolve(),
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
                if key not in ("source", "sourceSHA256")
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
