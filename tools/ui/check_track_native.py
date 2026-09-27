#!/usr/bin/env python3
"""Elbera Tools: verify retained ordinary sparse-track sampling instructions.

Pinned owned Engine is required; no supplemental input is needed for search,
alpha, hemisphere or translation slices. Native binary code is never executed.
Synthetic JS comparisons use Node and the separately documented quaternion model.
No proprietary poses, originals, or decoded binaries are written.
"""
import argparse
import bisect
import hashlib
import json
import math
from pathlib import Path
import random
import struct
import subprocess
from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA
from check_anim_terminal_native import f32
from check_legacy_skill_effects_native import LinearX87
from check_quaternion_native import interpolate_quaternion

def bits(v):return struct.unpack('<I',struct.pack('<f',v))[0]
def signed(v):return (v&0xffffffff)-0x100000000 if v&0x80000000 else v&0xffffffff

class Machine(LinearX87):
    def __init__(self,memory,registers,instructions,imports=None):
        super().__init__(memory,registers)
        self.program={i.address:i for i in instructions};self.status=0
    def read(self,operand):
        if operand=='ah':return (self.status>>8)&255
        if operand.startswith('0x') or operand.lstrip('-').isdigit():return int(operand,0)
        return super().read(operand)
    def write(self,operand,value,floating=False):
        if operand in ('eax','ebx','ecx','edx','edi','esi','esp','ebp'):self.registers[operand]=value
        else:super().write(operand,value,floating)

    def address(self,operand):
        text=operand[operand.index('[')+1:operand.index(']')]
        terms=text.replace(' - ',' + -').split(' + ');total=0
        for term in terms:
            if '*' in term:
                a,b=term.split('*');total+=self.registers[a]*int(b,0)
            elif term in self.registers:total+=self.registers[term]
            else:total+=int(term,0)
        return total
    def step(self,ins):
        op,args=ins.mnemonic,ins.op_str.split(', ')
        nxt=ins.address+ins.size
        if op=='lea':self.write(args[0],self.address(args[1]))
        elif op in ('push','pop'):
            if op=='push':
                v=self.read(args[0]);self.registers['esp']-=4;self.memory[self.registers['esp']]=v
            else:self.write(args[0],self.memory[self.registers['esp']]);self.registers['esp']+=4
        elif op in ('xor','add','sub','sar','shl'):
            a,b=self.read(args[0]),self.read(args[1])
            v=a^b if op=='xor' else a+b if op=='add' else a-b if op=='sub' else signed(a)>>b if op=='sar' else a<<b
            self.write(args[0],v&0xffffffff);self.sign=bool(v&0x80000000)
        elif op=='cmp':
            a,b=self.read(args[0])&0xffffffff,self.read(args[1])&0xffffffff
            self.zero=a==b;self.less=signed(a)<signed(b);self.carry=a<b
        elif op in ('fcom','fcomp','fcompp'):
            a,b=self.stack[0],self.stack[1] if op=='fcompp' else self.read(args[0])
            assert math.isfinite(a) and math.isfinite(b)
            self.status=0x100 if a<b else 0x4000 if a==b else 0
            if op!='fcom':self.stack.pop(0)
            if op=='fcompp':self.stack.pop(0)
        elif op=='fnstsw':self.registers['eax']=(self.registers.get('eax',0)&0xffff0000)|self.status
        elif op=='test':
            v=self.read(args[0])&self.read(args[1]);self.zero=v==0;self.parity=bin(v&255).count('1')%2==0
        elif op.startswith('j'):
            take={'jmp':True,'je':self.zero,'jne':not self.zero,'jle':self.less or self.zero,
                  'jl':self.less,'jge':not self.less,'jb':self.carry,'jae':not self.carry,
                  'jbe':self.carry or self.zero,'ja':not self.carry and not self.zero,
                  'jns':not self.sign,'jp':self.parity,'jnp':not self.parity}[op]
            if take:nxt=int(args[0],16)
        elif op=='fchs':self.stack[0]=-self.stack[0]
        elif op in ('fsubp','fdivp'):
            i=int(args[0][3:-1]);self.stack[i]=self.stack[i]-self.stack[0] if op=='fsubp' else self.stack[i]/self.stack[0];self.stack.pop(0)
        elif op=='ret':return None
        else:LinearX87.run(self,[ins])
        return nxt
    def execute(self,start,stop=None):
        self.zero=self.less=self.carry=self.sign=self.parity=False
        pc=start
        for count in range(4096):
            if pc==stop or pc is None:return count
            ins=self.program[pc];pc=self.step(ins)
        raise AssertionError('bounded native-slice step limit')

def machine(image,start,end,memory,registers,stack=()):
    rows=list(image.dis.disasm(image.data[image.offset(start):image.offset(end)],start))
    m=Machine(memory,registers,rows,None);m.stack=list(stack);return m

def selected(image,times,t):
    sp,move,track,timeptr=0x9000,0x2000,0x3000,0x4000
    mem={sp+4:move,sp+8:0,sp+12:bits(t),move+0x28:track,track+0x20:len(times),track+0x1c:timeptr}
    mem.update({timeptr+4*i:bits(x) for i,x in enumerate(times)})
    m=machine(image,0x106bb6a0,0x106bb76c,mem,{'esp':sp,'eax':0,'ebx':0,'ecx':0,'edx':0,'esi':0,'edi':0,'ebp':0})
    count=m.execute(0x106bb6a0,0x106bb76c)
    return (m.registers['edi'],m.registers['ebp'],bool(m.memory[m.registers['esp']+0x4c])),count

def alpha_native(image,times,duration,t,pair):
    sp,move,track,timeptr=0x9000,0x2000,0x3000,0x4000
    lo,hi,wrap=pair
    mem={sp+0x60:0,sp+0x50:f32(t),sp+0x5c:0,sp+0x48:move,sp+0x4c:int(wrap),move+0x10:f32(duration),track+0x1c:timeptr,
         0x108a8a50:struct.unpack_from('<d',image.data,image.offset(0x108a8a50))[0]}
    mem.update({timeptr+4*i:f32(x) for i,x in enumerate(times)})
    m=machine(image,0x106bb76c,0x106bb82b,mem,{'esp':sp,'edi':lo,'ebp':hi,'esi':track})
    count=m.execute(0x106bb76c,0x106bb82b)
    return m.memory[sp+0x14],count

def alpha_formula(times,duration,t,pair,epsilon):
    lo,hi,wrap=pair
    if lo==hi:return 0.
    den=f32(duration-times[lo]) if wrap else abs(f32(times[hi]-times[lo]))
    return f32((t-times[lo])/den) if den>epsilon else 1.

def hemisphere_formula(first,reference):
    minus=[f32(a-b) for a,b in zip(first,reference)];plus=[f32(a+b) for a,b in zip(first,reference)]
    norm=lambda a:f32(((f32(a[1]*a[1])+f32(a[0]*a[0]))+f32(a[2]*a[2]))+f32(a[3]*a[3]))
    neg=norm(plus)<norm(minus)
    return [-x for x in first] if neg else list(first),neg

def hemisphere_native(image,first,reference):
    sp,a,b=0x9000,0x2000,0x3000
    mem={sp+4:a,sp+8:b};mem.update({a+i*4:v for i,v in enumerate(first)});mem.update({b+i*4:v for i,v in enumerate(reference)})
    m=machine(image,0x106b56d0,0x106b5804,mem,{'esp':sp})
    count=m.execute(0x106b56d0)
    return [m.memory[a+i*4] for i in range(4)],count

def translation_native(image,first,second,alpha):
    sp,out=0x9000,0x4000
    mem={sp:0,sp+4:0,sp+8:0,sp+12:0,sp+0x58:out,sp+0x14:f32(alpha)}
    mem.update({sp+0x24+i*4:f32(v) for i,v in enumerate(first)})
    mem.update({sp+0x18+i*4:f32(v) for i,v in enumerate(second)})
    m=machine(image,0x106bbab3,0x106bbb49,mem,{'esp':sp})
    count=m.execute(0x106bbab3)
    return [m.memory[out+i*4] for i in range(3)],count

def verify():
    image=Image(ROOT/'assets/interlude/system/engine.dll',ENGINE_SHA,True)
    epsilon=struct.unpack_from('<d',image.data,image.offset(0x108a8a50))[0]
    anchors=[
        (0x1030777f,'jmp','0x106bb6a0'),
        (0x10307e96,'jmp','0x106b56d0'),
        (0x1030f024,'jmp','0x106ae090'),
        (0x106da48a,'fld','dword ptr [ebx + 0x10]'),
        (0x106da4c1,'fld','dword ptr [edi + 0x10]'),
        (0x106da4c4,'fmul','dword ptr [esp + 0x14]'),
        (0x106da4c8,'fstp','dword ptr [esp + 0x44]'),
        (0x106da5b0,'mov','eax, dword ptr [edi + 0xc]'),
        (0x106da5b7,'jl','0x106da774'),
        (0x106da5f2,'push','0'),
        (0x106da600,'mov','eax, dword ptr [edx + ebx*4]'),
        (0x106da60d,'call','0x1030777f'),
        (0x106bb89b,'call','0x10307e96'),
        (0x106bb963,'call','0x1030f024'),
        (0x106bbb6d,'cmp','dword ptr [esi + 0x14], 1'),
    ]
    for va,op,args in anchors:image.instruction(va,op,args)
    ranges=[]
    for label,a,b in [('search',0x106bb6a0,0x106bb76c),('alpha',0x106bb76c,0x106bb82b),('sampler',0x106bb6a0,0x106bbbb7),('hemisphere',0x106b56d0,0x106b5804),('translation',0x106bbab3,0x106bbb49),('source time',0x106da48a,0x106da4cc)]:
        ranges.append({'label':label,'start':hex(a),'end':hex(b),'SHA256':hashlib.sha256(image.data[image.offset(a):image.offset(b)]).hexdigest()})
    assert [r['SHA256'] for r in ranges]==[
        'e0e84f515f5859038ee7b86d0f8215d9ae5303bd8e1773196734fbb2b5140755',
        '11e8a494bc6a340d0fea83968a1e8d56ea5e7a3883635281a7069adc6f922a6c',
        '3dd5a42e561e9eaa2a2e90eab0066206820ae25445e967e182bce404d17df784',
        '702c08698f429f96464e814d0b36be23b5f45e4c6a008b73c52706e8f35a1ce5',
        '8e6c1e8ba549abc0fa3eaba39b97dd0da9e445ae35840055f2340d40683c373f',
        '2cdcc17ce62322f87048fc88892248fc3d320d7a6c1bb3b8566830de5595fcbf']
    rng=random.Random(0x53414d50);cases=steps=0;examples=[]
    for n in [1,2,3,30,31,32,100,1000]:
        times=[f32(i*.75) for i in range(n)]
        if n>3:times[2]=times[1]
        for t in [0.,.2,*times[:4],times[-1],f32(times[-1]+.3)]+[f32(rng.random()*(times[-1]+1)) for _ in range(40)]:
            pair,k=selected(image,times,t);steps+=k
            lo=max(0,bisect.bisect_right(times,t)-1);expect=(lo,(lo+1)%n,lo==n-1)
            assert pair==expect,(n,t,pair,expect)
            duration=f32(times[-1]+.75)
            actual,k=alpha_native(image,times,duration,t,pair);steps+=k
            assert actual==alpha_formula(times,duration,t,pair,epsilon)
            cases+=1
    for duration in [f32(1),f32(1.00005),f32(1.0001),f32(1.0002)]:
        pair,k=selected(image,[0.,1.],f32(1.00003));actual,k2=alpha_native(image,[0.,1.],duration,f32(1.00003),pair);steps+=k+k2
        assert actual==alpha_formula([0.,1.],duration,f32(1.00003),pair,epsilon)
        examples.append({'times':[0,1],'duration':duration,'time':f32(1.00003),'pair':pair,'alpha':actual});cases+=1
    hc=hs=0
    pairs=[([0.,0.,0.,1.],[0.,0.,0.,-1.]),([0.,0.,0.,1.],[1.,0.,0.,0.]),([0.,0.,0.,1.],[0.,0.,0.,1.])]
    for _ in range(200):pairs.append(tuple([f32(rng.uniform(-2,2)) for _ in range(4)] for _ in range(2)))
    for a,b in pairs:
        actual,k=hemisphere_native(image,a,b);expected,neg=hemisphere_formula(a,b);assert actual==expected,(a,b,actual,expected);hc+=1;hs+=k
    tc=translation_steps=0
    for first,second,a in [([1,2,3],[4,8,12],0),([1,2,3],[4,8,12],1)]+[([f32(rng.uniform(-1e3,1e3)) for _ in range(3)],[f32(rng.uniform(-1e3,1e3)) for _ in range(3)],f32(rng.random())) for _ in range(100)]:
        actual,k=translation_native(image,first,second,a)
        expected=[f32(x+f32(f32(y-x)*f32(a))) for x,y in zip(first,second)]
        assert actual==expected,(actual,expected);tc+=1;translation_steps+=k
    return {'ownedEngineSHA256':image.sha,'instructionAnchors':len(anchors),'ranges':ranges,'epsilon':epsilon,
            'searchAlphaCases':cases,'searchAlphaInstructions':steps,
            'hemisphereCases':hc,'hemisphereInstructions':hs,
            'translationCases':tc,'translationInstructions':translation_steps,
            'denominatorExamples':examples,
            'runtimeDifferential': runtime_differential(image),
            'limits':['finite nonnegative Float32 times; special/root-motion mode excluded',
                      'Float64 intermediates approximate native x87; explicit f32 stores retained',
                      'quaternion CRT/import limits remain those of check_quaternion_native.py',
                      'no mesh-bone association or full GetFrame evaluation']}

def runtime_differential(image):
    cases=[]
    rng=random.Random(0x54524143)
    for count in (1,2,3,30,31,32,100):
        times=[f32(i*.75) for i in range(count)]
        rotations=[[0.,0.,f32(math.sin(i*.02)),f32(math.cos(i*.02))] for i in range(count)]
        # A deliberate closing sign change must be handled only at wrap.
        if count>1: rotations[0]=[-v for v in rotations[0]]
        for constant in (False,True):
            positions=[[f32(rng.uniform(-100,100)) for _ in range(3)] for _ in range(1 if constant else count)]
            for frame in (0.,f32(.23),f32(.81),1.):
                cases.append({'track':{'flags':0,'times':times,'quaternions':rotations,'positions':positions},
                              'duration':f32(times[-1]+.75),'frame':frame})
    for duration in (1.,f32(1.00005),f32(1.0002)):
        cases.append({'track':{'flags':0,'times':[0.,1.],'quaternions':[[0.,0.,0.,1.],[0.,0.,0.,1.]],
                               'positions':[[1.,2.,3.],[5.,6.,7.]]},'duration':duration,'frame':1.})
    script="""import fs from 'node:fs';
import {sampleOriginalTrack} from './editor/world/js/nativetrack.js';
const rows=JSON.parse(fs.readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify(rows.map(r=>sampleOriginalTrack(r.track,r.duration,r.frame))));"""
    process=subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(cases),
                           text=True,capture_output=True,cwd=ROOT,timeout=30,check=True)
    results=json.loads(process.stdout);assert len(results)==len(cases)
    max_error=0.
    for case,actual in zip(cases,results):
        tr=case['track'];time=f32(f32(case['duration'])*f32(case['frame']))
        pair,_=selected(image,tr['times'],time)
        alpha,_=alpha_native(image,tr['times'],case['duration'],time,pair)
        first,second,wrapped=pair;flipped=False;rotation=tr['quaternions'][first]
        position=tr['positions'][0 if len(tr['positions'])==1 else first]
        if first!=second and alpha!=0:
            successor=tr['quaternions'][second]
            if wrapped:
                adjusted,_=hemisphere_native(image,successor,rotation)
                flipped=any(x!=y for x,y in zip(adjusted,successor));successor=adjusted
            rotation=interpolate_quaternion(rotation,successor,alpha)
            if len(tr['positions'])>1:position,_=translation_native(image,position,tr['positions'][second],alpha)
        expected={'first':first,'second':second,'alpha':alpha,'wrapped':wrapped,'hemisphereFlipped':flipped}
        assert all(actual[k]==v for k,v in expected.items()),(actual,expected)
        assert actual['position']==position,(actual['position'],position)
        error=max(abs(a-b) for a,b in zip(actual['quaternion'],rotation));max_error=max(max_error,error)
        assert error<=2e-6,(actual['quaternion'],rotation)
    return {'cases':len(cases),'selectionAndPositionExact':True,
            'quaternionMaximumComponentError':max_error,
            'quaternionComparisonTolerance':2e-6,
            'quaternionReference':'separate bounded Python model, not complete CRT emulation'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true',help='compact result instead of JSON evidence')
    args=parser.parse_args();result=verify()
    if args.check:
        print(f"Original tracks: {len(result['ranges'])} pinned ranges, {result['instructionAnchors']} anchors; "
              f"{result['searchAlphaCases']} search/alpha, {result['hemisphereCases']} hemisphere, "
              f"{result['translationCases']} translation instruction cases; "
              f"{result['runtimeDifferential']['cases']} browser differential cases passed.")
    else:print(json.dumps(result,indent=2))

if __name__=='__main__':main()
