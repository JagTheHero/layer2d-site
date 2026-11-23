/**
 * Layer2D Studio — Entry Point & Application Controller
 * Pure client-side WebGL2 avatar rigging & animation studio (zero backend).
 */

import { StudioState } from "./state.js";
import { Layer2DEngine, loadImageFromBytes } from "./engine.js";
import { ViewportController } from "./viewport.js";
import { LeftPanels } from "./panels_left.js";
import { RightInspector } from "./panels_right.js";
import { TimelineController } from "./timeline.js";
import {
  readL2D,
  buildL2D,
  canvasToBytes,
  saveBytesToDisk,
  saveAutosave,
  loadAutosave,
} from "./l2d_io.js";
import { parsePSD, buildPackFromPSD } from "./psd_import.js";
import {
  mirrorLayerKeyform,
  interpolateLayerKeyform,
  smoothGrid,
} from "./warp_math.js";
import { hasSceneGraph, buildSceneGraph, wouldCreateCycle } from "./scene_graph.js";

const state = new StudioState();
const glCanvas = document.getElementById("gl-canvas");
const overlayCanvas = document.getElementById("overlay-canvas");
const stageFrame = document.getElementById("stage-frame");
const toastEl = document.getElementById("toast");
const dropVeil = document.getElementById("drop-veil");

let engine;
try {
  engine = new Layer2DEngine(glCanvas);
} catch (err) {
  showToast(err.message, 8000);
  throw err;
}

let toastTimer = null;
function showToast(msg, ms = 2800) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

/* ---------- Subsystems ---------- */
const viewport = new ViewportController(state, engine, overlayCanvas, stageFrame);
const leftPanels = new LeftPanels(state, engine, handleAction);
const rightInspector = new RightInspector(state, engine, handleAction);
const timeline = new TimelineController(state, engine, showToast);

/* ---------- Live Mic AEIOU Lip-Sync & Webcam Preview inside Studio ---------- */
const mic = { on: false, ctx: null, analyser: null, stream: null, bins: null };
const cam = { on: false, stream: null, video: document.getElementById("cam-video"), canvas: null, ctx: null, prev: null };

async function toggleMic() {
  const btn = document.getElementById("vp-mic");
  if (mic.on) {
    mic.on = false;
    if (mic.stream) mic.stream.getTracks().forEach((t) => t.stop());
    if (mic.ctx) mic.ctx.close();
    mic.stream = mic.ctx = mic.analyser = null;
    state.params.vowel = null;
    btn.classList.remove("live");
    state.emit("params:changed");
    return;
  }
  try {
    mic.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mic.ctx = new AudioContext();
    const src = mic.ctx.createMediaStreamSource(mic.stream);
    mic.analyser = mic.ctx.createAnalyser();
    mic.analyser.fftSize = 1024;
    src.connect(mic.analyser);
    mic.bins = new Uint8Array(mic.analyser.frequencyBinCount);
    mic.on = true;
    btn.classList.add("live");
    showToast("Mic lip-sync active — speak to test AEIOU vowels");
  } catch (e) {
    showToast(`Microphone unavailable: ${e.message}`);
  }
}

function stepMic() {
  if (!mic.on || !mic.analyser) return;
  mic.analyser.getByteFrequencyData(mic.bins);
  const hzPerBin = mic.ctx.sampleRate / mic.analyser.fftSize;
  const band = (f0, f1) => {
    const a = Math.max(0, Math.floor(f0 / hzPerBin));
    const b = Math.min(mic.bins.length - 1, Math.ceil(f1 / hzPerBin));
    let s = 0; for (let i = a; i <= b; i++) s += mic.bins[i];
    return s / Math.max(1, b - a + 1);
  };
  const lo = band(150, 550), mid = band(550, 1400), hi = band(1400, 3200);
  const energy = lo * 0.4 + mid * 0.4 + hi * 0.2;
  if (energy < 24) state.params.vowel = null;
  else if (hi > mid * 1.1 && hi > lo) state.params.vowel = "I";
  else if (mid > lo * 1.15) state.params.vowel = "A";
  else if (lo > mid * 1.35 && hi < 25) state.params.vowel = "U";
  else if (mid > hi * 1.2) state.params.vowel = "O";
  else state.params.vowel = "E";
}

async function toggleCam() {
  const btn = document.getElementById("vp-cam");
  if (cam.on) {
    cam.on = false;
    if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop());
    cam.stream = null;
    btn.classList.remove("live");
    return;
  }
  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
    cam.video.srcObject = cam.stream;
    await cam.video.play();
    cam.canvas = document.createElement("canvas");
    cam.canvas.width = 64; cam.canvas.height = 48;
    cam.ctx = cam.canvas.getContext("2d", { willReadFrequently: true });
    cam.on = true;
    state.snapToKeyform = false;
    btn.classList.add("live");
    showToast("Webcam head-tracking preview active");
  } catch (e) {
    showToast(`Webcam unavailable: ${e.message}`);
  }
}

function stepCam() {
  if (!cam.on || !cam.ctx || cam.video.readyState < 2) return;
  cam.ctx.drawImage(cam.video, 0, 0, 64, 48);
  const d = cam.ctx.getImageData(0, 0, 64, 48).data;
  // Lightweight skin/centroid head tracker (zero external CDN dependency)
  let sx = 0, sy = 0, wSum = 0;
  for (let y = 4; y < 44; y++) {
    for (let x = 8; x < 56; x++) {
      const i = (y * 64 + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const lum = (r + g + b) / 3;
      if (lum > 45 && r >= g * 0.95 && r > b) {
        const w = lum / 255;
        sx += x * w; sy += y * w; wSum += w;
      }
    }
  }
  if (wSum > 10) {
    const nx = ((sx / wSum) / 64 - 0.5) * -2.6;
    const ny = ((sy / wSum) / 48 - 0.48) * -2.4;
    state.params.a += (Math.max(-1, Math.min(1, nx)) - state.params.a) * 0.18;
    state.params.pitch += (Math.max(-1, Math.min(1, ny)) - state.params.pitch) * 0.18;
  }
}

/* ---------- Core File Load / Save / Import Workflows ---------- */
async function openL2DBuffer(buf, fileName, fileHandle = null) {
  showToast(`Loading ${fileName}…`, 15000);
  const { manifest, pack, studio, textures, preview } = await readL2D(buf);
  await engine.load(pack, textures, (done, total) => {
    toastEl.textContent = `Loading ${fileName} (${done}/${total})…`;
  });
  state.loadDocument({ pack, manifest, textures, studio, preview, fileName, fileHandle });
  document.getElementById("doc-title").textContent = fileName;
  showToast(`Loaded ${manifest.name || fileName} (${pack.layers.length} layers, ${pack.samples.length} yaw keyforms)`);
}

async function openL2DFromURL(url, label) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} loading ${url}`);
  await openL2DBuffer(await resp.arrayBuffer(), label);
}

async function importPSDFile(file) {
  showToast(`Parsing PSD ${file.name}…`, 30000);
  const buf = await file.arrayBuffer();
  const psd = parsePSD(buf);
  if (!psd.layers.length) throw new Error("No visible raster layers found in PSD.");
  const baseName = file.name.replace(/\.psd$/i, "");
  showToast(`Rigging ${psd.layers.length} layers (${psd.width}×${psd.height})…`, 30000);
  const { pack, textures, studio } = await buildPackFromPSD(psd, baseName, { samples: 9 });
  await engine.load(pack, textures);
  const fileName = `${baseName.toLowerCase().replace(/[^a-z0-9_-]+/g, "_") || "avatar"}.l2d`;
  state.loadDocument({
    pack,
    manifest: { id: baseName.toLowerCase().replace(/[^a-z0-9_-]+/g, "_"), name: baseName, license: "MIT" },
    textures,
    studio,
    preview: null,
    fileName,
  });
  document.getElementById("doc-title").textContent = fileName;
  showToast(`Imported PSD: ${pack.layers.length} layers rigged across ${pack.samples.length} yaw keyforms`);
}

async function addImageLayer(file) {
  if (!state.pack) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const im = await loadImageFromBytes(bytes, file.name);
  const c = document.createElement("canvas");
  c.width = im.width; c.height = im.height;
  c.getContext("2d").drawImage(im, 0, 0);
  const enc = await canvasToBytes(c, "image/webp", 0.92);

  const used = new Set(state.pack.layers.map((l) => l.id));
  let base = file.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]+/g, "_") || "Layer";
  let id = base, k = 2;
  while (used.has(id)) id = `${base}_${k++}`;

  state.pushUndo("Add Image Layer");
  state.textures[`tex/${id}.${enc.ext}`] = enc.bytes;
  engine.setTextureFromImage(id, im, true);

  const cx = state.pack.head?.centre?.[0] ?? state.pack.canvas[0] * 0.5;
  const cy = state.pack.head?.centre?.[1] ?? state.pack.canvas[1] * 0.3;
  state.pack.layers.push({
    id, w: im.width, h: im.height, kind: 0, head: true, jaw: false, noFade: true,
    hole: false, clip: null, clipTarget: false, pad: 320.0, pitchGroup: "face",
  });
  for (const s of state.pack.samples) {
    s.layers.push({ A: [1, 0, 0, 1], t: [cx, cy], op: 1.0, turn: s.angle * 0.7 });
  }
  state.studio.layers[id] = { label: id, folder: "Imported" };
  state.selectLayer(state.pack.layers.length - 1);
  state.emit("pack:mutated", { structural: true });
  showToast(`Added layer ${id} (${im.width}×${im.height})`);
}

async function replaceSelectedTexture(file) {
  const L = state.getSelectedLayer();
  if (!L) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const im = await loadImageFromBytes(bytes, file.name);
  const c = document.createElement("canvas");
  c.width = im.width; c.height = im.height;
  c.getContext("2d").drawImage(im, 0, 0);
  const enc = await canvasToBytes(c, "image/webp", 0.92);

  state.pushUndo("Replace Texture");
  const ext = state.pack.texExt || "webp";
  delete state.textures[`tex/${L.id}.webp`];
  delete state.textures[`tex/${L.id}.png`];
  state.textures[`tex/${L.id}.${enc.ext}`] = enc.bytes;
  L.w = im.width;
  L.h = im.height;
  engine.setTextureFromImage(L.id, im, true);
  state.emit("pack:mutated", { structural: true });
  showToast(`Replaced texture for ${L.id} (${im.width}×${im.height})`);
}

async function importFXPiece(file) {
  if (!state.pack) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const im = await loadImageFromBytes(bytes, file.name);
  const base = file.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]+/g, "_") || "fx";
  const colsStr = prompt("Flipbook columns (enter 1 for a static overlay image):", "1");
  const cols = Math.max(1, parseInt(colsStr || "1", 10) || 1);
  const rows = cols > 1 ? Math.max(1, parseInt(prompt("Flipbook rows:", "1") || "1", 10) || 1) : 1;
  const fps = cols * rows > 1 ? Math.max(1, parseInt(prompt("Flipbook FPS:", "12") || "12", 10) || 12) : 0;

  state.pushUndo("Import FX Piece");
  const id = `FX_${base}`;
  state.textures[`tex/expr_${id}.png`] = bytes;
  engine.setTextureFromImage("expr_" + id, im, true);
  const anchorId = state.getSelectedLayer()?.id || state.pack.layers[state.pack.layers.length - 1]?.id;
  state.pack.expr = state.pack.expr || { pieces: {}, faces: {}, holds: {}, vowels: {} };
  state.pack.expr.pieces[id] = {
    base: anchorId,
    w: Math.round(im.width / cols),
    h: Math.round(im.height / rows),
    relA: [1, 0, 0, 1],
    relT: [0, 0],
    op: 1.0,
    ...(cols * rows > 1 ? { atlas: { cols, rows, fps, intro: 0, loop: cols * rows, pad: [0, 0] } } : {}),
  };
  if (state.selectedExprName && state.pack.expr.faces[state.selectedExprName]) {
    const F = state.pack.expr.faces[state.selectedExprName];
    F.add = [...new Set([...(F.add || []), id])];
  }
  state.emit("pack:mutated", { structural: true });
  showToast(`Imported FX piece ${id}`);
}

async function saveOrExportL2D(forcePicker = false) {
  if (!state.pack) return;
  showToast("Packing & hashing .l2d bundle…", 15000);
  const preview = state.preview || (await engine.capturePreviewPNG(600, 800));
  const { bytes, manifest } = await buildL2D({
    pack: state.pack,
    manifest: state.manifest,
    textures: state.textures,
    studio: state.studio,
    preview,
  });
  state.manifest = manifest;
  state.preview = preview;
  const res = await saveBytesToDisk(bytes, state.fileName || `${manifest.id}.l2d`, forcePicker ? null : state.fileHandle);
  if (res.mode === "cancelled") { showToast("Export cancelled"); return; }
  if (res.handle) state.fileHandle = res.handle;
  state.dirty = false;
  await saveAutosave(bytes, state.fileName);
  showToast(`Saved ${state.fileName} (${(bytes.length / 1e6).toFixed(2)} MB, SHA-256 verified)`);
}

/* ---------- Central Action Dispatcher ---------- */
async function handleAction(act) {
  const st = state;
  const P = st.pack;
  try {
    if (act === "open-l2d") {
      if (typeof window.showOpenFilePicker === "function") {
        try {
          const [handle] = await window.showOpenFilePicker({
            types: [{ description: "Layer2D Avatar (.l2d)", accept: { "application/zip": [".l2d"] } }],
          });
          const f = await handle.getFile();
          return await openL2DBuffer(await f.arrayBuffer(), f.name, handle);
        } catch (e) { if (e && e.name === "AbortError") return; }
      }
      document.getElementById("file-l2d").click();
    } else if (act === "import-psd") {
      document.getElementById("file-psd").click();
    } else if (act === "import-layer") {
      document.getElementById("file-img").click();
    } else if (act === "replace-tex") {
      document.getElementById("file-replace-tex").click();
    } else if (act === "import-fx") {
      document.getElementById("file-fx-tex").click();
    } else if (act === "save-l2d") {
      await saveOrExportL2D(false);
    } else if (act === "export-l2d") {
      await saveOrExportL2D(true);
    } else if (act === "load-demo") {
      try {
        await openL2DFromURL("../player/test-signal.l2d", "test-signal.l2d");
      } catch (_) {
        await openL2DFromURL("../models/test-signal/test-signal.l2d", "test-signal.l2d");
      }
    } else if (act === "restore-draft") {
      const draft = await loadAutosave();
      if (!draft) { showToast("No autosave draft found"); return; }
      await openL2DBuffer(draft.bytes.buffer, draft.name || "autosave.l2d");
    } else if (act === "undo") {
      if (st.undo()) showToast("Undo");
    } else if (act === "redo") {
      if (st.redo()) showToast("Redo");
    } else if (act === "dup-layer" && P) {
      const L = st.getSelectedLayer();
      if (!L) return;
      st.pushUndo("Duplicate Layer");
      const used = new Set(P.layers.map((l) => l.id));
      let nid = `${L.id}_copy`, k = 2;
      while (used.has(nid)) nid = `${L.id}_copy${k++}`;
      const ext = P.texExt || "webp";
      for (const e of [ext, "webp", "png"]) {
        if (st.textures[`tex/${L.id}.${e}`]) {
          st.textures[`tex/${nid}.${e}`] = st.textures[`tex/${L.id}.${e}`].slice();
        }
      }
      if (engine.tex[L.id]) engine.tex[nid] = engine.tex[L.id];
      if (engine.alphaMaps[L.id]) engine.alphaMaps[nid] = engine.alphaMaps[L.id];
      const ins = st.selectedLayerIdx + 1;
      P.layers.splice(ins, 0, { ...JSON.parse(JSON.stringify(L)), id: nid });
      for (const s of P.samples) {
        const clone = JSON.parse(JSON.stringify(s.layers[st.selectedLayerIdx]));
        clone.t[0] += 18; clone.t[1] += 18;
        s.layers.splice(ins, 0, clone);
      }
      st.studio.layers[nid] = { ...(st.studio.layers[L.id] || { folder: "Layers" }), label: nid };
      st.selectLayer(ins);
      st.emit("pack:mutated", { structural: true });
      showToast(`Duplicated ${L.id} → ${nid}`);
    } else if (act === "add-group" && P) {
      const selL = st.getSelectedLayer();
      const selN = st.getSelectedNode();
      const defName = selL ? `${selL.id} Group` : `Group ${(P.nodes?.length || 0) + 1}`;
      const name = prompt("New Transform Group name (e.g. Eye R, Head Rig, Hair Group):", defName);
      if (!name) return;
      const opts = {};
      if (selL) {
        if (selL.parent) opts.parent = selL.parent;
        opts.adoptChildIds = [selL.id];
      } else if (selN) {
        opts.parent = selN.id;
      }
      const node = st.addGroupNode(name, opts);
      if (node) {
        st.setTool("transform");
        showToast(`Created group "${node.name}" (${node.id}) — drag gizmo or attach child layers`);
      }
    } else if (act === "del-layer" && P) {
      if (st.selectedNodeId && st.getSelectedNode()) {
        const n = st.getSelectedNode();
        st.deleteGroupNode(n.id);
        showToast(`Deleted group ${n.name || n.id} (children promoted)`);
        return;
      }
      const L = st.getSelectedLayer();
      if (!L || P.layers.length <= 1) return;
      st.pushUndo("Delete Layer");
      const idx = st.selectedLayerIdx;
      P.layers.splice(idx, 1);
      for (const s of P.samples) s.layers.splice(idx, 1);
      st.deleteLayerDeltas(L.id);
      st.selectLayer(Math.max(0, idx - 1));
      st.emit("pack:mutated", { structural: true });
      showToast(`Deleted layer ${L.id}`);
    } else if (act === "reset-warp") {
      const tgt = st.getEditTargetForLayer(st.selectedLayerIdx, false);
      if (!tgt?.obj) return;
      st.pushUndo("Reset Mesh");
      delete tgt.obj.F;
      if (tgt.kind === "yaw") delete tgt.obj.D;
      st.emit("pack:mutated");
      showToast(`Mesh reset on ${st.getRigTargetLabel()}`);
    } else if (act === "smooth-warp") {
      const tgt = st.getEditTargetForLayer(st.selectedLayerIdx, false);
      if (!tgt?.obj) return;
      st.pushUndo("Smooth Mesh");
      smoothGrid(tgt.obj, 0.35);
      st.emit("pack:mutated");
    } else if (act === "add-yaw-key" && P) {
      const res = st.addYawKeyform(st.params.a);
      showToast(res.ok ? `Added Angle X keyform at ${res.deg}°` : res.reason);
    } else if (act === "del-yaw-key" && P) {
      const res = st.deleteYawKeyform(st.activeSampleIdx);
      showToast(res.ok ? "Deleted Angle X keyform" : res.reason);
    } else if (act === "add-pitch-key" && P) {
      const res = st.addPitchKeyform(st.params.pitch);
      showToast(res.ok ? `Added Angle Y keyform at ${res.deg}°` : res.reason);
    } else if (act === "del-pitch-key" && P) {
      const res = st.deletePitchKeyform(st.activePitchIdx);
      showToast(res.ok ? "Deleted Angle Y keyform" : res.reason);
    } else if (act === "new-blend-shape" && P) {
      const n = (P.blendShapes?.length || 0) + 1;
      const name = prompt("New Blend Shape name (e.g. Cheek Puff, Brow Up, Smile Warp):", `Blend ${n}`);
      if (!name) return;
      const bs = st.addBlendShape(name);
      if (bs) showToast(`Editing Blend Shape "${bs.name}" — sculpt with Brush, Lattice, Mesh, or Transform`);
    } else if (act === "view-bust") {
      st.resetCamera("bust");
    } else if (act === "view-full") {
      st.resetCamera("full");
    } else if (act === "view-layer" && P) {
      const L = st.getSelectedLayer(), SL = st.getActiveSampleLayer();
      if (!L || !SL) return;
      const hw = Math.max(L.w, L.h) * 0.95;
      st.view.rect = [SL.t[0] - hw, SL.t[1] - hw, SL.t[0] + hw, SL.t[1] + hw];
      st.emit("view:changed");
    } else if (act === "toggle-solo") {
      const L = st.getSelectedLayer();
      if (!L) return;
      st.soloId = st.soloId === L.id ? null : L.id;
      showToast(st.soloId ? `Solo: ${L.id}` : "Solo off");
    } else if (act === "show-all") {
      st.hiddenIds.clear(); st.soloId = null;
      leftPanels.renderLayerTree();
    } else if (act === "prev-key" && P) {
      st.snapToSample(Math.max(0, st.activeSampleIdx - 1));
    } else if (act === "next-key" && P) {
      st.snapToSample(Math.min(P.samples.length - 1, st.activeSampleIdx + 1));
    } else if (act === "center-key" && P) {
      st.snapToSample(Math.floor(P.samples.length / 2));
    } else if (act === "mirror-lr" && P) {
      if (st.selectedLayerIdx < 0) return;
      const dstIdx = P.samples.length - 1 - st.activeSampleIdx;
      st.pushUndo("Mirror Keyform Left ↔ Right");
      mirrorLayerKeyform(P, st.selectedLayerIdx, st.activeSampleIdx, dstIdx);
      st.snapToSample(dstIdx);
      st.emit("pack:mutated");
      showToast(`Mirrored keyform ${st.activeSampleIdx} → ${dstIdx}`);
    } else if (act === "interp-key" && P) {
      const i = st.activeSampleIdx;
      if (st.selectedLayerIdx < 0 || i <= 0 || i >= P.samples.length - 1) return;
      st.pushUndo("Interpolate Keyform");
      interpolateLayerKeyform(P, st.selectedLayerIdx, i, i - 1, i + 1);
      st.emit("pack:mutated");
      showToast(`Interpolated keyform ${i} from neighbors`);
    } else if (act === "copy-key-all" && P) {
      const SL = st.getActiveSampleLayer();
      if (!SL) return;
      st.pushUndo("Copy Layer Transform to All Angles");
      for (const s of P.samples) {
        s.layers[st.selectedLayerIdx] = JSON.parse(JSON.stringify(SL));
      }
      st.emit("pack:mutated");
      showToast("Copied active keyform transform to all yaw samples");
    } else if (act === "add-chain" && P) {
      st.pushUndo("Add Spring Chain");
      P.chains = P.chains || [];
      const L = st.getSelectedLayer(), SL = st.getActiveSampleLayer();
      const cx = SL ? SL.t[0] : P.head.centre[0];
      const cy = SL ? SL.t[1] - (L ? L.h * 0.3 : 100) : P.head.centre[1];
      const h = L ? Math.max(120, L.h * 0.7) : 240;
      const idx = P.chains.length;
      P.chains.push({
        name: `chain_${idx + 1}`,
        parent: L && !L.head ? "body" : "head",
        k: [0.55, 0.18],
        damp: 0.16,
        joints: [cx, cy, cx, cy + h * 0.33, cx, cy + h * 0.66, cx, cy + h],
        depth: 1.0,
        pin: false,
      });
      if (L) { L.chains = [...new Set([...(L.chains || []), idx])]; L.chainSigma = L.chainSigma || 160; }
      st.selectedChainIdx = idx;
      st.view.showChains = true;
      st.emit("pack:mutated", { structural: true });
      showToast(`Added spring chain chain_${idx + 1}`);
    } else if (act === "physics-impulse") {
      engine.physics.enabled = true;
      engine.impulseChains(950, -320);
      showToast("Applied physics impulse");
    } else if (act === "new-expr" && P) {
      const name = prompt("New expression name:", "Custom");
      if (!name) return;
      st.pushUndo("New Expression");
      P.expr = P.expr || { pieces: {}, faces: {}, holds: {}, vowels: {} };
      P.expr.faces[name] = { hide: [], add: [], move: {}, eyes: [1, 1] };
      st.selectedExprName = name;
      st.params.face = name;
      st.emit("pack:mutated", { structural: true });
      st.emit("params:changed");
    } else if (act === "validate-model" && P) {
      const errs = [];
      if (!P.layers?.length) errs.push("No layers defined");
      if (!P.samples?.length) errs.push("No yaw samples defined");
      for (const s of P.samples || []) {
        if (s.layers.length !== P.layers.length) errs.push(`Sample ${s.angle} layer count mismatch`);
      }
      if (hasSceneGraph(P)) {
        const allIds = new Set([...(P.nodes || []).map((n) => n.id), ...(P.layers || []).map((l) => l.id)]);
        const seenIds = new Set();
        for (const it of [...(P.nodes || []), ...(P.layers || [])]) {
          if (seenIds.has(it.id)) errs.push(`Duplicate scene ID ${it.id}`);
          seenIds.add(it.id);
          if (it.parent && !allIds.has(it.parent)) errs.push(`${it.id} has unknown parent ${it.parent}`);
          if (it.parent && wouldCreateCycle(P, it.id, it.parent)) errs.push(`Cycle detected at ${it.id}`);
        }
      }
      const nNodes = (P.nodes || []).length;
      showToast(errs.length ? `Validation issues: ${errs.join("; ")}` : `layer2d/v1 valid: ${P.layers.length} layers, ${nNodes} groups, ${P.samples.length} samples, ${(P.chains || []).length} chains`, 4500);
    } else if (act === "export-png") {
      const bytes = await engine.capturePreviewPNG(1200, 1600);
      const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      const a = document.createElement("a"); a.href = url; a.download = `${st.manifest.id || "avatar"}_snapshot.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } else if (act === "export-video") {
      await timeline.exportVideo();
    } else if (act === "open-player") {
      window.open("../player/?model=test-signal.l2d", "_blank");
    }
  } catch (err) {
    console.error(err);
    showToast(err.message || String(err), 5000);
  }
}

/* ---------- Top Bar, Menus, Toolbar & Viewport Bar Wiring ---------- */
function closeMenus() {
  document.querySelectorAll(".menu-pop").forEach((m) => { m.hidden = true; });
  document.querySelectorAll(".menu-btn").forEach((b) => b.classList.remove("open"));
}
document.querySelectorAll(".menu-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const pop = document.getElementById("menu-" + btn.dataset.menu);
    const wasOpen = !pop.hidden;
    closeMenus();
    if (!wasOpen) { pop.hidden = false; btn.classList.add("open"); }
  });
});
document.querySelectorAll(".menu-pop button[data-act]").forEach((btn) => {
  btn.addEventListener("click", () => { closeMenus(); handleAction(btn.dataset.act); });
});
window.addEventListener("click", closeMenus);

document.getElementById("btn-import-psd").addEventListener("click", () => handleAction("import-psd"));
document.getElementById("btn-open-l2d").addEventListener("click", () => handleAction("open-l2d"));
document.getElementById("btn-export-l2d").addEventListener("click", () => handleAction("export-l2d"));

document.querySelectorAll(".mode-tab").forEach((tab) => {
  tab.addEventListener("click", () => state.setMode(tab.dataset.mode));
});
document.querySelectorAll(".tool-btn").forEach((btn) => {
  btn.addEventListener("click", () => state.setTool(btn.dataset.tool));
});

function syncChrome() {
  document.querySelectorAll(".mode-tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === state.mode));
  document.querySelectorAll(".tool-btn").forEach((b) => b.classList.toggle("active", b.dataset.tool === state.tool));
  document.getElementById("vp-zoom").textContent = `${Math.round(state.view.zoom * 100)}%`;
  document.getElementById("vp-grid").classList.toggle("active", state.view.showGrid);
  document.getElementById("vp-lattice").classList.toggle("active", state.view.showLattice);
  document.getElementById("vp-chains").classList.toggle("active", state.view.showChains);
  document.getElementById("vp-pivots").classList.toggle("active", state.view.showPivots);
  document.getElementById("vp-onion").classList.toggle("active", state.view.onionSkin);
  document.getElementById("vp-physics").classList.toggle("active", engine.physics.enabled);
  document.getElementById("vp-yaw").textContent = `Yaw ${(state.params.a * 32.5).toFixed(1)}°`;
  const pitchEl = document.getElementById("vp-pitch");
  if (pitchEl) pitchEl.textContent = `Pitch ${(state.params.pitch * 30.0).toFixed(1)}°`;
  const tgtEl = document.getElementById("vp-target");
  if (tgtEl) {
    tgtEl.textContent = state.getRigTargetLabel();
    tgtEl.className = `vp-target-pill mono ${state.rigTarget.type}`;
  }
}
state.on("mode:changed", syncChrome);
state.on("tool:changed", syncChrome);
state.on("view:changed", syncChrome);
state.on("params:changed", syncChrome);
state.on("rigTarget:changed", syncChrome);
state.on("doc:loaded", syncChrome);
state.on("pack:mutated", (d) => {
  if (engine.P !== state.pack) engine.syncPack(state.pack);
  else if (d?.structural) engine.syncPack();
});

const vpTargetBtn = document.getElementById("vp-target");
if (vpTargetBtn) {
  vpTargetBtn.addEventListener("click", () => {
    if (state.rigTarget.type !== "yaw") {
      state.snapToSample(state.activeSampleIdx);
      showToast("Switched editing target back to Angle X");
    }
  });
}

let zoomPreset = "bust";
document.getElementById("vp-zoom").addEventListener("click", () => {
  zoomPreset = zoomPreset === "bust" ? "full" : "bust";
  state.resetCamera(zoomPreset);
});
document.getElementById("vp-grid").addEventListener("click", () => { state.view.showGrid = !state.view.showGrid; syncChrome(); });
document.getElementById("vp-lattice").addEventListener("click", () => { state.view.showLattice = !state.view.showLattice; syncChrome(); });
document.getElementById("vp-chains").addEventListener("click", () => { state.view.showChains = !state.view.showChains; syncChrome(); });
document.getElementById("vp-pivots").addEventListener("click", () => { state.view.showPivots = !state.view.showPivots; syncChrome(); });
document.getElementById("vp-onion").addEventListener("click", () => { state.view.onionSkin = !state.view.onionSkin; syncChrome(); });
document.getElementById("vp-physics").addEventListener("click", () => { engine.physics.enabled = !engine.physics.enabled; syncChrome(); });
document.getElementById("vp-mic").addEventListener("click", toggleMic);
document.getElementById("vp-cam").addEventListener("click", toggleCam);

/* ---------- Hidden File Input Handlers & Drag-and-Drop ---------- */
document.getElementById("file-l2d").addEventListener("change", async (e) => {
  const f = e.target.files?.[0]; e.target.value = "";
  if (f) await openL2DBuffer(await f.arrayBuffer(), f.name);
});
document.getElementById("file-psd").addEventListener("change", async (e) => {
  const f = e.target.files?.[0]; e.target.value = "";
  if (f) await importPSDFile(f);
});
document.getElementById("file-img").addEventListener("change", async (e) => {
  const f = e.target.files?.[0]; e.target.value = "";
  if (f) await addImageLayer(f);
});
document.getElementById("file-replace-tex").addEventListener("change", async (e) => {
  const f = e.target.files?.[0]; e.target.value = "";
  if (f) await replaceSelectedTexture(f);
});
document.getElementById("file-fx-tex").addEventListener("change", async (e) => {
  const f = e.target.files?.[0]; e.target.value = "";
  if (f) await importFXPiece(f);
});

let dragDepth = 0;
window.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; dropVeil.hidden = false; });
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; dropVeil.hidden = true; } });
window.addEventListener("drop", async (e) => {
  e.preventDefault(); dragDepth = 0; dropVeil.hidden = true;
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  try {
    if (/\.l2d$/i.test(f.name)) await openL2DBuffer(await f.arrayBuffer(), f.name);
    else if (/\.psd$/i.test(f.name)) await importPSDFile(f);
    else if (/\.(png|webp|jpe?g)$/i.test(f.name)) await addImageLayer(f);
    else showToast("Drop a .l2d, .psd, .png, or .webp file");
  } catch (err) {
    console.error(err);
    showToast(err.message || String(err), 5000);
  }
});

/* ---------- Keyboard Shortcuts ---------- */
window.addEventListener("keydown", (e) => {
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); handleAction("undo"); return; }
  if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); handleAction("redo"); return; }
  if (mod && k === "s") { e.preventDefault(); handleAction(e.shiftKey ? "export-l2d" : "save-l2d"); return; }
  if (mod && k === "o") { e.preventDefault(); handleAction("open-l2d"); return; }
  if (mod && k === "i") { e.preventDefault(); handleAction("import-psd"); return; }

  if (e.code === "Space") {
    e.preventDefault();
    if (state.mode === "animate" || state.timeline.expanded) {
      state.timeline.playing = !state.timeline.playing;
      timeline.syncPlayButtons();
    } else {
      viewport.spaceHeld = true;
    }
    return;
  }
  if (k === "v") state.setTool("select");
  else if (k === "g") state.setTool("transform");
  else if (k === "b") state.setTool("warp_brush");
  else if (k === "l") state.setTool("lattice");
  else if (k === "m") state.setTool("mesh");
  else if (k === "p") state.setTool("pivot");
  else if (k === "c") state.setTool("chain");
  else if (k === "h") state.setTool("pan");
  else if (k === "[") { state.brush.radius = Math.max(16, state.brush.radius - 16); showToast(`Brush radius: ${state.brush.radius}px`, 900); }
  else if (k === "]") { state.brush.radius = Math.min(400, state.brush.radius + 16); showToast(`Brush radius: ${state.brush.radius}px`, 900); }
  else if (k === "q") handleAction("prev-key");
  else if (k === "e") handleAction("next-key");
  else if (k === "0") handleAction("center-key");
  else if (k === "1") handleAction("view-bust");
  else if (k === "2") handleAction("view-full");
  else if (k === "f") handleAction("view-layer");
  else if (k === "s") handleAction("toggle-solo");
  else if (e.key === "Escape") {
    state.selectedVerts.clear();
  } else if (e.key === "Delete" || e.key === "Backspace") {
    if (state.timeline.expanded && state.timeline.selectedKeyIdx >= 0) {
      e.preventDefault();
      timeline.deleteSelectedKeyframe();
    } else if ((state.tool === "lattice" || state.tool === "mesh") && state.selectedVerts.size > 0) {
      e.preventDefault();
      const t = state.getEditTargetForLayer(state.selectedLayerIdx, false);
      if (t?.obj?.F) {
        state.pushUndo("Reset Selected Mesh Vertices");
        for (const vi of state.selectedVerts) {
          if (vi * 2 + 1 < t.obj.F.length) { t.obj.F[vi * 2] = 0; t.obj.F[vi * 2 + 1] = 0; }
        }
        state.emit("pack:mutated");
        showToast(`Reset ${state.selectedVerts.size} mesh vertices`);
      }
    }
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    viewport.nudgeSelection(dx, dy);
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") viewport.spaceHeld = false;
});

/* ---------- Main 60fps Studio Render Loop ---------- */
let lastTs = performance.now();
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
  lastTs = now;

  try {
    const rect = stageFrame.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (rect.width > 0 && rect.height > 0) {
      engine.resize(rect.width * dpr, rect.height * dpr);
    }

    if (mic.on) stepMic();
    if (cam.on) stepCam();
    if (state.timeline.playing) timeline.step(dt);

    if (state.pack && engine.ready) {
      if (engine.P !== state.pack) engine.syncPack(state.pack);
      engine.render(state.params, state.view.rect, dt, {
        snapSampleIdx: state.snapToKeyform && !state.timeline.playing ? state.activeSampleIdx : null,
        snapPitchIdx: state.snapToPitch && !state.timeline.playing ? state.activePitchIdx : null,
        hiddenIds: state.hiddenIds,
        soloId: state.soloId,
        onionSkin: state.view.onionSkin,
      });
      viewport.drawOverlay();
    }
  } catch (err) {
    console.error("Studio render tick error:", err);
  }
}

/* ---------- Expose Studio Debug/Automation Hook + Startup Load ---------- */
window.__layer2dStudio = {
  state,
  engine,
  viewport,
  timeline,
  openL2DBuffer,
  openL2DFromURL,
  importPSDFile,
  buildL2D: async () => buildL2D({
    pack: state.pack,
    manifest: state.manifest,
    textures: state.textures,
    studio: state.studio,
    preview: await engine.capturePreviewPNG(600, 800),
  }),
};

syncChrome();
requestAnimationFrame(tick);

// Auto-load ?model=... or default Test Signal demo avatar (supports both site/ and repo-root layouts)
const qp = new URLSearchParams(location.search);
const qpModel = qp.get("model");
(async () => {
  const candidates = qpModel ? [qpModel] : ["../player/test-signal.l2d", "../models/test-signal/test-signal.l2d"];
  for (const url of candidates) {
    try {
      await openL2DFromURL(url, url.split("/").pop() || "test-signal.l2d");
      return;
    } catch (_) {}
  }
  showToast("Drop a .l2d or .psd file to begin", 4000);
})();
