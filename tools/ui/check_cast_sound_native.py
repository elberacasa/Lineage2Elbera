#!/usr/bin/env python3
"""Elbera Tools: original cast sound layers, lookup order and notify evidence.

Read-only; requires supplied pinned Interlude Engine.dll/Engine.u and sound DAT.
Decodes Engine only in memory. JSON contains evidence/hashes, not game assets.
Source-free tests exercise selection and explicit-state integer rules. Native
audio playback and foot-surface dispatch are not emulated. Optional supplemental
inputs bind the erased SoundNotify RNG call; owned-only remains the default.
"""
import argparse
import ast
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import subprocess
import re
import struct
import sys
import tempfile

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA
from check_track_native import Machine, signed

sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(ROOT / 'tools/dat'))
from l2dat import Reader as DatReader
from l2lib import Reader, load_package
from extract_gamedata import decrypt

DAT_SHA = '14c9df542ccb0b342f1fd091b7177438cdf3705fb43581d0fc69b6c9ceeb14f5'
PACKAGE_SHA = '9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761'
TRAILER = b'\x0cSafePackage\0'
VOICE_MODELS = ['mfighter', 'ffighter', 'mdarkelf', 'fdarkelf', 'mdwarf', 'fdwarf',
                'melf', 'felf', 'mmagic', 'fmagic', 'morc', 'forc', 'mshaman', 'fshaman']


def digest(data):
    return hashlib.sha256(data).hexdigest()


def parse_source_rows(data):
    """Binary field order independently derived from RVA 0x14ec30.

    The three outer groups are layers. Within each group the three references
    and their interleaved gain pairs are cast/shot/explosion, respectively.
    Empty references, zero gains and duplicate records remain in source order.
    """
    if not data.endswith(TRAILER):
        raise ValueError('missing original sound DAT trailer')
    r = DatReader(data[:-len(TRAILER)], 'original skill sound data')
    count = r.u32()
    if count > len(data) // 8:
        raise ValueError('invalid source record count')
    rows = []
    for index in range(count):
        row = {'index': index, 'id': r.u32(), 'level': r.u32(), 'layers': []}
        for _ in range(3):
            refs = [r.ustr() for _ in range(3)]
            layer = [{'sound': sound, 'volume': r.f32(), 'radius': r.f32()} for sound in refs]
            if any(not math.isfinite(v) for p in layer for k, v in p.items() if k != 'sound'):
                raise ValueError('nonfinite source gain')
            row['layers'].append(layer)
        row['voices'] = [[r.ustr() for _ in range(15)] for _ in range(2)]
        row['voiceVolume'], row['voiceRadius'] = r.f32(), r.f32()
        if not all(math.isfinite(row[k]) for k in ('voiceVolume', 'voiceRadius')):
            raise ValueError('nonfinite source voice gain')
        rows.append(row)
    if not r.done():
        raise ValueError('unconsumed source sound data')
    return rows


def select_source_row(rows, skill_id, level):
    """Effective original DAT order: newest exact match, oldest level-1 fallback.

    Native multimap Add and Rehash build reverse insertion-order bucket chains.
    MultiFind preserves that traversal; GetSkillSoundData returns its first exact
    level, otherwise its last level-1 candidate. It never borrows another level.
    """
    fallback = None
    for row in reversed(rows):
        if row['id'] != skill_id:
            continue
        if row['level'] == level:
            return row
        if row['level'] == 1:
            fallback = row
    return fallback


def phase_layers(row, phase):
    if phase not in (1, 2, 3):
        raise ValueError('unsupported PlaySkillSound type')
    return [layer[phase - 1] for layer in row['layers']]


def random_gate(random_property, integer_result):
    """Only the original signed IDIV comparison, not an invented RNG."""
    if not -(2 ** 31) <= integer_result < 2 ** 31:
        raise ValueError('RNG operand must be signed DWORD')
    remainder = integer_result - math.trunc(integer_result / 100) * 100
    return remainder < random_property


def match_model_records(records, creation, creation_keys):
    """Join exact original asset arrays, never infer race from a filename."""
    races = {row['id']: row for row in creation['races']}
    result = {}
    for model, (race, gender, class_key) in creation_keys.items():
        assets = races[race]['creationAssets'][gender][class_key]
        matches = [i for i, row in enumerate(records)
                   if row['face_mesh'] == assets['faceMesh']
                   and row['body_mesh'] == assets['bodyMeshes']]
        if len(matches) != 1:
            raise ValueError('missing or ambiguous original model asset identity: ' + model)
        result[model] = matches[0]
    return result


def model_voice_source():
    from extract_charcreate import parse_chargrp
    builder = ROOT / 'tools/src/char_pipeline/build_characters.py'
    creation_path = ROOT / 'editor/characters/charcreate-data.json'
    tree = ast.parse(builder.read_text())
    constants = {node.targets[0].id: ast.literal_eval(node.value)
                 for node in tree.body if isinstance(node, ast.Assign)
                 and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)
                 and node.targets[0].id in ('COMBOS', 'CREATION_KEY')}
    with tempfile.TemporaryDirectory() as temp:
        raw = decrypt('chargrp.dat', temp)
        records = parse_chargrp(raw)
    slots = match_model_records(records, json.loads(creation_path.read_text()), constants['CREATION_KEY'])
    assert sorted(slots.values()) == list(range(14))
    # The builder's source pawn class, not its browser model-id spelling,
    # agrees with the independently named native voice-bank stores.
    for model, _, _, _, _, pawn_class, _ in constants['COMBOS']:
        assert pawn_class.casefold() == VOICE_MODELS[slots[model]]
    return {'modelMeshTypes': slots,
            'chargrpSHA256': digest((ROOT / 'assets/interlude/system/chargrp.dat').read_bytes()),
            'decryptedChargrpSHA256': digest(raw), 'creationMetadataSHA256': digest(creation_path.read_bytes()),
            'builderSHA256': digest(builder.read_bytes()),
            'method': 'exact original chargrp body/face arrays joined to the builder creation bindings; native named voice stores agree with source pawn classes',
            'limits': 'ordinary built player models only; no transformed/linked pawn or NPC index inference'}


def notify_source():
    from export_npc_visuals import OriginalClasses, terminal_defaults
    from extract_uscript import sources_from_package
    path = ROOT / 'assets/interlude/system/Engine.u'
    assert digest(path.read_bytes()) == PACKAGE_SHA
    package, _ = load_package(str(path))
    owner = next(e for e in package.exports_by_class('Class') if package.export_name(e) == 'AnimNotify_Sound')
    fields = []
    for e in package.exports:
        if e.package_index != owner.index + 1 or not package.class_name_of(e).endswith('Property'):
            continue
        raw = package.data[e.serial_offset:e.serial_offset + e.serial_size]
        r = Reader(raw)
        assert package.name(r.compact()) == 'None' and r.compact() == 0
        nxt, count, flags = r.compact(), r.u32(), r.u32()
        r.compact()  # category
        kind = package.class_name_of(e)
        assert not flags & 0x20
        if kind == 'ObjectProperty':
            assert package.ref_name(r.compact())[-1] == 'Sound'
        assert r.pos == len(raw)
        fields.append({'name': package.export_name(e), 'kind': kind, 'count': count,
                       'next': nxt, 'ref': e.index + 1, 'SHA256': digest(raw)})
    by_ref = {row['ref']: row for row in fields}
    current = next(row for row in fields if row['name'] == 'Sound')
    ordered = []
    while current:
        assert current not in ordered
        ordered.append(current)
        current = by_ref.get(current['next'])
    assert len(ordered) == len(fields) == 12
    assert [(r['name'], r['kind'], r['count']) for r in ordered[:4]] == [
        ('Sound', 'ObjectProperty', 1), ('Volume', 'FloatProperty', 1),
        ('Radius', 'IntProperty', 1), ('Random', 'IntProperty', 1)]
    assert all(r['kind'] == 'ObjectProperty' and r['count'] == 3 for r in ordered[4:])
    catalog = OriginalClasses()
    defaults, evidence = terminal_defaults(package, owner, catalog.property_types('Engine.AnimNotify_Sound', set()))
    assert evidence['defaultsBoundary'] == 'unique-validated-candidate'
    assert defaults == [('Volume', 'float', 1.0), ('Random', 'int', 100)]
    # Source text establishes field names independently of native access uses.
    scripts = {name: text for name, text in sources_from_package(package) if name == 'AnimNotify_Sound'}
    assert len(scripts) == 1
    return {'enginePackageSHA256': PACKAGE_SHA, 'orderedFields': ordered,
            'defaultOverrides': defaults, 'defaultsEvidence': evidence,
            'scriptTextSHA256': digest(scripts['AnimNotify_Sound'].encode('latin1')),
            'limits': ['no full foot-surface implementation; RNG evidence is reported separately',
                       'zero radius reads a protector-erased imported global; its identity is not established here']}



# Retained instructions only: no original payload, seeded stream, or DLL dump.
RNG_ANCHORS = [
    ('Engine', 0x106be96a, 'cdq', ''),
    ('Engine', 0x106be96b, 'mov', 'ecx, 0x64'),
    ('Engine', 0x106be970, 'idiv', 'ecx'),
    ('Engine', 0x106be972, 'cmp', 'edx, dword ptr [edi + 0x44]'),
    ('Engine', 0x106be975, 'jge', '0x106bede2'),
    ('Engine', 0x106be97b, 'mov', 'esi, dword ptr [edi + 0x38]'),
    ('Engine', 0x106be97e, 'test', 'esi, esi'),
    ('Engine', 0x106be980, 'je', '0x106beae2'),
    ('Engine', 0x106be986, 'mov', 'eax, dword ptr [ebp + 0xc]'),
    ('Engine', 0x106be989, 'test', 'eax, eax'),
    ('Engine', 0x104a92e0, 'push', '0'),
    ('Engine', 0x105784b9, 'xor', 'ebx, ebx'),
    ('Engine', 0x1057a435, 'mov', 'edx, dword ptr [0x11d8dc58]'),
    ('Engine', 0x1057a43b, 'cmp', 'dword ptr [edx], ebx'),
    ('Engine', 0x1057a43d, 'je', '0x1057a442'),
    ('Engine', 0x1057a43f, 'push', 'ebx'),
    ('Engine', 0x1057a440, 'jmp', '0x1057a445'),
    ('Engine', 0x1057a442, 'rdtsc', ''),
    ('Engine', 0x1057a444, 'push', 'eax'),
    ('Engine', 0x1057a44b, 'add', 'esp, 4'),
    ('Core', 0x1012d7e0, 'jmp', '0x1017d36d'),
    ('Core', 0x1012d7f0, 'jmp', '0x1017d360'),
    ('Core', 0x1012d801, 'call', '0x1017d36d'),
    ('Core', 0x1012d80c, 'fdiv', 'qword ptr [0x101d11b8]'),
    ('Core', 0x1017d360, 'call', '0x10180a25'),
    ('Core', 0x1017d365, 'mov', 'ecx, dword ptr [esp + 4]'),
    ('Core', 0x1017d369, 'mov', 'dword ptr [eax + 0x14], ecx'),
    ('Core', 0x1017d36c, 'ret', ''),
    ('Core', 0x1017d36d, 'call', '0x10180a25'),
    ('Core', 0x1017d372, 'mov', 'ecx, dword ptr [eax + 0x14]'),
    ('Core', 0x1017d375, 'imul', 'ecx, ecx, 0x343fd'),
    ('Core', 0x1017d37b, 'add', 'ecx, 0x269ec3'),
    ('Core', 0x1017d381, 'mov', 'dword ptr [eax + 0x14], ecx'),
    ('Core', 0x1017d384, 'mov', 'eax, ecx'),
    ('Core', 0x1017d386, 'shr', 'eax, 0x10'),
    ('Core', 0x1017d389, 'and', 'eax, 0x7fff'),
    ('Core', 0x1017d38e, 'ret', ''),
    ('Core', 0x10180a26, 'call', '0x101809ae'),
    ('Core', 0x10180a39, 'mov', 'eax, esi'),
    ('Core', 0x101809b6, 'push', 'dword ptr [0x1023a900]'),
    ('Core', 0x101809be, 'call', '0x10180867'),
    ('Core', 0x101809c3, 'call', 'eax'),
    ('Core', 0x101809c9, 'jne', '0x10180a19'),
    ('Core', 0x101809cb, 'push', '0x214'),
    ('Core', 0x101809df, 'push', 'esi'),
    ('Core', 0x101809f2, 'call', 'eax'),
    ('Core', 0x101809f4, 'test', 'eax, eax'),
    ('Core', 0x101809f6, 'je', '0x10180a10'),
    ('Core', 0x101809f8, 'push', '0'),
    ('Core', 0x101809fa, 'push', 'esi'),
    ('Core', 0x101809fb, 'call', '0x101808ef'),
    ('Core', 0x10180909, 'mov', 'esi, dword ptr [ebp + 8]'),
    ('Core', 0x10180913, 'xor', 'edi, edi'),
    ('Core', 0x10180915, 'inc', 'edi'),
    ('Core', 0x10180916, 'mov', 'dword ptr [esi + 0x14], edi'),
]

RNG_CORE_RANGES = [
    ('appRand wrapper', 0x1012d7e0, 0x1012d7e5),
    ('appRandInit wrapper', 0x1012d7f0, 0x1012d7f5),
    ('appFrand', 0x1012d800, 0x1012d81a),
    ('seed setter', 0x1017d360, 0x1017d36d),
    ('integer generator', 0x1017d36d, 0x1017d38f),
    ('record getter', 0x10180a25, 0x10180a3d),
    ('record lookup and initialization', 0x101809ae, 0x10180a25),
    ('new record initializer', 0x101808ef, 0x101809ae),
    ('storage-function selector', 0x10180867, 0x10180899),
]

def core_rand_step(state):
    """Retained Core.appRand arithmetic with an explicit unsigned DWORD state."""
    if type(state) is not int or not 0 <= state <= 0xffffffff:
        raise ValueError('explicit unsigned DWORD state required')
    state = (state * 214013 + 2531011) & 0xffffffff
    return state, (state >> 16) & 32767


class RandomMachine(Machine):
    """Only the integer operations needed by retained RNG/IDIV slices.

    Imports and native DLLs are never executed. Record pointers and state are
    explicit inputs; the caller does not emulate CRT storage selection.
    """
    def step(self, instruction):
        op, args = instruction.mnemonic, instruction.op_str.split(', ')
        if op == 'imul':
            self.write(args[0], (self.read(args[1]) * self.read(args[2])) & 0xffffffff)
        elif op == 'shr':
            self.write(args[0], (self.read(args[0]) & 0xffffffff) >> (self.read(args[1]) & 31))
        elif op == 'and':
            self.write(args[0], self.read(args[0]) & self.read(args[1]))
        elif op == 'inc':
            self.write(args[0], (self.read(args[0]) + 1) & 0xffffffff)
        elif op == 'cdq':
            self.registers['edx'] = 0xffffffff if self.registers['eax'] & 0x80000000 else 0
        elif op == 'idiv':
            dividend = ((self.registers['edx'] & 0xffffffff) << 32) | (self.registers['eax'] & 0xffffffff)
            if dividend & (1 << 63): dividend -= 1 << 64
            divisor = signed(self.read(args[0]))
            assert divisor
            quotient = abs(dividend) // abs(divisor)
            if (dividend < 0) != (divisor < 0): quotient = -quotient
            assert -(1 << 31) <= quotient < (1 << 31)
            self.registers['eax'] = quotient & 0xffffffff
            self.registers['edx'] = (dividend - quotient * divisor) & 0xffffffff
        else:
            return super().step(instruction)
        return instruction.address + instruction.size


def _random_machine(image, start, end, memory, registers):
    return RandomMachine(memory, dict.fromkeys(('eax','ebx','ecx','edx','esi','edi','esp','ebp'), 0) | registers,
                         list(image.dis.disasm(_read(image, start, end-start), start)))


def _read(image, address, count):
    return bytes(image.data[image.offset(address):image.offset(address)+count])


def native_rand_step(core, state):
    core_rand_step(state)  # Validate the explicit domain without using its result.
    machine = _random_machine(core, 0x1017d372, 0x1017d38f, {0x2014:state}, {'eax':0x2000})
    steps = machine.execute(0x1017d372)
    return (machine.memory[0x2014], machine.registers['eax']), steps


def native_random_gate(engine, result, threshold):
    if type(result) is not int or not 0 <= result <= 32767:
        raise ValueError('appRand result outside proven range')
    if type(threshold) is not int or not -(1 << 31) <= threshold < (1 << 31):
        raise ValueError('Random must be a signed DWORD')
    machine = _random_machine(engine, 0x106be96a, 0x106be97b,
                              {0x3044:threshold & 0xffffffff}, {'eax':result,'edi':0x3000})
    machine.zero = machine.less = machine.carry = machine.sign = machine.parity = False
    pc, steps = 0x106be96a, 0
    while pc not in (0x106be97b, 0x106bede2):
        assert steps < 5, 'unexpected native gate path'
        pc = machine.step(machine.program[pc]); steps += 1
    return pc == 0x106be97b, machine.registers['edx'], steps


def random_browser_differential(engine, core):
    """Actual JS explicit-state RNG and dispatch gate versus retained instructions.

    Unsupported metadata cases check the browser admission contract only; they
    do not assign invented meaning to native surface/derived-class branches.
    No browser entropy adapter or generated game asset is used.
    """
    direct = {'classPath':'Engine.AnimNotify_Sound','isSound':True,'sound':'Synthetic.Sound',
              'soundInfo':{'status':'source-direct','random':100,'volume':0.5,'radius':30}}
    notifies = []
    for threshold in (-(1 << 31),-1,0,1,30,50,99,100,101,(1 << 31)-1):
        notifies.append(dict(direct, soundInfo=dict(direct['soundInfo'], random=threshold)))
    for threshold in (0,100):
        notifies.append(dict(direct, sound=None, soundInfo=dict(direct['soundInfo'], status='source-surface', random=threshold)))
    notifies.extend([
        dict(direct, sound=''),
        dict(direct, soundInfo=dict(direct['soundInfo'], radius=0)),
        dict(direct, soundInfo={'status':'unresolved'}),
        dict(direct, classPath='Synthetic.DerivedSound'),
        dict(direct, isSound=False),
    ])
    seeds = [0,1,0x7fffffff,0x80000000,0xffffffff] + [(i*0x9e3779b9+0x13579bdf)&0xffffffff for i in range(64)]
    script = """import fs from 'node:fs';
import {createNativeRandom} from './editor/world/js/native-random.js';
import {selectNotifySound} from './editor/world/js/animnotify-clock.js';
const {seeds,notifies}=JSON.parse(fs.readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify(seeds.map(seed=>{
  const raw=createNativeRandom(seed),selected=createNativeRandom(seed);
  const values=Array.from({length:32},()=>raw.nextInt());
  const rows=notifies.map(notify=>({result:selectNotifySound(notify,selected),state:selected.state,draws:selected.draws}));
  return {values,state:raw.state,draws:raw.draws,rows};
})));"""
    process = subprocess.run(['node','--input-type=module','-e',script], input=json.dumps({'seeds':seeds,'notifies':notifies}),
                             text=True, capture_output=True, cwd=ROOT, timeout=30, check=True)
    actual = json.loads(process.stdout)
    assert len(actual) == len(seeds)
    native_steps = native_gates = selected_draws = 0
    for seed, row in zip(seeds, actual):
        state = seed; expected = []
        for _ in range(32):
            (state, value), count = native_rand_step(core, state)
            native_steps += count; expected.append(value)
        assert (row['values'],row['state'],row['draws']) == (expected,state,32)
        state = seed; draws = 0
        assert len(row['rows']) == len(notifies)
        for notify, result in zip(notifies, row['rows']):
            if notify['classPath'] != 'Engine.AnimNotify_Sound' or notify['isSound'] is not True:
                expected = {'status':'unsupported','reason':'unported-sound-notify-class'}
            else:
                (state, value), count = native_rand_step(core, state)
                native_steps += count; draws += 1; selected_draws += 1
                info = notify['soundInfo']
                if 'random' not in info:
                    expected = {'status':'unsupported','reason':'missing-original-random-threshold','randomValue':value}
                else:
                    admitted, remainder, count = native_random_gate(engine, value, info['random'])
                    native_gates += count
                    assert remainder == value % 100
                    if not admitted:
                        expected = {'status':'filtered','randomValue':value}
                    elif info['status'] != 'source-direct' or not notify['sound'] or info['radius'] <= 0:
                        expected = {'status':'unsupported','reason':'unported-sound-notify-branch','randomValue':value}
                    else:
                        expected = {'status':'ready','ref':notify['sound'],'volume':info['volume'],
                                    'radius':info['radius'],'randomValue':value}
            assert result == {'result':expected,'state':state,'draws':draws}, (seed,notify,result,expected)
    return {'seeds':len(seeds),'rawDraws':len(seeds)*32,'selectionCalls':len(seeds)*len(notifies),
            'selectionDraws':selected_draws,'nativeGeneratorInstructions':native_steps,'nativeGateInstructions':native_gates,
            'runtimeSHA256':{name:digest((ROOT/name).read_bytes()) for name in
                ('editor/world/js/native-random.js','editor/world/js/animnotify-clock.js')},
            'limits':['injected synthetic states only; no entropy or exact live-client sequence claim',
                      'class/metadata refusal cases test browser admission, not unported native sound branches']}


def verify_rng(image=None, *, comparison_engine=None, comparison_core=None):
    from check_skillanim_native import CORE_SHA
    from check_supplemental_engine import CANDIDATE_ENGINE_SHA, CANDIDATE_CORE_SHA
    from supplemental_pe import PEImage
    from check_hair_attachment_native import compare_call_block
    image = image or Image(ROOT/'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    core = Image(ROOT/'assets/interlude/system/Core.dll', CORE_SHA)
    anchors = []
    for label, address, mnemonic, operands in RNG_ANCHORS:
        source = image if label == 'Engine' else core
        source.instruction(address, mnemonic, operands)
        anchors.append({'image':label,'VA':hex(address),'mnemonic':mnemonic,'operands':operands})
    methods = []
    for source, symbol, body in [
        (image,'?Notify@UAnimNotify_Sound@@UAEXPAVUMeshInstance@@PAVAActor@@@Z',0x106be900),
        (image,'?ResetBMData@FL2ReplayManager@@QAEXXZ',0x104a92d0),
        (image,'?Init@UEngine@@UAEXH@Z',0x10578490),
        (core,'?appRand@@YAHXZ',0x1012d7e0), (core,'?appRandInit@@YAXH@Z',0x1012d7f0),
        (core,'?appFrand@@YAMXZ',0x1012d800),
    ]:
        assert source.exported(symbol,True) == body
        methods.append({'image':'Engine' if source is image else 'Core','symbol':symbol,'body':hex(body)})
    assert _read(image,0x106be964,6) == bytes([0x90])*6
    assert struct.unpack('<d',_read(core,0x101d11b8,8))[0] == 32767.0
    ranges = []
    for label,start,end in RNG_CORE_RANGES:
        data = _read(core,start,end-start)
        instructions = list(core.dis.disasm(data,start))
        assert sum(i.size for i in instructions) == len(data)
        ranges.append({'name':label,'start':hex(start),'endExclusive':hex(end),'SHA256':digest(data),'bytes':len(data)})
    states = sorted(set([0,1,0x7fffffff,0x80000000,0xffffffff] + [(i*0x9e3779b9+0x13579bdf)&0xffffffff for i in range(1024)]))
    rows = []; generator_steps = 0
    for state in states:
        actual, count = native_rand_step(core,state)
        assert actual == core_rand_step(state)
        generator_steps += count; rows.append([state,*actual])
    setter_cases = []
    for seed in (0,1,0x80000000,0xffffffff):
        machine = _random_machine(core,0x1017d365,0x1017d36d,{0x9004:seed,0x2014:0xabcdef01},{'esp':0x9000,'eax':0x2000})
        steps = machine.execute(0x1017d365)
        assert machine.memory[0x2014] == seed
        setter_cases.append({'seed':seed,'stored':machine.memory[0x2014],'instructions':steps})
    machine = _random_machine(core,0x10180913,0x10180919,{}, {'edi':0x12345678,'esi':0x2000})
    initial_steps = machine.execute(0x10180913,0x10180919)
    assert machine.memory[0x2014] == 1
    outputs = sorted(set([0,1,29,30,49,50,67,68,98,99,100,101,32767]+[r[2] for r in rows]))
    gate_cases = gate_steps = 0; gate_digest = hashlib.sha256()
    for value in outputs:
        for threshold in (-(1<<31),-1,0,1,30,50,99,100,101,(1<<31)-1):
            admitted,remainder,count = native_random_gate(image,value,threshold)
            assert admitted == random_gate(threshold,value) and remainder == value%100
            gate_cases += 1; gate_steps += count; gate_digest.update(struct.pack('<Ii?',value,threshold,admitted))
    inverse = pow(214013,-1,1<<32)
    for value in range(32768):
        assert core_rand_step((((value<<16)-2531011)*inverse)&0xffffffff)[1] == value
    counts = Counter(value%100 for value in range(32768))
    assert [counts[i] for i in range(100)] == [328]*68+[327]*32
    result = {'ownedEngineSHA256':image.sha,'ownedCoreSHA256':core.sha,'instructionAnchors':len(anchors),'anchors':anchors,
              'methods':methods,'CoreRanges':ranges,
              'callBinding':'six NOPs in owned Engine; supplemental input not supplied',
              'arithmetic':{'stateBits':32,'multiplier':214013,'addend':2531011,'shift':16,'mask':32767,
                'generatorCases':len(rows),'generatorInstructions':generator_steps,
                'generatorCasesSHA256':digest(json.dumps(rows,separators=(',',':')).encode()),
                'seedSetterCases':setter_cases,'defaultRecordStoreInstructions':initial_steps,
                'gateCases':gate_cases,'gateInstructions':gate_steps,'gateCasesSHA256':gate_digest.hexdigest(),
                'attainabilityCases':32768,'outputRange':[0,32767],
                'moduloPreimages':{'remainders0through67':328,'remainders68through99':327}},
              'browserDifferential':random_browser_differential(image,core),
              'limits':['default mode verifies separate owned Core arithmetic and Engine gate; erased call identity needs optional comparison',
                        'new CRT record seed1 is not the active sound seed; seed, thread/fiber storage lifetime and all shared consumers are not reconstructed',
                        'browser entropy/context lifetime are platform policy, not native seed evidence',
                        'no DLL execution, sound-null branch, complete audio or live NPC admission']}
    if comparison_core is not None:
        companion = PEImage(comparison_core,CANDIDATE_CORE_SHA)
        for row in methods:
            if row['image'] == 'Core': assert companion.body(row['symbol']) == int(row['body'],16)
        for _,start,end in RNG_CORE_RANGES:
            assert _read(core,start,end-start) == companion.read(start,end-start)
        result['comparisonCore'] = {'SHA256':companion.sha,'identicalRanges':len(ranges)}
    if comparison_engine is not None:
        candidate = PEImage(comparison_engine,CANDIDATE_ENGINE_SHA)
        for row in methods:
            if row['image'] == 'Engine':
                expected = int(row['body'],16) - (0x40 if 'UAnimNotify_Sound' in row['symbol'] else 0)
                assert candidate.body(row['symbol']) == expected
        comparisons = []
        for start,end,target,sites,operand in [
            (0x106be964,0x106be986,0x106be924,[(0x106be964,'?appRand@@YAHXZ')],None),
            (0x104a92d0,0x104a92ea,0x104a92d0,[(0x104a92da,'?Empty@FArray@@QAEXHH@Z'),(0x104a92e2,'?appRandInit@@YAXH@Z')],None),
            (0x1057a435,0x1057a44e,0x1057a40c,[(0x1057a445,'?appRandInit@@YAXH@Z')],(2,0x11d8dc58,0x11d8dc54)),
        ]:
            raw = bytearray(_read(image,start,end-start)); other = candidate.read(target,end-start)
            operands = []
            if operand:
                offset,old_slot,new_slot = operand
                assert struct.unpack_from('<I',raw,offset)[0] == old_slot
                assert struct.unpack_from('<I',other,offset)[0] == new_slot
                assert candidate.imports[new_slot] == ('core.dll','?GIsBenchmarking@@3HA')
                struct.pack_into('<I',raw,offset,new_slot)
                operands.append({'ownedSlot':hex(old_slot),'supplementalSlot':hex(new_slot),'binding':candidate.imports[new_slot]})
            compared = compare_call_block(raw,other,owned_va=start,candidate_va=target,
                sites=[(a-start,('core.dll',symbol)) for a,symbol in sites],direct_calls=[],imports=candidate.imports)
            comparisons.append({'ownedRange':[hex(start),hex(end)],'ownedSHA256':digest(_read(image,start,end-start)),
                                'supplementalStart':hex(target),'dataOperands':operands,**compared})
        # Include partial and implicit register writes. Calls still depend on the
        # normal callee-saved x86 EBX contract, not transitive method emulation.
        from capstone import Cs, CS_ARCH_X86, CS_MODE_32
        dis = Cs(CS_ARCH_X86,CS_MODE_32); dis.detail = True
        prefix = _read(image,0x10578490,0x1057a44e-0x10578490)
        instructions = list(dis.disasm(prefix,0x10578490))
        assert sum(i.size for i in instructions) == len(prefix)
        writes = [[hex(i.address),i.mnemonic,i.op_str] for i in instructions
                  if any(i.reg_name(r) in ('ebx','bx','bl','bh') for r in i.regs_access()[1])]
        assert writes == [['0x105784b9','xor','ebx, ebx']]
        result['callBinding'] = 'pinned supplemental exact correspondence: Core.appRand; protected owned restoration remains unverified'
        result['comparisonEngine'] = {'SHA256':candidate.sha,'blocks':comparisons,
            'InitPrefixSHA256':digest(prefix),'InitEBXWrites':writes,
            'seeds':'new record1 is separate; checked Engine.Init branch benchmark0/RDTSC low32; ResetBMData0',
            'limits':['separate archive is not authenticated; no universal import restoration',
                      'no exhaustive seed/call-order/storage lifetime reconstruction; normal callee-saved EBX required']}
    return result


def verify(*, comparison_engine=None, comparison_core=None):
    sys.path.insert(0, str(ROOT / 'tools/uscript'))
    image = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    anchors = []
    def pin(rva, op, args):
        image.instruction(image.base + rva, op, args)
        anchors.append(hex(rva))
    exports = {
        '?SkillSndDataLoad@FL2GameData@@IAEHH@Z': 0x173370,
        '?GetSkillSoundData@FL2GameData@@QAEPAUFL2SkillSoundData@@HH@Z': 0x178280,
        '?PlaySkillSound@APawn@@QAEXPAVAActor@@0H@Z': 0x1ee5a0,
        '?StopSpellSound@APawn@@QAEXXZ': 0x1eec60,
        '?Notify@UAnimNotify_Sound@@UAEXPAVUMeshInstance@@PAVAActor@@@Z': 0x3be900,
        '?GetMeshType@User@@QAEHXZ': 0x180bb0,
        '?SetTargetActor@ANProjectile@@QAEXPAVAActor@@@Z': 0x42df0,
        '?SkillEffectInit@APawn@@QAEXXZ': 0x1f2ed0,
        '?SkillEffectShot@APawn@@QAEPAVANSkillProjectile@@XZ': 0x1fe660,
    }
    for name, rva in exports.items():
        assert image.exported(name, True) == image.base + rva
    # Serialized record loop and its object serializer.
    for a, op, arg in [(0x1734bb, 'call', '0x1030f5dd'), (0x1734ce, 'call', '0x1030be33'),
                       (0x1734d3, 'add', 'dword ptr [ebp + 0x54], 1'),
                       (0x14ec72, 'cmp', 'esi, 3'), (0x14ece0, 'add', 'esi, 1'),
                       (0x14ecf4, 'cmp', 'esi, 0xf'), (0x14ecea, 'cmp', 'eax, 2')]: pin(a, op, arg)
    for a, reg, offset in [(0x14ec77, 'ecx', 8), (0x14ec82, 'edx', 0x14), (0x14ec8d, 'eax', 0x20),
                           (0x14ec98, 'ecx', 0x2c), (0x14eca3, 'edx', 0x38), (0x14ecae, 'eax', 0x44),
                           (0x14ecb9, 'ecx', 0x50), (0x14ecc4, 'edx', 0x5c), (0x14ecd2, 'eax', 0x68)]:
        pin(a, 'lea', '%s, [edi + esi*4 + %s]' % (reg, hex(offset) if offset > 9 else offset))
    # Independently named text columns bind those three memory arrays.
    for a, text, store, reg, offset in [(0x1736df, 'spelleffect_sound_%d', 0x173715, 'edx', 8),
                                       (0x173789, 'shoteffect_sound_%d', 0x1737bf, 'eax', 0x14),
                                       (0x173833, 'expeffect_sound_%d', 0x173869, 'ecx', 0x20)]:
        instruction = next(image.dis.disasm(image.data[a:a+5], image.base+a))
        assert instruction.mnemonic == 'push' and image.wide(int(instruction.op_str, 16)) == text
        pin(store, 'mov', 'dword ptr [edi + ebx*4 + %s], %s' % (hex(offset) if offset > 9 else offset, reg))
    # Append/prepend, rehash in ascending entry order, newest-first collection.
    for a, op, arg in [(0x15a541, 'mov', 'dword ptr [edi], ecx'),
        (0x15a549, 'sub', 'edx, 1'), (0x15a54c, 'mov', 'dword ptr [ecx + eax*4], edx'),
        (0x15a43f, 'xor', 'edx, edx'), (0x15a463, 'mov', 'dword ptr [eax], ebp'),
        (0x15a465, 'mov', 'dword ptr [edi + ecx*4], edx'), (0x15a468, 'add', 'edx, 1'),
        (0x15a46b, 'add', 'ebx, 0xc'), (0x158bb4, 'mov', 'eax, dword ptr [ecx + eax*4]'),
        (0x158bef, 'mov', 'dword ptr [eax], ecx'), (0x158bf3, 'mov', 'eax, dword ptr [esi + edx]'),
        (0x1782e6, 'cmp', 'ecx, edi'), (0x1782e8, 'je', '0x10478320'),
        (0x1782ea, 'cmp', 'ecx, 1'), (0x1782ef, 'mov', 'ebp, edx'),
        (0x1782f1, 'add', 'eax, 1'), (0x17830b, 'mov', 'eax, ebp'),
        (0x178320, 'mov', 'esi, edx'), (0x178338, 'mov', 'eax, esi')]: pin(a, op, arg)
    # All layers of each selected phase, followed by the appropriate voice.
    for a, offset in [(0x1ee89f, 8), (0x1ee781, 0x14), (0x1ee663, 0x20)]:
        pin(a, 'mov', ('ecx' if offset == 8 else 'eax') + ', dword ptr [edi + esi*4 + '
            + (hex(offset) if offset > 9 else str(offset)) + ']')
    for a in (0x1ee65a, 0x1ee778, 0x1ee896): pin(a, 'cmp', 'esi, 3')
    for a in (0x1ee726, 0x1ee844, 0x1ee962, 0x1eea7c): pin(a, 'fdiv', 'qword ptr [0x10853b38]')
    assert struct.unpack_from('<d', image.data, image.offset(0x10853b38))[0] == 255
    for a, op, arg in [(0x1ee9c3, 'mov', 'eax, dword ptr [ebx + 0x698]'),
        (0x1ee9bb, 'mov', 'eax, dword ptr [eax + 0x698]'), (0x1ee9ce, 'shl', 'edx, 4'),
        (0x1ee9d1, 'sub', 'edx, ecx'), (0x1ee9d3, 'add', 'edx, eax'),
        (0x1ee9d5, 'mov', 'eax, dword ptr [edi + edx*4 + 0x38]'),
        (0x18fe91, 'call', '0x103052fe'), (0x18fe9c, 'mov', 'dword ptr [ecx + 0x698], eax')]: pin(a, op, arg)
    assert image.exported('?GetMeshType@User@@QAEHXZ') == 0x103052fe
    # Native user race/class/gender switch and every ordinary return value.
    for a, op, arg in [(0x180bd8, 'mov', 'eax, dword ptr [ecx + 0x4c]'),
        (0x180bdb, 'cmp', 'eax, 4'), (0x180be4, 'jmp', 'dword ptr [eax*4 + 0x10480db0]'),
        (0x180beb, 'mov', 'eax, dword ptr [ecx + 0x54]'), (0x180bee, 'cmp', 'eax, 0x62'),
        (0x180bf7, 'movzx', 'eax, byte ptr [eax + 0x10480dd0]'),
        (0x180bfe, 'jmp', 'dword ptr [eax*4 + 0x10480dc4]'),
        (0x180cca, 'mov', 'eax, dword ptr [ecx + 0x54]'), (0x180ccd, 'add', 'eax, -0x2c'),
        (0x180cd0, 'cmp', 'eax, 0x48'), (0x180cd9, 'movzx', 'edx, byte ptr [eax + 0x10480e40]'),
        (0x180ce0, 'jmp', 'dword ptr [edx*4 + 0x10480e34]')]: pin(a, op, arg)
    for a in (0x180c05,0x180c34,0x180c66,0x180c98,0x180ce7,0x180d19,0x180d4b):
        pin(a, 'cmp', 'dword ptr [ecx + 0x50], 0')
    pin(0x180c0b, 'xor', 'eax, eax')
    for a,value in [(0x180c1e,1),(0x180c9e,2),(0x180cb4,3),(0x180d51,4),(0x180d67,5),
                    (0x180c6c,6),(0x180c82,7),(0x180c3a,8),(0x180c50,9),(0x180ced,10),
                    (0x180d03,11),(0x180d1f,12),(0x180d35,13)]:
        pin(a, 'mov', 'eax, ' + (hex(value) if value > 9 else str(value)))
    assert [image.u32(0x10480db0+i*4) for i in range(5)] == [
        image.base+i for i in (0x180beb,0x180c66,0x180c98,0x180cca,0x180d4b)]
    for address, expected in [(0x10480dc4,(0x180c05,0x180c34,0x180d67)),
                              (0x10480e34,(0x180ce7,0x180d19,0x180d67))]:
        assert [image.u32(address+i*4) for i in range(3)] == [image.base+i for i in expected]
    # Read every named voice store, rather than borrow a third-party race order.
    voice_fields = {}
    pending = None
    for ins in image.dis.disasm(image.data[0x1738e1:0x173d80], image.base+0x1738e1):
        if ins.mnemonic == 'push' and ins.op_str.startswith('0x1089'):
            name = image.wide(int(ins.op_str, 16))
            if name.endswith(('_cast', '_magic')): pending = name
        match = re.fullmatch(r'dword ptr \[edi \+ (0x[0-9a-f]+)\], (?:eax|ecx|edx)', ins.op_str)
        if pending and ins.mnemonic == 'mov' and match:
            voice_fields[pending] = int(match[1],16); pending = None
    for index, model in enumerate(VOICE_MODELS):
        assert voice_fields[model+'_cast'] == 0x74+index*4
        assert voice_fields[model+'_magic'] == 0xb0+index*4
    # Native event paths and cast-layer cleanup; not packet-derived timers.
    for a, op, arg in [(0x1ed10b, 'push', '1'), (0x1ed111, 'call', '0x10307360'),
        (0x1ed5e4, 'push', '2'), (0x1ed5ea, 'call', '0x10307360'),
        (0x42df4, 'mov', 'dword ptr [ecx + 0x4e4], eax'),
        (0x1ed4e2, 'mov', 'eax, dword ptr [esi + 0x520]'),
        (0x1ed4e8, 'mov', 'dword ptr [edi + 0x4e4], eax'),
        (0x1ec5e8, 'mov', 'ecx, dword ptr [edi + 0x4e4]'),
        (0x1ec5e4, 'push', '3'), (0x1ec5ee, 'call', '0x10307360'),
        (0x1f2efe, 'mov', 'ebx, ecx'), (0x1fa6a3, 'test', 'esi, esi'),
        (0x1fa6a5, 'je', '0x104fa6b2'), (0x1fa6a7, 'push', '1'),
        (0x1fa6a9, 'push', 'esi'), (0x1fa6aa, 'push', 'ebx'),
        (0x1fa6ab, 'mov', 'ecx, ebx'), (0x1fa6ad, 'call', '0x10307360'),
        (0x1fe68e, 'mov', 'ebx, ecx'), (0x20cea5, 'mov', 'eax, dword ptr [ebp + 0x68]'),
        (0x20cea8, 'test', 'eax, eax'), (0x20ceaa, 'je', '0x1050ceb7'),
        (0x20ceac, 'push', '2'), (0x20ceae, 'push', 'eax'), (0x20ceaf, 'push', 'ebx'),
        (0x20ceb0, 'mov', 'ecx, ebx'), (0x20ceb2, 'call', '0x10307360'),
        (0x1eece0, 'cmp', 'esi, 3'), (0x1eece9, 'mov', 'eax, dword ptr [eax + esi*4 + 8]'),
        (0x1eed72, 'mov', 'edx, dword ptr [edx + 0x88]')]: pin(a, op, arg)
    # Direct named-sound notify branch. Null Sound follows separate surface logic.
    for a, op, arg in [(0x3be96b, 'mov', 'ecx, 0x64'), (0x3be970, 'idiv', 'ecx'),
        (0x3be972, 'cmp', 'edx, dword ptr [edi + 0x44]'), (0x3be975, 'jge', '0x106bede2'),
        (0x3be97b, 'mov', 'esi, dword ptr [edi + 0x38]'), (0x3be980, 'je', '0x106beae2'),
        (0x3be9ad, 'mov', 'edx, dword ptr [edi + 0x40]'),
        (0x3bea54, 'je', '0x106bea5b'), (0x3bea5b, 'mov', 'edx, dword ptr [0x11d8dc10]'),
        (0x3bea8c, 'fld', 'dword ptr [edi + 0x3c]'), (0x3bea8f, 'fdiv', 'qword ptr [0x10853b38]'),
        (0x3beabf, 'mov', 'edx, dword ptr [ebx + 0x80]')]: pin(a, op, arg)
    path = ROOT / 'assets/interlude/system/skillsoundgrp.dat'
    assert digest(path.read_bytes()) == DAT_SHA
    with tempfile.TemporaryDirectory() as temp:
        decoded = decrypt('skillsoundgrp.dat', temp)
        rows = parse_source_rows(decoded)
    assert len(rows) == 1398
    duplicate_keys = Counter((r['id'],r['level']) for r in rows)
    examples = []
    for skill_id, level in [(3, 1), (1177, 1), (1177, 999), (1216, 1)]:
        row = select_source_row(rows, skill_id, level)
        examples.append({'id': skill_id, 'requestedLevel': level, 'selectedIndex': row and row['index'],
                         'selectedLevel': row and row['level'], 'phaseLayerCounts': row and [
                             sum(bool(v['sound']) for v in phase_layers(row,p)) for p in (1,2,3)]})
    ranges = [('sound DAT serializer',0x14ec30,0x14ed57),('sound lookup',0x178280,0x17834a),
              ('sound multimap insert',0x15a500,0x15a56f),('sound multimap rehash',0x15a3f0,0x15a492),
              ('sound multimap find',0x158ba0,0x158c02),('play skill sound',0x1ee5a0,0x1eeacf),
              ('ordinary mesh-type selection',0x180bb0,0x180e89),
              ('legacy init sound tail',0x1fa69e,0x1fa6ce),('legacy shot sound tail',0x20cea5,0x20cecf),
              ('stop spell sound',0x1eec60,0x1eeda0),('direct sound notify',0x3be900,0x3beae2)]
    return {'tool': 'Elbera Tools', 'engineSHA256': ENGINE_SHA, 'anchors': len(anchors),
            'ranges': [{'name': n, 'startRVA': hex(a), 'endRVAExclusive': hex(b),
                        'SHA256': digest(image.data[a:b])} for n,a,b in ranges],
            'soundDatSHA256': DAT_SHA, 'decryptedSHA256': digest(decoded), 'records': len(rows),
            'duplicateKeys': sum(v>1 for v in duplicate_keys.values()), 'examples': examples,
            'voiceSlots': dict(enumerate(VOICE_MODELS)), 'reservedVoiceSlot': 14,
            'browserModels': model_voice_source(),
            'notify': notify_source(),
            'random': verify_rng(image, comparison_engine=comparison_engine, comparison_core=comparison_core),
            'limits': ['static instruction evidence, not original audio execution',
                'erased sound loading helpers and sound-null foot/surface path remain unresolved; RNG seed/storage limits remain explicit',
                'voice transform/linked-pawn cases and non-player flow need separate runtime coverage']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--rng-only', action='store_true', help='only owned RNG/gate and injected-state browser differential')
    parser.add_argument('--comparison-engine', type=Path, help='optional separately obtained pinned supplemental Engine.dll')
    parser.add_argument('--comparison-core', type=Path, help='optional separately obtained pinned supplemental Core.dll')
    args = parser.parse_args()
    result = (verify_rng if args.rng_only else verify)(comparison_engine=args.comparison_engine, comparison_core=args.comparison_core)
    random = result if args.rng_only else result['random']
    print(json.dumps(result, indent=2) if args.json else
          ('Verified %d sound anchors and %d source records; ' % (result['anchors'],result['records']) if not args.rng_only else '') +
          'RNG: %d retained anchors, %d state cases, %d gate cases, %d browser selection calls.' %
          (random['instructionAnchors'],random['arithmetic']['generatorCases'],random['arithmetic']['gateCases'],random['browserDifferential']['selectionCalls']))
