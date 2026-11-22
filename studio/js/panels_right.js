/**
 * Right Inspector Dock:
 *   - Layer Tab: Layer ID, Pitch Group, Draw Order, Behind Occlusion (Off / Active Angle / All Angles), Clip Target, Head/Jaw/NoFade, Replace Texture
 *   - Transform Tab: Position X/Y, Scale X/Y, Rotation°, Opacity, Mirror Left↔Right, Interpolate, Copy to All Angles
 *   - Warp Tab: Warp Grid 3x3..11x11, Brush Mode (Push/Smooth/Restore), Radius, Strength, Smooth Grid, Reset Warp
 *   - Physics Tab: Spring Chain editor (select/add/delete/bind layer/sigma/stiffness/damping/parent/pin), Pelvis-Locked Tail editor, Live Wind/Gravity/Impulse
 *   - Expressions Tab: Expressions CRUD (Hide layers, Add/Import Flipbook FX pieces, Eyes open, Layer Move), Outfits/Toggles CRUD, Pose-Arm Holds & Vowel Mapper
 *   - Animate Mode: CLIP & PHYSICS PREVIEW with interactive Cubic Bezier Curve Editor + Easing Presets + Spring/Wind/Gravity preview sliders!
 */

import {
  decomposeAffine,
  composeAffine,
  gridSizeOf,
  ensureGrid,
  smoothGrid,
} from "./warp_math.js";

const PITCH_GROUPS = ["face", "bangs", "side", "crown", "back", "ear", "humanEar"];

export class RightInspector {
  constructor(state, engine, onAction) {
    this.state = state;
    this.engine = engine;
    this.onAction = onAction;

    this.titleEl = document.getElementById("right-panel-title");
    this.tabsEl = document.getElementById("inspector-tabs");
    this.bodyEl = document.getElementById("inspector-body");

    this.tabsEl.querySelectorAll(".insp-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.state.inspectorTab = btn.dataset.tab;
        this.render();
      });
    });

    const st = this.state;
    st.on("doc:loaded", () => this.render());
    st.on("mode:changed", () => this.render());
    st.on("selection:changed", () => this.render());
    st.on("pack:mutated", (d) => {
      if (d?.silentInspector) return;
      if (document.activeElement && document.activeElement.type === "range" && this.bodyEl.contains(document.activeElement)) return;
      this.render();
    });
    st.on("params:changed", () => {
      if (st.mode !== "animate") this._refreshNumericFields();
    });
  }

  render() {
    const st = this.state;
    const isAnim = st.mode === "animate";
    this.titleEl.textContent = isAnim ? "CLIP & PHYSICS PREVIEW" : "INSPECTOR";
    this.tabsEl.hidden = isAnim;
    this.tabsEl.querySelectorAll(".insp-tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === st.inspectorTab);
    });

    const prevBodyScroll = this.bodyEl.scrollTop;
    const prevScrolls = Object.create(null);
    this.bodyEl.querySelectorAll("[data-scroll-key]").forEach((el) => {
      prevScrolls[el.dataset.scrollKey] = el.scrollTop;
    });

    this.bodyEl.innerHTML = "";
    if (!st.pack) {
      this.bodyEl.innerHTML = `<div class="empty-note">Open a .l2d or .psd file to inspect properties.</div>`;
      return;
    }

    if (isAnim) this._renderAnimatePanel();
    else if (st.inspectorTab === "layer") this._renderLayerTab();
    else if (st.inspectorTab === "transform") this._renderTransformTab();
    else if (st.inspectorTab === "warp") this._renderWarpTab();
    else if (st.inspectorTab === "physics") this._renderPhysicsTab();
    else if (st.inspectorTab === "expressions") this._renderExpressionsTab();

    this.bodyEl.scrollTop = prevBodyScroll;
    this.bodyEl.querySelectorAll("[data-scroll-key]").forEach((el) => {
      const k = el.dataset.scrollKey;
      if (k in prevScrolls) el.scrollTop = prevScrolls[k];
    });
  }

  _refreshNumericFields() {
    // Fast in-place update of live transform readouts during parameter scrubbing (zero DOM churn!)
    const st = this.state;
    if (st.inspectorTab !== "layer" && st.inspectorTab !== "transform") return;
    const SL = st.selectedLayerIdx >= 0
      ? (this.engine.getLiveSampleLayer(st.selectedLayerIdx, st.params, st.snapToKeyform ? st.activeSampleIdx : null) || st.getActiveSampleLayer())
      : null;
    if (!SL) return;
    const dec = decomposeAffine(SL.A || [1, 0, 0, 1]);
    const vals = {
      tx: SL.t[0],
      ty: SL.t[1],
      sx: dec.sx,
      sy: dec.sy,
      rot: dec.rotDeg,
      op: SL.op ?? 1,
      turn: SL.turn || 0,
    };
    this.bodyEl.querySelectorAll("input[data-live-field]").forEach((inp) => {
      if (document.activeElement === inp) return;
      const k = inp.dataset.liveField;
      if (k in vals) inp.value = String(Number(vals[k].toFixed(3)));
    });
  }

  /* ---------- LAYER TAB (matching studio_concept_rigging.png!) ---------- */
  _renderLayerTab() {
    const st = this.state;
    const P = st.pack;
    const L = st.getSelectedLayer();
    const SL = st.getActiveSampleLayer();
    if (!L || !SL) {
      this.bodyEl.innerHTML = `<div class="empty-note">Select a layer from the outliner or canvas.</div>`;
      return;
    }

    const dec = decomposeAffine(SL.A || [1, 0, 0, 1]);
    const gd = gridSizeOf(SL.D) || st.brush.gridSize;
    const behindMode = !L.behind ? "off" : (SL.behind >= 0.5 ? "on" : "off_angle");
    const faceId = P.layers.find((l) => /^F01|face/i.test(l.id))?.id || P.layers[0]?.id || "F01";

    const g1 = this._group();
    g1.append(
      this._textRow("Layer ID", L.id, (val) => {
        const clean = val.trim().replace(/[^A-Za-z0-9_-]/g, "_");
        if (!clean || clean === L.id || P.layers.some((x) => x.id === clean)) return;
        st.pushUndo("Rename Layer");
        const old = L.id;
        L.id = clean;
        const ext = P.texExt || "webp";
        for (const e of [ext, "webp", "png"]) {
          if (st.textures[`tex/${old}.${e}`]) {
            st.textures[`tex/${clean}.${e}`] = st.textures[`tex/${old}.${e}`];
            delete st.textures[`tex/${old}.${e}`];
          }
        }
        if (this.engine.tex[old]) { this.engine.tex[clean] = this.engine.tex[old]; delete this.engine.tex[old]; }
        if (this.engine.alphaMaps[old]) { this.engine.alphaMaps[clean] = this.engine.alphaMaps[old]; delete this.engine.alphaMaps[old]; }
        if (P.pitchGroups && old in P.pitchGroups) { P.pitchGroups[clean] = P.pitchGroups[old]; delete P.pitchGroups[old]; }
        if (st.studio?.layers?.[old]) { st.studio.layers[clean] = st.studio.layers[old]; delete st.studio.layers[old]; }
        st.emit("pack:mutated", { structural: true });
      }),
      this._selectRow("Pitch Group", L.pitchGroup || (P.pitchGroups && P.pitchGroups[L.id]) || "face", PITCH_GROUPS.map((g) => [g, g]), (val) => {
        st.pushUndo("Change Pitch Group");
        L.pitchGroup = val;
        P.pitchGroups = P.pitchGroups || {};
        P.pitchGroups[L.id] = val;
        st.emit("pack:mutated", { structural: true });
      }),
      this._numRow("Draw Order", st.selectedLayerIdx, 0, P.layers.length - 1, 1, (val) => {
        const target = Math.max(0, Math.min(P.layers.length - 1, Math.round(val)));
        if (target !== st.selectedLayerIdx) st.reorderLayer(st.selectedLayerIdx, target);
      }),
      this._selectRow("Behind Occlusion", behindMode, [
        ["off", "Off"],
        ["on", "On (Active Angle)"],
        ["all", "Locked On (All Angles)"],
      ], (val) => {
        st.pushUndo("Toggle Behind Occlusion");
        if (val === "off") {
          SL.behind = 0;
        } else if (val === "on") {
          if (!L.behind) L.behind = [faceId, faceId];
          SL.behind = 1.0;
        } else if (val === "all") {
          if (!L.behind) L.behind = [faceId, faceId];
          for (const s of P.samples) s.layers[st.selectedLayerIdx].behind = 1.0;
        }
        st.emit("pack:mutated", { structural: true });
      }),
      this._selectRow("Clip Target", L.clip || "", [
        ["", "None"],
        ...P.layers.filter((x) => x.id !== L.id).map((x) => [x.id, x.id]),
      ], (val) => {
        st.pushUndo("Set Clip Target");
        L.clip = val || null;
        if (val) {
          const tLayer = P.layers.find((x) => x.id === val);
          if (tLayer) tLayer.clipTarget = true;
        }
        st.emit("pack:mutated", { structural: true });
      }),
    );

    const g2 = this._group();
    g2.append(
      this._numRow("Position X", SL.t[0], -4000, 8000, 1, (v) => { st.snapToSample(st.activeSampleIdx); st.pushUndo("Move X"); st.getActiveSampleLayer().t[0] = +v.toFixed(2); st.emit("pack:mutated"); }, "tx"),
      this._numRow("Position Y", SL.t[1], -4000, 8000, 1, (v) => { st.snapToSample(st.activeSampleIdx); st.pushUndo("Move Y"); st.getActiveSampleLayer().t[1] = +v.toFixed(2); st.emit("pack:mutated"); }, "ty"),
      this._numRow("Scale X", dec.sx, 0.05, 5, 0.01, (v) => { st.snapToSample(st.activeSampleIdx); st.pushUndo("Scale X"); const sl = st.getActiveSampleLayer(); const d = decomposeAffine(sl.A); sl.A = composeAffine(v, d.sy, d.rotDeg); st.emit("pack:mutated"); }, "sx"),
      this._numRow("Scale Y", dec.sy, 0.05, 5, 0.01, (v) => { st.snapToSample(st.activeSampleIdx); st.pushUndo("Scale Y"); const sl = st.getActiveSampleLayer(); const d = decomposeAffine(sl.A); sl.A = composeAffine(d.sx, v, d.rotDeg); st.emit("pack:mutated"); }, "sy"),
      this._numRow("Rotation", dec.rotDeg, -180, 180, 0.5, (v) => { st.snapToSample(st.activeSampleIdx); st.pushUndo("Rotate"); const sl = st.getActiveSampleLayer(); const d = decomposeAffine(sl.A); sl.A = composeAffine(d.sx, d.sy, v); st.emit("pack:mutated"); }, "rot"),
      this._numRow("Opacity", SL.op ?? 1, 0, 1, 0.01, (v) => { st.snapToSample(st.activeSampleIdx); st.pushUndo("Opacity"); st.getActiveSampleLayer().op = Math.max(0, Math.min(1, +v.toFixed(3))); st.emit("pack:mutated"); }, "op"),
    );

    const g3 = this._group();
    const chainOpts = [["-1", "None"], ...(P.chains || []).map((c, ci) => [String(ci), c.name])];
    const boundChain = (L.chains && L.chains.length) ? String(L.chains[0]) : "-1";
    const chObj = boundChain !== "-1" ? P.chains[Number(boundChain)] : null;
    g3.append(
      this._selectRow("Warp Grid", String(gd), [["3", "3x3"], ["5", "5x5"], ["7", "7x7"], ["9", "9x9"], ["11", "11x11"]], (v) => {
        st.pushUndo("Resize Warp Grid");
        const ng = Number(v);
        st.brush.gridSize = ng;
        ensureGrid(SL, ng);
        st.emit("pack:mutated");
      }),
      this._numRow("Brush Radius", st.brush.radius, 16, 400, 4, (v) => {
        st.brush.radius = Math.max(16, Math.min(400, Math.round(v)));
      }),
      this._selectRow("Spring Chain", boundChain, chainOpts, (v) => {
        st.pushUndo("Bind Spring Chain");
        const ci = Number(v);
        if (ci < 0) { delete L.chains; }
        else { L.chains = [ci]; L.chainSigma = L.chainSigma || 160; }
        st.emit("pack:mutated", { structural: true });
      }),
    );
    if (chObj) {
      g3.append(
        this._numRow("Stiffness", chObj.k[0], 0.05, 1.5, 0.02, (v) => { st.pushUndo("Chain Stiffness"); chObj.k[0] = +v.toFixed(3); st.emit("pack:mutated", { structural: true }); }),
        this._numRow("Damping", chObj.damp, 0.02, 1.0, 0.02, (v) => { st.pushUndo("Chain Damping"); chObj.damp = +v.toFixed(3); st.emit("pack:mutated", { structural: true }); }),
      );
    }

    const g4 = this._group();
    const btns = document.createElement("div");
    btns.className = "prop-btn-row";
    const repBtn = document.createElement("button");
    repBtn.className = "btn-xs"; repBtn.type = "button"; repBtn.textContent = "Replace Texture…";
    repBtn.addEventListener("click", () => this.onAction("replace-tex"));
    const headBtn = document.createElement("button");
    headBtn.className = "btn-xs" + (L.head ? " active" : ""); headBtn.type = "button"; headBtn.textContent = L.head ? "Head: On" : "Head: Off";
    headBtn.addEventListener("click", () => { st.pushUndo("Toggle Head Rig"); L.head = !L.head; st.emit("pack:mutated", { structural: true }); });
    btns.append(repBtn, headBtn);
    g4.appendChild(btns);

    this.bodyEl.append(g1, g2, g3, g4);
  }

  /* ---------- TRANSFORM & KEYFORM TAB ---------- */
  _renderTransformTab() {
    const st = this.state;
    const L = st.getSelectedLayer();
    const SL = st.getActiveSampleLayer();
    if (!L || !SL) return this._renderLayerTab();
    const dec = decomposeAffine(SL.A || [1, 0, 0, 1]);

    const g1 = this._group();
    g1.append(
      this._numRow("Position X", SL.t[0], -4000, 8000, 1, (v) => { st.snapToSample(st.activeSampleIdx); st.pushUndo("Move X"); st.getActiveSampleLayer().t[0] = +v.toFixed(2); st.emit("pack:mutated"); }, "tx"),
      this._numRow("Position Y", SL.t[1], -4000, 8000, 1, (v) => { st.snapToSample(st.activeSampleIdx); st.pushUndo("Move Y"); st.getActiveSampleLayer().t[1] = +v.toFixed(2); st.emit("pack:mutated"); }, "ty"),
      this._numRow("Scale X", dec.sx, 0.05, 5, 0.01, (v) => { st.snapToSample(st.activeSampleIdx); st.pushUndo("Scale X"); const sl = st.getActiveSampleLayer(); const d = decomposeAffine(sl.A); sl.A = composeAffine(v, d.sy, d.rotDeg); st.emit("pack:mutated"); }, "sx"),
      this._numRow("Scale Y", dec.sy, 0.05, 5, 0.01, (v) => { st.snapToSample(st.activeSampleIdx); st.pushUndo("Scale Y"); const sl = st.getActiveSampleLayer(); const d = decomposeAffine(sl.A); sl.A = composeAffine(d.sx, v, d.rotDeg); st.emit("pack:mutated"); }, "sy"),
      this._numRow("Rotation °", dec.rotDeg, -180, 180, 0.5, (v) => { st.snapToSample(st.activeSampleIdx); st.pushUndo("Rotate"); const sl = st.getActiveSampleLayer(); const d = decomposeAffine(sl.A); sl.A = composeAffine(d.sx, d.sy, v); st.emit("pack:mutated"); }, "rot"),
      this._numRow("Cylinder Turn", SL.turn || 0, -0.5, 0.5, 0.01, (v) => { st.snapToSample(st.activeSampleIdx); st.pushUndo("Layer Turn"); st.getActiveSampleLayer().turn = +v.toFixed(4); st.emit("pack:mutated"); }, "turn"),
      this._numRow("Quad Margin", L.pad || 320, 40, 900, 20, (v) => { st.pushUndo("Layer Pad"); L.pad = Math.max(40, Math.round(v)); st.emit("pack:mutated"); }),
    );

    const g2 = this._group();
    const r1 = document.createElement("div"); r1.className = "prop-btn-row";
    r1.append(
      this._actionBtn("Mirror L ↔ R", () => this.onAction("mirror-lr")),
      this._actionBtn("Interpolate Key", () => this.onAction("interp-key")),
    );
    const r2 = document.createElement("div"); r2.className = "prop-btn-row";
    r2.append(
      this._actionBtn("Copy to All Angles", () => this.onAction("copy-key-all")),
      this._actionBtn("Reset Affine", () => {
        st.pushUndo("Reset Affine");
        SL.A = [1, 0, 0, 1];
        st.emit("pack:mutated");
      }),
    );
    g2.append(r1, r2);
    this.bodyEl.append(g1, g2);
  }

  /* ---------- WARP & MESH SCULPTING TAB ---------- */
  _renderWarpTab() {
    const st = this.state;
    const L = st.getSelectedLayer();
    const SL = st.getActiveSampleLayer();
    if (!L || !SL) {
      this.bodyEl.innerHTML = `<div class="empty-note">Select a layer to sculpt its warp mesh.</div>`;
      return;
    }
    const gd = gridSizeOf(SL.D) || st.brush.gridSize;
    const g1 = this._group();
    g1.append(
      this._selectRow("Brush Mode", st.brush.mode, [
        ["push", "Sculpt / Push"],
        ["smooth", "Smooth"],
        ["restore", "Restore / Erase"],
      ], (v) => { st.brush.mode = v; }),
      this._sliderRow("Brush Radius", st.brush.radius, 20, 320, 1, (v) => { st.brush.radius = v; }, (v) => `${Math.round(v)}px`),
      this._sliderRow("Brush Strength", st.brush.strength, 0.05, 1.0, 0.01, (v) => { st.brush.strength = v; }, (v) => v.toFixed(2)),
      this._selectRow("Warp Grid", String(gd), [["3", "3×3 (9 pts)"], ["5", "5×5 (25 pts)"], ["7", "7×7 (49 pts)"], ["9", "9×9 (81 pts)"], ["11", "11×11 (121 pts)"]], (v) => {
        st.pushUndo("Resample Warp Grid");
        const ng = Number(v);
        st.brush.gridSize = ng;
        ensureGrid(SL, ng);
        st.emit("pack:mutated");
      }),
    );
    const g2 = this._group();
    const btns = document.createElement("div"); btns.className = "prop-btn-row";
    btns.append(
      this._actionBtn("Smooth Grid", () => { st.pushUndo("Smooth Warp"); smoothGrid(SL, 0.35); st.emit("pack:mutated"); }),
      this._actionBtn("Reset Warp", () => { st.pushUndo("Reset Warp"); delete SL.D; st.emit("pack:mutated"); }),
    );
    g2.append(btns);
    this.bodyEl.append(g1, g2);
  }

  /* ---------- PHYSICS & TAIL RIG TAB ---------- */
  _renderPhysicsTab() {
    const st = this.state;
    const P = st.pack;
    P.chains = P.chains || [];

    const g1 = this._group();
    const chainOpts = P.chains.map((c, i) => [String(i), `${i}: ${c.name}`]);
    const selCi = st.selectedChainIdx >= 0 && st.selectedChainIdx < P.chains.length ? st.selectedChainIdx : (P.chains.length ? 0 : -1);
    st.selectedChainIdx = selCi;

    const topRow = document.createElement("div"); topRow.className = "prop-btn-row";
    topRow.append(
      this._actionBtn("+ Add Chain", () => this.onAction("add-chain"), true),
      this._actionBtn("Delete Chain", () => {
        if (selCi < 0) return;
        st.pushUndo("Delete Chain");
        P.chains.splice(selCi, 1);
        for (const L of P.layers) {
          if (!L.chains) continue;
          L.chains = L.chains.filter((x) => x !== selCi).map((x) => (x > selCi ? x - 1 : x));
          if (!L.chains.length) delete L.chains;
        }
        st.selectedChainIdx = Math.min(selCi, P.chains.length - 1);
        st.emit("pack:mutated", { structural: true });
      }),
    );
    g1.appendChild(topRow);

    if (selCi >= 0) {
      const ch = P.chains[selCi];
      g1.append(
        this._selectRow("Active Chain", String(selCi), chainOpts, (v) => { st.selectedChainIdx = Number(v); this.render(); }),
        this._textRow("Chain Name", ch.name, (v) => { st.pushUndo("Rename Chain"); ch.name = v.trim() || ch.name; st.emit("pack:mutated", { structural: true }); }),
        this._selectRow("Parent Bone", ch.parent || "head", [["head", "Head"], ["body", "Torso"], ["hips", "Hips"], ["armR", "Arm R"], ["armL", "Arm L"]], (v) => {
          st.pushUndo("Chain Parent"); ch.parent = v; st.emit("pack:mutated", { structural: true });
        }),
        this._sliderRow("Root Stiff (k0)", ch.k[0], 0.05, 1.5, 0.01, (v) => { ch.k[0] = +v.toFixed(3); this.engine.syncPack(); }, (v) => v.toFixed(2)),
        this._sliderRow("Tip Stiff (k1)", ch.k[1], 0.02, 1.2, 0.01, (v) => { ch.k[1] = +v.toFixed(3); this.engine.syncPack(); }, (v) => v.toFixed(2)),
        this._sliderRow("Damping", ch.damp, 0.02, 1.0, 0.01, (v) => { ch.damp = +v.toFixed(3); this.engine.syncPack(); }, (v) => v.toFixed(2)),
      );
      const jRow = document.createElement("div"); jRow.className = "prop-btn-row";
      jRow.append(
        this._actionBtn("+ Joint", () => {
          if (ch.joints.length >= 12) return;
          st.pushUndo("Add Chain Joint");
          const n = ch.joints.length;
          const x = ch.joints[n - 2], y = ch.joints[n - 1];
          ch.joints.push(x, y + 80);
          st.emit("pack:mutated", { structural: true });
        }),
        this._actionBtn("- Joint", () => {
          if (ch.joints.length <= 4) return;
          st.pushUndo("Remove Chain Joint");
          ch.joints.splice(-2, 2);
          st.emit("pack:mutated", { structural: true });
        }),
      );
      g1.appendChild(jRow);
    }

    // Tail Rig Section
    const g2 = this._group();
    const tHead = document.createElement("div"); tHead.className = "subhead"; tHead.textContent = "PELVIS-LOCKED TAIL";
    g2.appendChild(tHead);
    const tail = P.tail || { id: "", pivot: [P.canvas[0] * 0.5, P.canvas[1] * 0.55], amp: 0.16, freq: 2.4 };
    g2.append(
      this._selectRow("Tail Layer", tail.id || "", [["", "None"], ...P.layers.map((l) => [l.id, l.id])], (v) => {
        st.pushUndo("Configure Tail Layer");
        if (!v) delete P.tail;
        else P.tail = { ...tail, id: v };
        st.emit("pack:mutated", { structural: true });
      }),
    );
    if (P.tail) {
      g2.append(
        this._numRow("Pivot X", P.tail.pivot[0], 0, P.canvas[0] * 1.5, 5, (v) => { P.tail.pivot[0] = Math.round(v); st.emit("pack:mutated"); }),
        this._numRow("Pivot Y", P.tail.pivot[1], 0, P.canvas[1] * 1.5, 5, (v) => { P.tail.pivot[1] = Math.round(v); st.emit("pack:mutated"); }),
        this._sliderRow("Amplitude", P.tail.amp ?? 0.16, 0, 0.45, 0.01, (v) => { P.tail.amp = +v.toFixed(3); }, (v) => v.toFixed(2)),
        this._sliderRow("Frequency", P.tail.freq ?? 2.4, 0.5, 6.0, 0.1, (v) => { P.tail.freq = +v.toFixed(2); }, (v) => `${v.toFixed(1)}Hz`),
      );
    }

    // Live Physics Simulation Controls
    const g3 = this._group();
    const pHead = document.createElement("div"); pHead.className = "subhead"; pHead.textContent = "SIMULATION";
    g3.append(
      pHead,
      this._sliderRow("Wind", this.engine.physics.wind, -1.5, 1.5, 0.01, (v) => { this.engine.physics.wind = v; }, (v) => v.toFixed(2)),
      this._sliderRow("Gravity", this.engine.physics.gravity, 0.0, 2.0, 0.01, (v) => { this.engine.physics.gravity = v; }, (v) => v.toFixed(2)),
      this._actionBtn("Trigger Shake Impulse", () => this.onAction("physics-impulse"), true),
    );
    this.bodyEl.append(g1, g2, g3);
  }

  /* ---------- EXPRESSIONS, TOGGLES, HOLDS & VOWELS TAB ---------- */
  _renderExpressionsTab() {
    const st = this.state;
    const P = st.pack;
    P.expr = P.expr || { pieces: {}, faces: {}, holds: {}, vowels: {} };
    const faces = P.expr.faces || {};
    const faceNames = Object.keys(faces);
    const curName = (st.selectedExprName && faces[st.selectedExprName]) ? st.selectedExprName : (faceNames[0] || null);
    st.selectedExprName = curName;

    const g1 = this._group();
    const btns = document.createElement("div"); btns.className = "prop-btn-row";
    btns.append(
      this._actionBtn("+ New Expr", () => this.onAction("new-expr"), true),
      this._actionBtn("Delete Expr", () => {
        if (!curName || curName === "Neutral") return;
        st.pushUndo("Delete Expression");
        delete faces[curName];
        if (st.params.face === curName) st.params.face = null;
        st.selectedExprName = Object.keys(faces)[0] || null;
        st.emit("pack:mutated", { structural: true });
      }),
    );
    g1.appendChild(btns);

    if (curName) {
      const F = faces[curName];
      g1.append(
        this._selectRow("Expression", curName, faceNames.map((n) => [n, n]), (v) => {
          st.selectedExprName = v;
          st.params.face = v === "Neutral" ? null : v;
          st.emit("params:changed");
          this.render();
        }),
      );
      const curEyes = Array.isArray(F.eyes) ? F.eyes[0] : (typeof F.eyes === "number" ? F.eyes : 1.0);
      g1.append(
        this._sliderRow("Eye Openness", curEyes, 0, 1.3, 0.01, (v) => {
          F.eyes = [+v.toFixed(2), +v.toFixed(2)];
          st.emit("pack:mutated", { silentInspector: true });
        }, (v) => v.toFixed(2)),
      );

      // Hide layers checklist
      const hLbl = document.createElement("div"); hLbl.className = "subhead"; hLbl.textContent = "HIDDEN LAYERS IN EXPRESSION";
      const hList = document.createElement("div"); hList.className = "mini-checklist"; hList.dataset.scrollKey = "expr-hide";
      const hideSet = new Set(F.hide || []);
      for (const L of P.layers) {
        const item = document.createElement("label");
        item.className = "mini-check-item";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = hideSet.has(L.id);
        cb.addEventListener("change", () => {
          st.pushUndo("Edit Expression Hide");
          if (cb.checked) hideSet.add(L.id); else hideSet.delete(L.id);
          F.hide = [...hideSet];
          st.emit("pack:mutated");
        });
        item.append(cb, document.createTextNode(L.id));
        hList.appendChild(item);
      }

      // Attach FX / Pieces checklist + Import new Flipbook FX button
      const pLbl = document.createElement("div"); pLbl.className = "subhead"; pLbl.textContent = "OVERLAY / FLIPBOOK FX PIECES";
      const pList = document.createElement("div"); pList.className = "mini-checklist"; pList.dataset.scrollKey = "expr-add";
      const addSet = new Set(F.add || []);
      for (const pid of Object.keys(P.expr.pieces || {})) {
        const item = document.createElement("label");
        item.className = "mini-check-item";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = addSet.has(pid);
        cb.addEventListener("change", () => {
          st.pushUndo("Edit Expression Pieces");
          if (cb.checked) addSet.add(pid); else addSet.delete(pid);
          F.add = [...addSet];
          st.emit("pack:mutated");
        });
        item.append(cb, document.createTextNode(pid));
        pList.appendChild(item);
      }
      g1.append(hLbl, hList, pLbl, pList, this._actionBtn("+ Import FX Sprite / Flipbook…", () => this.onAction("import-fx")));
    }

    // Vowel Lip-Sync Mapper (A/E/I/O/U)
    const g2 = this._group();
    const vHead = document.createElement("div"); vHead.className = "subhead"; vHead.textContent = "LIP-SYNC VOWEL MAPPING";
    g2.appendChild(vHead);
    P.expr.vowels = P.expr.vowels || {};
    const pieceOpts = [["", "None"], ...Object.keys(P.expr.pieces || {}).map((id) => [id, id])];
    for (const v of ["A", "E", "I", "O", "U"]) {
      g2.appendChild(this._selectRow(`Vowel ${v}`, P.expr.vowels[v] || "", pieceOpts, (val) => {
        st.pushUndo(`Map Vowel ${v}`);
        if (val) P.expr.vowels[v] = val; else delete P.expr.vowels[v];
        st.emit("pack:mutated", { structural: true });
      }));
    }

    // Create Outfit Toggle from Selected Layer
    const g3 = this._group();
    const oHead = document.createElement("div"); oHead.className = "subhead"; oHead.textContent = "OUTFIT TOGGLES";
    g3.append(oHead, this._actionBtn("+ Toggle from Selected Layer", () => {
      const L = st.getSelectedLayer();
      if (!L) return;
      const name = prompt("Toggle name (e.g. Glasses, Hat, Jacket):", L.id);
      if (!name) return;
      const key = name.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
      st.pushUndo("Add Outfit Toggle");
      P.outfits = P.outfits || {};
      P.outfits[key] = { label: name, default: true, hide: [L.id], off: [0, 40], secs: 0.35 };
      st.params.wear[key] = 1;
      st.emit("pack:mutated", { structural: true });
    }));

    this.bodyEl.append(g1, g2, g3);
  }

  /* ---------- ANIMATE MODE PANEL (Interactive Cubic Bezier Curve + Physics Preview — matches studio_concept_animate.png!) ---------- */
  _renderAnimatePanel() {
    const st = this.state;
    const bz = st.studio.bezier || (st.studio.bezier = { p1x: 0.25, p1y: 0.1, p2x: 0.75, p2y: 0.9, preset: "easeInOut" });

    const g1 = this._group();
    const h1 = document.createElement("div"); h1.className = "subhead"; h1.textContent = "KEYFRAME INTERPOLATION";
    const box = document.createElement("div"); box.className = "bezier-box";
    const cv = document.createElement("canvas"); cv.id = "bezier-canvas";
    box.appendChild(cv);

    const pLbl = document.createElement("div"); pLbl.className = "subhead"; pLbl.style.marginTop = "10px"; pLbl.textContent = "EASING PRESET";
    const presets = document.createElement("div"); presets.className = "prop-btn-row three";
    const presetDefs = [
      ["linear", "Linear", { p1x: 0.33, p1y: 0.33, p2x: 0.67, p2y: 0.67 }],
      ["easeInOut", "Ease In/Out", { p1x: 0.25, p1y: 0.10, p2x: 0.75, p2y: 0.90 }],
      ["back", "Back", { p1x: 0.34, p1y: 1.35, p2x: 0.64, p2y: 1.00 }],
    ];
    for (const [key, label, vals] of presetDefs) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn-xs" + (bz.preset === key ? " active" : "");
      b.textContent = label;
      b.addEventListener("click", () => {
        Object.assign(bz, vals, { preset: key });
        // Apply easing to currently selected timeline keyframe if any
        const clip = st.getActiveClip();
        const tr = clip?.tracks?.[st.timeline.selectedTrack];
        if (tr && st.timeline.selectedKeyIdx >= 0 && tr[st.timeline.selectedKeyIdx]) {
          tr[st.timeline.selectedKeyIdx].ease = key;
        }
        this.render();
      });
      presets.appendChild(b);
    }
    g1.append(h1, box, pLbl, presets);

    const g2 = this._group();
    const h2 = document.createElement("div"); h2.className = "subhead"; h2.textContent = "PHYSICS";
    g2.append(
      h2,
      this._sliderRow("Spring", this.engine.physics.springScale, 0.2, 1.8, 0.01, (v) => { this.engine.physics.springScale = v; }, (v) => v.toFixed(2)),
      this._sliderRow("Wind", this.engine.physics.wind, -1.0, 1.0, 0.01, (v) => { this.engine.physics.wind = v; }, (v) => v.toFixed(2)),
      this._sliderRow("Gravity", this.engine.physics.gravity, 0.0, 2.0, 0.01, (v) => { this.engine.physics.gravity = v; }, (v) => v.toFixed(2)),
    );

    this.bodyEl.append(g1, g2);
    this._setupBezierCanvas(cv, bz);
  }

  _setupBezierCanvas(cv, bz) {
    const pad = 26;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth || 236, h = cv.clientHeight || 180;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      const ctx = cv.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const gw = w - pad * 1.5, gh = h - pad * 1.6;
      const ox = pad, oy = h - pad;
      const toX = (u) => ox + u * gw;
      const toY = (v) => oy - v * gh;

      // Grid & labels
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.fillStyle = "#6b7079";
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 5; i++) {
        const u = i / 5;
        const x = toX(u), y = toY(u);
        ctx.beginPath(); ctx.moveTo(x, toY(0)); ctx.lineTo(x, toY(1)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(toX(0), y); ctx.lineTo(toX(1), y); ctx.stroke();
        ctx.fillText(u.toFixed(1), x - 8, oy + 14);
        ctx.fillText(u.toFixed(1), 2, y + 3);
      }

      // Handle stems
      ctx.strokeStyle = "rgba(242,243,245,0.28)";
      ctx.beginPath();
      ctx.moveTo(toX(0), toY(0)); ctx.lineTo(toX(bz.p1x), toY(bz.p1y));
      ctx.moveTo(toX(1), toY(1)); ctx.lineTo(toX(bz.p2x), toY(bz.p2y));
      ctx.stroke();

      // Crimson Bezier curve
      ctx.strokeStyle = "#be1e3c";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(toX(0), toY(0));
      ctx.bezierCurveTo(toX(bz.p1x), toY(bz.p1y), toX(bz.p2x), toY(bz.p2y), toX(1), toY(1));
      ctx.stroke();

      // Endpoints (crimson dots with white stroke)
      for (const [u, v] of [[0, 0], [1, 1]]) {
        ctx.beginPath(); ctx.arc(toX(u), toY(v), 4, 0, Math.PI * 2);
        ctx.fillStyle = "#be1e3c"; ctx.fill();
        ctx.strokeStyle = "#f2f3f5"; ctx.lineWidth = 1.2; ctx.stroke();
      }
      // Draggable P1/P2 square handles
      for (const [u, v] of [[bz.p1x, bz.p1y], [bz.p2x, bz.p2y]]) {
        ctx.fillStyle = "#0c0d10";
        ctx.strokeStyle = "#f2f3f5";
        ctx.lineWidth = 1.6;
        ctx.fillRect(toX(u) - 4, toY(v) - 4, 8, 8);
        ctx.strokeRect(toX(u) - 4, toY(v) - 4, 8, 8);
      }
    };
    requestAnimationFrame(draw);

    let dragPt = 0;
    const toUV = (e) => {
      const r = cv.getBoundingClientRect();
      const gw = r.width - pad * 1.5, gh = r.height - pad * 1.6;
      const ox = pad, oy = r.height - pad;
      return [
        Math.max(0, Math.min(1, (e.clientX - r.left - ox) / gw)),
        Math.max(-0.4, Math.min(1.4, (oy - (e.clientY - r.top)) / gh)),
      ];
    };
    cv.addEventListener("pointerdown", (e) => {
      const [u, v] = toUV(e);
      const d1 = Math.hypot(u - bz.p1x, v - bz.p1y);
      const d2 = Math.hypot(u - bz.p2x, v - bz.p2y);
      dragPt = d1 < d2 ? 1 : 2;
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener("pointermove", (e) => {
      if (!dragPt) return;
      const [u, v] = toUV(e);
      if (dragPt === 1) { bz.p1x = +u.toFixed(2); bz.p1y = +v.toFixed(2); }
      else { bz.p2x = +u.toFixed(2); bz.p2y = +v.toFixed(2); }
      bz.preset = "custom";
      draw();
    });
    cv.addEventListener("pointerup", () => { dragPt = 0; });
  }

  /* ---------- UI Field Builders ---------- */
  _group() {
    const d = document.createElement("div");
    d.className = "prop-group";
    return d;
  }

  _textRow(label, value, onChange) {
    const row = document.createElement("div"); row.className = "prop-row";
    const l = document.createElement("span"); l.className = "prop-lbl"; l.textContent = label;
    const inp = document.createElement("input"); inp.className = "field-input mono"; inp.value = value;
    inp.addEventListener("change", () => onChange(inp.value));
    row.append(l, inp);
    return row;
  }

  _numRow(label, value, min, max, step, onChange, liveField = null) {
    const row = document.createElement("div"); row.className = "prop-row";
    const l = document.createElement("span"); l.className = "prop-lbl"; l.textContent = label;
    const inp = document.createElement("input");
    inp.className = "field-input mono";
    inp.type = "number";
    if (liveField) inp.dataset.liveField = liveField;
    inp.min = String(min); inp.max = String(max); inp.step = String(step);
    inp.value = String(Number(value.toFixed(3)));
    inp.addEventListener("change", () => {
      const v = parseFloat(inp.value);
      if (!Number.isNaN(v)) onChange(v);
    });
    row.append(l, inp);
    return row;
  }

  _selectRow(label, value, options, onChange) {
    const row = document.createElement("div"); row.className = "prop-row";
    const l = document.createElement("span"); l.className = "prop-lbl"; l.textContent = label;
    const sel = document.createElement("select"); sel.className = "field-select";
    for (const [val, txt] of options) {
      const o = document.createElement("option");
      o.value = val; o.textContent = txt;
      if (val === value) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => onChange(sel.value));
    row.append(l, sel);
    return row;
  }

  _sliderRow(label, value, min, max, step, onChange, fmt = (v) => String(v)) {
    const row = document.createElement("div"); row.className = "prop-row";
    const l = document.createElement("span"); l.className = "prop-lbl"; l.textContent = label;
    const wrap = document.createElement("div"); wrap.className = "prop-slider-wrap";
    const rng = document.createElement("input");
    rng.type = "range"; rng.className = "prop-range";
    rng.min = String(min); rng.max = String(max); rng.step = String(step); rng.value = String(value);
    const out = document.createElement("span"); out.className = "mono"; out.style.textAlign = "right"; out.textContent = fmt(value);
    rng.addEventListener("input", () => {
      const v = parseFloat(rng.value);
      out.textContent = fmt(v);
      onChange(v);
    });
    wrap.append(rng, out);
    row.append(l, wrap);
    return row;
  }

  _actionBtn(label, onClick, primary = false) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-xs" + (primary ? " primary" : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }
}
