#!/usr/bin/env python3
"""Elbera Tools: bounded original negative-frame local-pose tween evidence.

Portable formulas import without originals or Capstone. Source verification
reads pinned owned Engine/Core; named import correspondence requires an explicit
hash-pinned supplemental Engine. No native code is executed or dumped.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import struct
import subprocess

from check_quaternion_native import f32, quaternion

ROOT = Path(__file__).resolve().parents[2]
MINIMUM_SQUARE = f32(1e-5)
FALLBACK_COMPONENT = f32(.1)


def hemisphere(first, reference):
    first, reference = quaternion(first), quaternion(reference)
    minus = [f32(a-b) for a,b in zip(first,reference)]
    plus = [f32(a+b) for a,b in zip(first,reference)]
    def norm(v):
        return f32(((f32(v[1]*v[1])+f32(v[0]*v[0]))+f32(v[2]*v[2]))+f32(v[3]*v[3]))
    flipped = norm(plus) < norm(minus)
    return ([-v for v in first] if flipped else first), flipped


def tween_quaternion(cached, first, fraction):
    """Separate 0x106afd00 helper, before its caller's unconditional Normalize."""
    a,b,t = quaternion(cached),quaternion(first),f32(fraction)
    dot = f32(((a[0]*b[0]+a[1]*b[1])+a[2]*b[2])+a[3]*b[3])
    if dot >= 1: return a, 'copy'
    theta = f32(math.acos(dot))
    reciprocal = f32(1/math.sin(theta))
    wa = f32(math.sin((1-t)*theta)*reciprocal)
    wb = f32(math.sin(theta*t)*reciprocal)
    return [f32(wa*x+wb*y) for x,y in zip(a,b)], 'trigonometric'


def normalize(value):
    value = quaternion(value)
    square = f32(((value[1]*value[1]+value[0]*value[0])+value[2]*value[2])+value[3]*value[3])
    if square < MINIMUM_SQUARE: return [0.,0.,FALLBACK_COMPONENT,0.], True
    factor = f32(1/f32(math.sqrt(square)))
    return [f32(v*factor) for v in value], False


def tween_state(current, previous, frames, old_name, new_name, accumulated):
    current, previous, accumulated = f32(current), f32(previous), f32(accumulated)
    if type(frames) is not int or not 0 < frames <= 0x7fffffff:
        raise ValueError('positive source NumFrames required')
    if previous == 0:
        raise ValueError('zero previous frame requires unproved native exception policy')
    fraction = f32(1-current/previous)
    if old_name != new_name or not 0 <= fraction <= 1:
        return 0., {'previousFrame':f32(-1/frames),'previousSequenceId':new_name,'accumulated':0.}
    return fraction, {'previousFrame':current,'previousSequenceId':old_name,
                      'accumulated':f32((1-accumulated)*fraction+accumulated)}


def tween_position(cached, first, fraction):
    if not isinstance(cached,(list,tuple)) or not isinstance(first,(list,tuple)) or len(cached)!=3 or len(first)!=3:
        raise ValueError('three position components required')
    a,b,t = list(map(f32,cached)),list(map(f32,first)),f32(fraction)
    return [f32(x+f32(f32(y-x)*t)) for x,y in zip(a,b)]


def tween_local_pose(value):
    """Mirror the bounded JS contract; rejected inputs never fabricate a pose."""
    try:
        if not isinstance(value,dict): raise ValueError('tween input required')
        def identity(v):
            if type(v) is int and 0 <= v <= 0xffffffff or type(v) is str and v: return v
            raise ValueError('explicit sequence identity required')
        frame = f32(value['frame'])
        if not frame < 0: raise ValueError('negative normalized frame required')
        frames = value['frames']
        if type(frames) is not int or not 0 < frames <= 0x7fffffff: raise ValueError('positive source NumFrames required')
        if type(value['cacheValid']) is not bool: raise ValueError('explicit cache validity required')
        old,new = identity(value['previousSequenceId']),identity(value['sequenceId'])
        previous, accumulated = f32(value['previousFrame']),f32(value['accumulated'])
        def pose(v):
            if not isinstance(v,dict): raise ValueError('source local pose required')
            position = v['position']
            if not isinstance(position,(list,tuple)) or len(position)!=3: raise ValueError('three position components required')
            return quaternion(v['quaternion']),list(map(f32,position))
        if not value['cacheValid']:
            firstq,firstp = pose(value['frameZeroPose'])
            return dict(status='ready',mode='frame-zero',quaternion=firstq,position=firstp,
                        fraction=None,hemisphereFlipped=False,quaternionBranch=None,
                        state=dict(previousFrame=previous,previousSequenceId=old,accumulated=accumulated))
        firstq,firstp = pose(value['firstKey'])
        cachedq,cachedp = pose(value['cached'])
        fraction,state = tween_state(frame,previous,frames,old,new,accumulated)
        adjusted,flipped = hemisphere(firstq,cachedq)
        q,branch = tween_quaternion(cachedq,adjusted,fraction)
        q,tiny = normalize(q)
        return dict(status='ready',mode='tween',quaternion=q,position=tween_position(cachedp,firstp,fraction),
                    fraction=fraction,hemisphereFlipped=flipped,
                    quaternionBranch=branch+('-tiny-fallback' if tiny else ''),state=state)
    except (KeyError,TypeError,ValueError,OverflowError,ZeroDivisionError) as error:
        return dict(status='unsupported',reason=str(error))


def synthetic_cases():
    """Authored finite inputs only; original pose bytes are never fixtures."""
    rng = random.Random(0x747765656e)
    pairs = [([0.,0.,0.,1.],[0.,0.,0.,1.],.2),
             ([0.,0.,0.,1.],[0.,0.,.6,.8],.5),([0.,0.,0.,0.],[0.,0.,0.,0.],.5)]
    for _ in range(120):
        pair=[]
        for _ in range(2):
            q=[rng.uniform(-1,1) for _ in range(4)]
            length=math.sqrt(sum(v*v for v in q));pair.append([f32(v/length) for v in q])
        pairs.append((*pair,f32(rng.random())))
    cases=[]
    for a,b,t in pairs:
        cases.append(dict(cacheValid=True,cached=dict(quaternion=a,position=[f32(rng.uniform(-100,100)) for _ in range(3)]),
                          firstKey=dict(quaternion=b,position=[f32(rng.uniform(-100,100)) for _ in range(3)]),
                          frame=f32(-.1*(1-t)),previousFrame=f32(-.1),frames=10,
                          sequenceId=1,previousSequenceId=1,accumulated=f32(.2)))
    return cases


def verify(comparison_engine=None, check_js=False):
    from check_tutorial_quest_native import Image, ENGINE_SHA
    from check_skillanim_native import CORE_SHA
    from supplemental_pe import PEImage
    from check_hair_attachment_native import COMPARISON_SHA,compare_call_block
    from check_track_native import Machine,machine,hemisphere_native
    E=Image(ROOT/'assets/interlude/system/engine.dll',ENGINE_SHA,True)
    C=Image(ROOT/'assets/interlude/system/Core.dll',CORE_SHA)
    P=PEImage(comparison_engine,COMPARISON_SHA) if comparison_engine else None
    assert E.exported('?GetFrame@USkeletalMeshInstance@@UAEXPAVAActor@@PAVFLevelSceneNode@@PAVFVector@@HAAHK@Z',True)==0x106d9a70
    if P: assert P.body('?GetFrame@USkeletalMeshInstance@@UAEXPAVAActor@@PAVFLevelSceneNode@@PAVFVector@@HAAHK@Z')==0x106d9a30
    anchors=[
        (0x1030e37c,'jmp','0x106afd00'),(0x10307e96,'jmp','0x106b56d0'),
        (0x106d9dd4,'mov','eax, dword ptr [ebp + 0x1cc]'),
        (0x106d9ddc,'jne','0x106d9e4d'),(0x106d9e3b,'fstp','dword ptr [edx + ecx + 0x68]'),
        (0x106d9e42,'add','ecx, 0x70'),(0x106da42b,'fcomp','dword ptr [ebx + 0x10]'),
        (0x106da435,'jne','0x106da448'),(0x106da437,'cmp','dword ptr [ebp + 0x1fc], 0'),
        (0x106da43e,'mov','dword ptr [esp + 0x10], 1'),(0x106da446,'jne','0x106da450'),
        (0x106da448,'mov','dword ptr [esp + 0x10], 0'),
        (0x106da48a,'fld','dword ptr [ebx + 0x10]'),(0x106da4a4,'fstp','dword ptr [esp + 0x14]'),
        (0x106da52b,'cmp','dword ptr [esp + 0x10], 0'),(0x106da530,'jne','0x106da4e8'),
        (0x106da78c,'jmp','0x106dab95'),(0x106da797,'fdiv','dword ptr [ebx + 0x68]'),
        (0x106da7a2,'fstp','dword ptr [esp + 0x14]'),(0x106da7ab,'fdivr','qword ptr [0x108a0660]'),
        (0x106da7de,'fstp','dword ptr [ebx + 0x68]'),(0x106da7fa,'mov','dword ptr [edi], eax'),
        (0x106da806,'fstp','dword ptr [ebx + 0x60]'),
        (0x106daa29,'call','0x10307e96'),(0x106daa50,'call','0x1030e37c'),
        (0x106db21e,'mov','dword ptr [ebp + 0x1fc], 1'),
    ]
    for anchor in anchors: E.instruction(*anchor)
    MATH={'?appAcos@@YANN@Z':math.acos,'?appSin@@YANN@Z':math.sin,'?appSqrt@@YANN@Z':math.sqrt}
    blocks=[]
    if P:
     for a,b,sites,direct in [
      (0x106afd00,0x106afe3b,[(0x106afd09,'??0FQuat@@QAE@XZ'),(0x106afd52,'?appAcos@@YANN@Z'),(0x106afd63,'?appSin@@YANN@Z'),(0x106afd80,'?appSin@@YANN@Z'),(0x106afd99,'?appSin@@YANN@Z')],[]),
      (0x106da791,0x106da809,[(0x106da7b5,'??9FName@@QBEHABV0@@Z')],[]),
      (0x106da975,0x106daa65,[(0x106daa5f,'?Normalize@FQuat@@QAEHXZ')],[0x106daa29,0x106daa50]),
      (0x106d9aa0,0x106d9ad3,[(0x106d9ab6,'?AddZeroed@FArray@@QAEHHH@Z'),(0x106d9acd,'?Shrink@FArray@@QAEXH@Z')],[]),
      (0x106c4ae0,0x106c4b6e,[(va,'?Empty@FArray@@QAEXHH@Z') for va in (0x106c4af4,0x106c4b04,0x106c4b14,0x106c4b24,0x106c4b34,0x106c4b44,0x106c4b54)],[]),
     ]:
      old=E.data[E.offset(a):E.offset(b)];new=P.read(a-0x40,b-a)
      blocks.append({'ownedStartVA':hex(a),'ownedEndVAExclusive':hex(b),
      'ownedSHA256':hashlib.sha256(old).hexdigest(),'candidateSHA256':hashlib.sha256(new).hexdigest(),
      **compare_call_block(old,new,owned_va=a,candidate_va=a-0x40,sites=[(i-a,('core.dll',s))for i,s in sites],direct_calls=[i-a for i in direct],imports=P.imports)})
    constants={0x108a0660:struct.unpack_from('<d',E.data,E.offset(0x108a0660))[0],
     0x101cdfc4:struct.unpack_from('<f',C.data,C.offset(0x101cdfc4))[0],
     0x101cdfc0:struct.unpack_from('<f',C.data,C.offset(0x101cdfc0))[0]}
    assert constants[0x108a0660]==-1.
    assert constants[0x101cdfc4]==f32(1e-5) and constants[0x101cdfc0]==f32(.1)
    coremethods={
     '??0FQuat@@QAE@XZ':(0x10110a80,0x10110a83),
     '??9FName@@QBEHABV0@@Z':(0x10109d60,0x10109d72),
     '?Normalize@FQuat@@QAEHXZ':(0x10110cc0,0x10110d60),
    }
    for s,(a,b) in coremethods.items():assert C.exported(s,True)==a
    assert bytes(C.data[C.offset(0x10110a80):C.offset(0x10110a83)])==bytes.fromhex('8bc1c3')
    C.instruction(0x10109d68,'cmp','eax, dword ptr [edx]');C.instruction(0x10109d6a,'setne','cl');C.instruction(0x10109d6f,'ret','4')
    C.instruction(0x10110d02,'call','0x10104840');C.instruction(0x10104840,'jmp','0x1012d790')
    assert C.exported('?appSqrt@@YANN@Z',True)==0x1012d790

    class Slice(Machine):
     def __init__(self,mem,regs,rows,source='candidate',masked_zero=False):
      super().__init__(mem,regs,rows);self.source=source;self.calls=[];self.masked_zero=masked_zero
     def step(self,ins):
      op,args=ins.mnemonic,ins.op_str.split(', ')
      if op in ('fdiv','fdivr'):
       a,b=self.stack[0],self.read(args[0])
       numerator,denominator=(a,b) if op=='fdiv' else (b,a)
       if denominator==0 and self.masked_zero:
        assert math.isfinite(numerator) and numerator!=0
        self.stack[0]=math.copysign(math.inf,numerator)*math.copysign(1.,denominator)
       else:self.stack[0]=numerator/denominator
       return ins.address+ins.size
      if op in ('fcom','fcomp') and self.masked_zero:
       a,b=self.stack[0],self.read(args[0]);assert not math.isnan(a) and not math.isnan(b)
       self.status=0x100 if a<b else 0x4000 if a==b else 0
       if op=='fcomp':self.stack.pop(0)
       return ins.address+ins.size
      if op=='fdivrp':
       at=int(args[0][3:-1]);self.stack[at]=self.stack[0]/self.stack[at];self.stack.pop(0);return ins.address+ins.size
      if op=='fild':self.stack.insert(0,float(self.read(args[0])));return ins.address+ins.size
      if op=='call':
       if self.source=='core':
        assert ins.address==0x10110d02 and args==['0x10104840'];symbol='?appSqrt@@YANN@Z'
       else:
        dll,symbol=P.imported_call(ins.address);assert dll=='core.dll'
       self.calls.append(symbol)
       if symbol in MATH:self.stack.insert(0,MATH[symbol](self.memory[self.registers['esp']]))
       elif symbol=='??0FQuat@@QAE@XZ':self.registers['eax']=self.registers['ecx']
       elif symbol=='??9FName@@QBEHABV0@@Z':
        ptr=self.memory[self.registers['esp']]
        self.registers['eax']=int(self.memory[self.registers['ecx']]!=self.memory[ptr]);self.registers['esp']+=4
       else:raise AssertionError('unhandled explicitly bound call '+symbol)
       return ins.address+ins.size
      return super().step(ins)

    def rows(source,a,b):
     blob=P.read(a,b-a) if source=='candidate' else C.data[C.offset(a):C.offset(b)] if source=='core' else E.data[E.offset(a):E.offset(b)]
     return list(E.dis.disasm(blob,a))
    counts={}
    def note(name,n):
     x=counts.setdefault(name,{'cases':0,'instructions':0});x['cases']+=1;x['instructions']+=n

    def native_quaternion(a,b,t):
     sp,out,first,second=0x9000,0x2000,0x3000,0x4000
     mem={sp:0xBADF00D,sp+4:out,sp+8:first,sp+12:second,sp+16:f32(t)}
     mem.update({first+i*4:f32(v) for i,v in enumerate(a)});mem.update({second+i*4:f32(v)for i,v in enumerate(b)})
     m=Slice(mem,{'esp':sp,'esi':0x1111,'edi':0x2222},rows('candidate',0x106afcc0,0x106afdfb))
     n=m.execute(0x106afcc0)
     assert m.registers['esp']==sp and m.memory[sp]==0xBADF00D and m.registers['eax']==out and not m.stack
     assert m.registers['esi']==0x1111 and m.registers['edi']==0x2222
     assert [m.memory[first+i*4]for i in range(4)]==list(a)
     assert [m.memory[second+i*4]for i in range(4)]==list(b)
     note('separateTweenQuaternion',n)
     return [m.memory[out+i*4]for i in range(4)]

    def native_normalize(a):
     sp,ptr=0x9000,0x3000;mem={sp:0xBADF00D,**constants};mem.update({ptr+i*4:v for i,v in enumerate(a)})
     m=Slice(mem,{'esp':sp,'ecx':ptr,'esi':0x1111},rows('core',0x10110cc0,0x10110d60),'core');n=m.execute(0x10110cc0)
     assert not m.stack and m.registers['esi']==0x1111 and m.registers['esp']==sp
     note('postBlendCoreNormalize',n);return [m.memory[ptr+i*4]for i in range(4)]

    def bookkeeping(current,previous,frames,old_name,new_name,accumulated):
     sp,ch,seq,mesh=0x9000,0x3000,0x4000,0x5000
     mem={sp+0x58:mesh,mesh+0x20c:0,ch+0x10:f32(current),ch+0x68:f32(previous),
          ch+8:new_name,ch+0x6c:old_name,ch+0x60:f32(accumulated),seq+0x14:frames,**constants}
     m=Slice(mem,{'esp':sp,'ebx':ch,'ecx':seq},rows('candidate',0x106da751,0x106da7c9));n=m.execute(0x106da751,0x106da7c9)
     fraction,state=tween_state(current,previous,frames,old_name,new_name,accumulated)
     expected=(fraction,state['previousFrame'],state['previousSequenceId'],state['accumulated'])
     actual=(m.memory[sp+0x10],m.memory[ch+0x68],m.memory[ch+0x6c],m.memory[ch+0x60])
     assert actual==expected,(current,previous,actual,expected)
     note('sameSequenceFractionAndReset',n)
     return actual
    def native_position(cached,target,t):
     sp=0x9000;mem={sp+0x10:f32(t)}
     mem.update({sp+0x70+i*4:f32(v)for i,v in enumerate(cached)});mem.update({sp+0xc4+i*4:f32(v)for i,v in enumerate(target)})
     m=Slice(mem,{'esp':sp},rows('owned',0x106daa65,0x106dab04),'owned');n=m.execute(0x106daa65,0x106dab04)
     actual=[m.memory[sp+0x4c+i*4]for i in range(3)]
     expected=tween_position(cached,target,t)
     assert actual==expected,(actual,expected)
     note('incrementalPositionStores',n);return actual
    # Source track index -> raw first q/p; current local cache -> separate q/p.
    # Distinct sentinels make an accidental swapped endpoint or stride visible.
    for bone,index in ((0,0),(3,8),(27,5)):
        sp,inst,movement,tracks,indexptr,qptr,pptr,cq,cp=0x9000,0x10000,0x20000,0x30000,0x40000,0x50000,0x60000,0x70000,0x80000
        firstq=[11,12,13,14];firstp=[21,22,23];cacheq=[31,32,33,34];cachep=[41,42,43]
        mem={indexptr:index,movement+0x28:tracks,tracks+index*40+4:qptr,tracks+index*40+0x10:pptr,
             inst+0x1c8:cq,inst+0x1d4:cp,sp+0x14:bone*16,sp+0x44:bone*12}
        for ptr,values in ((qptr,firstq),(pptr,firstp),(cq+bone*16,cacheq),(cp+bone*12,cachep)):
            mem.update({ptr+i*4:v for i,v in enumerate(values)})
        m=machine(E,0x106da975,0x106daa29,mem,{'esp':sp,'ebp':inst,'eax':indexptr,'edi':movement})
        n=m.execute(0x106da975,0x106daa29)
        assert [m.memory[sp+0xe0+i*4] for i in range(4)]==firstq
        assert [m.memory[sp+0xc4+i*4] for i in range(3)]==firstp
        assert [m.memory[sp+0xf0+i*4] for i in range(4)]==cacheq
        assert [m.memory[sp+0x70+i*4] for i in range(3)]==cachep
        assert [m.memory[m.registers['esp']+i*4] for i in range(2)]==[sp+0xe0,sp+0xf0]
        note('rawFirstKeysAndCachedLocalsOperandOrder',n)
    cases=synthetic_cases()
    for case in cases:
        cached,target=quaternion(case['cached']['quaternion']),quaternion(case['firstKey']['quaternion'])
        adjusted,n=hemisphere_native(E,target,cached)
        assert adjusted==hemisphere(target,cached)[0];note('targetHemisphereAgainstCached',n)
        fraction,state=tween_state(case['frame'],case['previousFrame'],case['frames'],1,1,case['accumulated'])
        formula,_=tween_quaternion(cached,adjusted,fraction)
        if P: assert native_quaternion(cached,adjusted,fraction)==formula
        assert native_normalize(formula)==normalize(formula)[0]
        native_position(case['cached']['position'],case['firstKey']['position'],fraction)
    if P:
        for current,previous,old,new,acc in [(-.075,-.1,1,1,0),(-.05,-.075,1,1,.25),
          (-.05,-.075,1,2,.25),(-.1,-.1,1,1,.5),(0.,-.1,1,1,.5),(-.2,-.1,1,1,.5),(.01,-.1,1,1,.5)]:
            bookkeeping(current,previous,10,old,new,acc)
    # Conditional source result only: this explicitly models a MASKED x87
    # zero divide. It does not establish the active render-thread control word,
    # and the browser's default API deliberately continues to reject zero.
    masked_zero_cases=0
    if P:
        for zero in (0.,-0.):
            for old_name,new_name in ((1,1),(1,2)):
                sp,ch,seq,mesh=0x9000,0x3000,0x4000,0x5000
                mem={sp+0x58:mesh,mesh+0x20c:0,ch+0x10:f32(-.08),ch+0x68:zero,
                     ch+8:new_name,ch+0x6c:old_name,ch+0x60:f32(.7),seq+0x14:10,**constants}
                m=Slice(mem,{'esp':sp,'ebx':ch,'ecx':seq},rows('candidate',0x106da751,0x106da7c9),masked_zero=True)
                n=m.execute(0x106da751,0x106da7c9)
                assert (m.memory[sp+0x10],m.memory[ch+0x68],m.memory[ch+0x6c],m.memory[ch+0x60])==(0.,f32(-.1),new_name,0.)
                note('conditionalMaskedZeroDivideReset',n);masked_zero_cases+=1
    # Actual cache-array initialization clears prior tween frames, not names or
    # accumulated values. It is not permission to seed a negative prior frame.
    for count in (0,1,2,7):
        inst,channels,sp=0x2000,0x4000,0x9000
        mem={inst+0x188:count,inst+0x184:channels}
        for i in range(count):mem[channels+i*0x70+0x68]=-99.;mem[channels+i*0x70+0x6c]=700+i
        m=machine(E,0x106d9e27,0x106d9e4d,mem,{'esp':sp,'ebp':inst,'eax':123,'ecx':456})
        n=m.execute(0x106d9e27,0x106d9e4d)
        assert all(m.memory[channels+i*0x70+0x68]==0. and m.memory[channels+i*0x70+0x6c]==700+i for i in range(count))
        note('cacheAllocationClearsPreviousFrameOnly',n)
    js_cases=0
    if check_js:
        url=(ROOT/'editor/world/js/nativetween.js').as_uri()
        script='import {tweenOriginalLocalPose} from '+json.dumps(url)+';let s="";for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(JSON.parse(s).map(tweenOriginalLocalPose)));'
        actual=json.loads(subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(cases),text=True,capture_output=True,check=True,timeout=30).stdout)
        for case,result in zip(cases,actual):
            expected=tween_local_pose(case)
            assert result['status']==expected['status']=='ready'
            for key in ('mode','fraction','hemisphereFlipped','quaternionBranch','state','position'):assert result[key]==expected[key],key
            # Math.sin/acos implementations and Float64 versus x87 are not a
            # universal exact-bit claim. State/position stores compare exactly.
            assert max(abs(a-b) for a,b in zip(result['quaternion'],expected['quaternion']))<=2e-6
        assert len(actual)==len(cases);js_cases=len(cases)
    ranges=[dict(startVA=hex(a),endVAExclusive=hex(b),SHA256=hashlib.sha256(E.data[E.offset(a):E.offset(b)]).hexdigest()) for a,b in [(0x106afd00,0x106afe3b),(0x106da41a,0x106da450),(0x106da791,0x106da809),(0x106da975,0x106dab04),(0x106d9e27,0x106d9e4d),(0x106c4ae0,0x106c4b6e)]]
    return dict(format='elbera-pose-tween-native-evidence-v1',
                status='supplemental-imports-and-bounded-arithmetic-verified' if P else 'owned-retained-slices-only',
                ownedEngineSHA256=ENGINE_SHA,ownedCoreSHA256=CORE_SHA,
                comparisonEngineSHA256=P.sha if P else None,instructionAnchors=len(anchors)+5,
                comparisonBlocks=blocks,namedCoreBodies=[dict(symbol=s,startVA=hex(a),endVAExclusive=hex(b),SHA256=hashlib.sha256(C.data[C.offset(a):C.offset(b)]).hexdigest()) for s,(a,b) in coremethods.items()],
                cases=counts,javascriptCases=js_cases,ownedRanges=ranges,conditionalMaskedZeroCases=masked_zero_cases,
                limits=['comparison archive authenticity and owned import restoration unverified',
                        'Float64/trigonometric approximations establish bounded compatibility, not x87/CRT equivalence',
                        'zero previous frame, native exceptions, cache invalidation and full channel lifecycle remain unadmitted',
                        'neutral mapped bones, channel zero, special mode zero; no root lock, scale blend or later modifiers'])


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--comparison-engine',type=Path,help='explicit pinned supplemental Engine for import correspondence')
    parser.add_argument('--js',action='store_true',help='compare the browser helper on authored finite cases')
    parser.add_argument('--check',action='store_true',help='compact result rather than metadata JSON')
    args=parser.parse_args();result=verify(args.comparison_engine,args.js)
    if args.check:
        print(f"Pose tween: {result['instructionAnchors']} anchors; {len(result['comparisonBlocks'])} supplemental blocks; "
              f"{sum(v['cases'] for v in result['cases'].values())} interpreted cases; {result['javascriptCases']} JS cases; {result['status']}.")
    else: print(json.dumps(result,indent=2))


if __name__=='__main__': main()
