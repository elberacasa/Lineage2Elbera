"""Elbera Tools: composed ordinary AddActor/RemoveActor interpretation.

GLog is explicitly null. Ordinary actor primitive selection executes original
code. Bounding-box calls either execute the generic nonnull-owner method or
consume an explicit override response, with caller/callee cleanup preserved.
"""

from collections import namedtuple
import math
import struct

from actor_octree_machine import MembershipMachine
from actor_octree_admission_source import ASSERT, LOG, NAME

PartialWord = namedtuple("PartialWord", "value mask")


class AdmissionMachine(MembershipMachine):
    def __init__(self, program):
        super().__init__(
            program,
            {
                0x11D8D6D4: 0xB00000,
                0xB00000: 0,  # explicit null GLog
                0x11D8DBE4: 0xB00004,
                0xB00004: 0,  # explicit GIsEditor=false
                0x108B3030: 0x10302CE3,  # qualified provider RemoveActor
                0x10851FD0: 0x1030F74A,  # ordinary AActor.GetPrimitive
                0x10853AE4: 0x1030CEA0,  # generic UPrimitive bbox
                0xA10078: 0xA20000,  # authored bounds override
            },
        )
        self.responses = {}
        self.admission_events = []

    def write(self, operand, value, floating=False):
        if operand.startswith("byte ptr"):
            at = self.address(operand)
            base, shift = at & ~3, (at & 3) * 8
            old = self.memory.get(base)
            if isinstance(old, float):
                # MOV can alias a previously stored Float32 stack cell. Byte
                # stores change its bits, not the floating-point numeric value.
                self.memory[base] = struct.unpack("<I", struct.pack("<f", old))[0]
            if old is None or isinstance(old, PartialWord):
                prior = old or PartialWord(0, 0)
                self.memory[base] = PartialWord(
                    (prior.value & ~(255 << shift)) | ((value & 255) << shift),
                    prior.mask | (255 << shift),
                )
                return
        return super().write(operand, value, floating)

    def read(self, operand):
        if operand.startswith("byte ptr"):
            at = self.address(operand)
            value = self.memory[at & ~3]
            shift = (at & 3) * 8
            if isinstance(value, PartialWord):
                assert value.mask & (255 << shift) == 255 << shift
                value = value.value
            return (value >> shift) & 255
        return super().read(operand)

    def step(self, i):
        if i.address in self.source.admission_imports:
            name = self.source.admission_imports[i.address]
            assert name not in (ASSERT, LOG, NAME), (
                "unadmitted diagnostic path",
                hex(i.address),
                name,
            )
        if i.address == 0x106025E0:
            self.admission_events.append(
                ["remove", self.memory[self.registers["esp"] + 4]]
            )
        if i.address == 0x10602BF0:
            self.admission_events.append(
                [
                    "primitive",
                    self.registers["eax"],
                    self.memory[self.registers["ebx"] + 0x16C],
                ]
            )
        if i.mnemonic == "fucompp":
            a, b = self.stack[:2]
            assert math.isfinite(a) and math.isfinite(b)
            self.status = 0x100 if a < b else 0x4000 if a == b else 0
            del self.stack[:2]
            self.visited.append(i.address)
            return i.address + i.size
        if i.address == 0x10602BFC:
            sp = self.registers["esp"]
            dest, actor = self.memory[sp], self.memory[sp + 4]
            primitive = self.registers["ecx"]
            self.admission_events.append(["bounds", primitive, actor])
            if self.registers["edx"] == 0xA20000:
                box = self.responses[primitive]
                self.memory.update(
                    {dest + n * 4: v for n, v in enumerate([*box["min"], *box["max"]])}
                )
                self.memory[dest + 24] = PartialWord(1, 255)
                self.registers["eax"] = dest
                self.registers["esp"] += 8
                self.visited.append(i.address)
                return i.address + i.size
            assert self.registers["edx"] == 0x1030CEA0
        return super().step(i)


def create_admission_machine(program):
    m = AdmissionMachine(program)
    provider, root = 0x120000, 0x100000
    m.memory.update({provider: 0x108B3024, provider + 4: root})
    m.invoke(0x10601A10, root)
    # Execute the qualified initializer with its source constant, not BSS data.
    m.invoke(0x108464A0)
    assert [m.memory[0x10DAD240 + i * 4] for i in range(4)] == [0.0, 0.0, 0.0, 360448.0]
    return m, provider, root
