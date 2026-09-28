"""Elbera Tools: original nonzero query execution with explicit method responses.

Executes original wrapper, recursive node traversal, owner-chain predicate,
scratch constructor and minimum-hit reduction. Virtual trace/line responses and
successful memory-stack allocation are supplied; no native DLL is executed.
"""

import math

from actor_octree_admission_machine import AdmissionMachine

RESULT_FIELDS = {
    "next": (0, 1),
    "actor": (4, 1),
    "point": (8, 3),
    "normal": (20, 3),
    "item": (32, 1),
    "time": (36, 1),
    "nodeIndex": (40, 1),
    "material": (44, 1),
}


class QueryMachine(AdmissionMachine):
    def __init__(self, program):
        super().__init__(program)
        self.memory.update(
            {
                0x108D5DE0: program.query_max_time,
                0x10851FCC: 0xA30000,  # explicit ShouldTrace virtual response
                0xA1006C: 0xA30004,  # explicit LineCheck virtual response
            }
        )
        self.trace_responses = {}
        self.line_responses = {}
        self.query_events = []
        self.zero_divisions = 0

    def result(self, address):
        return {
            key: (
                self.memory[address + off]
                if count == 1
                else [self.memory[address + off + i * 4] for i in range(count)]
            )
            for key, (off, count) in RESULT_FIELDS.items()
        }

    def step(self, i):
        op, args = i.mnemonic, i.op_str.split(", ")
        nxt, sp = i.address + i.size, self.registers["esp"]
        if i.address == 0x105FFE30:
            self.query_events.append(
                ["tag", self.registers["esi"], self.registers["eax"]]
            )
        if i.address == 0x105FFE51:
            self.query_events.append(["owned", self.registers["ecx"], self.memory[sp]])
        if i.address == 0x105FFEEF:
            self.query_events.append(
                ["primitive", self.registers["esi"], self.registers["eax"]]
            )
        if i.address == 0x105FFE6D:
            assert self.registers["edx"] == 0xA30000
            actor = self.registers["ecx"]
            source, flags = self.memory[sp], self.memory[sp + 4]
            self.query_events.append(["should", actor, source, flags])
            self.registers["eax"] = self.trace_responses[actor]
            self.registers["esp"] += 8
        elif i.address == 0x105FFF45:
            assert self.registers["eax"] == 0xA30004
            primitive = self.registers["ecx"]
            dest, actor = self.memory[sp], self.memory[sp + 4]
            values = [self.memory[sp + 8 + n * 4] for n in range(11)]
            self.query_events.append(
                ["line", primitive, actor, values, self.result(dest)]
            )
            response = self.line_responses[actor]
            for key, value in response["writes"].items():
                off, count = RESULT_FIELDS[key]
                parts = [value] if count == 1 else value
                assert len(parts) == count
                self.memory.update({dest + off + n * 4: v for n, v in enumerate(parts)})
            self.registers["eax"] = (
                0 if response["hit"] else response.get("clearReturn", 1)
            )
            self.registers["esp"] += 52
        elif i.address == 0x10522313:
            assert self.registers["ecx"] == 0xB10000
            self.registers["eax"] = 0xB20000
            nxt = i.address + 6
        elif i.address == 0x1052231B:
            assert self.registers["ecx"] == 0xB20000
            size, align = self.memory[sp], self.memory[sp + 4]
            assert (size, align) == (48, 8)
            self.registers["eax"] = self.allocate(size)
            assert self.registers["eax"] % align == 0
            self.registers["esp"] += 8
            nxt = i.address + 6
        elif op == "neg":
            old = self.read(args[0]) & 0xFFFFFFFF
            value = (-old) & 0xFFFFFFFF
            self.flags(value, old != 0, old == 0x80000000)
            self.write(args[0], value)
        elif op == "sbb":
            a, b = (self.read(arg) & 0xFFFFFFFF for arg in args)
            total = a - b - int(self.carry)
            value = total & 0xFFFFFFFF
            self.flags(value, total < 0, bool((a ^ b) & (a ^ value) & 0x80000000))
            self.write(args[0], value)
        elif op in ("fdiv", "fdivr", "fdivp", "fdivrp"):
            pop = op.endswith("p")
            target = args[0] if pop or len(args) == 2 else "st(0)"
            other = "st(0)" if pop else args[1] if len(args) == 2 else args[0]
            a, b = self.read(target), self.read(other)
            numerator, denominator = (b, a) if op in ("fdivr", "fdivrp") else (a, b)
            assert math.isfinite(numerator) and math.isfinite(denominator)
            if denominator == 0:
                assert (
                    i.address in (0x10600A68, 0x10600A72, 0x10600A77) and numerator == 1
                )
                value = math.copysign(math.inf, denominator)
                self.zero_divisions += 1
            else:
                value = numerator / denominator
            self.write(target, value)
            if pop:
                self.stack.pop(0)
        else:
            return super().step(i)
        self.visited.append(i.address)
        return nxt
