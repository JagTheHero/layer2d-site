/**
 * Layer2D Scene Graph (Parent -> Child Transform & Opacity Hierarchy)
 *
 * Supports:
 *   - Virtual Transform / Deformer Group Nodes (`pack.nodes[]`: { id, name, parent?, pivot: [x,y], inheritOp? })
 *   - Direct Layer-to-Layer or Layer-to-Node parenting (`pack.layers[].parent`)
 *   - Arbitrary nesting depth with automatic O(N) topological evaluation & cycle protection
 *   - Rest-pose-zero relative transform inheritance (reparenting at rest never shifts children!)
 *   - Node animation across Angle X (`samples[].nodes`), Angle Y (`pitchSamples[].nodes`),
 *     and additive Blend Shapes (`blendShapes[].nodes`)
 *   - Exact 1:1 parity with viewer/index.html WebGL2 Player runtime
 */

import { inv2, mul2m, composeAffine } from "./warp_math.js";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function lerp(a, b, f) {
  return a + (b - a) * f;
}

export function hasSceneGraph(pack) {
  if (!pack) return false;
  if (Array.isArray(pack.nodes) && pack.nodes.length > 0) return true;
  if (Array.isArray(pack.layers)) {
    for (const L of pack.layers) if (L && L.parent) return true;
  }
  return false;
}

export function getAllSceneItems(pack) {
  const byId = new Map();
  for (const n of (pack && pack.nodes) || []) {
    if (n && n.id) byId.set(n.id, { kind: "node", id: n.id, obj: n });
  }
  for (let i = 0; i < ((pack && pack.layers) || []).length; i++) {
    const L = pack.layers[i];
    if (L && L.id) byId.set(L.id, { kind: "layer", id: L.id, idx: i, obj: L });
  }
  return byId;
}

/**
 * Returns true if setting `childId.parent = candidateParentId` would introduce a cycle.
 */
export function wouldCreateCycle(pack, childId, candidateParentId) {
  if (!candidateParentId) return false;
  if (childId === candidateParentId) return true;
  const byId = getAllSceneItems(pack);
  const seen = new Set([childId]);
  let cur = candidateParentId;
  while (cur) {
    if (seen.has(cur)) return true;
    seen.add(cur);
    const it = byId.get(cur);
    cur = it && it.obj && it.obj.parent ? it.obj.parent : null;
  }
  return false;
}

/**
 * Build topological root->child ordering and adjacency lists (cycle-safe).
 */
export function buildSceneGraph(pack) {
  const byId = getAllSceneItems(pack);
  const childrenOf = new Map();
  const roots = [];
  for (const id of byId.keys()) childrenOf.set(id, []);

  // Validate parent pointers & build adjacency without cycles
  const validParent = new Map();
  for (const [id, item] of byId.entries()) {
    const pid = item.obj.parent || null;
    if (pid && byId.has(pid) && pid !== id) {
      // Quick cycle check along existing parent links
      const seen = new Set([id]);
      let cur = pid, cyclic = false;
      while (cur) {
        if (seen.has(cur)) { cyclic = true; break; }
        seen.add(cur);
        const pItem = byId.get(cur);
        cur = pItem && pItem.obj.parent ? pItem.obj.parent : null;
      }
      if (!cyclic) {
        validParent.set(id, pid);
        childrenOf.get(pid).push(id);
        continue;
      }
    }
    validParent.set(id, null);
    roots.push(id);
  }

  // Topological DFS (parent always visited before child)
  const topoOrder = [];
  const visited = new Set();
  const visit = (id) => {
    if (visited.has(id)) return;
    visited.add(id);
    const pid = validParent.get(id);
    if (pid && !visited.has(pid)) visit(pid);
    topoOrder.push(id);
  };
  for (const id of byId.keys()) visit(id);

  return { byId, validParent, childrenOf, roots, topoOrder };
}

/**
 * Collect all descendant IDs (both nodes and layer indices) under `parentId`.
 */
export function getDescendants(pack, parentId) {
  const { byId, childrenOf } = buildSceneGraph(pack);
  const nodeIds = [];
  const layerIndices = [];
  const stack = [...(childrenOf.get(parentId) || [])];
  const seen = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const it = byId.get(id);
    if (!it) continue;
    if (it.kind === "node") nodeIds.push(id);
    else if (it.kind === "layer") layerIndices.push(it.idx);
    for (const ch of childrenOf.get(id) || []) stack.push(ch);
  }
  return { nodeIds, layerIndices };
}

function emptyDelta() {
  return { dt: [0, 0], dRot: 0, dScale: [0, 0], dOp: 0 };
}

function addDelta(acc, d, w = 1) {
  if (!d || Math.abs(w) < 1e-6) return;
  if (d.dt) {
    acc.dt[0] += (d.dt[0] || 0) * w;
    acc.dt[1] += (d.dt[1] || 0) * w;
  }
  if (d.dRot) acc.dRot += d.dRot * w;
  if (d.dScale) {
    acc.dScale[0] += (d.dScale[0] || 0) * w;
    acc.dScale[1] += (d.dScale[1] || 0) * w;
  }
  if (d.dOp) acc.dOp += d.dOp * w;
}

function lerpDelta(a, b, f) {
  if (!a && !b) return null;
  const da = a || emptyDelta(), db = b || emptyDelta();
  const dt0 = da.dt || [0, 0], dt1 = db.dt || [0, 0];
  const ds0 = da.dScale || [0, 0], ds1 = db.dScale || [0, 0];
  return {
    dt: [lerp(dt0[0] || 0, dt1[0] || 0, f), lerp(dt0[1] || 0, dt1[1] || 0, f)],
    dRot: lerp(da.dRot || 0, db.dRot || 0, f),
    dScale: [lerp(ds0[0] || 0, ds1[0] || 0, f), lerp(ds0[1] || 0, ds1[1] || 0, f)],
    dOp: lerp(da.dOp || 0, db.dOp || 0, f),
  };
}

/**
 * Evaluate composed local delta `{ dt, dRot, dScale, dOp }` for every Group Node in `pack.nodes[]`
 * across Angle X (`samples[].nodes`), Angle Y (`pitchSamples[].nodes`), and Blend Shapes (`blendShapes[].nodes`).
 */
export function evalAllNodeDeltas(pack, a, pitch, blendWeights, exactIdx = null, exactPitchIdx = null) {
  const nodes = (pack && pack.nodes) || [];
  const out = Object.create(null);
  if (!nodes.length) return out;
  for (const n of nodes) out[n.id] = emptyDelta();

  // 1. Angle X (`pack.samples[].nodes`)
  const S = pack.samples || [];
  if (S.length) {
    if (exactIdx !== null && exactIdx >= 0 && exactIdx < S.length) {
      const nd = S[exactIdx].nodes;
      if (nd) for (const n of nodes) if (nd[n.id]) addDelta(out[n.id], nd[n.id], 1);
    } else {
      const turn = pack.head?.turn || { R: -0.22, L: 0.22 };
      const ang = a < 0 ? -a * turn.R : a * turn.L;
      let i = 0;
      while (i + 1 < S.length && S[i + 1].angle < ang) i++;
      const s0 = S[i], s1 = S[Math.min(i + 1, S.length - 1)];
      const f = s1.angle === s0.angle ? 0 : clamp((ang - s0.angle) / (s1.angle - s0.angle), 0, 1);
      for (const n of nodes) {
        const d0 = s0.nodes && s0.nodes[n.id];
        const d1 = s1.nodes && s1.nodes[n.id];
        const d = lerpDelta(d0, d1, f);
        if (d) addDelta(out[n.id], d, 1);
      }
    }
  }

  // 2. Angle Y (`pack.pitchSamples[].nodes`, also accepts `layers[nodeId]` for agent ergonomics)
  const PS = pack.pitchSamples || [];
  if (PS.length) {
    if (exactPitchIdx !== null && exactPitchIdx >= 0 && exactPitchIdx < PS.length) {
      const s = PS[exactPitchIdx];
      for (const n of nodes) {
        const d = (s.nodes && s.nodes[n.id]) || (s.layers && s.layers[n.id]);
        if (d) addDelta(out[n.id], d, 1);
      }
    } else {
      const pVal = clamp(pitch || 0, -1, 1);
      if (PS.length === 1) {
        const s = PS[0];
        for (const n of nodes) {
          const d = (s.nodes && s.nodes[n.id]) || (s.layers && s.layers[n.id]);
          if (d) addDelta(out[n.id], d, 1);
        }
      } else {
        let i = 0;
        while (i + 1 < PS.length && PS[i + 1].pitch < pVal) i++;
        const s0 = PS[i], s1 = PS[Math.min(i + 1, PS.length - 1)];
        const f = s1.pitch === s0.pitch ? 0 : clamp((pVal - s0.pitch) / (s1.pitch - s0.pitch), 0, 1);
        for (const n of nodes) {
          const d0 = (s0.nodes && s0.nodes[n.id]) || (s0.layers && s0.layers[n.id]);
          const d1 = (s1.nodes && s1.nodes[n.id]) || (s1.layers && s1.layers[n.id]);
          const d = lerpDelta(d0, d1, f);
          if (d) addDelta(out[n.id], d, 1);
        }
      }
    }
  }

  // 3. Additive Blend Shapes (`pack.blendShapes[].nodes`, also accepts `layers[nodeId]`)
  if (blendWeights) {
    for (const bs of pack.blendShapes || []) {
      const w = blendWeights[bs.id];
      if (!w) continue;
      for (const n of nodes) {
        const d = (bs.nodes && bs.nodes[n.id]) || (bs.layers && bs.layers[n.id]);
        if (d) addDelta(out[n.id], d, w);
      }
    }
  }

  return out;
}

/**
 * Evaluate the Scene Graph topologically (root -> children) and compose inherited parent
 * transforms + opacity onto `key.layers[]` in place!
 *
 * Returns `worldMap` (`{ [id]: { M, b, op, parentM, parentB, pivot, worldPivot, delta } }`)
 * for Studio gizmos, inverse child drag projection, and pivot rendering.
 */
export function applySceneGraphToKey(
  pack,
  key,
  restKey0,
  a,
  pitch,
  blendWeights,
  exactIdx = null,
  exactPitchIdx = null,
  graphCache = null,
) {
  if (!hasSceneGraph(pack)) return null;
  const graph = graphCache || buildSceneGraph(pack);
  const { byId, validParent, topoOrder } = graph;
  const nodeDeltas = evalAllNodeDeltas(pack, a, pitch, blendWeights, exactIdx, exactPitchIdx);
  const world = Object.create(null);
  const ID_M = [1, 0, 0, 1];
  const ID_B = [0, 0];

  for (const id of topoOrder) {
    const item = byId.get(id);
    if (!item) continue;
    const pid = validParent.get(id);
    const pw = pid && world[pid] ? world[pid] : null;
    const pM = pw ? pw.M : ID_M;
    const pB = pw ? pw.b : ID_B;
    const pOp = pw ? pw.op : 1;

    if (item.kind === "node") {
      const node = item.obj;
      const pv = node.pivot || [pack.canvas[0] * 0.5, pack.canvas[1] * 0.5];
      const d = nodeDeltas[id] || emptyDelta();
      const sx = Math.max(0.05, 1 + (d.dScale[0] || 0));
      const sy = Math.max(0.05, 1 + (d.dScale[1] || 0));
      const Mloc = composeAffine(sx, sy, d.dRot || 0);
      // T_loc(q) = pv + dt + Mloc * (q - pv) = Mloc * q + (pv + dt - Mloc * pv)
      const bLoc = [
        pv[0] + (d.dt[0] || 0) - (Mloc[0] * pv[0] + Mloc[1] * pv[1]),
        pv[1] + (d.dt[1] || 0) - (Mloc[2] * pv[0] + Mloc[3] * pv[1]),
      ];
      const M = pw ? mul2m(pM, Mloc) : Mloc;
      const b = pw
        ? [pM[0] * bLoc[0] + pM[1] * bLoc[1] + pB[0], pM[2] * bLoc[0] + pM[3] * bLoc[1] + pB[1]]
        : bLoc;
      const opLoc = clamp(1 + (d.dOp || 0), 0, 1);
      const inheritOp = node.inheritOp !== false;
      const op = inheritOp ? clamp(pOp * opLoc, 0, 1) : opLoc;
      const worldPivot = [M[0] * pv[0] + M[1] * pv[1] + b[0], M[2] * pv[0] + M[3] * pv[1] + b[1]];
      world[id] = { kind: "node", M, b, op, parentM: pM, parentB: pB, pivot: pv, worldPivot, delta: d };
    } else {
      const idx = item.idx;
      const cur = key.layers[idx];
      if (!cur) continue;
      const r0 = restKey0 && restKey0.layers && restKey0.layers[idx];
      // Layer's own rest->current local canonical transform BEFORE inheriting parent
      const A0 = (r0 && r0.A) || ID_M;
      const t0 = (r0 && r0.t) || cur.t;
      const op0 = (r0 && r0.op !== undefined) ? r0.op : 1;
      const Aown = cur.A || ID_M;
      const town = cur.t || [0, 0];
      const Mloc = mul2m(Aown, inv2(A0));
      const bLoc = [
        town[0] - (Mloc[0] * t0[0] + Mloc[1] * t0[1]),
        town[1] - (Mloc[2] * t0[0] + Mloc[3] * t0[1]),
      ];
      const opLoc = op0 > 1e-4 ? clamp((cur.op ?? 1) / op0, 0, 1) : (cur.op ?? 1);

      if (pw) {
        const Afinal = mul2m(pM, Aown);
        const tfinal = [
          pM[0] * town[0] + pM[1] * town[1] + pB[0],
          pM[2] * town[0] + pM[3] * town[1] + pB[1],
        ];
        const opfinal = clamp((cur.op ?? 1) * pOp, 0, 1);
        key.layers[idx] = { ...cur, A: Afinal, t: tfinal, op: opfinal };
      }
      const M = pw ? mul2m(pM, Mloc) : Mloc;
      const b = pw
        ? [pM[0] * bLoc[0] + pM[1] * bLoc[1] + pB[0], pM[2] * bLoc[0] + pM[3] * bLoc[1] + pB[1]]
        : bLoc;
      const op = clamp(pOp * opLoc, 0, 1);
      const tFinal = key.layers[idx].t;
      world[id] = { kind: "layer", idx, M, b, op, parentM: pM, parentB: pB, pivot: t0, worldPivot: [tFinal[0], tFinal[1]] };
    }
  }

  return world;
}

/**
 * Compute canonical bounding box of a Group Node (union of all descendant layer corners,
 * or a default 120x120 box around its worldPivot when empty).
 */
export function computeNodeBounds(pack, nodeId, key, worldMap) {
  const nw = worldMap && worldMap[nodeId];
  const node = (pack?.nodes || []).find((n) => n.id === nodeId);
  if (!node) return null;
  const pv = nw ? nw.worldPivot : (node.pivot || [pack.canvas[0] * 0.5, pack.canvas[1] * 0.5]);
  const { layerIndices } = getDescendants(pack, nodeId);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const idx of layerIndices) {
    const L = pack.layers[idx], k = key && key.layers && key.layers[idx];
    if (!L || !k) continue;
    const w2 = L.w * 0.5, h2 = L.h * 0.5, A = k.A || [1, 0, 0, 1], t = k.t || [0, 0];
    for (const [cx, cy] of [[-w2, -h2], [w2, -h2], [w2, h2], [-w2, h2]]) {
      const x = A[0] * cx + A[1] * cy + t[0];
      const y = A[2] * cx + A[3] * cy + t[1];
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (!Number.isFinite(x0)) {
    const r = 64;
    x0 = pv[0] - r; y0 = pv[1] - r; x1 = pv[0] + r; y1 = pv[1] + r;
  } else {
    // Include pivot inside visual bounds with small margin
    x0 = Math.min(x0, pv[0] - 24) - 8;
    y0 = Math.min(y0, pv[1] - 24) - 8;
    x1 = Math.max(x1, pv[0] + 24) + 8;
    y1 = Math.max(y1, pv[1] + 24) + 8;
  }
  return { x0, y0, x1, y1, pivot: pv, layerIndices };
}
