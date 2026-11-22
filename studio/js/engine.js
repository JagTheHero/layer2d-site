/**
 * Layer2D Studio WebGL2 Live Rendering Engine
 * 1:1 shader & runtime parity with viewer/index.html, extended with:
 *   - Live mutable pack.json & instant syncPack()
 *   - Pan/zoom viewport camera & pixel-accurate alpha layer hit-testing
 *   - Onion skinning across adjacent yaw keyforms
 *   - Non-destructive layer hide/solo & live texture upload/replace
 *   - Offscreen expression thumbnail & .l2d preview PNG capture
 *   - Interactive spring-chain impulse/wind/gravity physics preview
 */

import { VS, FS } from "./shaders.js";
import { inv2, sampleD, gridSizeOf } from "./warp_math.js";

const DEFAULT_VOWELS = { A: "M04", I: "M05", U: "M06", E: "M07", O: "M08" };
const LID = [0.4, 0.15];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, f) { return a + (b - a) * f; }
function lerpArr(a, b, f) {
  const o = new Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] + (b[i] - a[i]) * f;
  return o;
}
function rotP(p, c, a) {
  const co = Math.cos(a), si = Math.sin(a), dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + co * dx - si * dy, c[1] + si * dx + co * dy];
}

export function loadImageFromBytes(u8, path = "") {
  const mime = path.endsWith(".webp") ? "image/webp" : path.endsWith(".jpg") || path.endsWith(".jpeg") ? "image/jpeg" : "image/png";
  const url = URL.createObjectURL(new Blob([u8], { type: mime }));
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Failed to decode image ${path}`)); };
    im.src = url;
  });
}

export class Layer2DEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", {
      premultipliedAlpha: true,
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!this.gl) throw new Error("WebGL2 is required for Layer2D Studio.");

    this.prog = null;
    this.U = {};
    this.vao = null;
    this.P = null;
    this.tex = Object.create(null);
    this.holes = Object.create(null);
    this.wipes = Object.create(null);
    this.opens = Object.create(null);
    this.sheers = Object.create(null);
    this.alphaMaps = Object.create(null); // cached downsampled alpha for fast accurate hit-testing
    this._eyeCache = new WeakMap();       // cached Float32Array eye profiles (keeps pack pure JSON)
    this.clipFbo = Object.create(null);
    this.clipOrder = [];
    this.skirtTex = null;
    this.lockTex = null;
    this.lockRows = null;
    this.chainTex = null;
    this.chainRows = null;
    this.CH = [];
    this.HL_IDS = new Set();
    this.chainIds = new Int32Array(8);
    this.visRows = new Float32Array(4 * 24);
    this.simT = 0;
    this.faceSince = 0;
    this.lastFace = null;
    this.lastView = [0, 0, 1200, 2000];
    this.fboW = 0;
    this.fboH = 0;
    this.ready = false;

    // Physics preview tuning overrides (from Studio Physics / Animate panels)
    this.physics = {
      enabled: true,
      springScale: 1.0,
      wind: 0.25,
      gravity: 1.0,
    };

    this._initGL();
  }

  _compile(type, src) {
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`WebGL2 shader compile error: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  }

  _initGL() {
    const gl = this.gl;
    this.prog = gl.createProgram();
    gl.attachShader(this.prog, this._compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(this.prog, this._compile(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(this.prog, 0, "aPos");
    gl.linkProgram(this.prog);
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(this.prog));
    }
    const nU = gl.getProgramParameter(this.prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nU; i++) {
      const info = gl.getActiveUniform(this.prog, i);
      const name = info.name.replace(/\[0\]$/, "");
      this.U[name] = gl.getUniformLocation(this.prog, name);
    }
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  _uploadTex(im, mip = true) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _buildAlphaMap(id, im) {
    const maxDim = 256;
    const sc = Math.min(1, maxDim / Math.max(im.width || 1, im.height || 1));
    const w = Math.max(1, Math.round((im.width || 1) * sc));
    const h = Math.max(1, Math.round((im.height || 1) * sc));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(im, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) alpha[i] = data[i * 4 + 3];
    this.alphaMaps[id] = { w, h, alpha };
  }

  setTextureFromImage(id, im, mip = true) {
    const gl = this.gl;
    if (this.tex[id]) gl.deleteTexture(this.tex[id]);
    this.tex[id] = this._uploadTex(im, mip);
    this._buildAlphaMap(id, im);
  }

  async load(pack, textures, onProgress = null) {
    const gl = this.gl;
    this.ready = false;
    this.clipOrder = [];
    // Free previous GPU textures
    for (const map of [this.tex, this.holes, this.wipes, this.opens, this.sheers]) {
      for (const k of Object.keys(map)) { gl.deleteTexture(map[k]); delete map[k]; }
    }
    for (const k of Object.keys(this.alphaMaps)) delete this.alphaMaps[k];
    for (const k of Object.keys(this.clipFbo)) {
      gl.deleteTexture(this.clipFbo[k].tex);
      gl.deleteFramebuffer(this.clipFbo[k].fb);
      delete this.clipFbo[k];
    }

    this.P = pack;
    this.simT = 0;
    this.lastFace = null;

    const loadTexKey = async (path) => {
      const bytes = textures[path];
      if (!bytes) return null;
      return loadImageFromBytes(bytes, path);
    };

    const ext = pack.texExt || "webp";
    const total = (pack.layers || []).length + Object.keys((pack.expr && pack.expr.pieces) || {}).length;
    let done = 0;

    await Promise.all((pack.layers || []).map(async (L) => {
      const candidates = [`tex/${L.id}.${ext}`, `tex/${L.id}.webp`, `tex/${L.id}.png`];
      let im = null;
      for (const c of candidates) {
        if (textures[c]) { im = await loadTexKey(c); break; }
      }
      if (im) {
        this.tex[L.id] = this._uploadTex(im, true);
        this._buildAlphaMap(L.id, im);
      }
      if (L.sheer && textures[`tex/${L.id}_sheer.png`]) this.sheers[L.id] = this._uploadTex(await loadTexKey(`tex/${L.id}_sheer.png`), false);
      if (L.hole && textures[`tex/${L.id}_hole.png`]) this.holes[L.id] = this._uploadTex(await loadTexKey(`tex/${L.id}_hole.png`), false);
      if (L.wipe && textures[`tex/${L.id}_wipe.png`]) this.wipes[L.id] = this._uploadTex(await loadTexKey(`tex/${L.id}_wipe.png`), false);
      if (L.eye && L.eye.mode === 1 && textures[`tex/${L.id}_open.png`]) this.opens[L.id] = this._uploadTex(await loadTexKey(`tex/${L.id}_open.png`), true);
      if (onProgress) onProgress(++done, total);
    }));

    const sharedFx = Object.create(null);
    const pieces = (pack.expr && pack.expr.pieces) || {};
    await Promise.all(Object.keys(pieces).map(async (id) => {
      const pc = pieces[id];
      if (!pc) return;
      const n = pc.tex;
      const path = n ? (textures[`tex/${n}.png`] ? `tex/${n}.png` : `tex/${n}.${ext}`)
                     : (textures[`tex/expr_${id}.png`] ? `tex/expr_${id}.png` : `tex/expr_${id}.${ext}`);
      if (n) {
        if (!sharedFx[n] && textures[path]) {
          sharedFx[n] = loadTexKey(path).then((im) => this._uploadTex(im, true));
        }
        if (sharedFx[n]) this.tex["expr_" + id] = await sharedFx[n];
      } else if (textures[path]) {
        const im = await loadTexKey(path);
        this.tex["expr_" + id] = this._uploadTex(im, true);
      }
      if (onProgress) onProgress(++done, total);
    }));

    this.syncPack();
    this.ready = true;
  }

  /**
   * Call whenever pack metadata (layers, draw order, clipTarget, chains, head, motion, pitchGroups) changes.
   * Instantaneous (sub-millisecond) — does NOT reload textures.
   */
  syncPack(nextPack = null) {
    const gl = this.gl;
    if (nextPack) this.P = nextPack;
    const P = this.P;
    if (!P) return;

    P.lidx = Object.fromEntries(P.layers.map((l, k) => [l.id, k]));
    this.HL_IDS = new Set(Array.isArray(P.highlightIds) ? P.highlightIds : []);

    for (const L of P.layers) {
      if (L.kind === 0 && L.head && !L.pitchGroup) {
        L.pitchGroup = (P.pitchGroups && P.pitchGroups[L.id]) || "face";
      }
    }

    // Rebuild skirt LUT
    const S = P.skirt || { y0: 0, xl: [0.0], xr: [1.0], ml: [0.0], mr: [0.0] };
    const sn = Math.max(1, (S.xl || [0]).length);
    const sRows = new Float32Array(sn * 4);
    for (let i = 0; i < sn; i++) sRows.set([S.xl[i] || 0, S.xr[i] || 1, S.ml[i] || 0, S.mr[i] || 0], i * 4);
    if (!this.skirtTex) this.skirtTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.skirtTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sn, 1, 0, gl.RGBA, gl.FLOAT, sRows);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    // Rebuild lock rows
    const locks = (P.motion && P.motion.locks) || [];
    const nLocks = Math.max(1, locks.length);
    this.lockRows = new Float32Array(24 * nLocks);
    if (!this.lockTex) this.lockTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.lockTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 6, nLocks, 0, gl.RGBA, gl.FLOAT, this.lockRows);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    // Rebuild spring chains (preserving live velocity where chain topology didn't change)
    const prevByName = Object.fromEntries(this.CH.map((c) => [c.name, c]));
    this.CH = [];
    (P.chains || []).forEach((c, idx) => {
      const n = Math.floor((c.joints || []).length / 2);
      if (n < 2) return;
      const len = [];
      for (let i = 1; i < n; i++) {
        len.push(Math.hypot(c.joints[2 * i] - c.joints[2 * i - 2], c.joints[2 * i + 1] - c.joints[2 * i - 1]) || 1);
      }
      const owner = P.layers.find((L) => L.chains && L.chains.includes(idx));
      const pg = owner ? (owner.pitchGroup || (P.pitchGroups && P.pitchGroups[owner.id]) || "face")
        : c.parent === "head" ? (/ear/i.test(c.name) ? "ear" : /back|bs/i.test(c.name) ? "back" : /side/i.test(c.name) ? "side" : "bangs") : "face";
      const prev = prevByName[c.name];
      const keepState = prev && prev.n === n && prev.J.length === c.joints.length;
      this.CH.push({
        ...c,
        J: c.joints,
        n,
        len,
        d: new Float32Array(2 * n),
        x: keepState ? prev.x : null,
        v: keepState ? prev.v : null,
        pitchGroup: pg,
      });
    });
    this.chainRows = new Float32Array(28 * Math.max(1, this.CH.length));
    if (!this.chainTex) this.chainTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.chainTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 7, Math.max(1, this.CH.length), 0, gl.RGBA, gl.FLOAT, this.chainRows);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    // Rebuild clipFbo + topological order (every layer referenced by clip or behind needs an FBO!)
    const neededClip = new Set();
    for (const L of P.layers) {
      if (L.clipTarget) neededClip.add(L.id);
      if (L.clip) neededClip.add(L.clip);
      if (Array.isArray(L.behind)) { for (const b of L.behind) if (b) neededClip.add(b); }
    }
    for (const id of Object.keys(this.clipFbo)) {
      if (!neededClip.has(id)) {
        gl.deleteTexture(this.clipFbo[id].tex);
        gl.deleteFramebuffer(this.clipFbo[id].fb);
        delete this.clipFbo[id];
      }
    }
    const fw = Math.max(1, this.fboW || gl.drawingBufferWidth || 1);
    const fh = Math.max(1, this.fboH || gl.drawingBufferHeight || 1);
    for (const id of neededClip) {
      if (!this.clipFbo[id]) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        this.clipFbo[id] = { tex: t, fb };
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.clipOrder = [];
    const byId = Object.fromEntries(P.layers.map((l) => [l.id, l]));
    const visited = new Set(), visiting = new Set();
    const visit = (id) => {
      if (visited.has(id) || visiting.has(id) || !this.clipFbo[id]) return;
      visiting.add(id);
      const dep = byId[id] && byId[id].clip;
      if (dep && dep !== id && this.clipFbo[dep]) visit(dep);
      visiting.delete(id);
      visited.add(id);
      this.clipOrder.push(id);
    };
    for (const id of Object.keys(this.clipFbo)) visit(id);

    // Push constant head & motion uniforms
    gl.useProgram(this.prog);
    const U = this.U;
    const H0 = P.head;
    const MM = P.motion;
    gl.uniform2f(U.uC, ...H0.centre);
    gl.uniform2f(U.uEU, ...H0.eu);
    gl.uniform2f(U.uEV, ...H0.ev);
    gl.uniform1f(U.uR, H0.radius);
    gl.uniform1f(U.uChin, H0.chin);
    gl.uniform1f(U.uNeck, H0.neck);
    gl.uniform1f(U.uJawNear, H0.jawNear);
    if (H0.chinWide) gl.uniform3f(U.uChinWide, ...H0.chinWide);
    gl.uniform2f(U.uPivot, ...H0.pivot);
    gl.uniform2f(U.uWaist, ...MM.waist);
    gl.uniform1f(U.uFootY, MM.footY);
    gl.uniform1f(U.uLegTop, MM.legTop);
    if (MM.shin) gl.uniform2f(U.uShin, ...MM.shin);
    const hips = MM.hips || { R: [MM.bodyC - 100, MM.legTop], L: [MM.bodyC + 100, MM.legTop] };
    gl.uniform3f(U.uCam, MM.bodyC, hips.R[1], 16000);
    gl.uniform1f(U.uBodyC, MM.bodyC);
    gl.uniform2f(U.uTwist, ...MM.twistY);
    gl.uniform1f(U.uBodyR, MM.bodyR);
    gl.uniform2f(U.uSkirtY, ...MM.skirtY);
    let wide = 0;
    for (let i = 0; i < sn; i++) if ((S.xr[i] - S.xl[i]) > (S.xr[wide] - S.xl[wide])) wide = i;
    gl.uniform1f(U.uSkirtYW, (S.y0 || 0) + wide);
    gl.uniform1f(U.uSkirtY0, S.y0 || 0);
    gl.uniform1i(U.uSkirtN, sn);
    gl.uniform1f(U.uEarSoft, MM.earSoft ?? 5.0);
    gl.uniform1f(U.uSew, MM.sew ?? 160.0);
  }

  resize(W, H) {
    const gl = this.gl;
    W = Math.max(1, Math.round(W));
    H = Math.max(1, Math.round(H));
    if (this.canvas.width === W && this.canvas.height === H && this.fboW === W && this.fboH === H) return;
    this.canvas.width = W;
    this.canvas.height = H;
    this.fboW = W;
    this.fboH = H;
    for (const fb of Object.values(this.clipFbo)) {
      gl.bindTexture(gl.TEXTURE_2D, fb.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.viewport(0, 0, W, H);
  }

  impulseChains(vx, vy) {
    for (const c of this.CH) {
      if (!c.v) continue;
      for (let i = 1; i < c.n; i++) {
        const f = i / Math.max(1, c.n - 1);
        c.v[2 * i] += vx * f;
        c.v[2 * i + 1] += vy * f;
      }
    }
  }

  resetPhysics() {
    for (const c of this.CH) { c.x = null; c.v = null; c.d.fill(0); }
  }

  _pitchGroup(id) {
    const P = this.P;
    if (P && P.pitchGroups && P.pitchGroups[id]) return P.pitchGroups[id];
    const L = P && P.layers[P.lidx?.[id]];
    return (L && L.pitchGroup) || "face";
  }

  _pitchParams(group, pitch) {
    if (!pitch) return [0, 1];
    const ap = Math.abs(pitch);
    if (group === "ear") {
      const sy = pitch >= 0 ? 1 - 0.06 * pitch : 1 + 0.03 * (-pitch);
      const yOff = -0.60 * this.P.head.radius;
      const dy = (pitch >= 0 ? 14 : 8) * pitch;
      return [dy + yOff * (1 - sy), sy];
    }
    if (group === "crown") return [-16 * pitch, 1 - 0.02 * ap];
    if (group === "back") return [22 * pitch, 1];
    if (group === "humanEar") return [10 * pitch, 1];
    if (group === "side") return [-16 * pitch, 1 - 0.025 * ap];
    if (group === "bangs") return [-34 * pitch, 1 - 0.04 * ap];
    return [-32 * pitch, 1 - 0.045 * ap];
  }

  _pitchFwd(p, pitch, group) {
    if (!pitch) return p;
    const H = this.P.head, [dy, sy] = this._pitchParams(group, pitch);
    const dx = p[0] - H.centre[0], dvy = p[1] - H.centre[1];
    const u = dx * H.eu[0] + dvy * H.eu[1], v = (dx * H.ev[0] + dvy * H.ev[1]) * sy + dy;
    return [H.centre[0] + u * H.eu[0] + v * H.ev[0], H.centre[1] + u * H.eu[1] + v * H.ev[1]];
  }

  _cylFwd(p, a) {
    const H = this.P.head;
    const dx = p[0] - H.centre[0], dy = p[1] - H.centre[1];
    const u = dx * H.eu[0] + dy * H.eu[1], v = dx * H.ev[0] + dy * H.ev[1];
    if (Math.abs(u) >= H.radius) return p;
    const q = Math.asin(clamp(u / H.radius, -0.999, 0.999));
    const u2 = H.radius * Math.sin(q + a * Math.cos(q));
    return [H.centre[0] + u2 * H.eu[0] + v * H.ev[0], H.centre[1] + u2 * H.eu[1] + v * H.ev[1]];
  }

  _hipsFwd(p, m) {
    const y = p[1] + (m.bounce || 0);
    return [p[0] + (m.lean || 0) * (this.P.motion.footY - y), y];
  }

  _torsoFwd(p, m) {
    return this._hipsFwd(rotP(p, this.P.motion.waist, m.sway || 0), m);
  }

  keyAt(a, exactIdx = null) {
    const S = this.P.samples;
    if (!S || !S.length) return { angle: 0, jaw: 0, chin: 0, chinAt: this.P.head.centre, layers: [] };
    if (exactIdx !== null && exactIdx >= 0 && exactIdx < S.length) return S[exactIdx];
    const turn = this.P.head.turn;
    const ang = a < 0 ? -a * turn.R : a * turn.L;
    let i = 0;
    while (i + 1 < S.length && S[i + 1].angle < ang) i++;
    const s0 = S[i], s1 = S[Math.min(i + 1, S.length - 1)];
    const f = s1.angle === s0.angle ? 0 : clamp((ang - s0.angle) / (s1.angle - s0.angle), 0, 1);
    return {
      angle: lerp(s0.angle, s1.angle, f),
      jaw: lerp(s0.jaw || 0, s1.jaw || 0, f),
      chin: lerp(s0.chin || 0, s1.chin || 0, f),
      chinAt: lerpArr(s0.chinAt || this.P.head.centre, s1.chinAt || this.P.head.centre, f),
      layers: s0.layers.map((p, k) => {
        const q = s1.layers[k] || p;
        const out = {
          A: lerpArr(p.A, q.A, f),
          t: lerpArr(p.t, q.t, f),
          op: lerp(p.op, q.op, f),
          turn: lerp(p.turn || 0, q.turn || 0, f),
          behind: lerp(p.behind || 0, q.behind || 0, f),
          hole: lerp(p.hole || 0, q.hole || 0, f),
          wipe: lerp(p.wipe ?? 1, q.wipe ?? 1, f),
          cut: lerp(p.cut || 0, q.cut || 0, f),
          D: p.D && q.D && p.D.length === q.D.length ? lerpArr(p.D, q.D, f) : (p.D || q.D || null),
        };
        if (p.slide && q.slide) out.slide = lerpArr(p.slide, q.slide, f);
        return out;
      }),
    };
  }

  _stepChains(m, dt) {
    const P = this.P;
    if (!this.physics.enabled) {
      for (const c of this.CH) c.d.fill(0);
      return;
    }
    const wind = this.physics.wind;
    const spScale = Math.max(0.15, this.physics.springScale);
    const grav = (this.physics.gravity - 1.0) * 180;
    const turn = P.head.turn;
    const roll0 = P.motion.roll0 || 0;

    for (const c of this.CH) {
      const A = c.J, n = c.n;
      const T0 = new Float64Array(A.length);
      let fwd;
      if (c.parent === "head") {
        const a = Math.abs(m.a) * (m.a < 0 ? turn.R : turn.L) * (c.depth ?? 1);
        const pg = c.pitchGroup || "face";
        fwd = (p) => this._torsoFwd(rotP(this._pitchFwd(this._cylFwd(p, a), m.pitch || 0, pg), P.head.pivot, roll0 + (m.roll || 0)), m);
      } else if (c.parent === "hips") {
        fwd = (p) => this._hipsFwd(p, m);
      } else {
        fwd = (p) => this._torsoFwd(p, m);
      }
      for (let i = 0; i < A.length; i += 2) T0.set(fwd([A[i], A[i + 1]]), i);

      // Tail uses smooth pelvis pendulum transform in _drawLayer
      if (P.tail && c.name === "wolf_tail") {
        if (!c.x) { c.x = Float64Array.from(T0); c.v = new Float64Array(T0.length); }
        c.d.fill(0);
        continue;
      }

      if (!c.x || c.x.length !== T0.length) {
        c.x = Float64Array.from(T0);
        c.v = new Float64Array(T0.length);
      }
      for (let i = 1; i < n; i++) {
        if (c.pin && i === n - 1) {
          c.x[2 * i] = T0[2 * i]; c.x[2 * i + 1] = T0[2 * i + 1];
          c.v[2 * i] = c.v[2 * i + 1] = 0;
          continue;
        }
        const f = i / Math.max(1, n - 1);
        const k = (c.k[0] + (c.k[1] - c.k[0]) * f) * spScale;
        const om = 2 * Math.PI * (0.45 + 2.6 * k);
        const z = 0.12 + c.damp * 2.2;
        const w = wind * 140 * f * (Math.sin(this.simT * 1.3 + c.J[0] * 0.004 + i * 0.6) + 0.5 * Math.sin(this.simT * 2.9 + c.J[1] * 0.003));
        for (let ax = 0; ax < 2; ax++) {
          const j = 2 * i + ax;
          const ext = ax === 0 ? w : grav * f;
          c.v[j] += (om * om * (T0[j] - c.x[j]) - 2 * z * om * c.v[j] + ext) * dt;
          c.x[j] += c.v[j] * dt;
        }
      }
      c.x[0] = T0[0]; c.x[1] = T0[1];
      for (let it = 0; it < 2; it++) {
        for (let i = 1; i < n; i++) {
          if (c.pin && i === n - 1) continue;
          const dx = c.x[2 * i] - c.x[2 * i - 2], dy = c.x[2 * i + 1] - c.x[2 * i - 1];
          const d = Math.hypot(dx, dy) || 1, r = c.len[i - 1] / d;
          c.x[2 * i] = c.x[2 * i - 2] + dx * r;
          c.x[2 * i + 1] = c.x[2 * i - 1] + dy * r;
        }
      }
      for (let i = 0; i < 2 * n; i++) c.d[i] = c.x[i] - T0[i];
    }
  }

  _evalFace(params) {
    const P = this.P;
    const X = P.expr || { pieces: {}, faces: {}, holds: {}, eyes: {} };
    const name = params.face || null;
    if (name !== this.lastFace) { this.lastFace = name; this.faceSince = this.simT; }
    const u = Math.max(0, this.simT - this.faceSince);
    const F = (name && X.faces && X.faces[name]) || {};
    const hide = new Set(F.hide || []);
    let add = [...(F.add || [])];
    const Hd = params.hold && X.holds && X.holds[params.hold];
    if (Hd) {
      for (const h of Hd.hide || []) hide.add(h);
      add = add.concat(Hd.add || []);
    }
    const vw = params.vowel;
    if (vw) {
      const map = X.vowels || DEFAULT_VOWELS;
      const vid = map[String(vw).toUpperCase()];
      if (vid && X.pieces && X.pieces[vid] && !hide.has("M01")) {
        hide.add("M01");
        add.push(vid);
      }
    }
    const after = Object.create(null);
    for (const pid of add) {
      const pc = X.pieces && X.pieces[pid];
      if (!pc) continue;
      let inst = { id: pid, ...pc };
      // Flipbook & procedural animation
      if (inst.atlas) {
        const B = inst.atlas, v = u - (inst.t0 || 0);
        if (v < 0) inst = { ...inst, op: 0 };
        else {
          const i = Math.floor(v * B.fps);
          const f = i < (B.intro || 0) ? i : (B.intro || 0) + ((B.loop || 1) > 1 ? (i - (B.intro || 0)) % B.loop : 0);
          const q = f % B.cols, r = Math.floor(f / B.cols), cw = 1 / B.cols, ch = 1 / B.rows;
          const pad = B.pad || [0, 0];
          inst = { ...inst, frame: [q * cw + pad[0], r * ch + pad[1], cw - 2 * pad[0], ch - 2 * pad[1]] };
        }
      }
      if (inst.anim) {
        const A = inst.anim;
        let s = 1, rot = 0, dx = 0, dy = 0, op = inst.op ?? 1, reveal = 1;
        if (A.pop) { const k = Math.min(1, u / A.pop) - 1; s *= 1 + 2.70158 * k ** 3 + 1.70158 * k ** 2; }
        if (A.fade) op *= Math.min(1, u / A.fade);
        if (A.pulse) s *= 1 + A.pulse[1] * Math.abs(Math.sin(Math.PI * u / A.pulse[0]));
        if (A.spin) rot += 2 * Math.PI * u / A.spin;
        if (A.twinkle) { const w = Math.sin(2 * Math.PI * u / A.twinkle[0]); s *= 1 + A.twinkle[1] * w; rot += A.twinkle[2] * Math.PI / 180 * w; }
        if (A.slide) { const ph = (u % A.slide[0]) / A.slide[0]; dy = A.slide[1] * inst.h * ph; op *= Math.min(1, (1 - ph) / 0.25); }
        if (A.reveal) reveal = Math.min(1, u / A.reveal);
        if (A.wobble) dx = A.wobble[1] * inst.w * Math.sin(2 * Math.PI * u / A.wobble[0]);
        const si = Math.max(s, 1e-3), c = Math.cos(-rot) / si, sn = Math.sin(-rot) / si, R = inst.relA || [1, 0, 0, 1];
        const tx = (inst.relT ? inst.relT[0] : 0) - dx, ty = (inst.relT ? inst.relT[1] : 0) - dy;
        inst = {
          ...inst,
          relA: [c * R[0] - sn * R[2], c * R[1] - sn * R[3], sn * R[0] + c * R[2], sn * R[1] + c * R[3]],
          relT: [c * tx - sn * ty, sn * tx + c * ty],
          op,
          reveal,
        };
      }
      const target = inst.at || inst.base;
      (after[target] ||= []).push(inst);
    }

    const move = {};
    for (const [id, mv] of Object.entries(F.move || {})) {
      move[id] = [mv[0] || 0, mv[1] || 0, mv[2] || 0];
    }
    const eo = Array.isArray(F.eyes) ? F.eyes : (typeof F.eyes === "number" ? [F.eyes, F.eyes] : [1, 1]);
    const ek = F.iris || 1;
    const eyeArr = [eo[0] * (params.eyeOpenR ?? params.eyes ?? 1), eo[1] * (params.eyeOpenL ?? params.eyes ?? 1), ek, ek];
    return {
      hide,
      after,
      move,
      eyes: eyeArr,
      gaze: F.look || [params.gazeX || 0, params.gazeY || 0],
      over: (Hd && Hd.over) || {},
    };
  }

  _eyeState(e, gz = [0, 0]) {
    const out = {};
    const ss = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
    const eyesCfg = (this.P.expr && this.P.expr.eyes) || {};
    ["R", "L"].forEach((s, j) => {
      const E = eyesCfg[s];
      if (!E || !E.cols) return;
      const o = e[j], lid = !!E.shut && o < 1, pin = lid || (!!E.pin && o < 1);
      const k = (pin ? 1 : clamp(Math.pow(Math.max(o, 0.05), -0.8), 0.7, 1.12)) * e[2 + j];
      const f = clamp((E.c[0] - E.x0) / E.dx, 0, E.cols.length - 1.001), i = Math.floor(f);
      const bot = E.cols[i][1] + (E.cols[i + 1][1] - E.cols[i][1]) * (f - i);
      let cached = this._eyeCache.get(E);
      if (!cached) {
        cached = {
          flat: new Float32Array(E.cols.flat()),
          flatS: new Float32Array(E.shut ? E.shut.flat() : 48),
        };
        this._eyeCache.set(E, cached);
      }
      const m = clamp(Math.max((1 - k) / 0.05, Math.hypot(gz[0], gz[1]) / 1.5), 0, 1);
      out[s] = {
        o, k, x0: E.x0, dx: E.dx, cols: cached.flat, mix: m * m * (3 - 2 * m),
        shut: cached.flatS, lid: E.shut ? 1 : 0,
        lo: lid ? 1 - ss(o / LID[0]) : 0,
        fade: lid ? 1 - ss(o / LID[1]) : 0,
        c: [E.c[0], E.c[1], E.c[0] + gz[0], (pin ? E.c[1] : bot - o * (bot - E.c[1])) + gz[1] * Math.min(1, o)],
      };
    });
    return out;
  }

  render(params, viewRect, dt = 1 / 60, opts = {}) {
    const gl = this.gl;
    const P = this.P;
    if (!this.ready || !P) return;

    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    if (W < 2 || H < 2) return;

    if (dt > 0) this.simT += Math.min(dt, 0.05);

    const [vx0, vy0, vx1, vy1] = viewRect;
    const sc = Math.min(W / Math.max(1, vx1 - vx0), H / Math.max(1, vy1 - vy0));
    const cx = (vx0 + vx1) * 0.5, cy = (vy0 + vy1) * 0.5;
    const hw = W / sc / 2, hh = H / sc / 2;
    const vw = this.lastView = [cx - hw, cy - hh, cx + hw, cy + hh];

    const m = {
      a: params.a || 0,
      pitch: params.pitch || 0,
      roll: params.roll || 0,
      sway: params.bodySway || 0,
      lean: params.bodyLean || 0,
      breath: 1.0 + (params.breath || 0),
      body: (params.a || 0) * ((P.motion.bodyFollow && P.motion.bodyFollow[0]) || 0),
      bounce: 0,
      tailWag: params.tailWag ?? 1.0,
      tailPhaseOffset: params.tailSway || 0,
    };

    if (dt > 0) this._stepChains(m, Math.min(dt, 0.033));

    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    const U = this.U;

    const clearCol = opts.transparent ? [0, 0, 0, 0] : (opts.bgColor || [0.047, 0.051, 0.063, 1.0]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(clearCol[0], clearCol[1], clearCol[2], clearCol[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Optional onion skinning of adjacent yaw keyforms (drawn softly behind active pass)
    if (opts.onionSkin && opts.snapSampleIdx !== null && opts.snapSampleIdx !== undefined) {
      const si = opts.snapSampleIdx;
      const ghosts = [];
      if (si > 0) ghosts.push({ idx: si - 1, op: 0.22 });
      if (si + 1 < P.samples.length) ghosts.push({ idx: si + 1, op: 0.22 });
      for (const gh of ghosts) {
        this._drawPass(m, params, vw, sc, W, H, gh.idx, opts.hiddenIds, opts.soloId, gh.op);
      }
    }

    this._drawPass(m, params, vw, sc, W, H, opts.snapSampleIdx ?? null, opts.hiddenIds, opts.soloId, 1.0);
  }

  _drawPass(m, params, vw, sc, W, H, exactIdx, hiddenIds, soloId, passOp) {
    const gl = this.gl;
    const P = this.P;
    const U = this.U;
    const MM = P.motion;
    const key = this.keyAt(m.a, exactIdx);
    const mg = 140;

    gl.uniform4f(U.uView, ...vw);
    gl.uniform1f(U.uLean, m.lean);
    gl.uniform1f(U.uBounce, m.bounce);
    gl.uniform1f(U.uSway, m.sway);
    gl.uniform1f(U.uBreath, m.breath);
    gl.uniform1f(U.uBody, m.body);
    gl.uniform1f(U.uRoll, (MM.roll0 || 0) + m.roll);
    gl.uniform2f(U.uBreast, 0, 0);
    gl.uniform2f(U.uSkirtDZ, 0, 0);
    gl.uniform2f(U.uFlare, 0, 0);
    gl.uniform1f(U.uDrop, 0);
    gl.uniform2f(U.uSkirtP, 0, 0);
    gl.uniform2f(U.uTurnBody, 0, 0);
    gl.uniform1i(U.uTurnN, 0);
    gl.uniform1f(U.uHeadRide, 0);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.skirtTex);
    gl.uniform1i(U.uSkirt, 3);
    gl.uniform1f(U.uJawV, key.jaw || 0);
    gl.uniform1f(U.uSign, Math.sign(key.angle || 0));
    gl.uniform1f(U.uChinW, key.chin || 0);
    gl.uniform2f(U.uChinAt, ...(key.chinAt || P.head.centre));

    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, this.lockTex);
    gl.uniform1i(U.uLocks, 8);
    gl.uniform1i(U.uLockN, 0);
    gl.uniform1f(U.uLockSigma, MM.lockSigma || 50);

    if (this.CH.length) {
      this.CH.forEach((c, i) => {
        const row = this.chainRows.subarray(28 * i, 28 * i + 28);
        row.fill(0);
        row.set(c.J.slice(0, 12), 0);
        row.set(c.d.slice(0, 12), 12);
        row[24] = c.n;
        row[25] = c.hang ? 1 : 0;
      });
      gl.activeTexture(gl.TEXTURE10);
      gl.bindTexture(gl.TEXTURE_2D, this.chainTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 7, this.CH.length, gl.RGBA, gl.FLOAT, this.chainRows);
    }
    gl.uniform1i(U.uChains, 10);
    gl.uniform1i(U.uSheerTex, 9);
    gl.uniform1f(U.uTime, this.simT);

    const fc = this._evalFace(params);
    const eyes = this._eyeState(fc.eyes, fc.gaze);
    const after = { ...fc.after };
    for (const s of ["R", "L"]) {
      const id = "E09" + s, b = "E05" + s;
      if (eyes[s] && eyes[s].fade > 0 && P.expr.pieces && P.expr.pieces[id] && !fc.hide.has(b)) {
        (after[b] = [...(after[b] || [])]).push({ id, ...P.expr.pieces[id], op: Math.min(1, 2 * eyes[s].fade) });
      }
    }

    // Outfit wear visibility
    const sleeveOp = Object.create(null);
    const wear = params.wear || {};
    for (const [g, o] of Object.entries(P.outfits || {})) {
      const w = g in wear ? wear[g] : (o.default === false ? 0 : 1);
      if (w >= 1) continue;
      for (const id of o.hide || []) sleeveOp[id] = (sleeveOp[id] ?? 1) * w;
    }

    const isVisible = (id) => {
      if (soloId && id !== soloId) return false;
      if (hiddenIds && hiddenIds.has(id)) return false;
      if (fc.hide.has(id)) return false;
      if (sleeveOp[id] === 0) return false;
      return true;
    };

    const drawLayer = (i, alphaOnly, move, piece) => {
      const L = P.layers[i], k = key.layers[i];
      if (!L || !k) return false;
      const tid = piece ? "expr_" + piece.id : L.id;
      if (!this.tex[tid]) return false;
      const effOp = (piece ? (piece.op ?? 1) : k.op * (sleeveOp[L.id] ?? 1)) * (alphaOnly ? 1 : passOp);
      if (effOp <= 0.0005 || (k.wipe ?? 1) <= 0.0005) return false;

      const ey = L.eye && !(piece && L.eye.mode % 3 === 2) ? eyes[L.eye.side] : null;
      const lidOp = ey && L.eye.mode % 3 === 2 ? Math.min(1, 2 - 2 * ey.fade) : 1;
      let A = k.A, t = k.t;
      const w2 = L.w / 2, h2 = L.h / 2;

      let effMove = move;
      const shadowId = P.hairShadowId || null;
      if (!alphaOnly && !piece && shadowId && L.id === shadowId && (m.a || m.pitch)) {
        const dx = -8 * (m.a || 0), dy = -6 * (m.pitch || 0);
        effMove = effMove ? [effMove[0] + dx, effMove[1] + dy, effMove[2]] : [dx, dy, 0];
      }
      if (effMove) {
        const r = (effMove[2] || 0) * Math.PI / 180, co = Math.cos(r), si = Math.sin(r);
        A = [co * A[0] + si * A[2], co * A[1] + si * A[3], -si * A[0] + co * A[2], -si * A[1] + co * A[3]];
        t = [t[0] + effMove[0], t[1] + effMove[1]];
      }

      // Pelvis-locked rigid tail pendulum (ZERO vertical root drift, rigid rotation!)
      const tailCfg = P.tail || null;
      if (!alphaOnly && !piece && tailCfg && L.id === tailCfg.id) {
        const wag = m.tailWag ?? 1.0;
        const freq = tailCfg.freq || 2.45;
        const ph = this.simT * freq;
        const sw = (this.physics.enabled ? (Math.sin(ph) + 0.14 * Math.sin(2.0 * ph - 0.65)) * wag : 0) + (m.tailPhaseOffset || 0);
        const piv = this._hipsFwd(tailCfg.pivot, m);
        const th = (tailCfg.amp || 0.165) * sw;
        const co = Math.cos(th), si = Math.sin(th);
        A = [co * A[0] - si * A[2], co * A[1] - si * A[3], si * A[0] + co * A[2], si * A[1] + co * A[3]];
        const dx = t[0] - piv[0], dy = t[1] - piv[1];
        t = [piv[0] + co * dx - si * dy, piv[1] + si * dx + co * dy];
      }

      let spread = 1;
      if (k.D) { let mx = 0; for (const v of k.D) mx = Math.max(mx, Math.abs(v)); spread += mx; }
      let corners = [[-w2, -h2], [w2, -h2], [w2, h2], [-w2, h2]];
      if (piece) {
        const Ri = inv2(piece.relA || [1, 0, 0, 1]);
        const rT = piece.relT || [0, 0];
        corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
          const ex = sx * piece.w / 2 - rT[0], ey2 = sy * piece.h / 2 - rT[1];
          return [Ri[0] * ex + Ri[1] * ey2, Ri[2] * ex + Ri[3] * ey2];
        });
      }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [cx2, cy2] of corners) {
        const x = (A[0] * cx2 + A[1] * cy2) * spread + t[0];
        const y = (A[2] * cx2 + A[3] * cy2) * spread + t[1];
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      const px = (L.pad || 260) + mg, py = mg + Math.abs(m.pitch || 0) * 90 + 60;
      gl.uniform4f(U.uBox, x0 - px, y0 - py, x1 + px, y1 + py);
      const Ai = inv2(A);
      gl.uniformMatrix2fv(U.uAi, false, [Ai[0], Ai[2], Ai[1], Ai[3]]);
      gl.uniform2f(U.uT, t[0], t[1]);
      gl.uniform2f(U.uHalf, w2, h2);
      gl.uniform1i(U.uTint, 0);
      gl.uniform1i(U.uKind, L.kind || 0);
      gl.uniform1f(U.uOp, effOp * lidOp);
      gl.uniform1i(U.uAlphaOnly, alphaOnly ? 1 : 0);
      gl.uniform1i(U.uHead, L.head ? 1 : 0);
      gl.uniform1i(U.uJaw, L.jaw ? 1 : 0);
      gl.uniform1i(U.uNoFade, L.noFade ? 1 : 0);
      gl.uniform1f(U.uTurn, k.turn || 0);
      const [pDy, pSy] = L.kind === 0 && L.head ? this._pitchParams(this._pitchGroup(L.id), m.pitch || 0) : [0, 1];
      gl.uniform1f(U.uPitch, pDy);
      gl.uniform1f(U.uPitchScale, pSy);
      gl.uniform1i(U.uHair, 0);
      const bd = L.bodyDepth ?? 1;
      gl.uniform4fv(U.uBodyDepth, Array.isArray(bd) ? [bd[0], 1, bd[1], bd[2]] : [bd, bd, 0, 1]);
      if (L.kind === 2 || L.kind === 3) {
        const arm = L.kind === 2 ? "armR" : "armL";
        const sh = (MM.shoulder && MM.shoulder[arm]) || [0, 0];
        const sf = (MM.seam && MM.seam[arm]) || [0, 1, 0, 0, 0, 100];
        gl.uniform2f(U.uShoulder, sh[0], sh[1]);
        gl.uniform1f(U.uArm, 0);
        gl.uniform2f(U.uAxis, sf[0], sf[1]);
        gl.uniform4f(U.uSeam, sf[2], sf[3], sf[4], sf[5]);
        gl.uniform1f(U.uShoulderDX, 0);
        gl.uniform1f(U.uStretch, 0);
        gl.uniform1f(U.uRaise, 0);
        gl.uniform2f(U.uRShift, 0, 0);
        gl.uniform1f(U.uElbow, 0);
        gl.uniform1i(U.uElbowHalf, 0);
        gl.uniform4f(U.uElbowRU, 0, 0, 0, 0);
        gl.uniform1f(U.uWrist, 0);
        gl.uniform2f(U.uArmP, 0, 0);
        gl.uniform1f(U.uRiseBy, 0);
        gl.uniform2f(U.uSlv, 0, 0);
      } else if (L.kind === 6) {
        const s = /R(_in)?$/.test(L.id) ? "R" : "L";
        const hip = (MM.hips && MM.hips[s]) || [MM.bodyC, MM.legTop];
        gl.uniform1f(U.uLegA, 0);
        gl.uniform2f(U.uHip, hip[0], hip[1]);
        gl.uniform2f(U.uLegP, 0, 0);
      }
      gl.uniform2f(U.uCuff, 0, 0);

      if (L.chains && L.chains.length && this.CH.length) {
        const valid = L.chains.filter((ci) => ci >= 0 && ci < this.CH.length).slice(0, 8);
        this.chainIds.fill(0);
        this.chainIds.set(valid);
        gl.uniform1iv(U.uChainIds, this.chainIds);
        gl.uniform1i(U.uChainN, valid.length);
        gl.uniform1f(U.uChainSigma, L.chainSigma || 160);
      } else {
        gl.uniform1i(U.uChainN, 0);
      }
      gl.uniform1i(U.uSheerOn, 0);
      if (k.D && k.D.length) {
        const gd = gridSizeOf(k.D);
        gl.uniform1i(U.uHasD, 1);
        gl.uniform1i(U.uGD, gd);
        gl.uniform2fv(U.uD, k.D);
      } else {
        gl.uniform1i(U.uHasD, 0);
      }
      gl.uniform1i(U.uHook, 0);
      gl.uniform1i(U.uRigid, 0);
      gl.uniform1i(U.uRelOn, piece ? 1 : 0);
      gl.uniform4fv(U.uAtlas, (piece && piece.frame) || [0, 0, 1, 1]);
      if (piece) {
        const R = piece.relA || [1, 0, 0, 1];
        const rT = piece.relT || [0, 0];
        gl.uniformMatrix2fv(U.uRelA, false, [R[0], R[2], R[1], R[3]]);
        gl.uniform2f(U.uRelT, rT[0], rT[1]);
        gl.uniform2f(U.uRelHalf, piece.w / 2, piece.h / 2);
        gl.uniform1f(U.uReveal, piece.reveal ?? 1);
      }
      gl.uniform1i(U.uVis, 0);
      if (ey) {
        const E = L.eye;
        gl.uniform1i(U.uEye, E.mode);
        gl.uniformMatrix2fv(U.uEyeA, false, [E.A[0], E.A[2], E.A[1], E.A[3]]);
        gl.uniform2f(U.uEyeT, E.t[0], E.t[1]);
        gl.uniform2f(U.uEyeX, ey.x0, ey.dx);
        gl.uniform4fv(U.uEyeC, ey.c);
        gl.uniform3fv(U.uEyeR, ey.cols);
        gl.uniform1f(U.uEyeO, ey.o);
        gl.uniform1f(U.uEyeK, ey.k);
        gl.uniform2fv(U.uEyeS, ey.shut);
        gl.uniform1i(U.uEyeLid, ey.lid);
        gl.uniform1f(U.uEyeLo, ey.lo);
        if (E.mode === 1 && this.opens[L.id]) {
          gl.uniform1f(U.uOpenMix, ey.mix);
          gl.activeTexture(gl.TEXTURE5);
          gl.bindTexture(gl.TEXTURE_2D, this.opens[L.id]);
          gl.uniform1i(U.uOpenTex, 5);
        }
      } else {
        gl.uniform1i(U.uEye, 0);
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[tid]);
      gl.uniform1i(U.uTex, 0);
      if (L.hole && !piece && this.holes[L.id]) {
        gl.uniform1i(U.uHasHole, 1);
        gl.uniform1f(U.uHoleS, k.hole || 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.holes[L.id]);
        gl.uniform1i(U.uHole, 1);
      } else {
        gl.uniform1i(U.uHasHole, 0);
      }
      if (L.wipe && !piece && this.wipes[L.id]) {
        gl.uniform1i(U.uHasWipe, 1);
        gl.uniform1f(U.uWipe, k.wipe ?? 1);
        gl.uniform1f(U.uWipeSoft, L.wipe);
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, this.wipes[L.id]);
        gl.uniform1i(U.uWipeTex, 4);
      } else {
        gl.uniform1i(U.uHasWipe, 0);
      }
      if (L.clip && this.clipFbo[L.clip] && (!alphaOnly || L.clip !== L.id)) {
        gl.uniform1i(U.uClipOn, 1);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.clipFbo[L.clip].tex);
        gl.uniform1i(U.uClip, 2);
      } else {
        gl.uniform1i(U.uClipOn, 0);
      }
      if (L.behind && !alphaOnly && !piece && (k.behind || 0) >= 0.5 && this.clipFbo[L.behind[0]] && this.clipFbo[L.behind[1]]) {
        gl.uniform1f(U.uBehind, 1.0);
        gl.uniform2f(U.uBehindShift, 0, 0);
        gl.activeTexture(gl.TEXTURE6);
        gl.bindTexture(gl.TEXTURE_2D, this.clipFbo[L.behind[0]].tex);
        gl.uniform1i(U.uBehindA, 6);
        gl.activeTexture(gl.TEXTURE7);
        gl.bindTexture(gl.TEXTURE_2D, this.clipFbo[L.behind[1]].tex);
        gl.uniform1i(U.uBehindB, 7);
      } else {
        gl.uniform1f(U.uBehind, 0);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return true;
    };

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const u of [gl.TEXTURE2, gl.TEXTURE6, gl.TEXTURE7]) {
      gl.activeTexture(u);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    // 1. Render clip/behind alpha masks in topological dependency order
    for (const id of this.clipOrder) {
      const fb = this.clipFbo[id];
      if (!fb) continue;
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fb);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (isVisible(id)) {
        const idx = P.lidx[id];
        if (idx !== undefined) drawLayer(idx, true, fc.move[id], null);
      }
    }

    // 2. Render visible layers onto screen framebuffer
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);

    const over = fc.over || {};
    const overAt = Object.create(null);
    for (const [lid, at] of Object.entries(over)) {
      const idx = P.lidx[lid];
      if (idx !== undefined) (overAt[at] ||= []).push(idx);
    }

    for (let i = 0; i < P.layers.length; i++) {
      const id = P.layers[i].id;
      if (!over[id] && isVisible(id)) drawLayer(i, false, fc.move[id], null);
      for (const pc of after[id] || []) {
        const j = pc.at ? P.lidx[pc.base] : i;
        if (j !== undefined) drawLayer(j, false, fc.move[pc.base], pc);
      }
      for (const j of overAt[id] || []) {
        if (isVisible(P.layers[j].id)) drawLayer(j, false, fc.move[P.layers[j].id], null);
      }
    }
  }

  /**
   * Alpha-accurate layer picking in canonical canvas coordinates (top-most opaque pixel wins!).
   */
  pickLayerAt(canonX, canonY, a = 0, exactIdx = null, hiddenIds = null, soloId = null, wear = null) {
    const P = this.P;
    if (!P) return -1;
    const key = this.keyAt(a, exactIdx);
    const hiddenByOutfit = new Set();
    for (const [g, o] of Object.entries(P.outfits || {})) {
      const w = wear && g in wear ? wear[g] : (o.default === false ? 0 : 1);
      if (w < 0.05) for (const id of o.hide || []) hiddenByOutfit.add(id);
    }

    for (let i = P.layers.length - 1; i >= 0; i--) {
      const L = P.layers[i], k = key.layers[i];
      if (!L || !k || k.op <= 0.02) continue;
      if (soloId && L.id !== soloId) continue;
      if (hiddenIds && hiddenIds.has(L.id)) continue;
      if (hiddenByOutfit.has(L.id)) continue;

      const Ai = inv2(k.A);
      const dx = canonX - k.t[0], dy = canonY - k.t[1];
      let gx = (Ai[0] * dx + Ai[1] * dy) / (L.w * 0.5);
      let gy = (Ai[2] * dx + Ai[3] * dy) / (L.h * 0.5);
      if (k.D && k.D.length) {
        const [ddx, ddy] = sampleD(k.D, gridSizeOf(k.D), gx, gy);
        gx += ddx; gy += ddy;
      }
      const u = (gx + 1) * 0.5, v = (gy + 1) * 0.5;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;

      const am = this.alphaMaps[L.id];
      if (!am) return i;
      const px = clamp(Math.floor(u * am.w), 0, am.w - 1);
      const py = clamp(Math.floor(v * am.h), 0, am.h - 1);
      if (am.alpha[py * am.w + px] > 28) return i;
    }
    return -1;
  }

  /**
   * Render a crisp face thumbnail dataURL for an expression card (restores viewport size cleanly).
   */
  renderExpressionThumb(faceName, w = 136, h = 92) {
    return this.renderExpressionThumbBatch([faceName], w, h)[0] || "";
  }

  /**
   * Render a batch of expression thumbnails with only ONE resize/FBO allocation round-trip.
   */
  renderExpressionThumbBatch(faceNames, w = 136, h = 92) {
    const P = this.P;
    if (!P || !faceNames || !faceNames.length) return [];
    const prevW = this.canvas.width, prevH = this.canvas.height;
    const prevPhysics = this.physics.enabled;
    this.physics.enabled = false;
    this.resize(w, h);
    const hc = P.head.centre, hr = P.head.radius;
    const rect = [hc[0] - hr * 1.15, hc[1] - hr * 0.78, hc[0] + hr * 1.15, hc[1] + hr * 0.78];
    const out = [];
    for (const faceName of faceNames) {
      try {
        this.render({ a: 0, pitch: 0, roll: 0, eyes: 1, face: faceName, wear: {} }, rect, 0, {
          bgColor: [0.09, 0.10, 0.13, 1],
        });
        out.push(this.canvas.toDataURL("image/webp", 0.85));
      } catch (err) {
        console.warn("Expression thumb failed:", faceName, err);
        out.push("");
      }
    }
    this.physics.enabled = prevPhysics;
    this.resize(prevW, prevH);
    return out;
  }

  /**
   * Capture a transparent portrait PNG (Uint8Array) for preview.png inside exported .l2d bundles.
   */
  async capturePreviewPNG(w = 600, h = 800) {
    const P = this.P;
    if (!P) return null;
    const prevW = this.canvas.width, prevH = this.canvas.height;
    const prevPhysics = this.physics.enabled;
    this.physics.enabled = false;
    this.resize(w, h);
    const rect = (P.views && P.views.bust) || [0, 0, P.canvas[0], P.canvas[1]];
    this.render({ a: 0, pitch: 0, roll: 0, eyes: 1, face: null, wear: {} }, rect, 0, { transparent: true });
    const blob = await new Promise((resolve) => this.canvas.toBlob(resolve, "image/png"));
    this.physics.enabled = prevPhysics;
    this.resize(prevW, prevH);
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }
}
