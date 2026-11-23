/**
 * Interactive Studio Viewport Controller & 2D Precision Vector Overlay
 * Handles:
 *   - Pan / Zoom (wheel, middle-drag, Space+drag, Hand tool)
 *   - Alpha-accurate click-to-select layer (forward-mesh aware)
 *   - Unified Rig Target editing: Angle X keyforms, Angle Y keyforms, AND Blend Shapes!
 *   - Multi-vertex selection (Click, Shift+Click, Marquee box-select) + Soft Selection + Pin Border
 *   - Forward-mesh 1:1 Lattice & Mesh Vertex dragging with anti-fold protection & rest-wireframe ghost
 *   - Forward-mesh Liquify Warp Brush (Push / Smooth / Restore)
 *   - Transform gizmo (drag translate, corner scale, top rotation handle)
 *   - Spring Physics Chain Spline Editor & Rig Pivot Handles
 */

import {
  latticeCanvasPoints,
  dragLatticePoints,
  applyWarpBrush,
  decomposeAffine,
  composeAffine,
  inv2,
} from "./warp_math.js";
import { computeNodeBounds, buildSceneGraph } from "./scene_graph.js";

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

  /**
   * Lock active rig target & resync engine frame state cleanly before mutating a layer.
   */
  _prepareEditTarget() {
    const st = this.state;
    if (st.rigTarget.type === "yaw") {
      st.snapToSample(st.activeSampleIdx);
      this.engine.syncFrameState(st.params, st.activeSampleIdx, st.snapToPitch ? st.activePitchIdx : null);
    } else if (st.rigTarget.type === "pitch") {
      st.snapToPitchSample(st.activePitchIdx);
      this.engine.syncFrameState(st.params, st.snapToKeyform ? st.activeSampleIdx : null, st.activePitchIdx);
    } else if (st.rigTarget.type === "blend") {
      const bs = st.getActiveBlendShape();
      if (bs && Math.abs(st.params.blend[bs.id] ?? 0) < 0.05) {
        st.setBlendWeight(bs.id, bs.max ?? 1);
      }
      this.engine.syncFrameState(st.params, st.snapToKeyform ? st.activeSampleIdx : null, st.snapToPitch ? st.activePitchIdx : null);
    }
    return st.getEditTargetForLayer(st.selectedLayerIdx, true);
  }

  _prepareNodeEditTarget() {
    const st = this.state;
    if (st.rigTarget.type === "yaw") {
      st.snapToSample(st.activeSampleIdx);
      this.engine.syncFrameState(st.params, st.activeSampleIdx, st.snapToPitch ? st.activePitchIdx : null);
    } else if (st.rigTarget.type === "pitch") {
      st.snapToPitchSample(st.activePitchIdx);
      this.engine.syncFrameState(st.params, st.snapToKeyform ? st.activeSampleIdx : null, st.activePitchIdx);
    } else if (st.rigTarget.type === "blend") {
      const bs = st.getActiveBlendShape();
      if (bs && Math.abs(st.params.blend[bs.id] ?? 0) < 0.05) {
        st.setBlendWeight(bs.id, bs.max ?? 1);
      }
      this.engine.syncFrameState(st.params, st.snapToKeyform ? st.activeSampleIdx : null, st.snapToPitch ? st.activePitchIdx : null);
    }
    return st.getEditTargetForNode(st.selectedNodeId, true);
  }

  /**
   * Nudge selected Group Node, mesh vertices, OR selected layer transform by canonical pixels (Arrow keys).
   */
  nudgeSelection(dx, dy) {
    const st = this.state;
    const node = st.getSelectedNode();
    if (node) {
      st.pushUndo("Nudge Transform Group");
      const target = this._prepareNodeEditTarget();
      if (!target || !target.obj) return false;
      const pInv = inv2(this.engine.getParentWorldTransform(node.id).M);
      const ldx = pInv[0] * dx + pInv[1] * dy;
      const ldy = pInv[2] * dx + pInv[3] * dy;
      const ws = Math.max(0.05, Math.abs(target.weightScale || 1));
      target.obj.dt = target.obj.dt || [0, 0];
      target.obj.dt[0] = +(target.obj.dt[0] + ldx / ws).toFixed(2);
      target.obj.dt[1] = +(target.obj.dt[1] + ldy / ws).toFixed(2);
      st.emit("pack:mutated", { structural: false });
      return true;
    }

    const L = st.getSelectedLayer();
    if (!L || st.lockedIds.has(L.id)) return false;

    const lIdx = st.selectedLayerIdx;
    if ((st.tool === "lattice" || st.tool === "mesh") && st.selectedVerts.size > 0) {
      st.pushUndo("Nudge Mesh Vertices");
      const target = this._prepareEditTarget();
      if (!target || !target.obj) return false;
      const liveSL = this.engine.getLiveSampleLayer(lIdx);
      const toScr = (p) => this.engine.layerToScreenCanon(lIdx, p);
      const softRadCanon = st.brush.softRadius / Math.max(0.05, this.canonScale());
      dragLatticePoints(L, target.obj, liveSL, [...st.selectedVerts], dx, dy, {
        defaultGd: st.brush.gridSize,
        pinBorder: st.brush.pinBorder,
        softSelect: st.brush.softSelect,
        softRadiusCanon: softRadCanon,
        toScreenFn: toScr,
        weightScale: target.weightScale,
      });
      st.emit("pack:mutated", { structural: false });
      return true;
    }

    st.pushUndo("Nudge Layer");
    const target = this._prepareEditTarget();
    if (!target || !target.obj) return false;
    const pInv = inv2(this.engine.getParentWorldTransform(L.id).M);
    const ldx = pInv[0] * dx + pInv[1] * dy;
    const ldy = pInv[2] * dx + pInv[3] * dy;
    if (target.kind === "yaw") {
      target.obj.t[0] = +(target.obj.t[0] + ldx).toFixed(2);
      target.obj.t[1] = +(target.obj.t[1] + ldy).toFixed(2);
    } else {
      const ws = Math.max(0.05, Math.abs(target.weightScale || 1));
      target.obj.dt = target.obj.dt || [0, 0];
      target.obj.dt[0] = +(target.obj.dt[0] + ldx / ws).toFixed(2);
      target.obj.dt[1] = +(target.obj.dt[1] + ldy / ws).toFixed(2);
    }
    st.emit("pack:mutated", { structural: false });
    return true;
  }

  _hitTestHandles(sx, sy) {
    const st = this.state;
    const P = st.pack;
    if (!P) return null;

    // 1. Pivot handles
    if (st.tool === "pivot" || st.view.showPivots) {
      const pivots = this._getPivots();
      for (const pv of pivots) {
        const [px, py] = this.canonToScreen(pv.x, pv.y);
        if (Math.hypot(sx - px, sy - py) <= 10) return { kind: "pivot", pivot: pv };
      }
    }

    // 2. Spring chain joints
    if (st.tool === "chain" || st.view.showChains) {
      for (let ci = 0; ci < (P.chains || []).length; ci++) {
        const livePts = this.engine.getChainLivePoints(ci);
        for (let ji = 0; ji < livePts.length; ji++) {
          const [px, py] = this.canonToScreen(livePts[ji][0], livePts[ji][1]);
          if (Math.hypot(sx - px, sy - py) <= 9) return { kind: "chain_joint", ci, ji };
        }
      }
    }

    // 3. Forward Lattice / Mesh vertex handles on selected layer
    const L = st.getSelectedLayer();
    const lIdx = st.selectedLayerIdx;
    const SL = lIdx >= 0 ? this.engine.getLiveSampleLayer(lIdx) : null;
    if (L && SL && (st.tool === "lattice" || st.tool === "mesh")) {
      const toScr = (p) => this.engine.layerToScreenCanon(lIdx, p);
      const { gd, pts } = latticeCanvasPoints(L, SL, st.brush.gridSize, toScr);
      let best = null, bestD = 10;
      for (const pt of pts) {
        const [px, py] = this.canonToScreen(pt.x, pt.y);
        const d = Math.hypot(sx - px, sy - py);
        if (d < bestD) { bestD = d; best = { kind: "lattice_pt", ix: pt.ix, iy: pt.iy, vIdx: pt.vIdx, gd }; }
      }
      if (best) return best;
    }

    // 4. Transform gizmo handles on selected Group Node OR selected Layer
    const selNode = st.getSelectedNode();
    if (selNode && (st.tool === "transform" || st.tool === "select")) {
      const nbox = this._nodeBoxScreen(selNode);
      if (nbox) {
        if (Math.hypot(sx - nbox.rotHandle[0], sy - nbox.rotHandle[1]) <= 10) return { kind: "node_rot", nodeId: selNode.id };
        for (let i = 0; i < 4; i++) {
          if (Math.hypot(sx - nbox.corners[i][0], sy - nbox.corners[i][1]) <= 9) return { kind: "node_scale", nodeId: selNode.id, corner: i };
        }
      }
    }

    if (L && SL && (st.tool === "transform" || st.tool === "select")) {
      const box = this._layerBoxScreen(L, lIdx, SL);
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
        const ch = P.chains[hit.ci];
        this.drag = {
          type: "chain_joint",
          ci: hit.ci,
          ji: hit.ji,
          startCanon: canon,
          origJoint: ch ? [ch.joints[hit.ji * 2], ch.joints[hit.ji * 2 + 1]] : [canon[0], canon[1]],
        };
        this.overlay.setPointerCapture(e.pointerId);
        return;
      }
      if (hit.kind === "lattice_pt") {
        const L = st.getSelectedLayer();
        if (!L || st.lockedIds.has(L.id)) return;
        // Multi-vertex selection: Shift toggles; clicking an unselected vertex replaces selection
        if (e.shiftKey) {
          if (st.selectedVerts.has(hit.vIdx)) st.selectedVerts.delete(hit.vIdx);
          else st.selectedVerts.add(hit.vIdx);
        } else if (!st.selectedVerts.has(hit.vIdx)) {
          st.selectedVerts.clear();
          st.selectedVerts.add(hit.vIdx);
        }
        this.drag = {
          type: "lattice_pt",
          ix: hit.ix,
          iy: hit.iy,
          vIdx: hit.vIdx,
          startX: sx,
          startY: sy,
          prevCanon: canon,
          undoPushed: false,
          target: null,
        };
        this.overlay.setPointerCapture(e.pointerId);
        return;
      }
      if (hit.kind === "node_rot") {
        const node = st.getSelectedNode();
        if (!node) return;
        st.pushUndo("Rotate Transform Group");
        const target = this._prepareNodeEditTarget();
        if (!target || !target.obj) return;
        const nw = this.engine.lastFrame?.key?._nodeWorld?.[node.id];
        const pivot = nw ? nw.worldPivot : (node.pivot || [P.canvas[0] * 0.5, P.canvas[1] * 0.5]);
        const pNode = this.engine.screenToNodeCanon(node.id, canon);
        const ang0 = Math.atan2(pNode[1] - pivot[1], pNode[0] - pivot[0]);
        this.drag = {
          type: "node_rot",
          nodeId: node.id,
          target,
          origDRot: target.obj.dRot || 0,
          pivot: [...pivot],
          ang0,
        };
        this.overlay.setPointerCapture(e.pointerId);
        return;
      }
      if (hit.kind === "node_scale") {
        const node = st.getSelectedNode();
        if (!node) return;
        st.pushUndo("Scale Transform Group");
        const target = this._prepareNodeEditTarget();
        if (!target || !target.obj) return;
        const nw = this.engine.lastFrame?.key?._nodeWorld?.[node.id];
        const pivot = nw ? nw.worldPivot : (node.pivot || [P.canvas[0] * 0.5, P.canvas[1] * 0.5]);
        const pNode = this.engine.screenToNodeCanon(node.id, canon);
        const d0 = Math.max(10, Math.hypot(pNode[0] - pivot[0], pNode[1] - pivot[1]));
        this.drag = {
          type: "node_scale",
          nodeId: node.id,
          target,
          origDScale: target.obj.dScale ? [...target.obj.dScale] : [0, 0],
          pivot: [...pivot],
          d0,
        };
        this.overlay.setPointerCapture(e.pointerId);
        return;
      }
      if (hit.kind === "rot") {
        const L = st.getSelectedLayer();
        if (!L || st.lockedIds.has(L.id)) return;
        st.pushUndo("Rotate Layer");
        const target = this._prepareEditTarget();
        if (!target || !target.obj) return;
        const liveSL = this.engine.getLiveSampleLayer(st.selectedLayerIdx);
        const dec = decomposeAffine(target.kind === "yaw" ? target.obj.A : liveSL.A);
        const pLayer = this.engine.screenToLayerCanon(st.selectedLayerIdx, canon);
        const ang0 = Math.atan2(pLayer[1] - liveSL.t[1], pLayer[0] - liveSL.t[0]);
        this.drag = {
          type: "rot",
          target,
          dec,
          origDRot: target.obj.dRot || 0,
          pivot: [...liveSL.t],
          ang0,
        };
        this.overlay.setPointerCapture(e.pointerId);
        return;
      }
      if (hit.kind === "scale") {
        const L = st.getSelectedLayer();
        if (!L || st.lockedIds.has(L.id)) return;
        st.pushUndo("Scale Layer");
        const target = this._prepareEditTarget();
        if (!target || !target.obj) return;
        const liveSL = this.engine.getLiveSampleLayer(st.selectedLayerIdx);
        const dec = decomposeAffine(target.kind === "yaw" ? target.obj.A : liveSL.A);
        const pLayer = this.engine.screenToLayerCanon(st.selectedLayerIdx, canon);
        const d0 = Math.max(10, Math.hypot(pLayer[0] - liveSL.t[0], pLayer[1] - liveSL.t[1]));
        this.drag = {
          type: "scale",
          target,
          dec,
          origDScale: target.obj.dScale ? [...target.obj.dScale] : [0, 0],
          pivot: [...liveSL.t],
          d0,
        };
        this.overlay.setPointerCapture(e.pointerId);
        return;
      }
    }

    // Marquee box-select vertices when clicking empty canvas in Lattice / Mesh tool
    if (st.tool === "lattice" || st.tool === "mesh") {
      if (!e.shiftKey) st.selectedVerts.clear();
      this.drag = { type: "marquee", startX: sx, startY: sy, curX: sx, curY: sy, additive: e.shiftKey };
      this.overlay.setPointerCapture(e.pointerId);
      return;
    }

    // Warp Sculpt Brush
    if (st.tool === "warp_brush") {
      const L = st.getSelectedLayer();
      if (L && !st.lockedIds.has(L.id)) {
        st.pushUndo("Warp Brush Stroke");
        const target = this._prepareEditTarget();
        if (!target || !target.obj) return;
        this.drag = { type: "warp_brush", prevCanon: canon, target };
        this.overlay.setPointerCapture(e.pointerId);
        return;
      }
    }

    // Transform / Select tool
    if (st.tool === "transform" || st.tool === "select") {
      // If a Transform Group is selected and pointer is inside its gizmo box (in Transform tool), drag the Group!
      const selNode = st.getSelectedNode();
      if (selNode && st.tool === "transform") {
        const nbox = this._nodeBoxScreen(selNode);
        if (nbox && this._pointInScreenBox(sx, sy, nbox)) {
          this.drag = {
            type: "node_translate",
            nodeId: selNode.id,
            startX: sx,
            startY: sy,
            startCanon: canon,
            undoPushed: false,
            target: null,
            startNode: null,
            origT: null,
            parentInv: null,
          };
          this.overlay.setPointerCapture(e.pointerId);
          return;
        }
      }

      const picked = this.engine.pickLayerAt(
        canon[0], canon[1],
        st.params.a,
        st.snapToKeyform ? st.activeSampleIdx : null,
        st.hiddenIds,
        st.soloId,
        st.params.wear,
        st.params,
      );
      if (picked >= 0 && (st.tool === "select" || picked !== st.selectedLayerIdx)) {
        st.selectLayer(picked);
      }
      const L = st.getSelectedLayer();
      if (L && st.tool === "transform" && !st.lockedIds.has(L.id)) {
        this.drag = {
          type: "translate",
          startX: sx,
          startY: sy,
          startCanon: canon,
          undoPushed: false,
          target: null,
          startLayer: null,
          origT: null,
        };
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

    if (this.drag.type === "marquee") {
      this.drag.curX = sx;
      this.drag.curY = sy;
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
        const dx = canon[0] - this.drag.startCanon[0];
        const dy = canon[1] - this.drag.startCanon[1];
        ch.joints[this.drag.ji * 2] = +(this.drag.origJoint[0] + dx).toFixed(1);
        ch.joints[this.drag.ji * 2 + 1] = +(this.drag.origJoint[1] + dy).toFixed(1);
        st.emit("pack:mutated", { structural: true });
      }
      return;
    }

    if (this.drag.type === "node_translate") {
      if (!this.drag.undoPushed) {
        if (Math.hypot(sx - this.drag.startX, sy - this.drag.startY) < 2) return;
        st.pushUndo("Move Transform Group");
        const target = this._prepareNodeEditTarget();
        if (!target || !target.obj) return;
        this.drag.target = target;
        this.drag.startNode = this.engine.screenToNodeCanon(this.drag.nodeId, this.drag.startCanon);
        this.drag.origT = [...(target.obj.dt || [0, 0])];
        this.drag.parentInv = inv2(this.engine.getParentWorldTransform(this.drag.nodeId).M);
        this.drag.undoPushed = true;
      }
      const target = this.drag.target;
      const currNode = this.engine.screenToNodeCanon(this.drag.nodeId, canon);
      const dxW = currNode[0] - this.drag.startNode[0];
      const dyW = currNode[1] - this.drag.startNode[1];
      const pInv = this.drag.parentInv || [1, 0, 0, 1];
      const dx = pInv[0] * dxW + pInv[1] * dyW;
      const dy = pInv[2] * dxW + pInv[3] * dyW;
      const ws = Math.max(0.05, Math.abs(target.weightScale || 1));
      target.obj.dt = [+(this.drag.origT[0] + dx / ws).toFixed(2), +(this.drag.origT[1] + dy / ws).toFixed(2)];
      st.emit("pack:mutated", { structural: false });
      return;
    }

    if (this.drag.type === "node_rot") {
      const target = this.drag.target;
      const currNode = this.engine.screenToNodeCanon(this.drag.nodeId, canon);
      const ang = Math.atan2(currNode[1] - this.drag.pivot[1], currNode[0] - this.drag.pivot[0]);
      const deltaDeg = ((ang - this.drag.ang0) * 180) / Math.PI;
      const ws = Math.max(0.05, Math.abs(target.weightScale || 1));
      target.obj.dRot = +(this.drag.origDRot + deltaDeg / ws).toFixed(3);
      st.emit("pack:mutated", { structural: false });
      return;
    }

    if (this.drag.type === "node_scale") {
      const target = this.drag.target;
      const currNode = this.engine.screenToNodeCanon(this.drag.nodeId, canon);
      const d = Math.max(10, Math.hypot(currNode[0] - this.drag.pivot[0], currNode[1] - this.drag.pivot[1]));
      const f = d / this.drag.d0;
      const ws = Math.max(0.05, Math.abs(target.weightScale || 1));
      const ds = (f - 1) / ws;
      target.obj.dScale = [+(this.drag.origDScale[0] + ds).toFixed(4), +(this.drag.origDScale[1] + ds).toFixed(4)];
      st.emit("pack:mutated", { structural: false });
      return;
    }

    const L = st.getSelectedLayer();
    const lIdx = st.selectedLayerIdx;
    if (!L || lIdx < 0) return;

    if (this.drag.type === "translate") {
      if (!this.drag.undoPushed) {
        if (Math.hypot(sx - this.drag.startX, sy - this.drag.startY) < 2) return;
        st.pushUndo("Move Layer");
        const target = this._prepareEditTarget();
        if (!target || !target.obj) return;
        this.drag.target = target;
        this.drag.startLayer = this.engine.screenToLayerCanon(lIdx, this.drag.startCanon);
        this.drag.origT = target.kind === "yaw" ? [...target.obj.t] : [...(target.obj.dt || [0, 0])];
        this.drag.parentInv = inv2(this.engine.getParentWorldTransform(L.id).M);
        this.drag.undoPushed = true;
      }
      const target = this.drag.target;
      const currLayer = this.engine.screenToLayerCanon(lIdx, canon);
      const dxW = currLayer[0] - this.drag.startLayer[0];
      const dyW = currLayer[1] - this.drag.startLayer[1];
      const pInv = this.drag.parentInv || [1, 0, 0, 1];
      const dx = pInv[0] * dxW + pInv[1] * dyW;
      const dy = pInv[2] * dxW + pInv[3] * dyW;
      if (target.kind === "yaw") {
        target.obj.t[0] = +(this.drag.origT[0] + dx).toFixed(2);
        target.obj.t[1] = +(this.drag.origT[1] + dy).toFixed(2);
      } else {
        const ws = Math.max(0.05, Math.abs(target.weightScale || 1));
        target.obj.dt = [+(this.drag.origT[0] + dx / ws).toFixed(2), +(this.drag.origT[1] + dy / ws).toFixed(2)];
      }
      st.emit("pack:mutated", { structural: false });
      return;
    }

    if (this.drag.type === "rot") {
      const target = this.drag.target;
      const currLayer = this.engine.screenToLayerCanon(lIdx, canon);
      const ang = Math.atan2(currLayer[1] - this.drag.pivot[1], currLayer[0] - this.drag.pivot[0]);
      const deltaDeg = ((ang - this.drag.ang0) * 180) / Math.PI;
      if (target.kind === "yaw") {
        target.obj.A = composeAffine(this.drag.dec.sx, this.drag.dec.sy, this.drag.dec.rotDeg + deltaDeg);
      } else {
        const ws = Math.max(0.05, Math.abs(target.weightScale || 1));
        target.obj.dRot = +(this.drag.origDRot + deltaDeg / ws).toFixed(3);
      }
      st.emit("pack:mutated", { structural: false });
      return;
    }

    if (this.drag.type === "scale") {
      const target = this.drag.target;
      const currLayer = this.engine.screenToLayerCanon(lIdx, canon);
      const d = Math.max(10, Math.hypot(currLayer[0] - this.drag.pivot[0], currLayer[1] - this.drag.pivot[1]));
      const f = d / this.drag.d0;
      if (target.kind === "yaw") {
        target.obj.A = composeAffine(this.drag.dec.sx * f, this.drag.dec.sy * f, this.drag.dec.rotDeg);
      } else {
        const ws = Math.max(0.05, Math.abs(target.weightScale || 1));
        const ds = (f - 1) / ws;
        target.obj.dScale = [+(this.drag.origDScale[0] + ds).toFixed(4), +(this.drag.origDScale[1] + ds).toFixed(4)];
      }
      st.emit("pack:mutated", { structural: false });
      return;
    }

    if (this.drag.type === "lattice_pt") {
      if (!this.drag.undoPushed) {
        if (Math.hypot(sx - this.drag.startX, sy - this.drag.startY) < 1.5) return;
        st.pushUndo("Sculpt Mesh Vertices");
        const target = this._prepareEditTarget();
        if (!target || !target.obj) return;
        this.drag.target = target;
        this.drag.undoPushed = true;
      }
      const target = this.drag.target;
      const liveSL = this.engine.getLiveSampleLayer(lIdx);
      const prevLayer = this.engine.screenToLayerCanon(lIdx, this.drag.prevCanon);
      const currLayer = this.engine.screenToLayerCanon(lIdx, canon);
      const dx = currLayer[0] - prevLayer[0];
      const dy = currLayer[1] - prevLayer[1];
      const toScr = (p) => this.engine.layerToScreenCanon(lIdx, p);
      const softRadCanon = st.brush.softRadius / Math.max(0.05, this.canonScale());
      const verts = st.selectedVerts.size ? [...st.selectedVerts] : [this.drag.vIdx];
      dragLatticePoints(L, target.obj, liveSL, verts, dx, dy, {
        defaultGd: st.brush.gridSize,
        pinBorder: st.brush.pinBorder,
        softSelect: st.brush.softSelect,
        softRadiusCanon: softRadCanon,
        toScreenFn: toScr,
        weightScale: target.weightScale,
      });
      this.drag.prevCanon = canon;
      st.emit("pack:mutated", { structural: false });
      return;
    }

    if (this.drag.type === "warp_brush") {
      const target = this.drag.target;
      if (!target || !target.obj) return;
      const liveSL = this.engine.getLiveSampleLayer(lIdx);
      const radCanon = st.brush.radius / Math.max(0.05, this.canonScale());
      const toScr = (p) => this.engine.layerToScreenCanon(lIdx, p);
      const toLay = (p) => this.engine.screenToLayerCanon(lIdx, p);
      const changed = applyWarpBrush(
        L, target.obj, this.drag.prevCanon, canon, radCanon, st.brush.strength, st.brush.mode, st.brush.gridSize, toScr, toLay,
        { liveSampleLayer: liveSL, pinBorder: st.brush.pinBorder, weightScale: target.weightScale },
      );
      this.drag.prevCanon = canon;
      if (changed) st.emit("pack:mutated", { structural: false });
    }
  }

  _onUp() {
    if (!this.drag) return;
    if (this.drag.type === "marquee") {
      const st = this.state;
      const L = st.getSelectedLayer();
      const lIdx = st.selectedLayerIdx;
      const SL = lIdx >= 0 ? this.engine.getLiveSampleLayer(lIdx) : null;
      if (L && SL) {
        const x0 = Math.min(this.drag.startX, this.drag.curX), x1 = Math.max(this.drag.startX, this.drag.curX);
        const y0 = Math.min(this.drag.startY, this.drag.curY), y1 = Math.max(this.drag.startY, this.drag.curY);
        if (x1 - x0 > 4 || y1 - y0 > 4) {
          const toScr = (p) => this.engine.layerToScreenCanon(lIdx, p);
          const { pts } = latticeCanvasPoints(L, SL, st.brush.gridSize, toScr);
          for (const pt of pts) {
            const [px, py] = this.canonToScreen(pt.x, pt.y);
            if (px >= x0 && px <= x1 && py >= y0 && py <= y1) st.selectedVerts.add(pt.vIdx);
          }
        }
      }
    }
    this.drag = null;
    this._updateCursor();
  }

  _updateCursor() {
    const st = this.state;
    if (this.drag && this.drag.type === "pan") { this.overlay.style.cursor = "grabbing"; return; }
    if (st.tool === "pan" || this.spaceHeld) { this.overlay.style.cursor = "grab"; return; }
    if (st.tool === "warp_brush") { this.overlay.style.cursor = "none"; return; }
    if (this.hoverHandle) { this.overlay.style.cursor = "pointer"; return; }
    this.overlay.style.cursor = st.tool === "transform" ? "move" : (st.tool === "lattice" || st.tool === "mesh" ? "crosshair" : "default");
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
    for (const node of P.nodes || []) {
      const pv = node.pivot || [P.canvas[0] * 0.5, P.canvas[1] * 0.5];
      list.push({
        id: `node_${node.id}`,
        label: `◆ ${node.name || node.id}`,
        isGroup: true,
        x: pv[0],
        y: pv[1],
        set: (x, y) => { node.pivot = [x, y]; },
      });
    }
    return list;
  }

  _nodeBoxScreen(node) {
    const P = this.state.pack;
    const fr = this.engine.lastFrame;
    if (!P || !fr || !node) return null;
    const b = computeNodeBounds(P, node.id, fr.key, fr.key._nodeWorld);
    if (!b) return null;
    const toScr = (cx, cy) => {
      const sp = this.engine.nodeToScreenCanon(node.id, [cx, cy], fr);
      return this.canonToScreen(sp[0], sp[1]);
    };
    const corners = [
      toScr(b.x0, b.y0),
      toScr(b.x1, b.y0),
      toScr(b.x1, b.y1),
      toScr(b.x0, b.y1),
    ];
    const topMid = toScr((b.x0 + b.x1) * 0.5, b.y0);
    const center = toScr((b.x0 + b.x1) * 0.5, (b.y0 + b.y1) * 0.5);
    const pivot = toScr(b.pivot[0], b.pivot[1]);
    const vx = topMid[0] - center[0], vy = topMid[1] - center[1];
    const vl = Math.hypot(vx, vy) || 1;
    const rotHandle = [topMid[0] + (vx / vl) * 26, topMid[1] + (vy / vl) * 26];
    return { corners, topMid, center, pivot, rotHandle };
  }

  _pointInScreenBox(sx, sy, box) {
    if (!box) return false;
    if (box.pivot && Math.hypot(sx - box.pivot[0], sy - box.pivot[1]) <= 18) return true;
    const xs = box.corners.map((c) => c[0]), ys = box.corners.map((c) => c[1]);
    return sx >= Math.min(...xs) - 6 && sx <= Math.max(...xs) + 6 && sy >= Math.min(...ys) - 6 && sy <= Math.max(...ys) + 6;
  }

  _layerBoxScreen(L, layerIdx, SL) {
    const A = SL.A || [1, 0, 0, 1], t = SL.t || [0, 0];
    const w2 = L.w * 0.5, h2 = L.h * 0.5;
    const toScr = (lx, ly) => {
      const lp = [A[0] * lx + A[1] * ly + t[0], A[2] * lx + A[3] * ly + t[1]];
      const sp = this.engine.layerToScreenCanon(layerIdx, lp);
      return this.canonToScreen(sp[0], sp[1]);
    };
    const corners = [[-w2, -h2], [w2, -h2], [w2, h2], [-w2, h2]].map(([lx, ly]) => toScr(lx, ly));
    const topMid = toScr(0, -h2);
    const center = toScr(0, 0);
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

    // 1. Subtle architectural grid
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

    // 2. Spring Physics Chains spline overlay
    if (st.view.showChains && P.chains && P.chains.length) {
      P.chains.forEach((ch, ci) => {
        const isSel = ci === st.selectedChainIdx;
        const livePts = this.engine.getChainLivePoints(ci);
        const pts = livePts.map(([x, y]) => this.canonToScreen(x, y));
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

    // 3. Selected Layer Forward Lattice Cage / Mesh Triangulation / Transform Gizmo
    const L = st.getSelectedLayer();
    const lIdx = st.selectedLayerIdx;
    const SL = lIdx >= 0 ? this.engine.getLiveSampleLayer(lIdx) : null;
    if (L && SL && !st.hiddenIds.has(L.id)) {
      const showLat = st.view.showLattice && (st.tool === "warp_brush" || st.tool === "lattice" || st.tool === "mesh");
      if (showLat) {
        const toScr = (p) => this.engine.layerToScreenCanon(lIdx, p);
        const { gd, pts, health } = latticeCanvasPoints(L, SL, st.brush.gridSize, toScr);
        const sPts = pts.map((p) => this.canonToScreen(p.x, p.y));
        const rPts = pts.map((p) => this.canonToScreen(p.rx, p.ry));
        const isBlend = st.rigTarget.type === "blend";
        const isPitch = st.rigTarget.type === "pitch";

        ctx.save();
        // Faint rest-pose ghost wireframe so riggers can judge exact displacement
        ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let iy = 0; iy < gd; iy++) {
          for (let ix = 0; ix < gd - 1; ix++) {
            const a = rPts[iy * gd + ix], b = rPts[iy * gd + ix + 1];
            ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
          }
        }
        for (let ix = 0; ix < gd; ix++) {
          for (let iy = 0; iy < gd - 1; iy++) {
            const a = rPts[iy * gd + ix], b = rPts[(iy + 1) * gd + ix];
            ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
          }
        }
        ctx.stroke();

        // Fold-over / pinch warning highlight on any stressed quad
        if (health) {
          for (let iy = 0; iy < gd - 1; iy++) {
            for (let ix = 0; ix < gd - 1; ix++) {
              const r = health[iy * (gd - 1) + ix];
              if (r < 0.25) {
                const a = sPts[iy * gd + ix], b = sPts[iy * gd + ix + 1];
                const c = sPts[(iy + 1) * gd + ix + 1], d = sPts[(iy + 1) * gd + ix];
                ctx.fillStyle = r < 0.12 ? "rgba(255, 59, 92, 0.26)" : "rgba(245, 166, 35, 0.16)";
                ctx.beginPath();
                ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
                ctx.closePath();
                ctx.fill();
              }
            }
          }
        }

        // Active deformed wireframe (color-coded by rig target: crimson=Yaw, sky=Angle Y, violet=Blend Shape!)
        ctx.strokeStyle = isBlend ? "rgba(176, 118, 255, 0.82)" : isPitch ? "rgba(88, 178, 255, 0.82)" : "rgba(190, 30, 60, 0.78)";
        ctx.lineWidth = 1.15;
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
        if (st.tool === "mesh") {
          for (let iy = 0; iy < gd - 1; iy++) {
            for (let ix = 0; ix < gd - 1; ix++) {
              const a = sPts[iy * gd + ix], b = sPts[(iy + 1) * gd + ix + 1];
              ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
            }
          }
        }
        ctx.stroke();

        // Crisp square control vertices (selected = bright cyan/white, pinned border = dim hollow)
        const accentFill = isBlend ? "#9a5cff" : isPitch ? "#3c9dff" : "#be1e3c";
        for (let i = 0; i < sPts.length; i++) {
          const [px, py] = sPts[i];
          const pt = pts[i];
          const isHover = this.hoverHandle?.kind === "lattice_pt" && this.hoverHandle.vIdx === pt.vIdx;
          const isSel = st.selectedVerts.has(pt.vIdx);
          const isPinned = st.brush.pinBorder && (pt.ix === 0 || pt.iy === 0 || pt.ix === gd - 1 || pt.iy === gd - 1);
          const sz = isSel ? 8 : (isHover ? 7 : 5);
          ctx.fillStyle = isSel ? "#5ce1e6" : (isHover ? "#ffffff" : (isPinned ? "#15171d" : accentFill));
          ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
          ctx.strokeStyle = isSel ? "#ffffff" : (isPinned ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.85)");
          ctx.lineWidth = isSel ? 1.5 : 0.9;
          ctx.strokeRect(px - sz / 2, py - sz / 2, sz, sz);
        }

        // Soft-selection radius ring when enabled and vertices selected
        if ((st.tool === "lattice" || st.tool === "mesh") && st.brush.softSelect && st.selectedVerts.size > 0) {
          const firstV = [...st.selectedVerts][0];
          if (sPts[firstV]) {
            ctx.beginPath();
            ctx.setLineDash([4, 4]);
            ctx.arc(sPts[firstV][0], sPts[firstV][1], st.brush.softRadius, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(92, 225, 230, 0.45)";
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        ctx.restore();
      } else if ((st.tool === "transform" || st.tool === "select") && st.mode !== "animate" && st.mode !== "expressions") {
        const box = this._layerBoxScreen(L, lIdx, SL);
        if (box) {
          ctx.save();
          ctx.strokeStyle = st.rigTarget.type === "blend" ? "rgba(176, 118, 255, 0.9)"
            : st.rigTarget.type === "pitch" ? "rgba(88, 178, 255, 0.9)"
            : "rgba(190, 30, 60, 0.85)";
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.moveTo(box.corners[0][0], box.corners[0][1]);
          for (let i = 1; i < 4; i++) ctx.lineTo(box.corners[i][0], box.corners[i][1]);
          ctx.closePath();
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(box.topMid[0], box.topMid[1]);
          ctx.lineTo(box.rotHandle[0], box.rotHandle[1]);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(box.rotHandle[0], box.rotHandle[1], 4.5, 0, Math.PI * 2);
          ctx.fillStyle = "#be1e3c"; ctx.fill();
          ctx.strokeStyle = "#f2f3f5"; ctx.stroke();

          for (const [cx, cy] of box.corners) {
            ctx.fillStyle = "#f2f3f5";
            ctx.fillRect(cx - 3.5, cy - 3.5, 7, 7);
            ctx.strokeStyle = "#be1e3c";
            ctx.strokeRect(cx - 3.5, cy - 3.5, 7, 7);
          }

          ctx.strokeStyle = "rgba(255,255,255,0.8)";
          ctx.beginPath();
          ctx.moveTo(box.center[0] - 6, box.center[1]); ctx.lineTo(box.center[0] + 6, box.center[1]);
          ctx.moveTo(box.center[0], box.center[1] - 6); ctx.lineTo(box.center[0], box.center[1] + 6);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // 3b. Selected Scene Graph Transform Group Gizmo (Amber/Gold)
    const selNode = st.getSelectedNode();
    if (selNode && st.mode !== "animate" && st.mode !== "expressions") {
      const nbox = this._nodeBoxScreen(selNode);
      if (nbox) {
        ctx.save();
        // Dashed parent -> direct child connector lines
        const { byId, childrenOf } = buildSceneGraph(P);
        const kids = childrenOf.get(selNode.id) || [];
        const nwMap = this.engine.lastFrame?.key?._nodeWorld;
        ctx.strokeStyle = "rgba(245, 166, 35, 0.45)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        for (const cid of kids) {
          const it = byId.get(cid);
          const cw = nwMap && nwMap[cid];
          if (!it || !cw || !cw.worldPivot) continue;
          const cp = it.kind === "layer"
            ? this.canonToScreen(...this.engine.layerToScreenCanon(it.idx, cw.worldPivot))
            : this.canonToScreen(...this.engine.nodeToScreenCanon(cid, cw.worldPivot));
          ctx.beginPath();
          ctx.moveTo(nbox.pivot[0], nbox.pivot[1]);
          ctx.lineTo(cp[0], cp[1]);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cp[0], cp[1], 3, 0, Math.PI * 2);
          ctx.fillStyle = "#f5a623";
          ctx.fill();
        }
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = st.rigTarget.type === "blend" ? "rgba(176, 118, 255, 0.92)" : "rgba(245, 166, 35, 0.92)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(nbox.corners[0][0], nbox.corners[0][1]);
        for (let i = 1; i < 4; i++) ctx.lineTo(nbox.corners[i][0], nbox.corners[i][1]);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);

        // Rotation handle
        ctx.beginPath();
        ctx.moveTo(nbox.topMid[0], nbox.topMid[1]);
        ctx.lineTo(nbox.rotHandle[0], nbox.rotHandle[1]);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(nbox.rotHandle[0], nbox.rotHandle[1], 4.5, 0, Math.PI * 2);
        ctx.fillStyle = "#f5a623";
        ctx.fill();
        ctx.strokeStyle = "#f2f3f5";
        ctx.stroke();

        // Corner scale handles
        for (const [cx, cy] of nbox.corners) {
          ctx.fillStyle = "#f2f3f5";
          ctx.fillRect(cx - 3.5, cy - 3.5, 7, 7);
          ctx.strokeStyle = "#f5a623";
          ctx.strokeRect(cx - 3.5, cy - 3.5, 7, 7);
        }

        // Amber diamond pivot marker + label
        const [px, py] = nbox.pivot;
        ctx.fillStyle = "#f5a623";
        ctx.strokeStyle = "#0c0d10";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(px, py - 6.5);
        ctx.lineTo(px + 6.5, py);
        ctx.lineTo(px, py + 6.5);
        ctx.lineTo(px - 6.5, py);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.font = '10.5px "JetBrains Mono", monospace';
        ctx.strokeStyle = "rgba(12, 13, 16, 0.88)";
        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        ctx.strokeText(`◆ ${selNode.name || selNode.id}`, px + 10, py + 3.5);
        ctx.fillStyle = "#ffd88a";
        ctx.fillText(`◆ ${selNode.name || selNode.id}`, px + 10, py + 3.5);
        ctx.restore();
      }
    }

    // 4. Marquee Box-Select Rectangle
    if (this.drag && this.drag.type === "marquee") {
      const x = Math.min(this.drag.startX, this.drag.curX);
      const y = Math.min(this.drag.startY, this.drag.curY);
      const w = Math.abs(this.drag.curX - this.drag.startX);
      const h = Math.abs(this.drag.curY - this.drag.startY);
      ctx.save();
      ctx.fillStyle = "rgba(92, 225, 230, 0.12)";
      ctx.strokeStyle = "rgba(92, 225, 230, 0.85)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }

    // 5. Rig Pivot Handles
    if (st.view.showPivots || st.tool === "pivot") {
      const pivots = this._getPivots();
      ctx.save();
      for (const pv of pivots) {
        const [px, py] = this.canonToScreen(pv.x, pv.y);
        if (pv.isGroup) {
          ctx.fillStyle = "#f5a623";
          ctx.strokeStyle = "#0c0d10";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(px, py - 5.5);
          ctx.lineTo(px + 5.5, py);
          ctx.lineTo(px, py + 5.5);
          ctx.lineTo(px - 5.5, py);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.font = '10.5px "JetBrains Mono", monospace';
          ctx.fillStyle = "rgba(255, 216, 138, 0.9)";
          ctx.fillText(pv.label, px + 8, py + 3);
          continue;
        }
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

    // 6. Crisp Warp Brush Ring Cursor
    if (st.tool === "warp_brush" && this.pointer.inside && !this.spaceHeld) {
      const r = st.brush.radius;
      const px = this.pointer.x, py = this.pointer.y;
      const strokeCol = st.brush.mode === "restore" ? "rgba(62, 224, 143, 0.9)"
        : st.brush.mode === "smooth" ? "rgba(116, 185, 255, 0.9)"
        : st.rigTarget.type === "blend" ? "rgba(176, 118, 255, 0.92)"
        : st.rigTarget.type === "pitch" ? "rgba(88, 178, 255, 0.92)"
        : "rgba(190, 30, 60, 0.92)";
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
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
