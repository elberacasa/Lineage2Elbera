#!/usr/bin/env python3
"""Elbera Tools: original startup/renderer FPU policy for ordinary pose tween.

Reads pinned Interlude L2.exe, Engine.dll, Core.dll and D3DDrv.dll. Verifies
retained source instructions, imports and finite bit arithmetic without running
native images. The normal masked-exception admission is a documented Win32/CRT
platform contract, not an inferred call to the unreferenced FNINIT routine.
Portable arithmetic tests import without Capstone or private inputs.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

ROOT=Path(__file__).resolve().parents[2]
PLATFORM_CONTRACTS={
 'windowsDefaults':'https://learn.microsoft.com/en-us/windows/win32/debug/floating-point-exceptions',
 'crtDefaults':'https://learn.microsoft.com/en-us/cpp/build/reference/fp-specify-floating-point-behavior#the-default-floating-point-environment',
 'controlMask':'https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/controlfp-s',
 'd3dPreserve':'https://learn.microsoft.com/en-us/windows/win32/dxtecharts/top-issues-for-windows-titles#manipulation-of-the-floating-point-control-word',
}
SHA={
 'L2.exe':'001414e69ed8f53a01fc7c79d3f6c854c86a4581bf9992aaefa3ec78e426544c',
 'Core.dll':'9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf',
 'D3DDrv.dll':'05622ddea5d96aec5618bc1ae064af9d27d83178f78d9631b5448377502e1323',
}

def word(value):
    if type(value) is not int or not 0 <= value <= 0xffff:
        raise ValueError('unsigned 16-bit control word required')
    return value


def abstract_mask(cw):
    """Retained CRT hardware-to-API mapping, exception bits only."""
    cw=word(cw)
    return sum(api for hw,api in [(1,0x10),(2,0x80000),(4,8),(8,4),(16,2),(32,1)] if cw&hw)


def hardware_mask(api):
    if type(api) is not int or not 0 <= api <= 0xffffffff:
        raise ValueError('unsigned 32-bit API flags required')
    return sum(hw for hw,a in [(1,0x10),(2,0x80000),(4,8),(8,4),(16,2),(32,1)] if api&a)


def startup_precision_word(cw):
    """Defined hardware bits affected by new=0x10000/mask=0x30000.

    The real CRT round-trip also reconstructs reserved bits. This projection
    only states the precision-bit update; it does not certify reserved bits.
    """
    return (word(cw)&~0x300)|0x200


def truncate_rounding_word(cw):
    """Source network Tick's temporary integer-conversion rounding update."""
    return word(cw)|0xc00


def verify():
    from supplemental_pe import PEImage
    from check_tutorial_quest_native import Image
    from check_skillanim_native import ENGINE_SHA
    from capstone import Cs,CS_ARCH_X86,CS_MODE_32
    pes={n:PEImage(ROOT/'assets/interlude/system'/n,h) for n,h in SHA.items()}
    cs=Cs(CS_ARCH_X86,CS_MODE_32)
    anchors=[]
    def check(file,va,mnemonic,op):
     i=next(cs.disasm(pes[file].read(va,15),va),None)
     assert i and (i.mnemonic,i.op_str)==(mnemonic,op),(file,hex(va),i.mnemonic,i.op_str)
     anchors.append({'image':file,'va':hex(va),'mnemonic':mnemonic,'operands':op})
    def block(file,start,end):
     raw=pes[file].read(start,end-start)
     return {'image':file,'start':hex(start),'endExclusive':hex(end),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
    def direct_refs(file,target):
     im=pes[file]; calls=[]; words=[]
     for vs,rva,size,raw in im.sections:
      data=im.data[raw:raw+size]
      for i in range(size-4):
       va=im.base+rva+i
       if data[i] in (0xe8,0xe9) and va+5+struct.unpack_from('<i',data,i+1)[0]==target:calls.append(hex(va))
       if data[i:i+4]==struct.pack('<I',target):words.append(hex(va))
     return {'target':hex(target),'relativeCallOrJumpSites':calls,'literalPointerSites':words,
             'limit':'byte-pattern census of file-backed mapped sections, not a whole-program indirect-call proof'}
    for row in [
     ('L2.exe',0x109224da,'call','0x10929346'),
     ('L2.exe',0x109224df,'jmp','0x109222fa'),
     ('L2.exe',0x109223c7,'xor','ebx, ebx'),
     ('L2.exe',0x109223c9,'inc','ebx'),
     ('L2.exe',0x1092243e,'push','ebx'),
     ('L2.exe',0x1092243f,'call','0x10928684'),
     ('L2.exe',0x1092869c,'push','dword ptr [esp + 4]'),
     ('L2.exe',0x109286a0,'call','dword ptr [0x1095fa78]'),
     ('L2.exe',0x10921cf9,'cmp','dword ptr [esp + 4], 0'),
     ('L2.exe',0x10921d03,'je','0x10921d0a'),
     ('L2.exe',0x10921d05,'call','0x1092634a'),
     ('L2.exe',0x1092634b,'push','0x30000'),
     ('L2.exe',0x10926350,'push','0x10000'),
     ('L2.exe',0x10926355,'xor','esi, esi'),
     ('L2.exe',0x10926357,'push','esi'),
     ('L2.exe',0x10926358,'call','0x10933c98'),
     ('L2.exe',0x1094146f,'fnstcw','word ptr [esp + 0x14]'),
     ('L2.exe',0x10941479,'test','bl, 1'),
     ('L2.exe',0x1094147e,'push','0x10'),
     ('L2.exe',0x10941481,'test','bl, 4'),
     ('L2.exe',0x10941486,'or','edx, 8'),
     ('L2.exe',0x10941489,'test','bl, 8'),
     ('L2.exe',0x1094148e,'or','edx, 4'),
     ('L2.exe',0x10941491,'test','bl, 0x10'),
     ('L2.exe',0x10941496,'or','edx, 2'),
     ('L2.exe',0x10941499,'test','bl, 0x20'),
     ('L2.exe',0x1094149e,'or','edx, 1'),
     ('L2.exe',0x109414a1,'test','bl, 2'),
     ('L2.exe',0x109414a6,'or','edx, 0x80000'),
     ('L2.exe',0x10941507,'mov','esi, dword ptr [esp + 0x28]'),
     ('L2.exe',0x1094150b,'mov','ecx, dword ptr [esp + 0x24]'),
     ('L2.exe',0x1094150f,'mov','eax, esi'),
     ('L2.exe',0x10941511,'not','eax'),
     ('L2.exe',0x10941513,'and','eax, edx'),
     ('L2.exe',0x10941515,'and','ecx, esi'),
     ('L2.exe',0x10941517,'or','eax, ecx'),
     ('L2.exe',0x10941527,'call','0x10940b1b'),
     ('L2.exe',0x10941533,'fldcw','word ptr [esp + 0x10]'),
     ('L2.exe',0x10940b23,'test','bl, 8'),
     ('L2.exe',0x10940b28,'or','eax, 4'),
     ('L2.exe',0x10940b84,'and','ecx, 0x30000'),
     ('L2.exe',0x10940b8c,'cmp','ecx, 0x10000'),
     ('L2.exe',0x10940b94,'or','eax, esi'),
     ('L2.exe',0x1092246c,'call','0x109014a6'),
     ('L2.exe',0x109014a6,'jmp','0x10915ef0'),
     ('L2.exe',0x1091605c,'call','dword ptr [0x109a3d7c]'),
     ('L2.exe',0x10916861,'call','0x10911450'),
     ('L2.exe',0x1091149c,'call','0x10901424'),
     ('L2.exe',0x10901424,'jmp','0x10910a90'),
     ('L2.exe',0x10910b3f,'call','dword ptr [0x109a434c]'),
     ('L2.exe',0x10910b48,'call','dword ptr [0x109a42ec]'),
     ('L2.exe',0x109114b4,'call','0x10901735'),
     ('L2.exe',0x10901735,'jmp','0x10910d00'),
     ('L2.exe',0x10910dbf,'mov','ecx, dword ptr [esi]'),
     ('L2.exe',0x10910dc5,'mov','eax, dword ptr [ecx]'),
     ('L2.exe',0x10910dca,'mov','edx, dword ptr [eax + 0x68]'),
     ('L2.exe',0x10910dcd,'call','edx'),
     ('Core.dll',0x101a4a4e,'fninit',''),
     ('Core.dll',0x101a4a50,'call','0x10182eb5'),
     ('L2.exe',0x10940e06,'fninit',''),
     ('L2.exe',0x10940e08,'call','0x1092634a'),
     ('D3DDrv.dll',0x1001bf78,'push','0x20'),
     ('D3DDrv.dll',0x1001bf7a,'call','0x1003bd62'),
     ('D3DDrv.dll',0x1003bd62,'jmp','dword ptr [0x100dd69c]'),
     ('D3DDrv.dll',0x1001bf7f,'mov','dword ptr [ebx + 0x4790], eax'),
     ('D3DDrv.dll',0x1001dc26,'or','eax, 2'),
     ('D3DDrv.dll',0x1001dc29,'mov','dword ptr [ebp + 0x2c], eax'),
     ('D3DDrv.dll',0x1001dc40,'mov','eax, dword ptr [0x100dd270]'),
     ('D3DDrv.dll',0x1001dc46,'cmp','dword ptr [eax], ebx'),
     ('D3DDrv.dll',0x1001dc4f,'je','0x1001dc8a'),
     ('D3DDrv.dll',0x1001dc64,'push','0x40'),
     ('D3DDrv.dll',0x1001dc98,'mov','ecx, dword ptr [ebp + 0x2c]'),
     ('D3DDrv.dll',0x1001dc9b,'push','ecx'),
     ('D3DDrv.dll',0x1001dcb7,'mov','eax, dword ptr [esi + 0x4790]'),
     ('D3DDrv.dll',0x1001dcbd,'push','eax'),
     ('D3DDrv.dll',0x1001dcc0,'call','edx'),
     ('D3DDrv.dll',0x1001ed36,'or','eax, 2'),
     ('D3DDrv.dll',0x1001ed39,'mov','dword ptr [ebp + 0x50], eax'),
     ('D3DDrv.dll',0x1001ed50,'mov','ecx, dword ptr [0x100dd270]'),
     ('D3DDrv.dll',0x1001ed60,'je','0x1001ed9b'),
     ('D3DDrv.dll',0x1001ed75,'push','0x40'),
     ('D3DDrv.dll',0x1001eda9,'push','eax'),
     ('D3DDrv.dll',0x1001edce,'call','edx'),
    ]:check(*row)
    assert pes['L2.exe'].u32(0x1095fa78)==0x10921cef
    assert pes['L2.exe'].imports[0x109a3d7c][1].startswith('?appInit@@')
    assert pes['L2.exe'].imports[0x109a434c]==('KERNEL32.dll','GetCurrentThreadId')
    assert pes['L2.exe'].imports[0x109a42ec]==('KERNEL32.dll','GetCurrentThread')
    assert pes['D3DDrv.dll'].imports[0x100dd69c]==('d3d9.dll','Direct3DCreate9')
    assert pes['D3DDrv.dll'].imports[0x100dd270]==('Core.dll','?GL2NVPerfHUD@@3HA')
    assert pes['D3DDrv.dll'].body('?Init@UD3DRenderDevice@@UAEHXZ')==0x1001bee0
    assert pes['D3DDrv.dll'].body('?SetRes@UD3DRenderDevice@@UAEHPAVUViewport@@HHHHH@Z')==0x1001d480
    assert pes['D3DDrv.dll'].body('?SetRes@UD3DRenderDevice@@UAEHPAVUViewport@@HHHHHH@Z')==0x1001e540
    engine=Image(ROOT/'assets/interlude/system/engine.dll',ENGINE_SHA,True)
    table=0x10300000+engine.exports['??_7UGameEngine@@6BUObject@@@']
    tick=0x10300000+engine.exports['?Tick@UGameEngine@@UAEXM@Z']
    assert struct.unpack('<I',engine.data[engine.offset(table+0x68):engine.offset(table+0x68)+4])[0]==tick
    assert tick==0x10313d8b
    assert next(engine.dis.disasm(engine.data[engine.offset(tick):engine.offset(tick)+5],tick)).op_str=='0x105972d0'
    for symbol, body in [
        ('?UpdateAnimation@USkeletalMeshInstance@@UAEHM@Z',0x106ba8d0),
        ('?GetFrame@USkeletalMeshInstance@@UAEXPAVAActor@@PAVFLevelSceneNode@@PAVFVector@@HAAHK@Z',0x106d9a70),
        ('?Render@USkeletalMeshInstance@@UAEXPAVFDynamicActor@@PAVFLevelSceneNode@@PAV?$TList@PAVFDynamicLight@@@@PAV?$TList@PAUFProjectorRenderInfo@@@@PAVFRenderInterface@@@Z',0x106dd010),
        ('?Tick@UNetworkHandler@@UAEXM@Z',0x104218b0),
    ]:
        assert engine.exported(symbol,True)==body
    for cw in range(64):
     old=abstract_mask(cw)
     updated=(old&~0x30000)|(0x10000&0x30000)
     assert hardware_mask(updated)==cw
    ranges=[block(*r) for r in [
     ('L2.exe',0x10921cef,0x10921d0d),('L2.exe',0x1092634a,0x10926372),
     ('L2.exe',0x10941467,0x10941538),('L2.exe',0x10940b1b,0x10940ba9),
     ('L2.exe',0x10911450,0x109114df),('L2.exe',0x10910dbf,0x10910dcf),
     ('Core.dll',0x101a4a46,0x101a4a7c),
     ('D3DDrv.dll',0x1001dbb7,0x1001dcc2),('D3DDrv.dll',0x1001ecc7,0x1001edd0),
    ]]
    # These bounded disassemblies include the complete named entry to the next
    # named entry (and may include cleanup/unnamed helpers). No transitive call
    # graph or proof about arbitrary external callbacks is inferred.
    for a, mn, op in [
     (0x10421990,'fnstcw','word ptr [ebp - 0x12]'),
     (0x10421993,'movzx','eax, word ptr [ebp - 0x12]'),
     (0x10421997,'or','eax, 0xc00'),
     (0x1042199c,'mov','dword ptr [ebp - 0x18], eax'),
     (0x1042199f,'fldcw','word ptr [ebp - 0x18]'),
     (0x104219a2,'fistp','qword ptr [ebp - 0x1c]'),
     (0x104219a5,'fldcw','word ptr [ebp - 0x12]'),
    ]:
     engine.instruction(a,mn,op)
     anchors.append({'image':'engine.dll','va':hex(a),'mnemonic':mn,'operands':op})
    assert pes['Core.dll'].body('?appEnableFastMath@@YAXH@Z') == 0x10177f50
    spans=[
     ('engine.dll',0x105972d0,0x10598a50,'UGameEngine.Tick and trailing cleanup'),
     ('engine.dll',0x106ba8d0,0x106bb0e0,'USkeletalMeshInstance.UpdateAnimation'),
     ('engine.dll',0x106d9a70,0x106dd010,'USkeletalMeshInstance.GetFrame and trailing cleanup'),
     ('engine.dll',0x106dd010,0x106e00b0,'USkeletalMeshInstance.Render and trailing cleanup'),
     ('L2.exe',0x10910d00,0x10911158,'main-loop step normal body'),
     ('Core.dll',0x10177f50,0x10177f90,'appEnableFastMath normal body'),
    ]
    control_ops={'fldcw','fninit','finit','fldenv','frstor','fxrstor','xrstor','ldmxcsr'}
    scans=[]
    for file,a,b,label in spans:
     raw=bytes(engine.data[engine.offset(a):engine.offset(b)]) if file=='engine.dll' else pes[file].read(a,b-a)
     instructions=list(cs.disasm(raw,a))
     assert instructions and instructions[-1].address+instructions[-1].size==b,(label,'incomplete disassembly')
     writes=[hex(i.address) for i in instructions if i.mnemonic in control_ops]
     assert not writes,(label,writes)
     if label=='appEnableFastMath normal body':
      assert not [i for i in instructions if i.mnemonic in ('call','jmp')]
     scans.append({'image':file,'start':hex(a),'endExclusive':hex(b),'label':label,
                   'sha256':hashlib.sha256(raw).hexdigest(),'instructions':len(instructions),'directControlWrites':writes})
    for cw in range(0x10000):
     assert startup_precision_word(cw)&0x3f==cw&0x3f
     assert truncate_rounding_word(cw)&0x3f==cw&0x3f
    result={'format':'elbera-animation-fpu-native-v1','sources':{**SHA,'engine.dll':ENGINE_SHA},
     'anchors':anchors,'ranges':ranges,'instructionChecks':len(anchors),'maskCases':64,
     'wordCases':65536,'laterPathScans':scans,
     'startupPolicy':'precision-only mask 0x30000/new 0x10000 preserves all six incoming exception-mask bits',
     'rendererPolicy':'normal GL2NVPerfHUD==0 paths OR CreateDevice behavior flags with 2 (FPU_PRESERVE); debug branch pushes 0x40',
     'threadEdge':'L2 WinMain -> same-thread loop -> UGameEngine.Tick; transitive Tick/render/GetFrame edge is outside this checker',
     'fninitReferences':[direct_refs('Core.dll',0x101a4a46),direct_refs('L2.exe',0x10940dfe)],
     'admission':{'environment':'win32-default','zeroPreviousFrame':'masked infinity then native fraction-range reset',
      'basis':'documented Windows/CRT default plus owned mask-preserving startup and normal D3D creation',
      'notClaimed':'arbitrary modified control words, injected libraries, debugger exception overrides, or all external callback paths'},
     'platformContracts':PLATFORM_CONTRACTS,
     'limits':['instruction-backed bit arithmetic; no native image execution or complete CRT emulation',
               'selected full linear source spans checked, not a whole-program FPU-state proof',
               'Core/L2 FNINIT routines have no literal/direct references found; not asserted to run',
               'does not establish exact x87 extended-intermediate or transcendental parity']}
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true',help='verify pinned private original files; no native code executes')
    args=parser.parse_args()
    if not args.check: parser.error('--check is required')
    print(json.dumps(verify(),indent=2))
