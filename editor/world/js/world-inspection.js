import * as THREE from 'three';

// Inspection coordinates are measured audit locations, not game spawn rules.
const CHECKPOINTS = {
  'current': {label:'Current player (no staging)',position:null},
  'giran-border': { label: 'Giran tile border', position: [78400, 163712, -3320] },
  'giran-plaza': { label: 'Giran plaza', position: [82000, 148000, -3496] },
  // Audit at this XY: geodata Z -2256; extracted prop floor -2289; raw terrain
  // -3582.645. The old height repair raises terrain to -2160.614 over the prop.
  'giran-statue': { label: 'Giran prop terrain', position: [91264, 158464, -2256] },
};

export function getInspectionRequest(search) {
  const params = new URLSearchParams(search);
  if (params.get('dev') !== '1' || params.get('inspect') !== '1') return null;
  const key = params.get('checkpoint');
  const checkpoint = Object.hasOwn(CHECKPOINTS, key) ? key : 'giran-border';
  return { checkpoint, position: CHECKPOINTS[checkpoint].position ? [...CHECKPOINTS[checkpoint].position] : null,
    legacyStretch: params.get('edge') === 'legacy' };
}

// visit(request) stages the offline view; compare(boolean) switches the previous
// edge stretch, height repairs and unmasked terrain. The legacyStretch field and
// edge=legacy query remain stable. Neither callback runs on installation.
// readState(): { online, tile, xyz:[L2 X,Y,Z], groundZ, renderedZ,
//                nativeDiagonal?, sourceRules? }. Heights are in L2 units.
export function installWorldInspection({ visit, readState, compare, measure }) {
  let request = getInspectionRequest(location.search);
  if (!request) return null;
  const panel = document.createElement('section');
  panel.setAttribute('aria-label', 'World inspection');
  panel.style.cssText = 'position:fixed;top:64px;right:12px;z-index:10000;width:290px;max-width:calc(100vw - 48px);max-height:calc(100vh - 110px);overflow:auto;padding:14px;border:1px solid #87939b;border-radius:8px;background:#101923f5;color:#eef3f6;font:13px/1.4 system-ui;box-shadow:0 3px 18px #0008';
  const title = document.createElement('strong');
  title.textContent = 'Elbera Tools — World inspection';
  const controls = document.createElement('fieldset');
  controls.style.cssText = 'border:0;margin:10px 0;padding:0;display:grid;gap:9px';
  const label = document.createElement('label');
  label.textContent = 'Checkpoint ';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Inspection checkpoint');
  select.style.cssText = 'font:inherit;max-width:100%';
  for (const [key, value] of Object.entries(CHECKPOINTS)) {
    const option = document.createElement('option');
    option.value = key; option.textContent = value.label; select.append(option);
  }
  select.value = request.checkpoint;
  label.append(select);
  const reset = document.createElement('button');
  reset.type = 'button'; reset.textContent = 'Reset viewpoint';
  reset.style.cssText = 'font:inherit;padding:5px;cursor:pointer';
  const comparison = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox'; checkbox.checked = request.legacyStretch;
  comparison.append(checkbox, ' Previous terrain repairs');
  const note = document.createElement('p');
  note.style.cssText = 'margin:8px 0;color:#bdcbd7;font-size:12px';
  note.textContent = 'Implementation comparison, not an original-client reference. Viewpoint is for inspection.';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.style.cssText = 'margin:8px 0 0;white-space:pre-wrap;font-size:12px';
  const probe = document.createElement('button');
  probe.type='button';probe.textContent='Measure body and surface geometry';
  probe.style.cssText='font:inherit;padding:5px;cursor:pointer';
  const measurement=document.createElement('pre');
  measurement.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.4 monospace;max-height:230px;overflow:auto';
  probe.addEventListener('click',()=>{
    try { measurement.textContent=formatPlacementMeasurement(measure?.()); }
    catch(error){measurement.textContent=`Measurement unavailable: ${error.message}`;}
  });
  controls.append(label, reset, comparison);
  panel.append(title, controls, note, status, probe, measurement);
  const npcDetails = document.createElement('details'), npcSummary = document.createElement('summary');
  npcSummary.textContent = 'Live original NPC events';
  const npcReadout = document.createElement('pre');
  npcReadout.setAttribute('aria-label','Original NPC playback');
  npcReadout.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 monospace;max-height:220px;overflow:auto';
  const npcLimit = document.createElement('p');
  npcLimit.style.cssText='font-size:11px;color:#bdcbd7';
  npcLimit.textContent='Initial Gremlin/Fox waits only. Other transitions, native random history, placement and full rendering parity remain unresolved.';
  npcDetails.append(npcSummary,npcReadout,npcLimit); panel.append(npcDetails);
  document.body.append(panel);
  let pending = false, failure = '', disposed = false;
  const number = value => Number.isFinite(value) ? String(Math.round(value * 100) / 100) : 'unknown';
  function refresh() {
    if (disposed) return;
    const s = readState();
    controls.disabled = pending || !!s.online;
    panel.setAttribute('aria-busy', String(pending));
    const xyz = Array.isArray(s.xyz) ? s.xyz.map(number).join(', ') : 'unknown';
    const text = [s.online ? 'Online — offline controls disabled' : 'Offline inspection',
      `Tile: ${s.tile || 'loading'} · Position (L2): ${xyz}`,
      `Walking Z: ${number(s.groundZ)} · Surface estimate Z: ${number(s.renderedZ)}`,
      `Native diagonal: ${s.nativeDiagonal || 'unverified'}`,
      s.sourceRules, pending ? 'Loading viewpoint…' : '', failure].filter(Boolean).join('\n');
    if (status.textContent !== text) status.textContent = text;
    const npcText = (s.npcWait || []).map(row => `${row.npcId} · ${row.name}\n${row.status === 'ready'
      ? `${row.sequence} · frame ${number(row.frame)} · ${row.notifyCount} events`
      : `${row.status}: ${row.reason}${row.sequence ? `\nPrevious ${row.sequence} · ${row.notifyCount} events` : ''}`}\n${row.lastNotify ? `Last event ${row.lastNotify.index}: ${row.lastNotify.soundDecision?.status || 'null object'}` : ''}`)
      .join('\n\n') || 'No NPCs currently loaded.';
    if (npcReadout.textContent !== npcText) npcReadout.textContent = npcText;
  }
  async function run(action, restore) {
    if (pending || readState().online) { restore(); refresh(); return; }
    pending = true; failure = ''; refresh();
    try { await action(); }
    catch (error) { restore(); failure = `Inspection failed: ${error.message || error}`; }
    finally { pending = false; refresh(); }
  }
  function visitSelected() {
    const checkpoint = select.value;
    const next = { checkpoint, position: CHECKPOINTS[checkpoint].position ? [...CHECKPOINTS[checkpoint].position] : null,
      legacyStretch: request.legacyStretch };
    return run(async () => { await visit(next); request = next; },
      () => { select.value = request.checkpoint; });
  }
  select.addEventListener('change', visitSelected);
  reset.addEventListener('click', visitSelected);
  checkbox.addEventListener('change', () => {
    const enabled = checkbox.checked;
    run(async () => { await compare(enabled); request.legacyStretch = enabled; },
      () => { checkbox.checked = request.legacyStretch; });
  });
  const timer = setInterval(refresh, 500);
  refresh();
  return { refresh, destroy() { disposed = true; clearInterval(timer); panel.remove(); } };
}


function visible(object) {
  for(let current=object;current;current=current.parent)if(!current.visible)return false;
  return true;
}

// Match Mesh triangle submission (single material or explicit material groups)
// rather than treating unused/hidden buffer vertices as part of the body.
function bodyVertexIndices(mesh) {
  const geometry=mesh.geometry, index=geometry.index;
  const count=index?.count ?? geometry.attributes.position.count;
  const draw=geometry.drawRange;
  const groups=Array.isArray(mesh.material) ? geometry.groups : [{start:0,count,materialIndex:0}];
  const materials=Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const vertices=new Set();
  for(const group of groups) {
    if(!materials[group.materialIndex]?.visible)continue;
    const start=Math.max(0,draw.start,group.start);
    const end=Math.min(count,draw.start+draw.count,group.start+group.count);
    const triangleEnd=start+Math.floor((end-start)/3)*3;
    for(let slot=start;slot<triangleEnd;slot++)vertices.add(index ? index.getX(slot) : slot);
  }
  return vertices;
}

/** Measure current browser geometry only, on demand. This does not choose a
 * native ground or modify any game state. Material transparency/native
 * collision flags are separate from geometric intersections. */
export function measureWorldPlacement({character,terrain}) {
  if(!character?.model || !terrain?.group)return {status:'unavailable'};
  character.group.updateWorldMatrix(true,false);
  // SkinnedMesh.updateMatrixWorld also refreshes the attached bind inverse;
  // updateWorldMatrix alone would count a moved parent's translation twice.
  character.group.updateMatrixWorld(true);
  terrain.group.updateWorldMatrix(true,true);
  const point=new THREE.Vector3();let low=null,vertices=0;
  character.model.traverse(mesh=>{
    if(!mesh.isSkinnedMesh || !visible(mesh) || !mesh.geometry?.attributes.position)return;
    mesh.skeleton.update();
    for(const index of bodyVertexIndices(mesh)) {
      mesh.getVertexPosition(index,point);point.applyMatrix4(mesh.matrixWorld);vertices++;
      if(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z) && (!low || point.y<low.point.y))
        low={point:point.clone(),mesh:mesh.name,vertex:index};
    }
  });
  if(!low)return {status:'unavailable',reason:'no-visible-skinned-body'};
  const candidates=[];
  terrain.group.traverse(mesh=>{if(mesh.isMesh && visible(mesh))candidates.push(mesh);});
  const box=new THREE.Box3().setFromObject(terrain.group);
  if(box.isEmpty())return {status:'unavailable',reason:'no-terrain-geometry'};
  const ray=new THREE.Raycaster(new THREE.Vector3(0,box.max.y+1,0),new THREE.Vector3(0,-1,0),0,box.max.y-box.min.y+2);
  const normalMatrix=new THREE.Matrix3(),worldMatrix=new THREE.Matrix4(),instanceMatrix=new THREE.Matrix4();
  const intersections=(x,z,referenceY)=>{
    ray.ray.origin.x=x;ray.ray.origin.z=z;
    const hits=[];
    for(const hit of ray.intersectObjects(candidates,false)) {
      const materials=[hit.object.material].flat();
      const material=materials[hit.face?.materialIndex || 0];
      if(material?.visible===false || !hit.face)continue;
      worldMatrix.copy(hit.object.matrixWorld);
      if(hit.instanceId!=null){hit.object.getMatrixAt(hit.instanceId,instanceMatrix);worldMatrix.multiply(instanceMatrix);}
      normalMatrix.getNormalMatrix(worldMatrix);
      const normal=hit.face.normal.clone().applyNormalMatrix(normalMatrix);
      if(!(normal.y>0))continue;
      const y=hit.point.y;
      if(hits.some(row=>Math.abs(row.z-y*100)<1e-5 && row.objectId===hit.object.id && row.instanceId===hit.instanceId))continue;
      hits.push({mesh:hit.object.name||hit.object.type,objectId:hit.object.id,instanceId:hit.instanceId,z:y*100,normalY:normal.y,
        material:material?.name||null,transparent:!!material?.transparent});
    }
    return hits.sort((a,b)=>Math.abs(a.z-referenceY*100)-Math.abs(b.z-referenceY*100)).slice(0,6);
  };
  const origin=character.group.getWorldPosition(new THREE.Vector3());
  const beneathBody=intersections(low.point.x,low.point.z,low.point.y);
  const beneathOrigin=intersections(origin.x,origin.z,origin.y);
  const l2=p=>[p.x*100,-p.z*100,p.y*100];
  return {status:'measured',tile:terrain.def?.tile,model:character.modelId,clip:character.current?.getClip().name,
    origin:l2(origin),low:{position:l2(low.point),mesh:low.mesh,vertex:low.vertex},vertices,
    originSurfaces:beneathOrigin,bodySurfaces:beneathBody,
    clearance: beneathBody.length?low.point.y*100-beneathBody[0].z:null,
    limits:'Current browser skinning and visible-mesh geometry; not original collision or native placement proof.'};
}

export function formatPlacementMeasurement(report) {
  if(report?.status!=='measured')return 'No loaded body or terrain to measure.';
  const n=v=>Number.isFinite(v)?v.toFixed(4):'unknown';
  const hits=rows=>rows.length?rows.map(row=>`${n(row.z)} (${row.mesh}${row.transparent?', transparent':''})`).join('\n'):'none';
  return [`${report.model} · ${report.clip}`,
    `Origin Z: ${n(report.origin[2])} L2`,
    `Lowest body vertex: ${report.low.position.map(n).join(', ')} L2`,
    `Body mesh: ${report.low.mesh} · ${report.vertices} vertices sampled`,
    `Nearest upward mesh intersections at origin:\n${hits(report.originSurfaces)}`,
    `At lowest body vertex:\n${hits(report.bodySurfaces)}`,
    `Body − nearest mesh: ${n(report.clearance)} L2`,report.limits].join('\n');
}
