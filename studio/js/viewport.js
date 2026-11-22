/**
 * Interactive Studio Viewport Controller & 2D Precision Vector Overlay
 * Handles:
 *   - Pan / Zoom (wheel, middle-drag, Space+drag, Hand tool)
 *   - Alpha-accurate click-to-select layer
 *   - Transform gizmo (drag translate, corner scale, top rotation handle)
 *   - Warp Sculpt Brush (circular brush cursor + radial smoothstep Liquify sculpting on D[])
 *   - Warp Lattice Cage & Mesh Vertices (5x5..11x11 crimson/white draggable control handles)
 *   - Spring Physics Chain Spline Editor (draggable joint nodes + add/remove joints)
 *   - Rig Pivot Handles (head centre, neck pivot, waist, shoulders, tail pivot)
 */

import {
  latticeCanvasPoints,
  dragLatticePoint,
  applyWarpBrush,
  gridSizeOf,
  decomposeAffine,
  composeAffine,
} from "./warp_math.js";

export class ViewportController {
  constructor(state, engine, overlayCanvas, stageFrame) {
    this.state = state;
    this.engine = engine;
    this.overlay = overlayCanvas;
    this.ctx = overlayCanvas.getContext("2d");
    this.stage = stageFrame;

    this.pointer = { x: 0, y: 0, canon: [0, 0], inside: false };
    this.drag = null;
    this.hoverHandle = null;
    this.spaceHeld = false;

    this._bindEvents();
  }

  /* ---------- Coordinate Conversions (Screen CSS px <-> Canonical Canvas px) ---------- */
  screenToCanon(sx, sy) {
    const rect = this.overlay.getBoundingClientRect();
    const vw = this.engine.lastView;
    const u = sx / Math.max(1, rect.width);
    const v = sy / Math.max(1, rect.height);
    return [vw[0] + u * (vw[2] - vw[0]), vw[1] + v * (vw[3] - vw[1])];
  }

  canonToScreen(cx, cy) {
    const rect = this.overlay.getBoundingClientRect();
    const vw = this.engine.lastView;
    const u = (cx - vw[0]) / Math.max(1e-6, vw[2] - vw[0]);
    const v = (cy - vw[1]) / Math.max(1e-6, vw[3] - vw[1]);
    return [u * rect.width, v * rect.height];
  }

  canonScale() {
    const rect = this.overlay.getBoundingClientRect();
    const vw = this.engine.lastView;
    return rect.width / Math.max(1, vw[2] - vw[0]);
  }

  _bindEvents() {
    const el = this.overlay;

    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (!this.state.pack) return;
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const [cx, cy] = this.screenToCanon(sx, sy);
      const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      const vr = this.state.view.rect;
      const newW = (vr[2] - vr[0]) * factor;
      const newH = (vr[3] - vr[1]) * factor;
      const maxDim = Math.max(this.state.pack.canvas[0], this.state.pack.canvas[1]) * 3.5;
      if (newW < 120 || newW > maxDim) return;
      const rx = (cx - vr[0]) / (vr[2] - vr[0]);
      const ry = (cy - vr[1]) / (vr[3] - vr[1]);
      this.state.view.rect = [cx - rx * newW, cy - ry * newH, cx + (1 - rx) * newW, cy + (1 - ry) * newH];
      const base = (this.state.pack.views && this.state.pack.views.bust) || [0, 0, this.state.pack.canvas[0], this.state.pack.canvas[1]];
      this.state.view.zoom = (base[2] - base[0]) / newW;
      this.state.emit("view:changed");
    }, { passive: false });

    el.addEventListener("pointerdown", (e) => this._onDown(e));
    window.addEventListener("pointermove", (e) => this._onMove(e));
    window.addEventListener("pointerup", (e) => this._onUp(e));
    el.addEventListener("pointerleave", () => { this.pointer.inside = false; });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  _hitTestHandles(sx, sy) {
    const st = this.state;
    const P = st.pack;
    if (!P) return null;

    // 1. Pivot handles (when Pivot tool or showPivots)
    if (st.tool === "pivot" || st.view.showPivots) {
      const pivots = this._getPivots();
      for (const pv of pivots) {
        const [px, py] = this.canonToScreen(pv.x, pv.y);
        if (Math.hypot(sx - px, sy - py) <= 10) return { kind: "pivot", pivot: pv };
      }
    }

    // 2. Spring chain joints (when Chain tool or showChains)
    if (st.tool === "chain" || st.view.showChains) {
      for (let ci = 0; ci < (P.chains || []).length; ci++) {
        const ch = P.chains[ci];
        for (let ji = 0; ji < ch.joints.length / 2; ji++) {
          const [px, py] = this.canonToScreen(ch.joints[ji * 2], ch.joints[ji * 2 + 1]);
          if (Math.hypot(sx - px, sy - py) <= 9) return { kind: "chain_joint", ci, ji };
        }
      }
    }

    // 3. Lattice / Mesh vertex handles on selected layer
    const L = st.getSelectedLayer();
    const SL = st.getActiveSampleLayer();
    if (L && SL && (st.tool === "lattice" || st.tool === "mesh")) {
      const { gd, pts } = latticeCanvasPoints(L, SL, st.brush.gridSize);
      for (const pt of pts) {
        const [px, py] = this.canonToScreen(pt.x, pt.y);
        if (Math.hypot(sx - px, sy - py) <= 9) return { kind: "lattice_pt", ix: pt.ix, iy: pt.iy, gd };
      }
    }

    // 4. Transform gizmo handles on selected layer
    if (L && SL && (st.tool === "transform" || st.tool === "select")) {
      const box = this._layerBoxScreen(L, SL);
      if (box) {
        if (Math.hypot(sx - box.rotHandle[0], sy - box.rotHandle[1]) <= 10) return { kind: "rot" };
        for (let i = 0; i < 4; i++) {
          if (Math.hypot(sx - box.corners[i][0], sy - box.corners[i][1]) <= 9) return { kind: "scale", corner: i };
        }
      }
    }

    return null;
  }

  _onDown(e) {
    const st = this.state;
    const P = st.pack;
    if (!P) return;
    const rect = this.overlay.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const canon = this.screenToCanon(sx, sy);
    this.pointer = { x: sx, y: sy, canon, inside: true };

    // Pan with middle mouse, Hand tool, or Space+drag
    if (e.button === 1 || st.tool === "pan" || this.spaceHeld) {
      this.drag = { type: "pan", startX: sx, startY: sy, startRect: [...st.view.rect] };
      this.overlay.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    const hit = this._hitTestHandles(sx, sy);
    if (hit) {
      if (hit.kind === "pivot") {
        st.pushUndo(`Move ${hit.pivot.label} Pivot`);
        this.drag = { type: "pivot", pivot: hit.pivot };
        this.overlay.setPointerCapture(e.pointerId);
        return;
      }
      if (hit.kind === "chain_joint") {
        st.pushUndo("Edit Spring Chain Joint");
        st.selectedChainIdx = hit.ci;
        st.emit("selection:changed");
        this.drag = { type: "chain_joint", ci: hit.ci, ji: hit.ji };
        this.overlay.setPointerCapture(e.pointerId);
        return;
      }
      if (hit.kind === "lattice_pt") {
        st.pushUndo("Sculpt Lattice Point");
        st.snapToSample(st.activeSampleIdx);
        this.drag = { type: "lattice_pt", ix: hit.ix, iy: hit.iy, prevCanon: canon };
        this.overlay.setPointerCapture(e.pointerId);
        return;
      }
      if (hit.kind === "rot") {
        st.pushUndo("Rotate Layer");
        st.snapToSample(st.activeSampleIdx);
        const SL = st.getActiveSampleLayer();
        const dec = decomposeAffine(SL.A);
        const ang0 = Math.atan2(canon[1] - SL.t[1], canon[0] - SL.t[0]);
        this.drag = { type: "rot", dec, ang0 };
        this.overlay.setPointerCapture(e.pointerId);
        return;
      }
      if (hit.kind === "scale") {
        st.pushUndo("Scale Layer");
        st.snapToSample(st.activeSampleIdx);
        const SL = st.getActiveSampleLayer();
        const dec = decomposeAffine(SL.A);
        const d0 = Math.max(10, Math.hypot(canon[0] - SL.t[0], canon[1] - SL.t[1]));
        this.drag = { type: "scale", dec, d0 };
        this.overlay.setPointerCapture(e.pointerId);
        return;
      }
    }

    // Warp Sculpt Brush
    if (st.tool === "warp_brush") {
      const L = st.getSelectedLayer();
      if (L && !st.lockedIds.has(L.id)) {
        st.pushUndo("Warp Brush Stroke");
        st.snapToSample(st.activeSampleIdx);
        this.drag = { type: "warp_brush", prevCanon: canon };
        this.overlay.setPointerCapture(e.pointerId);
        return;
      }
    }

    // Transform tool drag anywhere on selected layer (or pick layer first)
    if (st.tool === "transform" || st.tool === "select") {
      const picked = this.engine.pickLayerAt(
        canon[0], canon[1],
        st.params.a,
        st.snapToKeyform ? st.activeSampleIdx : null,
        st.hiddenIds,
        st.soloId,
        st.params.wear,
      );
      if (picked >= 0 && (st.tool === "select" || picked !== st.selectedLayerIdx)) {
        st.selectLayer(picked);
      }
      const L = st.getSelectedLayer();
      if (L && st.tool === "transform" && !st.lockedIds.has(L.id)) {
        st.pushUndo("Move Layer");
        st.snapToSample(st.activeSampleIdx);
        const SL = st.getActiveSampleLayer();
        this.drag = { type: "translate", startCanon: canon, origT: [...SL.t] };
        this.overlay.setPointerCapture(e.pointerId);
      }
    }
  }

  _onMove(e) {
    const rect = this.overlay.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const inside = sx >= 0 && sy >= 0 && sx <= rect.width && sy <= rect.height;
    const canon = this.screenToCanon(sx, sy);
    this.pointer = { x: sx, y: sy, canon, inside };

    const st = this.state;
    const P = st.pack;
    if (!P) return;

    if (!this.drag) {
      this.hoverHandle = inside ? this._hitTestHandles(sx, sy) : null;
      this._updateCursor();
      return;
    }

    if (this.drag.type === "pan") {
      const dx = sx - this.drag.startX, dy = sy - this.drag.startY;
      const r0 = this.drag.startRect;
      const sc = Math.min(rect.width / (r0[2] - r0[0]), rect.height / (r0[3] - r0[1]));
      st.view.rect = [r0[0] - dx / sc, r0[1] - dy / sc, r0[2] - dx / sc, r0[3] - dy / sc];
      st.emit("view:changed");
      return;
    }

    if (this.drag.type === "pivot") {
      this.drag.pivot.set(Math.round(canon[0]), Math.round(canon[1]));
      st.emit("pack:mutated", { structural: true });
      return;
    }

    if (this.drag.type === "chain_joint") {
      const ch = P.chains[this.drag.ci];
      if (ch) {
        ch.joints[this.drag.ji * 2] = +canon[0].toFixed(1);
        ch.joints[this.drag.ji * 2 + 1] = +canon[1].toFixed(1);
        st.emit("pack:mutated", { structural: true });
      }
      return;
    }

    const L = st.getSelectedLayer();
    const SL = st.getActiveSampleLayer();
    if (!L || !SL) return;

    if (this.drag.type === "translate") {
      SL.t[0] = +(this.drag.origT[0] + (canon[0] - this.drag.startCanon[0])).toFixed(2);
      SL.t[1] = +(this.drag.origT[1] + (canon[1] - this.drag.startCanon[1])).toFixed(2);
      st.emit("pack:mutated", { structural: false });
      return;
    }

    if (this.drag.type === "rot") {
      const ang = Math.atan2(canon[1] - SL.t[1], canon[0] - SL.t[0]);
      const deg = this.drag.dec.rotDeg + ((ang - this.drag.ang0) * 180) / Math.PI;
      SL.A = composeAffine(this.drag.dec.sx, this.drag.dec.sy, deg);
      st.emit("pack:mutated", { structural: false });
      return;
    }

    if (this.drag.type === "scale") {
      const d = Math.max(10, Math.hypot(canon[0] - SL.t[0], canon[1] - SL.t[1]));
      const f = d / this.drag.d0;
      SL.A = composeAffine(this.drag.dec.sx * f, this.drag.dec.sy * f, this.drag.dec.rotDeg);
      st.emit("pack:mutated", { structural: false });
      return;
    }

    if (this.drag.type === "lattice_pt") {
      const dx = canon[0] - this.drag.prevCanon[0];
      const dy = canon[1] - this.drag.prevCanon[1];
      dragLatticePoint(L, SL, this.drag.ix, this.drag.iy, dx, dy, st.brush.gridSize);
      this.drag.prevCanon = canon;
      st.emit("pack:mutated", { structural: false });
      return;
    }

    if (this.drag.type === "warp_brush") {
      const radCanon = st.brush.radius / Math.max(0.05, this.canonScale());
      const changed = applyWarpBrush(
        L, SL, this.drag.prevCanon, canon, radCanon, st.brush.strength, st.brush.mode, st.brush.gridSize,
      );
      this.drag.prevCanon = canon;
      if (changed) st.emit("pack:mutated", { structural: false });
    }
  }

  _onUp() {
    if (!this.drag) return;
    this.drag = null;
    this._updateCursor();
  }

  _updateCursor() {
    const st = this.state;
    if (this.drag && this.drag.type === "pan") { this.overlay.style.cursor = "grabbing"; return; }
    if (st.tool === "pan" || this.spaceHeld) { this.overlay.style.cursor = "grab"; return; }
    if (st.tool === "warp_brush") { this.overlay.style.cursor = "none"; return; }
    if (this.hoverHandle) { this.overlay.style.cursor = "pointer"; return; }
    this.overlay.style.cursor = st.tool === "transform" ? "move" : "default";
  }

  _getPivots() {
    const P = this.state.pack;
    if (!P) return [];
    const list = [
      { id: "head_c", label: "Head Center", x: P.head.centre[0], y: P.head.centre[1], set: (x, y) => { P.head.centre[0] = x; P.head.centre[1] = y; } },
      { id: "neck", label: "Neck Pivot", x: P.head.pivot[0], y: P.head.pivot[1], set: (x, y) => { P.head.pivot[0] = x; P.head.pivot[1] = y; } },
      { id: "waist", label: "Waist Pivot", x: P.motion.waist[0], y: P.motion.waist[1], set: (x, y) => { P.motion.waist[0] = x; P.motion.waist[1] = y; } },
    ];
    if (P.motion.shoulder?.armR) list.push({ id: "shR", label: "Shoulder R", x: P.motion.shoulder.armR[0], y: P.motion.shoulder.armR[1], set: (x, y) => { P.motion.shoulder.armR[0] = x; P.motion.shoulder.armR[1] = y; } });
    if (P.motion.shoulder?.armL) list.push({ id: "shL", label: "Shoulder L", x: P.motion.shoulder.armL[0], y: P.motion.shoulder.armL[1], set: (x, y) => { P.motion.shoulder.armL[0] = x; P.motion.shoulder.armL[1] = y; } });
    if (P.tail && P.tail.pivot) list.push({ id: "tail", label: "Tail Pivot", x: P.tail.pivot[0], y: P.tail.pivot[1], set: (x, y) => { P.tail.pivot[0] = x; P.tail.pivot[1] = y; } });
    return list;
  }

  _layerBoxScreen(L, SL) {
    const A = SL.A || [1, 0, 0, 1], t = SL.t || [0, 0];
    const w2 = L.w * 0.5, h2 = L.h * 0.5;
    const raw = [[-w2, -h2], [w2, -h2], [w2, h2], [-w2, h2]].map(([lx, ly]) => [
      A[0] * lx + A[1] * ly + t[0],
      A[2] * lx + A[3] * ly + t[1],
    ]);
    const corners = raw.map(([cx, cy]) => this.canonToScreen(cx, cy));
    const topMid = [(corners[0][0] + corners[1][0]) * 0.5, (corners[0][1] + corners[1][1]) * 0.5];
    const center = this.canonToScreen(t[0], t[1]);
    const vx = topMid[0] - center[0], vy = topMid[1] - center[1];
    const vl = Math.hypot(vx, vy) || 1;
    const rotHandle = [topMid[0] + (vx / vl) * 26, topMid[1] + (vy / vl) * 26];
    return { corners, topMid, center, rotHandle };
  }

  /* ---------- Draw Precision Studio Overlays (60fps) ---------- */
  drawOverlay() {
    const ctx = this.ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.overlay.getBoundingClientRect();
    const pw = Math.max(1, Math.round(rect.width * dpr));
    const ph = Math.max(1, Math.round(rect.height * dpr));
    if (this.overlay.width !== pw || this.overlay.height !== ph) {
      this.overlay.width = pw;
      this.overlay.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const st = this.state;
    const P = st.pack;
    if (!P) return;

    // 1. Subtle architectural grid (when Grid toggle on)
    if (st.view.showGrid) {
      const vw = this.engine.lastView;
      const step = 200;
      const x0 = Math.floor(vw[0] / step) * step;
      const y0 = Math.floor(vw[1] / step) * step;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.032)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x0; x <= vw[2]; x += step) {
        const [sx] = this.canonToScreen(x, 0);
        ctx.moveTo(sx, 0); ctx.lineTo(sx, rect.height);
      }
      for (let y = y0; y <= vw[3]; y += step) {
        const [, sy] = this.canonToScreen(0, y);
        ctx.moveTo(0, sy); ctx.lineTo(rect.width, sy);
      }
      ctx.stroke();
    }

    // 2. Spring Physics Chains spline overlay (matching studio_concept_rigging.png)
    if (st.view.showChains && P.chains && P.chains.length) {
      P.chains.forEach((ch, ci) => {
        const isSel = ci === st.selectedChainIdx;
        const pts = [];
        for (let ji = 0; ji < ch.joints.length / 2; ji++) {
          pts.push(this.canonToScreen(ch.joints[ji * 2], ch.joints[ji * 2 + 1]));
        }
        if (pts.length < 2) return;
        ctx.save();
        ctx.strokeStyle = isSel ? "rgba(242, 243, 245, 0.88)" : "rgba(242, 243, 245, 0.28)";
        ctx.lineWidth = isSel ? 1.5 : 1.0;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();

        pts.forEach(([px, py], ji) => {
          ctx.beginPath();
          ctx.arc(px, py, isSel ? 4.2 : 3.0, 0, Math.PI * 2);
          ctx.fillStyle = ji === 0 ? "#be1e3c" : "#0c0d10";
          ctx.fill();
          ctx.strokeStyle = isSel ? "#f2f3f5" : "rgba(242, 243, 245, 0.45)";
          ctx.lineWidth = 1.4;
          ctx.stroke();
        });
        ctx.restore();
      });
    }

    // 3. Selected Layer Lattice Cage / Mesh Triangulation / Transform Gizmo
    const L = st.getSelectedLayer();
    const SL = st.getActiveSampleLayer();
    if (L && SL && !st.hiddenIds.has(L.id)) {
      const showLat = st.view.showLattice && (st.tool === "warp_brush" || st.tool === "lattice" || st.tool === "mesh");
      if (showLat) {
        const { gd, pts } = latticeCanvasPoints(L, SL, st.brush.gridSize);
        const sPts = pts.map((p) => this.canonToScreen(p.x, p.y));
        ctx.save();
        // Horizontal & vertical lattice lines
        ctx.strokeStyle = "rgba(190, 30, 60, 0.72)";
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (let iy = 0; iy < gd; iy++) {
          for (let ix = 0; ix < gd - 1; ix++) {
            const a = sPts[iy * gd + ix], b = sPts[iy * gd + ix + 1];
            ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
          }
        }
        for (let ix = 0; ix < gd; ix++) {
          for (let iy = 0; iy < gd - 1; iy++) {
            const a = sPts[iy * gd + ix], b = sPts[(iy + 1) * gd + ix];
            ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
          }
        }
        // Extra diagonals in Mesh tool mode
        if (st.tool === "mesh") {
          for (let iy = 0; iy < gd - 1; iy++) {
            for (let ix = 0; ix < gd - 1; ix++) {
              const a = sPts[iy * gd + ix], b = sPts[(iy + 1) * gd + ix + 1];
              ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
            }
          }
        }
        ctx.stroke();

        // Crisp crimson/white square control vertices
        for (let i = 0; i < sPts.length; i++) {
          const [px, py] = sPts[i];
          const isHover = this.hoverHandle?.kind === "lattice_pt" &&
            this.hoverHandle.ix === pts[i].ix && this.hoverHandle.iy === pts[i].iy;
          const sz = isHover ? 7 : 5;
          ctx.fillStyle = isHover ? "#ffffff" : "#be1e3c";
          ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.lineWidth = 0.9;
          ctx.strokeRect(px - sz / 2, py - sz / 2, sz, sz);
        }
        ctx.restore();
      } else if ((st.tool === "transform" || st.tool === "select") && st.mode !== "animate" && st.mode !== "expressions") {
        const box = this._layerBoxScreen(L, SL);
        if (box) {
          ctx.save();
          ctx.strokeStyle = "rgba(190, 30, 60, 0.85)";
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.moveTo(box.corners[0][0], box.corners[0][1]);
          for (let i = 1; i < 4; i++) ctx.lineTo(box.corners[i][0], box.corners[i][1]);
          ctx.closePath();
          ctx.stroke();

          // Rotation stem & handle
          ctx.beginPath();
          ctx.moveTo(box.topMid[0], box.topMid[1]);
          ctx.lineTo(box.rotHandle[0], box.rotHandle[1]);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(box.rotHandle[0], box.rotHandle[1], 4.5, 0, Math.PI * 2);
          ctx.fillStyle = "#be1e3c"; ctx.fill();
          ctx.strokeStyle = "#f2f3f5"; ctx.stroke();

          // Corner scale handles
          for (const [cx, cy] of box.corners) {
            ctx.fillStyle = "#f2f3f5";
            ctx.fillRect(cx - 3.5, cy - 3.5, 7, 7);
            ctx.strokeStyle = "#be1e3c";
            ctx.strokeRect(cx - 3.5, cy - 3.5, 7, 7);
          }

          // Center crosshair
          ctx.strokeStyle = "rgba(255,255,255,0.8)";
          ctx.beginPath();
          ctx.moveTo(box.center[0] - 6, box.center[1]); ctx.lineTo(box.center[0] + 6, box.center[1]);
          ctx.moveTo(box.center[0], box.center[1] - 6); ctx.lineTo(box.center[0], box.center[1] + 6);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // 4. Rig Pivot Handles (Neck, Waist, Shoulders, Head Center, Tail Pivot)
    if (st.view.showPivots || st.tool === "pivot") {
      const pivots = this._getPivots();
      ctx.save();
      for (const pv of pivots) {
        const [px, py] = this.canonToScreen(pv.x, pv.y);
        ctx.fillStyle = pv.id === "tail" ? "#be1e3c" : "#13151b";
        ctx.strokeStyle = "#f2f3f5";
        ctx.lineWidth = 1.4;
        ctx.fillRect(px - 4.5, py - 4.5, 9, 9);
        ctx.strokeRect(px - 4.5, py - 4.5, 9, 9);
        ctx.font = '10.5px "JetBrains Mono", monospace';
        ctx.fillStyle = "rgba(242, 243, 245, 0.82)";
        ctx.fillText(pv.label, px + 8, py + 3);
      }
      ctx.restore();
    }

    // 5. Crisp Warp Brush Ring Cursor (matching studio_concept_rigging.png!)
    if (st.tool === "warp_brush" && this.pointer.inside && !this.spaceHeld) {
      const r = st.brush.radius;
      const px = this.pointer.x, py = this.pointer.y;
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(190, 30, 60, 0.92)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = "rgba(190, 30, 60, 0.08)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px - 5, py); ctx.lineTo(px + 5, py);
      ctx.moveTo(px, py - 5); ctx.lineTo(px, py + 5);
      ctx.stroke();
      ctx.restore();
    }
  }
}
