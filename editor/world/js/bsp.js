// BSP buildings: loads assets/world/<tile>/bsp.gltf, the decoded UE2 level
// BSP of the map tile (every town building shell, wall, floor, stair and
// interior; static meshes are the decoration ON these shells, not the
// shells themselves). Written by tools/world/bsp.py — contract in
// tools/world/README.md, format lore in tools/l2lib/ue2package.py.
//
// COORDINATES. bsp.gltf carries raw L2 world units, Z-up, exactly like
// scene.json props — "UE2 units = glTF units, handedness conversion is the
// client's job". The conversion is the one in coords.js,
// (x, y, z)_L2 -> (x, z, -y)_three at 1 unit = 1 cm, expressed once as a
// group transform:
//     rotation.x = -PI/2   maps (x, y, z) -> (x, z, -y)
//     scale      =  0.01   L2 cm -> m
// That matrix has positive determinant (it is a rotation), so the CCW
// winding baked by the converter stays CCW and front faces stay front.
// NOTHING is translated — the level BSP is already world-placed, and a
// nudge here would be hiding a converter bug.
//
// CULLING. One glTF node per spatial chunk (the converter buckets nodes on
// a 48 m grid, the same size as the client's prop clusters), so the chunks
// toggle under the same draw distance as the props — see
// Terrain.setPropDrawDistance.
//
// LIGHTING. The retail BSP is not lit by a dynamic light at all. Every drawn
// node either carries a BAKED LIGHTMAP or its surface carries PF_UNLIT — over
// the 18,656 drawn nodes of 22_22, 17_25, 20_21, 20_16, 24_20 and 23_18 there
// is not one exception (tools/world/bsp.py collect(), which raises if that
// ever stops holding). So this file gives the BSP an UNLIT material:
//   * lightmapped surface -> MeshBasicMaterial, map x lightMap on UV set 1;
//     the lightmap is the retail 512x512 DXT1 atlas sheet decoded by
//     tools/world/bsplight.py, and the UVs come out of the retail render
//     vertices, so neither the texels nor the mapping is reconstructed here.
//   * PF_UNLIT surface -> MeshBasicMaterial, map only (retail fullbright).
// The sun/ambient rig in worldlight.js keeps lighting the PROPS, which is
// where retail uses it.
//
// THE BLEND IS 2X, AND THAT COMES OUT OF THE CLIENT. Engine.dll is
// Themida-packed, but D3DDrv.dll is NOT, and it carries its pixel shaders
// as plain source. All three of its lighting shaders end the same way:
//     mul_x2 r0, r0, v0
//     // r0 = r0 * lighting
// i.e. this renderer's own definition of "surface colour times lighting"
// is a MODULATE-2X, which is why the modulate here is 2x and not 1x (see
// LIGHTMAP_MODULATE, and LIGHTMAP_INTENSITY for what 2x becomes once the
// client's own sRGB pipeline is accounted for).
// Scope of that evidence, stated so nobody over-reads it: those three are
// the TERRAIN shaders (weightmap layers x vertex lighting). No shader for
// the BSP lightmap pass survives in the binary — that path is fixed
// function — so this is the engine's own convention carried across to the
// BSP, not a direct read of the BSP pass. `?lmi=<float>` overrides it.
// The atlas argues the same way: its texels reach 255 (247 on 17_25, 255
// on 20_21), so the range is not pre-halved, and Giran's most common texel
// is 48..63 of 255, which at 1x would render the plaza at a quarter
// brightness.
//
// WHICH of the (up to 8) colour variants of a sheet this draws, and why.
// Variant 0 — and that is now a measurement, not the arbitrary pick this
// comment used to describe ("it is the first in the retail array").
// Each atlas page carries an i32 Header[3]. Over all 96 tiles that hold
// lightmap records, the Header[0] of page 0 of each sheet forms ONE strict
// arithmetic run of step 512 in sheet order (96/96), and all 777 of the
// other pages fall OUTSIDE the range that run spans (777 outside, 0
// inside). So the .unr holds one primary lightmap texture per sheet,
// contiguous and in sheet order, plus a separate block of seven alternates
// per 8-page sheet. Variant 0 is the sheet's entry in that primary array;
// 1..7 are not in it at all.
// What is STILL unsourced is what would SELECT an alternate at runtime.
// tools/world/bsplight.py KNOWN GAPS 1 lists what was checked and came up
// empty (the tile's NMovableSunLight / NSun / NMoon / SkyZoneInfo /
// LevelInfo properties, every readable client binary and script package,
// and the "1-variant sheets are the sunless ones" idea, which the shared
// materials refute). `bsplight.py --check` fails if the primary-array
// property above ever stops holding, i.e. if this default loses its
// evidence. `?lm=<0..7>` picks another and `?lm=off` drops the lightmaps
// entirely (that is how the before/after shots are taken from one build).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { L2_TO_M } from './coords.js';

// `?lm=off` | `?lm=<0..7>` -> null (no lightmaps) | variant index
function lightmapVariant() {
  const q = new URLSearchParams(location.search).get('lm');
  if (q === 'off') return null;
  const n = Number.parseInt(q ?? '', 10);
  return Number.isInteger(n) && n >= 0 && n <= 7 ? n : 0;
}

// Retail's modulate factor, from D3DDrv.dll's own `mul_x2 ... // r0 = r0 *
// lighting` (see the header).
const LIGHTMAP_MODULATE = 2.0;

// ...expressed in THIS renderer's space. Retail multiplied 8-bit framebuffer
// values, i.e. in gamma space; main.js runs three with
// outputColorSpace = SRGBColorSpace, so the multiply happens on LINEAR
// values and the lightmap texture is sRGB-decoded before it is used.
// Scaling an encoded value by k is scaling the linear value by k^gamma, so
// retail's 2x becomes 2^2.2 here. 2.2 is the sRGB transfer exponent the
// same renderer applies to every other texture in this client, not a
// number picked to taste.
const SRGB_GAMMA = 2.2;
const LIGHTMAP_INTENSITY = Math.pow(LIGHTMAP_MODULATE, SRGB_GAMMA);

function lightmapIntensity() {
  const q = Number.parseFloat(
    new URLSearchParams(location.search).get('lmi') ?? '');
  return Number.isFinite(q) && q >= 0 ? q : LIGHTMAP_INTENSITY;
}

export class Bsp {
  constructor(gltfScene, lightmaps = new Map()) {
    this.lightmaps = lightmaps;
    this.group = new THREE.Group();
    this.group.name = 'bsp';
    this.group.rotation.x = -Math.PI / 2;
    this.group.scale.setScalar(L2_TO_M);
    this.group.add(gltfScene);
    this.chunks = [];       // { object, center (three world), visible }
    this.triangles = 0;
    // bbox in RAW L2 world units (the glTF nodes carry no transform of
    // their own, so geometry space is L2 world space). Verification reads
    // this to prove the BSP landed in its own tile — see verify_bsp.js.
    this.boundsL2 = new THREE.Box3();

    gltfScene.updateMatrixWorld(true);
    this.group.updateMatrixWorld(true);
    // GLTFLoader hands the SAME material instance to every primitive that
    // uses a given glTF material, so the swap below is memoised: without
    // this, 22_22's 52 materials would become 130 (one per primitive) and
    // the shared source material would be disposed once per primitive.
    const swapped = new Map();
    for (const child of gltfScene.children) {
      const center = new THREE.Vector3();
      let n = 0;
      child.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.material = Bsp._prepMaterial(o.material, lightmaps, swapped);
        o.geometry.computeBoundingSphere();
        o.geometry.computeBoundingBox();
        this.boundsL2.union(o.geometry.boundingBox);
        center.add(o.geometry.boundingSphere.center.clone()
          .applyMatrix4(o.matrixWorld));
        n++;
        const idx = o.geometry.index;
        this.triangles +=
          (idx ? idx.count : o.geometry.attributes.position.count) / 3;
      });
      if (n) {
        this.chunks.push({ object: child, center: center.divideScalar(n),
                           visible: true });
      }
    }
  }

  // The converter marks alpha-cutout surfaces alphaMode MASK already; the
  // rest is the same treatment the props get (doubleSided is baked into the
  // glTF materials — a BSP shell is a room you walk INSIDE).
  //
  // Returns the material to use: the glTF's MeshStandardMaterial is swapped
  // for an unlit MeshBasicMaterial, because that is what retail does with
  // BSP (see the LIGHTING note at the top). Every value carried over comes
  // off the glTF material the converter wrote.
  static _prepMaterial(material, lightmaps, swapped) {
    const mats = Array.isArray(material) ? material : [material];
    const out = mats.map((m) => {
      const done = swapped.get(m.uuid);
      if (done) return done;
      if (m.map) {
        m.map.anisotropy = 4;
      }
      const basic = new THREE.MeshBasicMaterial({
        name: m.name,
        map: m.map ?? null,
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: m.transparent,
        alphaTest: m.alphaTest,
        depthWrite: m.depthWrite,
      });
      const sheet = m.userData?.lightmapSheet;
      const lm = Number.isInteger(sheet) ? lightmaps.get(sheet) : null;
      if (lm) {
        basic.lightMap = lm;
        // three samples lightMap on the UV set named by texture.channel;
        // the converter writes the retail lightmap UVs as TEXCOORD_1,
        // which GLTFLoader turns into the `uv1` attribute.
        basic.lightMap.channel = 1;
        basic.lightMapIntensity = lightmapIntensity();
      }
      basic.userData = m.userData;
      swapped.set(m.uuid, basic);
      m.dispose();
      return basic;
    });
    return Array.isArray(material) ? out : out[0];
  }

  // Load the atlas sheets this tile's glTF asks for. -> Map(sheet -> Texture)
  static async _loadLightmaps(baseUrl, gltf) {
    const variant = lightmapVariant();
    if (variant === null) return new Map();
    const sheets = new Set();
    for (const m of gltf.parser?.json?.materials ?? []) {
      const s = m.extras?.lightmapSheet;
      if (Number.isInteger(s) && s >= 0) sheets.add(s);
    }
    const loader = new THREE.TextureLoader();
    const out = new Map();
    await Promise.all([...sheets].map(async (s) => {
      const url = `${baseUrl}lightmap/g${s}p${variant}.png`;
      try {
        const tex = await loader.loadAsync(url);
        // The atlas PNG is written top-down, row 0 = atlas row 0, and the
        // retail UVs address it the same way, so the sampler must NOT flip.
        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        out.set(s, tex);
      } catch {
        console.warn(`bsp: lightmap sheet ${s} failed to load (${url})`);
      }
    }));
    return out;
  }

  // -> Bsp, or null when the tile ships no bsp.gltf (not every tile has
  // BSP, and a missing/broken file must never take the scene down).
  static async load(baseUrl) {
    // '?bsp=off' renders the tile the way it looked before the BSP was
    // decoded — that is how the before/after shots in verify_bsp.js are
    // taken from one build instead of from two checkouts.
    if (new URLSearchParams(location.search).get('bsp') === 'off') return null;
    const url = baseUrl + 'bsp.gltf';
    let text;
    try {
      // plain GET, not HEAD: editor/world/server.py implements GET only.
      const res = await fetch(url);
      if (!res.ok) {
        // drain the 404 body: an unread body leaves the request in flight
        // and never lets the page reach networkidle0 (see bspfloor.js)
        await res.arrayBuffer().catch(() => {});
        return null;                         // tile ships no BSP
      }
      text = await res.text();
    } catch {
      return null;
    }
    try {
      // parse the text we already have (loadAsync would refetch); baseUrl
      // resolves bsp.bin and bsp/*.png
      const gltf = await new GLTFLoader().parseAsync(text, baseUrl);
      const lightmaps = await Bsp._loadLightmaps(baseUrl, gltf);
      return new Bsp(gltf.scene, lightmaps);
    } catch (err) {
      console.warn(`bsp: ${url} failed to load (${err.message})`);
      return null;
    }
  }

  // distance culling, driven from Terrain.setPropDrawDistance so BSP and
  // props share one budget. `from` is a three.js world position.
  setDrawDistance(dist, from) {
    for (const c of this.chunks) {
      const v = !dist || c.center.distanceTo(from) < dist;
      if (v !== c.visible) {
        c.visible = v;
        c.object.visible = v;
      }
    }
  }
}
