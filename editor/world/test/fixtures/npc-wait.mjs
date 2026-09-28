// Elbera Tools: authored synthetic NPC wait packet/source/state fixtures.
// Fingerprints identify the bounded admission profile; no original assets are included.
import {NPC_WAIT_SOURCES,planInitialNpcWait} from '../../js/npcwaitanim.js';
const f=Math.fround;
export const freeze=value=>{
  if (value && typeof value==='object') {Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
};
const copy=value=>structuredClone(value);
export const profiles={
  20001:{name:'gremlin',mesh:'gremlin_m00',animation:'gremlin_anim',atkwait:41,
    meshHash:'8c302df3acd9879591b6b7b268a8fbda4127ee39e2d6a6c9ef0cc7b78fc6dc98',
    animationHash:'e673bb720d186514c483b0538087b9f1da62c8fe1c3d4fd03276b1918156020c'},
  20091:{name:'fox',mesh:'Fox_m00',animation:'Fox_anim',atkwait:31,
    meshHash:'a58417c328da0c45095cccbc52b3d2d5c427d490681cdbc20501377c11769176',
    animationHash:'c6c8d78a20c6d21401bcb241e4b8208e12ceda579dbfbf7c432f622eb48f3a25'},
};
profiles[18342]=profiles[20001];
export function fixture(npcId=20001) {
  const p=profiles[npcId],modelId='npc_'+'a'.repeat(32),className='LineageMonster.'+p.name;
  const meshRef='LineageMonsters.'+p.mesh,animationRef='LineageMonsters.'+p.animation;
  const fingerprints={meshExportSHA256:p.meshHash,animationExportSHA256:p.animationHash,
    meshPackageSHA256:NPC_WAIT_SOURCES['animations/LineageMonsters.ukx'],
    animationPackageSHA256:NPC_WAIT_SOURCES['animations/LineageMonsters.ukx']};
  const selector=(name,frames)=>({'0':{declaredBy:className.toLowerCase(),frames,rate:30,
    status:'source-sequence',sequence:name,value:name.toLowerCase()}});
  const sequence=(name,frames)=>({name,frames,rate:30,source:{SHA256:'b'.repeat(64)},
    movement:{flags:0,startBone:0},notifies:[]});
  const source={record:{npcId,modelId,npc:{modelId,className,meshRef,animationRef,
    inheritance:[className.toLowerCase(),'lineagewarrior.lineagepawn','engine.pawn','engine.actor','core.object'],
    selectors:{WaitAnimName:selector('Wait',61),AtkWaitAnimName:selector('atkwait',p.atkwait)}},
    model:{meshRef,animationRef,source:copy(fingerprints)}},
    catalog:{format:'elbera-original-animation-tracks-v1',modelId,meshRef,animationRef,
      source:{exportSHA256:p.animationHash,packageSHA256:fingerprints.animationPackageSHA256,
        notifyClassPackage:{SHA256:NPC_WAIT_SOURCES['system/Engine.u']}},
      sequences:[sequence('Wait',61),sequence('atkwait',p.atkwait)]},
    skeleton:{format:'elbera-original-npc-skeleton-v1',source:copy(fingerprints)}};
  const raw={npcId,waitType:1,dead:false,combat:0,running:1,rhand:0,chest:0,lhand:0,
    speedMul:1.123456789,summonAnimationRaw:2,
    npcInfoTail:{prefix:[0,0,0],extension:{dwords:[0,0,0,0,0],bytes:[0,0],doubles:[0,0],finalDwords:[0,0]}}};
  const startup={userItemBankMode:0,userFallbackItem:0,curWeaponType:0,lobby:false,ride:false,
    fishing:false,abnormalStates:[],swimWait:'None',swimAttackWait:'None',damageAct:false,
    spineRotation:false,channelCount:1,channelBaseBone:0,channelSpecialMode:0,
    channelNotifyDisabled:0,rootLock:0,referenceOverride:0,modifierCounts:[0,0,0,0]};
  const sources={...NPC_WAIT_SOURCES};
  return {raw,source,startup,sources,plan(){return planInitialNpcWait(freeze(raw),source,startup,sources);}};
}
export const sound=(t,ref=1)=>({t:f(t),objectRef:ref,function:'None',isAttackShot:false,isBoneScale:false,
  classPath:ref?'Engine.AnimNotify_Sound':null,isSound:ref!==0,
  sound:ref?'Synthetic.Bank.Sound':null,soundInfo:ref?{status:'source-direct',random:30,volume:250,radius:50}:null});
