/**
 * Layer2D Studio Reactive Document Store
 * Owns:
 *   - Active pack.json, manifest, textures, non-destructive studio.json
 *   - Undo/Redo command history stack (Ctrl+Z / Ctrl+Shift+Z)
 *   - Workspace Mode, Tool, Selection, Parameter state, Viewport camera, Timeline state
 *   - Event emitter for crisp panel synchronization
 */

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
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
        name: "Idle Showcase",
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
            { t: 2.03, v: 1.0, ease: "linear" },
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
    this.selectedChainIdx = -1;
    this.selectedExprName = null;
    this.selectedHoldName = null;
    this.selectedFolderCollapsed = new Set();
    this.hiddenIds = new Set();
    this.lockedIds = new Set();
    this.soloId = null;
    this.layerSearch = "";

    // Parameters & Keyform Lock
    this.params = {
      a: 0,           // -1 .. +1 (displayed as -32.5° .. +32.5°)
      pitch: 0,       // -1 .. +1
      roll: 0,        // radians (-0.35 .. +0.35)
      eyes: 1.0,      // 0 .. 1.3
      vowel: null,    // null | "A" | "I" | "U" | "E" | "O"
      tailWag: 1.0,
      tailSway: 0.0,
      bodySway: 0.0,
      breath: 0.0,
      face: null,
      hold: null,
      wear: {},
    };
    this.activeSampleIdx = 0;     // closest or locked sample index in pack.samples
    this.snapToKeyform = true;    // when true while rigging, edits lock cleanly to activeSampleIdx!

    // Warp / Sculpt Brush settings
    this.brush = {
      radius: 120,
      strength: 0.65,
      mode: "push",   // push | smooth | restore
      gridSize: 5,
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
    this.soloId = null;

    // Default to center (front) sample
    const nS = (pack.samples || []).length;
    this.activeSampleIdx = Math.floor(nS / 2);
    this.params.a = 0;
    this.params.pitch = 0;
    this.params.roll = 0;
    this.params.eyes = 1.0;
    this.params.vowel = null;
    this.params.face = null;
    this.params.hold = null;
    this.params.wear = {};
    for (const [g, o] of Object.entries(pack.outfits || {})) {
      this.params.wear[g] = o.default === false ? 0 : 1;
    }

    // Select a nice prominent default layer (front bangs or face or top layer)
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
      selectedChainIdx: this.selectedChainIdx,
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
      selectedChainIdx: this.selectedChainIdx,
    });
    const prev = this.undoStack.pop();
    this.pack = prev.pack;
    this.studio = prev.studio;
    this.selectedLayerIdx = Math.min(prev.selectedLayerIdx, this.pack.layers.length - 1);
    this.selectedChainIdx = Math.min(prev.selectedChainIdx, (this.pack.chains || []).length - 1);
    this.dirty = true;
    this.emit("pack:mutated", { structural: true });
    this.emit("selection:changed");
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
      selectedChainIdx: this.selectedChainIdx,
    });
    const next = this.redoStack.pop();
    this.pack = next.pack;
    this.studio = next.studio;
    this.selectedLayerIdx = Math.min(next.selectedLayerIdx, this.pack.layers.length - 1);
    this.selectedChainIdx = Math.min(next.selectedChainIdx, (this.pack.chains || []).length - 1);
    this.dirty = true;
    this.emit("pack:mutated", { structural: true });
    this.emit("selection:changed");
    this.emit("history:changed");
    return true;
  }

  /* ---------- Convenience Accessors ---------- */
  getSelectedLayer() {
    if (!this.pack || this.selectedLayerIdx < 0 || this.selectedLayerIdx >= this.pack.layers.length) return null;
    return this.pack.layers[this.selectedLayerIdx];
  }

  getActiveSampleLayer(layerIdx = this.selectedLayerIdx) {
    if (!this.pack || !this.pack.samples.length || layerIdx < 0) return null;
    const si = Math.max(0, Math.min(this.pack.samples.length - 1, this.activeSampleIdx));
    return this.pack.samples[si].layers[layerIdx] || null;
  }

  setAngle(a, snapSample = false) {
    this.params.a = Math.max(-1, Math.min(1, a));
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
    this.emit("params:changed");
  }

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
      this.tool = "lattice";
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
    this.selectedLayerIdx = idx;
    this.emit("selection:changed");
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
