#!/usr/bin/env python3
"""Elbera Tools: original GetFrame local reference fallback and root inputs.

Checks pinned owned Engine/Core. Optional separately supplied comparison Engine
binds two six-NOP sites only through exact surrounding-byte correspondence.
Actual retained instructions are interpreted on synthetic memory; no binary is
executed, dumped, or bundled. --audit-assets additionally reads one original
face/animation pair and reports only identity, indices and provenance.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/p) for p in ('tools/ui','tools/dat','tools/anim','tools/src/char_pipeline','tools')]
from check_tutorial_quest_native import Image, ENGINE_SHA
from check_skillanim_native import CORE_SHA
from check_hair_attachment_native import compare_call_block, COMPARISON_SHA
from supplemental_pe import PEImage
from check_track_native import machine


def verify(*, comparison_engine=None, audit_assets=False):
    E=Image(ROOT/'assets/interlude/system/engine.dll',ENGINE_SHA,True)
    C=Image(ROOT/'assets/interlude/system/Core.dll',CORE_SHA)
    P=PEImage(comparison_engine, COMPARISON_SHA) if comparison_engine else None
    SYM='?GetFrame@USkeletalMeshInstance@@UAEXPAVAActor@@PAVFLevelSceneNode@@PAVFVector@@HAAHK@Z'
    assert E.exported(SYM,True)==0x106d9a70
    if P: assert P.body(SYM)==0x106d9a30
    anchors=[
     (0x106da312,'mov','eax, dword ptr [ebx + 0x20c]'),
     (0x106da318,'push','eax'),(0x106da319,'push','1'),
     (0x106da3d9,'jne','0x106da3df'),(0x106da3db,'fld1',''),
     (0x106da532,'cmp','dword ptr [edi + 0x2c], 0'),
     (0x106da560,'cmp','dword ptr [esi + 0x64], ebx'),
     (0x106da569,'mov','dword ptr [ecx + ebx*4], 1'),
     (0x106da584,'mov','edx, dword ptr [eax + ecx + 0x34]'),
     (0x106da5b0,'mov','eax, dword ptr [edi + 0xc]'),
     (0x106da5b3,'cmp','dword ptr [eax + ebx*4], 0'),
     (0x106da5b7,'jl','0x106da774'),
     (0x106da5bd,'cmp','dword ptr [esi + 0x48], 0'),
     (0x106da5c1,'jne','0x106da62e'),
     (0x106da5f2,'push','0'),(0x106da60d,'call','0x1030777f'),
     (0x1030777f,'jmp','0x106bb6a0'),
     (0x106dabfc,'mov','eax, dword ptr [esi + 0x20]'),
     (0x106dabff,'test','eax, eax'),
     (0x106dac4a,'mov','byte ptr [edx + edi], 1'),
     (0x106dafa1,'je','0x106db127'),
     (0x106db147,'cmp','byte ptr [esi + edx], 0'),
     (0x106db14b,'je','0x106db156'),
     (0x106db14d,'cmp','dword ptr [ebp + 0x20c], 0'),
     (0x106db154,'je','0x106db1ae'),
     (0x106db161,'mov','edi, dword ptr [ecx + eax + 8]'),
     (0x106db18e,'lea','ecx, [ecx + eax + 0x18]'),
     (0x106db1d4,'call','0x10311252'),(0x10311252,'jmp','0x106ae320'),
     (0x106db1dc,'test','esi, esi'),(0x106db1de,'jne','0x106db208'),
     (0x106db1e0,'cmp','dword ptr [ebp + 0x218], esi'),
     (0x106db1e8,'mov','ecx, dword ptr [ebp + 0x284]'),
     (0x106db1ff,'mov','ecx, dword ptr [ebp + 0x28c]'),
     (0x106db205,'mov','dword ptr [eax + 8], ecx'),
     (0x106db217,'cmp','dword ptr [ebp + 0x194], 0'),
     (0x106db21e,'mov','dword ptr [ebp + 0x1fc], 1'),
     (0x106db9fe,'mov','eax, dword ptr [eax + edx + 0x34]'),
     (0x106dba14,'push','eax'),(0x106dba1f,'push','eax'),
     (0x106dba20,'mov','ecx, edi'),
     (0x106dba2a,'mov','ecx, 0xc'),
     (0x106dba31,'rep movsd','dword ptr es:[edi], dword ptr [esi]'),
     (0x106aec6d,'mov','eax, dword ptr [ebp + 0x50]'),
     (0x106aec70,'mov','dword ptr [ebx + 0x218], eax'),
    ]
    for a in anchors:E.instruction(*a)
    assert E.exported('?LockRootMotion@USkeletalMeshInstance@@QAEHH@Z',True)==0x106aec30
    assert C.exported('?AddZeroed@FArray@@QAEHHH@Z',True)==0x10109110
    coreanchors=[(0x10109163,'xor','eax, eax'),
     (0x1010916d,'rep stosd','dword ptr es:[edi], eax'),
     (0x10109171,'rep stosb','byte ptr es:[edi], al'),(0x10109179,'ret','8')]
    for a in coreanchors:C.instruction(*a)
    blocks=[]
    if P:
     for start,end,site,symbol in [
      (0x106da30a,0x106da328,0x106da322,'?AddZeroed@FArray@@QAEHHH@Z'),
      (0x106db9f0,0x106dba33,0x106dba22,'?ApplyPivotWithoutScale@FCoords@@QBE?AV1@ABV1@@Z'),
     ]:
      a=E.data[E.offset(start):E.offset(end)];b=P.read(start-0x40,end-start)
      blocks.append(dict(startVA=hex(start),endVAExclusive=hex(end),ownedSHA256=hashlib.sha256(a).hexdigest(),
       candidateSHA256=hashlib.sha256(b).hexdigest(),**compare_call_block(a,b,owned_va=start,candidate_va=start-0x40,
       sites=[(site-start,('core.dll',symbol))],direct_calls=[],imports=P.imports)))

    counts={}
    def add(label,count):
     row=counts.setdefault(label,{'cases':0,'instructions':0});row['cases']+=1;row['instructions']+=count

    # Integer raw-copy cases include NaN and negative-zero bit patterns deliberately:
    # the native copy is not floating arithmetic and must preserve every bit.
    words=[0x80000000,0x3f000001,0xff800000,0x7fc01234,0xc1234567,0x42010203,0]
    sp,inst,mesh,refs,quats,positions,coords,mask=0x90000,0x10000,0x20000,0x30000,0x40000,0x50000,0x60000,0x80000
    for mapped in (-0x80000000,-1,0,1,70,0x7fffffff):
        linkobj,linkdata,bone=0xb0000,0xc0000,27
        mem={linkobj+0xc:linkdata,linkdata+4*bone:mapped&0xffffffff}
        m=machine(E,0x106da5b0,0x106da5bd,mem,{'esp':sp,'edi':linkobj,'ebx':bone})
        m.zero=m.less=m.carry=m.sign=m.parity=False;pc=0x106da5b0;n=0
        while pc not in (0x106da5bd,0x106da774):
            pc=m.step(m.program[pc]);n+=1
        assert pc==(0x106da774 if mapped<0 else 0x106da5bd)
        add('signedMissingLinkupBranch',n)

    for bone in (0,1,27,69):
     for setmask in (0,1,2):
      for force in (0,1):
       mem={sp+0xd4:mask,mask+bone:setmask,inst+0x20c:force,mesh+0x208:refs,
            inst+0x1c8:quats,inst+0x1d4:positions,inst+0xc4:coords}
       expected=words if setmask==0 or force else list(reversed(words))
       for k,v in enumerate(words[:4]):mem[refs+64*bone+8+4*k]=v;mem[quats+16*bone+4*k]=list(reversed(words))[k]
       for k,v in enumerate(words[4:]):mem[refs+64*bone+24+4*k]=v;mem[positions+12*bone+4*k]=list(reversed(words))[4+k]
       m=machine(E,0x106db140,0x106db1d4,mem,{'esp':sp,'ebp':inst,'ebx':mesh,'esi':bone})
       n=m.execute(0x106db140,0x106db1d4)
       actual=[m.memory[quats+16*bone+4*k] for k in range(4)]+[m.memory[positions+12*bone+4*k] for k in range(3)]
       assert actual==expected
       # At the retained conversion call, arg order is q*, p*, outputCoords*.
       assert [m.memory[m.registers['esp']+4*k] for k in range(3)]==[quats+16*bone,positions+12*bone,coords+48*bone]
       add('referenceOrCachedLocalAndCallOperands',n)

    for bone in (0,1,27,69):
     record=0xa0000
     mem={sp+0x18:record,record+0x1c:bone,record+0x20:0,inst+0x1c8:quats,
          inst+0x1d4:positions,sp+0xd4:mask,mask+bone:0}
     for i,v in enumerate(words):mem[record+i*4]=v
     m=machine(E,0x106dabec,0x106dac4e,mem,{'esp':sp,'ebp':inst})
     n=m.execute(0x106dabec,0x106dac4e)
     assert [m.memory[quats+16*bone+i*4] for i in range(4)]+[m.memory[positions+12*bone+i*4] for i in range(3)]==words
     assert m.memory[mask+bone]==1
     add('channelZeroRawCopiesIncludingRoot',n)

    for bone in (0,1,27):
     for lock in (0,1,-1):
      mem={inst+0x218:lock,inst+0xc4:coords}
      original=list(range(12));replacement=[0xc2345678,0x80000000,0x3f123456]
      mem.update({coords+4*i:v for i,v in enumerate(original)})
      mem.update({inst+0x284+4*i:v for i,v in enumerate(replacement)})
      m=machine(E,0x106db1dc,0x106db208,mem,{'esp':sp,'ebp':inst,'esi':bone})
      n=m.execute(0x106db1dc,0x106db208)
      expected=(replacement+original[3:]) if bone==0 and lock else original
      assert [m.memory[coords+4*i] for i in range(12)]==expected
      add('namedLockRootMotionOriginOnly',n)

    for bone,parent in ((1,0),(27,26),(28,27),(69,0)):
     mem={sp+0x58:mesh,mesh+0x208:refs,refs+bone*64+0x34:parent,inst+0xc4:coords,
          sp+0x1c:bone*48,sp+0x5c:bone*64}
     m=machine(E,0x106db9f0,0x106dba22,mem,{'esp':sp,'ebp':inst,'eax':bone*64})
     # native reads saved current RefBone byte offset from esp+5c (see instruction).
     n=m.execute(0x106db9f0,0x106dba22)
     assert m.registers['ecx']==coords+48*bone
     assert m.memory[m.registers['esp']+4]==coords+48*parent
     assert m.memory[m.registers['esp']]==sp+0x1c0
     add('currentHierarchyLocalThisParentArgument',n)


    source_example=None
    if audit_assets:
     from build_hair import Sources, source_lod0, unique
     from build_pawnanim import original_animation
     sources=Sources();pkg=sources.get('animations','Fighter')
     face=unique([e for e in pkg.exports_by_class('SkeletalMesh') if pkg.export_name(e)=='MFighter_m000_f'],'MFighter face')
     anim=unique([e for e in pkg.exports_by_class('MeshAnimation') if pkg.export_name(e)=='MFighter_anim'],'MFighter animation')
     source=source_lod0(pkg,face);animation=original_animation(pkg,anim,include_tracks=False)
     names=[b['name'] for b in animation['bones']]
     link=[next((i for i,n in enumerate(names) if n.casefold()==b['name'].casefold()),-1) for b in source['bones']]
     assert link[27]==-1 and link[28]==28 and len(source['bones'])==70
     # Ancestor eligibility mask is independent of the animation-linkup success.
     channel,elig,linkobj,linkdata=0xb0000,0xc0000,0xd0000,0xe0000
     mem={sp+0x34:elig,sp+0x58:mesh,mesh+0x208:refs,channel+0x64:0,linkobj+0xc:linkdata}
     for bone,b in enumerate(source['bones']):mem[refs+64*bone+0x34]=b['parent'];mem[linkdata+4*bone]=link[bone]&0xffffffff
     admitted=[]
     for bone in range(len(source['bones'])):
      mem[sp+0x10]=bone*64
      m=machine(E,0x106da560,0x106da5bd,mem,{'esp':sp,'ebx':bone,'esi':channel,'edi':linkobj})
      m.zero=m.less=m.carry=m.sign=m.parity=False;pc=0x106da560;n=0
      while pc not in (0x106da5bd,0x106da774):pc=m.step(m.program[pc]);n+=1
      mem=m.memory
      if pc==0x106da5bd:admitted.append(bone)
      add('sourceFaceBaseBoneEligibilityAndLinkup',n)
     assert 27 not in admitted and 28 in admitted and mem[elig+27*4]==mem[elig+28*4]==1
     source_example={'mesh':'Fighter.MFighter_m000_f','sourceExportSHA256':source['sourceExportSHA256'],
      'animation':'Fighter.MFighter_anim','animationSourceExportSHA256':hashlib.sha256(pkg.data[anim.serial_offset:anim.serial_offset+anim.serial_size]).hexdigest(),
      'meshBoneCount':len(source['bones']),'matchedCount':len(admitted),'missingBoneIndex':27,
      'missingBoneName':source['bones'][27]['name'],'missingParent':source['bones'][27]['parent'],
      'childBoneIndex':28,'childName':source['bones'][28]['name'],'childParent':source['bones'][28]['parent'],
      'childMapsTo':link[28],'unusedAnimationIndex':27,'duplicateAnimationName':names[27],
      'firstDuplicateIndex':names.index(names[27])}

    ranges=[]
    for name,start,end in [('eligibilityAndNegativeLinkup',0x106da560,0x106da5c7),('channel0copy',0x106dabec,0x106dac4e),
     ('referenceFallbackAndCoordsCall',0x106db140,0x106db1d9),('rootOriginOverride',0x106db1dc,0x106db208),
     ('hierarchyCallOperands',0x106db9f0,0x106dba33),('lockRootMotionArgument',0x106aec63,0x106aec76)]:
     ranges.append({'name':name,'startVA':hex(start),'endVAExclusive':hex(end),'SHA256':hashlib.sha256(E.data[E.offset(start):E.offset(end)]).hexdigest()})

    assert [r['SHA256'] for r in ranges] == ['4cd016f691480748a3a05114f24ae94f09a1aa11fb8633029f50b29ea482a508', '018f78cbae9a99c1d2ae8a493a6e33001bcd289dbeaab868e2f0e618ecda697f', '3727067b55941b76a435bb9bd6181bdd1142baafc24d65b65d04cdd40cd3f854', '1d96141acab5d26dfffee2f78dd45c4773d3c7d25b24a4d4b423f5e3acb4e845', '0ddcfb442ca8d196643594b599b3737a89b76984b7fb4521a080a466be81ce4a', '6924523bb28ba67d06298260eebf6bd952c91da2829a44a250a31c228661b23f']
    result={'format':'elbera-pose-fallback-evidence-v1','ownedEngineSHA256':ENGINE_SHA,'ownedCoreSHA256':CORE_SHA,
     'instructionChecks':len(anchors)+len(coreanchors),'ranges':ranges,'actualInstructionCases':counts,
     'temporaryMaskZeroing':{'ownedSite':'0x106da322','status':'comparison-bound' if P else 'owned-call-unbound',
      'CoreAddZeroedBody':'0x10109110..0x1010917c'},
     'currentHierarchyCall':{'ownedSite':'0x106dba22','status':'comparison-bound' if P else 'owned-call-unbound'},
     'comparisonBlocks':blocks,'sourceExample':source_example,
     'limits':['neutral ordinary channel-zero pose inputs only; no complete live GetFrame claim',
     'negative frame/tween, multichannel blending, root-motion lock and modifier arrays require explicit handling',
     'six NOPs remain in the owned copy at both optional comparison import sites',
     'comparison correspondence does not authenticate the supplement or restore owned imports',
     'integer copy tests intentionally preserve all raw words; they do not admit nonfinite runtime poses']}
    if P: result['comparisonEngineSHA256']=P.sha
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true')
    parser.add_argument('--comparison-engine',type=Path,help='optional pinned supplemental Engine.dll')
    parser.add_argument('--audit-assets',action='store_true',help='read original Fighter face/animation pair')
    parser.add_argument('--out',type=Path,help='optional JSON receipt below repository tmp/')
    args=parser.parse_args()
    if not args.check: parser.error('--check is required')
    if args.out and not args.out.resolve().is_relative_to((ROOT/'tmp').resolve()):
        parser.error('--out must remain below repository tmp/')
    result=verify(comparison_engine=args.comparison_engine,audit_assets=args.audit_assets)
    if args.out:
        args.out.parent.mkdir(parents=True,exist_ok=True)
        args.out.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ('format','instructionChecks','actualInstructionCases',
        'temporaryMaskZeroing','currentHierarchyCall','sourceExample')}))


if __name__=='__main__': main()
