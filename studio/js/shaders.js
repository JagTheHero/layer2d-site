// Exact WebGL2 shaders extracted from viewer/index.html for 1:1 Player/Studio parity.
export const VS = `#version 300 es
in vec2 aPos; uniform vec4 uBox; uniform vec4 uView; out vec2 vC;
void main() {
  vec2 c = mix(uBox.xy, uBox.zw, aPos); vC = c;
  vec2 n = (c - uView.xy) / (uView.zw - uView.xy);
  gl_Position = vec4(n.x * 2.0 - 1.0, 1.0 - n.y * 2.0, 0.0, 1.0);
}`;

// Screen -> the layer's texture, outermost warp first (motion.MotionRig.deform, then turn.TurnRig.deform, then the
// fit's placement, warp grid and the earrings' swing), as the Python renderer does it.
export const FS = `#version 300 es
precision highp float;
in vec2 vC; out vec4 oCol;
uniform sampler2D uTex, uHole, uClip, uWipeTex, uOpenTex, uBehindA, uBehindB; uniform highp sampler2D uSkirt;
uniform float uBehind;                                 // an earring on the far side: cut where her face and neck cover it
uniform vec2 uBehindShift;                             // (her left lock: where they cover it this far out, screen px)
uniform int uRigid; uniform vec2 uRigidD;              // an earring turns as its hook does, unbent (its foot hung below the chin)
uniform int uKind, uHair, uHasD, uGD, uHook, uVis, uHead, uJaw, uNoFade, uHasHole, uHasWipe, uClipOn, uAlphaOnly, uSkirtN;
uniform ivec3 uFInfo;                                  // forward mesh grid stored in uChains rows uFInfo.z..: (hasF, gd, fBase)
uniform mat2 uAi; uniform vec2 uT, uHalf;
uniform vec2 uD[121];
uniform float uOp, uHoleS, uWipe, uWipeSoft, uTurn, uPitch, uPitchScale, uJawV, uSign, uChinW;
uniform vec2 uChinAt; uniform vec3 uChinWide;          // turn.TurnRig.chin_at(); CHIN_RISE, CHIN_REACH, CHIN_BELOW
uniform vec4 uBodyDepth;                               // its turn above y0, below y1, y0, y1
uniform vec3 uHookV; uniform mat2 uVisA; uniform vec2 uVisT; uniform vec2 uVisL, uVisV;
uniform vec4 uVisR[24];                                // an ear's rows (motion.EAR_ROWS): inner edge, outer edge, slide
uniform int uEye; uniform mat2 uEyeA; uniform vec2 uEyeT, uEyeX; uniform vec4 uEyeC; uniform float uEyeO, uEyeK, uOpenMix;
uniform vec3 uEyeR[24];                                // an eye's columns (export.EYE_COLS): sclera top, bottom, lid lift
uniform vec2 uEyeS[24]; uniform int uEyeLid;           // (opt-in, export "shut") ...and the lid's drop to the closed eye,
uniform float uEyeLo;                                  // its line; how far up to it the lower lid has come (LID)
uniform float uLean, uBounce, uSway, uBreath, uBody, uRoll, uArm, uFootY, uLegTop;
uniform vec2 uWaist, uShoulder, uPivot;
uniform vec4 uHairV; uniform highp sampler2D uLocks; uniform int uLockN; uniform float uLockSigma; uniform vec2 uSkirtDZ; uniform vec2 uSkirtY; uniform float uSkirtY0;
uniform vec2 uC, uEU, uEV, uTwist; uniform float uR, uChin, uNeck, uJawNear, uBodyC, uBodyR, uEarSoft;
uniform vec2 uCanvas;
uniform vec2 uAxis; uniform vec4 uSeam; uniform float uSew, uShoulderDX, uStretch;
uniform vec2 uBreast, uBreastR; uniform vec4 uBreastC; // motion.BREASTS: their push (px), its falloff, both centres
uniform vec2 uPatchA, uPatchB, uPatchC, uPatchAt; uniform float uPatchF;   // breasts.rigid: a piece on them carried whole
uniform vec2 uSlv; uniform vec4 uHem;                  // motion.SLEEVES: the hem's push (along, across), s0, k, span, below
uniform vec2 uTurnBody, uTurnFade;                     // motion.TURN_BODY: the neck and shoulders' slide at this turn, its fade
uniform int uRelOn; uniform mat2 uRelA; uniform vec2 uRelT, uRelHalf; uniform float uReveal;
uniform vec4 uAtlas;                                   // the part of its texture a piece samples (a flipbook's frame)
uniform float uRaise, uLegA, uSkirtYW; uniform vec2 uJoint, uHip, uFlare;   // the full body's moves: RAISE, legs, FLARE
uniform vec2 uRAxis, uRShift;                          // the arm's axis as drawn (a raised sleeve's: turned up as far),
                                                       // the shoulder's lift with the raise (less a raised sleeve's own)
uniform vec2 uCuff;                                    // under raised sleeves: the upper arm cut short of x out, by y
uniform vec4 uRise[2]; uniform vec2 uRiseDir[2];      // raised, her shoulders rise up each seam (R, L): from its top (x, y),
                                                       // this far up, running out this far in (export: "rise"); its way up
const float RISE_FADE = 120.0;                         // ...and down from the seam's top over this far (canon px)
const float RISE_OUT = 120.0;                          // (a raised sleeve's: and out from it over this far)
uniform float uRiseBy, uRWin;                          // a raised sleeve's own: its shoulder's rise to the shirt's; RAISE's
                                                       // ease round the joint ends at this angle (its seam's top)
uniform float uElbow; uniform vec2 uElbowAt, uElbowAx; // the puppet's elbow: its bend, the elbow and down the upper arm,
uniform int uElbowFar;                                 // raised as the arm is (motion.ELBOW); the layer lies below it
uniform int uElbowHalf;                                // (opt-in, motion.elbowHalf) a sleeve cut in two at the elbow, bent:
                                                       // 1 its upper arm's piece, 2 its forearm's (each only its own side)
uniform vec3 uElbowLine;                               // (opt-in, motion.elbowLine) the arm's outline colour, for the cut
uniform float uElbowLW;                                // (opt-in, elbowLine's 4th value) the rounded cuts' line, px (the
                                                       // drawing's own width; 0 = the thin default)
uniform vec2 uElbowFx;                                 // down the forearm as drawn (to motion.HAND: not straight on)
uniform vec4 uElbowRU; uniform vec3 uElbowRF;          // (opt-in, motion.elbowRound) the outer edges by the elbow, as
                                                       // raised (n, d), upper arm and forearm; RU.w the radius (0: off)
uniform vec2 uElbowIn;                                 // (opt-in, their lines' 4th) how far inside them each is drawn
uniform float uElbowLet;                               // (opt-in, elbowRound.let; 0.15 unset) how fast each line lets out
                                                       // off the elbow, px a px (a sleeve wider toward the shoulder than its
                                                       // line, bent outward, lost its drawn outline to a long straight cut)
uniform vec3 uElbowCU, uElbowCF;                       // (opt-in, elbowRound's 5th-8th lines) the pieces' own edges inside
                                                       // the bend, as drawn and raised (n, d; n 0: none): upper arm, forearm
uniform vec3 uElbowKU, uElbowKF;                       // (opt-in, elbowRound.over) the same of the garment worn over it
uniform float uWrist; uniform vec2 uWristAt, uWristAx;  // motion.wrist: the hand's bend (as rot), its wrist, down the forearm
uniform vec2 uLegP, uShin;                             // a step: the thigh's and the shin's pitch toward the camera
                                                       // (radians); the knee and ankle (motion.SHIN)
uniform vec2 uArmP;                                    // the arm's swing toward the camera, its forearm's further
uniform vec2 uSkirtP;                                  // the skirt's over each thigh (R, L), pushed by it
uniform vec3 uCam;                                     // the walk's camera: middle x, eye height y, distance (canon px)
uniform float uDrop;                                   // the walk's: her hips (and all of her) lowered this far
// The elbow bends about a point IN px in from the arm's middle, toward the way it bends, mitred: what lies past the
// bend's bisector is the forearm turned by all of it, the rest the upper arm as it is, so the outside comes to a point
// and the inside to a crease. (Eased in over a band either side, its outside swept round as a hose, with the upper
// arm's tip smeared over it white; rounded instead of coming to an elbow, a white seam.) The point reaches TIP px
// from the pivot at most, cut square across beyond (bent far, it ran out as a spike twice the arm's width). The bisector
// is of the arm as it lies, upper arm and forearm (drawn a little bent already: taken as straight, a slight bend met in
// a shelf). The cut is a rounded point, ELBOW_ROUND px its radius at the tip (cut straight across, folded all the way
// the elbow ended square)
const float ELBOW_IN = 20.0, ELBOW_TIP = 100.0, ELBOW_ROUND = 30.0, ELBOW_LAP = 60.0;   // (LAP: elbowHalf, the inner overlap)
const float ELBOW_FADE = 0.2;                          // (elbowHalf, elbowRound: the bend, radians, what they cut off
                                                       // fades out over, their lines in)
const float ELBOW_FAR = 80.0;                          // (elbowRound: a forearm's edge, past this far or its round's join,
                                                       // let out)
const vec2 WRIST_BEND = vec2(18.0, 22.0);              // px above and below the wrist the hand's bend comes in over
uniform vec2 uWristBend;                                // (opt-in) a hand piece's own (its "bendZone"; 0: WRIST_BEND)
uniform int uTint; uniform vec3 uTintFrom, uTintTo;   // export.TINT: her hair re-tinted from its base to another (OKLab)
uniform vec2 uTintC;                                   // (chroma from which a texel is dye or sheen, not hair: kept)
uniform vec3 uEyeFrom, uEyeTo;                         // export.EYE_TINT: her irises from their base to another (OKLab)
// Opt-in (packs from meshpack.py, nothing here runs without them): the pack's spring chains bending the layers of their
// group, a row each in uChains (joints, two a texel; their moves, two a texel; the count), each point moved as the
// nearest point of each bound chain is, Gaussian on the distance; and see-through fabric with a borealis curtain over it
#define MAX_CHAINS 8
uniform highp sampler2D uChains; uniform int uChainN, uChainIds[MAX_CHAINS]; uniform float uChainSigma;
uniform int uSheerOn; uniform sampler2D uSheerTex; uniform float uSheerOp, uBoreal, uTime;
vec2 chainShift(vec2 p) {
  vec2 mv = vec2(0.0); float gs = 0.0; bool sw = false;
  for (int c = 0; c < MAX_CHAINS; c++) {
    if (c >= uChainN) break;
    int i = uChainIds[c], n = int(texelFetch(uChains, ivec2(6, i), 0).x);
    bool swing = texelFetch(uChains, ivec2(6, i), 0).y > 0.5;
    sw = sw || swing;
    vec2 a = texelFetch(uChains, ivec2(0, i), 0).xy, da = texelFetch(uChains, ivec2(3, i), 0).xy, bd = vec2(0.0);
    float best = 1e20;
    for (int j = 1; j < 6; j++) {
      if (j >= n) break;
      vec4 q = texelFetch(uChains, ivec2(j / 2, i), 0), r = texelFetch(uChains, ivec2(3 + j / 2, i), 0);
      vec2 b = j % 2 == 0 ? q.xy : q.zw, db = j % 2 == 0 ? r.xy : r.zw, v = b - a;
      if (swing) {             // (opt-in: a hanging chain, rig.json chain_hang) its moves too big for the rest-chain lookup
        // below (a wrist's ribbon turned back down a quarter turn from the arm): the nearest point on the MOVED chain,
        // and the pixel taken back through that segment's own turn to where it lies on the drawing
        vec2 A = a + da, V = b + db - A;
        float t = clamp(dot(p - A, V) / dot(V, V), 0.0, 1.0); vec2 e = p - A - t * V;
        if (dot(e, e) < best) {
          best = dot(e, e);
          float ang = atan(v.y, v.x) - atan(V.y, V.x), cs = cos(ang), sn = sin(ang);
          bd = p - (a + t * v + vec2(cs * e.x - sn * e.y, sn * e.x + cs * e.y));
        }
      } else {
        float t = clamp(dot(p - a, v) / dot(v, v), 0.0, 1.0); vec2 e = p - a - t * v;
        if (dot(e, e) < best) { best = dot(e, e); bd = mix(da, db, t); }
      }
      a = b; da = db;
    }
    float g = exp(-0.5 * best / (uChainSigma * uChainSigma));
    mv += g * bd; gs += g;
  }
  // (a hanging chain: its layer is only the ribbon, and a pixel off the ribbon where it has swung to takes nothing,
  // or the ribbon would still be drawn where it lay along the arm as well)
  if (sw) return gs > 0.2 ? mv / gs : p + vec2(1e6);
  return gs > 1e-6 ? mv / gs * clamp(gs / 0.15, 0.0, 1.0) : vec2(0.0);
}
// Forward vertex mesh deformation F(t) stored in uChains rows [fBase .. fBase+gd-1]: exact damped 2D Newton inversion of t + F(t) = g
vec2 evalFGrid(vec2 t, int gd, int fBase, out mat2 J) {
  float n = float(gd - 1);
  float s = 0.5 * n;
  vec2 u = clamp((t + 1.0) * s, 0.0, n);
  ivec2 i0 = min(ivec2(floor(u)), ivec2(gd - 2));
  ivec2 i1 = i0 + 1;
  vec2 f = clamp(u - vec2(i0), 0.0, 1.0);
  vec2 f00 = texelFetch(uChains, ivec2(i0.x, fBase + i0.y), 0).xy;
  vec2 f10 = texelFetch(uChains, ivec2(i1.x, fBase + i0.y), 0).xy;
  vec2 f01 = texelFetch(uChains, ivec2(i0.x, fBase + i1.y), 0).xy;
  vec2 f11 = texelFetch(uChains, ivec2(i1.x, fBase + i1.y), 0).xy;
  vec2 fx0 = mix(f00, f10, f.x), fx1 = mix(f01, f11, f.x);
  vec2 val = mix(fx0, fx1, f.y);
  vec2 dFdx = mix(f10 - f00, f11 - f01, f.y) * s;
  vec2 dFdy = mix(f01 - f00, f11 - f10, f.x) * s;
  if (abs(t.x) > 1.0) dFdx = vec2(0.0);
  if (abs(t.y) > 1.0) dFdy = vec2(0.0);
  J = mat2(1.0 + dFdx.x, dFdx.y, dFdy.x, 1.0 + dFdy.y);
  return val;
}
vec2 invertForwardGrid(vec2 g, int gd, int fBase) {
  mat2 J;
  vec2 t = g - evalFGrid(g, gd, fBase, J);
  for (int it = 0; it < 7; it++) {
    vec2 err = (t + evalFGrid(t, gd, fBase, J)) - g;
    if (dot(err, err) < 1e-10) break;
    float det = J[0][0] * J[1][1] - J[1][0] * J[0][1];
    vec2 stp = abs(det) > 0.05
      ? vec2(J[1][1] * err.x - J[1][0] * err.y, -J[0][1] * err.x + J[0][0] * err.y) / det
      : 0.35 * err;
    float sl = length(stp);
    if (sl > 0.45) stp *= 0.45 / sl;
    t -= stp;
  }
  return t;
}
vec3 boreal(float x) {                                 // mint, sky, lavender, pink, round again
  vec3 a = vec3(0.62, 0.98, 0.86), b = vec3(0.66, 0.84, 1.0), c = vec3(0.80, 0.70, 1.0), d = vec3(1.0, 0.76, 0.93);
  x = fract(x) * 4.0;
  return x < 1.0 ? mix(a, b, x) : x < 2.0 ? mix(b, c, x - 1.0) : x < 3.0 ? mix(c, d, x - 2.0) : mix(d, a, x - 3.0);
}
// (opt-in, the pack's sheer.sky) procedural atmospheric sky shimmer inside sheer cloth: a camera looks
// north and up through the canvas rectangle sky.frame, and a cloth point sees what its ray meets climbing through the
// aurora, each point of it followed down its field line (dip 77 deg) to its 105 km footprint. The arcs (thin sheets:
// uSkyArcs holds each one's north km, slope and brightness along east km, drawn each frame by SKY_ARC) light the ray
// where it crosses them, with field-aligned rays from the footprint noise there, as the Lazarev deposition profile says
// at that height (oxygen green 557.7 nm, N2 pink-violet); the diffuse aurora and the red 630 nm, both smooth, are
// marched through the footprint map SKY_MAP draws
uniform int uSky; uniform sampler2D uSkyMap, uSkyN; uniform highp sampler2D uSkyProf, uSkyArcs, uSkyLut;
uniform mat3 uSkyCam;                                  // the camera's forward, right, up (km east, north, up)
uniform vec4 uSkyGeo, uSkyMarg, uSkyFrame, uSkyK, uSkyK2;   // (focal px, frame W, H, camera height km), (the map's
                                                       // margins left, top, its W, H), the canvas rect, (act, storm, gain,
                                                       // exposure), (time, mix, glow, debug)
uniform vec2 uSkyArcX;                                 // uSkyArcs' first east km, km a texel
#define SKY_N 28
const float SKY_RE = 6371.0, SKY_H0 = 105.0, SKY_SD = 0.97437, SKY_CD = 0.22495;   // sin, cos of the dip
float skyRes = 1.0;                                    // how well a screen px resolves the rays (rays_tex's res)
vec3 skyRay(vec2 cp) {                                 // a canvas point's view ray
  vec2 X = (cp - uSkyFrame.xy) / (uSkyFrame.zw - uSkyFrame.xy) * uSkyGeo.yz - 0.5 * uSkyGeo.yz;
  return normalize(uSkyCam[0] + X.x / uSkyGeo.x * uSkyCam[1] - X.y / uSkyGeo.x * uSkyCam[2]);
}
float sphereT(float a, float h, float z) {             // the distance along a ray (a: its sine of elevation) from height h
  float q = (z - h) * (2.0 * SKY_RE + z + h);          // up to altitude z, over a round Earth
  return q / (sqrt(max(q + (SKY_RE + h) * (SKY_RE + h) * a * a, 0.0)) + (SKY_RE + h) * a);
}
vec3 skyFoot(vec3 d, float z) {                        // the ray's point at altitude z, down its field line to 105 km
  vec3 P = d * sphereT(d.z, uSkyGeo.w, z); P.z += uSkyGeo.w;
  vec3 u = vec3(P.xy, P.z + SKY_RE) / (SKY_RE + z);
  vec3 n = vec3(-u.y * u.x, 1.0 - u.y * u.y, -u.y * u.z) / sqrt(max(1.0 - u.y * u.y, 1e-6));
  return P - (z - SKY_H0) / SKY_SD * (SKY_SD * u - SKY_CD * n);
}
vec2 skyProj(vec3 F) {                                 // a point -> the footprint map's px
  vec3 v = F - vec3(0.0, 0.0, uSkyGeo.w); float zc = max(dot(v, uSkyCam[0]), 1e-3);
  return vec2(dot(v, uSkyCam[1]), -dot(v, uSkyCam[2])) / zc * uSkyGeo.x + 0.5 * uSkyGeo.yz + uSkyMarg.xy;
}
vec4 skyArc(int k, float x) {                          // arc k at x km east: its north km, slope, brightness
  float u = clamp((x - uSkyArcX.x) / uSkyArcX.y, 0.0, 2046.999); int i = int(u);
  return mix(texelFetch(uSkyArcs, ivec2(i, k), 0), texelFetch(uSkyArcs, ivec2(i + 1, k), 0), u - float(i));
}
vec4 skyProfAt(float z) {                              // green soft, hard; N2 soft, hard (per km) at altitude z
  float u = clamp((z - 80.0) / 0.5, 0.0, 699.999); int i = int(u);
  return mix(texelFetch(uSkyLut, ivec2(i, 0), 0), texelFetch(uSkyLut, ivec2(i + 1, 0), 0), u - float(i));
}
vec3 skyLight(vec2 cp) {                               // the aurora's light at a canvas point (sRGB, graded as the MV)
  vec3 d = skyRay(cp);
  if (d.z < 0.002) return vec3(0.0);
  float t = uSkyK2.x, act = uSkyK.x;
  vec3 em = vec3(0.0);
  // the arcs: a ray's footprints run north as it climbs, so it crosses a sheet at most about once between two of these
  const float ZB[7] = float[7](82.0, 92.0, 104.0, 120.0, 145.0, 185.0, 260.0);
  vec3 FB[7];
  for (int j = 0; j < 7; j++) FB[j] = skyFoot(d, ZB[j]);
  for (int k = 0; k < 3; k++) {
    float ga = FB[0].y - skyArc(k, FB[0].x).x;
    for (int j = 1; j < 7; j++) {
      float gb = FB[j].y - skyArc(k, FB[j].x).x;
      if (ga < 0.0 && gb >= 0.0) {                     // crossed: where (false position, Illinois)
        float za = ZB[j - 1], zb = ZB[j], a0 = ga, b0 = gb, z = za; int side = 0;
        for (int i = 0; i < 6; i++) {
          z = za + (zb - za) * a0 / (a0 - b0);
          vec3 F = skyFoot(d, z); float g = F.y - skyArc(k, F.x).x;
          if (g < 0.0) { za = z; a0 = g; if (side == -1) b0 *= 0.5; side = -1; }
          else { zb = z; b0 = g; if (side == 1) a0 *= 0.5; side = 1; }
        }
        z = za + (zb - za) * a0 / (a0 - b0);
        vec3 F = skyFoot(d, z), F0 = skyFoot(d, z - 1.0), F1 = skyFoot(d, z + 1.0); vec4 A = skyArc(k, F.x);
        // a sheet ~1 km thick crossed: its light is its brightness over how fast the ray runs across it (km across
        // per km of ray), at that height; its fainter ~5 km skirt spreads it a little up and down the curtain
        float gz = max(abs(F1.y - skyArc(k, F1.x).x - F0.y + skyArc(k, F0.x).x) / 2.0 / sqrt(1.0 + A.y * A.y), 0.05);
        float dzds = 2.0 / max(sphereT(d.z, uSkyGeo.w, z + 1.0) - sphereT(d.z, uSkyGeo.w, z - 1.0), 1e-3);
        // (a ray grazing a sheet runs a few km in it, not more: capped smoothly, or the folds' grazing lines flare)
        float path = inversesqrt(gz * gz * dzds * dzds + 0.16), w = min(5.0 / gz, 30.0);
        // field-aligned rays: two layers drifting east and west ~10 km/s, and clusters (rays_tex; their fine ones fade
        // where a screen px can't hold them, skyRes, so they're looked up at full detail: in this branch a texture's own
        // detail level is undefined and drew lines where neighbouring px crossed in other spans)
        float ra = textureLod(uSkyN, (F.xy + vec2(9.0 * t, 0.0)) / 256.0, 0.0).r;
        float rb = textureLod(uSkyN, ((F.xy - vec2(6.0 * t, 0.0)) / 0.5 + vec2(300.0, 77.0)) / 512.0, 0.0).g;
        float rm = textureLod(uSkyN, (F.xy + vec2(2.0 * t, 0.0)) / 1024.0, 0.0).b;
        float rt = max(1.0 + (0.12 + 0.15 * act) * rm + (0.12 + 0.2 * act) * skyRes * (ra + rb) / 1.414, 0.05);
        float hard = clamp(act + 0.35 * textureLod(uSkyN, vec2(F.x / 90.0 + t * 0.02, F.y / 90.0 + 50.0) * 12.0 / 512.0,
                           0.0).a + 0.05 * (rt - 1.0), 0.0, 1.0);
        vec4 p = 0.7 * skyProfAt(z) + 0.15 * (skyProfAt(z - w) + skyProfAt(z + w));
        em.xy += A.z * rt * path * vec2(mix(p.x, p.y, hard), mix(p.z, p.w, hard));
      }
      ga = gb;
    }
  }
  // the diffuse aurora and the red, marched through the map (each step's profiles: its altitudes, red; green and N2
  // soft and hard, their means), a coarse step looking it up blurred over the footprints it runs across
  float tp = sphereT(d.z, uSkyGeo.w, 82.0);
  vec2 mp = skyProj(FB[0]);
  for (int k = 0; k < SKY_N; k++) {
    vec4 pz = texelFetch(uSkyProf, ivec2(k, 0), 0), pg = texelFetch(uSkyProf, ivec2(k, 1), 0);
    float tn = sphereT(d.z, uSkyGeo.w, pz.y), ds = tn - tp;
    vec2 mn = skyProj(skyFoot(d, pz.y)), m = 0.5 * (mp + mn);
    vec4 c = textureLod(uSkyMap, vec2(m.x / uSkyMarg.z, 1.0 - m.y / uSkyMarg.w), log2(max(distance(mp, mn), 1.0)));
    em += vec3(c.g * ds * mix(pg.x, pg.y, clamp(c.b, 0.0, 1.0)), c.g * ds * mix(pg.z, pg.w, clamp(c.b, 0.0, 1.0)),
               c.a * ds * pz.z);
    tp = tn; mp = mn;
  }
  // borealis.colour (the camera's response to each line), the air's extinction at this elevation, grade(): white
  // balance 4200 K, exposure, ACES, sRGB
  vec3 rgb = em.x * vec3(0.22, 1.0, 0.20) + (0.15 + 0.4 * uSkyK.y) * em.y * vec3(0.63, 0.04, 0.56)
           + (0.12 + 0.9 * uSkyK.y) * em.z * vec3(1.0, 0.05, 0.04);
  float e = asin(d.z), X = 1.0 / (sin(max(e, 0.005)) + 0.50572 * pow(max(degrees(e), 0.3) + 6.07995, -1.6364));
  rgb *= 1.5 * uSkyK.z * exp(-vec3(0.09, 0.15, 0.26) * X) * vec3(0.785, 1.0, 1.31) * uSkyK.w * 7.0;
  rgb = clamp(rgb * (2.51 * rgb + 0.03) / (rgb * (2.43 * rgb + 0.59) + 0.14), 0.0, 1.0);
  return mix(rgb * 12.92, 1.055 * pow(rgb, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, rgb));
}

#define MAX_LOCKS 16
// OKLab (vector-avatar's vecav/colour.py, the tone model): a hair texel keeps its lightness and colour relative to the
// hair's base, re-based on another; its lightness maps 0 .. base .. 1 onto 0 .. new base .. 1 (dark lines stay dark)
const mat3 TO_LMS = mat3(0.4122214708, 0.5363325363, 0.0514459929, 0.2119034982, 0.6806995451, 0.1073969566,
                         0.0883024619, 0.2817188376, 0.6299787005);
const mat3 TO_LAB = mat3(0.2104542553, 0.7936177850, -0.0040720468, 1.9779984951, -2.4285922050, 0.4505937099,
                         0.0259040371, 0.7827717662, -0.8086757660);
const mat3 FROM_LAB = mat3(1.0, 0.3963377774, 0.2158037573, 1.0, -0.1055613458, -0.0638541728,
                           1.0, -0.0894841775, -1.2914855480);
const mat3 FROM_LMS = mat3(4.0767416621, -3.3077115913, 0.2309699292, -1.2684380046, 2.6097574011, -0.3413193965,
                           -0.0041960863, -0.7034186147, 1.7076147010);
vec3 oklab(vec3 c) {                                   // (rows as columns: v * M is M v)
  vec3 l = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  return pow(l * TO_LMS + 1e-9, vec3(1.0 / 3.0)) * TO_LAB;
}
vec3 srgb(vec3 lab) {
  vec3 l = clamp(pow(lab * FROM_LAB, vec3(3.0)) * FROM_LMS, 0.0, 1.0);
  return mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, l));
}
vec3 tint(vec3 c) {
  vec3 q = oklab(c);
  float L = q.x < uTintFrom.x ? q.x * uTintTo.x / uTintFrom.x
                              : uTintTo.x + (q.x - uTintFrom.x) * (1.0 - uTintTo.x) / (1.0 - uTintFrom.x);
  vec2 ab = uTintTo.yz + (q.yz - uTintFrom.yz);
  ab *= min(1.0, 1.2 * (1.0 - L) / max(1.0 - uTintTo.x, 0.05));   // toward white, less colour (in gamut)
  return mix(srgb(vec3(L, ab)), c, smoothstep(uTintC.x, uTintC.y, length(q.yz)));
}
vec3 tintEye(vec3 c) {                                 // an iris: hue turned and chroma scaled as the base's to the new
  vec3 q = oklab(c);
  float L = q.x < uEyeFrom.x ? q.x * uEyeTo.x / uEyeFrom.x
                             : uEyeTo.x + (q.x - uEyeFrom.x) * (1.0 - uEyeTo.x) / (1.0 - uEyeFrom.x);
  float h = atan(uEyeTo.z, uEyeTo.y) - atan(uEyeFrom.z, uEyeFrom.y), co = cos(h), si = sin(h);
  vec2 ab = vec2(co * q.y - si * q.z, si * q.y + co * q.z) * length(uEyeTo.yz) / max(length(uEyeFrom.yz), 1e-4);
  return srgb(vec3(L, ab * min(1.0, 1.2 * (1.0 - L) / max(1.0 - uEyeTo.x, 0.05))));
}
vec2 rot(vec2 p, vec2 c, float a) { float co = cos(a), si = sin(a); vec2 d = p - c;
  return c + vec2(co * d.x + si * d.y, -si * d.x + co * d.y); }

// (opt-in) inside the bend, where an upper arm's edge U and its forearm's F (turned) meet, V: px from the line c-V (the
// forearm's side +), and whether the forearm is the narrower (they meet past the split)
float elbowMeet(vec3 U, vec3 F, vec2 p, vec2 c, vec2 fs, out bool narrow) {
  vec2 m2 = rot(F.xy, vec2(0.0), -uElbow);
  float g1 = U.z - dot(c, U.xy), g2 = F.z - dot(c, F.xy);
  vec2 V = vec2(m2.y * g1 - U.y * g2, U.x * g2 - m2.x * g1);   // (from c, times their det)
  narrow = g2 < g1;
  return (V.x * (p - c).y - V.y * (p - c).x) * sign(V.x * fs.y - V.y * fs.x) / max(length(V), 1e-6);
}
float sewK(vec2 p) {                                   // motion.sewn: 0 along the seam, 1 from SEW px down the arm
  vec2 d = p - uShoulder;
  float s = dot(d, uAxis), t = d.x * uAxis.y - d.y * uAxis.x;
  float k = clamp((s - uSeam.y - (uSeam.w - uSeam.y) * max((t - uSeam.x) / (uSeam.z - uSeam.x), 0.0)) / uSew, 0.0, 1.0);
  return k * k * (3.0 - 2.0 * k);
}

// Raised (RAISE), the arm turns about its joint as a ball joint does: all of it below, none of the shoulder's top above,
// easing between by the angle round the joint (over more than the raise itself, so the shoulder never folds over: a band
// across the arm did, far out to its sides, and flung the sleeve's tip about). The sleeve bends round the shoulder
// instead of folding flat, and opens from the shirt's side at the armpit. A sleeve drawn raised has its seam's top far
// less round from its arm than one hanging: the ease ends there (uRWin), or turned back down the T-pose's swung its
// armhole off her shoulder, a gap of 40 px (the top of the sleeve not connecting)
float raiseK(vec2 d, vec2 axis) {
  return 1.0 - smoothstep(0.3, uRWin, acos(clamp(dot(d, axis) / max(length(d), 1e-3), -1.0, 1.0)));
}
vec2 riseBack(vec2 p, int i, float by, float out_) {   // (her shoulder's rise, export "rise", taken off: kind 1's, a sleeve's)
  float d = (p.x - uRise[i].x) * (i == 0 ? 1.0 : -1.0);
  return p - uRiseDir[i] * by * clamp(1.0 - d / uRise[i].w, 0.0, 1.0) * (1.0 - smoothstep(0.0, out_, -d))
           * (1.0 - smoothstep(uRise[i].y - 20.0, uRise[i].y + RISE_FADE, p.y));
}
float raiseGap(vec2 p, float a) {                      // > 0 while the point turned back by a would turn by more
  vec2 d = rot(p, uJoint, a) - uJoint;
  float k = raiseK(d, uRAxis);
  return (uRaise * k - a) * sign(uRaise);
}

float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {      // signed distance to a triangle (< 0 inside; Inigo Quilez's)
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2, v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0), q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(q0, q0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(q1, q1), s * (v1.x * e1.y - v1.y * e1.x))),
               vec2(dot(q2, q2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
// (opt-in, motion.turnChain) the body's turn down its chain: uTurnN joints (canon y, the turn there, radians), top
// down, each eased into the next over the rows between them (one smooth turn from neck to feet: no layer tears at a
// joint, whichever piece a row is drawn on), on a cylinder of its own (uTurnR: wide enough for the robe, so its edges
// turn with the sleeves on them); the feet's toes moved toward the turn below the ankles (y, px a px)
#define MAX_TURN 8
uniform int uTurnN; uniform vec2 uTurnJ[MAX_TURN], uFootTurn; uniform float uTurnR;
uniform float uHeadRide;                               // (opt-in, turnChain.head) the canon row the head rides the chain at
float chainTurn(float y) {
  float a = uTurnJ[0].y;
  for (int i = 1; i < MAX_TURN; i++) { if (i >= uTurnN) break; a = mix(a, uTurnJ[i].y, smoothstep(uTurnJ[i - 1].x, uTurnJ[i].x, y)); }
  return a;
}
float twistX(vec2 p, float depth) {                    // motion.twist: the torso's turn, easing out to the waistband
  float ct = uTurnN > 0 ? depth * chainTurn(p.y) : 0.0;   // (opt-in: and the chain's first, down to her feet; none
  if (ct != 0.0 && abs(p.x - uBodyC) < uTurnR) {       // at 0, the front drawn exactly as without it)
    float q = asin(clamp((p.x - uBodyC) / uTurnR, -0.999, 0.999));
    p.x = uBodyC + uTurnR * sin(q - ct * cos(q)); }
  float a = uBody * depth * (1.0 - smoothstep(uTwist.x, uTwist.y, p.y)), u = p.x - uBodyC;
  if (abs(u) >= uBodyR) return p.x;
  float q = asin(clamp(u / uBodyR, -0.999, 0.999)); return uBodyC + uBodyR * sin(q - a * cos(q));
}

// The walk toward the camera (uCam): a run of points pitched toward it by th about a horizontal axis comes nearer, so it
// is drawn bigger about the camera's middle (canon x cx). The canon point drawn at p, for a run hanging from canon y ySrc
// whose pivot lies (down, toward the camera) piv from canon y yRoot (where its chain starts), at angle th from hanging
vec2 pitched(vec2 p, float yRoot, vec2 piv, float th, float ySrc, float cx) {
  float D = uCam.z, Y = p.y - uCam.y, c = cos(th), s = sin(th);
  float u = (Y * (D - piv.y) - D * (yRoot - uCam.y + piv.x)) / (D * c + Y * s);
  float k = D / (D - piv.y - u * s);
  return vec2(cx + (p.x - cx) / k, ySrc + u);
}
float pitchedY(float yRoot, vec2 q) { return (yRoot - uCam.y + q.x) * uCam.z / (uCam.z - q.y); }   // (screen y, less uCam.y)
vec2 pitchedFlat(vec2 p, float yRoot, vec2 piv, float th, float ySrc) {   // pitched as seen from far off: shorter, never
  return vec2(p.x, ySrc + (p.y - yRoot - piv.x) / cos(th));               // wider (the arms')
}
vec2 legPitch(vec2 p) {                                // the thigh about the hip, the shin about the knee, the foot carried
  vec2 t = vec2(cos(uLegP.x), sin(uLegP.x)), s = vec2(cos(uLegP.y), sin(uLegP.y));   // whole: by where it is drawn,
  vec2 K = (uShin.x - uHip.y) * t, A = K + (uShin.y - uShin.x) * s;                  // whichever piece of the leg
  float Y = p.y - uCam.y;
  if (Y <= pitchedY(uHip.y, K)) return pitched(p, uHip.y, vec2(0.0), uLegP.x, uHip.y, uCam.x);
  if (Y <= pitchedY(uHip.y, A)) return pitched(p, uHip.y, K, uLegP.y, uShin.x, uCam.x);
  return pitched(p, uHip.y, A, 0.0, uShin.y, uCam.x);
}
vec2 skirtPitch(vec2 p) {                              // over each thigh, the skirt pitched about its top by that thigh
  float w = 1.0 - smoothstep(uBodyC - 90.0, uBodyC + 90.0, p.x);                   // (her right side, from her middle)
  return pitched(p, uSkirtY.x, vec2(0.0), mix(uSkirtP.y, uSkirtP.x, w), uSkirtY.x, uCam.x);
}

float elbowEdge = 1e9;                                 // how far in from the elbow's cut a point is (px)
float elbowW = 1.2;                                    // its line's width there (uElbowLW on a rounded cut)
float elbowFade = 1.0;                                 // (elbowHalf) a piece's part past the split, as drawn, fading out
float elbowInk = 1.0;                                  // (elbowRound) and that line, fading in
float seam = 0.0;                                      // which side of a jump in the drawing a point is (the elbow's)
float lidA = 1.0;                                      // how much of an eye's inside the lids leave showing
void main() {
  vec2 p = vC;
  float sArm = 1e9;                                     // how far out along the raised arm, from its joint
  p.y -= uDrop;
  p.x -= uLean * (uFootY - p.y);
  if (uKind == 6) p.y = uFootY - (uFootY - p.y) / (1.0 - uBounce / (uFootY - uLegTop)); else p.y -= uBounce;
  if (uKind == 6 && uLegA != 0.0) p = rot(p, uHip, uLegA);   // out to her side about the hip, under the skirt
  if (uKind == 6 && uLegP != vec2(0.0)) p = legPitch(p);
  if ((uKind == 4 || uKind == 5) && uSkirtP != vec2(0.0)) p = skirtPitch(p);
  if (uTurnN > 0 && uKind >= 4 && (uBody != 0.0 || chainTurn(p.y) != 0.0)) {   // (opt-in, motion.turnChain) the
    p.x = twistX(p, 1.0);                              // skirt, legs and feet turned as the torso is at their rows, the
                                                       // toes toward the turn
    if (uKind == 6 && p.y > uFootTurn.x) p.x -= uFootTurn.y * (p.y - uFootTurn.x);
  }
  if (uKind == 4) {
    if (uSkirtDZ.x != 0.0 || uSkirtDZ.y != 0.0) {
      float w = pow(clamp((p.y - uSkirtY.x) / (uSkirtY.y - uSkirtY.x), 0.0, 1.0), 2.0);
      p.y -= uSkirtDZ.y * w;
      int i = clamp(int(floor(p.y - uSkirtY0 + 0.5)), 0, uSkirtN - 1);
      vec4 row = texelFetch(uSkirt, ivec2(i, 0), 0);          // edges xl, xr; inward margins ml, mr
      float dw = uSkirtDZ.x * w;
      float l = uSkirtDZ.x > 0.0 ? min(dw, row.z) : dw, r = uSkirtDZ.x > 0.0 ? dw : max(dw, -row.w);
      float f = clamp((p.x - row.x) / max(row.y - row.x, 1.0), 0.0, 1.0);
      p.x -= l + (r - l) * f;
    }
    if (uFlare.x != 0.0 || uFlare.y != 0.0) {          // each side swung out and up about the waist, the front's middle stays
      vec2 q = p;
      for (int it = 0; it < 4; it++) {
        float h = clamp(q.y - uSkirtY.x, 0.0, uSkirtY.y - uSkirtY.x);
        vec4 row = texelFetch(uSkirt, ivec2(clamp(int(floor(min(q.y, uSkirtYW) - uSkirtY0 + 0.5)), 0, uSkirtN - 1), 0), 0);
        float f = clamp((q.x - row.x) / max(row.y - row.x, 1.0), 0.0, 1.0);
        float wl = 1.0 - smoothstep(0.0, 0.85, f), wr = smoothstep(0.15, 1.0, f);
        q = p - h * vec2(sin(uFlare.y) * wr - sin(uFlare.x) * wl, (cos(uFlare.x) - 1.0) * wl + (cos(uFlare.y) - 1.0) * wr);
      }
      p = q;
    }
  } else if (uKind != 6 && uKind != 5) {
    p = rot(p, uWaist, -uSway);
    p.y = uWaist.y + (p.y - uWaist.y) / uBreath;
    if (uKind == 1) {
      p.x = twistX(p, mix(uBodyDepth.x, uBodyDepth.y, smoothstep(uBodyDepth.z, uBodyDepth.w, p.y)));
      for (int i = 0; i < 2; i++) if (uRise[i].z > 0.0) p = riseBack(p, i, uRise[i].z, 1e9);   // (up the seam: its side
                                                                       // slides along itself)
      if (uBreast != vec2(0.0)) {                       // the breasts on their spring, fading out from both centres
        vec2 a = (p - uBreastC.xy) / uBreastR, b = (p - uBreastC.zw) / uBreastR;
        float w = min(1.0, exp(-dot(a, a)) + exp(-dot(b, b)));
        if (uPatchF > 0.0) {                            // (opt-in) a piece on them carried whole, at its anchor's push,
          a = (uPatchAt - uBreastC.xy) / uBreastR; b = (uPatchAt - uBreastC.zw) / uBreastR;   // tested where it went
          float wr = min(1.0, exp(-dot(a, a)) + exp(-dot(b, b)));
          w = mix(wr, w, smoothstep(0.0, uPatchF, sdTri(p - uBreast * wr, uPatchA, uPatchB, uPatchC)));
        }
        p -= uBreast * w;
      }
    } else if (uKind == 2 || uKind == 3) {               // motion.sewn: the shirt's warp at the seam, the arm's down the arm
      if (uRiseBy != 0.0) p = riseBack(p, uKind - 2, uRiseBy, RISE_OUT);   // a raised sleeve's armhole: to the shirt's
      vec2 pa = rot(p - vec2(uShoulderDX, 0.0), uShoulder, -uArm), d = p - uShoulder;
      float t = d.x * uAxis.y - d.y * uAxis.x, k = sewK(p);
      if (uStretch > 0.0) k *= smoothstep(0.0, uStretch, (uSeam.z - t) * sign(uSeam.z - uSeam.x));   // a sleeve's inner side stays
      p = mix(vec2(twistX(p, 1.0), p.y), pa, k);
      // the walk's swing toward the camera, about the joint (a forearm further, about the elbow), only shortened: drawn
      // bigger as the camera would, an arm went thick swinging forward and thin swinging back 
      if (uArmP != vec2(0.0)) {
        vec2 e = vec2(cos(uArmP.x), sin(uArmP.x)) * (uElbowAt.y - uJoint.y);
        p = uElbowFar == 1 ? pitchedFlat(p, uJoint.y, e, uArmP.x + uArmP.y, uElbowAt.y)
                           : pitchedFlat(p, uJoint.y, vec2(0.0), uArmP.x, uJoint.y);
      }
      if (uElbow != 0.0) {                              // the puppet's elbow, bent after the raise (the raise's ease round
        vec2 o = -sign(uElbow) * vec2(-uElbowAx.y, uElbowAx.x), c = uElbowAt - ELBOW_IN * o;   // its joint goes by the
        vec2 fs = rot(uElbowFx, vec2(0.0), -uElbow), tip = uElbowAx - fs;   // angle there: a forearm bent back up
        vec2 sn = uElbowAx + fs;                         // toward it was left behind),
        float sd = dot(p - c, sn) / max(length(sn), 1e-4);
        bool fore = sd > 0.0, narrow = false, nin = dot(p - c, fs - dot(fs, uElbowAx) * uElbowAx) > 0.0;
        bool inside = uElbowHalf > 0 ? (uElbowAx.x * (p - c).y - uElbowAx.y * (p - c).x) * uElbow > 0.0 : nin;
                                                         // (the side it bends to, as elbowRound's lines are picked; its
                                                         // drawn bend the other way, still the outside of it, nin false)
        float sv = 0.0;                                  // (opt-in) inside the bend, where the pieces' own edges meet: a
        if (uElbowCU.xy != vec2(0.0) && inside && dot(uElbowAx, fs) >= -0.7) {   // forearm narrower than its upper
          sv = elbowMeet(uElbowCU, uElbowCF, p, c, fs, narrow);   // arm (the shirt's) meets it past the split; and
          bool nk;                                       // short of where the garment worn over it meets its own (run
          if (uElbowKU.xy != vec2(0.0) && elbowMeet(uElbowKU, uElbowKF, p, c, fs, nk) >= 4.0 && nk) sv = max(sv, 4.0); }
                                                         // on to its own, the shirt's stood out of the robe's corner)
        bool onto = fore && uElbowHalf == 1 && dot(uElbowAx, fs) >= -0.7 && inside
                    && (!nin || (narrow ? sv < 4.0 : sd < ELBOW_LAP));
        if (onto) fore = false;                          // (opt-in) a split upper arm's piece runs on past the split on
                                                         // the inside of the bend, under the forearm's (the forearm
                                                         // narrower, its edge met the split short of the upper arm's: a
                                                         // notch showed what was behind), a little, or with its edges
                                                         // out to where they meet, 4 px on under the forearm's line
                                                         // (60 px short of it, cut straight; to it, a fitted edge or
                                                         // two px off, a notch at the tip), its own drawing, not
                                                         // mirrored (bent a little, they met far off, and mirrored it
                                                         // ran on as a second sleeve)
        onto = onto && (narrow || !nin);                 // (and all of it, unturned, till the forearm is past straight:
                                                         // drawn bent away, its overhang over the forearm was cut off)
        float kap = smoothstep(0.0, ELBOW_FADE, abs(uElbow));   // (opt-in) and what the split cuts off of a piece
        bool fadeK = false;                              // fades out over the first of the bend, drawn as it is (cut off
        if (fore && uElbowHalf == 1 && !onto && dot(uElbowAx, fs) >= -0.7) {   // at once, the upper arm's overhang
          if (kap >= 1.0) discard;                       // past it popped off, and stayed so once a hold eased back,
          fadeK = true; fore = false; }                  // never quite to 0)
        if (narrow && nin && uElbowHalf == 4) discard;   // (and its copies there none, but fading: unturned, the
        if (narrow && nin && uElbowHalf == 3) { if (kap >= 1.0) discard; fadeK = true; }   // forearm's line jogged at
                                                         // the split)
        if (inside && !narrow && uElbowHalf == 3) { if (kap >= 1.0) discard; fadeK = true; }   // (3 only outside the
                                                         // bend: inside, its unturned outline lay in the turned forearm's
                                                         // fill, a dash, or hooked the corner where they meet)
        if (uElbowHalf == 4) {                           // (opt-in) 4: a forearm piece's copy under its upper arm's
          if (fore || dot(uElbowAx, fs) < -0.7 || !inside) discard;
          fore = true; elbowFade = kap; }                // piece: its drawing run on past the split inside the bend, as
                                                         // turned, showing only out past the upper arm's (a bell sleeve
                                                         // wider than it: its edge met the split first, cut straight);
                                                         // fading in with the bend (the copy over it, 3, drew the same
                                                         // nearly straight: their soft rims doubled, a notch at the split)
        if (uElbowHalf == (fore ? 1 : 2) || fore && uElbowHalf == 3) discard;   // (a piece's overlap past the elbow stood
                                                         // out of it as a stub; 3, opt-in: an upper-arm piece that is a
                                                         // forearm piece's copy, its own drawing run on to the split, as
                                                         // the rest pose draws it: not mirrored, no lap)
        vec2 q = fore ? rot(p, c, uElbow) : p;
        tip /= max(length(tip), 1e-4);
        float l = dot(p - c, vec2(-tip.y, tip.x)), cut = ELBOW_TIP - l * l / (2.0 * ELBOW_ROUND) - dot(p - c, tip);
        bool mitre = dot(q - c, fore ? -uElbowFx : uElbowAx) > 0.0;
        bool cutK = false;                               // (a rounded cut's part past it, fading: see below)
        if (fadeK) elbowFade = 1.0 - kap;
        else if (uElbowRU.w > 0.0) {                         // (opt-in) rounded: a circle tangent to both outer edges
          vec2 n2 = rot(uElbowRF.xy, vec2(0.0), -uElbow), t1 = vec2(-uElbowRU.y, uElbowRU.x);
          t1 *= sign(dot(t1, uElbowAx)); vec2 t2 = vec2(-n2.y, n2.x); t2 *= -sign(dot(t2, fs));   // (each toward it)
          float r = uElbowRU.w, h1 = uElbowRU.z - dot(c, uElbowRU.xy), h2 = uElbowRF.z - dot(c, uElbowRF.xy);
          float det = uElbowRU.x * n2.y - uElbowRU.y * n2.x;
          bool sect = false, fold = uElbowHalf > 0 && dot(uElbowAx, fs) < -0.7; float e;   // (fold: see below)
          vec2 X0 = vec2(n2.y * h1 - uElbowRU.y * h2, uElbowRU.x * h2 - n2.x * h1) / det;   // (tangent to both edges,
          vec2 Xr = vec2(uElbowRU.y - n2.y, n2.x - uElbowRU.x) / det;   // radius r: centred at c + X0 + r Xr; rho the one
          float conv = dot(uElbowRU.xy + n2, uElbowAx), rho = -dot(X0, uElbowAx) / (dot(Xr, uElbowAx) + 0.5 * conv);
          bool rhoOk = conv > 0.05 && abs(det) > 0.05 && rho > 0.15 * (h1 + h2) && rho < 0.75 * (h1 + h2);   // that meets
          if (uElbowHalf > 0 && rhoOk && rho > r)       // them across the elbow) (opt-in) bent further, rounder, to the
            r = mix(r, rho, smoothstep(-0.2, -0.7, dot(uElbowAx, fs)));   // fold's end: narrowing, the corner ran out
                                                         // as a spike before the fold took over and it popped round
          vec2 C = c; float tr = 0.0;                   // (the round's centre and radius; tr 0: none)
          if (dot(t1, n2) > 0.02 && !fold) {            // (a corner on the outside; nearly straight, none to round)
            C = c + vec2(n2.y * (h1 - r) - uElbowRU.y * (h2 - r), uElbowRU.x * (h2 - r) - n2.x * (h1 - r)) / det; tr = r;
            sect = dot(p - C, t1) > 0.0 && dot(p - C, t2) > 0.0; e = r - length(p - C);
            if (sect && uElbowLW > 0.0) elbowW = uElbowLW; }
          if (fold && rhoOk) { C = c + X0 + rho * Xr; tr = rho; }   // (the fold's end: see below)
          float w = 0.0, slid = fore ? uElbowIn.y : uElbowIn.x;   // (opt-in) the join into the round: 1 there, 0 48 px
          if (uElbowHalf > 0 && uElbowLW > 0.0 && tr > 0.0)   // before it, 6 px a px it slides (over 48, a 34 px slide
            w = 1.0 - smoothstep(0.0, max(48.0, 6.0 * slid),  // still met the drawn edge in a jog)
                                 sect ? 0.0 : fore ? dot(C + tr * n2 - p, t2) : dot(C + tr * uElbowRU.xy - p, t1));
          vec2 a = fore ? -uElbowFx : uElbowAx;         // past its end, each side its own drawing mirrored back (the
          if (uElbowHalf > 0) { vec2 te = fore ? uElbowRF.xy : uElbowRU.xy;   // other's, narrower there, stepped in
            te = vec2(-te.y, te.x); a = te * sign(dot(te, a)); mitre = dot(q - c, a) > 0.0; }   // under the circle; opt-in
          float ta = dot(q - c, a);                     // with elbowHalf, along its own edge: a few degrees off the axis, a long outer corner's
                                                        // mirrored line drifted out past it and was cut away)
          // near it, each side kept inside its own edge, let out further off (not into the join: let out there, it met
          // the round in a step); (opt-in) a forearm's further off faster, from its join's end (fitted by the elbow, its
          // edge shaved a sleeve's drawn outline where it bulged, its bell's hem; all at once, the bell's met the round
          // in a notch; not an upper arm's, a robe's flare to the armpit stood out raised)
          float far = !fore ? 0.0 : tr > 0.0 ? 0.5 * max(0.0, dot(C + tr * n2 - p, t2) - max(48.0, 6.0 * slid))
                                             : max(0.0, -ta - ELBOW_FAR);
          bool f2 = fore;                               // (opt-in, elbowHalf: past the round, the line on its side,
          if (uElbowHalf > 0 && tr > 0.0 && !sect && (dot(p - C, t1) > 0.0) != (dot(p - C, t2) > 0.0))   // whichever
            f2 = dot(p - C, t2) <= 0.0;                 // piece: the split met the forearm's past the round, and the
                                                        // upper arm's ran on there out to its own in a tick, bent a little)
          if (!sect) e = (f2 ? h2 - dot(p - c, n2) : h1 - dot(p - c, uElbowRU.xy))
                         + (uElbowLet * max(0.0, -ta - 30.0) + far) * (1.0 - w);
          cutK = e < 0.0;                               // (over the first of the bend what it cuts fades out, as drawn,
          if (cutK) { if (kap >= 1.0) discard;          // and its line in: at once, the drawing's rim past a fitted line,
            elbowFade *= 1.0 - kap; e = 1e9; }          // a robe's flare to the armpit, its bell's hem, popped off; let
          elbowEdge = e; elbowInk = kap;                // out, its line ran alongside the drawn one)
          if (mitre && uElbowHalf < 3 && !onto && !cutK) q -= 2.0 * ta * a * kap;   // (the upper arm's tip, turned with
                                                        // the forearm, stood out of it in a step; cut off short, the arm's
                                                        // own edge did) (easing in)
          if (fold) {                                   // (opt-in with elbowHalf) folded past 135 degrees the circle
            vec2 C2 = c + uElbowRU.xy * 0.5 * (h1 - h2), cd = uElbowAx;   // fell far off the arm or none fitted, and the
            float rr = 0.5 * (h1 + h2), at = 0.0;       // edges ran out as a spike: a round end across both instead
            if (rhoOk) {                                // (upper arm's outer edge to the forearm's, folded back alongside
              C2 = C; rr = rho;                         // it). Closing in a wedge, the circle tangent to both that meets
              cd = normalize(uElbowRU.xy + n2); at = 0.5 * rho * length(uElbowRU.xy + n2); }   // them across the elbow
                                                         // (a half circle there stepped in from the forearm's slanted edge)
            if (dot(p - C2, cd) > at) { float ec = rr - length(p - C2);
              if (ec < 0.0) discard;
              elbowEdge = min(elbowEdge, ec); if (uElbowLW > 0.0) elbowW = uElbowLW;
              vec2 nq = fore ? uElbowRF.xy : uElbowRU.xy;   // inside it the sleeve's fill, drawn from clear of its own
              float ins = (fore ? h2 : h1) - dot(q - c, nq), need = elbowW + 8.0;   // outline (mirrored in, the
              if (ins < need) q -= nq * (need - ins); } }      // forearm's outline smeared across the end)
          if (w > 0.0 && !cutK) {                       // the round's line eased in along the fitted edge over the join,
            elbowW = max(elbowW, mix(1.2, uElbowLW, min(1.0, 4.0 * w)));   // (eased all the way, it thinned mid-join)
            q -= (fore ? uElbowRF.xy : uElbowRU.xy) * slid * w * kap; }   // and the drawing slid out to the edge by how far
                                                         // inside it its own is drawn (elbowRound lines' 4th: the drawn
                                                         // line met the round in a step; a robe drawn ~20 px narrower than
                                                         // the sweater on the inner side left a see-through rim)
        } else if (mitre) {                             // mitred, the cut outlined
          if (cut < 0.0) discard;
          elbowEdge = cut / sqrt(1.0 + l * l / (ELBOW_ROUND * ELBOW_ROUND)); }
        p = q; seam = fore ? 1.0 : 0.0;                 // (ELBOW_IN; ELBOW_TIP past the elbow, each side's)
        if (cutK) seam += 2.0;                          // (and at a rounded cut's edge: drawn as it is past it, the jump
                                                        // in its neighbours' mip level drew a faint dotted line along it)
      } else if (uElbowHalf >= 3) discard;               // (straight, a forearm piece's copies none: drawn under it as
                                                         // well, its outline's soft rim doubled, and thinned at any bend)
      if (uRaise != 0.0 || uRShift != vec2(0.0)) {       // raised: the lift taken off, the point turned back by a that
        vec2 d = p - uJoint, ax = rot(uJoint + uRAxis, uJoint, -uRaise) - uJoint;   // would turn by a
        sArm = dot(d - uRShift, ax);
        p -= uRShift * raiseK(d, ax);
        float lo = 0.0, hi = uRaise;
        for (int it = 0; it < 14; it++) { float a = 0.5 * (lo + hi); if (raiseGap(p, a) > 0.0) lo = a; else hi = a; }
        p = rot(p, uJoint, 0.5 * (lo + hi));
      }
      if (uSlv != vec2(0.0)) {                          // the sleeve's hem on its spring, in the arm's frame as drawn:
        vec2 d = p - uShoulder;                         // in from SPAN up the sleeve, out over BELOW of the arm
        float s = dot(d, uAxis), t = d.x * uAxis.y - d.y * uAxis.x, u = s - uHem.x - uHem.y * t;
        float w = u < 0.0 ? smoothstep(-uHem.z, 0.0, u) : 1.0 - smoothstep(0.0, uHem.w, u);
        p -= w * (uSlv.x * uAxis + uSlv.y * vec2(uAxis.y, -uAxis.x));
      }
      if (uWrist != 0.0) {                              // the hand bent at the wrist along the joint bisector (analytic,
        vec2 bz = uWristBend.x > 0.0 ? uWristBend : WRIST_BEND;   // zero fixed-point fold or ghost fingertips!)
        vec2 hx = rot(uWristAx, vec2(0.0), -uWrist);
        vec2 bn = normalize(uWristAx + hx);
        float ws = dot(p - uWristAt, bn);
        float w = smoothstep(-bz.x, bz.y, ws);
        vec2 q = rot(p, uWristAt, uWrist * w);
        float qu = dot(q - uWristAt, uWristAx);
        if ((ws < 0.0 && qu > bz.y) || (ws > 0.0 && qu < -bz.x)) discard;
        p = q;
      }
    } else {
      if (uHeadRide > 0.0) p.x = twistX(vec2(p.x, uHeadRide), 1.0);   // (opt-in) carried by the body's turn as its neck's
                                                                     // row is, so the neck stays under it, then turned
      p = rot(p, uPivot, -uRoll);
      if (uHair == 1) { float w = pow(clamp((p.y - uHairV.x) / (uHairV.y - uHairV.x), 0.0, 1.0), 2.0); p -= vec2(uHairV.z, uHairV.w) * w; }
      else if (uHair == 2) {                              // motion.lock_bend: the side locks and back as one field of
        float dd[MAX_LOCKS], dmin = 1e20;                 // locks, a row each in uLocks: joints (two a texel), then
        for (int i = 0; i < MAX_LOCKS; i++) {             // (top, tip, joints), then (d, z, d2)
          if (i >= uLockN) break;
          int n = int(texelFetch(uLocks, ivec2(4, i), 0).z);
          vec2 a = texelFetch(uLocks, ivec2(0, i), 0).xy; float best = 1e20;
          for (int j = 1; j < 8; j++) {
            if (j >= n) break;
            vec4 q = texelFetch(uLocks, ivec2(j / 2, i), 0); vec2 b = j % 2 == 0 ? q.xy : q.zw, v = b - a;
            vec2 e = p - a - clamp(dot(p - a, v) / dot(v, v), 0.0, 1.0) * v;
            best = min(best, dot(e, e)); a = b;
          }
          dd[i] = best; dmin = min(dmin, best);
        }
        vec2 mv = vec2(0.0); float gs = 0.0;
        for (int i = 0; i < MAX_LOCKS; i++) {
          if (i >= uLockN) break;
          vec4 tt = texelFetch(uLocks, ivec2(4, i), 0), m = texelFetch(uLocks, ivec2(5, i), 0);
          float mid = 0.5 * (tt.x + tt.y), g = exp(-(dd[i] - dmin) / (uLockSigma * uLockSigma));
          float w1 = pow(clamp((p.y - tt.x) / (tt.y - tt.x), 0.0, 1.0), 2.0), w2 = pow(clamp((p.y - mid) / (tt.y - mid), 0.0, 1.0), 2.0);
          mv += g * vec2(m.x * w1 + m.z * w2, m.y * w1); gs += g;
        }
        p -= mv / gs;
      }
    }
  }
  if (uKind == 0 && uHead == 1 && (uPitch != 0.0 || uPitchScale != 1.0)) {
    vec2 dp = p - uC;
    float pu = dot(dp, uEU), pv = (dot(dp, uEV) - uPitch) / uPitchScale;
    p = uC + pu * uEU + pv * uEV;
  }
  if (uKind == 0 && uHead == 1 && uRigid == 1) p += uRigidD;
  else if (uKind == 0 && uHead == 1) {                  // turn.TurnRig.deform: the head's cylinder
    vec2 d = p - uC; float u = dot(d, uEU), v = dot(d, uEV);
    float q = asin(clamp(u / uR, -0.999, 0.999)), a = uTurn;
    if (uJaw == 1) { float u0 = uR * sin(q - a * cos(q)); float nr = clamp(1.0 + uSign * u0 / uJawNear, 0.0, 1.0);
      a *= 1.0 + uJawV * pow(clamp(v / uChin, 0.0, 1.0), 2.0) * nr; }
    else if (uNoFade == 0) a *= clamp((uNeck - v) / (uNeck - uChin), 0.0, 1.0);
    float us = abs(u) < uR ? uR * sin(q - a * cos(q)) : u;
    if (uJaw == 1 && uChinW != 0.0) {                  // ... and the chin drawn blunter
      float cv = dot(uChinAt - uC, uEV), d = us - dot(uChinAt - uC, uEU);
      us -= uChinW * pow(clamp((v - cv + uChinWide.x) / uChinWide.x, 0.0, 1.0), 2.0)
            * clamp(1.0 - (v - cv) / uChinWide.z, 0.0, 1.0) * clamp(1.0 - abs(d) / uChinWide.y, 0.0, 1.0) * d; }
    p = uC + us * uEU + v * uEV;
  }
  if (uHead == 0 && uTurnBody != vec2(0.0)) p -= uTurnBody * (1.0 - smoothstep(uTurnFade.x, uTurnFade.y, p.y));
  if (uChainN > 0) p -= chainShift(p);                  // (opt-in: the pack's chains)
  vec2 restP = p;                                       // (sheer.sky: the cloth's own point, its aurora rides with it)
  if (uSky == 1) { vec3 d = skyRay(p); vec2 G = d.xy * sphereT(max(d.z, 0.01), uSkyGeo.w, SKY_H0);
    skyRes = clamp(1.6 / sqrt(max(length(dFdx(G)) * length(dFdy(G)), 1e-6)), 0.0, 1.0); }
  vec2 g = (uAi * (p - uT)) / uHalf;                   // the fit's placement, as grid_sample's [-1, 1]
  if (uFInfo.x == 1) {                                  // forward vertex mesh / Angle Y / Blend Shape deformation
    g = invertForwardGrid(g, uFInfo.y, uFInfo.z);
  }
  if (uHasD == 1) {                                     // legacy inverse warp grid (align_corners, border)
    float n = float(uGD - 1);
    vec2 f = clamp((g + 1.0) * 0.5 * n, 0.0, n); ivec2 i0 = ivec2(floor(f)); ivec2 i1 = min(i0 + 1, ivec2(uGD - 1));
    vec2 t = f - vec2(i0);
    vec2 a = mix(uD[i0.y * uGD + i0.x], uD[i0.y * uGD + i1.x], t.x), b = mix(uD[i1.y * uGD + i0.x], uD[i1.y * uGD + i1.x], t.x);
    g += mix(a, b, t.y);
  }
  if (uEye > 0) {                                       // export.EYE_MODE: an eye opened wider or narrower than drawn,
    vec2 cp = uEyeA * (g * uHalf) + uEyeT;              // column by column (canon px at the front pose)
    float f = clamp((cp.x - uEyeX.x) / uEyeX.y, 0.0, 23.0); int i = min(int(f), 22);
    vec3 r = mix(uEyeR[i], uEyeR[i + 1], f - float(i));
    vec2 sh = mix(uEyeS[i], uEyeS[i + 1], f - float(i));
    bool lid = uEyeLid == 1 && uEyeO < 1.0;                             // (narrower: the lid comes down, export "shut")
    if (uEye == 1 && lid) {                                             // the sclera, under the lid's edge, over the
      float up = sh.y - uEyeO * sh.x, lo = r.y - uEyeLo * max(0.0, r.y - sh.y);   // lower lid's
      lidA = smoothstep(up - 0.75, up + 0.75, cp.y) * smoothstep(lo + 0.75, lo - 0.75, cp.y); }
    else if (uEye == 1) {                                               // the sclera, from its bottom, its top on the lid
      float h = r.y - r.x, k = r.z >= h ? 1.0 : r.z / h;                // (where the lid lifts more, it covers the top)
      cp.y = r.y - (r.y - cp.y) / (1.0 + (uEyeO - 1.0) * k); }
    else if (uEye == 2 && uEyeLid == 1) {                               // the lid, its lash moved whole down to the
      float e = sh.y - sh.x, d = (1.0 - uEyeO) * sh.x, u = (uEyeO - 1.0) * r.z;   // edge, up off the sclera's top;
      if (lid) cp.y = cp.y <= e + d ? cp.y - d : cp.y < sh.y ? sh.y - (sh.y - cp.y) / max(uEyeO, 1e-3) : cp.y;
      else if (cp.y <= r.x - u) cp.y += u;                              // what hangs below that, the liner down the
      else if (cp.y < r.y) cp.y = r.y - (r.y - cp.y) * (r.y - r.x) / (r.y - r.x + u); }   // outer corner, squashed
    else if (uEye == 2) cp.y -= (1.0 - uEyeO) * r.z;                    // to the closed eye or stretched to the sclera's
    else if (uEye == 3 || uEye == 6) {                                  // bottom, the corner put (moved whole, it went
      cp = uEyeC.xy + (cp - uEyeC.zw) / uEyeK;                          // way down closing); the iris, about the
      if (uEye == 6 && uEyeO > 1.0 && uRelOn == 0) {                    // pupil's middle, the canon's (6) wider without
        float f2 = clamp((cp.x - uEyeX.x) / uEyeX.y, 0.0, 23.0); int j = min(int(f2), 22);   // the lash's shadow
        float top = mix(uEyeR[j].x, uEyeR[j + 1].x, f2 - float(j));    // painted across its top (left under the lash
        lidA = mix(1.0, smoothstep(top + 2.0, top + 11.0, cp.y), smoothstep(1.0, 1.15, uEyeO)); } }   // lifted: a
    // second lash); the sheet's iris (E02) under it is whole
    else if (uEye == 5) cp.y += lid ? uEyeLo * max(0.0, r.y - sh.y) : 0.0;   // the lower lash, on the lower lid
    else if (!lid) cp.y += 0.5 * (uEyeO - 1.0) * r.z;                   // the brow (as the blink: not down)
    g = inverse(uEyeA) * (cp - uEyeT) / uHalf;
  }
  float vis = 1.0;
  if (uVis == 1 && uVisL.y > 0.0) {                    // motion.MotionRig.ear_slide: an ear going behind her head, each
    vec2 d = uVisA * (g * uHalf) + uVisT - uC;          // row from its inner edge out, sliding in under the face's edge
    float f = clamp((dot(d, uEV) - uVisV.x) / uVisV.y, 0.0, 23.0); int i = min(int(f), 22);
    vec4 r = mix(uVisR[i], uVisR[i + 1], f - float(i)); float w = r.y - r.x + uEarSoft;
    g += inverse(uVisA) * (uVisL.x * r.z * uEU) / uHalf;   // what shows here lay r.z further out
    float k = clamp((uVisL.x * dot(d, uEU) + r.z - r.x + uEarSoft - uVisL.y * w) / uEarSoft, 0.0, 1.0);
    vis = k * k * (3.0 - 2.0 * k);
  }
  if (uHook == 1) {                                     // an earring's swing about its hook
    vec2 q = g * uHalf - uHookV.xy; float co = cos(-uHookV.z), si = sin(-uHookV.z);
    g = (vec2(co * q.x + si * q.y, -si * q.x + co * q.y) + uHookV.xy) / uHalf;
  }
  if (uRelOn == 1) g = (uRelA * (g * uHalf) + uRelT) / uRelHalf;   // an expression's piece riding on this layer
  vec2 tc = (g + 1.0) * 0.5;
  if (tc.x < 0.0 || tc.y < 0.0 || tc.x > 1.0 || tc.y > 1.0) discard;
  vec2 dx = dFdx(tc), dy = dFdy(tc);
  if (fwidth(seam) > 0.0) dx = dy = vec2(0.0);         // (beside a seam, the jump drew a blurred mip level as a line)
  vec4 c = textureGrad(uTex, uAtlas.xy + tc * uAtlas.zw, dx * uAtlas.zw, dy * uAtlas.zw);
  if (uTint == 1 && c.a > 0.0) c.rgb = tint(c.rgb / c.a) * c.a;
  else if (uTint == 2 && c.a > 0.0) c.rgb = tintEye(c.rgb / c.a) * c.a;
  if (elbowEdge < elbowW + 1.8 && uElbowLine.r >= 0.0)
    c.rgb = mix(c.rgb, uElbowLine * c.a, elbowInk * (1.0 - smoothstep(elbowW, elbowW + 1.8, elbowEdge)));
  if (elbowW > 1.2) c *= mix(1.0, clamp(elbowEdge / 1.2, 0.0, 1.0), elbowInk);   // (a drawn-width cut's rim softened as the drawing's are)
  if (uSheerOn == 1 && uSky == 1 && uSkyK2.w > 1.5) { oCol = vec4(skyLight(restP), 1.0); return; }   // (SKY.debug 2)
  if (uSheerOn > 0 && c.a > 0.002) {                    // (opt-in) sheer fabric: where its map says, faded to uSheerOp,
    vec3 col = c.rgb / c.a;                             // with a borealis thin-film shimmer that follows its folds
    float lum = dot(col, vec3(0.299, 0.587, 0.114)), s = 1.0, a = c.a;
    if (uSheerOn == 2) s = smoothstep(0.45, 0.7, lum) * (1.0 - smoothstep(0.17, 0.3, max(col.r, max(col.g, col.b))
                           - min(col.r, min(col.g, col.b))));   // (2, sheer.sky: a raised sleeve's piece, its pale cloth)
    else {
    s = texture(uSheerTex, tc).r;
    // the film's hue runs with the fabric's own lightness (each drawn facet its own colour), drifts down the cloth with
    // time and slides as the head turns; a slow travelling wave brightens bands of it
    float wave = 0.5 + 0.5 * sin(vC.y * 0.007 + vC.x * 0.005 + uTime * 0.9 + sin(vC.x * 0.003 - uTime * 0.35) * 2.0);
    float ph = lum * 1.7 + vC.y * 0.0008 - vC.x * 0.0005 + uTime * 0.06 + uTurn * 0.3 + 0.2 * wave;
    float hl = smoothstep(0.55, 0.95, lum);             // light facets shimmer most, shadows keep their lavender
    vec3 film = mix(vec3(0.80, 0.70, 1.0), boreal(ph), 0.35 + 0.65 * hl);
    vec3 tinted = col * mix(vec3(1.0), film, 0.3 + 0.3 * hl);
    vec3 sheen = 1.0 - (1.0 - tinted) * (1.0 - film * (0.2 + 0.5 * hl * (0.4 + 0.6 * wave)));
    col = mix(col, sheen, s * uBoreal);
    col = mix(col, col * vec3(0.84, 0.74, 1.0), s * (1.0 - hl) * 0.55);   // its shadowed folds a deeper lavender
    col = mix(col, vec3(0.95, 0.93, 1.0), s * 0.1 * hl); // a milky veil on the light parts, so the arm under reads soft
    a = c.a * (1.0 - s * (1.0 - uSheerOp));
    }
    if (uSky == 1) {                                    // (sheer.sky) the aurora's light on the veil, and through it
      // the veil takes the light's colour as strongly as the light is (so its rays and borders show), keeping its own
      // drawn folds and lines, lightens with it, and glows (as much as there's cloth in the px)
      vec3 A = skyLight(restP), q = oklab(col), qa = oklab(A); float k = s * uSkyK2.y, I = max(A.r, max(A.g, A.b));
      float w = k * clamp(1.4 * I, 0.0, 1.0);
      q.yz = mix(q.yz, qa.yz, w); q.x = mix(q.x, mix(q.x, 1.0, 0.4), w * I);
      col = srgb(q);
      c = vec4(col * a + A * k * uSkyK2.z * 0.25 * c.a, a);
      if (uSkyK2.w > 0.5) c = vec4(A, 1.0) * c.a;     // (SKY.debug: the light alone)
    } else c = vec4(col * a, a);
  }
  if (uEye == 1 && uRelOn == 0) c = mix(c, texture(uOpenTex, tc), uOpenMix);   // its iris shrunk: the sclera repainted under it (eyesclera.py)
  c *= uOp * vis * lidA * elbowFade;
  if (uRelOn == 1) c *= clamp((uReveal * 1.08 - tc.y) / 0.08, 0.0, 1.0);    // a piece drawn in from its top
  if (uHasHole == 1) c *= 1.0 - uHoleS * texture(uHole, tc).r;
  if (uCuff.y > 0.0) c *= 1.0 - uCuff.y * (1.0 - smoothstep(uCuff.x - 12.0, uCuff.x + 12.0, sArm));
  if (uHasWipe == 1) c *= clamp((uWipe * (1.0 + uWipeSoft) - texture(uWipeTex, tc).r) / uWipeSoft, 0.0, 1.0);   // fit.WIPE
  if (uClipOn == 1) c *= texelFetch(uClip, ivec2(gl_FragCoord.xy), 0).a;
  if (uBehind > 0.0) { ivec2 q = clamp(ivec2(gl_FragCoord.xy + uBehindShift), ivec2(0), textureSize(uBehindA, 0) - 1);
    c *= 1.0 - uBehind * max(texelFetch(uBehindA, q, 0).a, texelFetch(uBehindB, q, 0).a); }
  oCol = uAlphaOnly == 1 ? vec4(c.a) : c;
}`;

const $ = (id) => document.getElementById(id);
