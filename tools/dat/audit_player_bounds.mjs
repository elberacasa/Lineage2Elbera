// Elbera Tools geometry-only helper for audit_player_transforms.py.
// Requires private built models in editor/characters/. No browser/network,
// account or original executable is used. Emits private measurements to stdout;
// does not write models. --poses also measures source-key pose bounds through
// the current browser adaptation. Neither mode proves native placement.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from '../../editor/world/vendor/three.module.min.js';
import { playerVisualScale } from '../../editor/world/js/player-transform.js';

const base = new URL('../../editor/world/vendor/', import.meta.url);
const three = new URL('three.module.min.js', base).href;
const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const utils = data((await readFile(new URL('addons/utils/BufferGeometryUtils.js', base), 'utf8'))
  .replace("from 'three'", `from '${three}'`));
const loader = data((await readFile(new URL('addons/loaders/GLTFLoader.js', base), 'utf8'))
  .replace("from 'three'", `from '${three}'`)
  .replace("from '../utils/BufferGeometryUtils.js'", `from '${utils}'`));
const { GLTFLoader } = await import(loader);
globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, fields) { this.type = type; Object.assign(this, fields); }
};
const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('editor/characters/manifest.json', root), 'utf8'));
const inspectPoses = process.argv.includes('--poses');
const pawn = inspectPoses ? JSON.parse(await readFile(new URL('editor/characters/pawnanim.json', root), 'utf8')) : null;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const result = [];
for (const entry of manifest.models) {
  const file = new URL('editor/characters/' + entry.gltf, root);
  const bytes = await readFile(file);
  const gltf = JSON.parse(bytes);
  const buffers = [];
  for (const buffer of gltf.buffers) {
    const bytes = await readFile(new URL(buffer.uri, file));
    buffers.push({ uri: buffer.uri, sha256: hash(bytes), byteLength: bytes.length });
    buffer.uri = 'data:application/octet-stream;base64,' + bytes.toString('base64');
  }
  // Remove only material/image dependencies in this in-memory copy. Every
  // geometry, node, skin and animation field passes through the real loader.
  delete gltf.images; delete gltf.textures; delete gltf.materials;
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  const loaded = await new GLTFLoader().parseAsync(JSON.stringify(gltf), '');
  const box = new THREE.Box3().setFromObject(loaded.scene);
  const size = box.getSize(new THREE.Vector3());
  if (!Number.isFinite(entry.nativeHeight) || entry.nativeHeight <= 0 || !Number.isFinite(size.y) || size.y <= 0)
    throw new Error(`Missing nativeHeight or invalid loaded bounds for ${entry.id}`);
  const legacyHeightFitScale = entry.nativeHeight * 0.01 / size.y;
  const scale = playerVisualScale(entry.visualScale, {modelId:entry.id,gltf:entry.gltf});
  if (!scale) throw new Error(`Missing verified scale for ${entry.id}`);
  loaded.scene.scale.set(scale.x,scale.y,scale.z);
  const scaled = new THREE.Box3().setFromObject(loaded.scene);
  const center = scaled.getCenter(new THREE.Vector3());
  const measured = { id: entry.id, gltf: entry.gltf, gltfSHA256: hash(bytes), buffers,
    nativeHeight: entry.nativeHeight, loadedBindMin: box.min.toArray(), loadedBindMax: box.max.toArray(),
    runtimeScale: [scale.x,scale.y,scale.z], legacyHeightFitScale,
    currentRecenterL2: [-center.x * 100, -scaled.min.y * 100, -center.z * 100] };
  if (inspectPoses) {
    // Measure the current browser adaptation, never infer a native correction
    // from its extrema. Refresh skinned bounds after each actual sampled pose.
    loaded.scene.position.set(-center.x,-scaled.min.y,-center.z);
    const mixer=new THREE.AnimationMixer(loaded.scene);
    measured.poses=[];
    for (const name of ['idle','sitDown','sit','standUp']) {
      const clip=loaded.animations.find(c=>c.name===name), source=pawn.clips?.[entry.id]?.[name];
      if (!clip || !source?.originalTiming) throw new Error(`Missing source pose clip: ${entry.id}/${name}`);
      for (const frame of [...new Set([0,source.frames-1])]) {
        mixer.stopAllAction();
        const action=mixer.clipAction(clip);action.reset().setLoop(THREE.LoopOnce,1).play();
        action.clampWhenFinished=true;action.time=Math.fround(frame/source.rate);mixer.update(0);
        loaded.scene.updateMatrixWorld(true);
        const bones=[];
        loaded.scene.traverse(o=>{
          if(o.isSkinnedMesh){o.skeleton.update();o.computeBoundingBox();}
          if(o.isBone && /^(bip01|bip01[ _]pelvis|bip01[ _][lr][ _](foot|calf|toe0))$/i.test(o.name))
            bones.push({name:o.name,position:o.getWorldPosition(new THREE.Vector3()).toArray()});
        });
        const posed=new THREE.Box3().setFromObject(loaded.scene);
        measured.poses.push({clip:name,sequence:source.seq,frame,time:action.time,
          min:posed.min.toArray(),max:posed.max.toArray(),bones});
      }
    }
    mixer.stopAllAction();mixer.uncacheRoot(loaded.scene);
  }
  result.push(measured);
}
console.log(JSON.stringify(result));
