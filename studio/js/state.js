/**
 * Layer2D Studio Reactive Document Store
 * Owns:
 *   - Active pack.json, manifest, textures, non-destructive studio.json
 *   - Unified Rig Target: Angle X keyforms (`pack.samples`), Angle Y keyforms (`pack.pitchSamples`),
 *     and additive Blend Shapes (`pack.blendShapes`)
 *   - Undo/Redo command history stack (Ctrl+Z / Ctrl+Shift+Z)
 *   - Workspace Mode, Tool, Selection (layers, multi-vertex mesh selection, chains), Parameters, Camera, Timeline
 */

import { lerpGrids } from "./warp_math.js";
import { wouldCreateCycle } from "./scene_graph.js";
import { t } from "./i18n_bridge.js";

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function createDefaultStudio(pack) {
  const layers = {};
  for (const L of pack.layers || []) {
    const id = L.id;
    let folder = "Body";
    if (/^WE|^E\d|ear/i.test(id) && /^WE/i.test(id)) folder = "Wolf Ears";
    else if (/^E\d|^BR\d/i.test(id)) folder = "Eyes";
    else if (/^H\d/i.test(id)) folder = "Hair";
    else if (/^F\d|^M\d/i.test(id)) folder = "Face";
    else if (/^J\d/i.test(id)) folder = "Haori Jacket";
    else if (/^T\d/i.test(id)) folder = "Tail";
    else if (/^HP|^P\d|^GL|^MK/i.test(id)) folder = "Accessories";
    else if (L.head) folder = "Head";
    layers[id] = { label: id, folder };
  }
  return {
    version: 1,
    layers,
    clips: [
      {
        id: "idle_showcase",
        name: t("state.defaultClipTitle", null, "Idle Showcase"),
        fps: 30,
        duration: 5.0,
        loop: true,
        tracks: {
          a: [
            { t: 0.0, v: 0.0, ease: "easeInOut" },
            { t: 1.0, v: -0.75, ease: "easeInOut" },
            { t: 2.0, v: 0.0, ease: "easeInOut" },
            { t: 3.0, v: 0.75, ease: "easeInOut" },
            { t: 4.0, v: -0.35, ease: "easeInOut" },
            { t: 5.0, v: 0.0, ease: "easeInOut" },
          ],
          pitch: [
            { t: 0.0, v: 0.0, ease: "easeInOut" },
            { t: 1.0, v: 0.25, ease: "easeInOut" },
            { t: 2.0, v: -0.15, ease: "easeInOut" },
            { t: 3.0, v: 0.30, ease: "easeInOut" },
            { t: 4.0, v: 0.10, ease: "easeInOut" },
            { t: 5.0, v: 0.0, ease: "easeInOut" },
          ],
          roll: [
            { t: 0.0, v: 0.0, ease: "easeInOut" },
            { t: 1.0, v: 0.045, ease: "easeInOut" },
            { t: 2.0, v: 0.0, ease: "easeInOut" },
            { t: 3.0, v: -0.045, ease: "easeInOut" },
            { t: 4.0, v: 0.02, ease: "easeInOut" },
            { t: 5.0, v: 0.0, ease: "easeInOut" },
          ],
          eyes: [
            { t: 0.0, v: 1.0, ease: "linear" },
            { t: 1.8, v: 1.0, ease: "linear" },
            { t: 1.9, v: 0.0, ease: "linear" },
            { t: 2.033, v: 1.0, ease: "linear" },
            { t: 4.0, v: 1.0, ease: "linear" },
            { t: 5.0, v: 1.0, ease: "linear" },
          ],
          vowel: [
            { t: 0.0, v: "", ease: "step" },
            { t: 1.0, v: "A", ease: "step" },
            { t: 1.4, v: "O", ease: "step" },
            { t: 1.8, v: "", ease: "step" },
          ],
          face: [
            { t: 0.0, v: "Neutral", ease: "step" },
            { t: 2.0, v: Object.keys((pack.expr && pack.expr.faces) || {})[1] || "Neutral", ease: "step" },
            { t: 4.0, v: "Neutral", ease: "step" },
          ],
          tailSway: [
            { t: 0.0, v: 0.0, ease: "easeInOut" },
            { t: 1.25, v: 0.65, ease: "easeInOut" },
            { t: 2.5, v: -0.65, ease: "easeInOut" },
            { t: 3.75, v: 0.5, ease: "easeInOut" },
            { t: 5.0, v: 0.0, ease: "easeInOut" },
          ],
        },
      },
    ],
    bezier: { p1x: 0.25, p1y: 0.1, p2x: 0.75, p2y: 0.9, preset: "easeInOut" },
  };
}

export class StudioState {
  constructor() {
    this.listeners = new Map();
    this.pack = null;
    this.manifest = {};
    this.textures = Object.create(null);
    this.studio = null;
    this.preview = null;
    this.fileName = "test-signal.l2d";
    this.fileHandle = null;
    this.dirty = false;

    // Workspace & Tools
    this.mode = "rig";           // model | mesh | rig | physics | expressions | animate
    this.tool = "warp_brush";    // select | transform | warp_brush | lattice | mesh | pivot | chain | pan
    this.inspectorTab = "layer"; // layer | transform | warp | physics | expressions

    // Selection
    this.selectedLayerIdx = -1;
    this.selectedNodeId = null;     // active Transform Group / Deformer node ID in pack.nodes[]
    this.selectedChainIdx = -1;
    this.selectedExprName = null;
    this.selectedHoldName = null;
    this.selectedVerts = new Set(); // selected forward-mesh vertex indices (iy * gd + ix)
    this.selectedFolderCollapsed = new Set();
    this.collapsedNodes = new Set(); // collapsed parent nodes in Scene Graph outliner
    this.hiddenIds = new Set();
    this.lockedIds = new Set();
    this.soloId = null;
    this.layerSearch = "";

    // Parameters & Keyform / Blend-Shape Rig Target
    this.params = {
      a: 0,           // -1 .. +1 (displayed as -32.5° .. +32.5°)
      pitch: 0,       // -1 .. +1 (displayed as -30.0° .. +30.0°)
      roll: 0,        // radians (-0.35 .. +0.35)
      eyes: 1.0,      // 0 .. 1.3
      eyeX: 0.0,      // -1 .. +1 (live gaze X & Live: Eye Look X blend shape preview)
      eyeY: 0.0,      // -1 .. +1 (live gaze Y & Live: Eye Look Y blend shape preview)
      vowel: null,    // null | "A" | "I" | "U" | "E" | "O"
      mouthMode: "pack", // "pack" | "keyshape" | "keyshape_fang"
      micVolume: undefined,
      tailWag: 1.0,
      tailSway: 0.0,
      bodySway: 0.0,
      breath: 0.0,
      face: null,
      hold: null,
      style: null,
      wear: {},
      blend: {},      // { [blendShapeId]: weight }
    };
    this.activeSampleIdx = 0;     // closest or locked sample index in pack.samples
    this.snapToKeyform = true;    // when true while rigging yaw, locks to activeSampleIdx
    this.activePitchIdx = 1;      // closest or locked index in pack.pitchSamples
    this.snapToPitch = false;     // when true while rigging Angle Y, locks to activePitchIdx
    this.rigTarget = { type: "yaw", idx: 0 }; // { type: "yaw", idx } | { type: "pitch", idx } | { type: "blend", id }

    // Warp / Mesh Sculpting settings
    this.brush = {
      radius: 120,
      strength: 0.65,
      mode: "push",   // push | smooth | restore
      gridSize: 5,
      pinBorder: false,
      softSelect: false,
      softRadius: 150,
    };

    // Viewport overlays & camera
    this.view = {
      rect: [0, 0, 1200, 2000],
      zoom: 1.0,
      showGrid: true,
      showLattice: true,
      showChains: true,
      showPivots: false,
      onionSkin: false,
      autoIdle: false,
    };

    // Timeline
    this.timeline = {
      expanded: false,
      clipIdx: 0,
      playing: false,
      loop: true,
      fps: 30,
      time: 0.0,
      selectedTrack: "a",
      selectedKeyIdx: -1,
    };

    // Undo / Redo history
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 50;
  }

  on(ev, fn) {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev).add(fn);
    return () => this.listeners.get(ev)?.delete(fn);
  }

  emit(ev, detail) {
    const s = this.listeners.get(ev);
    if (s) for (const fn of s) fn(detail);
  }

  loadDocument({ pack, manifest, textures, studio, preview, fileName, fileHandle = null }) {
    this.pack = pack;
    this.manifest = manifest || {};
    this.textures = textures || Object.create(null);
    this.studio = studio && studio.version ? studio : createDefaultStudio(pack);
    if (!this.studio.layers) this.studio.layers = createDefaultStudio(pack).layers;
    if (!this.studio.clips || !this.studio.clips.length) this.studio.clips = createDefaultStudio(pack).clips;
    if (!this.studio.bezier) this.studio.bezier = { p1x: 0.25, p1y: 0.1, p2x: 0.75, p2y: 0.9, preset: "easeInOut" };
    this.preview = preview || null;
    this.fileName = fileName || "avatar.l2d";
    this.fileHandle = fileHandle;
    this.dirty = false;
    this.undoStack = [];
    this.redoStack = [];
    this.hiddenIds.clear();
    this.lockedIds.clear();
    this.selectedVerts.clear();
    this.collapsedNodes.clear();
    this.selectedNodeId = null;
    this.soloId = null;

    // Default to center (front) yaw sample
    const nS = (pack.samples || []).length;
    this.activeSampleIdx = Math.floor(nS / 2);
    this.snapToKeyform = true;

    // Sync Angle Y keyforms if present
    const ps = pack.pitchSamples;
    this.activePitchIdx = ps && ps.length ? this._findClosestPitchIdx(ps, 0) : 1;
    this.snapToPitch = false;
    this.rigTarget = { type: "yaw", idx: this.activeSampleIdx };

    this.params.a = 0;
    this.params.pitch = 0;
    this.params.roll = 0;
    this.params.eyes = 1.0;
    this.params.eyeX = 0.0;
    this.params.eyeY = 0.0;
    this.params.vowel = null;
    this.params.face = null;
    this.params.hold = null;
    this.params.style = null;
    this.params.wear = {};
    for (const [g, o] of Object.entries(pack.outfits || {})) {
      this.params.wear[g] = o.default === false ? 0 : 1;
    }
    this.params.blend = {};
    for (const bs of pack.blendShapes || []) {
      this.params.blend[bs.id] = bs.default ?? 0;
    }

    const preferred = pack.layers.findIndex((l) => /^H03C|bang/i.test(l.id));
    const faceIdx = pack.layers.findIndex((l) => /^F01|face/i.test(l.id));
    this.selectedLayerIdx = preferred >= 0 ? preferred : (faceIdx >= 0 ? faceIdx : Math.max(0, pack.layers.length - 1));
    this.selectedChainIdx = (pack.chains && pack.chains.length) ? 0 : -1;
    this.selectedExprName = Object.keys((pack.expr && pack.expr.faces) || {})[0] || null;
    this.selectedHoldName = Object.keys((pack.expr && pack.expr.holds) || {})[0] || null;

    this.resetCamera("bust");
    this.timeline.clipIdx = 0;
    this.timeline.time = 0;
    this.timeline.playing = false;
    this.timeline.selectedKeyIdx = -1;

    this.emit("doc:loaded");
    this.emit("selection:changed");
    this.emit("params:changed");
  }

  resetCamera(preset = "bust") {
    const P = this.pack;
    if (!P) return;
    const base = (P.views && P.views[preset]) || [0, 0, P.canvas[0], P.canvas[1]];
    this.view.rect = [...base];
    this.view.zoom = 1.0;
    this.emit("view:changed");
  }

  /* ---------- Undo / Redo Snapshot Helpers ---------- */
  pushUndo(label = "Edit") {
    if (!this.pack) return;
    const snap = {
      label,
      pack: deepClone({ ...this.pack, lidx: undefined }),
      studio: deepClone(this.studio),
      selectedLayerIdx: this.selectedLayerIdx,
      selectedNodeId: this.selectedNodeId,
      selectedChainIdx: this.selectedChainIdx,
      rigTarget: deepClone(this.rigTarget),
    };
    this.undoStack.push(snap);
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    this.redoStack.length = 0;
    this.dirty = true;
    this.emit("history:changed");
  }

  undo() {
    if (!this.undoStack.length || !this.pack) return false;
    this.redoStack.push({
      label: "Redo",
      pack: deepClone({ ...this.pack, lidx: undefined }),
      studio: deepClone(this.studio),
      selectedLayerIdx: this.selectedLayerIdx,
      selectedNodeId: this.selectedNodeId,
      selectedChainIdx: this.selectedChainIdx,
      rigTarget: deepClone(this.rigTarget),
    });
    const prev = this.undoStack.pop();
    this.pack = prev.pack;
    this.studio = prev.studio;
    this.selectedLayerIdx = Math.min(prev.selectedLayerIdx, this.pack.layers.length - 1);
    this.selectedNodeId = prev.selectedNodeId && (this.pack.nodes || []).some((n) => n.id === prev.selectedNodeId) ? prev.selectedNodeId : null;
    this.selectedChainIdx = Math.min(prev.selectedChainIdx, (this.pack.chains || []).length - 1);
    if (prev.rigTarget) this.rigTarget = prev.rigTarget;
    this.selectedVerts.clear();
    this.dirty = true;
    this.emit("pack:mutated", { structural: true });
    this.emit("selection:changed");
    this.emit("params:changed");
    this.emit("history:changed");
    return true;
  }

  redo() {
    if (!this.redoStack.length || !this.pack) return false;
    this.undoStack.push({
      label: "Undo",
      pack: deepClone({ ...this.pack, lidx: undefined }),
      studio: deepClone(this.studio),
      selectedLayerIdx: this.selectedLayerIdx,
      selectedNodeId: this.selectedNodeId,
      selectedChainIdx: this.selectedChainIdx,
      rigTarget: deepClone(this.rigTarget),
    });
    const next = this.redoStack.pop();
    this.pack = next.pack;
    this.studio = next.studio;
    this.selectedLayerIdx = Math.min(next.selectedLayerIdx, this.pack.layers.length - 1);
    this.selectedNodeId = next.selectedNodeId && (this.pack.nodes || []).some((n) => n.id === next.selectedNodeId) ? next.selectedNodeId : null;
    this.selectedChainIdx = Math.min(next.selectedChainIdx, (this.pack.chains || []).length - 1);
    if (next.rigTarget) this.rigTarget = next.rigTarget;
    this.selectedVerts.clear();
    this.dirty = true;
    this.emit("pack:mutated", { structural: true });
    this.emit("selection:changed");
    this.emit("params:changed");
    this.emit("history:changed");
    return true;
  }

  /* ---------- Convenience Accessors & Scene Graph ---------- */
  getSelectedLayer() {
    if (!this.pack || this.selectedLayerIdx < 0 || this.selectedLayerIdx >= this.pack.layers.length) return null;
    return this.pack.layers[this.selectedLayerIdx];
  }

  getSelectedNode() {
    if (!this.pack || !this.selectedNodeId || !Array.isArray(this.pack.nodes)) return null;
    return this.pack.nodes.find((n) => n.id === this.selectedNodeId) || null;
  }

  selectNode(nodeId) {
    if (!nodeId) {
      this.selectedNodeId = null;
      this.emit("selection:changed");
      return;
    }
    this.selectedNodeId = nodeId;
    this.selectedLayerIdx = -1;
    this.selectedVerts.clear();
    this.emit("selection:changed");
  }

  addGroupNode(name, opts = {}) {
    const P = this.pack;
    if (!P) return null;
    this.pushUndo("Add Transform Group");
    P.nodes = P.nodes || [];
    const clean = (name || "Group").trim() || "Group";
    const used = new Set([
      ...P.nodes.map((n) => n.id),
      ...(P.layers || []).map((l) => l.id),
    ]);
    const rawSlug = clean.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const baseId = opts.id || ("N_" + (rawSlug || "Group"));
    let id = baseId, k = 2;
    while (used.has(id)) id = `${baseId}_${k++}`;

    let pivot = opts.pivot;
    if (!pivot) {
      const selL = this.getSelectedLayer();
      const selSL = this.getActiveSampleLayer();
      const selN = this.getSelectedNode();
      if (selSL && selSL.t) pivot = [Math.round(selSL.t[0]), Math.round(selSL.t[1])];
      else if (selN && selN.pivot) pivot = [Math.round(selN.pivot[0]), Math.round(selN.pivot[1])];
      else if (P.head?.centre) pivot = [Math.round(P.head.centre[0]), Math.round(P.head.centre[1])];
      else pivot = [Math.round(P.canvas[0] * 0.5), Math.round(P.canvas[1] * 0.5)];
    }

    const node = {
      id,
      name: clean,
      pivot: [Math.round(pivot[0]), Math.round(pivot[1])],
      inheritOp: opts.inheritOp !== false,
    };
    if (opts.parent && !wouldCreateCycle(P, id, opts.parent)) {
      node.parent = opts.parent;
    }
    P.nodes.push(node);

    if (Array.isArray(opts.adoptChildIds)) {
      for (const cid of opts.adoptChildIds) {
        if (!cid || cid === id) continue;
        const childLayer = P.layers.find((l) => l.id === cid);
        const childNode = P.nodes.find((n) => n.id === cid);
        const target = childLayer || childNode;
        if (target && !wouldCreateCycle(P, cid, id)) {
          target.parent = id;
        }
      }
    }

    this.selectedNodeId = id;
    this.selectedLayerIdx = -1;
    this.selectedVerts.clear();
    this.emit("pack:mutated", { structural: true });
    this.emit("selection:changed");
    return node;
  }

  deleteGroupNode(nodeId = this.selectedNodeId) {
    const P = this.pack;
    if (!P || !Array.isArray(P.nodes) || !nodeId) return false;
    const idx = P.nodes.findIndex((n) => n.id === nodeId);
    if (idx < 0) return false;
    this.pushUndo("Delete Transform Group");
    const removed = P.nodes[idx];
    const grandParent = removed.parent || null;
    P.nodes.splice(idx, 1);

    // Reparent direct children cleanly to grandparent (or Root) so nothing breaks
    for (const n of P.nodes) {
      if (n.parent === nodeId) {
        if (grandParent) n.parent = grandParent;
        else delete n.parent;
      }
    }
    for (const L of P.layers || []) {
      if (L.parent === nodeId) {
        if (grandParent) L.parent = grandParent;
        else delete L.parent;
      }
    }
    // Remove node deltas across samples, pitchSamples, blendShapes
    for (const s of P.samples || []) {
      if (s.nodes && nodeId in s.nodes) {
        delete s.nodes[nodeId];
        if (!Object.keys(s.nodes).length) delete s.nodes;
      }
    }
    for (const ps of P.pitchSamples || []) {
      if (ps.nodes && nodeId in ps.nodes) {
        delete ps.nodes[nodeId];
        if (!Object.keys(ps.nodes).length) delete ps.nodes;
      }
    }
    for (const bs of P.blendShapes || []) {
      if (bs.nodes && nodeId in bs.nodes) {
        delete bs.nodes[nodeId];
        if (!Object.keys(bs.nodes).length) delete bs.nodes;
      }
    }
    if (!P.nodes.length) delete P.nodes;

    if (this.selectedNodeId === nodeId) {
      this.selectedNodeId = null;
      this.selectedLayerIdx = P.layers.length ? 0 : -1;
    }
    this.emit("pack:mutated", { structural: true });
    this.emit("selection:changed");
    return true;
  }

  setParent(itemId, newParentId) {
    const P = this.pack;
    if (!P || !itemId) return { ok: false, reason: t("state.invalidItem", null, "Invalid item") };
    const cleanParent = newParentId || null;
    if (cleanParent && wouldCreateCycle(P, itemId, cleanParent)) {
      return { ok: false, reason: t("state.cycleParent", null, "Cannot parent an item inside itself or its own descendant") };
    }
    const node = (P.nodes || []).find((n) => n.id === itemId);
    const layer = (P.layers || []).find((l) => l.id === itemId);
    const obj = node || layer;
    if (!obj) return { ok: false, reason: t("state.itemNotFound", { id: itemId }, "Item {id} not found") };
    if ((obj.parent || null) === cleanParent) return { ok: true, unchanged: true };

    this.pushUndo("Reparent Scene Node");
    if (cleanParent) obj.parent = cleanParent;
    else delete obj.parent;
    this.emit("pack:mutated", { structural: true });
    return { ok: true };
  }

  getEditTargetForNode(nodeId = this.selectedNodeId, createIfMissing = false) {
    const P = this.pack;
    if (!P || !nodeId) return null;
    const node = (P.nodes || []).find((n) => n.id === nodeId);
    if (!node) return null;

    if (this.rigTarget.type === "blend") {
      const bs = this.getBlendShape(this.rigTarget.id);
      if (bs) {
        let w = this.params.blend[bs.id] ?? bs.default ?? 0;
        if (createIfMissing && Math.abs(w) < 0.05) {
          w = bs.max ?? 1;
          this.params.blend[bs.id] = w;
        }
        bs.nodes = bs.nodes || {};
        if (createIfMissing && !bs.nodes[nodeId]) {
          bs.nodes[nodeId] = { dt: [0, 0], dRot: 0, dScale: [0, 0], dOp: 0 };
        }
        return { kind: "blend", bs, nodeId, obj: bs.nodes[nodeId] || null, weightScale: w || 1 };
      }
    }

    if (this.rigTarget.type === "pitch") {
      const ps = createIfMissing ? this.ensurePitchSamples() : this.getPitchSamplesView();
      const pi = Math.max(0, Math.min(ps.length - 1, this.activePitchIdx));
      const sample = ps[pi];
      if (sample && Math.abs(sample.pitch) > 1e-4) {
        sample.nodes = sample.nodes || {};
        if (createIfMissing && !sample.nodes[nodeId]) {
          sample.nodes[nodeId] = { dt: [0, 0], dRot: 0, dScale: [0, 0], dOp: 0 };
        }
        return { kind: "pitch", pitchIdx: pi, sample, nodeId, obj: sample.nodes[nodeId] || null, weightScale: 1 };
      }
    }

    const si = Math.max(0, Math.min((P.samples || []).length - 1, this.activeSampleIdx));
    const sample = P.samples[si];
    if (!sample) return null;
    if (createIfMissing) {
      sample.nodes = sample.nodes || {};
      if (!sample.nodes[nodeId]) {
        sample.nodes[nodeId] = { dt: [0, 0], dRot: 0, dScale: [0, 0], dOp: 0 };
      }
    }
    return { kind: "yaw", sampleIdx: si, sample, nodeId, obj: (sample.nodes && sample.nodes[nodeId]) || null, weightScale: 1 };
  }

  getActiveSampleLayer(layerIdx = this.selectedLayerIdx) {
    if (!this.pack || !this.pack.samples.length || layerIdx < 0) return null;
    const si = Math.max(0, Math.min(this.pack.samples.length - 1, this.activeSampleIdx));
    return this.pack.samples[si].layers[layerIdx] || null;
  }

  /* ---------- Angle X (Yaw) Keyforms ---------- */
  _normAngleOf(sampleAngle) {
    const turn = this.pack?.head?.turn || { R: -0.22, L: 0.22 };
    return sampleAngle < 0 ? -sampleAngle / (turn.R || -0.22) : sampleAngle / (turn.L || 0.22);
  }

  setAngle(a, snapSample = false) {
    this.params.a = clamp(a, -1, 1);
    this.snapToKeyform = Boolean(snapSample);
    const S = this.pack && this.pack.samples;
    if (S && S.length) {
      const turn = this.pack.head.turn;
      const ang = this.params.a < 0 ? -this.params.a * turn.R : this.params.a * turn.L;
      let best = 0, bestD = Infinity;
      for (let i = 0; i < S.length; i++) {
        const d = Math.abs(S[i].angle - ang);
        if (d < bestD) { bestD = d; best = i; }
      }
      this.activeSampleIdx = best;
      if (snapSample) {
        const sa = S[best].angle;
        this.params.a = sa < 0 ? -sa / turn.R : sa / turn.L;
      }
      if (this.rigTarget.type === "yaw") this.rigTarget.idx = best;
    }
    this.emit("params:changed");
  }

  snapToSample(sampleIdx) {
    const S = this.pack && this.pack.samples;
    if (!S || sampleIdx < 0 || sampleIdx >= S.length) return;
    this.activeSampleIdx = sampleIdx;
    const sa = S[sampleIdx].angle;
    const turn = this.pack.head.turn;
    this.params.a = sa < 0 ? -sa / (turn.R || -0.22) : sa / (turn.L || 0.22);
    this.snapToKeyform = true;
    this.snapToPitch = false;
    this.rigTarget = { type: "yaw", idx: sampleIdx };
    this.emit("params:changed");
    this.emit("rigTarget:changed");
  }

  addYawKeyform(normA = this.params.a) {
    const P = this.pack;
    if (!P || !P.samples || !P.samples.length) return { ok: false, reason: t("state.noYawSamples", null, "No yaw samples loaded") };
    const na = clamp(normA, -1, 1);
    const turn = P.head.turn;
    const ang = +(na < 0 ? -na * turn.R : na * turn.L).toFixed(5);

    // Prevent overlapping an existing yaw keyform!
    for (let i = 0; i < P.samples.length; i++) {
      const existNorm = this._normAngleOf(P.samples[i].angle);
      if (Math.abs(existNorm - na) < 0.035) {
        this.snapToSample(i);
        return { ok: false, reason: t("state.yawExists", { deg: (existNorm * 32.5).toFixed(1) }, "Keyform already exists near {deg}° (snapped to it)") };
      }
    }

    this.pushUndo("Add Angle X Keyform");
    // Find surrounding samples for smooth linear interpolation
    let lo = 0;
    while (lo + 1 < P.samples.length && P.samples[lo + 1].angle < ang) lo++;
    const s0 = P.samples[lo];
    const s1 = P.samples[Math.min(lo + 1, P.samples.length - 1)];
    const f = s1.angle === s0.angle ? 0 : clamp((ang - s0.angle) / (s1.angle - s0.angle), 0, 1);
    const lerp = (x, y) => x + (y - x) * f;
    const lerpA = (x, y) => x.map((v, k) => +(v + (y[k] - v) * f).toFixed(5));

    const newSample = {
      angle: ang,
      jaw: +lerp(s0.jaw || 0, s1.jaw || 0).toFixed(4),
      chin: +lerp(s0.chin || 0, s1.chin || 0).toFixed(4),
      ...(s0.chinAt && s1.chinAt ? { chinAt: [lerp(s0.chinAt[0], s1.chinAt[0]), lerp(s0.chinAt[1], s1.chinAt[1])] } : {}),
      layers: s0.layers.map((a, k) => {
        const b = s1.layers[k] || a;
        const o = {
          A: lerpA(a.A, b.A),
          t: [+lerp(a.t[0], b.t[0]).toFixed(2), +lerp(a.t[1], b.t[1]).toFixed(2)],
          op: +lerp(a.op, b.op).toFixed(3),
        };
        if (a.turn !== undefined || b.turn !== undefined) o.turn = +lerp(a.turn || 0, b.turn || 0).toFixed(4);
        if (a.behind !== undefined || b.behind !== undefined) o.behind = lerp(a.behind || 0, b.behind || 0) >= 0.5 ? 1 : 0;
        if (a.hole !== undefined || b.hole !== undefined) o.hole = +lerp(a.hole || 0, b.hole || 0).toFixed(4);
        if (a.wipe !== undefined || b.wipe !== undefined) o.wipe = +lerp(a.wipe ?? 1, b.wipe ?? 1).toFixed(4);
        if (a.cut !== undefined || b.cut !== undefined) {
          o.cut = +lerp(a.cut || 0, b.cut || 0).toFixed(4);
          if (a.slide && b.slide) o.slide = lerpA(a.slide, b.slide);
        }
        const dG = lerpGrids(a.D, b.D, f);
        if (dG) o.D = dG.map((v) => +v.toFixed(5));
        const fG = lerpGrids(a.F, b.F, f);
        if (fG) o.F = fG.map((v) => +v.toFixed(5));
        return o;
      }),
    };
    if ((s0.nodes && Object.keys(s0.nodes).length) || (s1.nodes && Object.keys(s1.nodes).length)) {
      const nodes = {};
      const nids = new Set([...Object.keys(s0.nodes || {}), ...Object.keys(s1.nodes || {})]);
      for (const nid of nids) {
        const a = s0.nodes?.[nid] || {}, b = s1.nodes?.[nid] || {};
        const dt0 = a.dt || [0, 0], dt1 = b.dt || [0, 0];
        const ds0 = a.dScale || [0, 0], ds1 = b.dScale || [0, 0];
        nodes[nid] = {
          dt: [+lerp(dt0[0] || 0, dt1[0] || 0).toFixed(2), +lerp(dt0[1] || 0, dt1[1] || 0).toFixed(2)],
          dRot: +lerp(a.dRot || 0, b.dRot || 0).toFixed(3),
          dScale: [+lerp(ds0[0] || 0, ds1[0] || 0).toFixed(4), +lerp(ds0[1] || 0, ds1[1] || 0).toFixed(4)],
          dOp: +lerp(a.dOp || 0, b.dOp || 0).toFixed(3),
        };
      }
      newSample.nodes = nodes;
    }

    const insertAt = P.samples.findIndex((s) => s.angle > ang);
    const idx = insertAt < 0 ? P.samples.length : insertAt;
    P.samples.splice(idx, 0, newSample);
    this.snapToSample(idx);
    this.emit("pack:mutated", { structural: true });
    return { ok: true, idx, deg: +(na * 32.5).toFixed(1) };
  }

  deleteYawKeyform(idx = this.activeSampleIdx) {
    const P = this.pack;
    if (!P || !P.samples || P.samples.length <= 2) {
      return { ok: false, reason: t("state.minYawKeys", null, "Need at least 2 Angle X keyforms") };
    }
    if (idx < 0 || idx >= P.samples.length) return { ok: false, reason: t("state.invalidYawKey", null, "Invalid Angle X keyform") };
    if (Math.abs(P.samples[idx].angle) < 1e-4) {
      return { ok: false, reason: t("state.noDelCenterYaw", null, "Cannot delete the 0° center rest keyform") };
    }
    this.pushUndo("Delete Angle X Keyform");
    P.samples.splice(idx, 1);
    const nextIdx = Math.max(0, Math.min(P.samples.length - 1, idx - 1));
    this.snapToSample(nextIdx);
    this.emit("pack:mutated", { structural: true });
    return { ok: true, idx: nextIdx };
  }

  /* ---------- Angle Y (Pitch) Keyforms ---------- */
  _findClosestPitchIdx(ps, p) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < ps.length; i++) {
      const d = Math.abs(ps[i].pitch - p);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  getPitchSamplesView() {
    const ps = this.pack && this.pack.pitchSamples;
    if (ps && ps.length) return ps;
    return [{ pitch: -1, layers: {} }, { pitch: 0, layers: {} }, { pitch: 1, layers: {} }];
  }

  ensurePitchSamples() {
    if (!this.pack) return [];
    if (!Array.isArray(this.pack.pitchSamples) || !this.pack.pitchSamples.length) {
      this.pack.pitchSamples = [
        { pitch: -1.0, layers: {} },
        { pitch: 0.0, layers: {} },
        { pitch: 1.0, layers: {} },
      ];
    }
    this.pack.pitchSamples.sort((a, b) => a.pitch - b.pitch);
    return this.pack.pitchSamples;
  }

  setPitch(p, snapPitch = false) {
    this.params.pitch = clamp(p, -1, 1);
    this.snapToPitch = Boolean(snapPitch);
    const ps = this.getPitchSamplesView();
    const best = this._findClosestPitchIdx(ps, this.params.pitch);
    this.activePitchIdx = best;
    if (snapPitch) {
      this.params.pitch = ps[best].pitch;
    }
    if (this.rigTarget.type === "pitch") this.rigTarget.idx = best;
    this.emit("params:changed");
  }

  snapToPitchSample(pitchIdx) {
    const ps = this.ensurePitchSamples();
    if (pitchIdx < 0 || pitchIdx >= ps.length) return;
    this.activePitchIdx = pitchIdx;
    this.params.pitch = ps[pitchIdx].pitch;
    this.snapToPitch = true;
    if (Math.abs(ps[pitchIdx].pitch) < 1e-4) {
      // Center 0° pitch returns to active Yaw keyform target cleanly
      this.rigTarget = { type: "yaw", idx: this.activeSampleIdx };
    } else {
      this.rigTarget = { type: "pitch", idx: pitchIdx };
    }
    this.emit("params:changed");
    this.emit("rigTarget:changed");
  }

  addPitchKeyform(pitchVal = this.params.pitch) {
    if (!this.pack) return { ok: false, reason: t("state.noModelLoaded", null, "No model loaded") };
    const p = +clamp(pitchVal, -1, 1).toFixed(4);
    const ps = this.ensurePitchSamples();
    for (let i = 0; i < ps.length; i++) {
      if (Math.abs(ps[i].pitch - p) < 0.04) {
        this.snapToPitchSample(i);
        return { ok: false, reason: t("state.pitchExists", { deg: (ps[i].pitch * 30).toFixed(1) }, "Angle Y keyform already exists near {deg}° (snapped to it)") };
      }
    }
    this.pushUndo("Add Angle Y Keyform");
    const arr = this.ensurePitchSamples();
    // Interpolate existing deltas from neighbors
    let lo = 0;
    while (lo + 1 < arr.length && arr[lo + 1].pitch < p) lo++;
    const s0 = arr[lo], s1 = arr[Math.min(lo + 1, arr.length - 1)];
    const f = s1.pitch === s0.pitch ? 0 : clamp((p - s0.pitch) / (s1.pitch - s0.pitch), 0, 1);
    const layers = {};
    const ids = new Set([...Object.keys(s0.layers || {}), ...Object.keys(s1.layers || {})]);
    for (const id of ids) {
      const a = s0.layers?.[id] || {}, b = s1.layers?.[id] || {};
      const dt0 = a.dt || [0, 0], dt1 = b.dt || [0, 0];
      const ds0 = a.dScale || [0, 0], ds1 = b.dScale || [0, 0];
      const entry = {
        dt: [+(dt0[0] + (dt1[0] - dt0[0]) * f).toFixed(2), +(dt0[1] + (dt1[1] - dt0[1]) * f).toFixed(2)],
        dRot: +((a.dRot || 0) + ((b.dRot || 0) - (a.dRot || 0)) * f).toFixed(3),
        dScale: [+(ds0[0] + (ds1[0] - ds0[0]) * f).toFixed(4), +(ds0[1] + (ds1[1] - ds0[1]) * f).toFixed(4)],
        dOp: +((a.dOp || 0) + ((b.dOp || 0) - (a.dOp || 0)) * f).toFixed(3),
      };
      const fG = lerpGrids(a.F, b.F, f);
      if (fG) entry.F = fG.map((v) => +v.toFixed(5));
      layers[id] = entry;
    }
    const newPitch = { pitch: p, layers };
    if ((s0.nodes && Object.keys(s0.nodes).length) || (s1.nodes && Object.keys(s1.nodes).length)) {
      const nodes = {};
      const nids = new Set([...Object.keys(s0.nodes || {}), ...Object.keys(s1.nodes || {})]);
      for (const nid of nids) {
        const a = s0.nodes?.[nid] || {}, b = s1.nodes?.[nid] || {};
        const dt0 = a.dt || [0, 0], dt1 = b.dt || [0, 0];
        const ds0 = a.dScale || [0, 0], ds1 = b.dScale || [0, 0];
        nodes[nid] = {
          dt: [+(dt0[0] + (dt1[0] - dt0[0]) * f).toFixed(2), +(dt0[1] + (dt1[1] - dt0[1]) * f).toFixed(2)],
          dRot: +((a.dRot || 0) + ((b.dRot || 0) - (a.dRot || 0)) * f).toFixed(3),
          dScale: [+(ds0[0] + (ds1[0] - ds0[0]) * f).toFixed(4), +(ds0[1] + (ds1[1] - ds0[1]) * f).toFixed(4)],
          dOp: +((a.dOp || 0) + ((b.dOp || 0) - (a.dOp || 0)) * f).toFixed(3),
        };
      }
      newPitch.nodes = nodes;
    }
    const ins = arr.findIndex((s) => s.pitch > p);
    const idx = ins < 0 ? arr.length : ins;
    arr.splice(idx, 0, newPitch);
    this.snapToPitchSample(idx);
    this.emit("pack:mutated", { structural: true });
    return { ok: true, idx, deg: +(p * 30).toFixed(1) };
  }

  deletePitchKeyform(idx = this.activePitchIdx) {
    const ps = this.pack && this.pack.pitchSamples;
    if (!ps || ps.length <= 2) return { ok: false, reason: t("state.minPitchKeys", null, "Need at least 2 Angle Y keyforms") };
    if (idx < 0 || idx >= ps.length) return { ok: false, reason: t("state.invalidPitchKey", null, "Invalid Angle Y keyform") };
    if (Math.abs(ps[idx].pitch) < 1e-4) return { ok: false, reason: t("state.noDelCenterPitch", null, "Cannot delete the 0° center Angle Y keyform") };
    this.pushUndo("Delete Angle Y Keyform");
    ps.splice(idx, 1);
    const nextIdx = Math.max(0, Math.min(ps.length - 1, idx - 1));
    this.snapToPitchSample(nextIdx);
    this.emit("pack:mutated", { structural: true });
    return { ok: true, idx: nextIdx };
  }

  /* ---------- Blend Shapes ---------- */
  getBlendShape(id) {
    if (!this.pack || !this.pack.blendShapes) return null;
    return this.pack.blendShapes.find((b) => b.id === id) || null;
  }

  getActiveBlendShape() {
    if (this.rigTarget.type !== "blend") return null;
    return this.getBlendShape(this.rigTarget.id);
  }

  addBlendShape(name, opts = {}) {
    if (!this.pack) return null;
    this.pushUndo("Add Blend Shape");
    this.pack.blendShapes = this.pack.blendShapes || [];
    const clean = (name || "Blend Shape").trim() || "Blend Shape";
    const baseId = "bs_" + clean.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const used = new Set(this.pack.blendShapes.map((b) => b.id));
    let id = baseId || "bs_shape", k = 2;
    while (used.has(id)) id = `${baseId}_${k++}`;
    const bs = {
      id,
      name: clean,
      min: opts.min ?? 0,
      max: opts.max ?? 1,
      default: opts.default ?? 0,
      bind: opts.bind ?? null,
      layers: {},
    };
    this.pack.blendShapes.push(bs);
    this.params.blend[id] = 1.0; // activate at 1.0 so the rigger sees their sculpt immediately!
    this.rigTarget = { type: "blend", id };
    this.emit("pack:mutated", { structural: true });
    this.emit("params:changed");
    this.emit("rigTarget:changed");
    return bs;
  }

  deleteBlendShape(id) {
    const BS = this.pack && this.pack.blendShapes;
    if (!BS) return false;
    const idx = BS.findIndex((b) => b.id === id);
    if (idx < 0) return false;
    this.pushUndo("Delete Blend Shape");
    BS.splice(idx, 1);
    delete this.params.blend[id];
    for (const F of Object.values(this.pack.expr?.faces || {})) {
      if (F.blend && id in F.blend) delete F.blend[id];
    }
    if (this.rigTarget.type === "blend" && this.rigTarget.id === id) {
      this.rigTarget = { type: "yaw", idx: this.activeSampleIdx };
    }
    this.emit("pack:mutated", { structural: true });
    this.emit("params:changed");
    this.emit("rigTarget:changed");
    return true;
  }

  setBlendWeight(id, w) {
    const bs = this.getBlendShape(id);
    if (!bs) return;
    this.params.blend[id] = clamp(w, bs.min ?? 0, bs.max ?? 1);
    this.emit("params:changed");
  }

  setRigTarget(target) {
    if (!target) return;
    if (target.type === "yaw") {
      this.snapToSample(target.idx ?? this.activeSampleIdx);
      return;
    }
    if (target.type === "pitch") {
      this.snapToPitchSample(target.idx ?? this.activePitchIdx);
      return;
    }
    if (target.type === "blend") {
      const bs = this.getBlendShape(target.id);
      if (!bs) return;
      this.rigTarget = { type: "blend", id: bs.id };
      if (Math.abs(this.params.blend[bs.id] ?? 0) < 0.05) {
        this.params.blend[bs.id] = bs.max ?? 1;
      }
      this.emit("params:changed");
      this.emit("rigTarget:changed");
    }
  }

  getRigTargetLabel() {
    if (!this.pack) return "—";
    if (this.rigTarget.type === "blend") {
      const bs = this.getBlendShape(this.rigTarget.id);
      if (bs) {
        const w = this.params.blend[bs.id] ?? bs.default ?? 0;
        return t("param.blendTarget", { name: bs.name, weight: w.toFixed(2) }, "Blend: {name} ({weight})");
      }
    }
    if (this.rigTarget.type === "pitch") {
      const ps = this.getPitchSamplesView();
      const s = ps[this.activePitchIdx];
      if (s && Math.abs(s.pitch) > 1e-4) {
        const d = s.pitch * 30;
        return t("param.angleYDeg", { deg: `${d >= 0 ? "+" : ""}${d.toFixed(1)}` }, "Angle Y {deg}°");
      }
    }
    const S = this.pack.samples || [];
    const s = S[this.activeSampleIdx];
    const deg = s ? this._normAngleOf(s.angle) * 32.5 : this.params.a * 32.5;
    return t("param.angleXDeg", { deg: `${deg >= 0 ? "+" : ""}${deg.toFixed(1)}` }, "Angle X {deg}°");
  }

  /**
   * Return the editable target object for the selected layer according to `this.rigTarget`.
   * For Angle X: returns pack.samples[si].layers[layerIdx] (`kind: "yaw"`).
   * For Angle Y: returns pack.pitchSamples[pi].layers[L.id] (`kind: "pitch"`).
   * For Blend Shape: returns bs.layers[L.id] (`kind: "blend"`).
   */
  getEditTargetForLayer(layerIdx = this.selectedLayerIdx, createIfMissing = false) {
    const P = this.pack;
    if (!P || layerIdx < 0 || layerIdx >= P.layers.length) return null;
    const L = P.layers[layerIdx];

    if (this.rigTarget.type === "blend") {
      const bs = this.getBlendShape(this.rigTarget.id);
      if (bs) {
        let w = this.params.blend[bs.id] ?? bs.default ?? 0;
        if (createIfMissing && Math.abs(w) < 0.05) {
          w = bs.max ?? 1;
          this.params.blend[bs.id] = w;
        }
        bs.layers = bs.layers || {};
        if (createIfMissing && !bs.layers[L.id]) {
          bs.layers[L.id] = { dt: [0, 0], dRot: 0, dScale: [0, 0], dOp: 0 };
        }
        return { kind: "blend", bs, layerId: L.id, obj: bs.layers[L.id] || null, weightScale: w || 1 };
      }
    }

    if (this.rigTarget.type === "pitch") {
      const ps = createIfMissing ? this.ensurePitchSamples() : this.getPitchSamplesView();
      const pi = Math.max(0, Math.min(ps.length - 1, this.activePitchIdx));
      const sample = ps[pi];
      if (sample && Math.abs(sample.pitch) > 1e-4) {
        sample.layers = sample.layers || {};
        if (createIfMissing && !sample.layers[L.id]) {
          sample.layers[L.id] = { dt: [0, 0], dRot: 0, dScale: [0, 0], dOp: 0 };
        }
        return { kind: "pitch", pitchIdx: pi, sample, layerId: L.id, obj: sample.layers[L.id] || null, weightScale: 1 };
      }
    }

    const si = Math.max(0, Math.min(P.samples.length - 1, this.activeSampleIdx));
    return { kind: "yaw", sampleIdx: si, layerId: L.id, obj: P.samples[si]?.layers[layerIdx] || null, weightScale: 1 };
  }

  /* ---------- Mode, Tool, Selection & Layer Sync ---------- */
  setMode(mode) {
    this.mode = mode;
    if (mode === "animate") {
      this.tool = "select";
      this.timeline.expanded = true;
      this.view.showLattice = false;
      this.view.showChains = false;
      this.view.showPivots = false;
    } else if (mode === "expressions") {
      this.tool = "select";
      this.inspectorTab = "expressions";
      this.view.showLattice = false;
      this.view.showChains = false;
      this.view.showPivots = false;
    } else if (mode === "physics") {
      this.inspectorTab = "physics";
      this.tool = "chain";
      this.view.showChains = true;
      this.view.showLattice = false;
    } else if (mode === "mesh") {
      this.inspectorTab = "warp";
      this.tool = "mesh";
      this.view.showLattice = true;
    } else if (mode === "rig") {
      this.inspectorTab = "layer";
      this.tool = "warp_brush";
      this.view.showLattice = true;
      this.view.showChains = true;
      this.timeline.expanded = false;
    } else if (mode === "model") {
      this.inspectorTab = "layer";
      this.tool = "transform";
      this.view.showLattice = false;
      this.view.showPivots = true;
    }
    this.emit("mode:changed");
    this.emit("view:changed");
  }

  setTool(tool) {
    this.tool = tool;
    if (tool === "warp_brush" || tool === "lattice" || tool === "mesh") this.view.showLattice = true;
    if (tool === "chain") this.view.showChains = true;
    if (tool === "pivot") this.view.showPivots = true;
    this.emit("tool:changed");
    this.emit("view:changed");
  }

  selectLayer(idx) {
    if (this.selectedLayerIdx !== idx) {
      this.selectedVerts.clear();
    }
    this.selectedLayerIdx = idx;
    if (idx >= 0) this.selectedNodeId = null;
    this.emit("selection:changed");
  }

  renameLayerDeltas(oldId, newId) {
    if (!this.pack) return;
    for (const L of this.pack.layers || []) {
      if (L.parent === oldId) L.parent = newId;
    }
    for (const N of this.pack.nodes || []) {
      if (N.parent === oldId) N.parent = newId;
    }
    for (const ps of this.pack.pitchSamples || []) {
      if (ps.layers && oldId in ps.layers) {
        ps.layers[newId] = ps.layers[oldId];
        delete ps.layers[oldId];
      }
    }
    for (const bs of this.pack.blendShapes || []) {
      if (bs.layers && oldId in bs.layers) {
        bs.layers[newId] = bs.layers[oldId];
        delete bs.layers[oldId];
      }
    }
  }

  deleteLayerDeltas(layerId) {
    if (!this.pack) return;
    for (const L of this.pack.layers || []) {
      if (L.parent === layerId) delete L.parent;
    }
    for (const N of this.pack.nodes || []) {
      if (N.parent === layerId) delete N.parent;
    }
    for (const ps of this.pack.pitchSamples || []) {
      if (ps.layers && layerId in ps.layers) delete ps.layers[layerId];
    }
    for (const bs of this.pack.blendShapes || []) {
      if (bs.layers && layerId in bs.layers) delete bs.layers[layerId];
    }
  }

  reorderLayer(fromIdx, toIdx) {
    if (!this.pack || fromIdx === toIdx) return;
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= this.pack.layers.length || toIdx >= this.pack.layers.length) return;
    this.pushUndo("Reorder Layer");
    const [layer] = this.pack.layers.splice(fromIdx, 1);
    this.pack.layers.splice(toIdx, 0, layer);
    for (const s of this.pack.samples) {
      const [sl] = s.layers.splice(fromIdx, 1);
      s.layers.splice(toIdx, 0, sl);
    }
    if (this.selectedLayerIdx === fromIdx) this.selectedLayerIdx = toIdx;
    this.emit("pack:mutated", { structural: true });
    this.emit("selection:changed");
  }

  getActiveClip() {
    if (!this.studio || !this.studio.clips || !this.studio.clips.length) return null;
    const i = Math.max(0, Math.min(this.studio.clips.length - 1, this.timeline.clipIdx));
    return this.studio.clips[i];
  }
}
