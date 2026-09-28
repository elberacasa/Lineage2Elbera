#!/usr/bin/env python3
"""Elbera Tools: recover the original GMath table for an explicit SSE2 profile.

Read-only by default. --output explicitly writes a PRIVATE original-derived
table, which must not be committed or included in public tool bundles.
Interprets retained instructions; no DLL execution and no host sine function.
Other startup profiles and the x87 FSIN fallback remain unsupported.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

from check_cast_sound_native import RandomMachine
from check_tutorial_quest_native import Image
from check_supplemental_engine import CORE_SHA, CANDIDATE_CORE_SHA
from supplemental_pe import PEImage
from gmath_source import qualify_gmath

ROOT = Path(__file__).resolve().parents[2]
PROFILE = "source-sse2-RNE-PC53"
START, END = 0x1018649E, 0x10186647


class SineProgram:
    def __init__(self, core, comparison):
        self.core = core
        self.comparison = comparison
        self.binding = qualify_gmath(core, comparison)
        self.raw = self.read(START, END - START)
        self.rows = {i.address: i for i in core.dis.disasm(self.raw, START)}

    def read(self, address, width):
        data = bytes(
            self.core.data[
                self.core.offset(address) : self.core.offset(address) + width
            ]
        )
        assert data == self.comparison.read(address, width)
        return data

    def f64_at(self, address):
        return struct.unpack("<d", self.read(address, 8))[0]


def output_word(value):
    return struct.pack("<f", value).hex()


class SineMachine:
    def __init__(self, program, arg):
        self.source = program
        self.gpr = dict.fromkeys(
            ["eax", "ebx", "ecx", "edx", "esi", "edi", "esp", "ebp"], 0
        )
        self.gpr["esp"] = 0x800000
        self.xmm = {f"xmm{i}": [None, None] for i in range(8)}
        self.xmm["xmm0"] = [arg, 0.0]
        self.memory = {}
        self.stack = []
        self.visited = []
        self.reads = set()
        self.z = self.c = self.s = self.o = False

    def address(self, operand):
        expression = operand[operand.index("[") + 1 : operand.index("]")]
        terms = expression.split(" + ")
        return sum(self.gpr[p] if p in self.gpr else int(p, 0) for p in terms)

    def read(self, operand, width=8):
        if operand in self.xmm:
            return self.xmm[operand][:]
        if "[" in operand:
            ptr = self.address(operand)
            if ptr in self.memory:
                return [self.memory[ptr], None]
            self.reads.add((ptr, width))
            raw = self.source.read(ptr, width)
            return list(struct.unpack("<dd" if width == 16 else "<d", raw)) + (
                [] if width == 16 else [None]
            )
        if operand == "ax":
            return self.gpr["eax"] & 65535
        if operand in self.gpr:
            return self.gpr[operand]
        return int(operand, 0)

    def write(self, operand, value):
        if operand == "ax":
            self.gpr["eax"] = (self.gpr["eax"] & 0xFFFF0000) | (value & 65535)
        elif operand in self.gpr:
            self.gpr[operand] = value & 0xFFFFFFFF
        elif "[" in operand:
            self.memory[self.address(operand)] = value
        else:
            raise AssertionError(operand)

    def compare(self, a, b, width=32):
        mask = (1 << width) - 1
        sign = 1 << (width - 1)
        a &= mask
        b &= mask
        v = (a - b) & mask
        self.z = v == 0
        self.c = a < b
        self.s = bool(v & sign)
        self.o = bool((a ^ b) & (a ^ v) & sign)

    def run(self):
        pc = START
        for _ in range(300):
            i = self.source.rows[pc]
            self.visited.append(pc)
            op = i.mnemonic
            args = i.op_str.split(", ")
            nxt = pc + i.size
            if op == "pextrw":
                assert args[2] == "3"
                self.write(
                    args[0],
                    struct.unpack("<4H", struct.pack("<d", self.xmm[args[1]][0]))[3],
                )
            elif op in ("and", "add", "sub", "shr", "shl"):
                a, b = self.read(args[0]), self.read(args[1])
                width = 16 if args[0] == "ax" else 32
                value = (
                    a & b
                    if op == "and"
                    else (
                        a + b
                        if op == "add"
                        else a - b if op == "sub" else a >> b if op == "shr" else a << b
                    )
                )
                if op == "sub":
                    self.compare(a, b, width)
                self.write(args[0], value)
            elif op == "cmp":
                self.compare(
                    self.read(args[0]),
                    self.read(args[1]),
                    16 if args[0] == "ax" else 32,
                )
            elif op.startswith("j"):
                take = {
                    "ja": not self.c and not self.z,
                    "jg": not self.z and self.s == self.o,
                    "jne": not self.z,
                    "jmp": True,
                }[op]
                if take:
                    nxt = int(args[0], 0)
            elif op == "lea":
                self.write(args[0], self.address(args[1]))
            elif op == "movapd":
                self.xmm[args[0]] = self.read(args[1], 16)
            elif op in ("movlpd", "movsd"):
                if "[" in args[0]:
                    self.write(args[0], self.xmm[args[1]][0])
                else:
                    # All admitted MOVSD operands are register-to-register.
                    assert op != "movsd" or args[1] in self.xmm
                    self.xmm[args[0]][0] = self.read(args[1])[0]
            elif op in ("unpcklpd", "unpckhpd"):
                a, b = self.xmm[args[0]][:], self.xmm[args[1]][:]
                n = 0 if op == "unpcklpd" else 1
                self.xmm[args[0]] = [a[n], b[n]]
            elif op in ("mulsd", "addsd", "subsd", "mulpd", "addpd", "subpd"):
                n = 2 if op.endswith("pd") else 1
                a = self.xmm[args[0]][:]
                b = self.read(args[1], n * 8)
                for k in range(n):
                    self.xmm[args[0]][k] = (
                        None
                        if a[k] is None or b[k] is None
                        else (
                            a[k] * b[k]
                            if op.startswith("mul")
                            else a[k] + b[k] if op.startswith("add") else a[k] - b[k]
                        )
                    )
            elif op == "cvtsd2si":
                self.write(args[0], round(self.xmm[args[1]][0]))
            elif op == "fld":
                self.stack.insert(0, self.read(args[0])[0])
            elif op == "ret":
                assert (
                    len(self.stack) == 1
                    and self.stack[0] is not None
                    and self.gpr["esp"] == 0x800000
                )
                return self.stack[0]
            else:
                raise AssertionError((hex(pc), op, i.op_str))
            assert nxt in self.source.rows, (
                "outside admitted source table-argument path",
                hex(nxt),
            )
            pc = nxt
        raise AssertionError("sine slice did not terminate")


class ConstructorSineMachine(RandomMachine):
    """Retained constructor loop, with the qualified SSE2 kernel as its call."""

    def __init__(self, program):
        self.source = program
        C = program.core
        lo, hi = 0x1014D49C, 0x1014D4E8
        data = program.read(lo, hi - lo)
        rows = list(C.dis.disasm(data, lo))
        registers = dict.fromkeys(
            ["eax", "ebx", "ecx", "edx", "esi", "edi", "esp", "ebp"], 0
        )
        registers.update(esi=0x100000, esp=0x800000)
        super().__init__(
            {
                0x101D4558: program.f64_at(0x101D4558),
                0x101D5E38: program.f64_at(0x101D5E38),
            },
            registers,
            rows,
        )
        self.arguments = []
        self.visited = []
        self.kernel_visits = set()
        self.kernel_reads = set()
        self.kernel_steps = 0
        self.zero = self.less = self.carry = self.sign = self.parity = False

    def step(self, i):
        self.visited.append(i.address)
        if i.mnemonic == "fild":
            self.stack.insert(0, float(self.read(i.op_str)))
        elif i.mnemonic == "call":
            assert i.address == 0x1014D4CC and i.op_str == "0x101048fe"
            argument = self.memory[self.registers["esp"]]
            self.arguments.append(argument)
            child = SineMachine(self.source, argument)
            self.stack.insert(0, child.run())
            self.kernel_visits.update(child.visited)
            self.kernel_reads.update(child.reads)
            self.kernel_steps += len(child.visited)
        else:
            return super().step(i)
        return i.address + i.size

    def generate(self):
        pc = 0x1014D49C
        for _ in range(400000):
            if pc == 0x1014D4E8:
                assert (
                    len(self.arguments) == 16384
                    and not self.stack
                    and self.registers["esp"] == 0x800000
                )
                return [self.memory[0x10008C + i * 4] for i in range(16384)]
            pc = self.step(self.program[pc])
        raise AssertionError("constructor loop failed to terminate")


def recover(core, comparison, profile):
    if profile != PROFILE:
        raise ValueError("explicit supported SSE2/RNE/PC53 profile required")
    program = SineProgram(core, comparison)
    ctor = ConstructorSineMachine(program)
    table = ctor.generate()
    words = [output_word(v) for v in table]
    raw = b"".join(bytes.fromhex(v) for v in words)
    receipt = dict(
        tool="Elbera Tools",
        status="pass",
        profile=profile,
        source=program.binding,
        kernelRange=[hex(START), hex(END)],
        kernelSHA256=hashlib.sha256(program.raw).hexdigest(),
        entries=len(table),
        tableSHA256=hashlib.sha256(raw).hexdigest(),
        sourceConstantReads=[
            dict(
                address=hex(p),
                bytes=n,
                SHA256=hashlib.sha256(program.read(p, n)).hexdigest(),
            )
            for p, n in sorted(ctor.kernel_reads)
        ],
        kernelAddresses=len(ctor.kernel_visits),
        kernelSteps=ctor.kernel_steps,
        constructorInstructions=len(ctor.visited),
        constructorAddresses=len(set(ctor.visited)),
        argumentSHA256=hashlib.sha256(
            b"".join(struct.pack("<d", v) for v in ctor.arguments)
        ).hexdigest(),
        verifierSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        scope="Retained GMath constructor and SSE2 sine kernel for constructor arguments, with explicit CPU/OS support, masked exceptions, RNE and x87 PC53. Static startup joins qualified; actual hardware/control state unobserved. No FSIN fallback or extended-exponent edge domain.",
    )
    return receipt, words


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--core", type=Path, default=ROOT / "assets/interlude/system/Core.dll"
    )
    parser.add_argument("--comparison-core", type=Path, required=True)
    parser.add_argument("--profile", required=True, choices=[PROFILE])
    parser.add_argument(
        "--output",
        type=Path,
        help="explicit private original-derived JSON output; never publish",
    )
    parser.add_argument("--check", action="store_true", help="print a compact receipt")
    args = parser.parse_args()
    receipt, words = recover(
        Image(args.core, CORE_SHA),
        PEImage(args.comparison_core, CANDIDATE_CORE_SHA),
        args.profile,
    )
    if args.output:
        # Exclusive creation avoids silently replacing an existing source receipt.
        with args.output.open("x") as stream:
            json.dump(
                dict(
                    format="elbera-private-gmath-v1", source=receipt, float32Words=words
                ),
                stream,
                separators=(",", ":"),
            )
            stream.write("\n")
    if args.check:
        print(
            json.dumps(
                {
                    k: receipt[k]
                    for k in [
                        "status",
                        "profile",
                        "entries",
                        "tableSHA256",
                        "kernelSteps",
                        "constructorInstructions",
                    ]
                }
            )
        )
    else:
        print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
