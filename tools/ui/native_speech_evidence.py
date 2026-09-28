"""Elbera Tools: bounded controller speech/driver-fade differential evidence.

Used by check_playsound_native --speech. Owned original instructions are
interpreted, never executed. Named external calls receive explicit synthetic
observations; the pinned comparison qualifies erased FString call sites.
"""
import itertools
import json
import random
import struct
import subprocess

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA
from check_playsound_native import ALAUDIO_SHA, VoiceMachine, digest
from check_track_native import signed
from check_legacy_skill_effects_native import f32


CALLS = {
    0x105d0c03: '??4FStringNoInit@@QAEAAU0@PBG@Z',
    0x105d6025: '??4FStringNoInit@@QAEAAU0@PBG@Z',
    0x105d605b: '??9FString@@QBEHPBG@Z',
    0x105d608c: '??0FString@@QAE@ABV0@@Z',
    0x105d60c5: '??0FString@@QAE@ABV0@@Z',
}
METHODS = {
    0x98: ('?SetMusicVolume@UALAudioSubsystem@@UAEXHMM@Z', 0x10006ed0),
    0xb8: ('?IsMusicPlaying@UALAudioSubsystem@@UAEHXZ', 0x10001940),
    0xbc: ('?IsOggVoicePlaying@UALAudioSubsystem@@UAEHXZ', 0x10001950),
    0xc0: ('?IsWavVoicePlaying@UALAudioSubsystem@@UAEHXZ', 0x10001960),
    0xc4: ('?IsVoiceEnd@UALAudioSubsystem@@UAEHXZ', 0x10001970),
    0xd4: ('?StopMusic@UALAudioSubsystem@@UAEHHMH@Z', 0x1000b880),
    0xdc: ('?PlayVoice@UALAudioSubsystem@@UAEHVFString@@MHH@Z', 0x10006fe0),
}


def rows(image, start, end):
    raw = bytes(image.data[image.offset(start):image.offset(end)])
    result = list(image.dis.disasm(raw, start))
    assert sum(i.size for i in result) == len(raw)
    return result


def qualify(engine, audio, comparison):
    from check_hair_attachment_native import compare_call_block
    from check_supplemental_engine import CANDIDATE_ENGINE_SHA
    from supplemental_pe import PEImage
    other = PEImage(comparison, CANDIDATE_ENGINE_SHA)
    for symbol, body in [
        ('?SetRequestedServerVoice@ALineagePlayerController@@UAEXPAGMH@Z', 0x105d0be0),
        ('?Tick@ALineagePlayerController@@UAEHMW4ELevelTick@@@Z', 0x105d5460),
    ]:
        assert engine.exported(symbol, True) == body
        assert other.body(symbol) == body - 64
    assert engine.u32(0x1086f26c + 0x374) == engine.exported(
        '?SetRequestedServerVoice@ALineagePlayerController@@UAEXPAGMH@Z')
    blocks = []
    for start, end in [(0x105d0be0, 0x105d0c1c), (0x105d5f17, 0x105d6137)]:
        raw = bytes(engine.data[engine.offset(start):engine.offset(end)])
        blocks.append({'startVA': hex(start), 'ownedSHA256': digest(raw),
            **compare_call_block(raw, other.read(start - 64, end - start),
                owned_va=start, candidate_va=start - 64,
                sites=[(va - start, ('core.dll', name)) for va, name in CALLS.items() if start <= va < end],
                direct_calls=[], imports=other.imports)})
    table = audio.exported('??_7UALAudioSubsystem@@6BUObject@@@')
    for slot, (symbol, body) in METHODS.items():
        assert audio.u32(table + slot) == audio.exported(symbol), symbol
        assert audio.exported(symbol, True) == body, symbol
    assert engine.wide(0x10853d94) == ''
    for va, value in [(0x10884cf0, 2.), (0x10891398, f32(.3))]:
        assert struct.unpack_from('<f', engine.data, engine.offset(va))[0] == value
    anchors = [
        (0x10007014, 'fld', 'dword ptr [ebx + 0xd0]'),
        (0x1000702f, 'je', '0x100072ac'),
        (0x10007059, 'mov', 'dword ptr [ebp - 0x14], 0x110'),
        (0x10007064, 'mov', 'dword ptr [ebp - 0x14], 0x114'),
        (0x10007070, 'or', 'dword ptr [ebp - 0x14], 0x80'),
        (0x1000711f, 'push', '0x1003eaa8'),
        (0x10007167, 'push', '0x1003eac4'),
        (0x1000717b, 'push', '0x1003eab0'),
        (0x10007219, 'call', 'dword ptr [0x1004e8f0]'),
        (0x1000722a, 'mov', 'eax, dword ptr [edx + 0x78]'),
        (0x1000732c, 'fldz', ''),
        (0x1000732e, 'fst', 'dword ptr [ebp - 0x2c]'),
        (0x10007331, 'fst', 'dword ptr [ebp - 0x28]'),
        (0x10007334, 'fst', 'dword ptr [ebp - 0x24]'),
        (0x1000734d, 'fld1', ''),
        (0x10007353, 'fld', 'dword ptr [0x10040028]'),
        (0x10007378, 'push', '1'),
        (0x1000737a, 'push', '0'),
        (0x1000737e, 'mov', 'edx, dword ptr [edx + 0x80]'),
        (0x100073a4, 'cmp', 'dword ptr [ecx], esi'),
        (0x100073a8, 'cmp', 'dword ptr [ecx + 0x48], 2'),
        (0x100073ae, 'lea', 'esi, [eax + 1]'),
        (0x100091f2, 'mov', 'edx, dword ptr [edi + 0x6c]'),
        (0x100091f5, 'mov', 'dword ptr [esi + 0x14], edx'),
        (0x1000ab33, 'and', 'eax, 0x10'),
        (0x1000ab3d, 'fst', 'dword ptr [ebp - 0x7c]'),
        (0x1000ab40, 'fst', 'dword ptr [ebp - 0x78]'),
        (0x1000ab43, 'fst', 'dword ptr [ebp - 0x74]'),
        (0x1000ac22, 'mov', 'eax, dword ptr [eax + 0x14]'),
        (0x1000ac37, 'or', 'eax, ecx'),
        (0x1000ac3f, 'mov', 'dword ptr [ecx + edi + 0x4c], eax'),
        (0x1000d53f, 'mov', 'dword ptr [esi + 0x104], eax'),
        (0x1000d548, 'mov', 'dword ptr [esi + 0x108], ecx'),
        (0x1000d551, 'mov', 'dword ptr [esi + 0x10c], edx'),
        (0x1000e116, 'jp', '0x1000e14b'),
        (0x1000e11c, 'test', 'byte ptr [ecx + 0x4c], 4'),
        (0x1000e129, 'mov', 'edx, dword ptr [edx + 0x7c]'),
        (0x1000e324, 'fld', 'dword ptr [esi + 0xd0]'),
    ]
    for va, op, args in anchors:
        audio.instruction(va, op, args)
    for va, value in [(0x1003eaa8, '-e'), (0x1003eab0, '..\\Voice\\'), (0x1003eac4, '.ogg')]:
        assert audio.wide(va) == value
    assert struct.unpack_from('<f', audio.data, audio.offset(0x10040028))[0] == 1000
    audio_pe = PEImage(ROOT / 'assets/interlude/system/ALAudio.dll', ALAUDIO_SHA)
    assert audio_pe.imports[0x1004e8f0][1] == '??0USound@@QAE@PBGH@Z'
    return {'comparisonSHA256': other.sha, 'blocks': blocks, 'namedAudioSlots': len(METHODS),
            'audioInstructionAnchors': len(anchors), 'playVoiceRadius': 1000,
            'path': {'prefix': '..\\Voice\\', 'nonNativeSuffix': '-e', 'extension': '.ogg'}}


class SpeechMachine(VoiceMachine):
    """Finite slices only; reject every instruction/call not explicitly handled."""
    def step(self, instruction):
        op, args = instruction.mnemonic, instruction.op_str.split(', ')
        if op == 'or':
            value = (self.read(args[0]) | self.read(args[1])) & 0xffffffff
            self.write(args[0], value)
            self.zero, self.less, self.carry = value == 0, signed(value) < 0, False
            self.sign = self.less
            self.parity = bin(value & 255).count('1') % 2 == 0
        elif op == 'test':
            super().step(instruction)
            value = self.read(args[0]) & self.read(args[1])
            self.less = self.sign = bool(value & 0x80000000)
            self.carry = False
        elif op == 'fdiv':
            self.stack[0] /= self.read(args[0])
        else:
            return super().step(instruction)
        return instruction.address + instruction.size


def native_tick(engine, audio, case):
    state, snap = case['state'], case['snapshot']
    ctrl, driver, frame, sp = 0x2000, 0x4000, 0x8000, 0x9000
    table = audio.exported('??_7UALAudioSubsystem@@6BUObject@@@')
    memory = {driver: table, ctrl + 0xa60: state['voiceHandle'], ctrl + 0xa5c: state['musicHandle'],
        ctrl + 0xa68: state['kind'], ctrl + 0xa70: state['delay'], ctrl + 0xa74: state['flags'],
        frame + 0x78: snap['delta'], frame - 4: 0,
        0x10884cf0: 2., 0x10891398: f32(.3)}
    memory.update({table + offset: audio.exported(name) for offset, (name, _) in METHODS.items()})
    registers = dict.fromkeys(('eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp', 'esp'), 0)
    registers.update(esi=ctrl, edi=driver if snap['available'] else 0, ebp=frame, esp=sp)
    m = SpeechMachine(memory, registers, rows(engine, 0x105d5f17, 0x105d6137))
    m.zero = m.less = m.carry = m.sign = m.parity = False
    refs, events = {ctrl + 0xa84: state['ref']}, []
    pc, count = 0x105d5f17, 0
    while pc != 0x105d6137:
        count += 1
        assert count < 512, 'speech slice exceeded bound'
        ins = m.program[pc]
        if pc in CALLS:
            assert ins.mnemonic == 'nop'  # full six-byte site qualified separately
            arg = m.memory[m.registers['esp']]
            if pc == 0x105d6025:
                assert arg == 0x10853d94
                refs[m.registers['ecx']] = ''
            elif pc == 0x105d605b:
                assert arg == 0x10853d94
                m.registers['eax'] = int(refs[m.registers['ecx']] != '')
            else:
                refs[m.registers['ecx']] = refs[arg]
            m.registers['esp'] += 4
            pc += 6
        elif ins.mnemonic == 'call':
            slot = {0x105d5f25: 0xc4, 0x105d5f35: 0xb8, 0x105d5f62: 0x98,
                    0x105d5f87: 0xbc, 0x105d5f96: 0xc0, 0x105d5fa4: 0xb8,
                    0x105d5ff1: 0xd4, 0x105d60a5: 0xdc, 0x105d60de: 0xdc,
                    0x105d612e: 0x98}[pc]
            assert m.read(ins.op_str) == audio.exported(METHODS[slot][0])
            assert m.registers['ecx'] == driver
            at = m.registers['esp']
            if slot in (0xb8, 0xbc, 0xc0, 0xc4):
                m.registers['eax'] = int(snap[{0xb8: 'music', 0xbc: 'ogg', 0xc0: 'wav', 0xc4: 'voiceEnd'}[slot]])
            elif slot in (0x98, 0xd4):
                events.append(['setMusicVolume' if slot == 0x98 else 'stopMusic',
                    signed(m.memory[at]), m.memory[at + 4], m.memory[at + 8]])
                m.registers['esp'] += 12
            else:
                events.append(['playVoice', refs[at], m.memory[at + 12], m.memory[at + 16], m.memory[at + 20]])
                m.registers['eax'] = case['playResult']
                m.registers['esp'] += 24
            pc += ins.size
        else:
            pc = m.step(ins)
    assert m.registers['esp'] == sp and not m.stack
    result = {**state, 'kind': m.memory[ctrl + 0xa68], 'delay': m.memory[ctrl + 0xa70],
        'voiceHandle': signed(m.memory[ctrl + 0xa60]), 'flags': m.memory[ctrl + 0xa74],
        'ref': refs[ctrl + 0xa84]}
    return {'state': result, 'events': events}, count


def native_fade(audio, case):
    driver, pool, frame = 0x2000, 0x4000, 0x8000
    mem = {driver + 0x88: pool, pool + 0x48: 2, pool + 0x44: case['elapsed'],
           pool + 0x40: case['duration'], frame + 0x38: case['delta']}
    m = SpeechMachine(mem, {'esi': driver, 'ebx': 0, 'ebp': frame}, rows(audio, 0x1000e09e, 0x1000e118))
    m.zero = m.less = m.carry = m.sign = m.parity = False
    pc, count = 0x1000e09e, 0
    while pc not in (0x1000e118, 0x1000e14b):
        count += 1
        assert count < 80
        pc = m.step(m.program[pc])
    elapsed = m.memory[pool + 0x44]
    if pc == 0x1000e118:
        return {'status': 'ended', 'elapsed': elapsed}, count
    m.program = {i.address: i for i in rows(audio, 0x1000e33d, 0x1000e34f)}
    m.registers['edi'] = pool
    m.memory[frame + 0x6c] = case['volume']
    pc = 0x1000e33d
    while pc != 0x1000e34f:
        count += 1
        pc = m.step(m.program[pc])
    return {'status': 'ready', 'elapsed': elapsed,
            'gain': f32(min(1, max(0, m.memory[frame + 0x6c])))}, count


def verify_speech(comparison):
    engine = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    audio = Image(ROOT / 'assets/interlude/system/ALAudio.dll', ALAUDIO_SHA)
    proof = qualify(engine, audio, comparison)
    cases = []
    for kind, (ogg, wav, music, voice_end), delay, handle, ref in itertools.product(
            (0, 1, 2), itertools.product((False, True), repeat=4),
            (-1., 0., f32(.1), 2.), (-1, 0, 17), ('', 'synthetic_voice')):
        cases.append({'state': {'kind': kind, 'delay': delay, 'voiceHandle': handle,
                    'musicHandle': 9, 'flags': 4, 'ref': ref},
            'snapshot': {'available': True, 'ogg': ogg, 'wav': wav, 'music': music,
                         'voiceEnd': voice_end, 'delta': f32(.1)}, 'playResult': 18})
    for result in (0, -1, 3):
        cases.append({'state': {'kind': 1, 'delay': 0., 'voiceHandle': -1, 'musicHandle': -1,
            'flags': 0, 'ref': 'synthetic_voice'}, 'snapshot': {'available': False, 'ogg': False,
            'wav': False, 'music': False, 'voiceEnd': False, 'delta': 1.}, 'playResult': result})
        cases.append({**cases[-1], 'snapshot': {**cases[-1]['snapshot'], 'available': True}})
    fades = [dict(elapsed=f32(elapsed), duration=f32(duration), delta=f32(delta), volume=f32(volume))
        for elapsed, duration, delta, volume in itertools.product(
            (0, .25, .9, 1, 2), (.25, 1, 2), (0, .1, .5, .999999, 1, 2), (0, .6, 1))]
    rng = random.Random(0x53504545)
    delays = [-0x80000000, -1001, -1000, -999, -1, 0, 1, 999, 1000, 1001, 0x7fffffff, 0xffffffff]
    delays += [rng.randrange(-0x80000000, 0x100000000) for _ in range(128)]
    # Execute the actual signed high-word multiply/shift sequence, not integer
    # division copied from the JS. All consumed opcodes are checked first.
    instructions = rows(engine, 0x1049df44, 0x1049df55)
    assert [(i.mnemonic, i.op_str) for i in instructions] == [
        ('mov', 'eax, 0x10624dd3'), ('imul', 'edx'), ('sar', 'edx, 6'),
        ('mov', 'eax, edx'), ('shr', 'eax, 0x1f'), ('add', 'eax, edx')]
    delay_results = []
    for delay in delays:
        high = ((signed(delay) * 0x10624dd3) >> 32) & 0xffffffff
        shifted = signed(high) >> 6
        delay_results.append(f32(shifted + ((shifted & 0xffffffff) >> 31)))
    script = """import fs from 'node:fs';
import {tickNativeSpeech,nativeSpeechFade,nativeSpeechDelay} from './editor/world/js/native-speech.js';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const ticks=input.cases.map(c=>{const state={...c.state},events=[];
 const driver={};for(const name of ['stopMusic','setMusicVolume','playVoice'])
 driver[name]=(...args)=>{events.push([name,...args]);return c.playResult;};
 const result=tickNativeSpeech(state,c.snapshot,driver);if(result.status!=='ready')throw Error(result.reason);
 return {state,events};});
process.stdout.write(JSON.stringify({ticks,fades:input.fades.map(nativeSpeechFade),delays:input.delays.map(nativeSpeechDelay)}));"""
    actual = json.loads(subprocess.run(['node', '--input-type=module', '-e', script],
        input=json.dumps({'cases': cases, 'fades': fades, 'delays': delays}),
        text=True, capture_output=True, cwd=ROOT, check=True, timeout=30).stdout)
    count = 0
    for case, result in zip(cases, actual['ticks']):
        expected, steps = native_tick(engine, audio, case)
        assert result == expected, (case, result, expected)
        count += steps
    for case, result in zip(fades, actual['fades']):
        expected, steps = native_fade(audio, case)
        assert result == expected, (case, result, expected)
        count += steps
    assert actual['delays'] == delay_results
    return {'status': 'matched-original-slices', 'bindings': proof, 'controllerCases': len(cases),
        'fadeCases': len(fades), 'delayCases': len(delays), 'interpretedInstructions': count,
        'limits': ['Explicit synthetic controller state and external audio observations; not native startup.',
                   'Finite Float32 stores, binary64 intermediates; not universal x87 equivalence.',
                   'FString copy/compare and named audio calls are qualified boundary substitutions.',
                   'No original executable code is run; decoder, streaming and music integration remain separate.']}
