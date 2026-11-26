/* Layer2D Real-Time Rigid 3D Accessory Mesh Layer Renderer (WebGL2)
 * Renders any layer carrying a compact quantized `L.mesh3d` payload with:
 *   - 24-bit hardware Z-buffer depth testing + back-face culling (4x MSAA when supported)
 *   - Exact weak/true perspective 3D yaw & pitch locked to Layer2D head/torso motion chain
 *   - Crisp zoom-aware screen-space anime ink outline composited seamlessly under MSAA edges
 *   - Full native compatibility with Layer2D `clipMask`, `clipFbo`, and real-time `shadows`
 */
(function (root) {
  "use strict";

  const M3D_VS = `#version 300 es
  precision highp float;
  layout(location = 0) in vec3 aPos3;
  layout(location = 1) in vec2 aUv;
  layout(location = 2) in float aInner;

  uniform vec4 uView;
  uniform vec3 uPivot;
  uniform float uFocal;
  uniform float uYawRad;
  uniform float uPitchRad;
  uniform vec2 uYawShift;
  uniform vec3 uMove;      // (dx, dy, rotRad)
  uniform float uRoll;
  uniform vec2 uHeadPivot;
  uniform float uBreath;
  uniform float uSway;
  uniform vec2 uWaist;
  uniform float uBounce;
  uniform float uLean;
  uniform float uFootY;

  out vec2 vUv;
  out float vInner;

  vec2 rotGLSL(vec2 p, vec2 c, float a) {
    float co = cos(a), si = sin(a);
    vec2 d = p - c;
    return c + vec2(co * d.x + si * d.y, -si * d.x + co * d.y);
  }

  void main() {
    float cy = cos(uYawRad), sy = sin(uYawRad);
    float cp = cos(uPitchRad), sp = sin(uPitchRad);

    vec3 p = aPos3;
    // Pitch around X (pitch > 0 tilts front +z upward -y)
    float y1 = p.y * cp - p.z * sp;
    float z1 = p.y * sp + p.z * cp;
    // Yaw around Y (yaw < 0 turns front +z viewer-left -x)
    float x2 = p.x * cy + z1 * sy;
    float z2 = -p.x * sy + z1 * cy;
    float y2 = y1;

    float persp = uFocal / max(400.0, uFocal - z2);
    vec2 c = vec2(
      uPivot.x + uYawShift.x + x2 * persp,
      uPivot.y + uYawShift.y + y2 * persp
    );

    // Optional expression layer move (around mesh pivot)
    if (uMove.z != 0.0) c = rotGLSL(c, uPivot.xy, uMove.z);
    c += uMove.xy;

    // Exact Layer2D forward head/torso motion chain (roll -> breath -> sway -> bounce -> lean)
    if (uRoll != 0.0) c = rotGLSL(c, uHeadPivot, uRoll);
    if (uBreath != 1.0) c.y = uWaist.y + (c.y - uWaist.y) * uBreath;
    if (uSway != 0.0) c = rotGLSL(c, uWaist, uSway);
    c.y += uBounce;
    c.x += uLean * (uFootY - c.y);

    vec2 n = (c - uView.xy) / max(vec2(1e-4), uView.zw - uView.xy);
    // Larger z2 is closer to camera -> smaller NDC z passes gl.LEQUAL depth test
    float ndcZ = clamp(-z2 / 550.0, -0.98, 0.98);
    gl_Position = vec4(n.x * 2.0 - 1.0, 1.0 - n.y * 2.0, ndcZ, 1.0);
    vUv = aUv;
    vInner = aInner;
  }`;

  const M3D_FS = `#version 300 es
  precision highp float;
  in vec2 vUv;
  in float vInner;
  out vec4 oCol;

  uniform sampler2D uTex;
  uniform vec3 uInnerColor;

  void main() {
    vec4 t = texture(uTex, vUv);
    if (t.a < 0.45) discard;
    if (vInner > 0.5) {
      oCol = vec4(uInnerColor, 1.0);
    } else {
      // Textures in Layer2D are uploaded premultiplied -> recover crisp opaque RGB
      vec3 col = clamp(t.rgb / max(t.a, 0.001), 0.0, 1.0);
      oCol = vec4(col, 1.0);
    }
  }`;

  const COMP_VS = `#version 300 es
  in vec2 aPos;
  out vec2 vUv;
  void main() {
    vUv = aPos;
    gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
  }`;

  const COMP_FS = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 oCol;

  uniform sampler2D uMeshTex;
  uniform sampler2D uClipTex;
  uniform vec2 uTexel;
  uniform float uOutlineRad;
  uniform vec3 uOutlineColor;
  uniform float uOp;
  uniform int uAlphaOnly;
  uniform int uClipOn;
  uniform float uClipMix;

  void main() {
    vec4 c = texture(uMeshTex, vUv);
    float ringA = c.a;

    if (uOutlineRad > 0.05 && c.a < 0.995) {
      // 12-tap outer ring + 6-tap inner ring for silky uniform anti-aliased anime ink contour
      const vec2 D12[12] = vec2[12](
        vec2( 1.0000,  0.0000), vec2( 0.8660,  0.5000), vec2( 0.5000,  0.8660),
        vec2( 0.0000,  1.0000), vec2(-0.5000,  0.8660), vec2(-0.8660,  0.5000),
        vec2(-1.0000,  0.0000), vec2(-0.8660, -0.5000), vec2(-0.5000, -0.8660),
        vec2( 0.0000, -1.0000), vec2( 0.5000, -0.8660), vec2( 0.8660, -0.5000)
      );
      vec2 stepOut = uTexel * uOutlineRad;
      vec2 stepMid = uTexel * (uOutlineRad * 0.52);
      float mx = c.a;
      for (int i = 0; i < 12; i++) {
        mx = max(mx, texture(uMeshTex, vUv + D12[i] * stepOut).a);
      }
      for (int i = 0; i < 12; i += 2) {
        mx = max(mx, texture(uMeshTex, vUv + D12[i] * stepMid).a);
      }
      ringA = mx;
    }

    float olA = smoothstep(0.16, 0.72, ringA);
    vec4 ol = vec4(uOutlineColor * olA, olA);
    // Premultiplied-over: MSAA surface sits cleanly over crisp outline (zero interior bleed)
    vec4 comp = c + ol * (1.0 - c.a);

    if (uClipOn > 0) {
      float ca = texture(uClipTex, vUv).a;
      float m = uClipOn == 2 ? (1.0 - ca) : ca;
      comp *= mix(1.0, m, uClipMix);
    }

    comp *= uOp;
    if (comp.a <= 0.001) discard;
    if (uAlphaOnly > 0) {
      oCol = vec4(0.0, 0.0, 0.0, comp.a);
    } else {
      oCol = comp;
    }
  }`;

  function compileShader(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`Mesh3D shader compile error: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  }

  function linkProgram(gl, vsSrc, fsSrc, attribs) {
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fsSrc));
    for (const [loc, name] of attribs) gl.bindAttribLocation(p, loc, name);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`Mesh3D program link error: ${gl.getProgramInfoLog(p)}`);
    }
    const U = Object.create(null);
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      U[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
    }
    return { prog: p, U };
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function createMesh3D(gl) {
    const m3d = linkProgram(gl, M3D_VS, M3D_FS, [
      [0, "aPos3"],
      [1, "aUv"],
      [2, "aInner"],
    ]);
    const comp = linkProgram(gl, COMP_VS, COMP_FS, [[0, "aPos"]]);

    const prevInitVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    const quadVao = gl.createVertexArray();
    gl.bindVertexArray(quadVao);
    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(prevInitVao);

    const maxSamples = gl.getParameter(gl.MAX_SAMPLES) || 0;
    const msaaSamples = Math.min(4, maxSamples);

    const cache = new WeakMap();
    const fboState = {
      w: 0,
      h: 0,
      useMsaa: msaaSamples >= 2,
      msaaFb: null,
      msaaCol: null,
      msaaDepth: null,
      resFb: null,
      resTex: null,
      resDepth: null,
    };

    function ensureFbo(W, H) {
      W = Math.max(1, Math.round(W));
      H = Math.max(1, Math.round(H));
      if (fboState.w === W && fboState.h === H && fboState.resFb) return;
      fboState.w = W;
      fboState.h = H;

      if (!fboState.resFb) {
        fboState.resFb = gl.createFramebuffer();
        fboState.resTex = gl.createTexture();
      }
      gl.bindTexture(gl.TEXTURE_2D, fboState.resTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

      gl.bindFramebuffer(gl.FRAMEBUFFER, fboState.resFb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboState.resTex, 0);

      if (fboState.useMsaa) {
        if (!fboState.msaaFb) {
          fboState.msaaFb = gl.createFramebuffer();
          fboState.msaaCol = gl.createRenderbuffer();
          fboState.msaaDepth = gl.createRenderbuffer();
        }
        gl.bindRenderbuffer(gl.RENDERBUFFER, fboState.msaaCol);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, msaaSamples, gl.RGBA8, W, H);
        gl.bindRenderbuffer(gl.RENDERBUFFER, fboState.msaaDepth);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, msaaSamples, gl.DEPTH_COMPONENT24, W, H);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboState.msaaFb);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, fboState.msaaCol);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, fboState.msaaDepth);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          fboState.useMsaa = false;
        }
      }

      if (!fboState.useMsaa) {
        if (!fboState.resDepth) fboState.resDepth = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, fboState.resDepth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboState.resFb);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, fboState.resDepth);
      }

      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    function ensureGpuMesh(spec) {
      let g = cache.get(spec);
      if (g) return g;

      const posBytes = b64ToBytes(spec.posB64);
      const posI16 = new Int16Array(posBytes.buffer, posBytes.byteOffset, posBytes.byteLength >> 1);
      const posScale = spec.posScale || 0.05;
      const posF32 = new Float32Array(posI16.length);
      for (let i = 0; i < posI16.length; i++) posF32[i] = posI16[i] * posScale;

      const uvBytes = b64ToBytes(spec.uvB64);
      const uvU16 = new Uint16Array(uvBytes.buffer, uvBytes.byteOffset, uvBytes.byteLength >> 1);
      const uvF32 = new Float32Array(uvU16.length);
      for (let i = 0; i < uvU16.length; i++) uvF32[i] = uvU16[i] / 65535.0;

      const innBytes = b64ToBytes(spec.innerB64);
      const innF32 = new Float32Array(innBytes.length);
      for (let i = 0; i < innBytes.length; i++) innF32[i] = innBytes[i] > 0 ? 1.0 : 0.0;

      const idxBytes = b64ToBytes(spec.idxB64);
      const idxU16 = new Uint16Array(idxBytes.buffer, idxBytes.byteOffset, idxBytes.byteLength >> 1);

      const prevMeshVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      const posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, posF32, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

      const uvBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, uvF32, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

      const innBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, innBuf);
      gl.bufferData(gl.ARRAY_BUFFER, innF32, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

      const idxBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxU16, gl.STATIC_DRAW);

      gl.bindVertexArray(prevMeshVao);
      g = { vao, posBuf, uvBuf, innBuf, idxBuf, count: idxU16.length };
      cache.set(spec, g);
      return g;
    }

    /**
     * Render a `L.mesh3d` layer into the currently bound destination framebuffer (`targetFb`).
     * Preserves caller's program, VAO, blend mode, and framebuffer binding upon return.
     */
    function draw(opts) {
      const {
        spec,
        texObj,
        vw,
        W,
        H,
        m,
        head,
        motion,
        effOp,
        alphaOnly,
        move,
        clipOn,
        clipMix,
        clipTex,
        targetFb,
        restoreProg,
        restoreVao,
      } = opts;
      if (!spec || !texObj || effOp <= 0.0005) return false;

      ensureFbo(W, H);
      const gm = ensureGpuMesh(spec);

      // ---- Pass A: Hardware 24-bit Z-Buffer 3D Render into offscreen MSAA/Resolve FBO ----
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboState.useMsaa ? fboState.msaaFb : fboState.resFb);
      gl.viewport(0, 0, W, H);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(gl.CCW);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const a = m.a || 0;
      const pitch = m.pitch || 0;
      const piv = spec.pivot || [1200, 486, 0];
      const yawRad = a * (spec.maxYaw ?? 0.6);
      const pitchRad = pitch * (spec.maxPitch ?? 0.145);
      const shiftX = -a * (spec.yawShiftX || 0);
      const shiftY = Math.abs(a) * (spec.yawShiftY || 0);
      const innerCol = spec.innerColor || [0.10, 0.11, 0.14];
      const headPivot = (head && head.pivot) || [piv[0], piv[1] + 200];
      const waist = (motion && motion.waist) || [piv[0], piv[1] + 1200];
      const roll = ((motion && motion.roll0) || 0) + (m.roll || 0);

      gl.useProgram(m3d.prog);
      gl.bindVertexArray(gm.vao);
      gl.uniform4f(m3d.U.uView, vw[0], vw[1], vw[2], vw[3]);
      gl.uniform3f(m3d.U.uPivot, piv[0], piv[1], piv[2] || 0);
      gl.uniform1f(m3d.U.uFocal, spec.focal || 2400.0);
      gl.uniform1f(m3d.U.uYawRad, yawRad);
      gl.uniform1f(m3d.U.uPitchRad, pitchRad);
      gl.uniform2f(m3d.U.uYawShift, shiftX, shiftY);
      if (move) {
        gl.uniform3f(m3d.U.uMove, move[0] || 0, move[1] || 0, ((move[2] || 0) * Math.PI) / 180.0);
      } else {
        gl.uniform3f(m3d.U.uMove, 0, 0, 0);
      }
      gl.uniform1f(m3d.U.uRoll, roll);
      gl.uniform2f(m3d.U.uHeadPivot, headPivot[0], headPivot[1]);
      gl.uniform1f(m3d.U.uBreath, m.breath || 1.0);
      gl.uniform1f(m3d.U.uSway, m.sway || 0);
      gl.uniform2f(m3d.U.uWaist, waist[0], waist[1]);
      gl.uniform1f(m3d.U.uBounce, m.bounce || 0);
      gl.uniform1f(m3d.U.uLean, m.lean || 0);
      gl.uniform1f(m3d.U.uFootY, (motion && motion.footY) || 4000);
      gl.uniform3f(m3d.U.uInnerColor, innerCol[0], innerCol[1], innerCol[2]);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texObj);
      gl.uniform1i(m3d.U.uTex, 0);

      gl.drawElements(gl.TRIANGLES, gm.count, gl.UNSIGNED_SHORT, 0);

      if (fboState.useMsaa) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fboState.msaaFb);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fboState.resFb);
        gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      }

      // ---- Pass B: Crisp Screen-Space Anime Ink Outline + ClipMask Composite ----
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFb || null);
      gl.viewport(0, 0, W, H);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      const pxPerCan = W / Math.max(1.0, vw[2] - vw[0]);
      const baseOutline = spec.outlinePx ?? 2.1;
      const outlineRad = alphaOnly ? 0.0 : Math.max(1.15, Math.min(3.8, baseOutline * pxPerCan * 1.45));
      const outCol = spec.outlineColor || [0.08, 0.09, 0.12];

      gl.useProgram(comp.prog);
      gl.bindVertexArray(quadVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fboState.resTex);
      gl.uniform1i(comp.U.uMeshTex, 0);
      gl.uniform2f(comp.U.uTexel, 1.0 / W, 1.0 / H);
      gl.uniform1f(comp.U.uOutlineRad, outlineRad);
      gl.uniform3f(comp.U.uOutlineColor, outCol[0], outCol[1], outCol[2]);
      gl.uniform1f(comp.U.uOp, effOp);
      gl.uniform1i(comp.U.uAlphaOnly, alphaOnly ? 1 : 0);
      if (clipOn && clipTex) {
        gl.uniform1i(comp.U.uClipOn, clipOn);
        gl.uniform1f(comp.U.uClipMix, clipMix ?? 1.0);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, clipTex);
        gl.uniform1i(comp.U.uClipTex, 2);
      } else {
        gl.uniform1i(comp.U.uClipOn, 0);
        gl.uniform1f(comp.U.uClipMix, 0.0);
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Restore caller WebGL2 program & quad VAO cleanly
      if (restoreProg) gl.useProgram(restoreProg);
      if (restoreVao !== undefined) gl.bindVertexArray(restoreVao);
      return true;
    }

    return { draw, ensureGpuMesh };
  }

  root.Layer2DMesh3D = { createMesh3D };
})(typeof window !== "undefined" ? window : globalThis);
