"""Elbera Tools: bounded interpretation of qualified octree membership code.

Actual Engine/Core instructions decide splitting, ordering and array changes.
An authored memory provider supplies successful allocation, reallocation, free
and overlap-safe DWORD copying. Compiler vector construction uses its matched
forward loop with an explicit normal frame. No DLL or exception path executes.
"""

from check_actor_octree_native import OctreeBoundsMachine


class MembershipMachine(OctreeBoundsMachine):
    def __init__(self, program, memory=None):
        supplied = {
            0: 0,
            0x10859038: program.half,
            0x10DAD23C: 0,
            0x11D8D6B0: 0xBAD000,
            0x11D8D6A4: 0x10235034,
            0x10235034: 0xA00000,
            0xA00000: 0xA00100,
            0xA00100: 0xA00200,
            0xA00104: 0xA00204,
            0xA00108: 0xA00208,
            **program.bounds_constants,
            **program.membership_constants,
            **(memory or {}),
        }
        super().__init__(program, supplied, dict(esp=0xF00000))
        self.blocks = {}
        self.next_block = 0x2000000
        self.events = []

    def allocate(self, size):
        assert type(size) is int and 0 <= size <= 0x1000000 and size % 4 == 0
        if not size:
            return 0
        ptr = self.next_block
        self.next_block += (size + 255) & ~255
        self.blocks[ptr] = size
        # Uninitialized cells stay absent. Unexpected native reads fail closed.
        return ptr

    def free(self, ptr):
        if ptr:
            size = self.blocks.pop(ptr)
            for at in range(ptr, ptr + size, 4):
                self.memory.pop(at, None)

    def reallocate(self, ptr, size):
        old_size = self.blocks[ptr] if ptr else 0
        new = self.allocate(size)
        for offset in range(0, min(old_size, size), 4):
            if ptr + offset in self.memory:
                self.memory[new + offset] = self.memory[ptr + offset]
        self.free(ptr)
        return new

    def memmove(self, dest, source, size):
        assert size >= 0 and size % 4 == 0
        values = [self.memory[source + off] for off in range(0, size, 4)]
        self.memory.update({dest + off * 4: v for off, v in enumerate(values)})

    def write(self, operand, value, floating=False):
        if operand.startswith("byte ptr"):
            at = self.address(operand)
            base, shift = at & ~3, (at & 3) * 8
            old = self.memory[base]
            self.memory[base] = (old & ~(255 << shift)) | ((value & 255) << shift)
            return
        return super().write(operand, value, floating)

    def flags(self, value, carry=False, overflow=False):
        self.zero = value == 0
        self.sign = bool(value & 0x80000000)
        self.less = self.sign != overflow
        self.carry = carry
        self.parity = bin(value & 255).count("1") % 2 == 0

    def step(self, i):
        op, args = i.mnemonic, i.op_str.split(", ")
        nxt = i.address + i.size
        if i.address == 0x106026C7:
            raise AssertionError("native membership assertion reached")
        if op == "wait":
            pass  # Ordinary finite path; pending x87 exceptions are not modeled.
        elif op in ("add", "sub", "cmp", "test", "xor", "and", "or"):
            a, b = (self.read(arg) & 0xFFFFFFFF for arg in args)
            if op in ("add", "sub", "cmp"):
                total = a + b if op == "add" else a - b
                value = total & 0xFFFFFFFF
                overflow = bool(
                    (~(a ^ b) if op == "add" else a ^ b) & (a ^ value) & 0x80000000
                )
                self.flags(
                    value, total > 0xFFFFFFFF if op == "add" else a < b, overflow
                )
            else:
                value = a ^ b if op == "xor" else a | b if op == "or" else a & b
                self.flags(value)
            if op not in ("cmp", "test"):
                self.write(args[0], value)
        elif op == "inc":
            old = self.read(args[0]) & 0xFFFFFFFF
            value = (old + 1) & 0xFFFFFFFF
            self.flags(value, self.carry, old == 0x7FFFFFFF)
            self.write(args[0], value)
        elif op == "imul" and len(args) == 2:
            self.write(args[0], (self.read(args[0]) * self.read(args[1])) & 0xFFFFFFFF)
        elif op == "jg":
            if not self.less and not self.zero:
                nxt = int(args[0], 16)
        elif op == "call":
            sp = self.registers["esp"]
            if i.address in (0x10329E25, 0x10152328, 0x10109225):
                assert self.registers["ecx"] == 0xA00000
                expected = {
                    0x10329E25: 0xA00200,
                    0x10152328: 0xA00204,
                    0x10109225: 0xA00208,
                }
                assert self.read(i.op_str) == expected[i.address]
                if i.address == 0x10329E25:
                    size, label = [self.memory[sp + n * 4] for n in range(2)]
                    self.registers["eax"] = self.allocate(size)
                    self.registers["esp"] += 8
                    self.events.append(["allocate", size, label])
                elif i.address == 0x10152328:
                    ptr, size, label = [self.memory[sp + n * 4] for n in range(3)]
                    self.registers["eax"] = self.reallocate(ptr, size)
                    self.registers["esp"] += 12
                    self.events.append(["reallocate", size, label])
                else:
                    self.free(self.memory[sp])
                    self.registers["esp"] += 4
                    self.events.append(["free"])
            elif i.address == 0x101523F1:
                assert i.op_str == "0x1010177b"
                dest, source, size = [self.memory[sp + n * 4] for n in range(3)]
                self.memmove(dest, source, size)
                self.registers["eax"] = dest
                self.events.append(["memmove", size])
            elif i.address == 0x10601DAA:
                assert i.op_str == "0x107a674b"
                self.vector_construct()
            else:
                target = self.read(i.op_str)
                target = self.source.membership_targets.get(target, target)
                assert target in self.program, (hex(i.address), hex(target))
                self.push(nxt)
                nxt = target
        else:
            return super().step(i)
        self.visited.append(i.address)
        return nxt

    def execute_until(self, start, stop=None):
        pc = start
        for _ in range(2000000):
            if pc == stop:
                return
            assert pc in self.program, ("escaped membership instructions", hex(pc))
            pc = self.step(self.program[pc])
        raise AssertionError("bounded membership execution did not finish")

    def vector_construct(self):
        saved = dict(self.registers)
        sp = saved["esp"]
        values = [self.memory[sp + n * 4] for n in range(5)]
        assert values[1:4] == [16, 8, 0x103020C7]
        frame = sp - 0x40
        self.memory.update({frame + 8 + n * 4: v for n, v in enumerate(values)})
        self.registers.update(ebp=frame, esp=frame - 0x40)
        self.execute_until(0x107A6757, 0x107A6784)
        assert self.registers["esp"] == frame - 0x40
        for name in ("ebx", "esi", "edi", "ebp"):
            self.registers[name] = saved[name]
        self.registers["esp"] = sp + 20
        self.events.append(["vectorConstruction", 8])

    def invoke(self, start, receiver=0, arguments=()):
        sp, previous_link = self.registers["esp"], self.memory[0]
        for value in reversed(arguments):
            self.push(value)
        self.push(0)
        self.registers["ecx"] = receiver
        self.execute_until(start)
        assert self.registers["esp"] == sp
        assert self.memory[0] == previous_link and not self.stack

    def remove_actor(self, actor):
        saved = dict(self.registers)
        frame = saved["esp"] - 0x40
        self.memory[frame + 8] = actor
        self.memory[frame - 4] = 0
        self.registers.update(ebx=actor, ebp=frame, esp=frame - 0x40)
        self.execute_until(0x10602698, 0x106026F7)
        assert self.registers["esp"] == frame - 0x40 and not self.stack
        self.registers = saved

    def array(self, address):
        data, count, capacity = [self.memory[address + i * 4] for i in range(3)]
        assert 0 <= count <= capacity
        if data:
            assert capacity * 4 == self.blocks[data]
        else:
            assert capacity == 0
        return [self.memory[data + i * 4] for i in range(count)]


def create_membership_machine(program, volume):
    m = MembershipMachine(program)
    root, volume_ptr = 0x100000, 0x110000
    m.invoke(0x10601A10, root)
    m.memory.update(
        {
            volume_ptr + i * 4: v
            for i, v in enumerate([*volume["center"], volume["halfExtent"]])
        }
    )
    return m, root, volume_ptr


def define_actor(machine, actor, box, single):
    machine.invoke(0x101091F0, actor + 0x168)
    machine.memory[actor + 0x74] = 0x100 if single else 0
    machine.memory.update(
        {actor + 0x174 + i * 4: v for i, v in enumerate([*box["min"], *box["max"]])}
    )


def snapshot(machine, root, actors):
    paths, nodes = {}, []

    def visit(ptr, path):
        paths[ptr] = path
        children = machine.memory[ptr + 12]
        nodes.append(
            dict(
                path=path,
                actors=[actors[p] for p in machine.array(ptr)],
                split=bool(children),
            )
        )
        if children:
            assert machine.memory[children - 4] == 8
            for child in range(8):
                visit(children + child * 16, path + str(child))

    visit(root, "")
    memberships = {
        name: [paths[p] for p in machine.array(ptr + 0x168)]
        for ptr, name in actors.items()
    }
    return dict(nodes=nodes, memberships=memberships)
