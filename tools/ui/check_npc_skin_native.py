#!/usr/bin/env python3
"""Elbera Tools: original stored NPC GPU skin inputs and native consumer evidence.

Reads pinned Interlude originals in memory. Never executes or writes a DLL,
changes a model, or claims equivalent native deformation. Original-input check;
portable correspondence/ingestion tests live with the NPC exporter and loader.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]


def verify_serialization():
    sys.path[:0] = [str(ROOT / p) for p in ('tools/ui', 'tools/dat', 'tools/anim')]
    from check_tutorial_quest_native import Image, ENGINE_SHA
    from build_hair import Sources, source_lod0
    from build_npc_variants import unique_source_export
    from l2lib.ue2package import Reader
    sha = lambda data: hashlib.sha256(data).hexdigest()
    image = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, decode=True)
    checks = []
    def at(a, mnemonic, operands):
        image.instruction(a, mnemonic, operands)
        checks.append({'VA': hex(a), 'mnemonic': mnemonic, 'operands': operands})
    def raw(a, n):
        return bytes(image.data[image.offset(a):image.offset(a)+n])
    def stub(a, dest):
        at(a, 'jmp', hex(dest))
    def nop(a):
        assert raw(a, 6) == b'\x90' * 6, hex(a)

    assert image.exported('?Serialize@USkeletalMesh@@UAEXAAVFArchive@@@Z', True) == 0x106e61c0
    for a, m, op in [
        (0x106e61e1,'mov','edi, ecx'),
        (0x106e62fd,'lea','eax, [edi + 0x218]'),
        (0x106e6305,'call','0x1030fe48'),
        (0x106e58ba,'mov','edi, dword ptr [ebp + 0xc]'),
        (0x106e58f2,'push','0x174'),
        (0x106e5905,'call','0x1030970a'),
        (0x106e590c,'call','0x1031450b'),
        (0x106e592a,'lea','eax, [edi + 4]'),
        (0x106e5942,'imul','edx, edx, 0x174'),
        (0x106e5948,'add','edx, dword ptr [edi]'),
        (0x106e594c,'call','0x1031450b'),
        (0x106e54c6,'mov','edi, dword ptr [esp + 0x10]'),
        (0x106e551e,'lea','ecx, [edi + 0xf0]'),
        (0x106e5526,'call','0x10301f69'),
        (0x106e552b,'lea','edx, [edi + 0x108]'),
        (0x106e5533,'call','0x10305448'),
        (0x106e5538,'lea','eax, [edi + 0x120]'),
        (0x106e5540,'call','0x1030fafb'),
        (0x106e5548,'lea','ecx, [edi + 0x138]'),
        (0x106e5550,'call','0x1030f114'),
        (0x106e55e2,'cmp','eax, 0x1c'),
        (0x106e55e5,'jl','0x106e561c'),
        (0x106e55e7,'push','4'),
        (0x106e55e9,'lea','eax, [edi + 0x168]'),
        (0x106e55f8,'lea','ecx, [edi + 0x1c]'),
        (0x106e55fd,'call','0x10305592'),
        (0x106c441e,'mov','esi, dword ptr [ebp + 0xc]'),
        (0x106c4418,'push','0x34'),
        (0x106c444b,'cmp','eax, dword ptr [esi + 4]'),
        (0x106c446b,'push','0x34'),
        (0x106c4474,'call','0x10304331'),
        (0x106c4481,'lea','eax, [esi + 4]'),
        (0x106c449b,'imul','ecx, ecx, 0x34'),
        (0x106c449e,'add','ecx, dword ptr [esi]'),
        (0x106c44a2,'call','0x10304331'),
        (0x106b0d61,'mov','esi, dword ptr [esp + 8]'),
        (0x106b0d6d,'cmp','eax, 0x1c'),
        (0x106b0d70,'jl','0x106b0e5f'),
        (0x106b0d78,'mov','edi, dword ptr [esp + 0x14]'),
        (0x106b0d7c,'push','4'),
        (0x106b0d7e,'push','edi'),
        (0x106b0d89,'lea','eax, [edi + 4]'),
        (0x106b0d97,'lea','ecx, [edi + 8]'),
        (0x106b0da5,'lea','ebx, [edi + 0xc]'),
        (0x106b0db3,'lea','edx, [ebx + 4]'),
        (0x106b0dc1,'add','ebx, 8'),
        (0x106b0dcf,'lea','ebx, [edi + 0x18]'),
        (0x106b0ddd,'add','ebx, 4'),
        (0x106b0e27,'lea','eax, [edi + 0x24]'),
        (0x106b0e35,'lea','ecx, [edi + 0x28]'),
        (0x106b0e43,'lea','edx, [edi + 0x2c]'),
        (0x106b0e51,'add','edi, 0x30'),
        (0x106d8d6e,'lea','eax, [ebp - 0x14]'),
        (0x106d8d73,'call','0x1030599d'),
        (0x106d8d8d,'lea','eax, [edi + 0xc]'),
        (0x106d8d92,'call','0x10309714'),
        (0x106d8fd6,'call','0x1030599d'),
        (0x106d8ff0,'lea','eax, [edi + 0xc]'),
        (0x106d8ff5,'call','0x1030e9b2'),
    ]: at(a,m,op)
    for a,dest in [(0x1030fe48,0x106e5890),(0x1030970a,0x106e52f0),
                   (0x1031450b,0x106e54c0),(0x10305592,0x106c43f0),
                   (0x10304331,0x106b0d60),(0x10301f69,0x106d8cf0),
                   (0x10305448,0x106d8f50)]: stub(a,dest)
    for lane, (push, address, call) in enumerate([
        (0x106b0dee,0x106b0df0,0x106b0df6),
        (0x106b0dfd,0x106b0dff,0x106b0e05),
        (0x106b0e0c,0x106b0e0e,0x106b0e14),
        (0x106b0e1b,0x106b0e1d,0x106b0e23)]):
        at(push,'push','1'); at(address,'lea',f'ecx, [edi + {hex(0x20+lane)}]'); at(call,'call','edx')
    missing = [0x106e55c0,0x106e55dc,0x106e55f2,0x106c4423,0x106c442b,
               0x106c443a,0x106c445a,0x106c4486,0x106b0d67,
               0x106b0d81,0x106b0d8f,0x106b0d9d,0x106b0dab,0x106b0db9,
               0x106b0dc7,0x106b0dd5,0x106b0de3,0x106b0e2d,0x106b0e3b,
               0x106b0e49,0x106b0e57]
    for a in missing: nop(a)

    ranges = [(0x106e5890,0x106e596c),(0x106e54c0,0x106e5621),
              (0x106c43f0,0x106c44c2),(0x106b0d60,0x106b0e63)]
    sources=Sources(); package=sources.get('animations','LineageMonsters'); models=[]
    assert sha(Path(package.path).read_bytes()) == '157715304bfb1f289ce6bf202e5651f3809f57d5b061239db0c6a2a817c9a9c9'
    expected = {
        'gremlin_m00': (1324, '49d1c6384c12d64d9e2cab2822b9693101b3b657df72f6ec2614e2181997c506'),
        'fox_m00': (422, 'c3fcdd2b5c22297276f70641d081e52cfb11b7d35838b58d54b9fd7eb1dd766c'),
    }
    for name, (expected_count, expected_hash) in expected.items():
        ref='LineageMonsters.'+name
        export=unique_source_export(package,ref,'SkeletalMesh'); lod=source_lod0(package,export)
        export_end=export.serial_offset+export.serial_size
        # Independent read of the original later fields, at the previously bounded
        # fourth lazy saved-end. Not a glTF/PSK or normalized influence comparison.
        start=lod['lazyArrays'][-1]['savedEnd']
        assert export.serial_offset <= start < export_end
        reader=Reader(memoryview(package.data)[:export_end],start)
        scalar_bytes=reader.bytes(24); flag_offset=reader.pos; flag=reader.i32()
        count_offset=reader.pos; count=reader.compact(); payload_offset=reader.pos
        assert count>0 and payload_offset+52*count<=export_end
        payload=reader.bytes(52*count)
        assert count == expected_count and sha(payload) == expected_hash
        assert reader.pos == lod['sourceLOD0']['end'] and count == len(lod['vertices'])
        assert flag == lod['useNewWedges'] == 1 and lod['stream']=='soft'
        for index, v in enumerate(lod['vertices']):
            record=payload[index*52:(index+1)*52]
            values=struct.unpack('<8f4B4f',record)
            assert list(values[:3])==v['position'] and list(values[3:6])==v['normal']
            assert list(values[6:8])==v['uv'] and list(values[8:12])==v['localBones']
            assert list(values[12:])==v['weights']
        models.append({'meshRef':ref,'exportSHA256':lod['sourceExportSHA256'],
            'exportBounds':[export.serial_offset,export_end], 'sourceLOD0':lod['sourceLOD0'],
            'precedingSixScalarSHA256':sha(scalar_bytes),'flagOffset':flag_offset,'flag':flag,
            'countOffset':count_offset,'payloadOffset':payload_offset,'soft52Count':count,
            'soft52SHA256':sha(payload),'lazyArrays':lod['lazyArrays'],
            'recordBytesChecked':len(payload)})
    receipt={'format':'elbera-original-npc-skin-evidence-v1','engineSHA256':ENGINE_SHA,
        'instructionChecks':len(checks),'checks':checks,
        'ranges':[{'start':hex(a),'end':hex(b),'SHA256':sha(raw(a,b-a))} for a,b in ranges],
        'sixNOPUnknownTargets':[hex(a) for a in missing],
        'source':{'packageSHA256':sha(Path(package.path).read_bytes()),
                  'archiveVersion':package.file_version,'licenseeVersion':package.licensee_version},
        'models':models,
        'scope':'Retained serializer destination/stride and fresh original raw records only; no runtime stream selection or GPU deformation claim.',
        'limitations':['Archive predicate/version/scalar helper targets at six-NOP sites remain unbound in owned image.',
                       'UseNewWedges and field type names are decoder labels; physical offsets/transfer widths are independently pinned.',
                       'No DLL execution or source/model changes; retained input evidence is not full native deformation parity.']}
    return receipt


def verify_consumer(comparison_engine):
    from check_tutorial_quest_native import Image, ENGINE_SHA
    from supplemental_pe import PEImage
    from check_supplemental_engine import compare_method, CANDIDATE_ENGINE_SHA
    old=Image(ROOT / 'assets/interlude/system/engine.dll',ENGINE_SHA,True)
    new=PEImage(comparison_engine,CANDIDATE_ENGINE_SHA)
    read=lambda a,n: bytes(old.data[old.offset(a):old.offset(a)+n])
    results=[]
    for start,end in [(0x106e5392,0x106e539d),(0x106e55da,0x106e55f8),(0x106e5605,0x106e561c)]:
     result=compare_method(read(start,end-start),new.read(start-0x40,end-start),start,start-0x40,new.imported_call,read,new.read)
     result['ownedVA']=hex(start);results.append(result)
    # These explicit data-import operands are the only differences in this gate.
    start,end=0x106e01bc,0x106e0212
    original=read(start,end-start);candidate=bytearray(new.read(start-0x40,end-start));bindings=[]
    for a,b in [(0x11d8dbe4,0x11d8dbe0),(0x11d8e038,0x11d8e034),(0x11d8dd98,0x11d8dd94)]:
     x=a.to_bytes(4,'little');y=b.to_bytes(4,'little')
     assert original.count(x)==1 and candidate.count(y)==1
     off=original.index(x);assert candidate[off:off+4]==y
     candidate[off:off+4]=x
     bindings.append({'ownedSlot':hex(a),'candidateSlot':hex(b),'offset':off,'binding':new.imports[b]})
    assert candidate==original
    out={'scope':'static input binding only; no original execution or D3D shader/deformation equivalence',
     'ownedSHA256':ENGINE_SHA,'comparisonSHA256':CANDIDATE_ENGINE_SHA,'archiveAuthentication':'unverified supplemental archive',
     'blocks':results,'gpuGate':{'ownedVA':hex(start),'bytes':end-start,'SHA256':hashlib.sha256(original).hexdigest(),'differences':bindings},
     'anchors':{'LODStride':'0x174','embeddedStream':'LOD+0xb4','streamLODPointer':'LOD+0xc4 == stream+0x10; loading write at 0x106e5613',
     'streamData':'GetStreamData 0x106b2030 reads LOD+0x1c and count+0x20; copies count*52 at0x106b2058..2072',
     'renderStreams':['0x106e0703 LOD+0xb4 then render interface+0xdc','0x106e07d9 LOD+0xb4 then render interface+0x50'],
     'copyHelper':'0x107a62a0 retained integer byte-copy routine; no named memcpy import claim',
     'conditional':'ordinary gate noneditor AND (GL2GPUSkinning OR GL2Shader) AND LOD+168 AND smoothSectionCount>0 AND material exclusion local+44==0; other actor-special branches differ'},
     'limits':['not all native rendering uses stored GPU stream','CPU path separate encoded stream','full serializer has an unrelated differing direct-call target; only listed blocks compared','copy helper has optimized branches, not a full instruction evaluator','component enum/D3D shader meaning excluded']}
    assert [tuple(row['binding']) for row in bindings] == [
        ('core.dll', '?GIsEditor@@3HA'), ('core.dll', '?GL2GPUSkinning@@3HA'),
        ('core.dll', '?GL2Shader@@3HA')]
    assert [row['binding'][1] for block in results for row in block['differences']
            if row['kind'] == 'named-import'] == [
                '?LicenseeVer@FArchive@@QAEHXZ', '?ByteOrderSerialize@FArchive@@QAEAAV1@PAXH@Z',
                '?IsLoading@FArchive@@QAEHXZ']
    checks = []
    def ins(va, mnemonic, operands):
        old.instruction(va, mnemonic, operands)
        checks.append([hex(va), mnemonic, operands])
    for symbol, address in [
        ('??0FGPUSkinVertexStream@@QAE@XZ', 0x10363250),
        ('?GetStride@FGPUSkinVertexStream@@UAEHXZ', 0x10363380),
        ('?GetStreamData@FGPUSkinVertexStream@@UAEXPAX@Z', 0x106b2030),
        ('?RecalcSkinningStream@USkeletalMesh@@QAEXXZ', 0x106ec150),
    ]:
        assert old.exported(symbol, True) == address
    for row in [
        (0x10312fdf, 'jmp', '0x10363250'),
        (0x106e5392, 'lea', 'ecx, [esi + 0xb4]'),
        (0x106e5398, 'call', '0x10312fdf'),
        (0x106e5613, 'mov', 'dword ptr [edi + 0xc4], edi'),
        (0x10363380, 'mov', 'eax, 0x34'),
        (0x106e01c2, 'cmp', 'dword ptr [ecx], 0'),
        (0x106e01c5, 'jne', '0x106e021a'),
        (0x106e01cd, 'cmp', 'dword ptr [edx], 0'),
        (0x106e01d0, 'jne', '0x106e01dc'),
        (0x106e01d7, 'cmp', 'dword ptr [eax], 0'),
        (0x106e01da, 'je', '0x106e021a'),
        (0x106e01dc, 'mov', 'ecx, dword ptr [esi + 0x140]'),
        (0x106e01e2, 'imul', 'ecx, ecx, 0x174'),
        (0x106e01e8, 'mov', 'edx, dword ptr [edi + 0x218]'),
        (0x106e01f1, 'cmp', 'dword ptr [eax + 0x168], 0'),
        (0x106e01f8, 'je', '0x106e021a'),
        (0x106e01fa, 'cmp', 'dword ptr [eax + 0x2c], 0'),
        (0x106e01fe, 'jle', '0x106e021a'),
        (0x106e0200, 'cmp', 'dword ptr [ebp + 0x44], 0'),
        (0x106e0204, 'jne', '0x106e021a'),
        (0x106e0206, 'mov', 'dword ptr [ebp + 0x28], 1'),
        (0x106e06f1, 'mov', 'ecx, dword ptr [esi + 0x140]'),
        (0x106e06f7, 'imul', 'ecx, ecx, 0x174'),
        (0x106e06fd, 'mov', 'edx, dword ptr [edi + 0x218]'),
        (0x106e0703, 'lea', 'eax, [ecx + edx + 0xb4]'),
        (0x106e070a, 'mov', 'dword ptr [ebp + 0x18], eax'),
        (0x106e07d9, 'add', 'ecx, 0xb4'),
        (0x106e07df, 'mov', 'dword ptr [ebp + 0x40], ecx'),
        (0x106e07e4, 'push', '1'),
        (0x106e07e6, 'lea', 'ecx, [ebp + 0x40]'),
        (0x106e07e9, 'push', 'ecx'),
        (0x106e07ec, 'mov', 'edx, dword ptr [eax + 0x50]'),
        (0x106e07ef, 'call', 'edx'),
        (0x106b2058, 'mov', 'ecx, dword ptr [ecx + 0x10]'),
        (0x106b205b, 'mov', 'eax, dword ptr [ecx + 0x20]'),
        (0x106b205e, 'mov', 'ecx, dword ptr [ecx + 0x1c]'),
        (0x106b2061, 'imul', 'eax, eax, 0x34'),
        (0x106b2064, 'push', 'eax'),
        (0x106b2065, 'push', 'ecx'),
        (0x106b2066, 'mov', 'eax, dword ptr [ebp + 8]'),
        (0x106b2069, 'push', 'eax'),
        (0x106b206a, 'call', '0x107a62a0'),
        (0x107a62a5, 'mov', 'esi, dword ptr [ebp + 0xc]'),
        (0x107a62a8, 'mov', 'ecx, dword ptr [ebp + 0x10]'),
        (0x107a62ab, 'mov', 'edi, dword ptr [ebp + 8]'),
        (0x107a62fa, 'rep movsd', 'dword ptr es:[edi], dword ptr [esi]'),
        (0x106ec19a, 'cmp', 'dword ptr [esi + 0x2c], ebp'),
        (0x106ec1a3, 'cmp', 'dword ptr [esi + 0x168], ebp'),
        (0x106ec1af, 'cmp', 'dword ptr [esi + 0x20], ebp'),
        (0x106ec213, 'cmp', 'eax, 0x46'),
        (0x106ec216, 'jle', '0x106ec25f'),
        (0x106ec255, 'mov', 'dword ptr [esi + 0x168], 0'),
        (0x106c59da, 'mov', 'ecx, dword ptr [esp + 0x88]'),
        (0x106c59e1, 'mov', 'ebp, dword ptr [ecx]'),
        (0x106c59ed, 'mov', 'eax, dword ptr [ecx + 0xc]'),
    ]:
        ins(*row)
    assert old.wide(0x108e7540) == 'SmoothMesh(O) bUseGPUSkinningStream(O) GPUSkinningStream(O) [%s LOD%d]'
    out['instructionChecks'] = len(checks)
    out['checks'] = checks
    return out


def verify(comparison_engine):
    result = verify_serialization()
    result['consumer'] = verify_consumer(comparison_engine)
    result['scope'] = ('Original stored GPU input records and conditional native stream binding; '
                       'not full native shader, CPU deformation or actor-state parity.')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--comparison-engine', type=Path, required=True,
                        help='explicit pinned supplemental Engine; archive provenance remains unverified')
    parser.add_argument('--check', action='store_true', help='print compact original-input check summary')
    args = parser.parse_args()
    result = verify(args.comparison_engine)
    if args.check:
        print(f"Elbera NPC GPU inputs: {result['instructionChecks']} serializer and "
              f"{result['consumer']['instructionChecks']} consumer anchors; "
              "1,746 original vertex records; conditional GPU stream binding. Full skinning remains unverified.")
    else:
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
