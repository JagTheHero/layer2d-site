/**
 * Layer2D Forward Mesh (`F[gd*gd*2]`) & Legacy Inverse Warp-Grid (`D[gd*gd*2]`),
 * Affine Transform, Multi-Vertex Lattice Sculpting, Liquify Brush, Anti-Fold Clamping,
 * Blend-Shape / Angle-Y Delta Composition, and Keyform Mirroring / Interpolation Math.
 * Matches shaders.js & viewer/index.html WebGL2 fragment shader equations 1:1.
 */

export function inv2(A) {
  const d = A[0] * A[3] - A[1] * A[2];
  if (Math.abs(d) < 1e-9) return [1, 0, 0, 1];
  return [A[3] / d, -A[1] / d, -A[2] / d, A[0] / d];
}

export function mul2v(A, x, y) {
  return [A[0] * x + A[1] * y, A[2] * x + A[3] * y];
}

export function mul2m(A, B) {
  return [
    A[0] * B[0] + A[1] * B[2],
    A[0] * B[1] + A[1] * B[3],
    A[2] * B[0] + A[3] * B[2],
    A[2] * B[1] + A[3] * B[3],
  ];
}

export function decomposeAffine(A) {
  const sx = Math.hypot(A[0], A[2]) || 1;
  const det = A[0] * A[3] - A[1] * A[2];
  const sy = (Math.hypot(A[1], A[3]) || 1) * (det < 0 ? -1 : 1);
  const rotRad = Math.atan2(A[2], A[0]);
  return { sx, sy, rotDeg: (rotRad * 180) / Math.PI };
}

export function composeAffine(sx, sy, rotDeg) {
  const r = (rotDeg * Math.PI) / 180;
  const co = Math.cos(r), si = Math.sin(r);
  return [+(co * sx).toFixed(5), +(-si * sy).toFixed(5), +(si * sx).toFixed(5), +(co * sy).toFixed(5)];
}

export function gridSizeOf(G) {
  if (!G || !G.length) return 0;
  return Math.round(Math.sqrt(G.length / 2));
}

export function sampleGrid(G, gd, gx, gy) {
  if (!G || gd < 2) return [0, 0];
  const n = gd - 1;
  const fx = Math.max(0, Math.min(n, (gx + 1) * 0.5 * n));
  const fy = Math.max(0, Math.min(n, (gy + 1) * 0.5 * n));
  const x0 = Math.min(gd - 2, Math.floor(fx));
  const y0 = Math.min(gd - 2, Math.floor(fy));
  const x1 = x0 + 1, y1 = y0 + 1;
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const i00 = (y0 * gd + x0) * 2;
  const i10 = (y0 * gd + x1) * 2;
  const i01 = (y1 * gd + x0) * 2;
  const i11 = (y1 * gd + x1) * 2;
  const ax = G[i00] + (G[i10] - G[i00]) * tx;
  const ay = G[i00 + 1] + (G[i10 + 1] - G[i00 + 1]) * tx;
  const bx = G[i01] + (G[i11] - G[i01]) * tx;
  const by = G[i01 + 1] + (G[i11 + 1] - G[i01 + 1]) * tx;
  return [ax + (bx - ax) * ty, ay + (by - ay) * ty];
}

// Legacy alias kept for callers expecting sampleD
export const sampleD = sampleGrid;

export function resampleGrid(oldG, oldGd, newGd) {
  const out = new Array(newGd * newGd * 2).fill(0);
  if (!oldG || oldGd < 2) return out;
  for (let iy = 0; iy < newGd; iy++) {
    const gy = -1 + (2 * iy) / (newGd - 1);
    for (let ix = 0; ix < newGd; ix++) {
      const gx = -1 + (2 * ix) / (newGd - 1);
      const [dx, dy] = sampleGrid(oldG, oldGd, gx, gy);
      const idx = (iy * newGd + ix) * 2;
      out[idx] = +dx.toFixed(5);
      out[idx + 1] = +dy.toFixed(5);
    }
  }
  return out;
}

export function ensureForwardGrid(targetObj, gd = 5) {
  const curGd = gridSizeOf(targetObj.F);
  if (curGd === gd) return targetObj.F;
  if (!curGd) {
    targetObj.F = new Array(gd * gd * 2).fill(0);
    return targetObj.F;
  }
  targetObj.F = resampleGrid(targetObj.F, curGd, gd);
  return targetObj.F;
}

export function ensureGrid(targetObj, gd = 5) {
  return ensureForwardGrid(targetObj, gd);
}

/**
 * Smoothly interpolate two warp/mesh grids even if one is missing/null or resolutions differ.
 * Eliminates the hard-pop / Player TypeError crash when only some keyforms have warp grids.
 */
export function lerpGrids(gA, gB, f) {
  const gdA = gridSizeOf(gA), gdB = gridSizeOf(gB);
  if (!gdA && !gdB) return null;
  if (f <= 1e-6) return gdA ? gA.slice() : null;
  if (f >= 1 - 1e-6) return gdB ? gB.slice() : null;
  const gd = Math.max(gdA, gdB);
  const a = gdA === gd ? gA : (gdA ? resampleGrid(gA, gdA, gd) : null);
  const b = gdB === gd ? gB : (gdB ? resampleGrid(gB, gdB, gd) : null);
  const len = gd * gd * 2;
  const out = new Array(len);
  const omf = 1 - f;
  for (let i = 0; i < len; i++) {
    out[i] = (a ? a[i] * omf : 0) + (b ? b[i] * f : 0);
  }
  return out;
}

/**
 * Accumulate `weight * addG` onto `accum` (forward mesh delta composition for Angle Y & Blend Shapes).
 */
export function addScaledGrid(accum, addG, weight = 1) {
  if (!addG || !addG.length || Math.abs(weight) < 1e-6) return accum;
  const gdAdd = gridSizeOf(addG);
  if (gdAdd < 2) return accum;
  const gdAcc = gridSizeOf(accum);
  if (!gdAcc) {
    const out = new Array(addG.length);
    for (let i = 0; i < addG.length; i++) out[i] = addG[i] * weight;
    return out;
  }
  const gd = Math.max(gdAcc, gdAdd);
  const base = gdAcc === gd ? accum.slice() : resampleGrid(accum, gdAcc, gd);
  const rhs = gdAdd === gd ? addG : resampleGrid(addG, gdAdd, gd);
  for (let i = 0; i < base.length; i++) base[i] += rhs[i] * weight;
  return base;
}

export function isGridNonZero(G) {
  if (!G || !G.length) return false;
  for (let i = 0; i < G.length; i++) if (Math.abs(G[i]) > 1e-5) return true;
  return false;
}

/**
 * Exact JS mirror of GLSL `invertForwardGrid`: solves `t + F(t) = g` via damped 2D Newton-Raphson.
 * Used by alpha-accurate layer picking (`pickLayerAt`) on deformed meshes.
 */
export function invertForwardGridJS(gx, gy, F, gd) {
  if (!F || gd < 2) return [gx, gy];
  const n = gd - 1;
  const s = 0.5 * n;

  const evalWithJac = (tx, ty) => {
    const ux = Math.max(0, Math.min(n, (tx + 1) * s));
    const uy = Math.max(0, Math.min(n, (ty + 1) * s));
    const x0 = Math.min(gd - 2, Math.floor(ux));
    const y0 = Math.min(gd - 2, Math.floor(uy));
    const x1 = x0 + 1, y1 = y0 + 1;
    const fx = Math.max(0, Math.min(1, ux - x0));
    const fy = Math.max(0, Math.min(1, uy - y0));
    const i00 = (y0 * gd + x0) * 2, i10 = (y0 * gd + x1) * 2;
    const i01 = (y1 * gd + x0) * 2, i11 = (y1 * gd + x1) * 2;
    const f00x = F[i00], f00y = F[i00 + 1];
    const f10x = F[i10], f10y = F[i10 + 1];
    const f01x = F[i01], f01y = F[i01 + 1];
    const f11x = F[i11], f11y = F[i11 + 1];
    const fx0x = f00x + (f10x - f00x) * fx, fx0y = f00y + (f10y - f00y) * fx;
    const fx1x = f01x + (f11x - f01x) * fx, fx1y = f01y + (f11y - f01y) * fx;
    const valx = fx0x + (fx1x - fx0x) * fy;
    const valy = fx0y + (fx1y - fx0y) * fy;
    let dFdxX = ((f10x - f00x) + ((f11x - f01x) - (f10x - f00x)) * fy) * s;
    let dFdxY = ((f10y - f00y) + ((f11y - f01y) - (f10y - f00y)) * fy) * s;
    let dFdyX = ((f01x - f00x) + ((f11x - f10x) - (f01x - f00x)) * fx) * s;
    let dFdyY = ((f01y - f00y) + ((f11y - f10y) - (f01y - f00y)) * fx) * s;
    if (Math.abs(tx) > 1.0) { dFdxX = 0; dFdxY = 0; }
    if (Math.abs(ty) > 1.0) { dFdyX = 0; dFdyY = 0; }
    return { valx, valy, j00: 1 + dFdxX, j01: dFdxY, j10: dFdyX, j11: 1 + dFdyY };
  };

  const init = evalWithJac(gx, gy);
  let tx = gx - init.valx, ty = gy - init.valy;
  for (let it = 0; it < 7; it++) {
    const r = evalWithJac(tx, ty);
    const ex = tx + r.valx - gx;
    const ey = ty + r.valy - gy;
    if (ex * ex + ey * ey < 1e-10) break;
    const det = r.j00 * r.j11 - r.j10 * r.j01;
    let sx, sy;
    if (Math.abs(det) > 0.05) {
      sx = (r.j11 * ex - r.j10 * ey) / det;
      sy = (-r.j01 * ex + r.j00 * ey) / det;
    } else {
      sx = 0.35 * ex;
      sy = 0.35 * ey;
    }
    const sl = Math.hypot(sx, sy);
    if (sl > 0.45) { sx *= 0.45 / sl; sy *= 0.45 / sl; }
    tx -= sx;
    ty -= sy;
  }
  return [tx, ty];
}

/**
 * Apply an additive per-layer delta `{ dt, dRot, dScale, dOp, F }` (from Angle Y keyforms or Blend Shapes)
 * scaled by `weight` onto a cloned layer pose `{ A, t, op, F, ... }`.
 */
export function applyLayerDelta(base, delta, weight = 1) {
  if (!delta || Math.abs(weight) < 1e-6) return base;
  const out = {
    ...base,
    A: base.A ? base.A.slice() : [1, 0, 0, 1],
    t: base.t ? [base.t[0], base.t[1]] : [0, 0],
    op: base.op ?? 1,
  };
  if (delta.dt) {
    out.t[0] += (delta.dt[0] || 0) * weight;
    out.t[1] += (delta.dt[1] || 0) * weight;
  }
  const dRot = (delta.dRot || 0) * weight;
  const dSx = 1 + ((delta.dScale && delta.dScale[0]) || 0) * weight;
  const dSy = 1 + ((delta.dScale && delta.dScale[1]) || 0) * weight;
  if (Math.abs(dRot) > 1e-5 || Math.abs(dSx - 1) > 1e-5 || Math.abs(dSy - 1) > 1e-5) {
    const M = composeAffine(Math.max(0.05, dSx), Math.max(0.05, dSy), dRot);
    out.A = mul2m(M, out.A);
  }
  if (delta.dOp) {
    out.op = Math.max(0, Math.min(1, out.op + delta.dOp * weight));
  }
  if (delta.F && delta.F.length) {
    out.F = addScaledGrid(out.F, delta.F, weight);
  }
  return out;
}

/**
 * Compute minimum signed area ratio across all quads adjacent to vertex (ix, iy) (or entire grid if ix < 0).
 * Ratio of 1.0 = rest square, <= 0.0 = folded/inverted triangle (mesh tearing!).
 */
export function quadMinAreaRatio(F, gd, filterIx = -1, filterIy = -1) {
  if (!F || gd < 2) return 1;
  const step = 2 / (gd - 1);
  const restArea = step * step;
  const pos = (x, y) => {
    const idx = (y * gd + x) * 2;
    return [-1 + x * step + F[idx], -1 + y * step + F[idx + 1]];
  };
  const xStart = filterIx >= 0 ? Math.max(0, filterIx - 1) : 0;
  const xEnd = filterIx >= 0 ? Math.min(gd - 2, filterIx) : gd - 2;
  const yStart = filterIy >= 0 ? Math.max(0, filterIy - 1) : 0;
  const yEnd = filterIy >= 0 ? Math.min(gd - 2, filterIy) : gd - 2;
  let minR = Infinity;
  for (let iy = yStart; iy <= yEnd; iy++) {
    for (let ix = xStart; ix <= xEnd; ix++) {
      const p00 = pos(ix, iy), p10 = pos(ix + 1, iy);
      const p01 = pos(ix, iy + 1), p11 = pos(ix + 1, iy + 1);
      // Check all 4 triangle splits of the quad so concave folds are caught too!
      const c1 = (p10[0] - p00[0]) * (p01[1] - p00[1]) - (p10[1] - p00[1]) * (p01[0] - p00[0]);
      const c2 = (p11[0] - p10[0]) * (p00[1] - p10[1]) - (p11[1] - p10[1]) * (p00[0] - p10[0]);
      const c3 = (p01[0] - p11[0]) * (p10[1] - p11[1]) - (p01[1] - p11[1]) * (p10[0] - p11[0]);
      const c4 = (p00[0] - p01[0]) * (p11[1] - p01[1]) - (p00[1] - p01[1]) * (p11[0] - p01[0]);
      const m = Math.min(c1, c2, c3, c4) / restArea;
      if (m < minR) minR = m;
    }
  }
  return minR === Infinity ? 1 : minR;
}

/**
 * Compute per-quad minimum area ratio array (length (gd-1)*(gd-1)) for Studio fold-warning overlay.
 */
export function quadHealthMap(F, gd) {
  const out = new Float32Array((gd - 1) * (gd - 1));
  if (!F || gd < 2) { out.fill(1); return out; }
  const step = 2 / (gd - 1);
  const restArea = step * step;
  const pos = (x, y) => {
    const idx = (y * gd + x) * 2;
    return [-1 + x * step + F[idx], -1 + y * step + F[idx + 1]];
  };
  for (let iy = 0; iy < gd - 1; iy++) {
    for (let ix = 0; ix < gd - 1; ix++) {
      const p00 = pos(ix, iy), p10 = pos(ix + 1, iy);
      const p01 = pos(ix, iy + 1), p11 = pos(ix + 1, iy + 1);
      const c1 = (p10[0] - p00[0]) * (p01[1] - p00[1]) - (p10[1] - p00[1]) * (p01[0] - p00[0]);
      const c2 = (p11[0] - p10[0]) * (p00[1] - p10[1]) - (p11[1] - p10[1]) * (p00[0] - p10[0]);
      const c3 = (p01[0] - p11[0]) * (p10[1] - p11[1]) - (p01[1] - p11[1]) * (p10[0] - p11[0]);
      const c4 = (p00[0] - p01[0]) * (p11[1] - p01[1]) - (p00[1] - p01[1]) * (p11[0] - p01[0]);
      out[iy * (gd - 1) + ix] = Math.min(c1, c2, c3, c4) / restArea;
    }
  }
  return out;
}

/**
 * Apply a candidate displacement (nextFx, nextFy) to vertex (ix, iy) while preventing quad fold-over
 * (self-intersecting / inverted mesh tearing). Uses binary backoff if the full step would fold a quad.
 */
function applyVertexSafe(F, gd, ix, iy, nextFx, nextFy, minRatio = 0.08) {
  const idx = (iy * gd + ix) * 2;
  const oldFx = F[idx], oldFy = F[idx + 1];
  F[idx] = nextFx;
  F[idx + 1] = nextFy;
  const curMin = quadMinAreaRatio(F, gd, ix, iy);
  if (curMin >= minRatio) {
    F[idx] = +nextFx.toFixed(5);
    F[idx + 1] = +nextFy.toFixed(5);
    return;
  }
  // Check if moving closer to rest improves an already-bad quad
  F[idx] = oldFx;
  F[idx + 1] = oldFy;
  const prevMin = quadMinAreaRatio(F, gd, ix, iy);
  if (curMin >= prevMin) {
    F[idx] = +nextFx.toFixed(5);
    F[idx + 1] = +nextFy.toFixed(5);
    return;
  }
  // Binary search largest safe fraction in [0, 1]
  let lo = 0, hi = 1;
  for (let it = 0; it < 7; it++) {
    const mid = 0.5 * (lo + hi);
    F[idx] = oldFx + (nextFx - oldFx) * mid;
    F[idx + 1] = oldFy + (nextFy - oldFy) * mid;
    if (quadMinAreaRatio(F, gd, ix, iy) >= Math.min(minRatio, prevMin)) lo = mid;
    else hi = mid;
  }
  F[idx] = +(oldFx + (nextFx - oldFx) * lo).toFixed(5);
  F[idx + 1] = +(oldFy + (nextFy - oldFy) * lo).toFixed(5);
}

/**
 * Compute exact visual canvas positions [x, y] and rest positions [rx, ry] of every lattice vertex (ix, iy).
 * Forward mesh `F`: visual position is simply `g_vis = g0 + F[iy, ix]` — 100% exact, zero iteration drift!
 */
export function latticeCanvasPoints(layer, liveSampleLayer, displayGd = 5, toScreenFn = null) {
  const F = liveSampleLayer && liveSampleLayer.F && liveSampleLayer.F.length ? liveSampleLayer.F : null;
  const gd = F ? gridSizeOf(F) : displayGd;
  const A = (liveSampleLayer && liveSampleLayer.A) || [1, 0, 0, 1];
  const t = (liveSampleLayer && liveSampleLayer.t) || [0, 0];
  const w2 = layer.w * 0.5, h2 = layer.h * 0.5;
  const pts = [];

  for (let iy = 0; iy < gd; iy++) {
    const g0y = -1 + (2 * iy) / (gd - 1);
    for (let ix = 0; ix < gd; ix++) {
      const g0x = -1 + (2 * ix) / (gd - 1);
      const idx = (iy * gd + ix) * 2;
      const fx = F ? F[idx] : 0;
      const fy = F ? F[idx + 1] : 0;
      const gx = g0x + fx;
      const gy = g0y + fy;

      const rlx = g0x * w2, rly = g0y * h2;
      const rcx = A[0] * rlx + A[1] * rly + t[0];
      const rcy = A[2] * rlx + A[3] * rly + t[1];
      const rsp = toScreenFn ? toScreenFn([rcx, rcy]) : [rcx, rcy];

      const lx = gx * w2, ly = gy * h2;
      const cx = A[0] * lx + A[1] * ly + t[0];
      const cy = A[2] * lx + A[3] * ly + t[1];
      const sp = toScreenFn ? toScreenFn([cx, cy]) : [cx, cy];

      pts.push({
        ix, iy,
        vIdx: iy * gd + ix,
        g0x, g0y, gx, gy,
        fx, fy,
        rx: rsp[0], ry: rsp[1],
        lx: cx, ly: cy,
        x: sp[0], y: sp[1],
      });
    }
  }
  const health = F ? quadHealthMap(F, gd) : null;
  return { gd, pts, health };
}

/**
 * Drag one or more lattice/mesh vertices by exact 1:1 layer-space delta (dxLayer, dyLayer).
 * Supports multi-selection, optional soft-selection falloff, pinBorder, and anti-fold clamping.
 * `editTargetObj` is the editable object holding `.F` (sample layer, pitch delta, or blend shape delta);
 * `liveSampleLayer` provides the live affine `A` (and live `F` for soft-selection distance).
 */
export function dragLatticePoints(
  layer,
  editTargetObj,
  liveSampleLayer,
  selectedVertIndices,
  dxLayer,
  dyLayer,
  opts = {},
) {
  const defaultGd = opts.defaultGd || 5;
  const pinBorder = Boolean(opts.pinBorder);
  const softSelect = Boolean(opts.softSelect);
  const softRadiusCanon = opts.softRadiusCanon || 160;
  const toScreenFn = opts.toScreenFn || null;
  const weightScale = opts.weightScale ?? 1.0;

  const gd = gridSizeOf(editTargetObj.F) || gridSizeOf(liveSampleLayer?.F) || defaultGd;
  const F = ensureForwardGrid(editTargetObj, gd);
  const Ai = inv2((liveSampleLayer && liveSampleLayer.A) || [1, 0, 0, 1]);
  const [dlx, dly] = mul2v(Ai, dxLayer, dyLayer);
  const dgx = (dlx / (layer.w * 0.5)) / Math.max(0.05, weightScale);
  const dgy = (dly / (layer.h * 0.5)) / Math.max(0.05, weightScale);

  const selSet = new Set(selectedVertIndices);
  if (!selSet.size) return false;

  const isBorder = (ix, iy) => ix === 0 || iy === 0 || ix === gd - 1 || iy === gd - 1;

  if (!softSelect) {
    // Move all selected vertices 1:1 (exact forward displacement!)
    // First apply directly; if multi-vertex move is collectively valid (e.g. moving a whole region),
    // check anti-fold after applying the group so moving adjacent vertices together doesn't false-clamp!
    const backup = F.slice();
    for (const vIdx of selSet) {
      const ix = vIdx % gd, iy = Math.floor(vIdx / gd);
      if (ix < 0 || iy < 0 || ix >= gd || iy >= gd) continue;
      if (pinBorder && isBorder(ix, iy)) continue;
      const i = vIdx * 2;
      F[i] = +(F[i] + dgx).toFixed(5);
      F[i + 1] = +(F[i + 1] + dgy).toFixed(5);
    }
    // Check if the collective move introduced any fold-over; if so, smoothly back off the group step
    if (quadMinAreaRatio(F, gd) < 0.08 && quadMinAreaRatio(F, gd) < quadMinAreaRatio(backup, gd)) {
      let lo = 0, hi = 1;
      const minAllowed = Math.min(0.08, quadMinAreaRatio(backup, gd));
      for (let it = 0; it < 7; it++) {
        const mid = 0.5 * (lo + hi);
        for (const vIdx of selSet) {
          const ix = vIdx % gd, iy = Math.floor(vIdx / gd);
          if (pinBorder && isBorder(ix, iy)) continue;
          const i = vIdx * 2;
          F[i] = backup[i] + dgx * mid;
          F[i + 1] = backup[i + 1] + dgy * mid;
        }
        if (quadMinAreaRatio(F, gd) >= minAllowed) lo = mid;
        else hi = mid;
      }
      for (const vIdx of selSet) {
        const ix = vIdx % gd, iy = Math.floor(vIdx / gd);
        if (pinBorder && isBorder(ix, iy)) continue;
        const i = vIdx * 2;
        F[i] = +(backup[i] + dgx * lo).toFixed(5);
        F[i + 1] = +(backup[i + 1] + dgy * lo).toFixed(5);
      }
    }
    return true;
  }

  // Soft-selection proportional falloff from nearest selected vertex in live visual space
  const { pts } = latticeCanvasPoints(layer, liveSampleLayer || editTargetObj, gd, toScreenFn);
  const selPts = pts.filter((p) => selSet.has(p.vIdx));
  if (!selPts.length) return false;
  const backup = F.slice();
  const weights = new Float32Array(pts.length);
  for (const pt of pts) {
    if (pinBorder && isBorder(pt.ix, pt.iy)) continue;
    if (selSet.has(pt.vIdx)) {
      weights[pt.vIdx] = 1.0;
    } else {
      let minD = Infinity;
      for (const sp of selPts) {
        const d = Math.hypot(pt.x - sp.x, pt.y - sp.y);
        if (d < minD) minD = d;
      }
      if (minD < softRadiusCanon) {
        const u = 1 - minD / softRadiusCanon;
        weights[pt.vIdx] = u * u * (3 - 2 * u);
      }
    }
  }
  for (let vIdx = 0; vIdx < pts.length; vIdx++) {
    const w = weights[vIdx];
    if (w <= 0) continue;
    const i = vIdx * 2;
    F[i] = +(backup[i] + dgx * w).toFixed(5);
    F[i + 1] = +(backup[i + 1] + dgy * w).toFixed(5);
  }
  if (quadMinAreaRatio(F, gd) < 0.08 && quadMinAreaRatio(F, gd) < quadMinAreaRatio(backup, gd)) {
    const minAllowed = Math.min(0.08, quadMinAreaRatio(backup, gd));
    let lo = 0, hi = 1;
    for (let it = 0; it < 7; it++) {
      const mid = 0.5 * (lo + hi);
      for (let vIdx = 0; vIdx < pts.length; vIdx++) {
        const w = weights[vIdx];
        if (w <= 0) continue;
        const i = vIdx * 2;
        F[i] = backup[i] + dgx * w * mid;
        F[i + 1] = backup[i + 1] + dgy * w * mid;
      }
      if (quadMinAreaRatio(F, gd) >= minAllowed) lo = mid;
      else hi = mid;
    }
    for (let vIdx = 0; vIdx < pts.length; vIdx++) {
      const w = weights[vIdx];
      if (w <= 0) continue;
      const i = vIdx * 2;
      F[i] = +(backup[i] + dgx * w * lo).toFixed(5);
      F[i + 1] = +(backup[i + 1] + dgy * w * lo).toFixed(5);
    }
  }
  return true;
}

// Legacy single-point convenience wrapper
export function dragLatticePoint(layer, sampleLayer, ix, iy, dxLayer, dyLayer, defaultGd = 5) {
  const gd = gridSizeOf(sampleLayer.F) || defaultGd;
  return dragLatticePoints(layer, sampleLayer, sampleLayer, [iy * gd + ix], dxLayer, dyLayer, { defaultGd });
}

/**
 * Forward-Space Sculpting / Liquify Warp Brush directly modifying `F[gd*gd*2]`.
 * Zero wrong-cell drift: visual vertex positions match the forward mesh 1:1, with anti-fold clamping!
 * mode: "push" | "smooth" | "restore"
 */
export function applyWarpBrush(
  layer,
  editTargetObj,
  pPrev,
  pCurr,
  radiusCanon,
  strength = 0.65,
  mode = "push",
  defaultGd = 7,
  toScreenFn = null,
  toLayerFn = null,
  opts = {},
) {
  const liveSL = opts.liveSampleLayer || editTargetObj;
  const pinBorder = Boolean(opts.pinBorder);
  const weightScale = opts.weightScale ?? 1.0;

  const gd = gridSizeOf(editTargetObj.F) || gridSizeOf(liveSL?.F) || defaultGd;
  const F = ensureForwardGrid(editTargetObj, gd);
  const { pts } = latticeCanvasPoints(layer, liveSL, gd, toScreenFn);
  const Ai = inv2((liveSL && liveSL.A) || [1, 0, 0, 1]);
  const lpPrev = toLayerFn ? toLayerFn(pPrev) : pPrev;
  const lpCurr = toLayerFn ? toLayerFn(pCurr) : pCurr;
  const dxC = lpCurr[0] - lpPrev[0], dyC = lpCurr[1] - lpPrev[1];
  const [dlx, dly] = mul2v(Ai, dxC, dyC);
  const dgx = (dlx / (layer.w * 0.5)) / Math.max(0.05, weightScale);
  const dgy = (dly / (layer.h * 0.5)) / Math.max(0.05, weightScale);

  const prevCopy = F.slice();
  let touched = false;
  const isBorder = (ix, iy) => ix === 0 || iy === 0 || ix === gd - 1 || iy === gd - 1;

  for (const pt of pts) {
    if (pinBorder && isBorder(pt.ix, pt.iy)) continue;
    const dist = Math.hypot(pt.x - pCurr[0], pt.y - pCurr[1]);
    if (dist >= radiusCanon) continue;
    const u = 1 - dist / radiusCanon;
    const w = u * u * (3 - 2 * u) * strength;
    const idx = (pt.iy * gd + pt.ix) * 2;
    touched = true;

    if (mode === "push") {
      applyVertexSafe(F, gd, pt.ix, pt.iy, F[idx] + dgx * w, F[idx + 1] + dgy * w, 0.08);
    } else if (mode === "restore") {
      const k = Math.min(1, w * 0.35);
      F[idx] = +(F[idx] * (1 - k)).toFixed(5);
      F[idx + 1] = +(F[idx + 1] * (1 - k)).toFixed(5);
    } else if (mode === "smooth") {
      let sx = 0, sy = 0, cnt = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = pt.ix + ox, ny = pt.iy + oy;
          if (nx < 0 || ny < 0 || nx >= gd || ny >= gd) continue;
          const ni = (ny * gd + nx) * 2;
          sx += prevCopy[ni]; sy += prevCopy[ni + 1]; cnt++;
        }
      }
      const k = Math.min(1, w * 0.45);
      F[idx] = +(prevCopy[idx] * (1 - k) + (sx / cnt) * k).toFixed(5);
      F[idx + 1] = +(prevCopy[idx + 1] * (1 - k) + (sy / cnt) * k).toFixed(5);
    }
  }
  return touched;
}

export function smoothGrid(targetObj, factor = 0.35) {
  const key = targetObj.F && targetObj.F.length ? "F" : (targetObj.D && targetObj.D.length ? "D" : null);
  if (!key) return;
  const G = targetObj[key];
  const gd = gridSizeOf(G);
  if (gd < 3) return;
  const src = G.slice();
  for (let iy = 0; iy < gd; iy++) {
    for (let ix = 0; ix < gd; ix++) {
      let sx = 0, sy = 0, c = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = ix + ox, ny = iy + oy;
          if (nx < 0 || ny < 0 || nx >= gd || ny >= gd) continue;
          const ni = (ny * gd + nx) * 2;
          sx += src[ni]; sy += src[ni + 1]; c++;
        }
      }
      const i = (iy * gd + ix) * 2;
      G[i] = +(src[i] * (1 - factor) + (sx / c) * factor).toFixed(5);
      G[i + 1] = +(src[i + 1] * (1 - factor) + (sy / c) * factor).toFixed(5);
    }
  }
}

export function mirrorGridX(G) {
  if (!G || !G.length) return null;
  const gd = gridSizeOf(G);
  const out = new Array(G.length);
  for (let iy = 0; iy < gd; iy++) {
    for (let ix = 0; ix < gd; ix++) {
      const si = (iy * gd + (gd - 1 - ix)) * 2;
      const di = (iy * gd + ix) * 2;
      out[di] = -G[si];
      out[di + 1] = G[si + 1];
    }
  }
  return out;
}

export function mirrorGridY(G) {
  if (!G || !G.length) return null;
  const gd = gridSizeOf(G);
  const out = new Array(G.length);
  for (let iy = 0; iy < gd; iy++) {
    for (let ix = 0; ix < gd; ix++) {
      const si = ((gd - 1 - iy) * gd + ix) * 2;
      const di = (iy * gd + ix) * 2;
      out[di] = G[si];
      out[di + 1] = -G[si + 1];
    }
  }
  return out;
}

/**
 * Mirror a layer's yaw keyform across head center X from srcSampleIdx -> dstSampleIdx.
 */
export function mirrorLayerKeyform(pack, layerIdx, srcSampleIdx, dstSampleIdx) {
  const src = pack.samples[srcSampleIdx]?.layers[layerIdx];
  const dst = pack.samples[dstSampleIdx]?.layers[layerIdx];
  if (!src || !dst) return;
  const cx = (pack.head?.centre?.[0]) ?? (pack.canvas[0] * 0.5);
  const A = src.A || [1, 0, 0, 1];
  dst.A = [A[0], -A[1], -A[2], A[3]];
  dst.t = [+(2 * cx - src.t[0]).toFixed(2), src.t[1]];
  dst.op = src.op;
  if (src.turn !== undefined) dst.turn = -src.turn;
  if (src.behind !== undefined) dst.behind = src.behind;
  if (src.D && src.D.length) dst.D = mirrorGridX(src.D);
  else delete dst.D;
  if (src.F && src.F.length) dst.F = mirrorGridX(src.F);
  else delete dst.F;
}

/**
 * Interpolate a layer's yaw keyform between two surrounding keyform samples (handles both D and F cleanly!).
 */
export function interpolateLayerKeyform(pack, layerIdx, targetIdx, leftIdx, rightIdx) {
  const sL = pack.samples[leftIdx], sR = pack.samples[rightIdx], sT = pack.samples[targetIdx];
  if (!sL || !sR || !sT || leftIdx === rightIdx) return;
  const f = (sT.angle - sL.angle) / ((sR.angle - sL.angle) || 1);
  const a = sL.layers[layerIdx], b = sR.layers[layerIdx], dst = sT.layers[layerIdx];
  dst.A = a.A.map((v, k) => +(v + (b.A[k] - v) * f).toFixed(5));
  dst.t = [+(a.t[0] + (b.t[0] - a.t[0]) * f).toFixed(2), +(a.t[1] + (b.t[1] - a.t[1]) * f).toFixed(2)];
  dst.op = +(a.op + (b.op - a.op) * f).toFixed(3);
  if (a.turn !== undefined || b.turn !== undefined) {
    dst.turn = +((a.turn || 0) + ((b.turn || 0) - (a.turn || 0)) * f).toFixed(4);
  }
  const dInterp = lerpGrids(a.D, b.D, f);
  if (dInterp) dst.D = dInterp.map((v) => +v.toFixed(5));
  else delete dst.D;
  const fInterp = lerpGrids(a.F, b.F, f);
  if (fInterp) dst.F = fInterp.map((v) => +v.toFixed(5));
  else delete dst.F;
}
