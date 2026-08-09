// sky.js — the skylevel.unr layers main.js does not draw yet.
//
// WHAT THIS IS. main.js owns the two sky layers that were already decoded:
// the flat #0096CE background and the warm haze band (see its own header,
// and tools/audit/probe_skydome.py). This module adds the four that were
// left as "NOT REPRODUCED, and deliberately not guessed at": the cloud
// sheet, the two starfield sheets, and the sun/moon/lens-flare rig.
//
// Every number below comes out of `assets/world/sky/sky.json`, which
// `tools/world/sky.py` writes from skylevel.unr and l2_skies.utx. There is
// no literal in this file that the JSON does not carry, and no colour,
// falloff or rate is computed here. `python3 tools/world/sky.py --check`
// re-derives all of it from the packages and fails on drift.
//
// WHY EACH LAYER IS DRAWN THE WAY IT IS — the one question a sky module
// can get plausibly wrong, so each answer is a measurement:
//
//   * the CLOUD is a flat colour behind an alpha mask. WhiteCloud is
//     1024x1024 with exactly ONE distinct RGB, (255,251,255), and an alpha
//     that runs 0..208. So its RGB carries no shape at all — the alpha
//     does — and the rendered colour is the ColorModifier #FFC097 times
//     that constant. sky.py reports the product as `cloudRenderedRgb`;
//     this file uses that field rather than multiplying again, so the
//     one-unit rounding ambiguity sky.py documents is decided in exactly
//     one place. Drawn with a normal alpha blend, depth-write off.
//
//   * the STARFIELDS are drawn ADDITIVELY, and that is not a stylistic
//     pick. StarField_largeStar02 and StarField_smallStar01 have a
//     CONSTANT alpha of 255 across all 1,048,576 texels, so an alpha blend
//     would paint an opaque black square over the sky. Their RGB is what
//     varies (mean 0.0 and 0.1 over 35 and 199 distinct values), i.e. a
//     near-black field with bright points. A layer whose alpha is constant
//     and whose colour is its intensity is an additive layer.
//     The same argument covers all five flare textures (alpha 255 flat).
//
//   * the sheets' GEOMETRY is read off skylevel.unr's BSP, not modelled:
//     each of Cloud_Final / StarField_Final01 / StarField_Final02 is on
//     exactly ONE node of the 55, so sky.json carries that node's four
//     world corners and its UVs in texels. sky.py --check fails if any of
//     them ever lands on a different number of nodes.
//
// WHAT IS NOT DECIDED HERE, and is therefore not drawn dishonestly:
//
//   * StarField_Final01 serialises no Color, so its tint is the
//     ColorModifier class default and nobody has sourced it. This module
//     draws that layer UNTINTED and says so in `notes`. It does not
//     substitute white and call it retail. StarField_Final02 does carry a
//     colour (#666666) and gets it.
//   * the TexPanner / TexRotator rates are carried through verbatim.
//     sky.py records that their UNITS are not established, so `animate()`
//     is opt-in and off by default: a wrong rate is a visible lie, a
//     static sheet is only an incomplete truth.
//   * NMoon0 and NMoon3 yield no readable properties (sky.py KNOWN GAPS
//     2b), so only the three moons that do are built.
//   * WHEN each layer is visible. The preview shows the starfields and the
//     moons at the same time as a daylit cloud sheet, which retail plainly
//     does not — but nothing in skylevel.unr, l2_skies.utx or any readable
//     client binary says what fades them. That is the SAME unsourced
//     question as tools/world/bsplight.py KNOWN GAPS 1 (what selects one
//     of a lightmap sheet's eight colour variants): both need a runtime
//     lighting phase that no file in this repo has yet produced. So this
//     module draws every layer the level contains and leaves the gating to
//     whoever sources that phase, rather than inventing a day/night curve
//     here. Callers that want only the daytime layers can hide
//     `sky.sprites` and the starfield meshes by name.
//
// WIRING. This module is self-contained and adds nothing to the scene by
// itself. main.js is not owned by this pass, so nothing here is called
// yet; `editor/world/sky-preview.html` renders it standalone, which is
// where the screenshots come from. To wire it for real:
//
//     import { SkyLayers } from './sky.js';
//     const sky = await SkyLayers.load();      // fetches assets/world/sky/
//     scene.add(sky.group);                    // group follows the camera
//     // in the render loop, if you want the retail pans:
//     sky.animate(dtSeconds);                  // opt-in, see above
//
// The group is built in the SAME units main.js uses (L2_TO_M from
// coords.js) and is meant to be parented to the camera the way a backdrop
// is, because skylevel.unr's own geometry is a backdrop room rendered from
// SkyZoneInfo0.Location rather than a dome at world scale.

import * as THREE from 'three';
import { L2_TO_M } from './coords.js';

// tools/world/sky.py writes assets/world/sky/, and editor/world/server.py
// exposes assets/world/ under /scenes/ — so this is that same directory
// seen through the dev server's route, NOT a second copy. `/scenes` itself
// still lists 100 tiles: it filters on scene.json, which this directory
// does not have, so adding it does not leak a 101st "tile".
const SKY_DIR = 'scenes/sky/';

// The sheets, innermost first. The order is the retail z order read out of
// sky.json's own corners (cloud 24548, starfields 24560 and 24561), not a
// preference: the starfields sit BEHIND the cloud, 12 and 13 units further
// out from the eye plane at 24535.
const SHEET_ORDER = ['Cloud_Final', 'StarField_Final01', 'StarField_Final02'];

// Which texture each sheet's chain terminates in. Read from sky.json's
// `chains` rather than hard-coded, so a changed chain cannot be drawn with
// the old image; this list is only the expected shape for the error text.
function terminalTexture(chain) {
  const last = chain[chain.length - 1];
  if (!last || last.class !== 'Texture') {
    throw new Error(`sky: chain ends on ${last && last.class}, not a Texture`);
  }
  return last.name;
}

function loadTexture(loader, name) {
  return new Promise((resolve, reject) => {
    loader.load(SKY_DIR + name + '.png',
      (t) => {
        // The retail sheets tile: the BSP UVs run well outside 0..1 (they
        // are recorded in TEXELS in sky.json precisely so that is visible).
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = THREE.SRGBColorSpace;
        resolve(t);
      },
      undefined,
      () => reject(new Error(`sky: ${name}.png did not load`)));
  });
}

function rgb(triple) {
  return new THREE.Color(triple[0] / 255, triple[1] / 255, triple[2] / 255);
}

// One BSP node -> a plane in metres, centred on the sky eye. The corners
// are absolute skylevel.unr coordinates; the eye (SkyZoneInfo0.Location) is
// subtracted so the sheet can hang off the camera.
function sheetMesh(sheet, eye, texture, material) {
  const geo = new THREE.BufferGeometry();
  const n = sheet.corners.length;
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const c = sheet.corners[i];
    // L2 (x, y, z) -> the client's (x, z, -y) convention, same as coords.js
    pos[i * 3] = (c[0] - eye[0]) * L2_TO_M;
    pos[i * 3 + 1] = (c[2] - eye[2]) * L2_TO_M;
    pos[i * 3 + 2] = -(c[1] - eye[1]) * L2_TO_M;
    // sky.json stores UVs in TEXELS; the 0..1 the sampler wants is that
    // divided by the terminal texture's own size, which is why the size
    // travels in the JSON next to the image.
    uv[i * 2] = sheet.uvTexels[i][0] / texture.image.width;
    uv[i * 2 + 1] = sheet.uvTexels[i][1] / texture.image.height;
  }
  const idx = [];
  for (let k = 1; k < n - 1; k++) idx.push(0, k, k + 1);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'sky_' + sheet.material;
  mesh.frustumCulled = false;
  return mesh;
}

export class SkyLayers {
  constructor(data, textures) {
    this.data = data;
    this.textures = textures;
    this.notes = [];
    this.group = new THREE.Group();
    this.group.name = 'skyLayers';
    // A backdrop never occludes and is never occluded by the world; it is
    // drawn first with depth writes off, the same way main.js treats the
    // background it already owns.
    this.group.renderOrder = -1;

    this._panners = [];
    const eye = data.skyZone.location;

    for (const name of SHEET_ORDER) {
      const sheet = data.sheets[name];
      const chain = data.chains[name];
      const texName = terminalTexture(chain);
      const tex = textures.get(texName);
      const modifier = chain[0];
      const isCloud = name === 'Cloud_Final';

      let material;
      if (isCloud) {
        // flat colour x alpha mask (see the header). cloudRenderedRgb is
        // sky.py's product of the ColorModifier and WhiteCloud's constant
        // RGB — this file does not redo that multiply.
        material = new THREE.MeshBasicMaterial({
          map: tex,
          color: rgb(data.cloudRenderedRgb),
          transparent: true,
          depthWrite: false,
        });
      } else {
        // additive: the alpha is a constant 255, so the RGB is the
        // intensity. Tint only where the package actually carries one.
        material = new THREE.MeshBasicMaterial({
          map: tex,
          color: modifier.color ? rgb(modifier.color) : new THREE.Color(1, 1, 1),
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
        });
        if (!modifier.color) {
          this.notes.push(
            `${name} carries no Color in l2_skies.utx, so it is drawn ` +
            'UNTINTED — the ColorModifier class default is not sourced ' +
            '(tools/world/sky.py KNOWN GAPS 1)');
        }
      }
      this.group.add(sheetMesh(sheet, eye, tex, material));

      // the pan/rotate rates, carried but not converted (KNOWN GAPS 3)
      const animated = chain.find((c) => c.PanRate !== undefined
                                      || c.Rotation !== undefined);
      if (animated) this._panners.push({ material, source: animated });
    }

    // --- the sun, the readable moons, and the flare rig ----------------
    // These are point sprites rather than sheets: NSun/NMoon are actors
    // with a Radius, not BSP nodes, so there is no quad to read off the
    // level and one is not invented — the sprite is sized by the actor's
    // own Radius and placed at its own Location.
    this.sprites = new THREE.Group();
    this.sprites.name = 'skyBodies';
    this.group.add(this.sprites);

    const body = (name, loc, radius, texName) => {
      const tex = textures.get(texName);
      if (!tex || !loc || radius == null) return null;
      const mat = new THREE.SpriteMaterial({
        map: tex, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      s.name = name;
      s.position.set((loc[0] - eye[0]) * L2_TO_M,
                     (loc[2] - eye[2]) * L2_TO_M,
                     -(loc[1] - eye[1]) * L2_TO_M);
      // Radius is the actor's own field; the sprite is 2R across.
      s.scale.setScalar(2 * radius * L2_TO_M);
      this.sprites.add(s);
      return s;
    };

    body('NSun0', data.sun.location, data.sun.radius,
         data.sun.textureFromPackage);
    for (const m of data.moons) {
      if (m.radius == null) {
        this.notes.push(`${m.name} yields no readable properties and is ` +
                        'not drawn (tools/world/sky.py KNOWN GAPS 2b)');
        continue;
      }
      body(m.name, m.location, m.radius, m.textureFromPackage);
    }

    // The lens flare: three parallel nine-element arrays, complete and
    // sourced. Offset is along the screen line from the sun through the
    // centre — that is what an offset in a UE2 lens-flare array is for —
    // and scale multiplies the element's own size. Both are applied by
    // update(), which needs a camera, so the meshes are built here and
    // positioned there.
    this.flare = new THREE.Group();
    this.flare.name = 'lensFlare';
    this.group.add(this.flare);
    const z = data.skyZone;
    for (let i = 0; i < z.lensFlare.length; i++) {
      const f = z.lensFlare[i];
      const tex = f && textures.get(f.texture);
      if (!tex) continue;
      const mat = new THREE.SpriteMaterial({
        map: tex, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      s.name = `flare${i}_${f.texture}`;
      s.userData.offset = z.lensFlareOffset[i];
      s.userData.scale = z.lensFlareScale[i];
      // DrawScale is the SkyZoneInfo's own field and is what turns the
      // array's unit scales into a size.
      s.scale.setScalar(z.lensFlareScale[i] * (z.drawScale ?? 1));
      this.flare.add(s);
    }
  }

  static async load(base = '') {
    const res = await fetch(base + SKY_DIR + 'sky.json');
    if (!res.ok) {
      throw new Error('sky: assets/world/sky/sky.json is missing — run ' +
                      '`python3 tools/world/sky.py`');
    }
    const data = await res.json();
    const loader = new THREE.TextureLoader();
    if (base) loader.setPath(base);
    const textures = new Map();
    await Promise.all(Object.keys(data.textures).map(
      (n) => loadTexture(loader, n).then((t) => textures.set(n, t))));
    return new SkyLayers(data, textures);
  }

  // Opt-in, and off unless a caller asks: sky.py records that the
  // TexPanner/TexRotator rates are carried verbatim and that their UNITS
  // are not established (KNOWN GAPS 3). `unitsPerSecond` is the caller's
  // explicit statement of what it believes PanRate means; without it this
  // does nothing at all rather than guessing a conversion.
  animate(dt, unitsPerSecond = 0) {
    if (!unitsPerSecond) return;
    for (const p of this._panners) {
      const rate = p.source.PanRate;
      if (typeof rate !== 'number' || !p.material.map) continue;
      p.material.map.offset.x += rate * unitsPerSecond * dt;
      p.material.map.offset.y += rate * unitsPerSecond * dt;
    }
  }

  // Place the flare elements along the sun->screen-centre line. Called per
  // frame with the active camera; does nothing if there is no sun.
  update(camera) {
    const sun = this.sprites.getObjectByName('NSun0');
    if (!sun || !this.flare.children.length) return;
    const v = sun.position.clone().project(camera);
    for (const s of this.flare.children) {
      const t = s.userData.offset;
      // offset 0 sits on the sun, 1 at the opposite side of the screen —
      // the standard meaning of a UE2 LensFlareOffset array, and the only
      // reading under which the retail spread of -0.12..0.60 lands both
      // in front of and behind the sun the way the array is written.
      const p = new THREE.Vector3(v.x * (1 - 2 * t), v.y * (1 - 2 * t), -1);
      p.unproject(camera);
      s.position.copy(this.group.worldToLocal(p));
      s.visible = v.z < 1;
    }
  }
}
