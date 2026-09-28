"""Elbera Tools: actual-browser bridges for authored cache and matrix fixtures.

The matching expected values come from retained instructions in the verifier.
No recovered assets or original bytes are embedded here.
"""

SCRIPT = r"""
import fs from 'node:fs';
const {traceCachedStaticMeshCollision,bindStaticMeshCacheEntry,inspectStaticMeshCache}=await import(process.argv[1]);
const {prepareStaticMeshTree}=await import(new URL('./static-mesh-tree.js',process.argv[1]));
const decode=a=>Array.isArray(a)?a.map(decode):a&&typeof a==='object'?Object.fromEntries(Object.entries(a).map(([k,v])=>[k,decode(v)])):typeof a==='string'&&/^[0-9a-f]{8}$/.test(a)?Buffer.from(a,'hex').readFloatLE():a;
const bits=v=>{const b=Buffer.alloc(4);b.writeFloatLE(v);return b.toString('hex');};
const ready=r=>{if(r.status!=='ready')throw Error(JSON.stringify(r));return r;};
const outputs=JSON.parse(fs.readFileSync(0,'utf8')).map(decode).map(row=>{
 const {a,mode,oldCache,ownerIndex,meshIndex,matrices}=row;
 let entry=mode==='miss'?null:{},token={},active=0;const events=[];
 if(entry)ready(bindStaticMeshCacheEntry(entry,{ownerIdentity:mode==='wrong-owner'?'old-owner':'owner',meshIdentity:mode==='wrong-mesh'?'old-mesh':'mesh',cache:oldCache}));
 const provider={
  get(key,align){events.push(['get',key.low,key.high,align]);if(entry)active++;return {status:'ready',entry,token};},
  create(key,bytes,align,extra){events.push(['create',bytes,align,extra]);entry={};active++;return {status:'ready',entry,token};},
  unlock(){if(active!==1)throw Error('unbalanced source lock');active--;events.push(['unlock']);return {status:'ready'};},
  flush(key,mask,ignore){if(active)throw Error('flush while locked');events.push(['flush',mask,ignore]);return {status:'ready'};},
 };
 const methods={
  ownerVTableAC(slot){const value=a.methods.ownerMaterials[slot];events.push(['ownerMaterial',slot,value]);return {status:'ready',value:value||null};},
  defaultMaterial(){events.push(['defaultMaterial']);return {status:'ready',value:a.methods.defaultMaterial||null};},
  ownerVTable124(){events.push(['ownerMethod124',a.methods.ownerMethod124]);return {status:'ready',value:a.methods.ownerMethod124||null};},
 };
 const r=ready(traceCachedStaticMeshCollision(ready(prepareStaticMeshTree(a.mesh)).model,{...a,arithmeticProfile:'pc53-rne-math-sqrt',ownerFlags2f8:0,collisionModel:null,ownerIdentity:'owner',meshIdentity:'mesh',ownerCacheIndex:ownerIndex,meshCacheIndex:meshIndex,provider,methods,readTransforms(){events.push(['matrices']);return {status:'ready',...matrices};},meshMaterials:a.meshMaterials.map(v=>v||null),inspect:true}));
 if(active)throw Error('leaked source lock');
 const state=ready(inspectStaticMeshCache(entry)).cache;
 const cache={worldToLocal:state.worldToLocal.map(bits),localToWorld:state.localToWorld.map(bits),determinant:bits(state.determinant),queryTag:state.queryTag,planes:state.planes.map(p=>({...p,...(p.plane?{plane:p.plane.map(bits)}:{})})),vertices:state.vertices.map(p=>({...p,...(p.point?{point:p.point.map(bits)}:{})}))};
 const result={time:bits(r.writes.result.time)};
 if(r.blocked){if(r.writes.result.actor!=='owner'||r.writes.result.item!=='mesh')throw Error('identity mismatch');Object.assign(result,{point:r.writes.result.point.map(bits),normal:r.writes.result.normal.map(bits),triangleIndex:r.writes.result.triangleIndex,material:r.writes.result.material??0});}
 return {blocked:Number(r.blocked),cacheDisposition:r.cacheDisposition,result,cache,events,visitedNodes:r.inspection.visitedNodes,triangleTests:r.inspection.triangleTests,objectFields:r.writes.objectFields.map(w=>[w.object,w.value])};
});process.stdout.write(JSON.stringify(outputs));
"""

DETERMINANT_SCRIPT = """import fs from 'node:fs'; const {originalMatrixDeterminant}=await import(process.argv[1]); const out=JSON.parse(fs.readFileSync(0,'utf8')).map(row=>{ const r=originalMatrixDeterminant({arithmeticProfile:'pc53-rne',matrix:row.map(h=>Buffer.from(h,'hex').readFloatLE())}); if(r.status!=='ready')throw Error(JSON.stringify(r)); const b=Buffer.alloc(4);b.writeFloatLE(r.determinant);return b.toString('hex');});process.stdout.write(JSON.stringify(out));"""
