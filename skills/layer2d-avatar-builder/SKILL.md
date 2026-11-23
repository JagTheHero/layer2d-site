---
name: layer2d-avatar-builder
description: Build, rig, validate, and visually QA open Layer2D (.l2d / layer2d/v1) 2D avatars from scratch or PSD layers without proprietary SDKs, using the Layer2D Agent Testing Kit.
---

# Layer2D Avatar Builder Skill (`layer2d/v1`)

Use this skill whenever asked to create, edit, convert, debug, or validate a Layer2D (`.l2d`) 2D VTuber / avatar model, build an automated rigging pipeline, or verify a `.l2d` bundle against the open `layer2d/v1` specification.

## 0. Recommended Frontier Models & Image Generation

Multi-layer 2D avatar rigging requires high-precision spatial geometry, multi-sheet part mapping, and strict visual QA inspection.
- **Recommended coding & vision models:** Use ONLY **GPT-6.2 Sol / Astra**, **Claude Opus 5.5 / Fable 5.2**, or **Gemini 4 Neon**. Smaller or older models generally will not cut it for full multi-layer rigging, turn-keyform fitting, and visual QA verification.
- **Generating character concept art & transparent parts sheets:**
  - **Codex:** Use Codex's built-in image generation directly to paint the front A-pose concept sheet and separated transparent parts sheets.
  - **Grok:** Generate concept sheets and isolated character art via Grok Imagine.
  - **OpenAI API (`gpt-image-2.6`):** Export your API key (`export OPENAI_API_KEY="sk-..."`) and call `/v1/images/generations` or `/v1/images/edits` with `model="gpt-image-2.6"` (or `gpt-image-2.6-sunburst`), `background="transparent"`, `output_format="png"`, and `size="3840x2160"` to produce 4K transparent parts sheets with zero background keying artifacts.

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

Browser tools & AI playbook (100% client-side, zero upload):
- **AI Agent Playbook & Full Tutorial Transcript:** `https://layer2d.com/for-ai` (raw Markdown: `https://layer2d.com/for-ai/guide.md`)
- **Live Player:** `https://layer2d.com/player/?model=test-signal.l2d` (drag-and-drop any `.l2d`)
- **Browser Studio:** `https://layer2d.com/studio/` (drag-and-drop `.l2d` or `.psd`, sculpt warp grids, edit physics/expressions/timelines, export verified `.l2d`)
- **Full Spec:** `https://layer2d.com/format.html` and `https://layer2d.com/docs.html`

### Copying & Adapting Layers from Other Models in the Repo
You do **not** have to build every texture, expression piece, or physics preset from zero. Whenever you have access to other `.l2d` bundles, unpacked `models/*/viewer/` directories, `rigkit/` scripts, or `.psd` avatars in the repo/workspace (such as MIT-licensed `nori.l2d`, `test-signal.l2d`, `starter.l2d`, or any other model the user has locally), run `python3 l2d_tools.py unpack <ref.l2d> /tmp/ref/` to study or adapt proven utility layers (eye sparkles `E04`, blush, gloom shades, FX flipbooks, AEIOU mouths, hand/wrist/shoulder templates, partial-masked `<ID>_back` pairs) and working `pack.json` physics/mask presets — recoloring and scaling so everything blends seamlessly with the target character.

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
  - `pieces`: static swaps (`tex/expr_<id>.png`) or shared flipbooks (`tex: "<name>"` + `atlas: {cols, rows, fps, intro, loop, pad}`), anchored via `{base, at?, w, h, relA: [1,0,0,1], relT: [tb_x - te_x, tb_y - te_y], op, anim?}`.
  - `faces`: `{hide: [...], add: [...], move: {id: [dx, dy, rotDeg]}, eyes: [r, l], look: [gx, gy]}`.
  - `holds`: `{hide: [...], add: [...], still: ["armR"], face: "Happy"}`.
  - `vowels`: `{"A": "M04", "I": "M05", "U": "M06", "E": "M07", "O": "M08"}` for instant Web Audio mic lip-sync.
  - `blink`: MUST be an object `{"hide": [], "add": [], "drop": [], "squash": true}` (or explicit drawn closed-eye `hide`/`add` piece lists when `squash: false`). Do NOT pass a `[interval, dur]` array — the runtime checks `Array.isArray(expr.blink.hide)`.

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
9. **Solve limb & clothing placement from real sprite end-anchors — never guess bounding-box centers!** Cut arm/hand/shoe sprites often have built-in diagonal slant or off-center openings (e.g., hand wrist at `0.73w`, shoe opening at `0.42w`). Measure each sprite's actual opaque top/bottom centerline anchors and solve `(cx, cy, w, h, rot)` analytically so parent exit and child entry land within `< 2 px` with matching cross-section widths, zero dark cut-border seam lines, and snug accessory fit (choker strap `1.00–1.12×` neck width with zero air overhang, halter straps tucked behind neck/choker, belt seated flush over skirt waistband). Always map ALL arm & sleeve layers (including bare arms AND `*_back` cuff layers under toggleable jackets) in `body.elbowHalf`.
10. **Apply True 3D Partial Masking on Cylindrical Garments & Bands (socks, sleeve cuffs, collars/bands).** Never draw an uncut hollow back-rim ellipse ON TOP of an entering limb or neck — it makes the limb look pasted behind a flat sticker! Split every sock (`S01R/L`), long/short sleeve cuff (`J05R/L`, `C04R/L`), or tubular band along its curved front-lip parabola into two pixel-locked sprites sharing identical canvas size & placement:
    - `<ID>_back` (hollow inner back rim) placed **BEHIND** the entering limb (`B06R/L`, `G01R/L`, `B01`),
    - `<ID>` (crisp front lip & body only) placed **IN FRONT OF** the entering limb.
    Always add `<ID>_back` to `outfits[...].hide` and `body.elbowHalf` so outfit toggles and arm bends stay 100% locked.
11. **Inspect & Seal Bare Shoulders with Jackets/Cardigans Toggled OFF.** Never fade the top shoulder contour or armpit of `B03R/L` (keep outer ridges `alpha = 255` solid opaque so zero translucent white holes appear). Seat `B03R/L` deltoid peaks tangent to `B02`'s collarbone slope (`0 px` top V-notch), strip ONLY internal overlapping shoulder-socket ink strokes, and feather strictly inside `B02`'s opaque chest interior.
12. **Eliminate Non-Smooth Jaw-to-Neck Gaps/Steps & Baked Chin Folds (`B01 -> F01`).** Cutout necks frequently include BOTH a wider flared jaw stub at the top of `B01` (causing a stair-step under the chin) AND a baked U-shaped dark front-chin crease/outline across the upper neck (`y = 0..120px`) that is hidden at Front (`a = 0`) but pops out as a weird horizontal neck fold the moment the head turns! Trim `B01`'s upper jaw stub cleanly to slender mid-neck width (preserving crisp 2px side outlines), paint out any baked chin outline/fold across the upper neck interior with a smooth shaded neck-cylinder gradient, and fade only the bottom collarbone edge invisibly into `B02`.
13. **Fill Open-Arch Shoes (Mary Janes, Heels, Strapped Footwear) Wall-to-Wall.** Narrow sock ankles stop short of shoe side walls, leaving background gaps or dark sock side outlines cutting straight through the open arch! Smoothly flare the lower sock instep (`y >= 0.66h`) via `scipy.ndimage.map_coordinates` (NOT binary dilation, which leaves the original dark outline visible inside the arch) so real shaded sock fabric tucks completely behind BOTH shoe walls and ankle strap.
14. **NEVER Leave a Neck Stem or Baked-On Human Ears on the Face Layer (`F01`).** AI image generators frequently paint a short pink neck stem below the chin and human ears on the sides of `F01`. Because `F01` rotates and turns with the head (`kind="head"`), any neck stem on `F01` swings sideways off body neck `B01` on head turns, and baked-on `F01` ears double up with separate `F05`/`F06` ear layers (giving the avatar 4 human ears!). Always flood-fill `F01`'s interior skin (`lum > 0.68`) and keep ONLY the face oval + dark cheek/chin outline so `F01` ends cleanly at the chin tip and cheek contour, while `B01` extends behind the chin and `F05`/`F06` provide the single parallax-animated ear pair.
15. **Focus Neutral Eye Gaze, Sculpt Eye Proportions & Contour Lower Lashes (`E01`–`E06`).** Never shift irises/pupils outward toward the temples (`ex + sgn * dx`) — outward offsets create unmistakable wall-eyed gaze! Place irises & pupils slightly *inward* toward the nose bridge (`outward_div <= 0%`). Keep the actual eye shape sleek and horizontally wide (extending outward toward the sides of the face WITHOUT pushing inner corners apart, with relaxed almond height rather than startled round tallness) and generous white sclera (`iris_w ≈ 42–55%` of sclera width), align `E04` highlights to one consistent upper-left key light, and sculpt the lower lash (`E06`) cleanly along `E01`'s exact curved lower rim (`50–95%` span) so it wraps the eye shape delicately without floating below or jutting straight out past the corners.
16. **Keep Body Motion Crisp & Non-Rubbery (Match Test Signal's Solid Body Physics).** Do **NOT** enable `motion.turnChain` on fitted clothes, jackets, belts, or skirts — `turnChain` applies a multi-joint cylindrical rubber-warp down the torso/hips/legs that squishes structured garments whenever the head turns. Follow Test Signal's clean studio motion instead: omit `turnChain`, set subtle `motion.bodyFollowLR: [0.025, 0.025]` (instead of heavy `0.14` torso cylinder twist), `bodyFollow: [0.12, 0.25]`, `limit.bend: 0.25`, and a wide `bodyR` (`>= 0.36 × canvas_W`).
17. **Default Step: Full 3D Side-of-Head Depth Stack (`F02tR/L`, `F01sR/L`, `F03tR/L` & Multi-Strand Side Hair `H02s`/`H04s`).** Turning a flat front face (`F01`) alone looks paper-thin on 3/4 head turns, while a puffy protruding cheek-pad looks bloated. As a standard default step on every multi-sample rig, use `rigkit.face3d` (bundled as `face3d.py` in the Agent Testing Kit):
    - **Sleek 3/4 Anime Jawline + Camera-Parallel Side Plane (`F01sL`/`F01sR`):** Calibrate `F01`'s front contour 1:1 to `placed/F01.png` so its turned jawline rises cleanly at a slender ~38° diagonal from pointed chin to temple hairline, and keep `F01sL/R` sleek (`jaw_depth_px = 14..20px`, NEVER bloated `> 40px` cheek bulges!) using `synthesize_side_jaw_layers()` + `fit_side_jaw_3d()` (bounded strictly-monotonic C1 hinge mapping so `max|D| < 0.25` and zero double-chin appears at mid-yaw `a = ±0.5`!).
    - **Clipped Rear-to-Front Directional 3D Face Shading (`F02tR`/`F02tL`, `clip="F01"`):** Synthesize with `synthesize_turn_face_depth_layers(..., side_jaw_spec=sj_spec)` + `fit_turn_face_shade_3d()`. Place `F02tR/L` immediately **BEFORE `F01sR/L`** (after `F01`/`F02`, before blush/eyes/hair) — both share the exact same rear-to-front dark-to-light shadow profile so `F01 -> F02t -> F01s` blends with `< 1 LSB` continuity, sweeping rich warm directional shadow ~138px forward from the rear hairline plus receding far eye-socket shadow and lit front cheek wrap!
    - **Sculpted 3D 3/4 Nose (`F03tR`/`F03tL`, `clip="F01"`):** Emerge cleanly with `fit_turn_nose_3d()` (glossy tilted bridge highlight + warm side shadow + crisp angled tip) while front nose `F03` fades smoothly to `op = 0.0` (`1 - smoothstep(0.14, 0.56, |a|)`) so there is zero double-nose. Add `F01sR/L`, `F02tR/L`, `F03tR/L` to `pitchGroups` as `"face"` with `visible=False` (`op = 0` at Front).
    - **Lush Multi-Strand Side-of-Head Hair Volume (`H02sR/L`, `H04sR/L`) & Cheek Framing (`H04R/L`):** Never reuse a single skinny framing lock as `H02s`/`H04s`. Composite rich, multi-strand side-of-skull hair curtains (`w ≈ 340–400px`) with darker inner-temple shading on `H02s` and layered outer silhouette strands on `H04s`, tucked behind front hair at `a = 0` (`front_sx ≈ 0.38`) and unfolding smoothly rearward on near turns (`turn_sx ≈ 0.80`) with `behind: ["F01", "F01sR/L"]` (`behind = 1.0` always). Keep foreground framing locks `H04R/L` curving gracefully over the near cheek-to-hairline transition (`behind: ["F01", "F01"]`, gentle near-side opening `~22px`).

---

## 5. Mandatory Verification & Visual QA Loop

Never declare a `.l2d` avatar finished until ALL checks pass:

1. **Structural & Cryptographic Validation:**
   ```bash
   python3 l2d_tools.py validate avatar.l2d
   ```
   Must return `"ok": true` with `0` errors (manifest, required textures, path safety, exact `SHA256SUMS.json`).
2. **Automated Attachment, Partial-Masking & Clothing Polish Audit (ALL Outfit States):**
   ```bash
   python3 polish_audit.py avatar.l2d --out polish_out/ --prompt
   # Or directly on a workspace model directory before packing:
   python3 -m rigkit.polish models/<slug> --out models/<slug>/review/polish --prompt
   ```
   Scores attachment polish `0–100`, renders zoomed close-ups of every flagged joint (`polish_out/polish_audit.png`), AND saves a pixel-exact copy-paste remediation prompt (`polish_out/polish_fix_prompt.txt`) so even less experienced agents know the exact layer IDs and pixel measurements to fix! Checks:
   - Silhouette connectivity (zero floating islands or inter-layer air gaps)
   - **Partial masking** on socks, sleeve cuffs, short sleeves & neck bands (catches unmasked hollow back rims drawn over skin)
   - Oriented limb/sleeve chains across BOTH default and jacket/cardigan-OFF states (bare shoulder V-notch & translucent alpha holes, elbows, wrists, cuffs, knees, shin-to-sock, open-arch shoe wall-to-wall fill & internal sock outlines)
   - Fitted clothing & accessory widths (choker vs neck, jaw-to-neck smoothness, belt vs skirt waistband, camisole straps, cardigan hem, tail root)
   - Bilateral L/R symmetry and complete `elbowHalf` kinematic coverage
   - **Inspect `polish_out/polish_audit.png`** at 1:1 zoom (with hair hidden for neck/shoulders, and on a bright green backdrop for open-arch shoes) and iterate until `FAIL=0` and `score >= 92` (`A`/`A+`).
3. **Headless WebGL2 Runtime & Visual QA:**
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

---

## 6. Proactively Prompting the User & Human Visual QA Checklist

Do 95%+ of the rigging, seam cleanup, partial masking, `face3d.py` 3D turns, `polish_audit.py --prompt`, and `qa_runner.py` inspection **autonomously first** until `FAIL=0` and `score >= 92` (target `100/100 A+`). Then present zoomed close-ups (outerwear ON & OFF, front face, and 3/4 turns at `a = ±0.5, ±1.0`) and **proactively prompt the user** to inspect:
- **Shoulder & elbow seams** (outerwear ON flat shoulder drape + no protruding chest tabs, outerwear OFF smooth bare shoulder tangent & elbow continuity)
- **Wrist seams & hands** (hand-to-cuff / bare wrist fit with zero gap)
- **Parts that need partial masking** (socks, sleeve cuffs, collars, chokers, straps, wristbands, belts, shoe openings — explicitly reassure the user: *"Point out any layer that looks like a flat sticker over skin and needs partial masking, and I will split and mask it for you!"*)
- **3/4 head turns, chin & neck** (sleek convex jaw with no chin dent, zero neck fold on `B01`, lush side hair)
- **Eyes, irises, lashes, ears & strap drape** (iris proportions/gaze focus, straps on inner shoulders vs choker)

When reviewing an AI-built `.l2d` avatar in Layer2D Studio or Player, check these **11 common failure modes** — and paste the exact prompt below straight back to your AI agent (or simply run `python3 polish_audit.py avatar.l2d --out polish_out --prompt` and paste `polish_fix_prompt.txt`!):

| What to Look For | Copy-Paste Prompt to Tell Your AI Agent |
|---|---|
| **1. Hollow sock, sleeve cuff, or band rims drawn over skin** | *"Apply partial masking to the socks (`S01R/L`) and sleeve cuffs (`J05R/L`): split each along its curved front lip parabola into `<ID>_back` behind the entering limb and `<ID>` (front lip only) in front of the limb. Add `<ID>_back` to `outfits` and `body.elbowHalf`, then re-run `polish_audit.py`."* |
| **2. Shoulder gap, V-notch, or broken bare arms when jacket is OFF** | *"Toggle the outer jacket/cardigan OFF and hide hair to inspect the bare shoulders (`B02`/`B03R/L`). Keep the top shoulder crest & armpit 100% opaque (`alpha=255`), seat `B03R/L` tangent to `B02`'s collarbone slope so there is 0px V-notch, feather only inside `B02`'s opaque chest, and map all bare arm layers in `body.elbowHalf`."* |
| **3. Non-smooth gap or stair-step between neck & head** | *"Zoom into `B01` (neck) meeting `F01` (head) with hair hidden. Trim any flared upper jaw stub on `B01` down to the slender mid-neck width so the neck cylinder rises smoothly behind the chin with zero stair-step or gap, and soften only the bottom collarbone fade into `B02`."* |
| **4. Face layer neck stem or double human ears (`F01` + `F05/F06`)** | *"Inspect `F01` alone on green. Flood-fill `F01`'s interior face oval and erase BOTH any hanging neck stem below the dark chin outline (which detaches from `B01` on head turns) AND any baked-on side ears on `F01` so ONLY separate `F05`/`F06` ears remain, tucked snugly behind `F01`'s cheek."* |
| **5. Unfocused eyes, eye proportions, or flat/detached lower lash** | *"Run `polish_audit.py --prompt` to check `eye_gaze_focus` and `lower_lash`. Shift irises & pupils (`E02/E03`) inward toward the nose bridge (`outward_div <= 0%`), widen `E01` outward toward the sides of the face (without widening inner spacing) at a sleeker less-open height with crisp smaller irises, align `E04` highlights to one key light, and sculpt `E06` snugly along `E01`'s exact curved lower rim."* |
| **6. Flat face edge on 3/4 head turns (missing 3D side-of-face)** | *"Add camera-parallel 3D side-of-face / side-of-jaw planes (`F01sL`/`F01sR`) using `rigkit.face3d.synthesize_side_jaw_layers()` and `fit_side_jaw_3d()`. Place them immediately after `F01` (`visible=False`, `op=0` at Front, `pitchGroups='face'`) with perpendicular inner feathering erasing `F01`'s old near jawline, and set `behind: ['F01', 'F01sR'/'F01sL']` on side hair shells."* |
| **7. Rubbery torso/hip/leg warping when moving or turning** | *"Make the body motion crisp and solid like Test Signal: remove `body.turnChain`, set `bodyFollowLR: [0.025, 0.025]`, `bodyFollow: [0.12, 0.25]`, `bodyR: 920`, `limit.bend: 0.25`, and subtle `turnBody` (`±8px`), then re-verify with full-body turn renders."* |
| **8. Socks not filling open-arch shoes (Mary Janes) wall-to-wall** | *"Composite the shoes (`S02R/L`) on a bright green backdrop. Smoothly flare the lower sock instep (`y >= 0.66h`) via `map_coordinates` (not binary dilation) so shaded sock fabric fills the entire shoe arch wall-to-wall behind the walls & strap with zero green gaps and zero dark sock outline visible inside the arch."* |
| **9. Choker, belt, or straps too wide / overhanging into air** | *"Run `polish_audit.py --prompt` and fix garment widths: resize choker `A03` to `1.00–1.10×` neck width centered on `B01`, TPS-warp camisole halter straps behind the choker, and seat belt `K01` flush over `K02`'s waistband with matching width."* |
| **10. Misaligned elbows, wrists, knees, or visible cut lines** | *"Solve every arm, sleeve, hand, and leg layer analytically from its opaque top/bottom centerline anchors (`fit_anchor_segment`) so parent exit and child entry match within `< 2px` with matching cross-section widths, strip internal cut-edge ink lines, and unify wrist anchors across bare and sleeved arms."* |
| **11. Hair pops over brows or ear drift on head turns** | *"Run `qa_runner.py` and inspect `qa_turns_center.png` (`-0.40..+0.40`) and `qa_turns_wide.png`. Lock hair `op = 1.0`, keep depth shells (`H02c/H03u/H02s/H04s`) permanently at `behind = 1.0` across all yaw angles, keep `H02c` behind animal ears, and verify `pad >= 320`."* |
