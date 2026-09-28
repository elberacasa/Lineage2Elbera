/** Elbera Tools — original nonzero static-mesh tree traversal.
 * Uses original records, supplied current cache state and explicit material
 * method responses. An ordinary-mesh entry joins final hit adjustment; cache
 * acquisition and actor admission remain separate. Native units and axis order.
 */
import { prepareStaticSweep } from "./static-sweep.js";
import { adjustStaticMeshHit } from "./static-hit.js";
import {
  prepareStaticTriangle,
  createStaticTriangleClipState,
  clipStaticTriangle,
} from "./static-triangle.js";

const f = Math.fround;
const scope = "original-static-mesh-tree";
const models = new WeakSet();
const own = (a, key) => a != null && Object.hasOwn(a, key);
const dense = (a) =>
  Array.isArray(a) &&
  Array.from({ length: a.length }, (_, i) => own(a, i)).every(Boolean);
const f32 = (v) =>
  typeof v === "number" && Number.isFinite(v) && Object.is(f(v), v);
const vector = (v, n) => dense(v) && v.length === n && v.every(f32);
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const index = (v) => Number.isInteger(v) && v >= 0 && v <= 0x7fffffff;
const fail = (reason) =>
  Object.freeze({ status: "unsupported", scope, reason });
class MissingSource extends Error {}
const need = (condition, reason) => {
  if (!condition) throw new MissingSource(reason);
};
const store = (v) => {
  const value = f(v);
  need(Number.isFinite(value), "nonfinite source tree arithmetic");
  return value;
};
const freeze = (a) => Object.freeze(a);

/** Snapshot the existing exporter record format once, without deriving planes,
 * rebuilding the tree or inferring placements/material identities. Shared
 * descendants are allowed; a cycle cannot complete the native traversal.
 */
export function prepareStaticMeshTree(source) {
  const tree = source?.collisionTree;
  if (
    !dense(source?.vertices) ||
    !source.vertices.every((v) => vector(v, 3)) ||
    !dense(source?.indices) ||
    source.indices.length % 3 !== 0 ||
    !source.indices.length ||
    !source.indices.every((i) => index(i) && i < source.vertices.length) ||
    !dense(source?.materials) ||
    source.materials.length * 3 !== source.indices.length ||
    !source.materials.every(index) ||
    !dense(tree?.trianglePlanes) ||
    tree.trianglePlanes.length !== source.materials.length ||
    !tree.trianglePlanes.every((p) => vector(p, 16)) ||
    !dense(tree?.nodes) ||
    !tree.nodes.length
  )
    return fail("complete finite original mesh and collision records required");
  const count = tree.nodes.length;
  for (const node of tree.nodes)
    if (
      !node ||
      !dense(node.links) ||
      node.links.length !== 4 ||
      !index(node.links[0]) ||
      node.links[0] >= source.materials.length ||
      !node.links.slice(1).every((i) => i === -1 || (index(i) && i < count)) ||
      !vector(node.bounds, 6) ||
      !uint(node.valid) ||
      node.valid > 255
    )
      return fail("invalid original collision node record");
  const colors = new Uint8Array(count),
    pending = [[0, false]];
  while (pending.length) {
    const [i, done] = pending.pop();
    if (done) {
      colors[i] = 2;
      continue;
    }
    if (colors[i] === 1) return fail("cyclic original collision tree");
    if (colors[i] === 2) continue;
    colors[i] = 1;
    pending.push([i, true]);
    for (const child of tree.nodes[i].links.slice(1))
      if (child !== -1) pending.push([child, false]);
  }
  const model = freeze({
    vertices: freeze(source.vertices.map((v) => freeze([...v]))),
    indices: freeze([...source.indices]),
    materials: freeze([...source.materials]),
    planes: freeze(tree.trianglePlanes.map((v) => freeze([...v]))),
    nodes: freeze(
      tree.nodes.map((n) =>
        freeze({
          links: freeze([...n.links]),
          bounds: freeze([...n.bounds]),
          valid: n.valid,
        }),
      ),
    ),
  });
  models.add(model);
  return freeze({ status: "ready", scope, model });
}

function intersectsBounds(bounds, start, delta, reciprocal) {
  const times = [];
  let inside = true;
  for (let k = 0; k < 3; k++) {
    if (start[k] < bounds[k]) {
      if (delta[k] <= 0) return false;
      inside = false;
      times.push(store((bounds[k] - start[k]) * reciprocal[k]));
    } else if (start[k] > bounds[k + 3]) {
      if (delta[k] >= 0) return false;
      inside = false;
      times.push(store((bounds[k + 3] - start[k]) * reciprocal[k]));
    } else times.push(0);
  }
  if (inside) return true;
  // Original FMax returns its first operand on equality, including signed zero.
  const max = (a, b) => (a >= b ? a : b);
  const time = max(times[0], max(times[1], times[2]));
  if (time < 0 || time > 1) return false;
  const point = start.map((v, k) => store(v + store(delta[k] * time)));
  // Original qword 108a01b0. Expanded limits are separately stored as Float32.
  const margin = 0.10000000149011612;
  return point.every(
    (v, k) =>
      store(bounds[k] - margin) < v && v < store(bounds[k + 3] + margin),
  );
}
const planeDistance = (point, plane) =>
  store(
    point[1] * plane[1] + point[0] * plane[0] + point[2] * plane[2] - plane[3],
  );
const planePushOut = (plane, extent) =>
  store(
    Math.abs(store(plane[1] * extent[1])) +
      Math.abs(store(plane[0] * extent[0])) +
      Math.abs(store(plane[2] * extent[2])),
  );

/** `cache` supplies current worldToLocal/localToWorld, determinant, queryTag,
 * planes [{valid,plane?,queryTag}] and vertices [{valid,point?}]. The tag has
 * already been advanced by the original query constructor; it is not guessed.
 * Methods return {status:'ready',value: opaqueIdentityOrNull}. Their source
 * state must remain stable during this query; arbitrary callback mutations
 * and native type checking/default-object creation are outside this component.
 * Returns sparse final cache/result writes and ordered original +0x578 writes.
 * Caller inputs are not mutated. `hit` is the tree return, before outer bias.
 */
export function traceStaticMeshTree(model, input = {}) {
  if (!models.has(model) || input?.arithmeticProfile !== "pc53-rne-math-sqrt")
    return fail(
      "prepared original mesh and explicit arithmetic profile required",
    );
  const {
    cache,
    start,
    end,
    extent,
    ownerStatic,
    time,
    methods,
    meshMaterials,
  } = input;
  if (
    !cache ||
    !Array.isArray(cache.planes) ||
    !Array.isArray(cache.vertices) ||
    !uint(cache.queryTag) ||
    !f32(time)
  )
    return fail("explicit current cache, query tag and result time required");
  const local = prepareStaticSweep({
    arithmeticProfile: "pc53-rne",
    start,
    end,
    extent,
    cacheWorldToLocal: cache.worldToLocal,
  });
  if (local.status !== "ready") return fail(local.reason);
  const planeWrites = new Map(),
    vertexWrites = new Map(),
    objectFields = [];
  const result = {};
  let currentTime = time;
  const inspection =
    input.inspect === true ? { visitedNodes: [], triangleTests: [] } : null;
  // Sparse overlay avoids cloning every mesh cache entry for each query.
  // A separate empty array also permits frozen caller arrays: proxy invariants
  // would forbid replacing a frozen target's indexed value with an overlay.
  const vertexView = new Proxy([], {
    get(target, key, receiver) {
      if (key === "length") return cache.vertices.length;
      if (typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key))
        return vertexWrites.get(Number(key)) ?? cache.vertices[Number(key)];
      return Reflect.get(target, key, receiver);
    },
  });
  const getPlane = (i) => {
    const record = planeWrites.get(i) ?? cache.planes[i];
    need(
      record && uint(record.queryTag),
      "missing consumed triangle query tag",
    );
    return record;
  };
  const call = (name, ...args) => {
    need(
      typeof methods?.[name] === "function",
      `missing consumed source method ${name}`,
    );
    const value = methods[name](...args);
    need(
      value?.status === "ready" &&
        own(value, "value") &&
        value.value !== undefined,
      `unresolved source method ${name}`,
    );
    return value.value;
  };
  const materialFor = (slot) => {
    let material = call("ownerVTableAC", slot);
    if (material === null) {
      need(
        Array.isArray(meshMaterials) &&
          own(meshMaterials, slot) &&
          meshMaterials[slot] !== undefined,
        "missing consumed mesh material",
      );
      material = meshMaterials[slot];
      if (material === null) material = call("defaultMaterial");
    }
    if (material !== null) {
      need(
        uint(input.ownerFlags3a0) && input.ownerFlags3a0 <= 255,
        "missing consumed owner +0x3a0 byte",
      );
      if (input.ownerFlags3a0 & 1) {
        const object = call("ownerVTable124");
        if (object !== null) {
          objectFields.push(freeze({ object, offset: 0x578, value: material }));
          material = object;
        }
      }
    }
    return material;
  };
  const endpointDistance = (plane) =>
    planeDistance(
      local.localStart.map((v, k) =>
        store(v + store(local.localDelta[k] * currentTime)),
      ),
      plane,
    );
  const frames = [{ index: 0, phase: 0, hit: false }];
  let hit = false;
  const finish = () => {
    const frame = frames.pop();
    if (frames.length) frames.at(-1).childHit = frame.hit;
    else hit = frame.hit;
  };
  try {
    while (frames.length) {
      const frame = frames.at(-1);
      if (frame.phase === 0) {
        if (frame.index === -1) {
          finish();
          continue;
        }
        inspection?.visitedNodes.push(frame.index);
        const node = model.nodes[frame.index],
          triangleIndex = node.links[0],
          plane = model.planes[triangleIndex];
        const bounds = node.bounds.map((v, k) =>
          store(v + (k < 3 ? -local.localExtent[k] : local.localExtent[k - 3])),
        );
        if (
          !intersectsBounds(
            bounds,
            local.localStart,
            local.localDelta,
            local.reciprocalDelta,
          )
        ) {
          finish();
          continue;
        }
        const from = planeDistance(local.localStart, plane),
          to = planeDistance(local.localEnd, plane),
          radius = planePushOut(plane, local.localExtent);
        if (from <= -radius && to <= -radius) {
          frame.index = node.links[2];
          continue;
        }
        if (from >= radius && to >= radius) {
          frame.index = node.links[3];
          continue;
        }
        Object.assign(frame, {
          node,
          triangleIndex,
          plane,
          from,
          radius,
          near: to <= from ? 1 : 0,
          phase: 1,
        });
        frames.push({
          index: node.links[2 + frame.near],
          phase: 0,
          hit: false,
        });
        continue;
      }
      if (frame.phase === 1) {
        if (frame.childHit) {
          frame.hit = true;
          const distance = endpointDistance(frame.plane);
          if (
            frame.near === 1
              ? distance > frame.radius
              : distance < -frame.radius
          ) {
            finish();
            continue;
          }
        }
        frame.phase = 2;
        frames.push({ index: frame.node.links[1], phase: 0, hit: false });
        continue;
      }
      if (frame.childHit) frame.hit = true;
      const i = frame.triangleIndex,
        previous = getPlane(i);
      if (previous.queryTag !== cache.queryTag) {
        inspection?.triangleTests.push(i);
        const geometry = prepareStaticTriangle({
          arithmeticProfile: input.arithmeticProfile,
          triangleIndex: i,
          indices: model.indices.slice(i * 3, i * 3 + 3),
          vertices: model.vertices,
          vertexCache: vertexView,
          planeCache: previous,
          localToWorld: cache.localToWorld,
          determinant: cache.determinant,
          ownerStatic,
        });
        need(geometry.status === "ready", geometry.reason);
        for (const { index, record } of geometry.writes.vertices)
          vertexWrites.set(index, record);
        if (geometry.writes.plane)
          planeWrites.set(i, { ...previous, ...geometry.writes.plane });
        const clipped = clipStaticTriangle({
          arithmeticProfile: input.arithmeticProfile,
          worldVertices: geometry.worldVertices,
          worldPlane: geometry.worldPlane,
          start,
          end,
          extent,
          initialClipState:
            createStaticTriangleClipState(currentTime).clipState,
        });
        need(clipped.status === "ready", clipped.reason);
        if (clipped.keep && clipped.clipState.found) {
          currentTime = clipped.clipState.entry;
          Object.assign(result, {
            time: currentTime,
            normal: clipped.clipState.normal,
            triangleIndex: i,
          });
          result.material = materialFor(model.materials[i]);
          frame.hit = true;
        }
        planeWrites.set(i, { ...getPlane(i), queryTag: cache.queryTag });
      }
      if (frame.hit) {
        const distance = endpointDistance(frame.plane);
        const farPossible =
          frame.near === 1
            ? !(frame.from > frame.radius && distance > frame.radius)
            : !(frame.from < -frame.radius && distance < -frame.radius);
        if (!farPossible) {
          finish();
          continue;
        }
      }
      frame.index = frame.node.links[3 - frame.near];
      frame.phase = 0;
    }
    const records = (map) =>
      freeze(
        [...map].map(([index, record]) =>
          freeze({
            index,
            record: freeze({
              ...record,
              ...(record.plane ? { plane: freeze([...record.plane]) } : {}),
              ...(record.point ? { point: freeze([...record.point]) } : {}),
            }),
          }),
        ),
      );
    const output = {
      status: "ready",
      scope,
      hit,
      writes: freeze({
        result: freeze(result),
        planes: records(planeWrites),
        vertices: records(vertexWrites),
        objectFields: freeze(objectFields),
      }),
    };
    if (inspection)
      output.inspection = freeze({
        visitedNodes: freeze(inspection.visitedNodes),
        triangleTests: freeze(inspection.triangleTests),
      });
    return freeze(output);
  } catch (error) {
    if (error instanceof MissingSource) return fail(error.message);
    throw error;
  }
}

/** Compose the original nonzero ordinary-mesh branch with post-hit adjustment.
 * Current cache acquisition/tag advancement are supplied, not reconstructed.
 * The owner +0x2f8 cylinder-delegation bit must be clear and current mesh +0x178
 * collisionModel explicitly null. Other original primitive branches remain
 * unsupported here. Opaque actorIdentity/meshIdentity bind the final writes.
 * The original wrapper writes Time=1 before tracing and retains it on a miss;
 * it returns blocked from the tree flag, not from the adjusted time.
 */
export function traceStaticMeshCollision(model, input) {
  const scope = "original-static-mesh-collision";
  const fail = (reason) => freeze({ status: "unsupported", scope, reason });
  if (
    !input ||
    !uint(input.ownerFlags2f8) ||
    input.ownerFlags2f8 & 0x100 ||
    input.collisionModel !== null ||
    input.actorIdentity == null ||
    input.meshIdentity == null
  )
    return fail(
      "explicit ordinary-mesh owner flags, absent alternate collision model and source identities required",
    );
  const tree = traceStaticMeshTree(model, { ...input, time: 1 });
  if (tree.status !== "ready") return fail(tree.reason);
  let result = { time: 1, ...tree.writes.result };
  if (tree.hit) {
    const adjusted = adjustStaticMeshHit({
      arithmeticProfile: input.arithmeticProfile,
      start: input.start,
      end: input.end,
      time: result.time,
      normal: result.normal,
      actor: input.actorIdentity,
      mesh: input.meshIdentity,
    });
    if (adjusted.status !== "ready") return fail(adjusted.reason);
    result = { ...result, ...adjusted.writes };
  }
  return freeze({
    status: "ready",
    scope,
    blocked: tree.hit,
    writes: freeze({ ...tree.writes, result: freeze(result) }),
    ...(tree.inspection ? { inspection: tree.inspection } : {}),
  });
}
