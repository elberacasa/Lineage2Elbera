#!/usr/bin/env python3
"""Elbera Tools: bounded original NPC initial-animation inputs and exclusions.

Requires pinned local Interlude originals plus explicit supplemental Engine/Core
paths for erased-import correspondence. Does not execute the native client,
write extracted binaries, connect to the game, or certify live neutral state.
Portable validation helpers/tests require no original inputs or third-party code.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def field_argument_index(format_string, field):
    """The retained decoder gives each S a destination and capacity argument."""
    if not isinstance(format_string, str) or any(c not in 'dcfS' for c in format_string):
        raise ValueError('unsupported native Deserialize format')
    if type(field) is not int or not 0 <= field < len(format_string):
        raise ValueError('invalid native field ordinal')
    return field + format_string[:field].count('S')


def absent_zero_item_ids(groups):
    """Fail closed: no invented key-zero sentinel or overwrite policy."""
    if not isinstance(groups, dict) or set(groups) != {'weapon', 'armor', 'etc'}:
        raise ValueError('all three original item groups are required')
    flat = [value for rows in groups.values() for value in rows]
    if not flat or any(type(value) is not int or not 0 <= value <= 0xffffffff for value in flat):
        raise ValueError('invalid original item identifier')
    if len(set(flat)) != len(flat):
        raise ValueError('duplicate source item identifier')
    if 0 in flat:
        raise ValueError('key zero exists; empty-equipment admission requires investigation')
    return {name: {'count': len(rows), 'minimum': min(rows) if rows else None}
            for name, rows in groups.items()}


def parse_enter_event_table(data):
    """Read the retained EnterEventData serializer; no field-name guessing.

    Duplicate IDs are rejected: this bounded proof needs an unambiguous fresh
    table and does not emulate replacement order for edited/custom datasets.
    The first FString's meaning remains unknown and is retained as text0.
    """
    sys.path.insert(0, str(ROOT/'tools/dat'))
    from extract_gamedata import SkillReader, TRAILER
    if not isinstance(data, bytes) or not data.endswith(TRAILER):
        raise ValueError('EnterEventgrp: missing SafePackage trailer')
    reader = SkillReader(data[:-len(TRAILER)], 'EnterEventgrp')
    try:
        count = reader.u32()
        # id + two empty ASCF strings + two floats + two DWORDs + two
        # empty length-prefixed UTF16 strings = 30 minimum serialized bytes.
        if count > (len(reader.data)-reader.pos)//30:
            raise ValueError('EnterEventgrp: record count exceeds payload')
        rows, ids = [], set()
        for _ in range(count):
            row = {'id':reader.u32(), 'text0':reader.ascf(), 'sound':reader.ascf(),
                   'soundVolume':reader.f32(), 'soundRadius':reader.f32(),
                   'isrise':reader.u32(), 'spawn_type':reader.u32(),
                   'effect':reader.ustr(), 'animation':reader.ustr()}
            if row['id'] in ids:
                raise ValueError('EnterEventgrp: duplicate source identifier')
            ids.add(row['id'])
            rows.append(row)
        if not reader.done():
            raise ValueError('EnterEventgrp: unconsumed payload')
        return rows
    except (EOFError, UnicodeError, struct.error) as error:
        raise ValueError('EnterEventgrp: malformed or truncated record') from error


def enter_event_lookup(rows, npc_id):
    """Retained GetEnterEventData: exact key and nonzero spawn_type only.

    Input must be the unique table returned by parse_enter_event_table. In
    particular, source key zero is ordinary data, never a fallback for a miss.
    """
    if type(npc_id) is not int or not 0 <= npc_id <= 0xffffffff:
        raise ValueError('original DWORD NPC identifier required')
    row = next((row for row in rows if row['id'] == npc_id), None)
    return row if row is not None and row['spawn_type'] != 0 else None


def npc_record_spans(data, expected_rows, selected_ids):
    """Independently frame fresh NPC records and cross-check the public decoder.

    Returns offsets/hashes only. Equal sharedPayloadSHA256 values establish
    byte equality after the ID and before the final DWORD, not a display-name
    alias or a claim about the final word's native consumer semantics.
    """
    sys.path.insert(0, str(ROOT/'tools/dat'))
    from extract_gamedata import SkillReader, TRAILER
    if not isinstance(data, bytes) or not data.endswith(TRAILER):
        raise ValueError('npcgrp: missing SafePackage trailer')
    if (not isinstance(selected_ids, (list, tuple)) or not selected_ids
            or any(type(key) is not int or not 0 <= key <= 0xffffffff for key in selected_ids)
            or len(set(selected_ids)) != len(selected_ids)):
        raise ValueError('npcgrp: unique selected DWORD IDs required')
    reader = SkillReader(data[:-len(TRAILER)], 'npcgrp framing')

    def count(width, compact=False):
        value = reader.compact_int() if compact else reader.u32()
        if not 0 <= value <= (len(reader.data)-reader.pos)//width:
            raise ValueError('npcgrp: array count exceeds payload')
        return value

    def strings():
        return [reader.ustr() for _ in range(count(4))]

    try:
        record_count = reader.u32()
        if not isinstance(expected_rows, list) or record_count != len(expected_rows):
            raise ValueError('npcgrp: decoded record count disagrees')
        spans, seen = {}, set()
        for expected in expected_rows:
            start = reader.pos
            row = {'npc_id':reader.u32(), 'class_name':reader.ustr(), 'mesh_name':reader.ustr()}
            for key in ('textures', 'textures_second'):
                row[key] = strings()
            row['property_list'] = [reader.u32() for _ in range(count(4, True))]
            row['npc_speed'] = reader.f32()
            for key in ('unk_1', 'attack_sound', 'defense_sound', 'damage_sound'):
                row[key] = strings()
            decoration_at = reader.pos
            row['deco_effect'] = [{'effect':reader.ustr(), 'scale':reader.f32()} for _ in range(count(8))]
            row['unk_2'] = [reader.u32() for _ in range(count(4, True))]
            row['attack_effect'], row['unk_3'] = reader.ustr(), reader.u32()
            for key in ('sound_vol', 'sound_radius', 'sound_random'):
                row[key] = reader.f32()
            row['quest_be'] = reader.u32()
            final_at = reader.pos
            row['class_lim'] = reader.u32()  # Existing decoder label, not an independently named native property.
            if row != expected or row['npc_id'] in seen:
                raise ValueError('npcgrp: decoder disagreement or duplicate identifier')
            seen.add(row['npc_id'])
            if row['npc_id'] in selected_ids:
                spans[str(row['npc_id'])] = {
                    'span':[start, reader.pos], 'SHA256':hashlib.sha256(data[start:reader.pos]).hexdigest(),
                    'sharedPayloadSHA256':hashlib.sha256(data[start+4:final_at]).hexdigest(),
                    'decoCountOffset':decoration_at, 'decoCount':len(row['deco_effect']),
                    'finalWordOffset':final_at, 'finalWord':row['class_lim']}
        if not reader.done() or set(spans) != {str(key) for key in selected_ids}:
            raise ValueError('npcgrp: unconsumed payload or missing selected identifier')
        return spans
    except (EOFError, UnicodeError, struct.error) as error:
        raise ValueError('npcgrp: malformed or truncated record') from error


def verify_starter_gremlin(engine, data, selectors):
    """Separately keyed original profile; never infer an ID from a mesh/name."""
    from extract_gamedata import parse_npcgrp
    rows = parse_npcgrp(data)
    assert len(rows) == 6519
    decoded_hash = hashlib.sha256(data).hexdigest()
    assert decoded_hash == 'e35ac3be4fbf94e02d38a1f3584dbe073569941374ac13c9a4ffafd9a5372e04'
    assert selectors['sources']['system/npcgrp.dat'] == 'f551a0f9a0d6765bd783d8f55b1847ba2d5e17acb9a50ae4268c11e1f13d3e8c'
    spans = npc_record_spans(data, rows, [18342, 20001])
    first, second = [next(row for row in rows if row['npc_id'] == key) for key in (18342, 20001)]
    differences = {key:[first[key],second[key]] for key in first if first[key] != second[key]}
    assert differences == {'npc_id':[18342,20001], 'class_lim':[0,1]}
    assert spans['18342']['sharedPayloadSHA256'] == spans['20001']['sharedPayloadSHA256']
    assert first['class_name'] == second['class_name'] == 'LineageMonster.gremlin'
    assert first['mesh_name'] == second['mesh_name'] == 'LineageMonsters.gremlin_m00'
    assert first['deco_effect'] == second['deco_effect'] == []
    assert selectors['npcs']['18342'] == selectors['npcs']['20001']
    assert selectors['npcs']['18342']['status'] == 'source-animation'
    anchors = [
        (0x1043abea,'mov','edi, 1'), (0x1043ac1d,'call','0x10313449'),
        (0x1043ac2f,'mov','dword ptr [esi + 8], edi'),
        (0x104873ee,'cmp','dword ptr [edi + 8], 0'), (0x104873f2,'je','0x104879f8'),
        (0x1046577c,'lea','eax, [esi + 0xd8]'), (0x10465784,'call','0x1030599d'),
        (0x10465789,'add','esi, 0xdc'), (0x1046578f,'push','esi'),
        (0x10465790,'push','edi'), (0x10465791,'call','0x1030599d'),
        (0x10484385,'add','esi, 0x14'), (0x10484389,'mov','ecx, dword ptr [0x10b3e0c8]'),
        (0x1048438f,'call','0x10307a77'), (0x10484398,'mov','ecx, dword ptr [eax + 0x24]'),
        (0x104656ed,'lea','eax, [esi + 0x9c]'), (0x104656f5,'call','0x1030599d'),
        (0x1062d174,'cmp','dword ptr [eax + 0x9c], ecx'), (0x1062d19a,'jge','0x1062d415'),
    ]
    for anchor in anchors:
        engine.instruction(*anchor)
    assert engine.exported('?Serialize@FL2NpcData@@QAEXAAVFArchive@@H@Z', True) == 0x104654f0
    assert engine.exported('?GetNpcMeshName@User@@QAE?AVFName@@XZ', True) == 0x10484350
    assert engine.exported('?SetPawnResource@User@@QAEXXZ', True) == 0x104872f0
    assert engine.exported('?GL2GameData@@3VFL2GameData@@A') + 0x1838 == 0x10b3e0c8
    return {'status':'verified-separate-source-profile', 'ownedAnchors':len(anchors),
        'npcDatDecodedSHA256':decoded_hash, 'recordCount':len(rows), 'recordSpans':spans,
        'rowDifferences':differences, 'allOtherRecordBytesEqual':True,
        'qualifiedClassMeshAncestrySelectorsEqual':True, 'decorationCount':0,
        'nativeFields':{'freshNpcInfoUserDiscriminator':'User+8=1; SetPawnResource tests this field',
            'npcDataFinalDWORD':'FL2NpcData+dc; class_lim is the decoder label only',
            'meshLookup':'actual User+14 NPC key -> FL2NpcData+24',
            'decorationCount':'FL2NpcData+9c'},
        'limits':['No assertion that FL2NpcData+dc is unused by other native consumers.',
            'This profile does not alias NPC IDs by display name or select a different table key.',
            'Constructor/callback preservation, deferred resource loading and placement remain separate proofs.',
            'No extension of the bounded source17_25 fresh-state domain or later-state playback admission.']}


def verify_spawn_enter_event(engine, candidate):
    """Fresh original binary table only; return proof metadata, never rows."""
    from check_hair_attachment_native import compare_call_block
    from check_supplemental_engine import compare_method
    sys.path.insert(0, str(ROOT/'tools/dat'))
    from extract_gamedata import decrypt
    read = lambda va,n: bytes(engine.data[engine.offset(va):engine.offset(va)+n])
    anchors = [
        (0x1043ac3f,'mov','ecx, dword ptr [esp + 0x64]'),
        (0x1043ac43,'add','ecx, 0xfff0bdc0'),(0x1043ac49,'mov','dword ptr [esi + 0x14], ecx'),
        (0x10495316,'mov','edx, dword ptr [ebp + 0x14]'),(0x10495319,'mov','dword ptr [eax + 0x69c], edx'),
        (0x10495656,'cmp','dword ptr [esp + 0x44], 2'),(0x10495663,'call','0x10307d5b'),
        (0x1061ce7b,'cmp','dword ptr [0x10c51034], 0'),(0x1061ce82,'je','0x1061d23c'),
        (0x1061ce88,'test','byte ptr [esi + 0x694], 4'),(0x1061ce8f,'je','0x1061d23c'),
        (0x1061ce95,'mov','eax, dword ptr [esi + 0x69c]'),(0x1061ce9b,'push','eax'),
        (0x1061cea1,'call','0x10303909'),(0x1061ceab,'test','edi, edi'),(0x1061cead,'je','0x1061d223'),
        (0x1046170c,'mov','ecx, dword ptr [ecx + 0x7dce8]'),(0x10461712,'call','0x10302fe0'),
        (0x10461719,'je','0x1046172f'),(0x10461724,'cmp','ecx, dword ptr [ebp + 8]'),
        (0x10461729,'cmp','dword ptr [eax + 0x28], 0'),(0x1046172f,'xor','eax, eax'),
        (0x10458c43,'cmp','dword ptr [esi + ecx*4 + 4], edx'),(0x10458c53,'xor','eax, eax'),
        (0x10480664,'cmp','dword ptr [esi + 0x7dce8], ebx'),(0x10480683,'call','0x10312111'),
        (0x1048068f,'mov','dword ptr [esi + 0x7dce8], eax'),(0x10480698,'call','0x1030e827'),
        (0x10474480,'push','4'),(0x10474497,'cmp','eax, dword ptr [ebp + 0x44]'),
        (0x104744c8,'call','0x1030e697'),(0x104744d1,'push','esi'),
        (0x104744d5,'mov','ecx, dword ptr [edx + 0x7dce8]'),(0x104744db,'call','0x10311900'),
        (0x104632cc,'mov','esi, dword ptr [ebx]'),(0x104632e3,'cmp','dword ptr [edi + edx*4 + 4], esi'),
        (0x1045a6e4,'mov','dword ptr [edi + 4], eax'),(0x1045a6e9,'mov','dword ptr [edi + 8], edx'),
        (0x1061cfb9,'mov','eax, dword ptr [edi + 0x24]'),(0x1061cfbe,'je','0x1061d108'),
        (0x1061d0b9,'lea','edi, [esi + 0x658]'),(0x1061d0fe,'or','dword ptr [esi + 0x678], 4'),
        (0x1061d113,'lea','ebx, [edi + 0x30]'),(0x1061d124,'je','0x1061d14d'),
        (0x1061d145,'mov','eax, dword ptr [edx + 0x328]'),(0x1061d14b,'call','eax'),
        (0x1061d14d,'lea','ebx, [edi + 0x10]'),
        # Initial loop/event return precedes the fresh packet-mask assignment.
        (0x1043b0df,'call','edx'),(0x1043b159,'mov','ecx, dword ptr [esp + 0x54]'),
        (0x1043b15d,'mov','dword ptr [eax + 0x17d0], ecx'),
        # A zero mask is not an unconditional clear of an existing collection.
        (0x104b114a,'mov','eax, dword ptr [edi + 0x1660]'),
        (0x104b115d,'mov','eax, dword ptr [edi + 0x165c]'),
        (0x104b9eac,'mov','ecx, dword ptr [edi + 0x17d0]'),
        (0x104b9eb8,'call','edx'),(0x104ba0b1,'cmp','dword ptr [edi + 0x17d0], 0'),
        (0x104ba0b8,'je','0x104ba59e'),(0x105d4403,'call','0x10311847'),
    ]
    for anchor in anchors: engine.instruction(*anchor)
    assert engine.exported('?GetEnterEventData@FL2GameData@@QAEPAUFL2EnterEventData@@H@Z',True)==0x104616e0
    assert engine.exported('?SpawnEnterEvent@APawn@@QAEXXZ',True)==0x1061ce50
    assert engine.exported('?CheckAbnormalState@APawn@@QAEHH@Z',True)==0x104b1120
    assert engine.exported('?UpdateAbnormalState@APawn@@QAEHM@Z',True)==0x104b9870
    assert engine.wide(0x1089b6b8)=='EnterEventgrp.dat'
    assert engine.wide(0x1089b68c)=='EnterEventgrp.txt'
    assert engine.u32(engine.exported('??_7APawn@@6B@')+0x328)==engine.exported('?PlayAnim@APawn@@UAEHHVFName@@MMHH@Z')
    assert engine.u32(engine.exported('??_7UGameEngine@@6BUObject@@@')+0x258)==engine.exported('?OnNpcInfo@UGameEngine@@UAEHPAUUser@@VFVector@@HAAVL2ParamStack@@@Z')

    # Exact serializer correspondence; same-address IAT slots are NOT assumed
    # equivalent. This particular FString operand and bounded EH entry differ.
    lo,hi=0x1044ede0,0x1044ee84
    owned=bytearray(read(lo,hi-lo));other=candidate.read(lo,hi-lo)
    assert struct.unpack_from('<I',owned,0x3b)[0]==0x11d8d958
    assert struct.unpack_from('<I',other,0x3b)[0]==0x11d8d954
    assert candidate.imports[0x11d8d954]==('core.dll','??6@YAAAVFArchive@@AAV0@AAVFString@@@Z')
    owned[0x3b:0x3f]=struct.pack('<I',0x11d8d954)
    serializer=compare_method(bytes(owned),other,lo,lo,candidate.imported_call,read,candidate.read,(0x108129b0,0x10812970))
    assert len(serializer['differences'])==1
    lo,hi=0x1047a660,0x1047a6ba
    constructor=compare_method(read(lo,hi-lo),candidate.read(lo,hi-lo),lo,lo,candidate.imported_call,read,candidate.read,(0x108148f1,0x108148b1))
    assert [(r['kind'],r.get('binding')) for r in constructor['differences']]==[
        ('explicit-handler-reference',None),('named-import',['core.dll','??0FArray@@QAE@XZ'])]
    append=compare_call_block(read(0x1045a6c0,0x70),candidate.read(0x1045a6c0,0x70),owned_va=0x1045a6c0,candidate_va=0x1045a6c0,
        sites=[(8,('core.dll','?Add@FArray@@QAEHHH@Z'))],direct_calls=[],imports=candidate.imports)

    # This event map's lookup returns a pointer to its stored value, unlike
    # the item map above. Interpret its own retained body, including collisions.
    from check_track_native import Machine
    class EventLookupMachine(Machine):
        def step(self, instruction):
            if instruction.mnemonic == 'and':
                left,right=instruction.op_str.split(', ')
                self.write(left,self.read(left)&self.read(right))
                return instruction.address+instruction.size  # CMP precedes every branch.
            return super().step(instruction)
    native_lookup_cases=0
    program=list(engine.dis.disasm(read(0x10458c20,0x44),0x10458c20))
    for keys,query in [([],0),([8,16,24],0),([0,8,16],0),([8,16,24],16),([1,9],17)]:
        address,entry,bucket,stack,query_ptr=0x1000,0x2000,0x3000,0x4000,0x5000
        memory={address:entry,address+12:bucket,address+16:8,stack+4:query_ptr,query_ptr:query}
        for i in range(8):memory[bucket+4*i]=0xffffffff
        for i,key in enumerate(keys):
            h=key&7
            memory[entry+12*i]=memory[bucket+4*h]
            memory[entry+12*i+4]=key
            memory[entry+12*i+8]=0x6000+4*i
            memory[bucket+4*h]=i
        machine=EventLookupMachine(memory,{'ecx':address,'esp':stack,'esi':0},program)
        machine.execute(0x10458c20)
        expected=entry+12*keys.index(query)+8 if query in keys else 0
        assert machine.registers['eax']==expected
        native_lookup_cases+=1

    source_hash=hashlib.sha256((ROOT/'assets/interlude/system/entereventgrp.dat').read_bytes()).hexdigest()
    assert source_hash=='748a0b56f4c92854ddd639945c40d1956601bbc78a034a79c15ffa415f6608f5'
    with tempfile.TemporaryDirectory(prefix='elbera-enter-event-') as temporary:
        data=decrypt('entereventgrp.dat',temporary)
    decoded_hash=hashlib.sha256(data).hexdigest()
    assert decoded_hash=='cd0819ef32fdb3828a7c1fd855865ccdba3cde1b856f69a5cd55291366f20d5a'
    rows=parse_enter_event_table(data)
    assert len(rows)==1152 and len(data)==125689
    assert all(not any(row['id']==npc_id for row in rows) and enter_event_lookup(rows,npc_id) is None for npc_id in (18342,20001,20091))
    return {'status':'verified-fresh-binary-table-miss','ownedAnchors':len(anchors),
        'sourceSHA256':source_hash,'decodedSHA256':decoded_hash,'decodedBytes':len(data),'recordCount':len(rows),
        'interpretedLookupCases':native_lookup_cases,
        'sourceIds':{'18342':'absent','20001':'absent','20091':'absent'},'missingLookup':'null; no key-zero fallback',
        'spawnResult':'early return before data-driven effect/rise/animation/sound branches',
        'serializer':serializer,'mapConstructor':constructor,'append':append,
        'methodSHA256':{name:hashlib.sha256(read(a,b-a)).hexdigest() for name,a,b in [
            ('SpawnEnterEvent',0x1061ce50,0x1061d24e),('GetEnterEventData',0x104616e0,0x10461744),
            ('serializer',0x1044ede0,0x1044ee84),('mapLookup',0x10458c20,0x10458c64)]},
        'packetOrdering':['OnNpcInfo initial loop','optional SpawnEnterEvent','return to decoder','extension DWORD0 stored at Pawn+17d0'],
        'abnormalBoundary':'CheckAbnormalState reads +165c/+1660; UpdateAbnormalState visits existing entries before zero-mask creation gate. No fresh empty-list admission asserted.',
        'limits':['Fresh original binary table only; custom/edit-mode text or mutated tables excluded.',
            'Supplemental correspondence does not restore owned imports or authenticate the comparison distribution.',
            'Other NPC records may move an actor or replace channel0 animation; spawn mode2 is not generally inert.',
            'No automatic live neutral-state admission, modifier closure or renderer parity claim.']}


def verify(comparison_engine, comparison_core):
    from check_tutorial_quest_native import Image, ENGINE_SHA
    from check_skillanim_native import CORE_SHA
    from supplemental_pe import PEImage
    from check_hair_attachment_native import compare_call_block, COMPARISON_SHA
    engine = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    core = Image(ROOT / 'assets/interlude/system/Core.dll', CORE_SHA)
    candidate = PEImage(comparison_engine, COMPARISON_SHA)
    checks = []


    def ins(va, mnemonic, operands):
        engine.instruction(va, mnemonic, operands)
        checks.append([hex(va), mnemonic, operands])


    def code(start, end):
        return bytes(engine.data[engine.offset(start):engine.offset(end)])


    def instructions(start, end):
        return list(engine.dis.disasm(code(start, end), start))


    methods = {
        '??0User@@QAE@XZ': (0x10358910, 0x10358975),
        '?GetItemClassID@User@@QAEHH@Z': (0x10482100, 0x10482998),
        '?GetAnimType@User@@QAEHPAVAPawn@@@Z': (0x10485c10, 0x10485dfa),
        '?SetPawnResource@User@@QAEXXZ': (0x104872f0, 0x104878a6),
        '?OnNpcInfo@UGameEngine@@UAEHPAUUser@@VFVector@@HAAVL2ParamStack@@@Z': (0x10494b40, 0x10495668),
    }
    for symbol, (start, _) in methods.items():
        assert engine.exported(symbol, True) == start

    # Resolve opcode 0x16 through the original dispatch table initializer.
    pattern = b'\xc7\x05' + struct.pack('<I', 0x10a57310 + 0x16 * 0x104)
    hits = [i for i in range(len(engine.data)) if engine.data.startswith(pattern, i)]
    assert hits == [0x536c1e]
    assert engine.u32(0x10836c1e + 6) == 0x103150ff
    ins(0x103150ff, 'jmp', '0x1043a470')

    # Native Deserialize arguments: strings consume destination + capacity.
    at = engine.offset(0x1088b5bc)
    packet_format = bytes(engine.data[at:engine.data.index(0, at)]).decode('ascii')
    assert packet_format == 'ddddddddddddddddddffffdddcccccSSddd'
    first = instructions(0x1043a4a4, 0x1043a622)
    pushes = [i for i in first if i.mnemonic == 'push']
    assert len(pushes) == len(packet_format) + packet_format.count('S') + 3 == 40
    second = instructions(0x1043a622, 0x1043a689)
    assert sum(i.mnemonic == 'push' for i in second) == 14
    ins(0x1043a68f, 'add', 'esp, 0xd8')
    fields = {}
    for field, name, push_va, lea_va, displacement, expected in [
        (18, 'speedMultiplier', 0x1043a51d, 0x1043a516, 0x140, 0xf8),
        (19, 'attackMultiplier', 0x1043a515, 0x1043a50e, 0x144, 0x100),
        (22, 'rightHand', 0x1043a4fd, 0x1043a4f9, 0x78, 0x40),
        (23, 'chest', 0x1043a4f8, 0x1043a4f4, 0x78, 0x44),
        (24, 'leftHand', 0x1043a4f3, 0x1043a4ef, 0x78, 0x48),
    ]:
        arg = field_argument_index(packet_format, field)
        selected = list(reversed(pushes[:-3]))[arg]
        assert selected.address == push_va
        lea = next(i for i in first if i.address == lea_va)
        assert lea.mnemonic == 'lea' and lea.op_str == f'{selected.op_str}, [esp + {hex(displacement)}]'
        prior = sum(i.address < lea_va for i in pushes)
        offset = displacement - prior * 4
        assert offset == expected
        fields[name] = {'fieldIndex': field, 'pushVA': hex(push_va), 'restoredStackOffset': hex(offset)}

    for anchor in [
        (0x1043a54e, 'xor', 'ebx, ebx'),
        (0x1043a748, 'mov', 'dword ptr [esi + 0x94], ebx'),
        (0x1043a7c7, 'fld', 'qword ptr [esp + 0x100]'),
        (0x1043a7ce, 'fstp', 'qword ptr [esi + 0x1bc]'),
        (0x1043a7d4, 'fld', 'qword ptr [esp + 0xf8]'),
        (0x1043a7db, 'fstp', 'qword ptr [esi + 0x1c4]'),
        (0x1043a7fb, 'mov', 'ecx, dword ptr [esp + 0x40]'),
        (0x1043a7ff, 'mov', 'dword ptr [esi + 0xb4], ecx'),
        (0x1043a805, 'mov', 'edx, dword ptr [esp + 0x48]'),
        (0x1043a809, 'mov', 'dword ptr [esi + 0xb8], edx'),
        (0x1043a80f, 'mov', 'ecx, dword ptr [esp + 0x44]'),
        (0x1043a813, 'mov', 'dword ptr [esi + 0xc0], ecx'),
        (0x1043ac1d, 'call', '0x10313449'),
        (0x1043ac39, 'mov', 'dword ptr [esi + 0x94], ebx'),
        (0x1043acf4, 'mov', 'dword ptr [esi + 0xb4], ecx'),
        (0x1043acfe, 'mov', 'dword ptr [esi + 0xb8], edx'),
        (0x1043ad08, 'mov', 'dword ptr [esi + 0xc0], ecx'),
        (0x10358910, 'xor', 'eax, eax'),
        (0x10358913, 'mov', 'esi, ecx'),
        (0x1035892d, 'push', '0x314'),
        (0x10358932, 'push', 'eax'),
        (0x10358933, 'push', 'esi'),
        (0x10358964, 'add', 'esp, 0xc'),
        (0x10482123, 'xor', 'edx, edx'),
        (0x10482128, 'mov', 'dword ptr [ebp - 0x18], edx'),
        (0x1048212e, 'cmp', 'dword ptr [edi + 0x94], edx'),
        (0x10482134, 'je', '0x1048266e'),
        (0x10482901, 'lea', 'eax, [edi + 0xb4]'),
        (0x1048290b, 'jle', '0x10482931'),
        (0x10482931, 'lea', 'eax, [edi + 0xd0]'),
        (0x1048293b, 'jle', '0x10482982'),
        (0x104827d4, 'lea', 'ecx, [edi + 0xd0]'),
        (0x104827de, 'jle', '0x1048281b'),
        (0x1048281b, 'lea', 'eax, [edi + 0xb8]'),
        (0x10482825, 'jle', '0x10482884'),
        (0x10482884, 'cmp', 'ebx, edx'),
        (0x10482886, 'jle', '0x104828c7'),
        (0x104828c7, 'lea', 'eax, [edi + 0xb4]'),
        (0x104828d1, 'jle', '0x10482982'),
        (0x1048277d, 'lea', 'eax, [edi + 0xd0]'),
        (0x10482789, 'lea', 'eax, [edi + 0xb4]'),
        (0x10482793, 'jle', '0x10482982'),
        (0x104827cc, 'lea', 'eax, [edi + 0xb8]'),
        (0x104827d2, 'jmp', '0x1048278f'),
        (0x10482982, 'mov', 'eax, dword ptr [ebp - 0x18]'),
        (0x10482995, 'ret', '4'),
        (0x10485c90, 'test', 'esi, esi'),
        (0x10485c92, 'je', '0x10485d85'),
        (0x10485d85, 'test', 'edi, edi'),
        (0x10485d87, 'je', '0x10485dbe'),
        (0x10485dbe, 'test', 'esi, esi'),
        (0x10485dc0, 'jne', '0x10485cb6'),
        (0x10485dc6, 'test', 'edi, edi'),
        (0x10485dc8, 'jne', '0x10485cb6'),
        (0x10485dce, 'test', 'eax, eax'),
        (0x10485dd0, 'je', '0x10485cb6'),
        (0x10485cb6, 'xor', 'eax, eax'),
        (0x10485cc8, 'ret', '4'),
        (0x104873ee, 'cmp', 'dword ptr [edi + 8], 0'),
        (0x10487406, 'call', '0x103148bc'),
        (0x10487410, 'push', '9'),
        (0x10487895, 'push', 'esi'),
        (0x10487899, 'mov', 'ecx, edi'),
        (0x1048789b, 'call', '0x103036fc'),
        (0x104878a0, 'mov', 'byte ptr [esi + 0x71d], al'),
        (0x1049543a, 'fld', 'qword ptr [ebp + 0x1bc]'),
        (0x10495447, 'fstp', 'dword ptr [esp + 0x10]'),
        (0x1049544b, 'fld', 'dword ptr [esp + 0x10]'),
        (0x1049544f, 'fstp', 'dword ptr [eax + 0x6b0]'),
        (0x1049545b, 'fld', 'qword ptr [ebp + 0x1c4]'),
        (0x10495468, 'fstp', 'dword ptr [esp + 0x10]'),
        (0x1049546c, 'fld', 'dword ptr [esp + 0x10]'),
        (0x10495470, 'fstp', 'dword ptr [ecx + 0x6b4]'),
        (0x10495608, 'fldz', ''),
        (0x1049560e, 'push', '1'),
        (0x10495613, 'fstp', 'dword ptr [esp + 8]'),
        (0x10495619, 'fld', 'dword ptr [ecx + 0x6b4]'),
        (0x10495623, 'fstp', 'dword ptr [esp + 4]'),
        (0x1049562e, 'add', 'edi, 0x328'),
        (0x10495634, 'call', '0x10306ee2'),
        (0x10495652, 'push', '0'),
        (0x10495654, 'call', 'eax'),
    ]:
        ins(*anchor)

    assert engine.exported('??0User@@QAE@XZ') == 0x10313449
    assert engine.exported('?GetAnimType@User@@QAEHPAVAPawn@@@Z') == 0x103036fc
    assert engine.exported('?GetNpcMeshName@User@@QAE?AVFName@@XZ') == 0x103148bc
    assert engine.exported('?GetCurWaitAnimName@APawn@@QAE?AVFName@@XZ') == 0x10306ee2
    expected_table = {10:0x10482901, 11:0x104827d4, 12:0x1048277d, 13:0x104827cc}
    for slot, target in expected_table.items():
        assert engine.u32(0x10482a04 + slot * 4) == target

    # A full constructor comparison, not a guessed imported name from arguments.
    start, end = methods['??0User@@QAE@XZ']
    candidate_start = candidate.body('??0User@@QAE@XZ')
    constructor = compare_call_block(code(start, end), candidate.read(candidate_start, end-start),
        owned_va=start, candidate_va=candidate_start,
        sites=[(0x1035895e-start, ('core.dll', '?appMemset@@YAXPAXHH@Z'))],
        direct_calls=[], imports=candidate.imports)
    assert core.exported('?appMemset@@YAXPAXHH@Z', True) == 0x1012da20
    core.instruction(0x1012da20, 'jmp', '0x1017b980')
    core.instruction(0x1017b980, 'mov', 'edx, dword ptr [esp + 0xc]')
    core.instruction(0x1017b984, 'mov', 'ecx, dword ptr [esp + 4]')
    core.instruction(0x1017b98e, 'mov', 'al, byte ptr [esp + 8]')
    core.instruction(0x1017b9df, 'rep stosd', 'dword ptr es:[edi], eax')

    report = {
        'engineSHA256': engine.sha, 'coreSHA256': core.sha,
        'ownedAnchors': len(checks), 'ownedCoreAnchors': 5,
        'methods': [{'symbol': symbol, 'start':hex(a), 'endExclusive':hex(b),
                     'SHA256': hashlib.sha256(code(a,b)).hexdigest()} for symbol,(a,b) in methods.items()],
        'packetOpcode': 0x16, 'packetFields': fields,
        'userFields': {'equipmentBankMode':'0x94=0', 'rightHand':'0xb4', 'leftHand':'0xb8',
                       'chest':'0xc0', 'fallbackItem':'0xd0', 'speedMultiplier':'0x1c4', 'attackMultiplier':'0x1bc'},
        'itemLookupEmptyBank': {'requiredZeroFields':['0xb4','0xb8','0xd0'],
                              'getItemClassID10_11_12_13':0,
                              'proof':'retained zero-result initialization and signed branches; no item lookup on this empty-bank branch'},
        'constructorComparison': {'candidateSHA256': candidate.sha, **constructor,
            'status':'supplemental-full-body-correspondence',
            'limit':'The candidate call is named appMemset(this,0,0x314). The owned six-NOP import is not restored or independently bound; distributor authenticity unverified.'},
        'initialWait': {'channel':0, 'loop':1, 'tween':0, 'rate':'Float32(packet field18 speedMultiplier)',
                        'selector':'GetCurWaitAnimName after SetPawnResource stores GetAnimType at Pawn+0x71d'},
        'remainingAdmission': [
            'Owned User constructor import 0x1035895e is erased: zero fallback field is conditional on supplemental appMemset correspondence, not owned restoration.',
            'GetAnimType looks up GetItemClassID outputs again. A complete stance-zero admission must establish the metadata map key0 behavior; null lookup yields 0, not a universally assumed sentinel.',
            'Existing User records can retain +0xd0; this checkpoint does not exclude every other writer over the User lifetime.',
            'NPC instance class, root-lock/local modifiers/extra channels and action transition clocks remain separate from the recovered initial-wait rate.',
            'No runtime admission, game connections, native execution, public source edits or visual parity claim.'
        ],
    }
    # The complete two-part original wire format. Preserve opaque fields instead
    # of turning unobserved client-local state into a neutral-state assertion.
    second_va = 0x1088b5ac
    at = engine.offset(second_va)
    extension = bytes(engine.data[at:engine.data.index(0, at)]).decode('ascii')
    assert extension == 'dddddccffdd'
    packet_fields = {}
    for fmt, start, end, pending_bytes in [
        (packet_format, 0x1043a4a4, 0x1043a622, 0),
        (extension, 0x1043a622, 0x1043a689, 160),
    ]:
        rows = instructions(start, end)
        push = [i for i in rows if i.mnemonic == 'push']
        destinations = list(reversed(push[:-3]))
        for field, kind in enumerate(fmt):
            if kind == 'S':
                continue  # Strings have two arguments; they are not this audit's state inputs.
            selected = destinations[field_argument_index(fmt, field)]
            lea = next(i for i in reversed(rows[:rows.index(selected)])
                       if i.mnemonic == 'lea' and i.op_str.startswith(selected.op_str + ', [esp'))
            displacement = int(lea.op_str.split(' + ')[1].rstrip(']'), 16)
            prior = sum(i.address < lea.address for i in push)
            packet_fields[('first' if not pending_bytes else 'extension') + ':' + str(field)] = {
                'kind': kind, 'pushVA': hex(selected.address),
                'restoredStackOffset': hex(displacement - prior * 4 - pending_bytes)}
    assert [packet_fields[f'first:{i}']['restoredStackOffset'] for i in range(25, 30)] == [
        '0x98', '0xb8', '0xa0', '0xb0', '0x60']
    assert [packet_fields[f'first:{i}']['restoredStackOffset'] for i in range(32, 35)] == [
        '0x50', '0xa4', '0x6c']
    assert [packet_fields[f'extension:{i}']['restoredStackOffset'] for i in range(11)] == [
        '0x54', '0xac', '0xb4', '0x94', '0xa8', '0xf', '0x17', '0xf0', '0xe8', '0x24', '0x68']

    more = [
        (0x1043b030, 'mov', 'edx, dword ptr [esp + 0x98]'),
        (0x1043b03d, 'push', 'edx'), (0x1043b045, 'call', 'edi'),
        (0x1043b047, 'mov', 'eax, dword ptr [esp + 0xb8]'),
        (0x1043b058, 'mov', 'ecx, dword ptr [esp + 0xa0]'),
        (0x1043b069, 'mov', 'edx, dword ptr [esp + 0xb0]'),
        (0x1043b07a, 'mov', 'eax, dword ptr [esp + 0x60]'),
        (0x1043b0b3, 'mov', 'edx, dword ptr [edx + 0x258]'),
        (0x1043b0df, 'call', 'edx'),
        (0x10494b70, 'call', 'ebp'),
        (0x10494b74, 'mov', 'dword ptr [esp + 0xa4], eax'),
        (0x10494b7f, 'mov', 'dword ptr [esp + 0xa8], eax'),
        (0x10494b8a, 'mov', 'dword ptr [esp + 0xa0], eax'),
        (0x10494b95, 'mov', 'dword ptr [esp + 0x30], eax'),
        (0x10495352, 'cmp', 'dword ptr [esp + 0xa0], 0'),
        (0x10495440, 'mov', 'dl, byte ptr [esp + 0xa4]'),
        (0x10495461, 'mov', 'al, byte ptr [esp + 0xa8]'),
        (0x10495476, 'mov', 'byte ptr [esi + 0x435], dl'),
        (0x1049547c, 'mov', 'byte ptr [esi + 0x434], al'),
        (0x10495484, 'or', 'dword ptr [esi + 0x41c], 2'),
        (0x10495492, 'or', 'dword ptr [esi + 0x41c], 1'),
        (0x1043ac36, 'mov', 'dword ptr [esi + 0xc], edx'),
        (0x1043ad29, 'mov', 'dword ptr [esi + 0x194], edx'),
        (0x1043ad33, 'mov', 'dword ptr [esi + 0x198], ecx'),
        (0x1043b159, 'mov', 'ecx, dword ptr [esp + 0x54]'),
        (0x1043b15d, 'mov', 'dword ptr [eax + 0x17d0], ecx'),
        (0x1043b163, 'movsx', 'edx, byte ptr [esp + 0xf]'),
        (0x1043b16e, 'mov', 'dword ptr [eax + 0x778], edx'),
        (0x1043b174, 'movsx', 'ecx, byte ptr [esp + 0x17]'),
        (0x1043b17c, 'call', '0x103022f7'),
        (0x1043abef, 'mov', 'eax, dword ptr [esp + 0x60]'),
        (0x1043abf5, 'je', '0x1043ac00'),
        (0x1043abf7, 'cmp', 'eax, 2'),
        (0x1043abfa, 'jne', '0x1043b270'),
        (0x10495656, 'cmp', 'dword ptr [esp + 0x44], 2'),
        (0x10495663, 'call', '0x10307d5b'),
        (0x1061ce7b, 'cmp', 'dword ptr [0x10c51034], 0'),
        (0x1061ce88, 'test', 'byte ptr [esi + 0x694], 4'),
        (0x1061724c, 'test', 'byte ptr [esi + 0x17ec], bl'),
        (0x10617297, 'test', 'byte ptr [eax + 0x41c], bl'),
        (0x106172c2, 'test', 'byte ptr [esi + 0x714], bl'),
        (0x106172df, 'push', '0x40'), (0x10617307, 'push', '0x20000'),
        (0x10617334, 'push', '0x40000'),
        (0x10617373, 'test', 'byte ptr [esi + 0x720], bl'),
        (0x106173b0, 'mov', 'cl, byte ptr [eax + 0x435]'),
        (0x10617415, 'test', 'byte ptr [eax + 0x41c], 2'),
        (0x10617422, 'cmp', 'byte ptr [esi + 0x34], 3'),
        (0x1061748f, 'mov', 'edx, dword ptr [esi + ecx*4 + 0x88c]'),
        (0x1061752a, 'mov', 'edx, dword ptr [esi + ecx*4 + 0x86c]'),
        (0x106a7d28, 'cmp', 'dword ptr [eax + 0x3c], ebx'),
        (0x10615ae6, 'call', '0x10306bd1'),
        (0x106b9b66, 'cmp', 'dword ptr [ebx + 0x1ac], esi'),
        (0x106b9b6c, 'jle', '0x106b9b9b'),
        (0x106b9b9e, 'xor', 'eax, eax'),
        (0x10341290, 'mov', 'eax, dword ptr [ecx + 0x73c]'),
        (0x10341296, 'and', 'eax, 1'),
        (0x103412a0, 'mov', 'eax, dword ptr [ecx + 0x748]'),
        (0x103412a6, 'and', 'eax, 1'),
        (0x104803a4, 'cmp', 'dword ptr [esi + 0x1834], ebx'),
        (0x104803c3, 'call', '0x10302ee1'),
        (0x104803cf, 'mov', 'dword ptr [esi + 0x1834], eax'),
        (0x104803d8, 'call', '0x1030c865'),
        (0x104803e3, 'call', '0x1030ce87'),
        (0x104803ee, 'call', '0x1030d41d'),
        (0x10468bf3, 'add', 'esi, 0xc'),
        (0x10468bfa, 'mov', 'ecx, dword ptr [edx + 0x1834]'),
        (0x10468c00, 'call', '0x10308148'),
        (0x10469684, 'add', 'esi, 0xc'),
        (0x1046968b, 'mov', 'ecx, dword ptr [edx + 0x1834]'),
        (0x10469691, 'call', '0x10308148'),
        (0x1046aaa3, 'mov', 'ecx, dword ptr [edx + 0x1834]'),
        (0x1046aaa9, 'call', '0x10308148'),
        (0x104596f2, 'push', '0xc'), (0x104596f4, 'push', '1'),
        (0x10459714, 'mov', 'dword ptr [edi + 4], eax'),
        (0x10459719, 'mov', 'dword ptr [edi + 8], edx'),
        (0x10479d6d, 'mov', 'dword ptr [esi + 0xc], 0'),
        (0x10479d74, 'mov', 'dword ptr [esi + 0x10], 8'),
        (0x10422f13, 'xor', 'eax, eax'),
    ]
    for anchor in more:
        ins(*anchor)
    assert engine.u32(engine.exported('??_7UGameEngine@@6BUObject@@@') + 0x258) == engine.exported(
        '?OnNpcInfo@UGameEngine@@UAEHPAUUser@@VFVector@@HAAVL2ParamStack@@@Z')
    for symbol, address in [
        ('?SpawnEnterEvent@APawn@@QAEXXZ', 0x10307d5b),
        ('?SetEventmatchEffect@User@@QAEXH@Z', 0x103022f7),
        ('?ClearBoneDirection@USkeletalMeshInstance@@QAEHVFName@@@Z', 0x10306bd1),
    ]:
        assert engine.exported(symbol) == address

    # Same-address import slots differ in the comparison image. Bind only the
    # exact compared operands, never look an owned slot up in another PE's IAT.
    param_blocks = []
    for start, end, operand, old, new, symbol in [
        (0x1043b030, 0x1043b0a5, 0x1043b039, 0x11d8daf0, 0x11d8daec, '?PushBack@L2ParamStack@@QAEHPAX@Z'),
        (0x10494b55, 0x10494bab, 0x10494b5f, 0x11d8dadc, 0x11d8dad8, '?Top@L2ParamStack@@QAEPAXXZ'),
    ]:
        owned, other = bytearray(code(start, end)), candidate.read(start, end-start)
        offset = operand-start
        assert struct.unpack_from('<I', owned, offset)[0] == old
        assert struct.unpack_from('<I', other, offset)[0] == new
        assert candidate.imports[new] == ('core.dll', symbol)
        owned[offset:offset+4] = struct.pack('<I', new)
        assert bytes(owned) == other
        param_blocks.append({'start':hex(start),'bytes':end-start,'namedImport':symbol,
                             'ownedSHA256':hashlib.sha256(code(start,end)).hexdigest()})
    for anchor in [
        (0x1015b5e8, 'mov', 'edx, dword ptr [ecx + 4]'),
        (0x1015b5f2, 'mov', 'eax, dword ptr [eax + edx*4]'),
        (0x1015b5f5, 'add', 'edx, 1'),
        (0x1015b5f8, 'mov', 'dword ptr [ecx + 4], edx'),
    ]:
        core.instruction(*anchor)

    from check_supplemental_engine import compare_method
    lo, hi = 0x10479d40, 0x10479d9a
    owned, other = code(lo,hi), candidate.read(lo,hi-lo)
    pair = (struct.unpack_from('<I', owned, 3)[0], struct.unpack_from('<I', other, 3)[0])
    map_constructor = compare_method(owned, other, lo, lo, candidate.imported_call,
        lambda va,n:code(va,va+n), candidate.read, pair)
    assert [(r['kind'],r.get('binding')) for r in map_constructor['differences']] == [
        ('explicit-handler-reference',None),('named-import',['core.dll','??0FArray@@QAE@XZ'])]
    append = compare_call_block(code(0x104596f0,0x1045975f), candidate.read(0x104596f0,111),
        owned_va=0x104596f0,candidate_va=0x104596f0,
        sites=[(8,('core.dll','?Add@FArray@@QAEHHH@Z'))],direct_calls=[],imports=candidate.imports)

    # Interpret the unchanged native lookup body with adversarial hash chains.
    # Zero is an ordinary possible key, not a native sentinel. Inserting zero
    # returns its value; the actual original tables above are what exclude it.
    from check_track_native import Machine
    class LookupMachine(Machine):
        def step(self, instruction):
            if instruction.mnemonic == 'and':
                left,right=instruction.op_str.split(', ')
                self.write(left,self.read(left)&self.read(right))
                # This slice always executes CMP before its next conditional jump.
                return instruction.address+instruction.size
            return super().step(instruction)
    lookup_cases = 0
    for keys, query in [([],0),([8,16,24],0),([0,8,16],0),([8,16,24],16),([1,9],17)]:
        address,entry,bucket,stack,query_ptr=0x1000,0x2000,0x3000,0x4000,0x5000
        memory={address:entry,address+12:bucket,address+16:8,stack+4:query_ptr,query_ptr:query}
        for i in range(8):memory[bucket+4*i]=0xffffffff
        for i,key in enumerate(keys):
            h=key&7
            memory[entry+12*i]=memory[bucket+4*h]
            memory[entry+12*i+4]=key;memory[entry+12*i+8]=0x6000+4*i
            memory[bucket+4*h]=i
        machine=LookupMachine(memory,{'ecx':address,'esp':stack,'esi':0},instructions(0x10422ee0,0x10422f24))
        machine.execute(0x10422ee0)
        expected=0x6000+4*keys.index(query) if query in keys else 0
        assert machine.registers['eax']==expected
        lookup_cases+=1

    sys.path[:0] = [str(ROOT/'tools/dat'), str(ROOT/'tools/anim')]
    from build_meta import original_item_tables
    from build_npc_variants import recover_selectors
    from extract_gamedata import decrypt
    tables, item_sources = original_item_tables()
    groups = absent_zero_item_ids({label:[r['object_id'] for r in tables[name]] for label,name in [
        ('weapon','weapongrp.json'),('armor','armorgrp.json'),('etc','etcitemgrp.json')]})
    with tempfile.TemporaryDirectory(prefix='elbera-npc-evidence-') as temporary:
        selectors = recover_selectors(temporary, [18342,20001,20091])
        npc_data = decrypt('npcgrp.dat', temporary)
    starter_gremlin = verify_starter_gremlin(engine, npc_data, selectors)
    source_domain = {}
    for npc_id, class_name, mesh_name, animation_name in [
        ('18342','LineageMonster.gremlin','LineageMonsters.gremlin_m00','LineageMonsters.gremlin_anim'),
        ('20001','LineageMonster.gremlin','LineageMonsters.gremlin_m00','LineageMonsters.gremlin_anim'),
        ('20091','LineageMonster.fox','LineageMonsters.fox_m00','LineageMonsters.Fox_anim'),
    ]:
        row=selectors['npcs'][npc_id]
        assert row['className']==class_name and row['meshName']==mesh_name
        mesh=selectors['meshes'][mesh_name.casefold()]
        assert mesh['animation']==animation_name
        animation=selectors['animations'][animation_name.casefold()]
        picks={field:row['selectors'][field]['0'] for field in ('WaitAnimName','AtkWaitAnimName')}
        assert all(v['status']=='source-sequence' for v in picks.values())
        source_domain[npc_id]={'class':class_name,'mesh':mesh_name,'animation':animation_name,
            'ancestry':row['inheritance'],'meshExportSHA256':mesh['sourceExportSHA256'],
            'animationExportSHA256':animation['sourceExportSHA256'],'stanceZeroSelectors':picks}

    # Reuse the independently reviewed fresh CDO-template chain. Its conclusion
    # cannot certify packet-created actor flags or a later modified instance.
    from check_pose_allocation_native import verify as allocation_verify
    allocation=allocation_verify(comparison_engine,comparison_core)
    spawn_event=verify_spawn_enter_event(engine,candidate)
    report.update(format='l2-npc-initial-animation-evidence-v1',status='conditional-inputs-verified;live-admission-unresolved',
        ownedAnchors=len(checks),ownedCoreAnchors=9,packetFields=packet_fields,
        packetFormats=[packet_format,extension],paramStackCorrespondence=param_blocks,
        itemKeyZero={'interpretedLookupCases':lookup_cases,'originalTables':groups,'sources':item_sources,'mapConstructor':map_constructor,'append':append,
            'scope':'Fresh original table load only; source key0 absent, native lookup miss returns null. Runtime table mutation excluded.'},
        sourceDomain=source_domain,sourcePackages=selectors['sources'],
        starterGremlin=starter_gremlin,
        spawnEnterEvent=spawn_event,
        freshInstance={'status':allocation['status'],'ownedEngine':allocation['ownedEngine'],
            'ownedCore':allocation['ownedCore'],'supplementalEngine':allocation['supplementalEngine'],
            'supplementalCore':allocation['supplementalCore'],'proof':'check_pose_allocation_native.py',
            'limit':'Fresh ordinary CDO-template chain only; does not prove this network actor has no later modifiers.'},
        initialWait={'channel':0,'loop':1,'tween':0,'rate':'Float32(packet field18 speedMultiplier)',
            'normalWaitType':1,'stance':0,'combatZero':'WaitAnimName[0]','combatNonzero':'AtkWaitAnimName[0]',
            'condition':'After all prior GetCurWait branches have been excluded; combat is not IsDamageAct.'},
        remainingAdmission=[
            'User constructor memset is supplemental correspondence, not restored owned import; reused User state is excluded.',
            'Fresh source table stance zero is conditional on empty right/left/fallback equipment bank.',
            'SpawnEnterEvent exits on the checked fresh original table miss for Gremlin/Fox only; changed templates/tables and other NPCs remain outside that proof.',
            'Initial loop/event precede the packet store to Pawn+17d0. UpdateAbnormalState visits existing entries before its zero-mask creation gate; no fresh empty-list admission is asserted.',
            'Lobby, riding, fishing, swimming overrides, damage/spine state and extra channels/modifiers need actual actor-lifecycle admission.',
            'Original Wait/AtkWait sound notifies are not rendered by this selector proof.',
            'No unconditional live NPC playback admission or full rendering/behavior parity is established.'])
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--comparison-engine',type=Path,required=True)
    parser.add_argument('--comparison-core',type=Path,required=True)
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    result=verify(args.comparison_engine,args.comparison_core)
    if args.check:
        print(f"Elbera NPC initial-animation inputs: {result['ownedAnchors']} Engine anchors; "
              f"{result['ownedCoreAnchors']} Core anchors; {len(result['sourceDomain'])} source NPCs; "
              f"{result['starterGremlin']['ownedAnchors']} starter-profile anchors; "
              f"{result['starterGremlin']['recordCount']} independently framed NPC records; "
              f"{result['spawnEnterEvent']['ownedAnchors']} additional event/order anchors; "
              f"{result['spawnEnterEvent']['recordCount']} unique original spawn-event records; "
              "Gremlin/Fox event miss verified; live neutral-state admission unresolved.")
    else:
        print(json.dumps(result,indent=2))


if __name__=='__main__':
    main()
