#!/usr/bin/env python3
"""Elbera Tools: original fresh ordinary mesh-instance cache initialization.

Requires owned Engine.dll/Core.dll/Engine.u and explicitly supplied, pinned
supplemental Engine/Core. Capstone is required. This checks retained bytes and
metadata; it never executes a client, downloads files, or writes binary payloads.
Fresh ordinary CDO-template allocation only; copies/reuse/custom templates and
external CDO mutations are outside the claim. No proprietary fixture included.
"""
import argparse
from pathlib import Path
import hashlib
import json
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]


def verify(comparison_engine, comparison_core):
    from check_tutorial_quest_native import Image, ENGINE_SHA
    from check_skillanim_native import CORE_SHA
    from supplemental_pe import PEImage
    from check_supplemental_engine import compare_method, CANDIDATE_ENGINE_SHA, CANDIDATE_CORE_SHA
    E=Image(ROOT/'assets/interlude/system/engine.dll',ENGINE_SHA,True)
    C=Image(ROOT/'assets/interlude/system/Core.dll',CORE_SHA)
    P=PEImage(comparison_engine,CANDIDATE_ENGINE_SHA)
    PC=PEImage(comparison_core,CANDIDATE_CORE_SHA)
    read=lambda va,n:bytes(E.data[E.offset(va):E.offset(va)+n])
    wide=lambda image,va: image.wide(va) if isinstance(image,Image) else read_wide(image,va)
    def read_wide(image,va):
     data=bytearray()
     for i in range(128):
      part=image.read(va+i*2,2)
      if part==b'\0\0':return data.decode('utf-16le')
      data.extend(part)
     raise ValueError('unterminated bounded string')
    comparisons=[]
    def block(lo,hi,newlo,changes=(),handler=False):
     a=bytearray(read(lo,hi-lo));b=P.read(newlo,hi-lo);bindings=[]
     for operand,old,new,kind,identity in changes:
      offset=operand-lo
      assert struct.unpack_from('<I',a,offset)[0]==old
      assert struct.unpack_from('<I',b,offset)[0]==new
      if kind=='import':assert P.imports[new]==('core.dll',identity)
      elif kind=='export':assert E.exported(identity)==old and P.exports[identity]==new
      elif kind=='string':assert wide(E,old)==wide(P,new)==identity
      else:raise AssertionError(kind)
      a[offset:offset+4]=struct.pack('<I',new)
      bindings.append(dict(ownedOperandVA=hex(operand),kind=kind,identity=identity,owned=hex(old),candidate=hex(new)))
     pair=(struct.unpack_from('<I',a,3)[0],struct.unpack_from('<I',b,3)[0]) if handler else None
     result=compare_method(bytes(a),b,lo,newlo,P.imported_call,read,P.read,pair)
     result.update(ownedStart=hex(lo),candidateStart=hex(newlo),originalOwnedSHA256=hashlib.sha256(read(lo,hi-lo)).hexdigest(),explicitOperandBindings=bindings)
     comparisons.append(result)
     return result
    # Normal constructor bodies, including exact bounded EH-entry correspondence.
    for symbol,size in [
     ('??0USkeletalMeshInstance@@QAE@XZ',396),('??0USubSkeletalMeshInstance@@QAE@XZ',232),
     ('??0ULodMeshInstance@@QAE@XZ',88),('??0UMeshInstance@@QAE@XZ',74),('??0UPrimitive@@QAE@XZ',97)]:
     lo=E.exported(symbol,True);assert P.body(symbol)==lo
     block(lo,lo+size,lo,handler=True)
    # Native class registration through the named Core UClass constructor only.
    block(0x10848750,0x108487c4,0x10848710,[
     (0x10848769,0x11d8d790,0x11d8d78c,'import','?StaticConstructor@UObject@@QAEXXZ'),
     (0x10848785,0x10a72eac,0x10a72e98,'string','Engine'),
     (0x108487ac,0x10dd8ff0,0x10dd9000,'export','?PrivateStaticClass@USubSkeletalMeshInstance@@0VUClass@@A'),
     (0x108487ba,0x10dd3290,0x10dd32a0,'export','?PrivateStaticClass@USkeletalMeshInstance@@0VUClass@@A'),
    ])
    # Actual fresh ordinary instance call: class default passed as the template.
    block(0x105e4979,0x105e49ac,0x105e4939,[
     (0x105e497a,0x11d8d7a0,0x11d8d79c,'import','?GError@@3PAVFOutputDeviceError@@A'),
    ])
    anchors=[
     (0x103638a0,'mov','eax, 0x10dd3290'),(0x103015fa,'jmp','0x103638a0'),
     (0x105e4964,'mov','edx, dword ptr [eax + 0x8c]'),(0x105e496c,'call','edx'),
     (0x1084876e,'push','0x1030c48c'),(0x108487ab,'push','0x10dd8ff0'),
     (0x108487b2,'push','0x348'),(0x108487b9,'mov','ecx, 0x10dd3290'),
     (0x10849412,'push','0x144'),(0x10849419,'mov','ecx, 0x10dd8ff0'),
     (0x1030c48c,'jmp','0x103f8ba0'),(0x103f8ba8,'jmp','0x1031253f'),
     (0x1031253f,'jmp','0x103f4460'),(0x10314475,'jmp','0x103ac360'),
     (0x103019ba,'jmp','0x10360c50'),(0x1030b4c4,'jmp','0x10331310'),
    ]
    for row in anchors:E.instruction(*row)
    assert E.u32(E.exported('??_7USkeletalMesh@@6B@')+0x8c)==0x103015fa
    # All Core method bytes used in the chain are independently identical in the
    # supplemental companion; import names therefore refer to the owned bodies.
    methods=[
     ('??0UClass@@QAE@W4ENativeConstructor@@KKPAV0@1VFGuid@@PBG33KP6AXPAX@ZP8UObject@@AEXXZ@Z',0x10135860,0x101359ed),
     ('??0UState@@QAE@W4ENativeConstructor@@HPBG1KPAV0@@Z',0x10135060,0x101350ed),
     ('??0UStruct@@QAE@W4ENativeConstructor@@HPBG1KPAV0@@Z',0x101333b0,0x1013344b),
     ('?GetPropertiesSize@UStruct@@UAEHXZ',0x1010b310,0x1010b314),
     ('?Register@UClass@@UAEXXZ',0x101339d0,0x10133af6),
     ('?GetDefaultObject@UClass@@QAEPAVUObject@@XZ',0x10115bb0,0x10115be5),
     ('?InitClassDefaultObject@UObject@@QAEXPAVUClass@@H@Z',0x1015fe10,0x1015fe9f),
     ('?InitProperties@UObject@@SAXPAEHPAVUClass@@0HPAV1@2@Z',0x1015fb00,0x1015fc0b),
     ('?StaticConstructor@UObject@@QAEXXZ',0x1015a1e0,0x1015a220),
     ('?StaticConstructObject@UObject@@SAPAV1@PAVUClass@@PAV1@VFName@@K1PAVFOutputDevice@@1@Z',0x10167eb0,0x10167f3e),
     ('?StaticAllocateObject@UObject@@SAPAV1@PAVUClass@@PAV1@VFName@@K1PAVFOutputDevice@@11@Z',0x101677c0,0x10167e10),
     ('??0UObject@@QAE@XZ',0x1015c420,0x1015c44d),
     ('??0FName@@QAE@XZ',0x10109d90,0x10109d93),
     ('??0FCoords@@QAE@XZ',0x1010dd80,0x1010dd83),
     ('??0FRotator@@QAE@XZ',0x1010ded0,0x1010ded3),
     ('??0FArray@@QAE@XZ',0x101091f0,0x101091fd),
    ]
    core=[]
    for symbol,lo,hi in methods:
     assert C.exported(symbol,True)==PC.body(symbol)==lo
     raw=bytes(C.data[C.offset(lo):C.offset(hi)])
     assert raw==PC.read(lo,hi-lo)
     core.append(dict(symbol=symbol,VA=hex(lo),bytes=len(raw),SHA256=hashlib.sha256(raw).hexdigest()))
    coreanchors=[
     (0x101359a3,'mov','dword ptr [esi + 0x518], eax'),
     (0x101359af,'mov','dword ptr [esi + 0x51c], ecx'),
     (0x10133408,'mov','dword ptr [esi + 0x4c], ecx'),
     (0x10133a1c,'lea','edi, [esi + 0x4f4]'),
     (0x10133a49,'call','0x1010421e'),(0x10133a50,'call','0x101031e3'),
     (0x10133a62,'cmp','ecx, dword ptr [esi + 0x51c]'),
     (0x10133a73,'mov','edx, dword ptr [esi + 0x51c]'),
     (0x1015fe67,'mov','edx, dword ptr [ecx + 0x34]'),
     (0x1015fe81,'call','0x1010119f'),(0x1015fb6d,'mov','ebx, dword ptr [esi + 0x4f8]'),
     (0x1015fbff,'call','0x1017ac60'),(0x1015fc07,'mov','ecx, ebx'),
     (0x1015fb84,'sub','eax, ecx'),(0x1015fb87,'add','ecx, edi'),
     (0x1015fb8a,'call','0x101022e3'),(0x101022e3,'jmp','0x10108420'),
     (0x1010842a,'xor','eax, eax'),(0x10108434,'rep stosd','dword ptr es:[edi], eax'),
     (0x10108438,'rep stosb','byte ptr es:[edi], al'),
     (0x10167f11,'call','0x10103e7c'),(0x10167c56,'call','0x1010119f'),
     (0x10167f20,'mov','edx, dword ptr [edi + 0x518]'),(0x10167f26,'call','edx'),
    ]
    for row in coreanchors:C.instruction(*row)
    # These native classes have no serialized Engine.u class-default override.
    # Their inherited UObject static constructor is the retained no-op above.
    sys.path.insert(0,str(ROOT/'tools/dat'))
    from export_npc_visuals import OriginalClasses
    classes=OriginalClasses()
    for name in ('Engine.SkeletalMeshInstance','Engine.SubSkeletalMeshInstance',
                 'Engine.LodMeshInstance','Engine.MeshInstance'):
     assert classes.get(name) is None
    package_sha=classes.sources['Engine.u']
    assert package_sha=='9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761'
    package=classes.packages['Engine']
    native_names={'skeletalmeshinstance','subskeletalmeshinstance','lodmeshinstance','meshinstance'}
    assert not [e for e in package.exports if package.class_name_of(e)=='Class'
                and package.export_name(e).casefold() in native_names]
    result=dict(status='bounded-source-chain-checked',ownedEngine=E.sha,ownedCore=C.sha,
     supplementalEngine=P.sha,supplementalCore=PC.sha,engineAnchors=len(anchors),coreAnchors=len(coreanchors),
     comparisons=comparisons,exactCoreBodies=core,enginePackageSHA256=package_sha,
     conclusion='Fresh native registered USkeletalMeshInstance CDO tail includes +1fc and is zero-filled. Ordinary MeshGetInstance explicitly templates from CDO; normal constructor chain preserves +1fc.',
     limits=['Archive unauthenticated; each import/operand accepted only inside exact compared normal body.',
     'Complete EH/unwind graph not claimed; only ten matching entry bytes for relocated handlers.',
     'Fresh native registration and ordinary default-template allocation only; external CDO mutation, custom templates, reused/copied objects and arbitrary plugin hooks excluded.',
     'Core registration later LoadConfig/LoadLocalized operate on reflected properties; this class has no original Engine.u class export, native static constructor is inherited no-op. Whole external mutation lifecycle not executed.',
     'No native code executed and no binary payload written. Runtime not modified.'])
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--comparison-engine', type=Path, required=True,
                        help='explicit pinned supplemental Engine.dll')
    parser.add_argument('--comparison-core', type=Path, required=True,
                        help='explicit pinned supplemental Core.dll; never inferred from a sibling path')
    parser.add_argument('--check', action='store_true', help='compact result instead of metadata JSON')
    args = parser.parse_args()
    result = verify(args.comparison_engine, args.comparison_core)
    if args.check:
        print(f"Elbera fresh pose allocation: {result['engineAnchors']} Engine / "
              f"{result['coreAnchors']} Core anchors; {len(result['comparisons'])} exact supplemental "
              f"blocks, {len(result['exactCoreBodies'])} identical Core bodies; "
              "fresh ordinary CDO-template +0x1fc = 0 verified; reuse/custom templates excluded.")
    else:
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
