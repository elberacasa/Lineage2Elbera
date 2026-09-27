// Elbera Tools: measure actual browser geometry; fixtures are not game values.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const THREE=await import('../vendor/three.module.min.js');
const source=fs.readFileSync(new URL('../js/world-inspection.js',import.meta.url),'utf8');
const {measureWorldPlacement,getInspectionRequest,formatPlacementMeasurement}=vm.runInNewContext(
  source.replace(/^import .*;$/gm,'').replace(/^export /gm,'')+
  '\n({measureWorldPlacement,getInspectionRequest,formatPlacementMeasurement})',{THREE,URLSearchParams});
function fixture() {
  const group=new THREE.Group(),model=new THREE.Group();group.add(model);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([2,0,0, 2,1,0, 3,1,0],3));
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Array(12).fill(0),4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4));
  const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial());mesh.name='body';
  const bone=new THREE.Bone();mesh.add(bone);mesh.bind(new THREE.Skeleton([bone]));model.add(mesh);
  const terrain={group:new THREE.Group(),def:{tile:'fixture'}};
  const character={group,model,modelId:'fixture',current:{getClip:()=>({name:'fixture-pose'})}};
  function floor(x,y,width=1) {
    const p=new THREE.Mesh(new THREE.PlaneGeometry(width,width),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
    p.rotation.x=-Math.PI/2;p.position.set(x,y,0);p.name=`floor:${x},${y}`;terrain.group.add(p);return p;
  }
  return {character,terrain,bone,mesh,floor};
}
test('current-player inspection requires explicit dev opt-in and has no staging position',()=>{
  assert.equal(getInspectionRequest('?inspect=1&checkpoint=current'),null);
  const r=getInspectionRequest('?dev=1&inspect=1&checkpoint=current');
  assert.equal(r.position,null);assert.equal(r.checkpoint,'current');
  assert.match(formatPlacementMeasurement(null),/No loaded body/);
});
test('measures live skeletal deformation at body and origin separately without relocation',()=>{
  const h=fixture();h.bone.position.y=3;h.floor(0,1);h.floor(2,2);
  const before=h.character.group.matrix.toArray(),r=measureWorldPlacement(h);
  assert.equal(r.status,'measured');assert.equal(r.low.position[2],300);assert.equal(r.vertices,3);
  assert.equal(r.originSurfaces[0].z,100);assert.equal(r.bodySurfaces[0].z,200);assert.equal(r.clearance,100);
  assert.deepEqual(h.character.group.matrix.toArray(),before);assert.equal(h.bone.position.y,3);
  h.bone.position.y=1.5;assert.equal(measureWorldPlacement(h).clearance,-50,'penetration is not clamped away');
});
test('ignores hidden ancestors, invisible materials and downward faces; marks transparent surfaces',()=>{
  const h=fixture();h.bone.position.y=3;h.floor(2,0);
  const hidden=h.floor(2,2.9),parent=new THREE.Group();h.terrain.group.add(parent);parent.add(hidden);parent.visible=false;
  h.floor(2,2.8).material.visible=false;
  h.floor(2,2.7).rotation.x=Math.PI/2;
  h.floor(2,2.6).material.transparent=true;
  const r=measureWorldPlacement(h);assert.equal(r.bodySurfaces.length,2);
  assert.equal(r.bodySurfaces[0].z,260);assert.equal(r.bodySurfaces[0].transparent,true);
  h.character.model.visible=false;assert.equal(measureWorldPlacement(h).status,'unavailable');
});
test('uses world actor origin and instance transforms for actual surface intersections',()=>{
  const h=fixture(),parent=new THREE.Group();parent.position.y=4;parent.add(h.character.group);
  h.bone.position.y=3;
  const p=new THREE.InstancedMesh(new THREE.PlaneGeometry(8,8),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),1);
  const m=new THREE.Matrix4().makeRotationX(-Math.PI/2);m.setPosition(0,5,0);p.setMatrixAt(0,m);h.terrain.group.add(p);
  const r=measureWorldPlacement(h);assert.equal(r.origin[2],400);assert.equal(r.low.position[2],700);
  assert.equal(r.bodySurfaces[0].z,500);assert.equal(r.clearance,200);assert.equal(r.bodySurfaces[0].instanceId,0);
});
test('missing body, ground and overlapping same-height distinct meshes remain explicit',()=>{
  assert.equal(measureWorldPlacement({}).status,'unavailable');
  const h=fixture();assert.equal(measureWorldPlacement(h).reason,'no-terrain-geometry');
  h.floor(20,0);assert.equal(measureWorldPlacement(h).clearance,null);
  h.floor(2,0).name='';h.floor(2,0).name='';assert.equal(measureWorldPlacement(h).bodySurfaces.length,2);
});

test('unused vertices, invisible body materials, draw ranges and material groups do not falsify clearance',()=>{
  const h=fixture(),g=h.mesh.geometry;h.floor(2,0);
  g.setAttribute('position',new THREE.Float32BufferAttribute([2,0,0,2,1,0,3,1,0, 2,-100,0],3));
  g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Array(16).fill(0),4));
  g.setAttribute('skinWeight',new THREE.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],4));
  g.setIndex([0,1,2]);
  assert.equal(measureWorldPlacement(h).clearance,0,'unreferenced outlier is not rendered');
  assert.equal(measureWorldPlacement(h).vertices,3);
  h.mesh.material.visible=false;assert.equal(measureWorldPlacement(h).status,'unavailable');
  h.mesh.material.visible=true;g.setIndex([0,1,2,3,1,2]);g.setDrawRange(0,3);
  assert.equal(measureWorldPlacement(h).clearance,0,'second triangle is outside draw range');
  g.setDrawRange(0,Infinity);
  h.mesh.material=[h.mesh.material,new THREE.MeshBasicMaterial({visible:false})];
  g.addGroup(0,3,0);g.addGroup(3,3,1);
  assert.equal(measureWorldPlacement(h).clearance,0,'second material group is invisible');
  h.mesh.material[1].visible=true;assert.equal(measureWorldPlacement(h).clearance,-10000);
  g.clearGroups();assert.equal(measureWorldPlacement(h).status,'unavailable','material arrays require submitted groups');
});
