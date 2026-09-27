#!/usr/bin/env python3
"""Elbera Tools: bounded original mesh-to-animation first-name linkup.

Portable APIs use only the standard library and never read original inputs.
Native checks lazily require Capstone and pinned owned Engine/Core binaries.
Named erased-call bindings require explicit --comparison-engine; the archive
copy is supplemental and unauthenticated, never substituted for owned inputs.
"""
import argparse
import hashlib
import json
from pathlib import Path
import random
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
CANDIDATE_SHA = '508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d'
CORE_SHA = '9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf'
CANDIDATE_CORE_SHA = 'd83449b1cdf0ac717a98be9289caab03cb507324a696ef449e31369e28416639'
FNAME_EQUALITY = '??8FName@@QBEHABV0@@Z'
RANGES = [(0x106b9ee0, 67, '408b4a33858d3101bfee286f6b3266021f3d1e3e71da0d7ff0ad1be026a5fa0f'),
          (0x106b9f60, 118, '41b8f1ade3b0c4b99ee51acadbb386042d5bd43378ff27e188bff29f145c9b33')]


def _names(value):
    if not isinstance(value, (list, tuple)):
        raise ValueError('name sequence required')
    return list(value)


def first_interned_linkup(mesh_names, animation_names):
    """First equal native FName DWORD for each mesh bone; missing stays -1.

    No positional/parent fallback, duplicate removal, or bijection is added.
    Empty mesh/animation arrays are valid. The result is a fresh list.
    """
    mesh, animation = _names(mesh_names), _names(animation_names)
    if any(type(n) is not int or not 0 <= n <= 0xffffffff for n in mesh + animation):
        raise ValueError('unsigned 32-bit interned name identifiers required')
    first = {}
    for index, name in enumerate(animation):
        first.setdefault(name, index)
    return [first.get(name, -1) for name in mesh]


def decoded_name_linkup(mesh_names, animation_names):
    """Conservative decoded-name adapter, separate from FName interning.

    Admit repeated identical spellings, but reject distinct spellings sharing
    a casefold value. This avoids inventing the native loader's case/Unicode
    policy. Callers must establish the source names' original table identity;
    this helper does not certify arbitrary strings as native FNames.
    """
    mesh, animation = _names(mesh_names), _names(animation_names)
    spellings = {}
    for name in mesh + animation:
        if not isinstance(name, str) or not name or '\0' in name:
            raise ValueError('nonempty decoded names without NUL required')
        key = name.casefold()
        if key in spellings and spellings[key] != name:
            raise ValueError('ambiguous decoded FName spelling: ' + name)
        spellings[key] = name
    tokens = {name: index for index, name in enumerate(spellings.values())}
    return first_interned_linkup([tokens[n] for n in mesh], [tokens[n] for n in animation])


def synthetic_cases():
    """Authored identifiers; no original names or assets."""
    cases = [([1,2,3], [3,2,1]), ([7,8,7], [7,7,8]),
             ([1,2,3], []), ([1,4,2], [1,2]), ([0], [0,0])]
    rng = random.Random(0xB0AE)
    for _ in range(100):
        cases.append(([rng.randrange(20) for _ in range(rng.randrange(1,25))],
                      [rng.randrange(20) for _ in range(rng.randrange(25))]))
    return cases

ANCHORS = [
 (0x106ba212,'mov','eax, dword ptr [esi + 0x144]'),
 (0x106ba23b,'lea','edx, [eax + 0xc]'),(0x106ba271,'add','edi, 0x18'),
 (0x106b9f00,'mov','eax, dword ptr [edi + 0x20c]'),
 (0x106b9f68,'mov','dword ptr [ecx + ebp*4], 0xffffffff'),
 (0x106b9f74,'shl','ebp, 6'),(0x106b9f80,'mov','eax, dword ptr [ebx + 0x38]'),
 (0x106b9f87,'mov','ecx, dword ptr [edx + 0x208]'),
 (0x106b9f9a,'jne','0x106b9fa9'),(0x106b9f9f,'add','esi, 0xc'),
 (0x106b9fb8,'mov','dword ptr [ecx + edx*4], edi'),
 (0x106b9fcc,'mov','dword ptr [esp + 0x10], ebp'),
 (0x106e6cab,'lea','edx, [esi + 0x38]'),
 (0x106c3cc6,'push','0xc'),(0x106c3d62,'mov','eax, dword ptr [edi]'),
 (0x106b13df,'push','edi'),(0x106b13e6,'lea','eax, [edi + 4]'),
 (0x106b13f4,'add','edi, 8'),
 (0x106da3ff,'mov','edx, dword ptr [ebp + 0x144]'),
 (0x106da40d,'lea','ecx, [edx + ecx*8]'),
 (0x106da410,'mov','dword ptr [esp + 0x5c], ecx'),
 (0x106da54e,'mov','edi, dword ptr [esp + 0x5c]'),
 (0x106da5b0,'mov','eax, dword ptr [edi + 0xc]'),
 (0x106da5b7,'jl','0x106da774'),
 (0x106da600,'mov','eax, dword ptr [edx + ebx*4]'),
 (0x106da60d,'call','0x1030777f'),
 (0x106da774,'mov','eax, dword ptr [esp + 0x58]'),
 (0x106da77d,'add','ebx, 1')]


def evaluate_loop(program, mesh_names, animation_names):
 """Interpret this single retained integer loop; FName call uses the exact pinned DWORD equality body."""
 assert mesh_names
 sp,mesh,anim,array,items,mb,ab=0x9000,0x100000,0x200000,0x300000,0x400000,0x500000,0x600000
 regs={name:0 for name in ('eax','ebx','ecx','edx','esi','edi','ebp','esp')};regs.update(esp=sp,ebp=0,esi=array,ebx=anim);memory={sp+0x1c:mesh,sp+0x24:array,sp+0x10:0,sp+0x14:0,mesh+0x208:mb,mesh+0x20c:len(mesh_names),anim+0x38:ab,anim+0x3c:len(animation_names),array:items}
 memory.update({mb+i*64:n for i,n in enumerate(mesh_names)});memory.update({ab+i*12:n for i,n in enumerate(animation_names)})
 # Parent fields deliberately differ; no loop access should depend on them.
 memory.update({mb+i*64+0x34:999-i for i in range(len(mesh_names))});memory.update({ab+i*12+8:777-i for i in range(len(animation_names))})
 def address(s):
  body=s[s.index('[')+1:s.index(']')];total=0
  for term in body.split(' + '):
   parts=term.split('*');atom=parts[0];n=regs[atom] if atom in regs else int(atom,0);total+=n*(int(parts[1]) if len(parts)>1 else 1)
  return total
 def get(s):
  if '[' in s:return memory[address(s)]
  return regs[s] if s in regs else int(s,0)
 def put(s,v):
  if '[' in s:memory[address(s)]=v
  else:regs[s]=v
 pc=0x106b9f64;cmp=0;steps=0;calls=0
 for steps in range(1000000):
  if pc==0x106b9fd6:
   result=[memory[items+i*4] for i in range(len(mesh_names))]
   return [x if x!=0xffffffff else -1 for x in result],memory[sp+0x14],steps,calls
  if pc==0x106b9f92:
   # In thiscall ecx points mesh FName; explicit arg points animation FName.
   arg=memory[regs['esp']];regs['eax']=int(memory[regs['ecx']]==memory[arg]);regs['esp']+=4;calls+=1;pc+=6;continue
  ins=program[pc];op,args=ins.mnemonic,ins.op_str.split(', ');pc+=ins.size
  if op=='mov':put(args[0],get(args[1]))
  elif op=='xor':put(args[0],get(args[0])^get(args[1]))
  elif op=='add':put(args[0],get(args[0])+get(args[1]))
  elif op=='shl':put(args[0],get(args[0])<<get(args[1]))
  elif op=='lea':put(args[0],address(args[1]))
  elif op=='push':v=get(args[0]);regs['esp']-=4;memory[regs['esp']]=v
  elif op=='cmp':cmp=get(args[0])-get(args[1])
  elif op=='test':cmp=get(args[0])&get(args[1])
  elif op in ('jle','jl','jne','jmp'):
   if op=='jmp' or op=='jle' and cmp<=0 or op=='jl' and cmp<0 or op=='jne' and cmp!=0:pc=int(args[0],16)
  else:raise AssertionError((hex(ins.address),op,args))
 raise AssertionError('bounded loop cap')

def verify(comparison_engine=None):
    from check_tutorial_quest_native import Image, ENGINE_SHA
    from supplemental_pe import PEImage
    image = Image(ROOT/'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    core = PEImage(ROOT/'assets/interlude/system/Core.dll', CORE_SHA)
    read = lambda va, n: bytes(image.data[image.offset(va):image.offset(va)+n])
    def target(va):
        data = read(va, 5)
        assert data[0] in (0xe8, 0xe9)
        return va + 5 + struct.unpack('<i', data[1:])[0]
    assert image.exported('?ActualizeAnimLinkups@USkeletalMeshInstance@@UAEXXZ', True) == 0x106ba200
    assert target(0x106ba24f) == 0x10307784 and target(0x10307784) == 0x106b9ee0
    assert image.u32(image.exported('??_7USkeletalMeshInstance@@6B@')+0x94) == image.exported('?GetMesh@ULodMeshInstance@@UAEPAVUMesh@@XZ')
    assert image.exported('?Serialize@UMeshAnimation@@UAEXAAVFArchive@@@Z', True) == 0x106e6c30
    assert target(0x106e6cb0) == 0x10305330 and target(0x10305330) == 0x106c3ca0
    assert target(0x106c3d38) == 0x103075a9 and target(0x103075a9) == 0x106b13d0
    for anchor in ANCHORS:
        image.instruction(*anchor)
    for va, size, expected in RANGES:
        assert hashlib.sha256(read(va, size)).hexdigest() == expected
    for va in (0x106b9ef6, 0x106b9f0b, 0x106b9f92):
        assert read(va, 6) == b'\x90'*6
    assert core.u32(core.exports['??_7FArchive@@6B@']+0x1c) == core.exports['??6FArchive@@UAEAAV0@AAVFName@@@Z']
    va = core.body(FNAME_EQUALITY)
    assert va == 0x10109d40
    equality = core.read(va, 18)
    assert [(i.mnemonic, i.op_str) for i in image.dis.disasm(equality, va)] == [
        ('mov','eax, dword ptr [ecx]'), ('mov','edx, dword ptr [esp + 4]'),
        ('xor','ecx, ecx'), ('cmp','eax, dword ptr [edx]'), ('sete','cl'),
        ('mov','eax, ecx'), ('ret','4')]
    result = {'status':'owned-loop-verified-imports-erased', 'anchors':len(ANCHORS),
              'ownedEngineSHA256':image.sha, 'ownedCoreSHA256':core.sha,
              'ownedRanges':[{'VA':hex(a),'bytes':n,'SHA256':h} for a,n,h in RANGES],
              'erasedCalls':3, 'FNameEquality':{'symbol':FNAME_EQUALITY, 'VA':hex(va),
                  'bytes':18,'SHA256':hashlib.sha256(equality).hexdigest()},
              'limits':['No parent or positional repair; missing links stay -1.',
                        'Per-bone reference/cached pose fallback and hierarchy are separate.',
                        'Full builder logging-global addresses are not normalized or claimed matched.',
                        'Decoded-name convenience is not a general native FName interning proof.']}
    if comparison_engine is None:
        return result
    from check_supplemental_engine import compare_method
    candidate = PEImage(Path(comparison_engine), CANDIDATE_SHA)
    # Companion Core is necessary: the imported method must have the same body
    # as the owned Core proof, not merely the same exported symbol name.
    paths = [p for p in Path(comparison_engine).parent.iterdir() if p.name.casefold() == 'core.dll']
    if len(paths) != 1:
        raise ValueError('explicit supplemental Engine requires one sibling Core.dll')
    companion = PEImage(paths[0], CANDIDATE_CORE_SHA)
    assert companion.read(companion.body(FNAME_EQUALITY), 18) == equality
    comparisons = [compare_method(read(a,n), candidate.read(a-0x40,n), a,a-0x40,
        candidate.imported_call,read,candidate.read) for a,n,_ in RANGES]
    expected = ['?Empty@FArray@@QAEXHH@Z','?Add@FArray@@QAEHHH@Z',FNAME_EQUALITY]
    differences = [d for r in comparisons for d in r['differences']]
    assert [d['binding'] for d in differences] == [['core.dll', name] for name in expected]
    program = {i.address:i for i in image.dis.disasm(read(0x106b9f60,118),0x106b9f60)}
    cases = synthetic_cases()
    for mesh, anim in cases:
        output, count, _, _ = evaluate_loop(program, mesh, anim)
        assert output == first_interned_linkup(mesh, anim)
        assert count == sum(n >= 0 for n in output)
    result.update(status='supplemental-bounded-linkup-verified',
        supplementalEngineSHA256=candidate.sha,supplementalCoreSHA256=companion.sha,
        correspondence=comparisons,actualInstructionCases=len(cases),
        provenance='Unauthenticated supplemental archive; exact local block correspondence only.')
    return result


def audit_face():
    """Read the owned MFighter face/master source; no generated catalog oracle."""
    sys.path[:0] = [str(ROOT/'tools/dat'), str(ROOT/'tools/anim')]
    from build_hair import load_package, source_lod0
    from build_pawnanim import original_animation
    package, _ = load_package(str(ROOT/'assets/interlude/animations/Fighter.ukx'))
    def one(name, kind):
        rows = [e for e in package.exports if package.export_name(e) == name
                and not e.package_index and package.class_name_of(e) == kind]
        if len(rows) != 1:
            raise ValueError('missing/ambiguous original ' + name)
        return rows[0]
    face = source_lod0(package, one('MFighter_m000_f','SkeletalMesh'))
    animation_export = one('MFighter_anim','MeshAnimation')
    animation = original_animation(package, animation_export)
    mesh_names = [b['name'] for b in face['bones']]
    anim_names = [b['name'] for b in animation['bones']]
    for name in {n.casefold() for n in mesh_names + anim_names}:
        if sum(n.casefold() == name for n in package.names) != 1:
            raise ValueError('original package has ambiguous decoded name entries')
    token_mesh = [package.names.index(n) for n in mesh_names]
    token_anim = [package.names.index(n) for n in anim_names]
    link = first_interned_linkup(token_mesh, token_anim)
    assert link == decoded_name_linkup(mesh_names, anim_names)
    raw = package.data[animation_export.serial_offset:animation_export.serial_offset+animation_export.serial_size]
    return {'mesh':'Fighter.MFighter_m000_f', 'animation':'Fighter.MFighter_anim',
        'packageSHA256':hashlib.sha256((ROOT/'assets/interlude/animations/Fighter.ukx').read_bytes()).hexdigest(),
        'meshExportSHA256':face['sourceExportSHA256'], 'animationExportSHA256':hashlib.sha256(raw).hexdigest(),
        'meshBones':len(mesh_names),'animationBones':len(anim_names), 'matched':sum(n>=0 for n in link),
        'nonidentityLinks':[{'meshBone':i,'meshName':mesh_names[i],'animationBone':n}
                            for i,n in enumerate(link) if i!=n],
        'unusedAnimationBones':sorted(set(range(len(anim_names)))-set(link)),
        'decodedNameTableGate':'Every used casefold name has exactly one original package table entry.',
        'scope':'Specified original face master; not all appearance/equipment master selection.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='print compact proof status')
    parser.add_argument('--comparison-engine', type=Path, help='explicit pinned supplemental Engine; sibling Core.dll required')
    parser.add_argument('--audit-assets', action='store_true', help='fresh original MFighter face/animation mapping; requires supplemental proof')
    args = parser.parse_args()
    if args.audit_assets and not args.comparison_engine:
        parser.error('--audit-assets requires --comparison-engine to bind the erased name equality call')
    try:
        result = verify(args.comparison_engine)
        if args.audit_assets:
            result['faceMaster'] = audit_face()
        if args.check:
            print('Elbera Tools animation linkup: ' + result['status'] +
                '; %d anchors, 185 source bytes, %d instruction cases' %
                (result['anchors'], result.get('actualInstructionCases', 0)))
            if args.audit_assets:
                print('Original face master: %d/%d matched; missing links remain -1.' %
                      (result['faceMaster']['matched'], result['faceMaster']['meshBones']))
        else:
            print(json.dumps(result, indent=2))
    except (OSError, ValueError, AssertionError, ImportError) as error:
        parser.exit(1, 'Elbera Tools animation linkup failed: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
