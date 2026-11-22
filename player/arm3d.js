// The drawn arms (opt-in: the pack's "arm3d", arm3d.py's measures of the avatar's painted arms), in place of the
// painted ones (a whole new arm system, to facilitate arm tracking ... perfect anime shading, no seams). Each arm is
// a skeleton in 3D, canon px (x right, y down, z toward the viewer, seen from far off): the shoulder's ball (elevation,
// its plane, the upper arm's own turn), the elbow (a hinge, with the carrying angle the painting has), the forearm's
// turn (the radius rolling over the ulna: the wrist turns, the elbow hardly), the wrist (flex, deviation) and each
// finger's three joints, all within a real arm's limits. It is drawn by ray marching its shape: round cones and an
// elliptic forearm, blended smoothly (no seams at the elbow, wrist or knuckles; the fingers kept apart), shaded with her
// skin's lit and shade tones over a soft terminator, outlined where its silhouette is or where one part passes in
// front of another (a local minimum of the distance along the ray: a near miss). Each pixel goes into the layer order
// by where it is: behind her body, under her shirt and sleeve (the upper arm, as the painting's B06), over her front or
// over her face (it can support the arms swinging behind the body, and being in front of the body).
"use strict";

const SIDES = ["R", "L"];
const NA = 98;                 // vec4 rows per arm in uA (see render())
const SS = 2;                  // drawn at SS x SS per screen px, averaged into the layers (its edges smooth)
const WIDE = 1.57;             // arm3d.WIDE: the wrist's wide side over its thin side
// A sleeve: cloth around the arm, from the shoulder's top to its hem (the arm's t: 0 the joint, 1 the elbow, 2 the
// wrist), EASE px out from the arm at least (as wide as the painting's, and hung out to her side as it is), WALL px
// thick, open at its hem (the arm seen up it), its top held over her shoulder as the arm moves (a cone from it to the
// tube), its colours down it as a ramp (it also needs to support full sleeves like coats, where the arm still
// moves as normal, but you can't see it (unless the sleeve is transparent sheer))
const EASE = 3, WALL = 2.5, RAMP_W = 64;
// Her body as the arms see it (canon px): an elliptic cylinder from y[0] to y[1], half as wide as w there, depth times
// that deep (its front: where an arm in front of her goes over her), and her head a ball (the pack's)
const TORSO = { y: [900, 1700], w: [240, 225], depth: 0.62 };
const M0 = { breath: 1, sway: 0, bounce: 0, lean: 0 };     // (her body unmoved: a check's, the panel's)
// Reaching: the elbow's ways it tries when free to choose (her arm's space: down and out a little back, down and
// forward (a hand at her face), out, down), the one that puts the palm nearest, facing nearest, within the limits
const POLES = [[0.5, 0.75, -0.45], [0.15, 0.75, 0.65], [0.9, 0.35, -0.2], [0.3, 0.95, 0.05]];
// Which ways her palm can face, by where her arm is (When the arms are at 45 degrees or higher, they can be palm
// down, or palm forward. When they're lower than 45 degrees, they can still be palm-down, (facing her), but also palm
// back. When they're over the body on the lower area, you should be able to see the top or side of the hands, but when
// they're over the upper area, all 3 angles): its palm within 65 degrees of between the two (her arm's space: x out)
const PALM_HIGH = [0, Math.SQRT1_2, Math.SQRT1_2], PALM_LOW = [-Math.SQRT1_2, 0, -Math.SQRT1_2], PALM_COS = 0.42;
// Joint limits (radians): a real arm's (these are based on the ways human arms can actually move)
const LIMIT = { elev: [-0.3, 3.05], plane: [-1.1, 2.3], twist: [-1.65, 1.65], flex: [0, 2.6], pro: [-1.45, 1.5],
                wflex: [-1.15, 1.25], wdev: [-0.45, 0.3], mcp: [-0.35, 1.6], pip: [0, 1.9], dip: [-0.1, 1.4],
                spread: [-0.15, 0.4], tflex: [-0.4, 1.0], tabd: [-0.12, 1.2], tmcp: [-0.1, 1.0], tip: [-0.35, 1.35] };
// The hand, in its own frame (x toward the thumb, y toward the fingertips, z out of its back), in hand lengths (the
// wrist's middle to the middle fingertip, straight): each finger's metacarpal base and knuckle, its three bones' share
// of its length, its radius at the knuckle and tip; the thumb's base (CMC), its direction and back at rest, its bones
export const HAND = {
  // index, middle, ring, little: base [x, y], knuckle [x, y, z], length, radius at the knuckle and tip, and its angle
  // toward the thumb, straight (fanned a little); bent, they turn in toward the middle's (a fist's tips meet)
  fingers: [
    // (the fingers were a bit too long and the hand too narrow facing us: the painting's palm is longer and
    // broader, its fingers about as long as it)
    // (fitted 11-05 to her painted hands, with nails, as long as hers (the 11-04 caps lifted); are her fingers the
    // right lengths? kept to her palm's: past the middle's tip, the ring's 0.015-0.06 short, the index's 0.06-0.11, the
    // little's 0.11-0.17; the knuckles an arc; the middle the broadest. refit, its shape from
    // her palm-forward paintings (P11, P12: there her fingers are flat and whole), her rest pose (B08) to it, then
    // both together, each with its own hand length (restHand, restHand.palm: bones()); the middle knuckle where
    // the index's should be, side view: its rest pose pinned to her index knuckle (the bump on the hand's back edge),
    // her thumb in front of the curled fingers, its nail to us, and the hand's shape from both views together; then
    // refitted on her crease-set bones (below): the lengths and knuckles from her palm-forward paintings, its thickness
    // and thumb as the side view had them, the rest pose with its curled fingers' pads to us; fit it to many more
    // hand poses: then fitted to her 18 painted gestures too (her parts sheet's waves, points, peace signs, fists,
    // thumbs-ups, mic grips and wrists, each its own pose), with those views together: hardly moved (their outlines
    // 0.893 to 0.897 of hers), the fingers a little rounder (flat))
    { base: [0.064, 0.05], knuckle: [0.14, 0.445, 0.004], len: 0.48, r: [0.045, 0.03], splay: 0.029 },
    { base: [0.021, 0.05], knuckle: [0.043, 0.506, 0.008], len: 0.501, r: [0.044, 0.033], splay: 0.062 },
    { base: [-0.023, 0.05], knuckle: [-0.042, 0.482, 0.005], len: 0.505, r: [0.043, 0.03], splay: 0.001 },
    { base: [-0.06, 0.055], knuckle: [-0.14, 0.411, 0], len: 0.465, r: [0.039, 0.028], splay: 0 },
  ],
  // (her painted creases, along each finger from its knuckle (P11, P12): its middle joint's lens a little past halfway,
  // its last bone's pink from 0.77; her first bones long, her last two short (were 0.38, 0.3, 0.32: three equal tubes))
  bones: [0.55, 0.215, 0.235],
  meta: 0.049,                                          // the metacarpals' radius (the palm's half thickness)
  flat: 0.87,                                           // the fingers' thickness, back to front, of their width
  // (the thumb was still too long: its two bones out of the palm 30% shorter, its metacarpal 17%)
  // (fitted 11-04, its base out and up toward the fingers, where the painting's thumb leaves the palm; 11-05: its
  // bones as long as hers, its tip 27 px across at its nail as painted at rest, round (flat); its base in the palm
  // thicker (her side view's thenar), its first joint out of it no more than a thumb's (0.07: a fist's clear); then
  // turned on itself as it comes across (roll: thumbChain(); at rest its nail to us, as hers); the thumb is fat
  // (outlined on its own, ownLine(): at rest it was 50 px across where it leaves the palm, hers about 30): its bones out
  // of the palm a little broader than a finger's, near round; with her 18 gestures, its tip a little slimmer (the
  // fit would have broadened its first joint again, to its cap: kept)
  thumb: { base: [0.068, 0.151, -0.038], dir: [0.46, 0.85, -0.17], back: [0.7, -0.2, 0.68], len: [0.224, 0.147, 0.159],
           r: [0.1, 0.056, 0.05, 0.039], flat: 0.9, roll: 1.5 },   // (flat: its thickness of its width, its own)
};
// Hand shapes: each finger's [knuckle, middle, end] bend and the spread; the thumb's [across, out, knuckle, end]
const SHAPES = {
  relaxed: { f: [[0.3, 0.45, 0.25], [0.4, 0.6, 0.3], [0.48, 0.7, 0.35], [0.55, 0.8, 0.4]], spread: 0,
             t: [0.4, 0, 0.05, 0.15] },
  // (open and peace spread as her painted wave and peace sign fit them, both hands (0.23-0.24, 0.32-0.4), her open
  // thumb farther out (0.39-0.4))
  open: { f: [[0.02, 0.05, 0.03], [0.02, 0.05, 0.03], [0.03, 0.06, 0.04], [0.04, 0.07, 0.05]], spread: 0.2,
          t: [-0.05, 0.4, 0.05, 0.05] },
  // (the thumbs: their tips found on the fingers they press, over the index and middle's middle bones for a fist)
  fist: { f: [[1.57, 1.85, 1.1], [1.6, 1.9, 1.1], [1.6, 1.9, 1.1], [1.57, 1.85, 1.05]], spread: 0, t: [0.05, 0, 0.95, 0.9] },
  point: { f: [[0.05, 0.05, 0.03], [1.6, 1.9, 1.1], [1.6, 1.9, 1.1], [1.57, 1.85, 1.05]], spread: 0,
           t: [0.15, 0, 0.95, 1.0] },
  peace: { f: [[0.05, 0.05, 0.03], [0.05, 0.05, 0.03], [1.6, 1.9, 1.1], [1.57, 1.85, 1.05]], spread: 0.3,
           t: [0.2, 0, 0.95, 1.0] },
  // (laid on something: the fingers together, hardly bent)
  flat: { f: [[0.1, 0.15, 0.08], [0.1, 0.15, 0.08], [0.12, 0.17, 0.09], [0.14, 0.2, 0.1]], spread: -0.08,
          t: [0.3, 0.05, 0.1, 0.1] },
};

// ---- vectors ---------------------------------------------------------------------------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const rot = (v, k, t) => add(add(mul(v, Math.cos(t)), mul(cross(k, v), Math.sin(t))), mul(k, dot(k, v) * (1 - Math.cos(t))));
const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- the hand in its own frame (hand lengths: x toward the thumb, y toward the fingertips, z out of its back) ------
// A finger's joints: its base, knuckle, two middle joints, tip; their radii; its nail's way (b: its three bends)
export function fingerChain(i, b, spread) {
  const F = HAND.fingers[i], [b1, b2, b3] = b.map((x, j) => clamp(x, LIMIT[["mcp", "pip", "dip"][j]]));
  const sp = clamp(spread || 0, LIMIT.spread) * (1.5 - i) + F.splay * (1 - 2.2 * Math.min(1, (b1 + b2) / 2.5));
  let d = rot([0, 1, 0], [0, 0, 1], -sp), z = [0, 0, 1];   // (fanned out about the middle's; - turns it toward the thumb)
  let at3 = [F.knuckle[0], F.knuckle[1], F.knuckle[2]];
  const pts = [[F.base[0], F.base[1], 0], at3];
  [b1, b2, b3].forEach((x, j) => {
    [d, z] = [sub(mul(d, Math.cos(x)), mul(z, Math.sin(x))), add(mul(d, Math.sin(x)), mul(z, Math.cos(x)))];
    at3 = add(at3, mul(d, F.len * HAND.bones[j])); pts.push(at3);
  });
  return { pts, r: [HAND.meta, F.r[0], F.r[0] + (F.r[1] - F.r[0]) * 0.45, F.r[0] + (F.r[1] - F.r[0]) * 0.75, F.r[1]], z };
}
// The thumb's: its base (CMC), two joints, tip; its nail's way (t: across, out, knuckle, end)
export function thumbChain(t) {
  const T = HAND.thumb, [tf, ta, tm, ti] = t.map((x, j) => clamp(x, LIMIT[["tflex", "tabd", "tmcp", "tip"][j]]));
  let td = norm(T.dir), tb = norm(sub(T.back, mul(td, dot(T.back, td))));
  td = rot(td, [0, 0, 1], tf); tb = rot(tb, [0, 0, 1], tf);                    // across the palm
  const oax = norm(cross([0, 0, 1], td)); td = rot(td, oax, ta); tb = rot(tb, oax, ta);   // out in front of it
  // (turned on itself as it comes across and out in front, as a thumb does: her resting thumb's nail to us; out from
  // the palm (palm forward), none)
  tb = rot(tb, td, (T.roll || 0) * Math.max(0, tf + ta));
  let tp = T.base; const pts = [tp];
  [0, tm, ti].forEach((x, j) => {
    [td, tb] = [sub(mul(td, Math.cos(x)), mul(tb, Math.sin(x))), add(mul(td, Math.sin(x)), mul(tb, Math.cos(x)))];
    tp = add(tp, mul(td, T.len[j])); pts.push(tp);
  });
  return { pts, z: tb };
}
// a point's distance to a segment, and where along it (0..1)
const segD = (p, a, b) => { const ba = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ba) / Math.max(dot(ba, ba), 1e-12)));
  return [len(sub(p, add(a, mul(ba, t)))), t]; };
// What the thumb mustn't pass through: the fingers' bones (and, for its last two, the palm), as round cones
const solids = (fs) => {
  const fing = [], palm = [];
  fs.forEach((c) => { palm.push([c.pts[0], c.pts[1], c.r[0], c.r[0] * 0.93]);
    for (let j = 1; j < 4; j++) fing.push([c.pts[j], c.pts[j + 1], c.r[j], c.r[j + 1]]); });
  return { fing, palm };
};
// The thumb that rests on what it meets (full articulatable hands and fingers that look good in every palm position
// and every closed level): near t0 (its shape's), out of the fingers and palm (a little press: they touch, not cross),
// its tip on a target if given (w: how much), or on a prop's surface (sdf); a few rounds of turning each joint a little
const pen = (p, r, caps, margin) => caps.reduce((a, [ca, cb, ra, rb]) => {
  const [d, t] = segD(p, ca, cb), o = ra + (rb - ra) * t + r - margin - d; return o > 0 ? a + o * o : a; }, 0);
export function fitThumb(fs, t0, opt = {}) {
  const S = solids(fs), T = HAND.thumb, KS = ["tflex", "tabd", "tmcp", "tip"];
  const cost = (t) => {
    const P = thumbChain(t).pts; let e = 0;
    for (let j = 0; j < 3; j++) for (let k = 1; k <= 4; k++) {
      if (j === 0 && k < 3) continue;                     // (its base is in the palm)
      const x = k / 4, q = add(P[j], mul(sub(P[j + 1], P[j]), x)), r = T.r[j] + (T.r[j + 1] - T.r[j]) * x;
      e += pen(q, r, S.fing, 0.006);
      if (j > 0) e += pen(q, r, S.palm, 0.006);
      if (opt.sdf) { const o = r - 0.008 - opt.sdf(q); if (o > 0) e += o * o; }
    }
    e *= 400;
    e += t.reduce((a, x, j) => a + (j < 2 ? 0.15 : 0.02) * (x - t0[j]) ** 2, 0);   // (its swing across and out: kept nearer)
    if (opt.target) e += (opt.w ?? 1) * dot(sub(P[3], opt.target), sub(P[3], opt.target));
    if (opt.sdf) e += 20 * (opt.sdf(P[3]) - T.r[3] + 0.006) ** 2;
    return e;
  };
  let win = null;                          // (from t0, and from any other starts: the best it settles to)
  for (const s0 of [t0, ...(opt.starts || [])]) {
    let t = s0.map((x, j) => clamp(x, LIMIT[KS[j]])), best = cost(t);
    for (const st of [0.16, 0.08, 0.04, 0.02, 0.01]) for (let it = 0, moved = true; moved && it < 30; it++) {
      moved = false;
      for (let j = 0; j < 4; j++) for (const sg of [-1, 1]) {
        const q = [...t]; q[j] = clamp(q[j] + sg * st, LIMIT[KS[j]]); const c = cost(q);
        if (c < best - 1e-9) { best = c; t = q; moved = true; }
      }
    }
    if (!win || best < win[0]) win = [best, t];
  }
  return win[1];
}
// where a fist's thumb rests: on its first two curled fingers' middle bones (a fist's index and middle), out on their
// side away from the palm
const fistRest = (fs) => {
  const cu = fs.filter((c) => c.pts[3][2] < -0.1), [a, b] = cu.length > 1 ? cu : fs;
  const m = mul(add(add(a.pts[2], a.pts[3]), add(b.pts[2], b.pts[3])), 0.25);
  return add(m, [0.01, 0, -(a.r[2] + HAND.thumb.r[3]) * 0.9]);
};

// (the curled shapes' own thumbs: rested so, along the index's side and across the curled fingers' fronts)
for (const k of ["fist", "point", "peace"]) {
  const S = SHAPES[k], fs = S.f.map((F, i) => fingerChain(i, F, S.spread));
  S.t = fitThumb(fs, [-0.05, 0.12, 0.55, 1.3], { target: fistRest(fs), w: 4 });
}

// A hand closed c of the way (0 open, CREL relaxed, 1 a fist): its fingers' bends between those shapes'; its thumb
// between theirs, then rested on the fingers (out of them; nearer a fist, on its index and middle as a fist's is)
const CREL = 0.3, shapes = new Map();
export function shapeAt(c) {
  c = clamp(+c || 0, [0, 1]);
  const key = Math.round(c * 400); if (shapes.has(key)) return shapes.get(key);
  const [a, b, w] = c < CREL ? [SHAPES.open, SHAPES.relaxed, c / CREL] : [SHAPES.relaxed, SHAPES.fist, (c - CREL) / (1 - CREL)];
  const L = (x, y) => x + (y - x) * w, f = a.f.map((F, i) => F.map((x, j) => L(x, b.f[i][j]))), spread = L(a.spread, b.spread);
  const fs = f.map((F, i) => fingerChain(i, F, spread));
  const q = { f, spread, t: fitThumb(fs, a.t.map((x, j) => L(x, b.t[j])), { target: fistRest(fs), w: 4 * ss(0.55, 1, c) }) };
  shapes.set(key, q);
  return q;
}
// A prop in the hand (hand lengths; pr: { kind, r, len, grip }): a stick (a cylinder, a capsule, an image's stem) across
// the palm under the knuckles, a little up toward the index (a power grip), against the palm; a ball in the cupped palm.
// Its fingers close, all their joints together (the later ones on alone once the first is stopped), till a bone meets
// it (a little pressed in: no gap), no further than a fist's; the thumb round it from the other side
export function grip(pr) {
  const r = pr.r, M = HAND.meta, stick = pr.kind !== "sphere";
  let A, B, a, c;
  if (stick) {
    a = norm([1, 0.2, 0]); c = [-0.005, 0.4 - 0.97 * r, 0.004 - M - r];
    A = add(c, mul(a, -(pr.grip ?? 0.5) * pr.len)); B = add(c, mul(a, (1 - (pr.grip ?? 0.5)) * pr.len));
  } else { a = [1, 0, 0]; c = [0, 0.3, 0.004 - M - r]; A = B = c; }
  const sdf = (p) => segD(p, A, B)[0] - r, spread = stick ? 0 : 0.12;
  const f = SHAPES.fist.f.map((cap, i) => {
    const hits = (q) => { const C = fingerChain(i, q, spread);
      for (let j = 1; j < 4; j++) for (let k = 1; k <= 4; k++) { const x = k / 4;
        if (sdf(add(C.pts[j], mul(sub(C.pts[j + 1], C.pts[j]), x))) < 0.8 * (C.r[j] + (C.r[j + 1] - C.r[j]) * x)) return true; }
      return false; };
    // (closed from q, a step at a time, each joint with those past it, until the next step would sink a bone in it)
    const close = (q, from0) => {
      for (let it = 0; it < 300; it++) {
        let moved = false;
        for (let from = from0; from < 3; from++) {
          const n = q.map((x, j) => (j >= from ? Math.min(cap[j], x + 0.012 * cap[j]) : x));
          if (n.every((x, j) => x === q[j]) || hits(n)) continue;
          q = n; moved = true; break;
        }
        if (!moved) return q;
      }
      return q;
    };
    let b = close([...SHAPES.open.f[i]], 0);
    // (its tip still short of a thin stick: its knuckle opened a step at a time, the joints past it closed again from
    // open, while that brings the tip nearer (a long finger wraps round it, as a short one's tip reaches it))
    const gapOf = (q) => { const C = fingerChain(i, q, spread); return sdf(C.pts[4]) - C.r[4]; };
    for (let k = b[0] - 0.02; gapOf(b) > 0.01 && k >= SHAPES.open.f[i][0]; k -= 0.02) {
      const q = close([k, ...SHAPES.open.f[i].slice(1)], 1);
      if (gapOf(q) < gapOf(b)) b = q;
    }
    return b;
  });
  const fs = f.map((F, i) => fingerChain(i, F, spread));
  // (a stick's thumb: round its front, across it (on the fingers, if they're there), not along it; a ball's on it)
  const t = fitThumb(fs, stick ? [0.3, 0.75, 0.35, 0.3] : [0.2, 0.7, 0.2, 0.2],
                     { sdf, target: stick ? add(c, [0.04, 0.03, -r - 0.03]) : null, w: 4,
                       starts: [[0.6, 1.0, 0.5, 0.5], [0.9, 0.8, 0.6, 0.8], [0.3, 1.15, 0.8, 0.6], [0.9, 1.15, 0.2, 0.3]] });
  return { f, spread, t, A, B, a, c, sdf };
}

// ---- the skeleton ----------------------------------------------------------------------------------------------------
// An arm in its own space: from its shoulder's joint, x out to her side, y down, z toward the viewer (her right arm's
// mirrored, so both are one arm). Its pose: { elev, plane, twist, flex, pro, wflex, wdev, carry, f, spread, t }
export function bones(R, pose) {
  const q = (k) => clamp(pose[k], LIMIT[k]);
  const plane = q("plane"), elev = q("elev"), pdir = [Math.cos(plane), 0, Math.sin(plane)];
  const sax = norm(cross([0, 1, 0], pdir));             // the swing: down turned toward pdir by elev
  const swing = (v) => rot(v, sax, elev);
  const tw = q("twist"), u = swing([0, 1, 0]), e1 = swing(rot([0, 0, 1], [0, 1, 0], tw));   // (+ turns out)
  const k = cross(u, e1), flex = q("flex");             // the elbow's hinge (out to her side at rest)
  const c = pose.carry * Math.max(0, Math.cos(flex));   // the carrying angle: straight, the forearm angles out
  const v = rot(norm(add(mul(u, Math.cos(c)), mul(k, Math.sin(c)))), k, flex);
  let af = rot(e1, k, flex); af = norm(sub(af, mul(v, dot(af, v))));   // the forearm's front (palm side, turned up)
  const m = cross(af, v), p = q("pro");                 // toward her middle
  let pn = sub(mul(m, Math.cos(p)), mul(af, Math.sin(p))), r = add(mul(af, Math.cos(p)), mul(m, Math.sin(p)));
  const E = mul(u, R.lu), W = add(E, mul(v, R.lf));
  const wf = q("wflex"), wd = q("wdev");               // the wrist: toward the palm, then toward the thumb
  let h = add(mul(v, Math.cos(wf)), mul(pn, Math.sin(wf))); pn = sub(mul(pn, Math.cos(wf)), mul(v, Math.sin(wf)));
  const h2 = add(mul(h, Math.cos(wd)), mul(r, Math.sin(wd))); r = sub(mul(r, Math.cos(wd)), mul(h, Math.sin(wd))); h = h2;
  // (its length: her palm-forward hands are drawn bigger than her resting ones, so as its palm turns forward from her
  // rest turn it grows to theirs (the pack's restHand.palm: their turn and length))
  const Hl = R.palm ? R.hl + (R.palm.hl - R.hl) * ss(0, 1, (R.pro0 - p) / (R.pro0 - R.palm.pro)) : R.hl;
  const n = mul(pn, -1), at = (x) => add(W, add(add(mul(r, x[0] * Hl), mul(h, x[1] * Hl)), mul(n, x[2] * Hl)));
  const vec = (x) => add(add(mul(r, x[0]), mul(h, x[1])), mul(n, x[2]));
  const fingers = HAND.fingers.map((F, i) => {          // each finger: its base, knuckle, two middle joints, tip
    const c = fingerChain(i, pose.f[i] || [0, 0, 0], pose.spread);
    return { pts: c.pts.map(at), r: c.r.map((x) => x * Hl), nail: vec(c.z) };
  });
  const tc = thumbChain(pose.t || [0, 0, 0, 0]);
  const thumb = { pts: tc.pts.map(at), r: HAND.thumb.r.map((x) => x * Hl), nail: vec(tc.z) };
  return { G: [0, 0, 0], E, W, u, v, k, af, m, r, h, n, pro: p, hl: Hl, fingers, thumb };
}

// The middle of a hand's palm (its knuckles' and their bases' mean)
export const palmMid = (B) => mul(B.fingers.reduce((a, F) => add(add(a, F.pts[0]), F.pts[1]), [0, 0, 0]), 1 / 8);

// The angles that put an arm's upper arm along u and its forearm along v (her own space, unit), its palm facing nT as
// near as the forearm can turn, its elbow bending toward bend when it hardly bends (else the bend's way flips; w: how
// much it bends its own way, by default by how much it bends)
export function solve(r0, u, v, nT, bend, w) {
  const c = dot(u, v);
  let e1 = sub(v, mul(u, c));
  if (w === undefined) w = ss(0, 0.3, len(e1));
  const b = norm(sub(bend, mul(u, dot(bend, u))));
  e1 = norm(add(mul(len(e1) > 1e-6 ? norm(e1) : b, w), mul(b, 1 - w)));
  // the upper arm's way as an elevation in a plane: raised toward the plane's way, or (negative) away from it;
  // the second only where the limits allow it (its own turn's too) and not the first (else, as an arm moved, the
  // one nearer the limits changed between them, each clamped its own way, and the arm jumped)
  const el = Math.acos(clamp(u[1], [-1, 1])), flat = Math.hypot(u[0], u[2]) > 1e-6;
  const reps = flat ? [[el, Math.atan2(u[2], u[0])], [-el, Math.atan2(-u[2], -u[0])]] : [[el, 0]];
  const over = (x, [lo, hi]) => Math.max(0, lo - x, x - hi);
  // (a turn past its limits taken a whole turn nearer them: else one just past +pi and one just short of -pi, the
  // same way, clamped to opposite ends, and an arm raised over her head jumped across)
  const near = (x, L) => [x - 2 * Math.PI, x, x + 2 * Math.PI].reduce((a, y) => (over(y, L) < over(a, L) ? y : a));
  let best = null;
  for (const [elev, p0] of reps) {
    const plane = near(p0, LIMIT.plane), sax = norm(cross([0, 1, 0], [Math.cos(plane), 0, Math.sin(plane)]));
    const e1r = rot(e1, sax, -elev), twist = near(Math.atan2(e1r[0], e1r[2]), LIMIT.twist);
    const bad = over(elev, LIMIT.elev) + over(plane, LIMIT.plane) + over(twist, LIMIT.twist);
    if (!best || (best.bad > 1e-9 && bad < 1e-9)) best = { elev, plane, twist, bad };
  }
  const { elev, plane, twist } = best;
  const flex = Math.atan2(dot(v, e1), dot(v, u));
  const k = cross(u, e1), vv = rot(u, k, flex);
  let af = rot(e1, k, flex); af = norm(sub(af, mul(vv, dot(af, vv))));
  const m = cross(af, vv), n = norm(sub(nT, mul(vv, dot(nT, vv))));
  return { ...r0, elev, plane, twist, flex, carry: 0, pro: Math.atan2(-dot(n, af), dot(n, m)) };
}

// ---- GL --------------------------------------------------------------------------------------------------------------
const FS = `#version 300 es
precision highp float;
in vec2 vC;
layout(location = 0) out vec4 oCol;
layout(location = 1) out vec4 oAux;
uniform vec4 uA[${2 * NA}];
uniform vec4 uBnd[6]; uniform vec3 uBndR[2]; uniform ivec2 uOn;
uniform vec3 uLit, uShade, uLine, uBlush, uHLit, uHShade, uHLine, uHBlush, uNail;
uniform vec4 uTorso, uTorsoW, uHead; uniform float uLineW, uPx;
uniform sampler2D uRamp, uCard0, uCard1, uArmTex; uniform vec3 uSLine[2];
bool gBare = false;                                     // (the arm alone: seen through a sheer sleeve)
const float K_ELBOW = 34.0, K_WRIST = 16.0, K_PALM = 11.0, K_THENAR = 15.0, K_WEB = 6.0;
// the fingers' (and thumb's) bones: their radius across, through (FLAT: from back to front, of that), their tips
// (tipOf(): its point TIP_UP of the way up to its back, near the nail's line, as her side-on tips); the palm's slab:
// past its edge bones (PALM_X: of their radius), its thickness at the knuckles (PALM_K: of that at the wrist), its
// faces' fullness (slab())
vec2 FLAT = vec2(1.0, 0.72);                            // (through: HAND.flat, row 97.w; the thumb's, 48.w: arm(), skin())
const float TIP_AT = 0.38, TIP_R = 0.16, TIP_UP = 0.75, PALM_X = 0.85, PALM_K = 0.85, PALM_C = 0.3;
const float WEB_T = 0.4, WEB_Y = 0.55, WEB_U = 0.6, WEB_IN = 0.3;    // (the webs between the fingers: arm())
// their nails (nailOf()), in the last bone's tip radii: from NAIL_AT of the way along it to a point NAIL_X past the
// pad's end, NAIL_W across at its widest (NAIL_WAT of the way), its free edge's taper (NAIL_P: 2 a parabola's point,
// higher blunter; 2.8: her almond points, 4.5 read as spoons), its shell NAIL_G out from the finger and NAIL_T thick
const float NAIL_AT = 0.25, NAIL_X = 0.38, NAIL_W = 0.66, NAIL_WAT = 0.5, NAIL_P = 2.8, NAIL_G = 0.06, NAIL_T = 0.12;
// (TIP_AT, NAIL_AT the fingers': their last bones short, as hers, the tip and nail as long as before in px; the thumb's
// own, TIP_THUMB: its last bone as it was. TIPN: the digit's now (arm(), onNail()))
const vec2 TIP_THUMB = vec2(0.55, 0.42); vec2 TIPN = vec2(TIP_AT, NAIL_AT);
// the hand's tones, of its lit one: its palm side's, its shade's (its back's, its palm's), how near its edge that
// starts (skin(), skinLight()); its outline's ink (lineOf(): her painted hands' outlines and the lines inside them a
// deep red, measured on her P11, P12, B08 (their un-blended edge px); the arm's line brown-grey beside it)
const vec3 H_PALM = vec3(0.99, 0.925, 0.94), H_SHADE = vec3(0.96, 0.8, 0.81), H_PSHADE = vec3(0.99, 0.9, 0.9);
const float H_EDGE = 10.0; const vec3 H_INK = vec3(120.0, 46.0, 52.0) / 255.0;
// her palm side's drawing: its fingers' creases (H_CRW px, H_CRA strong), its palm's lines (H_PLW px, H_PLA strong)
const float H_CRW = 2.5, H_CRA = 0.5, H_PLW = 1.6, H_PLA = 0.5;
// her painted hands' colours by their lightness (luminance 105..245 by 10s; measured on P11, P12, B08R, B08L): the
// hand's own tones are put on hers by their lightness (herTone()), so its shades are her pinks, never greyer
const vec3 HRAMP[15] = vec3[15](vec3(161, 81, 82), vec3(170, 91, 92), vec3(179, 102, 102), vec3(188, 113, 112),
  vec3(197, 123, 122), vec3(206, 134, 132), vec3(218, 144, 144), vec3(224, 155, 153), vec3(231, 168, 163),
  vec3(237, 178, 173), vec3(244, 190, 184), vec3(248, 202, 194), vec3(249, 214, 206), vec3(252, 230, 218),
  vec3(253, 238, 233));
vec3 herTone(vec3 c) {
  float l = dot(c, vec3(0.3, 0.59, 0.11)) * 255.0, x = clamp((l - 105.0) / 10.0, 0.0, 13.999); int i = int(x);
  return mix(c, mix(HRAMP[i], HRAMP[i + 1], x - float(i)) / 255.0, smoothstep(95.0, 110.0, l));   // (not its lines)
}

float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
float rcone(vec3 p, vec3 a, vec3 b, float r1, float r2) {   // a round cone (exact)
  vec3 ba = b - a; float l2 = max(dot(ba, ba), 1e-4), rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1.0 / l2;
  vec3 pa = p - a; float y = dot(pa, ba), z = y - l2;
  vec3 xv = pa * l2 - ba * y; float x2 = dot(xv, xv), y2 = y * y * l2, z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
// a flat round cone (a finger's bone, the palm): a to b, its radii ra..rb (x across, sd's way; y through, from its
// back to its front), its ends ellipsoids (b's tk times as long as it's across: a fingertip's point, its middle rising
// to lift of b's through toward its back at its end, as the square of the way: its back's line level, its pad curving
// up to it, as her fingertips side on (rising evenly, its back bulged 14% over the bone first: a round bulb)); the
// ellipsoid's distance bound (as the forearm's), near enough to march and shade by
float econe(vec3 p, vec3 a, vec3 b, vec2 ra, vec2 rb, vec3 sd, float tk, float lift) {
  vec3 ab = b - a; float l = max(length(ab), 1e-3); vec3 ax = ab / l, up = normalize(cross(sd, ax)), sx = cross(ax, up);
  float s = dot(p - a, ax), t = clamp(s / l, 0.0, 1.0), over = s - t * l, ow = over / (rb.x * tk);
  vec2 r = mix(ra, rb, t);
  float y = dot(p - a, up) - (over > 0.0 ? lift * rb.y * ow * ow : 0.0);
  vec3 rr = vec3(r, over > 0.0 ? rb.x * tk : ra.x), k3 = vec3(dot(p - a, sx), y, over) / rr;
  float k0 = length(k3), k1 = max(length(k3 / rr), 1e-5);
  return k0 * (k0 - 1.0) / k1;
}
// the palm: a slab, a to b (its wrist end's middle to its knuckles'), its half width and half thickness at each end
// (x, y): its faces a little full (PALM_C more thick in its middle), its edges rounded right round, its knuckle end too,
// along their row (kn: the index's to the little finger's; past them, square), not straight across (her middle and
// ring knuckles well past the line from the index's to the little finger's left a hole through it there)
float slab(vec3 p, vec3 a, vec3 b, vec2 ra, vec2 rb, vec3 sd, vec3 kn[4]) {
  vec3 ab = b - a; float l = max(length(ab), 1e-3); vec3 ax = ab / l, up = normalize(cross(sd, ax)), sx = cross(ax, up);
  vec3 q = p - a; float u = dot(q, ax), s = dot(q, sx); vec2 r = mix(ra, rb, clamp(u / l, 0.0, 1.0));
  float v = abs(s), c = max(1.0 - v * v / ((r.x - r.y) * (r.x - r.y)), 0.0); c *= c;
  float d2 = length(vec2(max(v - (r.x - r.y), 0.0), dot(q, up))) - r.y * (1.0 + PALM_C * c);
  // (its end: the row's piece across from p (across, the index's side first), p's distance past it along its normal)
  vec2 kk[4]; for (int i = 0; i < 4; i++) kk[i] = vec2(dot(kn[i] - a, sx), dot(kn[i] - a, ax));
  int j = s < kk[1].x ? (s < kk[2].x ? 2 : 1) : 0;
  vec2 e0 = kk[j], de = kk[j + 1] - e0; de.x = min(de.x, -1e-3);
  float t = (s - e0.x) / de.x, e = t < 0.0 ? u - e0.y : t > 1.0 ? u - e0.y - de.y : (u - e0.y - t * de.y) * -de.x / length(de);
  vec2 k = vec2(d2, max(-u, e)) + r.y;
  return length(max(k, 0.0)) + min(max(k.x, k.y), 0.0) - r.y;
}
// a finger's last bone (the thumb's), P to T (their radii): as thick as P's to TIPN.x of the way, then rounding off
// as a long half ellipsoid to a soft point TIP_R of T's radius past T (her painted fingertips' own profile)
float tipOf(vec3 p, vec4 P, vec4 T, vec3 sd) {
  vec3 m = mix(P.xyz, T.xyz, TIPN.x); float rm = mix(P.w, T.w, TIPN.x);
  return econe(p, P.xyz, m, P.w * FLAT, rm * FLAT, sd, (length(T.xyz - m) + T.w * TIP_R) / rm, TIP_UP);
}
// its nail: the top of a copy of its tip a little bigger and longer, a thin shell over its back, cut to an almond whose
// point is past the pad (her painted nails: their white free edges past her fingertips, their points her fingers'
// own); e: x how far in from its edge, y how far past the pad's end (px)
float nailOf(vec3 p, vec4 P, vec4 T, vec3 sd, out vec2 e) {
  vec3 ab = T.xyz - P.xyz; float l = max(length(ab), 1e-3); vec3 ax = ab / l, up = normalize(cross(sd, ax)), sx = cross(ax, up);
  vec3 m = mix(P.xyz, T.xyz, TIPN.x); float rm = mix(P.w, T.w, TIPN.x), lc = length(T.xyz - m) + T.w * TIP_R, g = 1.0 + NAIL_G;
  float tk = (lc + T.w * NAIL_X) / (rm * g);
  float o = econe(p, P.xyz, m, P.w * FLAT * g, rm * FLAT * g, sd, tk, TIP_UP),
        i = econe(p + up * (T.w * NAIL_T), P.xyz, m, P.w * FLAT * g, rm * FLAT * g, sd, tk, TIP_UP);
  vec3 q = p - P.xyz; float s = dot(q, ax), x = abs(dot(q, sx));
  float s0 = l * TIPN.y, s1 = l + T.w * (TIP_R + NAIL_X), sw = mix(s0, s1, NAIL_WAT), wn = T.w * NAIL_W;
  float u = s < sw ? (sw - s) / (sw - s0) : min((s - sw) / (s1 - sw), 1.0);
  float w = wn * (s < sw ? sqrt(max(1.0 - u * u, 0.0)) : 1.0 - pow(u, NAIL_P));
  float dO = max(x - w, s0 - s);
  float sm = l * TIPN.x; e = vec2(-dO, s > sm ? lc * (length(vec2((s - sm) / lc, x / rm)) - 1.0) : -lc);
  return max(max(o, -i), dO);
}
float prof(int b, float t) {                            // 16 samples, t 0..1
  float x = clamp(t, 0.0, 1.0) * 15.0; int i = min(int(x), 14); float f = x - float(i);
  return mix(uA[b + i / 4][i % 4], uA[b + (i + 1) / 4][(i + 1) % 4], f);
}
float capAt(int b, int k, float x) {                    // a painted sleeve's top (rows 5-7): its middles (k 0) or
  int i = min(int(x), 5); float f = x - float(i);         // radii (1), x 0 its tip .. 6 the joint (the tube's own)
  int j = 6 * k + i, n = j + 1;
  float a = uA[b + 5 + j / 4][j % 4], c = i < 5 ? uA[b + 5 + n / 4][n % 4] : uA[b + (k == 0 ? 60 : 56)].x;
  return mix(a, c, f);
}
struct Hit { float d; int part; float t; float d2; int f; float ft; int a; float dq; };
float cyl(vec3 p, vec3 a, vec3 b, float r) {            // a capped cylinder (exact)
  vec3 ba = b - a, pa = p - a; float baba = dot(ba, ba), paba = dot(pa, ba);
  float x = length(pa * baba - ba * paba) - r * baba, y = abs(paba - baba * 0.5) - baba * 0.5;
  float x2 = x * x, y2 = y * y * baba;
  float d = max(x, y) < 0.0 ? -min(x2, y2) : (x > 0.0 ? x2 : 0.0) + (y > 0.0 ? y2 : 0.0);
  return sign(d) * sqrt(abs(d)) / baba;
}
// a held prop (rows 67..75: its ends A, B and kind; radii; colours): 1 a cylinder (its edges rounded), 2 a capsule (a
// round cone), 3 a ball (an image's card is drawn apart from the march: main())
float prop(int b, vec3 p) {
  vec4 A = uA[b + 67], B = uA[b + 68]; int kind = int(A.w + 0.5);
  if (kind == 1) { vec3 ax = normalize(B.xyz - A.xyz); float rd = min(uA[b + 69].w, B.w * 0.5);
    return cyl(p, A.xyz + ax * rd, B.xyz - ax * rd, B.w - rd) - rd; }
  if (kind == 2) return rcone(p, A.xyz, B.xyz, B.w, uA[b + 69].w);
  if (kind == 3) return length(p - A.xyz) - B.w;
  return 1e5;
}
// part: 0 upper arm, 1 forearm, 2 palm, 3-6 fingers, 7 thumb, 8 sleeve (t: the arm's, ft: 1 its inside), 9 a held prop;
// f: the nearest finger (d2: the next), ft: along its bone; dq: the prop's distance (on the prop: the hand's)
// the upper arm's and forearm's distances at p, each round its own line: the bone's, moved out to her side (k, the
// elbow's hinge) by the painting's middle's offset there (rows 76, 80); where along each (t); s: down the forearm
struct Limbs { float dU; float dF; float tu; float tf; float s; };
Limbs limbs(int b, vec3 p) {
  vec3 G = uA[b].xyz, E = uA[b + 1].xyz, W = uA[b + 2].xyz, k = uA[b + 66].xyz;
  vec3 ua = E - G; float lu = length(ua); ua /= lu;
  Limbs l; l.tu = clamp(dot(p - G, ua) / lu, 0.0, 1.0);
  l.dU = length(p - G - ua * l.tu * lu - k * prof(b + 76, l.tu)) - prof(b + 8, l.tu);
  // (up a painted sleeve's top: none of it past its joint (its round end came out past that sleeve's painted inside)
  if (uA[b + 64].z > 0.5 && uA[b + 55].w > 0.5) l.dU = max(l.dU, -dot(p - G, ua));
  vec3 fa = W - E; float lf = length(fa); fa /= lf;
  l.s = dot(p - E, fa); l.tf = clamp(l.s / lf, 0.0, 1.0); float over = l.s - l.tf * lf;
  vec3 qs = p - E - fa * l.s - normalize(k - fa * dot(k, fa)) * prof(b + 80, l.tf);
  // the forearm's turn from rest (row 85: its turn then): the wrist all of it, the elbow a little (at rest its thin side
  // to us, as painted: palm forward, its wide side (the paintings': 48 px, 76))
  float th = (uA[b + 3].w - uA[b + 85].w) * mix(0.2, 1.0, l.tf);
  vec3 wa = cos(th) * uA[b + 3].xyz + sin(th) * uA[b + 4].xyz, tn = cos(th) * uA[b + 4].xyz - sin(th) * uA[b + 3].xyz;
  float ea = prof(b + 16, l.tf), eb = prof(b + 12, l.tf);
  vec3 k3 = vec3(dot(qs, wa) / ea, dot(qs, tn) / eb, over / eb);
  float k0 = length(k3), k1 = max(length(k3 / vec3(ea, eb, eb)), 1e-5);
  l.dF = k0 * (k0 - 1.0) / k1;
  return l;
}
// a digit's own distance (i 0-3 the fingers, 4 the thumb): its bones, its tip and nail, no pad, no palm; e its parts'
// (a finger's first and middle bones and tip; the thumb's -, first bone, tip). arm(), and each digit's own outline
// (ownLine())
float digit(int b, int i, vec3 p, out vec3 e) {
  if (i < 4) { int o = b + 21 + 5 * i; vec4 K = uA[o], P1 = uA[o + 1], P2 = uA[o + 2], P3 = uA[o + 3];
    // (flat: broader than thick, as fingers are; its tip coming to a soft point; sd: across it, its bends' axis)
    vec3 sd = normalize(cross(P3.xyz - P2.xyz, uA[b + 44 + i].xyz)); FLAT.y = uA[b + 97].w; TIPN = vec2(TIP_AT, NAIL_AT);
    e = vec3(econe(p, K.xyz, P1.xyz, K.w * FLAT, P1.w * FLAT, sd, 1.0, 0.0), econe(p, P1.xyz, P2.xyz, P1.w * FLAT, P2.w * FLAT, sd, 1.0, 0.0),
             tipOf(p, P2, P3, sd));
    // (its nail: only near its tip; farther, a bound on it)
    vec2 ne; e.z = min(e.z, e.z < 1.5 * P3.w ? nailOf(p, P2, P3, sd, ne) : e.z - P3.w * (NAIL_X + 0.1));
    return min(e.x, min(e.y, e.z));
  }
  vec4 M1 = uA[b + 41], M2 = uA[b + 42], M3 = uA[b + 43];
  vec3 sd = normalize(cross(M3.xyz - M2.xyz, uA[b + 48].xyz)); FLAT.y = uA[b + 48].w; TIPN = TIP_THUMB;   // (the thumb's own)
  e = vec3(1e5, econe(p, M1.xyz, M2.xyz, M1.w * FLAT, M2.w * FLAT, sd, 1.0, 0.0), tipOf(p, M2, M3, sd));
  vec2 ne; e.z = min(e.z, e.z < 1.5 * M3.w ? nailOf(p, M2, M3, sd, ne) : e.z - M3.w * (NAIL_X + 0.1));
  return min(e.y, e.z);
}
Hit arm(int A, vec3 p, bool detail) {
  int b = A * ${NA};
  vec3 G = uA[b].xyz, E = uA[b + 1].xyz, W = uA[b + 2].xyz;
  vec3 ua = E - G; float lu = length(ua); ua /= lu;
  float lf = length(W - E);
  Limbs l = limbs(b, p);
  float dU = l.dU, dF = l.dF, tu = l.tu, tf = l.tf, s = l.s;
  // (the elbow's blend as it bends: hardly any, all but straight (as at rest: there it swelled 8 px past the
  // painting's elbow either side), all of it, bent: its inside's crease filled)
  float dArm = smin(dU, dF, mix(4.0, K_ELBOW, smoothstep(0.3, 0.9, acos(clamp(dot(ua, normalize(W - E)), -1.0, 1.0)))));
  Hit h; h.d = dArm; h.part = dU < dF ? 0 : 1; h.t = h.part == 0 ? tu : tf; h.d2 = 1e5; h.f = -1; h.ft = 0.0; h.a = A;
  float dQ = prop(b, p); h.dq = dQ;
  vec4 sv = uA[b + 64];                                  // its sleeve: hem, wall, on, opacity
  float dSl = 1e5, tSl = 0.0, inSl = 0.0;
  if (sv.z > 0.5 && !gBare) {
    // its tube down the upper arm (radius, and out to her side, 16 each to its hem or the elbow), its top's cone
    vec4 ko = uA[b + 66], ct = uA[b + 65];
    float hu = min(sv.x, 1.0), tu0 = dot(p - G, ua) / lu, tc = clamp(tu0, 0.0, hu);
    float dS = length(p - G - ua * (tc * lu) - ko.xyz * prof(b + 60, tc / hu)) - prof(b + 56, tc / hu);
    // (blended by how far the arm has turned from under it: at rest hardly (it swelled past the painting's shoulder))
    float turned = smoothstep(0.03, 0.3, 1.0 - dot(uA[b + 86].xyz, ua)), kc = mix(2.0, 24.0, turned);
    vec4 c0 = uA[b + 55];
    if (c0.w > 0.5) {                                    // its painted top's slices, down from its tip to the joint
      vec3 ax = G - ct.xyz; float lc = length(ax); ax /= lc;
      vec3 on = normalize(c0.xyz - ax * dot(c0.xyz, ax));
      float x = clamp(dot(p - ct.xyz, ax) / lc, 0.0, 1.0) * 6.0;
      // (at rest, the tube's round end above the joint cut off: there the painting's own; turned, it rounds the gap)
      dS = smin(max(dS, -tu0 * lu - 100.0 * turned), length(p - ct.xyz - ax * (x / 6.0 * lc) - on * capAt(b, 0, x)) - capAt(b, 1, x), kc);
    } else dS = smin(dS, rcone(p, ct.xyz, G + ko.xyz * uA[b + 60].x, ct.w, uA[b + 56].x), kc);
    float cut = (tu0 - sv.x) * lu;
    if (sv.x > 1.0) {                                    // (down the forearm too: cut across it, not the upper arm)
      dS = smin(dS, dF - ko.w, K_ELBOW);
      cut = dF < dU ? s - (sv.x - 1.0) * lf : -1e5;
    }
    dSl = max(max(dS, -(dS + sv.y)), cut);               // a shell, open at its hem
    tSl = dU < dF ? tu0 : 1.0 + s / lf; inSl = -(dS + sv.y) > dS ? 1.0 : 0.0;
  }
  vec4 hb = uA[b + 50];                                  // the hand's bound: farther than this, it can't be nearer
  if (length(p - hb.xyz) - hb.w > min(dArm, dSl) + K_WRIST) {
    if (dSl < dArm) { h.d = dSl; h.part = 8; h.t = tSl; h.ft = inSl; }
    if (dQ < h.d) { h.dq = h.d; h.d = dQ; h.part = 9; h.f = -1; }
    return h;
  }
  // the palm: one broad flat slab (from the index's and little finger's bases to their knuckles: no ridges of its bones
  // on it), the bones' heads a little out of its back at the knuckles
  vec3 hx = uA[b + 96].xyz, hz = uA[b + 97].xyz;            // (the hand's frame: toward its thumb, out of its back)
  FLAT.y = uA[b + 97].w;
  vec4 B0 = uA[b + 20], B3 = uA[b + 35], K0 = uA[b + 21], K3 = uA[b + 36];
  vec3 kn[4] = vec3[4](K0.xyz, uA[b + 26].xyz, uA[b + 31].xyz, K3.xyz);
  float dP = slab(p, 0.5 * (B0.xyz + B3.xyz), 0.5 * (K0.xyz + K3.xyz), vec2(0.5 * length(B0.xyz - B3.xyz) + B0.w * PALM_X, B0.w),
                  vec2(0.5 * length(K0.xyz - K3.xyz) + B0.w * PALM_X, B0.w * PALM_K), hx, kn);
  for (int i = 0; i < 4; i++) { vec4 B = uA[b + 20 + 5 * i], K = uA[b + 21 + 5 * i];
    dP = smin(dP, rcone(p, mix(B.xyz, K.xyz, 0.5) + hz * (B.w * 0.35), K.xyz + hz * (B.w * 0.35), B.w * 0.7, B.w * 0.7), 6.0); }
  // the webs between its fingers: each pair's first bones joined from their knuckles to WEB_T of the way along them,
  // thinner than they are (WEB_Y), their free edge a U (WEB_U deep, of half the gap), nearer the palm (WEB_IN of their
  // thickness): from the palm side the fingers part where hers do, out from her palm's pads
  for (int i = 0; i < 3; i++) { vec4 Ka = uA[b + 21 + 5 * i], Kb = uA[b + 26 + 5 * i];
    vec3 wa = mix(Ka.xyz, uA[b + 22 + 5 * i].xyz, WEB_T), wb = mix(Kb.xyz, uA[b + 27 + 5 * i].xyz, WEB_T), dn = hz * (Ka.w * FLAT.y * WEB_IN);
    float ry = 0.5 * (Ka.w + Kb.w) * FLAT.y * WEB_Y;
    dP = smin(dP, econe(p, 0.5 * (Ka.xyz + Kb.xyz) - dn, 0.5 * (wa + wb) - dn, vec2(0.5 * length(Kb.xyz - Ka.xyz), ry),
                        vec2(0.5 * length(wb - wa), ry), normalize(Kb.xyz - Ka.xyz), WEB_U, 0.0), 3.0); }
  vec4 C = uA[b + 40], M1 = uA[b + 41], M2 = uA[b + 42], M3 = uA[b + 43];
  dP = smin(dP, rcone(p, C.xyz, M1.xyz, C.w, M1.w), K_THENAR);
  float d1 = 1e5, d2 = 1e5, dFn = 1e5, dT = 1e5; int f1 = -1; float ft = 0.0;
  for (int i = 0; i < 5; i++) {
    vec3 e; float d = digit(b, i, p, e), t = 0.0;
    if (i < 4) { vec4 P2 = uA[b + 23 + 5 * i], P3 = uA[b + 24 + 5 * i];
      vec4 pad = uA[b + 51 + i];                          // its curl's inside filled (a fist has no hole in it)
      if (pad.w > 0.0) d = smin(d, length(p - pad.xyz) - pad.w, 10.0);
      if (detail && e.z <= d) t = 2.0 + clamp(dot(p - P2.xyz, P3.xyz - P2.xyz) / dot(P3.xyz - P2.xyz, P3.xyz - P2.xyz), 0.0, 1.0);
      else if (detail) t = e.y <= d ? 1.0 : 0.0;
      dFn = min(dFn, d);
    } else { dT = d;
      if (detail && e.z <= d) t = 1.0 + clamp(dot(p - M2.xyz, M3.xyz - M2.xyz) / dot(M3.xyz - M2.xyz, M3.xyz - M2.xyz), 0.0, 1.0); }
    if (d < d1) { d2 = d1; d1 = d; f1 = i; ft = t; } else d2 = min(d2, d);
  }
  // (curled: the fingers fuller into the palm; the thumb into them only as much as at its joint: blended as the
  // fingers, laid along the hand it swelled to fill what was between them, and lost its outline)
  float dH = smin(smin(dP, dFn, mix(K_WEB, 20.0, uA[b + 49].y)), dT, K_WEB), d = smin(dArm, dH, K_WRIST);
  h.d = d;
  if (detail) {
    if (min(dP, d1) < dArm) { h.part = d1 < dP ? 3 + f1 : 2; h.t = 0.0; }
    h.d2 = d2; h.f = f1; h.ft = ft;
    if (d1 > dP + 2.0) h.f = -1;                          // (on the palm: no finger's)
  }
  if (dSl < d) { h.d = dSl; h.part = 8; h.t = tSl; h.ft = inSl; h.f = -1; }
  if (dQ < h.d) { h.dq = h.d; h.d = dQ; h.part = 9; h.f = -1; }   // (apart from the hand: its own outline, no blend)
  return h;
}
float map(vec3 p) {
  float d = 1e5;
  if (uOn.x == 1) d = arm(0, p, false).d;
  if (uOn.y == 1) d = min(d, arm(1, p, false).d);
  return d;
}
Hit mapD(vec3 p) {
  Hit a; a.d = 1e5;
  if (uOn.x == 1) a = arm(0, p, true);
  if (uOn.y == 1) { Hit b = arm(1, p, true); if (b.d < a.d) { b.d2 = min(b.d2, a.d); a = b; } }
  return a;
}
vec3 normalAt(vec3 p, float s) {                     // (s: how far apart it samples; wider, the smoother)
  vec2 e = vec2(s, -s);
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}
vec3 normalAt(vec3 p) { return normalAt(p, 0.6); }

float seg2(vec2 p, vec4 s) { vec2 a = s.xy, ba = s.zw - a; float t = clamp(dot(p - a, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(p - a - ba * t); }
bool march(vec2 xy, inout float z, out float lmin, out float lz) {   // down the ray from z: its hit, or its nearest miss
  float zp = z, prev = 1e5; bool desc = false; lmin = 1e5; lz = 0.0;
  for (int i = 0; i < 200; i++) {
    float d = map(vec3(xy, z));
    if (d < 0.05) return true;
    if (d > prev && desc) { if (prev < lmin) { lmin = prev; lz = zp; } desc = false; }   // a near miss
    if (d < prev) desc = true;
    prev = d; zp = z; z -= max(d * 0.9, 0.4);
    if (z < -1300.0) break;
  }
  return false;
}
// how near the ray at p comes to the outline of one of its hand's digits in front of p (not p's own): that digit's own
// distance at its least down the ray (x), how far in front of p that is (y). Her fingers and thumb are each outlined as
// a form of their own, however near they lie to what is behind them (by the gap behind alone, a thumb laid along the
// hand had no line, and how broad it was didn't show)
vec2 ownLine(vec3 p, Hit H, float w) {
  int b = H.a * ${NA}; vec2 fl = FLAT, tn = TIPN; vec2 best = vec2(1e5, 0.0); vec3 e;
  for (int i = 0; i < 5; i++) {
    if (H.part == 3 + i) continue;
    int o = i < 4 ? b + 21 + 5 * i : b + 41, n = i < 4 ? 3 : 2;
    float near = 1e5, top = -1e5;
    for (int j = 0; j < 3; j++) { if (j >= n) break; vec4 A = uA[o + j], B = uA[o + j + 1];
      near = min(near, seg2(p.xy, vec4(A.xy, B.xy)) - 2.0 * max(A.w, B.w)); top = max(top, max(A.z + A.w, B.z + B.w)); }
    if (near > w || top < p.z + 1.0) continue;               // (the ray not near its bones, or all of it behind p)
    float z = top + 2.0, zp = z, prev = 1e5; bool desc = false;
    for (int k = 0; k < 32; k++) {
      if (z <= p.z) break;
      float d = digit(b, i, vec3(p.xy, z), e);
      if (d < 0.05) break;                                   // (into it: blended into p's own)
      if (d > prev && desc) { if (prev < best.x) best = vec2(prev, zp - p.z); desc = false; }
      if (d < prev) desc = true;
      prev = d; zp = z; z -= max(d * 0.9, 0.5);
    }
  }
  FLAT = fl; TIPN = tn;
  return best;
}
// (the pack's arm3d.png: her painting at rest) a point of the arm where it was at rest, canon px (the painting's
// place), by its upper arm's frame (rows 84-88) or its forearm's (89-92, its turn undone: the forearm's own turn
// from the elbow, a little, to the wrist, all of it); n, its normal, turned so too. At rest each is where it is
vec3 restUp(int b, vec3 p, inout vec3 n) {
  vec3 G = uA[b].xyz, ua = normalize(uA[b + 1].xyz - G), k = uA[b + 66].xyz, f = uA[b + 84].xyz, q = p - G;
  n = dot(n, ua) * uA[b + 86].xyz + dot(n, k) * uA[b + 87].xyz + dot(n, f) * uA[b + 88].xyz;
  return uA[b + 85].xyz + dot(q, ua) * uA[b + 86].xyz + dot(q, k) * uA[b + 87].xyz + dot(q, f) * uA[b + 88].xyz;
}
vec3 restFore(int b, vec3 p, inout vec3 n) {
  vec3 E = uA[b + 1].xyz, fa = normalize(uA[b + 2].xyz - E), af = uA[b + 3].xyz, m = uA[b + 4].xyz, q = p - E;
  float s = dot(q, fa), dl = (uA[b + 85].w - uA[b + 3].w) * mix(0.2, 1.0, clamp(s / length(uA[b + 2].xyz - E), 0.0, 1.0));
  float c = cos(dl), sn = sin(dl), x = dot(q, af), y = dot(q, m), nx = dot(n, af), ny = dot(n, m);
  n = dot(n, fa) * uA[b + 90].xyz + (nx * c - ny * sn) * uA[b + 91].xyz + (nx * sn + ny * c) * uA[b + 92].xyz;
  return uA[b + 89].xyz + s * uA[b + 90].xyz + (x * c - y * sn) * uA[b + 91].xyz + (x * sn + y * c) * uA[b + 92].xyz;
}
// its painting there (row 93: her arm's, 94: her sleeve's, its alpha her painted sleeve's edge; on canon box row 95)
vec4 painted(int b, vec3 r, int which) {
  vec4 bx = uA[b + 95], rc = uA[b + which];
  return textureLod(uArmTex, mix(rc.xy, rc.zw, clamp((r.xy - bx.xy) / (bx.zw - bx.xy), 0.0, 1.0)), 0.0);
}
// how much of the painting to take at a point whose normal was n0 at rest and is N now: none where it was side-on or
// turned away then (the painting has nothing of it: its edges' colours carried out) and has come round toward us
float unseen(vec3 n0, vec3 N) { return 1.0 - (1.0 - smoothstep(0.15, 0.45, n0.z)) * smoothstep(0.1, 0.4, N.z - n0.z); }
// her skin's light: lit and shade tones over a soft terminator, her edges turned away a little darker
// (fl: how flat its light, 0..1: the hand's side away from it at most half in shade, as her hands are a flat pink with
// their edges' shade right at them; full, its fingers read as tubes, banded down each one)
vec3 skinLight(vec3 N, vec3 L, vec3 lit, vec3 shade, float ex, float fl) {   // (ex: how near its edge that shade starts)
  float t = mix(smoothstep(-0.25, 0.55, dot(N, L)), 1.0, 0.5 * fl);   // (from in front, above and out to its side: its
  return mix(mix(shade, lit, t), shade, 0.4 * pow(1.0 - max(N.z, 0.0), ex));   // side toward her in a soft shade, as painted)
}
// her palm's lines (on its palm side): its heart line, head line and life line, each a curve (3 points) in the hand's
// frame, hand lengths from the wrist (x toward its thumb, y toward its fingers), a soft line H_PLW px each side at its
// middle, tapering to nothing at its ends, as her pen does (11-06: where her P11 and P12 draw them, read off in the
// fitted hand's own frame: the head and life lines both run into the web of the thumb)
const vec2 PLINE[9] = vec2[9](vec2(-0.155, 0.41), vec2(-0.005, 0.4165), vec2(0.165, 0.497),
                              vec2(0.0, 0.33), vec2(0.065, 0.3875), vec2(0.17, 0.455),
                              vec2(0.085, 0.11), vec2(0.03, 0.32), vec2(0.175, 0.435));
// her palm's edge over its fingers' first bones (P11, P12; in the hand's frame, q): a U, flat across under the middle
// and ring fingers, up steeply to the little finger's outer edge, less to the index's
float palmArc(float x) { float u = (x - 0.04) / 0.2; return 0.578 - (u < 0.0 ? 0.094 : 0.055) * u * u * u * u; }
vec2 bez(vec2 q, vec2 a, vec2 c, vec2 e) {               // (q's distance from it, and how far along it that is, 0..1)
  vec2 r = vec2(1e5, 0.0), pr = a;
  for (int i = 1; i <= 8; i++) { float t = float(i) / 8.0; vec2 pt = mix(mix(a, c, t), mix(c, e, t), t), ba = pt - pr;
    float h = clamp(dot(q - pr, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0), d = length(q - pr - ba * h);
    if (d < r.x) r = vec2(d, t - (1.0 - h) / 8.0);
    pr = pt; }
  return r;
}
// how much a nail's way (nd: out of its back) shows it as a nail: seen from over or under it, all; edge on, none
float nailSeen(vec3 nd) { return smoothstep(0.2, 0.45, abs(nd.z)); }
// p on finger H.f's nail (its shell nearer there than its tip: nailOf()), ne nailOf()'s; only on its last bone (H.ft:
// curled hard, its first bone's back was nearer the nail's shell than the tip, and showed as pale blocks)
bool onNail(vec3 p, Hit H, out vec2 ne) {
  int b = H.a * ${NA}, o = H.f < 4 ? b + 23 + 5 * H.f : b + 42; vec4 P = uA[o], T = uA[o + 1]; FLAT.y = uA[b + (H.f < 4 ? 97 : 48)].w;
  vec3 sd = normalize(cross(T.xyz - P.xyz, uA[b + 44 + H.f].xyz)); TIPN = H.f < 4 ? vec2(TIP_AT, NAIL_AT) : TIP_THUMB;
  float n = nailOf(p, P, T, sd, ne);
  return H.ft >= (H.f < 4 ? 2.0 : 1.0) && n < tipOf(p, P, T, sd);
}
// finger f's back's way at p (its palm side the other): the hand's at its knuckle, between its bones' at each joint,
// its nail's at its tip (so on from the palm with no edge)
vec3 fingerBack(int b, int f, vec3 p) {
  int o = b + 21 + 5 * f; vec3 nd = uA[b + 44 + f].xyz;
  vec3 J[4] = vec3[4](uA[o].xyz, uA[o + 1].xyz, uA[o + 2].xyz, uA[o + 3].xyz), n[4];
  vec3 sd = normalize(cross(J[3] - J[2], nd));
  vec3 b0 = normalize(cross(sd, J[1] - J[0])), b1 = normalize(cross(sd, J[2] - J[1])), b2 = normalize(cross(sd, J[3] - J[2]));
  n[0] = uA[b + 97].xyz; n[1] = normalize(b0 + b1); n[2] = normalize(b1 + b2); n[3] = b2;
  float best = 1e5; vec3 r = b2;
  for (int j = 0; j < 3; j++) {
    vec3 a = J[j + 1] - J[j]; float t = clamp(dot(p - J[j], a) / dot(a, a), 0.0, 1.0), d = length(p - J[j] - a * t);
    if (d < best) { best = d; r = normalize(mix(n[j], n[j + 1], t)); }
  }
  return r;
}
// her skin at p: lit and shade tones over a soft terminator (wk: her forearm's tones into her hand's); her arm (not
// the hand) her painting's own colours if the pack has them, as lit now over as lit at rest (so at rest, the painting)
vec3 skin(vec3 p, Hit H, float wk, float lw, vec3 line) {
  // (the hand lit by a smoothed way (4 px): curled, the blend of its fingers into the palm left small lumps, lit in
  // blotches; hers are smooth)
  int b = H.a * ${NA}; vec3 N = normalAt(p, H.part >= 2 && H.part <= 7 ? 4.0 : 0.6);
  // (the hand: its palm side pinker than its back, its shade a deeper pink, not greyer: her painted hands' tones)
  // (and its edges' shade only right at them: hers is a line and a pixel or two)
  // (the hand's own frame: hand lengths from the wrist, x toward its thumb, y toward its fingers)
  vec3 W = uA[b + 2].xyz, hu = normalize(uA[b + 26].xyz - W); float hln = uA[b + 96].w;
  vec2 q = vec2(dot(p - W, uA[b + 96].xyz), dot(p - W, hu)) / hln;
  // (its palm flat as she paints it, down to its edge's arc over the fingers (palmArc()): the fingers' round ends at
  // the knuckles under it showed through as a row of dents; not at its sides, where it turns away)
  // (its rounded sides too, lit as its face: their shade was a wedge down its little finger's side; the line at its
  // edge kept, from its own way (below)) (the fingers only while they're out: curled into a fist, their bones under
  // the palm's arc were lit flat in patches)
  float ay = palmArc(q.x), pad = (H.part == 2 ? wk : H.f >= 0 && H.f < 4 ? wk * (1.0 - smoothstep(0.2, 0.6, uA[b + 49].y)) : 0.0)
                                 * smoothstep(0.01, -0.01, q.y - ay) * smoothstep(0.0, 0.45, -dot(N, uA[b + 97].xyz));
  vec3 N0 = N; N = normalize(mix(N, -uA[b + 97].xyz, 0.85 * pad));
  float pm = smoothstep(-0.1, 0.5, -dot(N, uA[b + 97].xyz)), ex = mix(4.0, H_EDGE, wk);
  // (a finger's palm side by its own bones (fingerBack()): by the hand's, curled fingers took the palm's pink in
  // patches wherever their sides turned toward it; the thumb by the hand's, its palm side as pink as hers)
  if (H.part >= 3 && H.part < 7 && H.f >= 0 && H.f < 4) pm = smoothstep(-0.1, 0.5, -dot(N, fingerBack(b, H.f, p)));
  vec3 hl = uHLit * mix(vec3(1.0), H_PALM, pm);
  vec3 lit = mix(uLit, hl, wk), shade = mix(uShade, hl * mix(H_SHADE, H_PSHADE, pm), wk);
  vec3 L = normalize(vec3(H.a == 0 ? -0.55 : 0.55, -0.4, 0.75));
  vec3 col = skinLight(N, L, lit, shade, ex, wk);
  col = mix(col, shade, pad * 0.4 * pow(1.0 - max(N0.z, 0.0), ex));
  // (all down the forearm, its painted wrist's crease too, and on into the drawn hand's own tones from 10 px before the
  // wrist to 50 past it, as her wrists go from pink to the hand's cream; the forearm's round end too: it reaches 16 px
  // past the wrist, and kept all of the painting there over the palm's 0.3, a hard line across the wrist)
  Limbs l = limbs(b, p);
  float tw = uA[b + 84].w * (H.part == 0 ? 1.0 : H.part < 8 ? 1.0 - smoothstep(-10.0, 50.0, l.s - length(uA[b + 2].xyz - uA[b + 1].xyz)) : 0.0);
  if (tw > 0.0) {
    vec3 n0 = N, n1 = N, r0 = restUp(b, p, n0), r1 = restFore(b, p, n1);
    float wF = smoothstep(-8.0, 8.0, l.dU - l.dF);     // (across the elbow: both limbs' places, blended)
    vec4 pa = painted(b, mix(r0, r1, wF), 93); vec3 pc = pa.rgb, nr = normalize(mix(n0, n1, wF));
    tw *= unseen(nr, N) * pa.a;                          // (none where her sleeve hid it: its alpha)
    col = mix(col, pc * col / max(skinLight(nr, L, lit, shade, ex, wk), 0.02), tw);
  }
  bool gb = gBare; gBare = gb || tw > 0.0;               // (painted: its sleeve's shadow is the painting's own)
  float ao = mix(clamp(map(p + N * 10.0) / 10.0, 0.0, 1.0), 1.0, pad);   // creases (between the fingers, the elbow's inside)
  gBare = gb;
  // (painted, or the hand: a deep one only (in the hand, a broad one blotted the palm where the fingers leave it))
  col = mix(shade * 0.96, col, 0.55 + 0.45 * mix(ao, smoothstep(0.0, 0.7, ao), max(tw, wk)));
  if (H.part >= 2 && H.part <= 7) {                     // the hand's own soft shadow (the fingers curled in behind
    float sh = 1.0, t = 3.0; vec3 o = p + N * 2.0;       // its thumb and first finger in their shade, a little pink,
    vec3 Ls = normalize(L + vec3(0.0, 0.0, 0.8));        // as painted; from nearer in front: side by side, straight
    for (int i = 0; i < 16; i++) {                       // fingers cast no streaks on each other, none painted)
      float d = map(o + Ls * t); sh = min(sh, 5.0 * d / t); t += clamp(d, 2.0, 10.0);
      if (sh < 0.02 || t > 90.0) break;
    }
    // (none on its flat palm (pad): its thenar's lay across it as a wedge; none with its palm to us: its middle finger's
    // darkened the ring finger behind it; neither painted)
    float noSh = max(pad, smoothstep(0.6, 0.9, -uA[b + 97].z) * pm);
    col = mix(mix(shade, uHBlush, 0.25) * 0.97, col, mix(0.3 + 0.7 * smoothstep(0.0, 1.0, max(sh, 0.0)), 1.0, noSh));
  }
  // (its fingers' palm side pinker than its palm, past the palm's edge (by the way along the hand, not which part is
  // nearest: the webs between them are the palm's, and showed as pale blocks))
  col = mix(col, uHBlush, 0.07 * smoothstep(0.5, 0.62, q.y) * smoothstep(0.3, 0.8, pm) * wk);
  float nailOn = 0.0;
  if (H.f >= 0) {                                        // fingertips pinker, nails
    vec3 nd = uA[b + 44 + H.f].xyz;                      // (its nail's way: out of its back)
    float pf = smoothstep(-0.1, 0.5, -dot(N, nd)) * smoothstep(0.3, 0.7, -nd.z), cr = 0.0;
    // (its last bone a little pinker all along from its crease, as she paints it, most with its pad to us; a little more
    // to its tip (P11: hers 11 darker in green than its middle bone; ours were 33, its tips read dark))
    int oj = H.f < 4 ? b + 23 + 5 * H.f : b + 42; vec3 J2 = uA[oj].xyz, aj = uA[oj + 1].xyz - J2;
    float tipw = H.f < 4 ? smoothstep(2.4, 2.95, H.ft) : smoothstep(1.4, 1.95, H.ft),   // (soft across its crease)
          dis = smoothstep(-0.1, 0.2, dot(p - J2, aj) / dot(aj, aj));
    col = mix(col, uHBlush, 0.05 * tipw + 0.08 * dis * mix(0.4, 1.0, pf));
    // its nail (where its shell is nearer than the tip: nailOf()), its edge a fine line, past the pad its free edge
    // white (as painted)
    // (only seen from over or under it: edge on, its shell's rim round the tip read as a pale ring (her fingertips side
    // on, as at rest, are the finger's own pink to a point, in her ink): nailSeen())
    vec2 ne; float on = onNail(p, H, ne) ? nailSeen(nd) : 0.0; nailOn = on;
    // (its free edge white seen from over or under it; edge on, as a fingertip's side, its point stays the nail's; from
    // under (its pad to us), all of it a pale pink to its edge, no line round it (P11: hers 247, 218, 215, ours a white
    // sliver and a mauve band, its rim's own colour and the light line))
    float under = smoothstep(0.1, 0.3, -nd.z);
    float fe = smoothstep(-0.5, 0.8, ne.y) * max(smoothstep(0.25, 0.55, abs(dot(N, nd))), under);
    vec3 nc = mix(uNail * mix(0.9, 1.0, smoothstep(-0.2, 0.6, dot(N, L))), vec3(0.97, 0.86, 0.84), fe);
    col = mix(col, mix(nc, mix(H_INK, uHLit, 0.55), 0.5 * (1.0 - smoothstep(0.3, 1.2, ne.x)) * (1.0 - under)), on);   // (a light line: her ink's)
    if (H.d2 - H.d < 1.2 * lw && H.d2 < 3.0) col = mix(col, line, 0.85);   // two fingers pressed together
    // (on its palm side, at its joints her lens-shaped creases, thickest in its middle, their ends to points (a band
    // right across read as a tube's ring); only with its pad turned to us (seen from the side, as at rest, she draws
    // none); where it leaves the palm, her palm's edge instead (below))
    if (H.f < 4) { int o = b + 21 + 5 * H.f;
      for (int j = 1; j < 3; j++) { vec3 J = uA[o + j].xyz;
        vec3 ax = normalize(uA[o + j + 1].xyz - uA[o + j - 1].xyz), sx = normalize(cross(ax, nd));
        float s = dot(p - J, sx) / (0.8 * uA[o + j].w), ln = max(1.0 - s * s, 0.0);
        float u = dot(p - J, ax) / (H_CRW * max(ln, 0.2));
        cr = max(cr, (j == 1 ? 1.0 : 0.6) * ln * exp(-u * u)); } }
    col = mix(col, mix(shade, uHBlush, 0.35), H_CRA * pf * cr);
    // (its pad's glint: a short white streak down it toward its tip, where it faces between us and the light)
    float a = H.ft - (H.f < 4 ? 2.0 : 1.0), gl = smoothstep(0.3, 0.5, a) * (1.0 - smoothstep(0.8, 0.95, a));
    col = mix(col, vec3(1.0, 0.97, 0.96), 0.6 * pf * gl * (1.0 - on)
              * smoothstep(0.88, 0.97, dot(N, normalize(vec3(0.3 * L.xy, 1.0)))));
  }
  // its palm's lines (with its palm turned to us: none at rest; on the thumb's base too, where it is the palm: her
  // life line crosses it)
  if (H.part == 2 || (H.part == 7 && q.y < 0.47)) {
    float pl = 0.0;                                      // (each tapered: H_PLW px at its middle, to points)
    for (int i = 0; i < 3; i++) { vec2 h = bez(q, PLINE[3 * i], PLINE[3 * i + 1], PLINE[3 * i + 2]);
      float w = H_PLW * (0.3 + 0.7 * sin(3.14159 * h.y));
      pl = max(pl, (1.0 - smoothstep(0.1 * w, w, h.x * hln)) * smoothstep(0.0, 0.15, h.y) * (1.0 - smoothstep(0.85, 1.0, h.y))); }
    col = mix(col, mix(shade, uHBlush, 0.5), H_PLA * smoothstep(0.3, 0.8, pm) * smoothstep(0.6, 0.9, -uA[b + 97].z) * pl);
  }
  // her palm's edge over the fingers: a soft line along its arc, the fingers' bases a little in its shade just past it
  // (with the palm turned to us; fading out past the index's and little finger's outer edges)
  if (H.part == 2 || (H.f >= 0 && H.f < 4)) {
    float sl = (palmArc(q.x + 0.002) - palmArc(q.x - 0.002)) / 0.004, e = (q.y - ay) * hln / sqrt(1.0 + sl * sl);
    float a = (1.0 - smoothstep(0.4, 1.4, abs(e - 0.5))) * H_PLA + 0.12 * smoothstep(0.0, 1.5, e) * (1.0 - smoothstep(2.0, 9.0, e));
    col = mix(col, mix(shade, uHBlush, 0.5), a * wk * smoothstep(0.3, 0.8, pm) * smoothstep(0.6, 0.9, -uA[b + 97].z)
                                              * (1.0 - smoothstep(0.19, 0.24, abs(q.x - 0.04))));
  }
  // (the hand in her own pinks: its tones by their lightness onto her painted hands' (not its nails))
  if (wk > 0.0) col = mix(col, herTone(col), wk * (1.0 - nailOn));
  vec4 sv = uA[b + 64];
  if (H.part == 0 && tw <= 0.0) {                        // the sleeve's shadow under its hem (painted: its own)
    float hem = sv.z > 0.5 ? sv.x : uA[b + 49].x, sh = smoothstep(hem + 0.14, hem + 0.02, H.t);
    col = mix(col, shade * 0.97, 0.75 * sh);
  }
  return col;
}
// its sleeve at p: its ramp's colour down it (lit, shade), the same light; its inside in shadow, its hem outlined.
// Her painted sleeve, if the pack has its painting: that, as lit now over as lit at rest, its hem the painting's (px in
// from its painted edge: its alpha) with its line along it (hemSd: what's past it is cut away, main())
vec3 clothLight(vec3 N, vec3 L, vec3 lit, vec3 shade) {
  vec3 col = mix(shade, lit, smoothstep(0.22, 0.42, dot(N, L)));   // (a cel's crisper edge: her painted sleeve's
  return mix(col, shade, 0.45 * pow(1.0 - max(N.z, 0.0), 4.0));     // inner third is in shade)
}
float hemSd(Hit H, vec3 p) {                             // (far in, but about its painted hem; where the painting
  int b = H.a * ${NA}; vec4 sv = uA[b + 64]; float sd = uA[b + 87].w;   // has nothing of it (unseen), its own
  if (H.part != 8 || uA[b + 86].w < 0.5 || H.t < sv.x - 0.2) return 1e5;   // straight one's (turned: no cuts and
  // lines from its painted sides' edges); which way it faces: its tube's, out from its middle (its thin rim's own
  // normal flickers, and its inside's points in: both cut alike)
  vec3 G = uA[b].xyz, E = uA[b + 1].xyz, W = uA[b + 2].xyz;
  bool up = H.t <= 1.0; vec3 o = up ? G : E, ax = normalize(up ? E - G : W - E);
  vec3 q = p - o - uA[b + 66].xyz * (up ? prof(b + 60, H.t / min(sv.x, 1.0)) : 0.0);
  vec3 N = normalize(q - ax * dot(q, ax)), n = N, r = restUp(b, p, n);
  float own = (sv.x - H.t) * (up ? length(E - G) : length(W - E));
  return mix(clamp(own, -sd, sd), (painted(b, r, 94).a - 0.5) * 2.0 * sd, unseen(normalize(n), N));
}
vec3 cloth(vec3 p, Hit H, float lw) {
  int b = H.a * ${NA}; vec4 sv = uA[b + 64]; float top = uA[b + 49].z;
  float u = clamp((H.t - top) / (sv.x - top), 0.0, 1.0), row = float(2 * H.a);
  vec3 lit = texture(uRamp, vec2(u, (row + 0.5) / 4.0)).rgb, shade = texture(uRamp, vec2(u, (row + 1.5) / 4.0)).rgb;
  vec3 N = normalAt(p), L = normalize(vec3(H.a == 0 ? -0.55 : 0.55, -0.4, 0.75));
  vec3 col = clothLight(N, L, lit, shade);
  float ao = clamp(map(p + N * 8.0) / 8.0, 0.0, 1.0);
  if (H.ft > 0.5) return shade * 0.72;                  // (up inside it)
  if (uA[b + 86].w > 0.5) {
    vec3 n0 = N; vec4 pc = painted(b, restUp(b, p, n0), 94); n0 = normalize(n0);
    col = mix(col, pc.rgb * col / max(clothLight(n0, L, lit, shade), 0.02), unseen(n0, N));
    col = mix(shade * 0.9, col, 0.6 + 0.4 * smoothstep(0.0, 0.7, ao));
    float sd = hemSd(H, p);
    return mix(col, uSLine[H.a], 1.0 - smoothstep(lw * 0.7, lw * 1.3, sd));
  }
  col = mix(shade * 0.9, col, 0.6 + 0.4 * ao);
  float hemPx = (sv.x - H.t) * (H.t <= 1.0 ? length(uA[b + 1].xyz - uA[b].xyz) : length(uA[b + 2].xyz - uA[b + 1].xyz));
  return mix(col, uSLine[H.a], 1.0 - smoothstep(lw * 0.7, lw * 1.3, hemPx));
}

// its place in the layers: 0 behind her, 1 under her shirt and sleeve, 2 over her front, 3 over her face
float layer(vec2 xy, float zz, int part, int A, float ft) {
  float k = clamp((xy.y - uTorso.y) / (uTorso.w - uTorso.y), 0.0, 1.0);
  float cx = mix(uTorso.x, uTorso.z, k), rx = mix(uTorsoW.x, uTorsoW.y, k), ux = (xy.x - cx) / rx;
  float zt = abs(ux) < 1.0 ? uTorsoW.z * rx * sqrt(1.0 - ux * ux) : 0.0;   // her body's front (and back) there
  float cls = 2.0;
  bool upper = part == 0 || part == 8;
  vec3 G0 = uA[A * ${NA}].xyz, ua = normalize(uA[A * ${NA} + 1].xyz - G0);
  float za = G0.z + ua.z * max(dot(vec3(xy, zz) - G0, ua), 0.0);   // (its middle's depth there)
  if (part == 8 && ft > 0.5) {                           // (up a sleeve: where its hem is, it's seen through that)
    float hz = G0.z + ua.z * uA[A * ${NA} + 64].x * length(uA[A * ${NA} + 1].xyz - G0);
    zz = max(zz, hz); za = hz;
  }
  if (zz < -zt - 6.0 && (abs(ux) < 1.0 || zz < -40.0)) cls = 0.0;
  // (hanging by her side, under her shirt's edge; raised or well out in front of her, over it)
  else if (upper && ((abs(ux) >= 0.95 && za < 40.0 && ua.y > 0.3) || zz < zt + 15.0)) cls = 1.0;
  vec2 hd = (xy - uHead.xy) / uHead.z;                  // (her face, and her neck down to where the head's pieces end)
  float r2 = dot(hd, hd);
  bool face = r2 < 1.0 || (hd.y > 0.0 && hd.y * uHead.z < uHead.w && abs(hd.x) < 0.45);
  if (face && part >= 1 && part != 8) cls = zz > -20.0 ? 3.0 : 0.0;
  else if (r2 < 2.0 && zz > 0.0 && part >= 1 && part != 8) cls = 3.0;   // (beside it, in front: over the hair there)
  return cls;
}
float wkOf(Hit H) { return H.part == 1 ? smoothstep(0.7, 1.0, H.t) : H.part >= 2 && H.part < 8 ? 1.0 : 0.0; }
vec3 lineOf(Hit H, float wk) {
  return H.part == 9 ? uA[H.a * ${NA} + 72].xyz : H.part == 8 ? uSLine[H.a] : mix(uLine, H_INK, wk); }
// a held prop at p: its two cel tones over a crisp terminator, in shade where the fingers press it; a cylinder's end
// (a cup's drink, a bottle's cap) its own colour; a hard highlight if glossy
vec3 propCol(vec3 p, Hit H) {
  int b = H.a * ${NA}; vec3 N = normalAt(p), L = normalize(vec3(H.a == 0 ? -0.55 : 0.55, -0.4, 0.75));
  vec3 lit = uA[b + 70].xyz, sh = uA[b + 71].xyz;
  if (int(uA[b + 67].w + 0.5) == 1 && uA[b + 70].w > 0.5) {
    vec3 ax = normalize(uA[b + 68].xyz - uA[b + 67].xyz);
    if (dot(N, ax) > 0.75 && dot(p - uA[b + 68].xyz, ax) > -uA[b + 69].w - 1.0) { lit = uA[b + 75].xyz; sh = lit * vec3(0.8, 0.72, 0.84); }
  }
  float ao = clamp(map(p + N * 8.0) / 8.0, 0.0, 1.0);
  float tone = smoothstep(0.16, 0.26, dot(N, L)) * smoothstep(0.35, 0.6, ao);
  vec3 col = mix(sh, lit, tone);
  float g = uA[b + 75].w;
  if (g > 0.0) { float s = dot(N, normalize(L + vec3(0.0, 0.0, 1.0)));
    col = mix(col, mix(lit, vec3(1.0), 0.8), smoothstep(0.985 - 0.03 * g, 0.99 - 0.03 * g, s)); }
  return col;
}
vec4 tap(int A, vec2 uv) {
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
  return A == 0 ? textureLod(uCard0, uv, 0.0) : textureLod(uCard1, uv, 0.0);
}
// a held picture (an image prop): a card through the fist, turned about its stem to face us (its plane through the
// stem's axis); its texels (premultiplied), outlined where its alpha ends (taps a line's width out); zc its depth here
vec4 card(int A, vec2 xy, out float zc) {
  int b = A * ${NA}; zc = -1e5;
  if (int(uA[b + 67].w + 0.5) != 4) return vec4(0.0);
  vec3 n = uA[b + 73].xyz, G = uA[b + 74].xyz, u = uA[b + 69].xyz, dn = -uA[b + 68].xyz;
  if (abs(n.z) < 0.08) return vec4(0.0);
  float W = uA[b + 71].w, Hc = uA[b + 72].w;
  vec3 sx = vec3(1.0, 0.0, -n.x / n.z), sy = vec3(0.0, 1.0, -n.y / n.z);   // (the plane's steps per canvas px)
  zc = G.z - (n.x * (xy.x - G.x) + n.y * (xy.y - G.y)) / n.z;
  vec3 q = vec3(xy, zc) - G;
  vec2 uv = vec2(uA[b + 73].w + dot(q, u) / W, uA[b + 74].w + dot(q, dn) / Hc);
  vec2 ux = vec2(dot(sx, u) / W, dot(sx, dn) / Hc), uy = vec2(dot(sy, u) / W, dot(sy, dn) / Hc);
  vec4 c = tap(A, uv); float ring = 0.0, lw = uLineW * 0.8;
  for (int i = 0; i < 12; i++) { float an = float(i) * 0.5236; ring = max(ring, tap(A, uv + (cos(an) * ux + sin(an) * uy) * lw).a); }
  ring = smoothstep(0.25, 0.6, ring) * (1.0 - c.a);
  return vec4(c.rgb + uA[b + 72].xyz * ring, c.a + ring);
}

void main() {
  vec2 xy = vC;
  bool on0 = uOn.x == 1 && min(seg2(xy, uBnd[0]) - uBndR[0].x, min(seg2(xy, uBnd[1]) - uBndR[0].y, seg2(xy, uBnd[2]) - uBndR[0].z)) < 0.0;
  bool on1 = uOn.y == 1 && min(seg2(xy, uBnd[3]) - uBndR[1].x, min(seg2(xy, uBnd[4]) - uBndR[1].y, seg2(xy, uBnd[5]) - uBndR[1].z)) < 0.0;
  if (!on0 && !on1) discard;
  // a held picture here (the nearer, if both hands have one), in its hand's place in the layers (at its grip)
  float zc = -1e5, zc1 = -1e5; int ca = 0;
  vec4 cc = on0 ? card(0, xy, zc) : vec4(0.0), c1 = on1 ? card(1, xy, zc1) : vec4(0.0);
  if (c1.a > 0.0 && (cc.a <= 0.0 || zc1 > zc)) { cc = c1; zc = zc1; ca = 1; }
  vec4 gp = uA[ca * ${NA} + 74];
  float ccls = cc.a > 0.0 ? layer(gp.xy, gp.z, 2, ca, 0.0) : 0.0;
  float z = 1300.0, lmin, lz;
  bool hit = march(xy, z, lmin, lz);
  // (past her painted sleeve's hem there's no cloth: the ray goes on, sleeves left out; nor its outline there)
  if (hit) { if (hemSd(mapD(vec3(xy, z)), vec3(xy, z)) < 0.0) { gBare = true; z = 1300.0; hit = march(xy, z, lmin, lz); } }
  else if (lmin < uLineW + uPx && hemSd(mapD(vec3(xy, lz)), vec3(xy, lz)) < 0.0) lmin = 1e5;
  if (!hit && lmin > uLineW + uPx) { if (cc.a <= 0.0) discard; oAux = vec4(ccls / 3.0, 1.0, 0.0, 1.0); oCol = cc; return; }
  float zz = hit ? z : lz;
  Hit H = mapD(vec3(xy, zz));
  float wk = wkOf(H);                                    // her forearm's tones into her hand's
  float lw = H.part == 9 ? uLineW * 0.8 : uLineW * mix(1.0, 0.75, wk), lineA = 1.0 - smoothstep(lw - 0.5 * uPx, lw + 0.5 * uPx, lmin);   // the outline
  // a prop's place in the layers is its hand's (at its grip: the prop is part of the hand)
  vec4 hg = uA[H.a * ${NA} + 74];
  float cls = H.part == 9 ? layer(hg.xy, hg.z, 2, H.a, 0.0) : layer(xy, zz, H.part, H.a, H.ft);
  bool inside = H.part == 8 && H.ft > 0.5;
  vec3 line = lineOf(H, wk);
  // (round a nail's free edge: a light line, as painted)
  if (H.f >= 0 && H.ft > (H.f < 4 ? 2.3 : 1.3)) { vec2 ne; if (onNail(vec3(xy, zz), H, ne))
    { vec3 nd = uA[H.a * ${NA} + 44 + H.f].xyz;           // (from under, its free edge: lighter still, as hers)
      line = mix(line, mix(H_INK, uHLit, mix(0.45, 0.75, smoothstep(0.1, 0.3, -nd.z))), nailSeen(nd)); } }
  vec4 arm = vec4(0.0);
  if (!hit) arm = vec4(line * lineA, lineA);
  else {
    vec3 p = vec3(xy, z), col; float al = 1.0;
    if (H.part == 9) {
      col = propCol(p, H);
      if (H.dq < lw) col = mix(col, line, 1.0 - smoothstep(lw * 0.6, lw, H.dq));   // (where a finger meets it: a line)
    } else if (H.part != 8) col = skin(p, H, wk, lw, line);
    else {
      col = cloth(p, H, lw);
      float sa = uA[H.a * ${NA} + 64].w;
      if (sa < 0.999) {                                  // a sheer sleeve: the arm under it, if it's there
        gBare = true; float z2 = z - 1.0, l2, lz2;
        vec3 under = vec3(0.0); float ua = 0.0;
        if (march(xy, z2, l2, lz2)) {
          Hit H2 = mapD(vec3(xy, z2));
          under = skin(vec3(xy, z2), H2, wkOf(H2), lw, line); ua = 1.0;
        }
        gBare = false;
        col = col * sa + under * (1.0 - sa) * ua; al = sa + (1.0 - sa) * ua;   // (premultiplied)
      }
    }
    // a part in front of another: its outline over it (not up a sleeve: its rim's own line is enough), in its colour;
    // faded in with the gap behind it (a hard 10 px cut broke it into dashes where a thumb or finger lies that near);
    // within the hand thinner and lighter, as her lines inside her hands are (measured at rest: her darkest 138, 55, 57,
    // ours were 108, 31, 39 and a third more of them)
    if (lmin < lw && lz - z > 7.0 && !inside) { Hit HL = mapD(vec3(xy, lz)); float wl = wkOf(HL);
      bool hh = wk > 0.0 && wl > 0.0; float iw = hh ? 0.65 * lw : lw;
      float ia = 1.0 - smoothstep(iw - 0.5 * uPx, iw + 0.5 * uPx, lmin);
      if (HL.a == H.a && HL.part >= 3 && HL.part < 8 && HL.part != H.part) ia = 0.0;   // (another digit's: its own, below)
      if (hemSd(HL, vec3(xy, lz)) >= 0.0) col = mix(col, mix(lineOf(HL, wl), col, hh ? 0.2 : 0.0) * al, ia * smoothstep(7.0, 14.0, lz - z)); }
    // each finger and the thumb outlined over what is behind it as a form of its own, as hers are (as the lines inside
    // the hand: thinner, lighter); faded only where it sinks into what's behind (a knuckle's bone in the palm)
    if (!inside && H.part >= 1 && H.part < 8) { float iw = 0.65 * lw; vec2 ol = ownLine(p, H, iw + uPx);
      float oa = (1.0 - smoothstep(iw - 0.5 * uPx, iw + 0.5 * uPx, ol.x)) * smoothstep(1.0, 4.0, ol.y);
      col = mix(col, mix(H_INK, col, 0.2) * al, oa); }
    arm = vec4(col, al);
  }
  // the picture and the arm: the nearer over the other
  vec4 o = arm;
  if (cc.a > 0.0) {
    if (zc > zz) { o = cc + arm * (1.0 - cc.a); if (cc.a > 0.5 || arm.a <= 0.0) cls = ccls; }
    else o = arm + cc * (1.0 - arm.a);
  }
  if (o.a <= 0.0) discard;
  oAux = vec4(cls / 3.0, 1.0, 0.0, 1.0);
  oCol = o;
}`;

const CS = `#version 300 es
precision highp float;
out vec4 oCol;
uniform sampler2D uArmC, uArmA; uniform float uSlot; uniform int uSS;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy) * uSS; vec4 c = vec4(0.0), n = vec4(0.0);
  for (int j = 0; j < ${SS * SS}; j++) { ivec2 o = q + ivec2(j % uSS, j / uSS);
    if (j >= uSS * uSS) break;
    vec4 a = texelFetch(uArmA, o, 0); c += texelFetch(uArmC, o, 0);
    if (a.g > 0.0 || a.a > 0.0) n[int(a.r * 3.0 + 0.5)] += 1.0; }
  // the whole px goes in one place (its subsamples' most; split between two, the layers between showed through)
  float best = max(max(n.x, n.y), max(n.z, n.w)); int k = n.w == best ? 3 : n.z == best ? 2 : n.y == best ? 1 : 0;
  if (best == 0.0 || float(k) != uSlot) discard;
  oCol = c / float(uSS * uSS);
}`;

export function create(gl, P, H) {
  const D = P.arm3d, U = {}, UC = {};
  const prog = link(gl, H.VS, FS, U), comp = link(gl, H.VS, CS, UC);
  let fb = null, cTex = null, aTex = null, fw = 0, fh = 0, sup = SS;
  const rest = {}, R = {};
  for (const s of SIDES) {                // each arm's rest: its bones' lengths and angles, its measures, as painted
    const A = D[s], sg = s === "L" ? 1 : -1, loc = (p) => [sg * (p[0] - A.joint[0]), p[1] - A.joint[1], 0];
    const E = loc(A.elbow), W = loc(A.wrist), T = loc(A.tip), lu = len(E), u0 = norm(E), v0 = norm(sub(W, E));
    const elev = Math.atan2(u0[0], u0[1]), carry = Math.atan2(v0[0], v0[1]) - elev;
    R[s] = { lu, lf: len(sub(W, E)), hl: 1, hem: A.hem, sg, elev0: elev, carry0: carry, T, u0 };
    // (its hand: the pack's own, fitted to her painted one (arm3d.py's restHand), else a relaxed one)
    const RH = A.restHand;
    rest[s] = { elev, plane: 0, twist: 0, flex: 0, pro: RH ? RH.pro : 0.6, wflex: 0, wdev: 0, carry, ...SHAPES.relaxed,
                ...(RH ? { f: RH.f, spread: RH.spread, t: RH.t } : {}) };
  }
  // the rig's raise, elbow and pitch (her picture's plane, pitched toward us; motion's) as a 3D arm, the upper arm
  // turned out or in for an elbow bent in that plane
  const rig2d = (s, f) => {
    const r0 = rest[s], F = R[s];
    const raise = (f.raise || 0) + (f["raise" + s] || 0), e = f["elbow" + s] || 0, [pa, pf] = f["armP" + s] || [0, 0];
    // the painting's forearm angles out (the carrying angle): hanging, bones' own carry, so the elbow bends forward and
    // the forearm doesn't turn; bent in that plane, folded into the bend (exact, as the painted rig's)
    const w = ss(0.05, 0.4, Math.abs(e) + Math.abs(pf)), el = F.elev0 + raise, fl = el + e + F.carry0 * w;
    const u = [Math.sin(el) * Math.cos(pa), Math.cos(el) * Math.cos(pa), Math.sin(pa)];
    const v = [Math.sin(fl) * Math.cos(pa + pf), Math.cos(fl) * Math.cos(pa + pf), Math.sin(pa + pf)];
    // her palm: toward her, a little back, hanging (as painted); raised past ~45 degrees, down; the forearm pointing
    // up, toward us (export.PALM's open hand) (at 45 degrees or higher, they can be palm down, or palm forward;
    // lower, palm-down (facing her), but also palm back)
    const up = ss(1.2, 2.2, raise + e), hi = Math.max(up, ss(0.6, 0.95, Math.acos(clamp(v[1], [-1, 1]))));
    const low = [-Math.cos(r0.pro), 0, -Math.sin(r0.pro)], high = norm(add(mul([0, 1, 0], 1 - up), mul([0, 0, 1], up)));
    const q = solve(r0, u, v, norm(add(mul(low, 1 - hi), mul(high, hi))), [0, 0, 1], w);
    return { ...q, carry: F.carry0 * (1 - w), wflex: r0.wflex, wdev: r0.wdev,
             ...(up > 0.5 ? SHAPES.open : { f: r0.f, spread: r0.spread, t: r0.t }) };
  };
  for (const s of SIDES) {
    const A = D[s], T = R[s].T;
    // its hand: as long as the painting's, its relaxed middle fingertip as far from the wrist; its wrist turned (a
    // little) to put that tip where the painting has it
    // (a fitted one: its own length and wrist)
    const B0 = bones(R[s], rig2d(s, {})), tip0 = B0.fingers[1].pts[4], RH = A.restHand;
    R[s].hl = RH ? RH.hl : Math.hypot(T[0] - B0.W[0], T[1] - B0.W[1]) / Math.hypot(tip0[0] - B0.W[0], tip0[1] - B0.W[1]);
    if (RH && RH.palm) { R[s].palm = RH.palm; R[s].pro0 = RH.pro; }
    if (RH) { rest[s].wflex = RH.wflex; rest[s].wdev = RH.wdev; }
    let best = 1e9;
    for (let a = -0.3; a <= 0.3 && !RH; a += 0.01) for (let b = -0.3; b <= 0.3; b += 0.01) {
      const t = bones(R[s], { ...rig2d(s, {}), wflex: a, wdev: b }).fingers[1].pts[4];
      const d = Math.hypot(t[0] - T[0], t[1] - T[1]) + 20 * (a * a + b * b);
      if (d < best) { best = d; rest[s].wflex = a; rest[s].wdev = b; }
    }
    const lw = D.line || 3.2;
    // widths across, as painted (its outline inside them: ours is drawn outside the shape) -> 16 samples
    const sample = (rows, f) => Array.from({ length: 16 }, (_, i) => {
      const t = i / 15, j = rows.findIndex((r) => r[0] >= t);
      const w = j < 0 ? rows[rows.length - 1][2] : j === 0 ? rows[0][2] * f(t, rows[0][0])
        : rows[j - 1][2] + (rows[j][2] - rows[j - 1][2]) * (t - rows[j - 1][0]) / (rows[j][0] - rows[j - 1][0]);
      return w / 2 - lw;
    });
    // its middle, as painted: off the bone's line by the painting's middle there (arm3d.py's rows), out along the
    // elbow's hinge (to her side) as that is at rest (else her arm sat a few px off the painting's all down it)
    const B = bones(R[s], rig2d(s, {}));
    const pt0 = (p) => [A.joint[0] + R[s].sg * p[0], A.joint[1] + p[1], p[2]], dir0 = (v) => [R[s].sg * v[0], v[1], v[2]];
    const mids = (rows, P0, P1, kc) => {
      const d = norm(sub(P1, P0)), f = dot([-d[1], d[0], 0], kc);
      return Array.from({ length: 16 }, (_, i) => {
        const t = i / 15, j = rows.findIndex((r) => r[0] >= t);
        const m = j < 0 ? rows[rows.length - 1][1] : j === 0 ? rows[0][1]
          : rows[j - 1][1] + (rows[j][1] - rows[j - 1][1]) * (t - rows[j - 1][0]) / (rows[j][0] - rows[j - 1][0]);
        return m * f;
      });
    };
    R[s].offU = mids(A.upper, A.joint, A.elbow, dir0(B.k));
    R[s].offF = mids(A.fore, A.elbow, A.wrist, dir0(norm(sub(B.k, mul(B.v, dot(B.k, B.v))))));
    R[s].up = sample(A.upper, (t, t0) => 1 + 0.1 * ss(t0, 0, t));   // (round into the shoulder under the sleeve)
    if (A.sleeve) R[s].up = R[s].up.map((r, i) => {     // (but inside its painted sleeve, EASE in from its outer side)
      const t = i / 15, rows = A.sleeve.rows, j = rows.findIndex((q) => q[0] >= t);
      if (t > rows[rows.length - 1][0] || j < 0) return r;
      const q = rows[j], out = s === "R" ? 1 : -1;
      return Math.min(r, out * q[1] + q[2] / 2 - lw - EASE - R[s].offU[i]);
    });
    const thin = sample(A.fore, () => 1);
    // the forearm's thin and wide half sides: at rest its thin side to us (its turn from rest, the shader's), as wide as
    // painted
    R[s].fa = []; R[s].fb = [];
    thin.forEach((w, i) => {
      const t = i / 15, ratio = 1 + (WIDE - 1) * ss(0.15, 1, t), th = 0;
      const wa = add(mul(B.af, Math.cos(th)), mul(B.m, Math.sin(th))), tn = sub(mul(B.m, Math.cos(th)), mul(B.af, Math.sin(th)));
      const sx = norm(cross(B.v, [0, 0, 1]));
      const b = w / Math.hypot(ratio * dot(wa, sx), dot(tn, sx));
      R[s].fb.push(b); R[s].fa.push(b * ratio);
    });
    // where each part of it was at rest, the painting's (the pack's arm3d.png: restUp, restFore in the shader)
    R[s].at0 = { G: pt0(B.G), u: dir0(B.u), k: dir0(B.k), f: dir0(cross(B.k, B.u)), E: pt0(B.E), v: dir0(B.v),
                 af: dir0(B.af), m: dir0(B.m), pro: B.pro };
    R[s].k0 = B.k;                                // (its own way out to her side at rest: its sleeve's top's)
  }
  // her painting at rest, her arms and sleeves (arm3d.py, all on one picture), uploaded as it is (straight colours;
  // its alpha her sleeve's edge); the page's ready once it's in (api.loaded)
  const armTex = gl.createTexture();
  let texOn = false;
  gl.activeTexture(gl.TEXTURE12);
  gl.bindTexture(gl.TEXTURE_2D, armTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  gl.bindTexture(gl.TEXTURE_2D, null);
  const loaded = !D.tex ? null : (H.loadAssetBlob ? H.loadAssetBlob(D.tex.file) : fetch(D.tex.file).then((r) => r.blob()))
    .then((b) => createImageBitmap(b, { premultiplyAlpha: "none", colorSpaceConversion: "none" }))
    .then((im) => {
      gl.activeTexture(gl.TEXTURE12);
      gl.bindTexture(gl.TEXTURE_2D, armTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, im);
      gl.bindTexture(gl.TEXTURE_2D, null); texOn = true;
    }).catch((e) => console.warn("arm3d: no painting of her arms", e));
  // its sleeves: the painting's (arm3d.py's measures of it), or any given (setSleeve), as a ramp of colours down each
  const lw0 = D.line || 3.2, ramp = gl.createTexture(), sleeve = { R: null, L: null };
  const at16 = (prof, t) => { const x = Math.max(0, Math.min(1, t)) * 15, i = Math.min(14, Math.floor(x));
    return prof[i] + (prof[i + 1] - prof[i]) * (x - i); };
  const colours = (c, n) => {              // one colour, or a list of them evenly down it -> n
    if (typeof c[0] === "number") return Array.from({ length: n }, () => c);
    return Array.from({ length: n }, (_, i) => { const x = i / (n - 1) * (c.length - 1), j = Math.min(c.length - 2, Math.floor(x));
      return c[j].map((v, k) => v + (c[j + 1][k] - v) * (x - j)); });
  };
  const upload = () => {
    const px = new Uint8Array(RAMP_W * 4 * 4);
    SIDES.forEach((s, ai) => { const S = sleeve[s]; if (!S) return;
      const lit = colours(S.lit, RAMP_W), shade = colours(S.shade || colours(S.lit, RAMP_W).map((c) => [c[0] * 0.78, c[1] * 0.68, c[2] * 0.8]), RAMP_W);
      [lit, shade].forEach((cs, r) => cs.forEach((c, i) => px.set([...c.map((v) => Math.round(255 * v)), 255], 4 * (RAMP_W * (2 * ai + r) + i)))); });
    gl.bindTexture(gl.TEXTURE_2D, ramp);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, RAMP_W, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindTexture(gl.TEXTURE_2D, null);
  };
  // a sleeve: { hem, top, ease (px out from the arm: a number, or 16 down to its hem or elbow), foreEase (down the
  // forearm, a long sleeve's), wall, alpha (1 opaque), lit, shade (a colour, or a list down it from top to hem), line };
  // rows: the painting's [t, middle, width] down it (arm3d.py): each side where the painting's is or round the arm
  // (EASE off it), whichever is farther out (the arm can't come through it, raised or turned); its top's cone from
  // halfway up its tip, as wide as the painting's there (its shoulder rounded as painted). null: bare arms
  const setSleeve = (s, spec) => {
    if (!spec) { sleeve[s] = null; upload(); return; }
    const S = { top: -0.15, hem: 0.5, wall: WALL, alpha: 1, ease: EASE, foreEase: 8, line: null, ...spec };
    const hu = Math.min(S.hem, 1), arm = (i) => at16(R[s].up, i / 15 * hu), r16 = [], o16 = [];
    if (S.rows) {
      const rows = S.rows, out = s === "R" ? 1 : -1;
      const row = (t) => { const j = rows.findIndex((r) => r[0] >= t);
        if (j <= 0) return rows[j < 0 ? rows.length - 1 : 0];
        const f = (t - rows[j - 1][0]) / (rows[j][0] - rows[j - 1][0]);
        return rows[j].map((v, k) => rows[j - 1][k] + (v - rows[j - 1][k]) * f); };
      for (let i = 0; i < 16; i++) {
        const [, mid, w] = row(i / 15 * hu), half = w / 2 - lw0, c = at16(R[s].offU, i / 15 * hu);
        const o = Math.max(out * mid + half, c + arm(i) + EASE), inner = Math.min(out * mid - half, c - arm(i) - EASE);
        r16.push((o - inner) / 2); o16.push((o + inner) / 2);
      }
      // (its top, above the joint: the painting's own, slice by slice: 6 from its tip down, their middles out to her
      // side and their radii (the tube's own at the joint), kept on her shoulder however the arm turns)
      S.top = rows[0][0];
      const cap = [0, 1, 2, 3, 4, 5].map((i) => row(S.top * (1 - i / 6)));
      S.cap = [...cap.map((c) => out * c[1]), ...cap.map((c) => Math.max(c[2] / 2 - lw0, 1))];
    } else {
      const e = typeof S.ease === "number" ? Array(16).fill(S.ease) : S.ease;
      for (let i = 0; i < 16; i++) { r16.push(arm(i) + e[i]); o16.push(0); }
      if (S.rTop === undefined) S.rTop = r16[0] * 0.6;
    }
    const lit0 = typeof S.lit[0] === "number" ? S.lit : S.lit[S.lit.length >> 1];
    // (her own painted sleeve: drawn with its painting, if the pack has that)
    sleeve[s] = { ...S, r16, o16, line: S.line || lit0.map((v) => v * 0.3), tex: !!(S.part && D[s].tex && D[s].tex.sleeve) };
    upload();
  };
  for (const s of SIDES) setSleeve(s, D[s].sleeve || null);
  // ---- reaching: her arm's own space from the canvas's (place()'s turned back), points on her body ---------------
  const frame = (f) => ({ ...M0, ...(f || {}) });
  const swing = (s, f) => (f["arm" + s] || 0) + R[s].sg * (f.lift || 0);
  const toLocal = (s, f, p) => {
    const A = D[s], sg = R[s].sg, sh = H.M().shoulder["arm" + s], d = (api.shrug && api.shrug[s]) || [0, 0];
    let g = [p[0], p[1]];
    for (let i = 0; i < 6; i++) { const q = H.torsoFwd(g, f); g = [g[0] + p[0] - q[0], g[1] + p[1] - q[1]]; }
    g = H.rotP(g, sh, -swing(s, f));
    return [sg * (g[0] - A.joint[0] - d[0]), g[1] - A.joint[1] - d[1], p[2]];
  };
  const dirLocal = (s, f, v) => {
    const q = H.rotP(H.rotP([v[0], v[1]], [0, 0], -(f.sway || 0)), [0, 0], -swing(s, f));
    return norm([R[s].sg * q[0], q[1], v[2]]);
  };
  // her body's front at a canvas point (its torso's cylinder), or her head's (a point given its own depth, normal)
  const torsoAt = (x, y) => {
    const k = clamp((y - TORSO.y[0]) / (TORSO.y[1] - TORSO.y[0]), [0, 1]), rx = TORSO.w[0] + (TORSO.w[1] - TORSO.w[0]) * k;
    const ux = clamp((x - H.M().bodyC) / rx, [-0.995, 0.995]), c = Math.sqrt(1 - ux * ux);
    return { z: TORSO.depth * rx * c, n: norm([ux, 0, c / TORSO.depth]), rx, ux };
  };
  // Named points on her body she can put a hand on (When they're placed on certain points, they should properly
  // attach): canon px at rest; on her torso (its front there, the hand's palm on it) or her head (its own depth and
  // normal, out of her face); an elbow's way of its own where the free one would be wrong (a hand on a hip: out); its
  // fingers' way ("across" her, "up", or a canvas direction: over her mouth, across it)
  const hc = P.head.centre, hr = P.head.radius, chin = P.head.chin || hr * 0.75, bc = H.M().bodyC;
  const hip = (sg) => ({ at: [bc + sg * 0.93 * torsoAt(bc, 1470).rx, 1470], on: "torso", pole: [1, 0.35, -0.25] });
  // (her face's points ride the layers they're on, arm3d.on's: her face, her mouth; the mouth's its middle at rest)
  const ON = D.on || {}, key0 = P.samples.reduce((a, b) => (Math.abs(b.angle) < Math.abs(a.angle) ? b : a));
  const mid = (id) => { const i = P.layers.findIndex((L) => L.id === id); return i < 0 ? null : key0.layers[i].t; };
  const points = {
    chest: { at: [bc, 1060], on: "torso", lift: 35 }, belly: { at: [bc, 1390], on: "torso" },
    heartL: { at: [bc + 95, 1080], on: "torso", lift: 30 }, heartR: { at: [bc - 95, 1080], on: "torso", lift: 30 },
    hipR: hip(-1), hipL: hip(1),
    // (the hand nearly as long as her face: its palm on her jaw's side, its fingers along her cheek; over her mouth,
    // its fingers there, the palm beside it, held a little out in front (nearer, her elbow was folded to its limit and,
    // as her head turned, lurched along it))
    cheekR: { at: [hc[0] - 0.6 * hr, hc[1] + 0.68 * hr], on: "head", layer: ON.face, z: 30, n: [-0.85, 0.1, 0.5],
              fingers: "up", shape: "flat" },
    cheekL: { at: [hc[0] + 0.6 * hr, hc[1] + 0.68 * hr], on: "head", layer: ON.face, z: 30, n: [0.85, 0.1, 0.5],
              fingers: "up", shape: "flat" },
    // (the thinker's: a loose fist under it, its back to us, the forearm up from below; under her drawn chin, down
    // her head's tilted axis)
    chin: { at: key0.chinAt ? [key0.chinAt[0] + 0.12 * hr * P.head.ev[0], key0.chinAt[1] + 0.12 * hr * P.head.ev[1]]
              : [hc[0], hc[1] + chin + 0.12 * hr], on: "head", layer: ON.face, z: 95, n: [0, 0.15, 1], fingers: "up",
            shape: "fist" },
    mouth: { at: mid(ON.mouth) || [hc[0], hc[1] + 0.62 * chin], on: "head", layer: ON.mouth, z: 180, n: [0, 0.05, 1],
             fingers: "across", touch: "fingers", shape: "flat" },
    // (on the crown a little toward its own arm (side: out its way) and in front of her head's middle: dead on top, as
    // her head turned away from that arm it was past what a shoulder can reach, and the arm jumped about at its limits)
    headTop: { at: [hc[0], hc[1] - 0.9 * hr], side: 0.25 * hr, on: "head", z: 60, n: [0, -1, 0.1] },
    shoulderR: { at: [...H.M().shoulder.armR], on: "body", z: 25, n: [0, -0.6, 0.8] },
    shoulderL: { at: [...H.M().shoulder.armL], on: "body", z: 25, n: [0, -0.6, 0.8] },
  };
  // a point's canvas place and outward normal now: her body's moves on it (on her torso's front, or at its own depth),
  // or on her head as its layers move (the page's layerFwd: its layer's turn keyform; else headFwd, turned on its
  // cylinder; rolled, the base roll too), its normal turned and rolled
  const surface = (p, f) => {
    const n = norm(p.n || [0, 0, 1]);
    if (p.on !== "head" || !H.headFwd) {
      const q = H.torsoFwd(p.at, f);
      if (p.on === "torso") { const t = torsoAt(q[0], q[1]); return { at: [q[0], q[1], t.z + (p.lift || 0)], n: t.n }; }
      return { at: [q[0], q[1], p.z || 0], n };
    }
    const m = { roll: 0, a: 0, ...f }, tn = P.head.turn || { R: 0, L: 0 }, a = Math.abs(m.a) * (m.a < 0 ? tn.R : tn.L);
    const q = p.layer && H.layerFwd ? H.layerFwd(p.layer, p.at, m) : H.headFwd(p.at, m, a), ny = [n[0] * Math.cos(a) + n[2] * Math.sin(a), n[1], n[2] * Math.cos(a) - n[0] * Math.sin(a)];
    const nr = H.rotP(H.rotP([ny[0], ny[1]], [0, 0], H.M().roll0 + m.roll), [0, 0], m.sway || 0);
    return { at: [q[0], q[1], p.z || 0], n: [nr[0], nr[1], ny[2]] };
  };
  // the pose that puts a side's palm on a point (a name, a points entry, or { at: [x, y, z], n }), the palm into it:
  // its elbow (two bones to the wrist, bent the pole's way), the forearm turned and the wrist bent to face the palm
  // in, the wrist moved by the palm's miss a few times over (the palm's middle is off the wrist)
  // (only: the one elbow pole to try, by its index; ref: this reach's last pose, its turns kept within half a turn of
  // it: a turn past its limits near half a turn round (her hand on her head, the arm all but straight) else came out
  // just short of +pi one frame and just past -pi the next, clamped to opposite ends, and the arm jumped across)
  const reach = (s, target, f, only, ref) => {
    f = frame(f);
    let p = typeof target === "string" ? points[target] : target;
    if (p.side) p = { ...p, at: [p.at[0] + R[s].sg * p.side, p.at[1]] };
    const S = p.n && p.at.length === 3 ? p : surface(p, f);
    const lu = R[s].lu, lf = R[s].lf, n = norm(S.n);
    const goal = toLocal(s, f, add(S.at, mul(n, HAND.meta * R[s].hl * 1.15))), nl = mul(dirLocal(s, f, n), -1);
    const shape = SHAPES[p.shape || "relaxed"];
    // (what touches it: the palm's middle, or the fingers' (their last joints))
    const at = p.touch === "fingers" ? (B) => mul(B.fingers.reduce((a, F) => add(a, F.pts[3]), [0, 0, 0]), 1 / 4) : palmMid;
    // (across: up across her, as a forearm from below lets them; up: up and back, along her face's side)
    const fd = !p.fingers ? null : p.fingers === "up" ? norm([0.5, -1, 0]) : p.fingers === "across" ? norm([-1, -0.4, 0])
      : dirLocal(s, f, p.fingers);
    const to = (W, pole) => {                // two bones to W, the elbow bent the pole's way; the palm turned to nl
      const d = clamp(len(W), [Math.abs(lu - lf) + 1, lu + lf - 1]), wn = norm(W), Wd = mul(wn, d);
      const a = (lu * lu - lf * lf + d * d) / (2 * d), hgt = Math.sqrt(Math.max(lu * lu - a * a, 0));
      const pp = sub(pole, mul(wn, dot(pole, wn))), E = add(mul(wn, a), mul(len(pp) > 1e-6 ? norm(pp) : [0, 0, -1], hgt));
      const q = { ...solve(rest[s], norm(E), norm(sub(Wd, E)), nl, pole, 1), wdev: 0, ...shape };
      if (ref) for (const k of ["plane", "twist", "pro"]) q[k] = ref[k] + Math.atan2(Math.sin(q[k] - ref[k]), Math.cos(q[k] - ref[k]));
      const B = bones(R[s], { ...q, wflex: 0 }), pn = mul(B.n, -1);   // (the wrist bends the palm the rest of the way)
      q.wflex = clamp(Math.atan2(-dot(nl, B.v), dot(nl, pn)), LIMIT.wflex);
      if (fd) {                              // (and its tips turned toward fd: the wrist's sideways bend)
        const B1 = bones(R[s], q);
        q.wdev = clamp(Math.atan2(dot(fd, B1.r), dot(fd, B1.h)), LIMIT.wdev);
      }
      return q;
    };
    let best = null;
    const poles = (p.pole ? [p.pole] : POLES).map(norm);
    for (let i = 0; i < poles.length; i++) {
      if (only !== undefined && i !== only) continue;
      const pole = poles[i];
      // (a fixed count of steps, each moving the wrist by most of the miss, kept within a hand of the goal and the
      // arm's reach: a count that ended where a step stopped helping changed from frame to frame as she moved, and
      // the arm jumped; unkept, a limit in the way sent the wrist off)
      const hl = R[s].hl, far = lu + lf - 2;
      let W = goal, q, B, miss;
      for (let it = 0; it < 6; it++) {
        q = to(W, pole); B = bones(R[s], q);
        const c = at(B); miss = len(sub(goal, c));
        if (it === 5) break;
        let off = sub(add(W, mul(sub(goal, c), 0.8)), goal);
        if (len(off) > hl) off = mul(norm(off), hl);
        W = add(goal, off);
        if (len(W) > far) W = mul(norm(W), far);
      }
      // (and, as she would: her elbow not raised past level, her wrist not bent far; and not a pole nearly along the
      // way to the wrist, where the bend's way is hardly named and swings round as she moves)
      const wn = norm(W), side = len(sub(pole, mul(wn, dot(pole, wn))));
      const score = miss + 60 * (1 - dot(mul(B.n, -1), nl)) + (fd ? 60 * (1 - dot(B.h, fd)) : 0)
        + 30 * Math.max(0, Math.acos(clamp(B.u[1], [-1, 1])) - 1.3) + 10 * Math.abs(q.wflex) + 300 * Math.max(0, 0.45 - side);
      if (!best || score < best.score) best = { q, score, i };
    }
    return { ...best.q, reach: p, pole: best.i };
  };
  // the forearm turns (pro) its palm can face from where the arm is (PALM_*): the run of them nearest its own (the
  // wrist straight: the forearm's own turn, whatever the wrist then does)
  const palmRange = (s, pose) => {
    const q = { ...rest[s], ...pose, wflex: 0, wdev: 0 }, B = bones(R[s], q), el = Math.acos(clamp(B.u[1], [-1, 1]));
    const c = palmMid(B), y = D[s].joint[1] + c[1], t = torsoAt(D[s].joint[0] + R[s].sg * c[0], y);
    const over = Math.abs(t.ux) < 0.9 && c[2] > 0, lower = y > Math.max(D.R.elbow[1], D.L.elbow[1]);
    const ok = (pn) => over ? !lower || pn[2] <= 0.25
      : dot(pn, el >= Math.PI / 4 ? PALM_HIGH : PALM_LOW) >= PALM_COS;
    const ps = [], [lo, hi] = LIMIT.pro;
    for (let a = lo; a <= hi + 1e-6; a += 0.05) ps.push([a, ok(mul(bones(R[s], { ...q, pro: a }).n, -1))]);
    const runs = []; let r = null;
    for (const [a, good] of ps) { if (good) { if (!r) runs.push(r = [a, a]); else r[1] = a; } else r = null; }
    if (!runs.length) return [lo, hi];
    const pr = clamp(q.pro, LIMIT.pro), gap = (x) => (pr < x[0] ? x[0] - pr : pr > x[1] ? pr - x[1] : 0);
    return runs.reduce((m, x) => (gap(x) < gap(m) ? x : m));
  };
  // ---- held props (we should be able to make her hold objects by putting them in her hand) ------------------
  // api.hold(side, prop | null): a prop in that hand, gripped (its fingers and thumb closed round it: grip()), riding on
  // the hand's frame, drawn with it and in its place in the layers. Sizes in canon px, colours [r, g, b] 0..1 or
  // "#rrggbb" (shade: by default the colour's own shade; line: by default darker still):
  //   { kind: "cylinder", r, len, grip (where along it the hand is, 0..1), round (its edges'), color, cap (its far end's
  //     colour: a cup's drink, a bottle's lid), gloss (0..1: a hard highlight) }
  //   { kind: "capsule", r, r2 (its far end's radius: a mic's head, a wand's tip), len, grip, color, gloss }
  //   { kind: "sphere", r, color, gloss }
  //   { kind: "image", src (a URL) or image (an ImageBitmap, image or canvas), w (px), h (else by its aspect), at: [u, v]
  //     (where its stem is on it, 0..1: the hand's grip), r (the stem's radius), line (its outline's colour) }
  // A stick's far end (len * (1 - grip) of it) and a picture's top stand out of the fist on the thumb's side. Returns a
  // promise (an image's resolves once it's loaded and drawn)
  const held = { R: null, L: null }, cardTex = [null, null];
  const PROP = { cylinder: { r: 22, len: 130, grip: 0.5, round: 4, color: [0.86, 0.3, 0.36] },
                 capsule: { r: 11, len: 210, grip: 0.3, color: [0.52, 0.38, 0.86] },
                 sphere: { r: 52, color: [0.98, 0.58, 0.24] },
                 image: { r: 8, w: 170, at: [0.5, 0.85], color: [0.5, 0.5, 0.5], line: [0.22, 0.16, 0.2] } };
  const rgb = (c) => (typeof c === "string" ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255) : c);
  const hold = (s, prop) => {
    if (!prop) { held[s] = null; return Promise.resolve(null); }
    if (!PROP[prop.kind]) throw new Error("arm3d.hold: no prop kind " + prop.kind);
    const pr = { ...PROP[prop.kind], ...prop }, hl = R[s].hl;
    const lit = rgb(pr.color), shade = pr.shade ? rgb(pr.shade) : lit.map((v, i) => v * [0.74, 0.62, 0.8][i]);
    const g = grip({ kind: pr.kind, r: pr.r / hl, len: (pr.len || 0) / hl, grip: pr.grip });
    const rec = held[s] = { ...pr, ...g, lit, shade, line: pr.line ? rgb(pr.line) : shade.map((v) => v * 0.3),
                            cap: pr.cap ? rgb(pr.cap) : null, ready: pr.kind !== "image" };
    if (rec.ready) return Promise.resolve(rec);
    const ai = SIDES.indexOf(s);
    return (async () => {
      let img = pr.image;
      if (!img) { img = new Image(); img.crossOrigin = "anonymous"; img.src = pr.src; await img.decode(); }
      // (through a canvas: any source uploads premultiplied the same way)
      const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
      cv.getContext("2d").drawImage(img, 0, 0);
      const t = cardTex[ai] || (cardTex[ai] = gl.createTexture());
      gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
      if (held[s] === rec) { rec.h = pr.h || pr.w * cv.height / cv.width; rec.ready = true; }
      return rec;
    })();
  };
  const memo = new WeakMap();                // (a frame's reaches: a pose is asked for a few times a frame)
  const keep = { R: null, L: null };         // (each reach's elbow pole, chosen once; its last pose)
  const api = {
    on: /[?&]arm3d\b/.test(location.search), override: { R: null, L: null }, rest, R, LIMIT, SHAPES, last: null,
    points, reach, palmRange, toLocal, surface, shapeAt, grip, hold, held,
    sleeve, setSleeve, loaded,
    // the painted arm's parts it's drawn instead of, and its painted sleeve (drawn as cloth, or bare)
    hides: (s) => [`B06${s}`, `B07${s}`, `B08${s}`, ...(D[s].sleeve ? [D[s].sleeve.part] : [])],
    size(W, Hh) {
      sup = Math.max(1, Math.min(SS, Math.floor(gl.getParameter(gl.MAX_TEXTURE_SIZE) / Math.max(W, Hh))));
      fw = W * sup; fh = Hh * sup;
      const mk = () => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); return t; };
      if (cTex) { gl.deleteTexture(cTex); gl.deleteTexture(aTex); gl.deleteFramebuffer(fb); }
      cTex = mk(); aTex = mk(); fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cTex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, aTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null);
    },
    // the pose of a side: an override's (the pose panel's, tracking's), else the rig's
    // (a reach's: solved again each frame, so the hand stays on its point as she moves; its own hand shape kept)
    pose(s, f) {
      const o = api.override[s], g = held[s];
      let q;
      if (!o) q = rig2d(s, f);
      else if (!o.reach) q = { ...rest[s], ...o };
      else {
        const key = f || M0, m = memo.get(key) || {};
        if (!m[s] || m[s].o !== o) {
          // (its elbow's way chosen once, as she stands at rest, then kept: chosen afresh each frame, it flipped
          // between ways from one frame to the next as she moved)
          if (!keep[s] || keep[s].o !== o) keep[s] = { o, i: reach(s, o.reach, M0).pole };
          m[s] = { o, q: reach(s, o.reach, f, keep[s].i, keep[s].q) }; keep[s].q = m[s].q; memo.set(key, m);
        }
        q = { ...m[s].q, ...(o.f ? { f: o.f, t: o.t, spread: o.spread } : {}) };
      }
      // (close: 0 open .. 1 a fist, its shape between theirs (shapeAt); a held prop's grip over any shape)
      if (o && o.close !== undefined && o.close !== null) q = { ...q, ...shapeAt(o.close) };
      if (g) q = { ...q, f: g.f, spread: g.spread, t: g.t };
      return q;
    },
    // the rig's moves with an override's arms: its raise and pitch where that upper arm points, so her painted sleeve
    // follows it (motion's sewn sleeves)
    drive(f) {
      if (!api.override.R && !api.override.L) return f;
      const g = { ...f };
      for (const s of SIDES) if (api.override[s]) {
        const u = bones(R[s], api.pose(s, f)).u;
        g["raise" + s] = Math.atan2(u[0], u[1]) - R[s].elev0 - (f.raise || 0); g["elbow" + s] = 0;
        g["armP" + s] = [Math.asin(clamp(u[2], [-1, 1])), 0];
      }
      return g;
    },
    // where a side's bones are, in canon px: the rig's own moves on it (its shrug, swing, lift; her torso's turn)
    place(s, f, shrug) {
      const A = D[s], sg = R[s].sg, B = bones(R[s], api.pose(s, f));
      const J = [A.joint[0] + shrug[0], A.joint[1] + shrug[1]], sh = H.M().shoulder["arm" + s];
      const sw = (f["arm" + s] || 0) + sg * (f.lift || 0), m = f;
      const pt = (p) => { const q = H.torsoFwd(H.rotP([J[0] + sg * p[0], J[1] + p[1]], sh, sw), m); return [q[0], q[1], p[2]]; };
      const dir = (v) => { const q = H.rotP(H.rotP([sg * v[0], v[1]], [0, 0], sw), [0, 0], m.sway || 0); return [q[0], q[1], v[2]]; };
      // (its sleeve's top: its tip (the painting's slices down from it), or its cone's top halfway up to that)
      const S = sleeve[s], ST = S ? mul(R[s].u0, (S.cap ? S.top : S.top / 2) * R[s].lu) : B.G;
      const Q = { G: pt(B.G), E: pt(B.E), W: pt(B.W), af: dir(B.af), m: dir(B.m), pro: B.pro, k: dir(B.k), ST: pt(ST), k0: dir(R[s].k0),
                  fU: dir(cross(B.k, B.u)), hr: dir(B.r), hn: dir(B.n), hl: B.hl,
                  fingers: B.fingers.map((F) => ({ pts: F.pts.map(pt), r: F.r, nail: dir(F.nail) })),
                  thumb: { pts: B.thumb.pts.map(pt), r: B.thumb.r, nail: dir(B.thumb.nail) }, prop: null };
      const g = held[s], hl = R[s].hl;          // (a held prop: on its hand's frame)
      if (g) { const hp = (x) => pt(add(B.W, add(add(mul(B.r, x[0] * hl), mul(B.h, x[1] * hl)), mul(B.n, x[2] * hl))));
        Q.prop = { A: hp(g.A), B: hp(g.B), c: hp(g.c), a: dir(add(add(mul(B.r, g.a[0]), mul(B.h, g.a[1])), mul(B.n, g.a[2]))) }; }
      const T = api.turn;                 // (checks) the arm turned about its hand's middle, that put at T.at
      if (!T) return Q;
      const all = [...Q.fingers.flatMap((F) => F.pts), ...Q.thumb.pts], c = mul(all.reduce(add, [0, 0, 0]), 1 / all.length);
      const tv = (v) => rot(rot(v, [0, 1, 0], T.yaw || 0), [1, 0, 0], T.pitch || 0);
      const tp = (p) => add(tv(sub(p, c)), T.at || c);
      return { ...Q, G: tp(Q.G), E: tp(Q.E), W: tp(Q.W), af: tv(Q.af), m: tv(Q.m), k: tv(Q.k), ST: tp(Q.ST), k0: tv(Q.k0), fU: tv(Q.fU),
               hr: tv(Q.hr), hn: tv(Q.hn),
               fingers: Q.fingers.map((F) => ({ ...F, pts: F.pts.map(tp), nail: tv(F.nail) })),
               thumb: { ...Q.thumb, pts: Q.thumb.pts.map(tp), nail: tv(Q.thumb.nail) },
               prop: Q.prop && { A: tp(Q.prop.A), B: tp(Q.prop.B), c: tp(Q.prop.c), a: tv(Q.prop.a) } };
    },
    render(f, view, W, Hh, sides, shrugs) {
      api.shrug = shrugs;
      if (fw !== W * sup || fh !== Hh * sup) api.size(W, Hh);
      const rows = new Float32Array(4 * 2 * NA), bnd = new Float32Array(24), bndR = new Float32Array(6), on = [0, 0];
      api.last = {};
      SIDES.forEach((s, ai) => {
        if (!sides.includes(s) || (api.only && api.only !== s)) return;   // (only: checks of one arm)
        on[ai] = 1;
        const Q = api.last[s] = api.place(s, f, shrugs[s]), o = ai * NA * 4, put = (i, v, w = 0) => rows.set([...v, w], o + 4 * i);
        const pz = api.pose(s, f), curl = Math.min(1, pz.f.reduce((a, x) => a + x[0] + x[1], 0) / 4 / 3.5);
        put(0, Q.G); put(1, Q.E); put(2, Q.W); put(3, Q.af, Q.pro); put(4, Q.m);
        rows.set(R[s].up, o + 32); rows.set(R[s].fb, o + 48); rows.set(R[s].fa, o + 64);
        Q.fingers.forEach((F, i) => F.pts.forEach((p, j) => put(20 + 5 * i + j, p, F.r[j])));
        Q.fingers.forEach((F, i) => {          // each finger's pad: its curl's inside filled as it closes
          // (grown out of its first bone's inside toward the middle of its bent joints, always in that bone (a ball
          // apart from it would float in the curl), till it reaches the other bones; none round a prop: that fills it)
          const c = mul(F.pts.slice(1).reduce(add, [0, 0, 0]), 0.25), an = mul(add(F.pts[1], F.pts[2]), 0.5);
          const b = pz.f[i] || [0, 0, 0], k = held[s] ? 0 : ss(2.4, 4.2, b[0] + b[1] + b[2]);
          const gap = Math.min(...[1, 2, 3].map((j) => segD(c, F.pts[j], F.pts[j + 1])[0] - F.r[j]));
          put(51 + i, add(an, mul(sub(c, an), k)), k > 0 ? 0.6 * F.r[1] + k * Math.max(0, gap + 0.3 * F.r[2] + 0.4 * F.r[1]) : 0);
        });
        Q.thumb.pts.forEach((p, j) => put(40 + j, p, Q.thumb.r[j]));
        [...Q.fingers, Q.thumb].forEach((F, i) => put(44 + i, F.nail, i < 4 ? 0 : HAND.thumb.flat));   // (the thumb's flatness)
        const S = sleeve[s];
        put(49, [R[s].hem, curl * curl, S ? S.top : 0]);
        if (S) { rows.set(S.r16, o + 4 * 56); rows.set(S.o16, o + 4 * 60); put(64, [S.hem, S.wall, 1], S.alpha);
                 put(65, Q.ST, S.rTop || 0); put(55, Q.k0, S.cap ? 1 : 0); if (S.cap) rows.set(S.cap, o + 4 * 5); }
        put(66, Q.k, S ? S.foreEase : 0);
        rows.set(R[s].offU, o + 4 * 76); rows.set(R[s].offF, o + 4 * 80);   // (its middle's offsets)
        // (where it was at rest, and its painting then: on or off, its arm's and sleeve's, their canon box)
        const T0 = R[s].at0, tx = texOn && D[s].tex;
        put(84, Q.fU, tx ? 1 : 0); put(85, T0.G, T0.pro); put(86, T0.u, tx && S && S.tex ? 1 : 0);
        put(87, T0.k, tx ? tx.sd : 0); put(88, T0.f); put(89, T0.E); put(90, T0.v); put(91, T0.af); put(92, T0.m);
        if (tx) { rows.set(tx.skin, o + 4 * 93); if (tx.sleeve) rows.set(tx.sleeve, o + 4 * 94); rows.set(tx.box, o + 4 * 95); }
        put(96, Q.hr, Q.hl); put(97, Q.hn, HAND.flat);   // (the hand's frame: its palm's slab; its fingers' flatness)
        const all = [...Q.fingers.flatMap((F) => F.pts), ...Q.thumb.pts], hc = mul(all.reduce(add, [0, 0, 0]), 1 / all.length);
        put(50, hc, Math.max(...all.map((p) => len(sub(p, hc)))) + 24);
        const lw = (D.line || 3.2) + 4;
        let hr = Math.max(...all.map((p) => Math.hypot(p[0] - hc[0], p[1] - hc[1]))) + 30;
        const g = held[s], pp = Q.prop;
        if (g && pp && g.ready) {                // its prop (rows 67..75; see prop() and card() in the shader)
          const kind = { cylinder: 1, capsule: 2, sphere: 3, image: 4 }[g.kind], ext = [];
          put(70, g.lit, g.cap ? 1 : 0); put(71, g.shade); put(72, g.line); put(74, pp.c); put(75, g.cap || [0, 0, 0], g.gloss || 0);
          if (kind < 4) {
            put(67, pp.A, kind); put(68, pp.B, g.r); put(69, [0, 0, 0], kind === 1 ? g.round : g.r2 ?? g.r);
            ext.push([pp.A, Math.max(g.r, g.r2 || 0)], [pp.B, Math.max(g.r, g.r2 || 0)]);
          } else {                               // (its plane: through the stem, turned to face us; u: the picture's right)
            const a = norm(pp.a), nz = sub([0, 0, 1], mul(a, a[2])), nrm = len(nz) > 1e-4 ? norm(nz) : [0, 0, 1];
            const u = norm(cross(mul(a, -1), nrm)), [gu, gv] = g.at;
            put(67, pp.c, 4); put(68, a, g.r); put(69, u); put(71, g.shade, g.w); put(72, g.line, g.h); put(73, nrm, gu);
            put(74, pp.c, gv);
            for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) ext.push([add(pp.c, add(mul(u, (x - gu) * g.w), mul(a, (gv - y) * g.h))), 4]);
          }
          for (const [p, r] of ext) hr = Math.max(hr, Math.hypot(p[0] - hc[0], p[1] - hc[1]) + r + 30);
        }
        const oU = Math.max(...R[s].offU.map(Math.abs)), oF = Math.max(...R[s].offF.map(Math.abs));
        const ez = S ? Math.max(...S.r16.map((r, i) => r + Math.abs(S.o16[i]))) : Math.max(...R[s].up) + oU;
        const segs = [[[Q.ST, Q.E], ez + lw + 12], [[Q.E, Q.W], Math.max(...R[s].fa) + oF + (S ? S.foreEase : 0) + lw + 12],
                      [[hc, hc], hr + lw]];
        segs.forEach(([[a, b], r], j) => { bnd.set([a[0], a[1], b[0], b[1]], 4 * (3 * ai + j)); bndR[3 * ai + j] = r; });
      });
      if (!on[0] && !on[1]) return false;
      const MM = H.M(), sk = (y) => H.torsoFwd([MM.bodyC, y], f);
      const t0 = sk(TORSO.y[0]), t1 = sk(TORSO.y[1]), hd = H.torsoFwd(P.head.centre, f);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, fw, fh);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.BLEND);
      gl.useProgram(prog);
      gl.uniform4fv(U.uA, rows); gl.uniform4fv(U.uBnd, bnd); gl.uniform3fv(U.uBndR, bndR); gl.uniform2i(U.uOn, on[0], on[1]);
      const sk3 = (k) => D.R.skin[k], hk3 = (k) => D.R.handSkin[k];
      gl.uniform3fv(U.uLit, sk3("lit")); gl.uniform3fv(U.uShade, sk3("shade")); gl.uniform3fv(U.uLine, sk3("line"));
      gl.uniform3fv(U.uBlush, sk3("blush")); gl.uniform3fv(U.uHLit, hk3("lit")); gl.uniform3fv(U.uHShade, hk3("shade"));
      gl.uniform3fv(U.uHLine, hk3("line")); gl.uniform3fv(U.uHBlush, hk3("blush")); gl.uniform3fv(U.uNail, D.nail || [0.97, 0.82, 0.81]);
      gl.uniform4f(U.uTorso, t0[0], TORSO.y[0], t1[0], TORSO.y[1]); gl.uniform4f(U.uTorsoW, ...TORSO.w, TORSO.depth, 0);
      gl.uniform4f(U.uHead, hd[0], hd[1], P.head.radius * 0.95, P.head.neck || 0);
      gl.uniform1f(U.uLineW, D.line || 3.2); gl.uniform1f(U.uPx, (view[2] - view[0]) / fw);
      gl.uniform3fv(U.uSLine, [...(sleeve.R ? sleeve.R.line : [0, 0, 0]), ...(sleeve.L ? sleeve.L.line : [0, 0, 0])]);
      gl.activeTexture(gl.TEXTURE14); gl.bindTexture(gl.TEXTURE_2D, ramp); gl.uniform1i(U.uRamp, 14);
      gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_2D, cardTex[0] || ramp); gl.uniform1i(U.uCard0, 11);
      gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, cardTex[1] || ramp); gl.uniform1i(U.uCard1, 15);
      gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, armTex); gl.uniform1i(U.uArmTex, 12);
      // the bounds of both arms as one box (the shader drops what's off them)
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let i = 0; i < 6; i++) if (on[i < 3 ? 0 : 1]) { const r = bndR[i];
        x0 = Math.min(x0, bnd[4 * i] - r, bnd[4 * i + 2] - r); x1 = Math.max(x1, bnd[4 * i] + r, bnd[4 * i + 2] + r);
        y0 = Math.min(y0, bnd[4 * i + 1] - r, bnd[4 * i + 3] - r); y1 = Math.max(y1, bnd[4 * i + 1] + r, bnd[4 * i + 3] + r); }
      gl.uniform4f(U.uBox, x0, y0, x1, y1); gl.uniform4f(U.uView, ...view);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, Hh); gl.enable(gl.BLEND);
      api.box = [x0, y0, x1, y1];
      return true;
    },
    // its pixels at one place in the layers: those of each class (0 behind her, 1 under her shirt, 2 over her front, 3
    // over her face) whose slot (arm3d.SLOTS) is before or after the layer id ("end": after them all)
    at(id, when, view) {
      if (api.turn && api.turn.bg) {      // (checks) the arm alone, on a plain ground, over everything
        if (when !== "end") return false;
        gl.clearColor(...api.turn.bg, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        for (let c = 0; c < 4; c++) api.composite(c, view);
        return true;
      }
      let drew = false;
      D.slots.forEach(([w, lid], cls) => { if (w === when && (when === "end" || lid === id)) { api.composite(cls, view); drew = true; } });
      return drew;
    },
    composite(slot, view) {
      gl.useProgram(comp);
      gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, cTex); gl.uniform1i(UC.uArmC, 12);
      gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_2D, aTex); gl.uniform1i(UC.uArmA, 13);
      gl.uniform1f(UC.uSlot, slot); gl.uniform1i(UC.uSS, sup);
      gl.uniform4f(UC.uBox, ...api.box); gl.uniform4f(UC.uView, ...view);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
  return api;
}

function link(gl, vs, fs, U) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("arm3d: " + gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "aPos"); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("arm3d: " + gl.getProgramInfoLog(p));
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ""); U[name] = gl.getUniformLocation(p, name); }
  return p;
}
