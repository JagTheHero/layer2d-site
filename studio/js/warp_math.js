/**
 * Layer2D Warp-Grid (inverse displacement D[gd*gd*2]), Affine Transform,
 * Lattice Sculpting, Liquify Brush, and Keyform Mirroring / Interpolation Math.
 * Matches viewer/index.html WebGL2 fragment shader equations 1:1.
 */

export function inv2(A) {
  const d = A[0] * A[3] - A[1] * A[2];
  if (Math.abs(d) < 1e-9) return [1, 0, 0, 1];
  return [A[3] / d, -A[1] / d, -A[2] / d, A[0] / d];
}

export function mul2v(A, x, y) {
  return [A[0] * x + A[1] * y, A[2] * x + A[3] * y];
}

export function decomposeAffine(A) {
  // Decompose 2x2 matrix A = [a0, a1, a2, a3] into scaleX, scaleY, rotDeg
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

export function gridSizeOf(D) {
  if (!D || !D.length) return 0;
  return Math.round(Math.sqrt(D.length / 2));
}

export function sampleD(D, gd, gx, gy) {
  if (!D || gd < 2) return [0, 0];
  const n = gd - 1;
  const fx = Math.max(0, Math.min(n, (gx + 1) * 0.5 * n));
  const fy = Math.max(0, Math.min(n, (gy + 1) * 0.5 * n));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(n, x0 + 1), y1 = Math.min(n, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const i00 = (y0 * gd + x0) * 2;
  const i10 = (y0 * gd + x1) * 2;
  const i01 = (y1 * gd + x0) * 2;
  const i11 = (y1 * gd + x1) * 2;
  const ax = D[i00] + (D[i10] - D[i00]) * tx;
  const ay = D[i00 + 1] + (D[i10 + 1] - D[i00 + 1]) * tx;
  const bx = D[i01] + (D[i11] - D[i01]) * tx;
  const by = D[i01 + 1] + (D[i11 + 1] - D[i01 + 1]) * tx;
  return [ax + (bx - ax) * ty, ay + (by - ay) * ty];
}

export function ensureGrid(sampleLayer, gd = 5) {
  const curGd = gridSizeOf(sampleLayer.D);
  if (curGd === gd) return sampleLayer.D;
  if (!curGd) {
    sampleLayer.D = new Array(gd * gd * 2).fill(0);
    return sampleLayer.D;
  }
  sampleLayer.D = resampleGrid(sampleLayer.D, curGd, gd);
  return sampleLayer.D;
}

export function resampleGrid(oldD, oldGd, newGd) {
  const out = new Array(newGd * newGd * 2).fill(0);
  if (!oldD || oldGd < 2) return out;
  for (let iy = 0; iy < newGd; iy++) {
    const gy = -1 + (2 * iy) / (newGd - 1);
    for (let ix = 0; ix < newGd; ix++) {
      const gx = -1 + (2 * ix) / (newGd - 1);
      const [dx, dy] = sampleD(oldD, oldGd, gx, gy);
      const idx = (iy * newGd + ix) * 2;
      out[idx] = +dx.toFixed(5);
      out[idx + 1] = +dy.toFixed(5);
    }
  }
  return out;
}

/**
 * Compute visual canvas positions [x, y] of every lattice control node (ix, iy).
 * Because shader samples tex at g_tex = g_screen + D(g_screen), a texture node g0
 * appears visually at g_vis where g_vis + D(g_vis) ≈ g0.
 */
export function latticeCanvasPoints(layer, sampleLayer, displayGd = 5) {
  const D = sampleLayer.D;
  const gd = D && D.length ? gridSizeOf(D) : displayGd;
  const A = sampleLayer.A || [1, 0, 0, 1];
  const t = sampleLayer.t || [0, 0];
  const w2 = layer.w * 0.5, h2 = layer.h * 0.5;
  const pts = [];

  for (let iy = 0; iy < gd; iy++) {
    const g0y = -1 + (2 * iy) / (gd - 1);
    for (let ix = 0; ix < gd; ix++) {
      const g0x = -1 + (2 * ix) / (gd - 1);
      let gx = g0x, gy = g0y;
      if (D && D.length) {
        // Invert g + D(g) = g0 cleanly via 4 damped fixed-point iterations
        for (let it = 0; it < 4; it++) {
          const [dx, dy] = sampleD(D, gd, gx, gy);
          gx = g0x - dx;
          gy = g0y - dy;
        }
      }
      const lx = gx * w2, ly = gy * h2;
      const cx = A[0] * lx + A[1] * ly + t[0];
      const cy = A[2] * lx + A[3] * ly + t[1];
      pts.push({ ix, iy, gx, gy, x: cx, y: cy });
    }
  }
  return { gd, pts };
}

/**
 * Drag a single lattice control node (ix, iy) by canonical canvas delta (dxCanon, dyCanon).
 */
export function dragLatticePoint(layer, sampleLayer, ix, iy, dxCanon, dyCanon, defaultGd = 5) {
  const gd = gridSizeOf(sampleLayer.D) || defaultGd;
  const D = ensureGrid(sampleLayer, gd);
  const Ai = inv2(sampleLayer.A || [1, 0, 0, 1]);
  const [dlx, dly] = mul2v(Ai, dxCanon, dyCanon);
  const dgx = dlx / (layer.w * 0.5);
  const dgy = dly / (layer.h * 0.5);
  const idx = (iy * gd + ix) * 2;
  // Inverse displacement: dragging pixels right (+dgx) decreases sample lookup D (-dgx)
  D[idx] = +(D[idx] - dgx).toFixed(5);
  D[idx + 1] = +(D[idx + 1] - dgy).toFixed(5);
}

/**
 * Sculpting / Liquify Warp Brush directly modifying D[gd*gd*2].
 * mode: "push" | "smooth" | "restore"
 */
export function applyWarpBrush(layer, sampleLayer, pPrev, pCurr, radiusCanon, strength = 0.65, mode = "push", defaultGd = 7) {
  const gd = gridSizeOf(sampleLayer.D) || defaultGd;
  const D = ensureGrid(sampleLayer, gd);
  const { pts } = latticeCanvasPoints(layer, sampleLayer, gd);
  const Ai = inv2(sampleLayer.A || [1, 0, 0, 1]);
  const dxC = pCurr[0] - pPrev[0], dyC = pCurr[1] - pPrev[1];
  const [dlx, dly] = mul2v(Ai, dxC, dyC);
  const dgx = dlx / (layer.w * 0.5);
  const dgy = dly / (layer.h * 0.5);

  const prevCopy = mode === "smooth" ? D.slice() : null;
  let touched = false;

  for (const pt of pts) {
    const dist = Math.hypot(pt.x - pCurr[0], pt.y - pCurr[1]);
    if (dist >= radiusCanon) continue;
    const u = 1 - dist / radiusCanon;
    const w = u * u * (3 - 2 * u) * strength; // smoothstep radial falloff
    const idx = (pt.iy * gd + pt.ix) * 2;
    touched = true;

    if (mode === "push") {
      D[idx] = +(D[idx] - dgx * w).toFixed(5);
      D[idx + 1] = +(D[idx + 1] - dgy * w).toFixed(5);
    } else if (mode === "restore") {
      const k = Math.min(1, w * 0.35);
      D[idx] = +(D[idx] * (1 - k)).toFixed(5);
      D[idx + 1] = +(D[idx + 1] * (1 - k)).toFixed(5);
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
      D[idx] = +(prevCopy[idx] * (1 - k) + (sx / cnt) * k).toFixed(5);
      D[idx + 1] = +(prevCopy[idx + 1] * (1 - k) + (sy / cnt) * k).toFixed(5);
    }
  }
  return touched;
}

export function smoothGrid(sampleLayer, factor = 0.35) {
  const gd = gridSizeOf(sampleLayer.D);
  if (gd < 3) return;
  const src = sampleLayer.D.slice();
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
      sampleLayer.D[i] = +(src[i] * (1 - factor) + (sx / c) * factor).toFixed(5);
      sampleLayer.D[i + 1] = +(src[i + 1] * (1 - factor) + (sy / c) * factor).toFixed(5);
    }
  }
}

/**
 * Mirror a layer's keyform across head center X from srcSampleIdx -> dstSampleIdx
 * (e.g., mirror Left turn keyform cleanly to Right turn keyform!).
 */
export function mirrorLayerKeyform(pack, layerIdx, srcSampleIdx, dstSampleIdx) {
  const src = pack.samples[srcSampleIdx]?.layers[layerIdx];
  const dst = pack.samples[dstSampleIdx]?.layers[layerIdx];
  if (!src || !dst) return;
  const cx = (pack.head?.centre?.[0]) ?? (pack.canvas[0] * 0.5);
  const A = src.A || [1, 0, 0, 1];
  // Mirror across vertical axis X = cx: flip off-diagonal shear/rotation signs
  dst.A = [A[0], -A[1], -A[2], A[3]];
  dst.t = [+(2 * cx - src.t[0]).toFixed(2), src.t[1]];
  dst.op = src.op;
  if (src.turn !== undefined) dst.turn = -src.turn;
  if (src.behind !== undefined) dst.behind = src.behind;
  if (src.D && src.D.length) {
    const gd = gridSizeOf(src.D);
    const out = new Array(src.D.length);
    for (let iy = 0; iy < gd; iy++) {
      for (let ix = 0; ix < gd; ix++) {
        const si = (iy * gd + (gd - 1 - ix)) * 2;
        const di = (iy * gd + ix) * 2;
        out[di] = -src.D[si];
        out[di + 1] = src.D[si + 1];
      }
    }
    dst.D = out;
  }
}

/**
 * Interpolate a layer's keyform between two surrounding keyform samples.
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
  const gdA = gridSizeOf(a.D), gdB = gridSizeOf(b.D);
  if (gdA || gdB) {
    const gd = Math.max(gdA, gdB);
    const da = gdA === gd ? a.D : resampleGrid(a.D, gdA, gd);
    const db = gdB === gd ? b.D : resampleGrid(b.D, gdB, gd);
    dst.D = da.map((v, k) => +(v + (db[k] - v) * f).toFixed(5));
  }
}
