---
name: layer2d-avatar-builder
description: Build, rig, validate, and visually QA open Layer2D (.l2d / layer2d/v1) 2D avatars from scratch or PSD layers without proprietary SDKs, using the Layer2D Agent Testing Kit.
---

# Layer2D Avatar Builder Skill (`layer2d/v1`)

Use this skill whenever asked to create, edit, convert, debug, or validate a Layer2D (`.l2d`) 2D VTuber / avatar model, build an automated rigging pipeline, or verify a `.l2d` bundle against the open `layer2d/v1` specification.

## 1. Quickstart — Download & Run the Agent Testing Kit

If you do not already have the Layer2D repository locally, fetch the self-contained testing kit (includes the standalone CLI validator, offline WebGL2 Player, starter builder, and Playwright visual QA runner):

```bash
curl -fsSL https://layer2d.com/downloads/layer2d-agent-kit.zip -o layer2d-agent-kit.zip
unzip -o layer2d-agent-kit.zip -d layer2d-kit
cd layer2d-kit

# 1. Build a runnable reference .l2d from scratch
python3 starter_builder.py starter.l2d

# 2. Validate archive layout, manifest stats, textures & SHA-256 digests
python3 l2d_tools.py validate starter.l2d

# 3. Run offline headless WebGL2 visual & runtime QA (turns, center-turn, pitch, expressions, OBS alpha)
python3 qa_runner.py starter.l2d --out qa_out/
```

Browser tools (100% client-side, zero upload):
- **Live Player:** `https://layer2d.com/player/?model=test-signal.l2d` (drag-and-drop any `.l2d`)
- **Browser Studio:** `https://layer2d.com/studio/` (drag-and-drop `.l2d` or `.psd`, sculpt warp grids, edit physics/expressions/timelines, export verified `.l2d`)
- **Full Spec:** `https://layer2d.com/format.html` and `https://layer2d.com/docs.html`

---

## 2. `.l2d` Container Contract (`layer2d/v1`)

A `.l2d` bundle is a standard ZIP archive with strict rules enforced by both `l2d_tools.py validate` and the browser WebGL2 Player:

```text
avatar.l2d
├── layer2d.json        # Required manifest: format MUST equal "layer2d/v1"
├── pack.json           # Required runtime rig (layers, samples, head, motion, expr, chains, outfits)
├── tex/<id>.<texExt>   # Required primary layer RGBA textures (.webp or .png)
├── tex/expr_<id>.png   # Required for static expression pieces without shared "tex"
├── tex/<name>.png      # Required for shared flipbook FX sheets (piece.tex)
├── preview.png         # Optional RGBA portrait thumbnail (recommended 600x800 or 1200x1600)
├── studio.json         # Optional non-destructive Studio metadata (safely ignored by Player)
└── SHA256SUMS.json     # Required lowercase SHA-256 hex digest for EVERY other member
```

### Mandatory Integrity Rules
- **Paths:** Relative POSIX paths only. No leading `/`, no `\`, no `..` traversal segments, no duplicate filenames.
- **Compression:** Store binary textures (`tex/*`, `preview.png`) with `ZIP_STORED` (method `0`) for zero-overhead browser decoding; compress JSON (`*.json`) with `ZIP_DEFLATED` (method `8`).
- **Checksums:** `SHA256SUMS.json` keys MUST exactly equal the set of all non-checksum members in the archive. The browser Player verifies every SHA-256 digest unconditionally on load.
- **Manifest parity:** `layer2d.json` `stats` (`layers`, `chains`, `samples`, `expressions`, `holds`, `outfits`, `exprPieces`, `vowels`) MUST match `pack.json`.

---

## 3. Exact `pack.json` Architecture

All coordinates live in canonical `pack.canvas = [W, H]` pixels (`+X` right, `+Y` down).

### Layer Stack & Parallel Yaw Keyforms
- `pack.layers[]` is ordered back-to-front (`layers[0]` draws behind `layers[N-1]`).
- `pack.samples[]` is sorted ascending by `angle` (head yaw in radians, typically `[-0.22 .. +0.22]`, 5 to 17 samples).
- **`samples[k].layers[i]` MUST stay parallel-indexed to `pack.layers[i]`!**
- Layer `kind`: `0` head, `1` torso, `2` right arm, `3` left arm, `4` skirt, `5` hips/tail, `6` leg.

### Affine Placement & Inverse Warp Grid (`D`)
Each `samples[k].layers[i]` specifies:
- `A: [a0, a1, a2, a3]` (row-major 2×2 matrix) and `t: [tx, ty]` (layer center in canvas px) mapping layer-local coords `l` to canvas coords `p = A * l + t`.
- `op`: opacity (`0.0 .. 1.0`).
- `turn`: head cylinder turn angle applied to this layer (typically `0.45 * angle` for back hair, `0.72..0.85 * angle` for front/face).
- `behind`: binary occlusion strength (`>= 0.5 ? 1.0 : 0.0`) against `layer.behind = [maskA, maskB]`.
- `D`: optional flat float array of length `2 * gd * gd` where `gd ∈ {3, 5, 7, 9, 11}` (max `121` `vec2`s). The WebGL2 fragment shader evaluates:
  ```glsl
  vec2 g = (inv(A) * (p - t)) / (vec2(w, h) * 0.5); // normalized [-1, +1]
  g += bilinear(D, g);                              // inverse lookup displacement
  vec2 uv = (g + 1.0) * 0.5;
  ```
  **Sign convention:** To move rendered pixels visually by `+Δg`, **subtract** `Δg` from `D` at those nodes.

### Head Pitch, Physics, Tail, Outfits & Expressions
- `pitchGroups`: map `layerId -> "face" | "bangs" | "side" | "crown" | "back" | "ear" | "humanEar"`.
- `chains[]`: 2–6 joint spring chains `{name, parent, k: [root, tip], damp, joints: [x0,y0,...], depth, pin}` bound via `layer.chains = [chainIdx]` and `layer.chainSigma`.
- `tail`: optional rigid pelvis-locked tail `{id, pivot: [x, y], amp, freq, happyFaces}`.
- `outfits`: named toggles `{label, default, hide: [ids], off: [dx, dy], secs}`.
- `expr`:
  - `pieces`: static swaps (`tex/expr_<id>.png`) or shared flipbooks (`tex: "<name>"` + `atlas: {cols, rows, fps, intro, loop, pad}`).
  - `faces`: `{hide: [...], add: [...], move: {id: [dx, dy, rotDeg]}, eyes: [r, l], look: [gx, gy]}`.
  - `holds`: `{hide: [...], add: [...], still: ["armR"], face: "Happy"}`.
  - `vowels`: `{"A": "M04", "I": "M05", "U": "M06", "E": "M07", "O": "M08"}` for instant Web Audio mic lip-sync.
  - `blink`: `{"drop": [], "add": [], "hide": []}` (or blink piece lists when eye blink layers exist).

---

## 4. Hard-Won Authoring Rules (Avoid These Common Bugs!)

1. **NEVER crossfade hair (`op = 1.0` at every yaw angle).** Build physical multi-depth hair shells instead: back (`H01`), crown fill behind ears (`H02c`), mid depth (`H02`/`H02s`), under-bangs (`H03u`), side locks (`H04s`/`H04`), and front bangs (`H03C/R/L`).
2. **NEVER flip `behind` (`0 ↔ 1`) near center yaw (`a = 0`) over the forehead or brows.** Because `behind` is a hard binary mask, flipping it near `a = 0` snaps dark under-bangs visibly on and off above the eyebrows. Keep under-bangs (`H03uR/L`) strictly outside the eyebrow X-band and lock `H02c`, `H03u`, `H02s`, `H04s` permanently to `behind = 1.0` across ALL yaw angles. Delay far-side lock (`H04`) transitions until after clearing the cheek edge (`|u| >= 0.28`).
3. **Protect kemonomimi / animal ear fluff.** Place crown fill shells (`H02c`) *behind* ear layers in draw order and keep the crown top dome below ear roots so dark triangles never clip white inner ear tufts. Always set `pitchGroups[earId] = "ear"`.
4. **Use generous `pad` (`320–420 px`)** on head and warped layers so extreme turns and warp-grid sculpts never clip against the vertex quad boundary.
5. **Use `pack.tail` (rigid pelvis rotation) for fluffy tails — NOT spring chains.** Discrete multi-segment spring chains deform thick tails like wavy fabric with visible creases. Keep tail rotation strictly rigid (no per-frame non-uniform `sx/sy` stretch).
6. **Set `clipTarget: true` on every mask parent** (`F01`, `E01R/L`, or any layer referenced by another layer's `clip` or `behind`). The runtime topologically sorts masks automatically.
7. **Pose-arm holds must suppress resting arms.** List every replaced resting arm/sleeve/hand layer in `holds[name].hide` AND freeze its arm spring in `still: ["armR"]` or `["armL"]`.
8. **Forehead mood overlays & expression captures.** Place gloom/mood shades high above the browline. Force `eyes: 1.0` (disable random blinks) when capturing expression QA sheets.

---

## 5. Mandatory Verification & Visual QA Loop

Never declare a `.l2d` avatar finished until ALL checks pass:

1. **Structural & Cryptographic Validation:**
   ```bash
   python3 l2d_tools.py validate avatar.l2d
   ```
   Must return `"ok": true` with `0` errors (manifest, required textures, path safety, exact `SHA256SUMS.json`).
2. **Headless WebGL2 Runtime & Visual QA:**
   ```bash
   python3 qa_runner.py avatar.l2d --out qa_out/
   ```
   Verify:
   - `0` console errors, `0` uncaught page errors, `0` failed requests.
   - OBS `?obs=1` top-corner alpha is strictly `0` (true transparent background) and UI bar is hidden (`display: none`).
   - **Inspect `qa_out/qa_turns_wide.png`** (`a = -1.0 .. +1.0`): check upper-temple hair seams, ear fluff, eye clipping, and silhouette continuity.
   - **Inspect `qa_out/qa_turns_center.png`** (`a = -0.40 .. +0.40` in `0.10` steps): specifically check forehead & eyebrows for zero popping under-bangs or mask snaps!
   - **Inspect `qa_out/qa_pitch_grid.png`** (`3×3` yaw × pitch): confirm ears stay anchored to skull roots and face features track smoothly.
   - **Inspect `qa_out/qa_expressions.png`**: confirm clean eye/mouth swaps, unclipped FX, and zero mid-blink frames.
