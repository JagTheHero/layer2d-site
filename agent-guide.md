# Layer2D Agent Authoring Guide (`layer2d/v1`)

Build a valid, runnable `.l2d` 2D avatar archive from scratch — without Layer2D Studio or proprietary SDKs — and play it immediately in `https://layer2d.com/player/` or OBS Studio (`?obs=1`).

> **Full AI Agent Playbook & Video Transcript:** Read **`https://layer2d.com/for-ai`** (or `curl -fsSL https://layer2d.com/for-ai/guide.md`) for autonomous rigging hints, copying/adapting layers from other models you have access to in the repo, automatic partial masking, proactive human seam check-ins (shoulders, elbows, wrists, partial masking), and the complete timestamped tutorial transcript.

> **Recommended Frontier Models:** Multi-layer 2D rigging & visual QA require top-tier spatial reasoning. Use ONLY **GPT-6.2 Sol / Astra**, **Claude Opus 5.5 / Fable 5.2**, or **Gemini 4 Neon** — smaller/older models generally will not cut it.
>
> **Generating Concept Art & Transparent Parts Sheets:** Use **Codex** (built-in image generation), **Grok** (Grok Imagine), or set `export OPENAI_API_KEY="sk-..."` and call **`gpt-image-2.6`** via OpenAI `/v1/images/edits` with `background="transparent"` and `size="3840x2160"` to generate clean 4K transparent PNG parts sheets.

---

## 1. Archive Contract (`.l2d`)

A `.l2d` file is a standard ZIP archive with strict validation rules enforced by both the CLI (`rigkit.format`) and the browser WebGL2 Player:

```text
avatar.l2d
├── layer2d.json        # Open manifest (required, format MUST be "layer2d/v1")
├── pack.json           # Runtime rig, layers, yaw samples, physics, expressions (required)
├── tex/                # Layer textures & expression pieces (required)
│   ├── F01.png         #   or .webp matching pack.json "texExt"
│   └── ...
├── preview.png         # Optional RGBA portrait thumbnail
├── studio.json         # Optional non-destructive Studio metadata (ignored by Player)
└── SHA256SUMS.json     # Exact SHA-256 hex digest of EVERY other member (required)
```

### Mandatory Safety Rules
1. Relative POSIX paths only: no leading `/`, no `\`, no `..` traversal segments, no duplicate filenames.
2. Store binary textures (`tex/*`, `preview.png`) with `ZIP_STORED` (method `0`); JSON files may use `ZIP_DEFLATED` (method `8`).
3. `SHA256SUMS.json` MUST have an **exact key match** against all other file entries in the ZIP, with lowercase 64-char SHA-256 hex digests. The browser Player verifies every digest on load.
4. `layer2d.json` `stats` (`layers`, `chains`, `samples`, `expressions`, `holds`, `outfits`, `exprPieces`, `vowels`) MUST match `pack.json`.

---

## 2. Minimal Working Builder Script (Zero Studio Required)

Run this standalone Python script (requires only `Pillow` to draw starter RGBA PNGs; swap in your own art PNGs/WebPs). Drag the output `starter.l2d` directly onto `https://layer2d.com/player/` or `https://layer2d.com/studio/`.

```python
#!/usr/bin/env python3
"""Build a valid, runnable Layer2D v1 (.l2d) avatar from scratch."""
from __future__ import annotations

import hashlib
import io
import json
import math
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image, ImageDraw


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def paint_starter_textures() -> dict[str, tuple[bytes, int, int, float, float]]:
    """Return {layer_id: (png_bytes, w, h, center_x, center_y)} on a 1200x2000 canvas."""
    out = {}

    # Back hair (H01)
    im = Image.new("RGBA", (540, 680), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((30, 30, 510, 650), radius=180, fill=(38, 42, 56, 255), outline=(20, 22, 30, 255), width=6)
    out["H01"] = (png_bytes(im), im.width, im.height, 600.0, 540.0)

    # Torso + Neck (B01 — neck extends solidly behind F01 chin so head never floats!)
    im = Image.new("RGBA", (420, 740), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((162, 10, 258, 180), radius=24, fill=(248, 224, 214, 255), outline=(80, 60, 65, 255), width=4)
    d.rounded_rectangle((40, 140, 380, 720), radius=90, fill=(28, 30, 38, 255), outline=(190, 30, 60, 255), width=6)
    out["B01"] = (png_bytes(im), im.width, im.height, 600.0, 980.0)

    # Face base (F01 — clipTarget for eyes/blush/shadows)
    im = Image.new("RGBA", (360, 420), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((20, 15, 340, 395), fill=(252, 232, 222, 255), outline=(80, 60, 65, 255), width=5)
    out["F01"] = (png_bytes(im), im.width, im.height, 600.0, 490.0)

    # Eyes (E01R / E01L)
    for side, cx in (("R", 525.0), ("L", 675.0)):
        im = Image.new("RGBA", (96, 86), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.ellipse((8, 12, 88, 76), fill=(255, 255, 255, 255), outline=(35, 30, 40, 255), width=5)
        d.ellipse((24, 18, 72, 68), fill=(190, 30, 60, 255))
        d.ellipse((38, 32, 58, 52), fill=(24, 18, 28, 255))
        d.ellipse((30, 24, 42, 36), fill=(255, 255, 255, 255))
        out[f"E01{side}"] = (png_bytes(im), im.width, im.height, cx, 490.0)

    # Neutral mouth (M01)
    im = Image.new("RGBA", (90, 46), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.arc((12, 4, 78, 36), start=15, end=165, fill=(135, 58, 68, 255), width=5)
    out["M01"] = (png_bytes(im), im.width, im.height, 600.0, 600.0)

    # Front bangs (H03C)
    im = Image.new("RGBA", (420, 250), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.polygon([(30, 190), (80, 20), (340, 20), (390, 190), (310, 150), (260, 215), (210, 145), (155, 215), (105, 150)],
              fill=(54, 60, 78, 255), outline=(20, 22, 30, 255))
    out["H03C"] = (png_bytes(im), im.width, im.height, 600.0, 365.0)

    return out


def build_starter_l2d(out_path: Path) -> None:
    tex_defs = paint_starter_textures()
    draw_order = [
        ("H01",  True,  0, "back",  False, None),
        ("B01",  False, 1, "face",  False, None),
        ("F01",  True,  0, "face",  True,  None),
        ("E01R", True,  0, "face",  False, "F01"),
        ("E01L", True,  0, "face",  False, "F01"),
        ("M01",  True,  0, "face",  False, "F01"),
        ("H03C", True,  0, "bangs", False, None),
    ]

    layers = []
    pitch_groups = {}
    for lid, is_head, kind, pg, is_target, clip in draw_order:
        _, w, h, _, _ = tex_defs[lid]
        pitch_groups[lid] = pg
        layers.append({
            "id": lid, "w": w, "h": h, "kind": kind, "head": is_head,
            "jaw": False, "noFade": is_head, "hole": False,
            "clip": clip, "clipTarget": is_target, "pad": 320.0,
            "pitchGroup": pg,
            **({"chains": [0], "chainSigma": 180.0} if lid == "H01" else {}),
        })

    # 5 continuous yaw keyforms from -0.22 rad (-32.5 deg) to +0.22 rad (+32.5 deg)
    angles = [-0.22, -0.11, 0.0, 0.11, 0.22]
    samples = []
    for ang in angles:
        s_layers = []
        for lid, is_head, _, pg, _, _ in draw_order:
            _, _, _, cx, cy = tex_defs[lid]
            depth = -0.35 if pg == "back" else (0.14 if pg == "bangs" else 0.0)
            tx = cx + (math.sin(ang) * 260.0 * depth if is_head else 0.0)
            s_layers.append({
                "A": [1.0, 0.0, 0.0, 1.0],
                "t": [round(tx, 2), round(cy, 2)],
                "op": 1.0,
                **({"turn": round(ang * (0.45 if pg == "back" else 0.75), 4)} if is_head else {}),
            })
        samples.append({"angle": ang, "jaw": 0.0, "chin": 0.0, "chinAt": [600.0, 680.0], "layers": s_layers})

    pack = {
        "title": "Starter — Layer2D Avatar",
        "canvas": [1200, 2000],
        "bg": [0.05, 0.05, 0.07],
        "views": {"bust": [180, 80, 1020, 1180], "full": [0, 0, 1200, 2000]},
        "texExt": "png",
        "samples": samples,
        "layers": layers,
        "head": {
            "centre": [600.0, 490.0], "radius": 260.0,
            "eu": [1.0, 0.0], "ev": [0.0, 1.0],
            "chin": 185.0, "neck": 260.0, "jawNear": 110.0,
            "pivot": [600.0, 740.0], "turn": {"R": -0.22, "L": 0.22},
        },
        "motion": {
            "sway": [3.2, 0.006, 0.011], "stepBounce": 4.0, "breath": [3.6, 0.0045],
            "bodyFollow": [0.12, 0.25], "bodyFollowLR": [0.025, 0.025], "bounces": [[7.0, 7.5], 12.0, 0.12], "dur": 13.0,
            "earSoft": 5.0, "sew": 160.0,
            "limit": {"bend": 0.25, "lift": 0.06, "earring": 0.6, "arm": 0.08},
            "lockSigma": 50.0, "lockLower": [1.5, 0.8, 3.0],
            "springs": {"skirt": [1.1, 0.25, 0.4, 4.0, 0.4], "armR": [0.9, 0.35, 0.7, 8.0, 0.0], "armL": [0.9, 0.35, 0.7, 8.0, 0.0]},
            "timeline": {"a": [[0, 0], [1.8, -0.8], [4.2, 0.8], [6.0, 0]], "roll": [[0, 0], [1.8, 3], [4.2, -3], [6.0, 0]]},
            "roll0": 0.0, "waist": [600.0, 1020.0], "footY": 1920.0, "legTop": 1250.0,
            "shoulder": {"armR": [445.0, 690.0], "armL": [755.0, 690.0]},
            "bodyC": 600.0, "bodyR": 420.0, "twistY": [640.0, 1040.0], "skirtY": [1010.0, 1380.0],
            "seam": {"armR": [-0.3, 0.95, -45.0, -25.0, 50.0, 100.0], "armL": [0.3, 0.95, 45.0, -25.0, -50.0, 100.0]},
            "armReach": 780.0, "hair": [], "field": [], "earrings": {}, "locks": [],
            "elbow": {"armR": [395.0, 930.0], "armL": [805.0, 930.0]},
            "hand": {"armR": [375.0, 1190.0], "armL": [825.0, 1190.0]},
            "shin": [1550.0, 1850.0], "hips": {"R": [495.0, 1250.0], "L": [705.0, 1250.0]},
            "puppetFace": [600.0, 490.0, 220.0, 240.0],
        },
        "skirt": {"y0": 0, "xl": [0.0], "xr": [1.0], "ml": [0.0], "mr": [0.0]},
        "expr": {
            "pieces": {},
            "faces": {
                "Neutral": {"hide": [], "add": [], "move": {}},
                "Happy":   {"hide": [], "add": [], "move": {}, "eyes": [0.25, 0.25]},
                "Wink":    {"hide": [], "add": [], "move": {}, "eyes": [1.0, 0.08]},
            },
            "holds": {}, "raiseSleeves": {}, "eyes": {}, "blink": {"hide": [], "add": [], "drop": [], "squash": True},
            "faceTimeline": [], "holdTimeline": [], "vowels": {},
        },
        "hairTint": None, "eyeTint": None,
        "chains": [{
            "name": "back_hair", "parent": "head", "k": [0.55, 0.18], "damp": 0.16,
            "joints": [600.0, 340.0, 600.0, 520.0, 600.0, 700.0, 600.0, 860.0],
            "depth": 1.0, "pin": False,
        }],
        "chainWind": [0.0, 0.0], "sheer": None, "outfits": {},
        "hairShadowId": None, "highlightIds": [], "pitchGroups": pitch_groups,
    }

    manifest = {
        "format": "layer2d/v1", "id": "starter", "name": "Starter",
        "title": pack["title"], "version": "1.0.0", "author": "Agent", "license": "MIT",
        "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "entry": "pack.json", "texExt": "png", "canvas": pack["canvas"],
        "stats": {
            "layers": len(layers), "chains": len(pack["chains"]), "samples": len(samples),
            "expressions": len(pack["expr"]["faces"]), "holds": 0, "outfits": 0, "exprPieces": 0, "vowels": [],
        },
        "capabilities": {
            "headYawSamples": len(samples), "headPitch2D": True, "springChains": True,
            "tailRig": False, "obsAlpha": True, "micLipSync": False, "webcamTracking": True,
        },
    }

    members: dict[str, bytes] = {
        "layer2d.json": (json.dumps(manifest, indent=2) + "\n").encode("utf-8"),
        "pack.json": json.dumps(pack, separators=(",", ":")).encode("utf-8"),
    }
    for lid, (raw_png, *_rest) in tex_defs.items():
        members[f"tex/{lid}.png"] = raw_png

    sums = {k: hashlib.sha256(v).hexdigest() for k, v in sorted(members.items())}
    members["SHA256SUMS.json"] = (json.dumps(sums, indent=2, sort_keys=True) + "\n").encode("utf-8")

    with zipfile.ZipFile(out_path, "w") as zf:
        for name in sorted(members):
            comp = zipfile.ZIP_DEFLATED if name.endswith(".json") else zipfile.ZIP_STORED
            zf.writestr(name, members[name], compress_type=comp)
    print(f"Built {out_path} ({out_path.stat().st_size} bytes, {len(members)} members)")


if __name__ == "__main__":
    build_starter_l2d(Path("starter.l2d"))
```

---

## 3. Runtime `pack.json` Coordinate & Deformation Reference

- **Canvas Space**: All coordinates `(x, y)` live in canonical `pack.canvas = [W, H]` pixels (origin top-left, `+X` right, `+Y` down).
- **Draw Order**: `layers[0]` draws furthest back; `layers[N-1]` draws on top. `samples[k].layers[i]` is strictly parallel-indexed to `layers[i]`.
- **Layer Kinds (`kind`)**: `0` head, `1` torso, `2` right arm, `3` left arm, `4` skirt, `5` hips/tail, `6` leg.
- **Affine Placement `{A, t}`**: Maps layer-local pixel `(lx, ly)` relative to layer center `(w/2, h/2)` into canvas space: `p = A * l + t`, where `A = [a0, a1, a2, a3]` row-major.
- **Inverse Warp Grid `D`**: Optional flat array of length `2 * gd * gd` (`gd ∈ {3, 5, 7, 9, 11}`, max `121` vec2s). The fragment shader evaluates:
  ```glsl
  vec2 g = (inv(A) * (p - t)) / half; // normalized [-1, +1]
  g += bilinear(D, g);                // inverse lookup offset
  vec2 uv = (g + 1.0) * 0.5;
  ```
  **Sign rule**: To pull rendered pixels visually by `+Δg`, **subtract** `Δg` from `D` at those nodes.
- **Head Pitch Groups (`pitchGroups`)**: Map each head layer ID to `"face"`, `"bangs"`, `"side"`, `"crown"`, `"back"`, `"ear"`, or `"humanEar"`.
- **Expression Pieces & Flipbooks (`expr.pieces`)**:
  - Static overlay: `{"base": "M01", "w": 99, "h": 75, "relA": [1,0,0,1], "relT": [0,0], "op": 1.0}` → texture `tex/expr_<id>.png`.
  - Shared flipbook sheet: add `"tex": "S_fx_sparkles"` (loads `tex/S_fx_sparkles.png`) and `"atlas": {"cols": 4, "rows": 2, "fps": 12, "intro": 0, "loop": 8, "pad": [0.005, 0.005]}`.

---

## 4. Production Tips & Hard-Won Pitfalls (Read Before Shipping!)

1. **Never crossfade hair (`op = 1.0` across all yaw angles).** Translucent hair dissolves look ghostly on turns. Build physical multi-depth hair shells instead: back (`H01`), crown fill behind ears (`H02c`), mid depth (`H02`/`H02s`), under-bangs (`H03u`), side locks (`H04s`/`H04`), and front bangs (`H03C/R/L`).
2. **Never flip `behind` (`0 ↔ 1`) near center yaw (`a = 0`) over the forehead or brows.** The runtime treats `behind` as a hard binary cutout (`>= 0.5 ? 1 : 0`) against `[maskA, maskB]` (typically `["F01", "F01"]`). Flipping `behind` near `a = 0` causes sudden popping bands under front bangs. Keep `H03u` strictly outside the eyebrow X-band and lock `H02c/H03u/H02s/H04s` permanently to `behind = 1.0` at every angle. For far-side locks (`H04`), delay any `behind` flip until the lock clears the far cheek edge (`|a| >= 0.28`).
3. **Protect animal ear fluff (`WE01/WE02`).** Draw crown fill shells (`H02c`) *behind* kemonomimi ears and keep the crown dome below ear roots so dark hair triangles never poke across white inner ear fluff. Always set `pitchGroups[earId] = "ear"` so ears pivot at the skull root without detaching on vertical pitch.
4. **Keep `pad` generous (`320–420 px`) on warped/head layers.** The vertex shader builds each layer's quad from its affine corners inflated by `pad`. Under-sizing `pad` clips hair tips or warped bangs cleanly along a straight line.
5. **Use `tail` (rigid pelvis rotation) for fluffy animal tails, not spring chains.** Discrete multi-segment spring chains (`chains[]`) deform thick tails like wavy flags with segment creases. Use `pack.tail = {"id": "T01", "pivot": [px, py], "amp": 0.165, "freq": 2.45, "happyFaces": ["Happy", "Starry"]}` with pure rigid rotation (zero non-uniform `sx/sy` squash/stretch) and zero out any chain assigned to that layer.
6. **Set `clipTarget: true` on every mask parent — and use `clipInvert` / `outfits.<g>.clipMask` for hoods & conditional masks.** Nested masks (e.g., iris clipped to sclera `E01R/L`, sclera clipped to face `F01`) rely on topological sorting of `clipFbo` targets. Always ensure `clipTarget: true` is set on every layer referenced by another layer's `clip` or `behind`. Add `clipInvert: true` on a layer for permanent reverse masking (cuts out where the clip target is opaque), or attach `clipMask: {"target": "HD_BACK", "layers": [...], "invert": false}` on an entry in `pack.outfits` to smoothly clip/reverse-mask hair or accessories ONLY while that outfit toggle (such as a hood) is worn.
7. **Author pose-arm holds with explicit rest-arm suppression.** In `expr.holds[name]`, list every replaced resting arm/sleeve/hand layer in `"hide"` AND lock arm spring motion with `"still": ["armR"]` (or `"armL"`).
8. **Avoid forehead shade overlap & mid-blink captures.** Position mood/gloom overlays high above the browline. When capturing expression sheets in headless Chrome, reset `window.__rigApi.init()` or force `eyes: 1.0` so random blinks never catch a hero expression half-shut.
9. **Apply True 3D Partial Masking on Socks, Sleeve Cuffs & Tubular Bands.** Never draw an uncut hollow back-rim ellipse ON TOP of an entering limb or neck. Split every sock (`S01R/L`), sleeve cuff (`J05R/L`, `C04R/L`), or band along its curved front-lip parabola into two pixel-locked layers: `<ID>_back` drawn **BEHIND** the entering limb, and `<ID>` (front lip only) drawn **IN FRONT OF** the limb. Always include `<ID>_back` in `outfits[...].hide` and `body.elbowHalf`.
10. **Inspect Bare Shoulders (Jacket OFF), Neck-to-Head Smoothness & Open-Arch Shoe Fill.**
    - **Bare shoulders (`without_jacket`):** Keep the top shoulder ridge & armpit 100% opaque (`alpha = 255`), seat `B03R/L` tangent to `B02`'s collarbone slope (`0 px` V-notch), strip only internal shoulder-socket ink, and map bare arms in `body.elbowHalf`.
    - **Neck-to-head (`B01 -> F01`):** Trim any flared upper jaw stub on `B01` down to slender neck width AND erase any baked U-shaped dark chin fold/outline on the upper neck interior (which gets exposed on head turns as a weird neck crease) so a completely smooth shaded neck cylinder rises behind the chin at every angle.
    - **Open-arch shoes (Mary Janes / strapped heels):** Smoothly flare the lower sock instep (`y >= 0.66h`) via `map_coordinates` (never binary dilation) so shaded sock fabric fills the shoe arch wall-to-wall with zero background gaps and zero dark sock outlines visible inside the arch.
    - **Stem-free, ear-free face oval (`F01`):** `F01` rotates with the head and must NEVER contain a hanging neck stem below the chin outline or baked-on human ears on its sides (which create double ears alongside `F05`/`F06`). Flood-fill `F01`'s interior face skin and strip everything outside the dark cheek/chin outline; extend `B01` upward behind the chin and keep `F05`/`F06` as the sole parallax ear pair.
    - **Focused straight-ahead eye gaze, sleek eye proportions & sculpted lower lashes (`E01`–`E06`):** Place irises & pupils slightly *inward* of sclera centers (`outward_div <= 0%`) inside a sleek, wide, less-open almond sclera (`iris_w ≈ 42–55%` of sclera width, extending outward toward the sides of the face without pushing inner corners apart), align `E04` highlights to one key-light direction, and sculpt `E06` lower lashes delicately along `E01`'s exact curved lower rim (`50–95%` span).
    - **Default Full 3D Side-of-Head Stack (`F02tR/L`, `F01sR/L`, `F03tR/L` & Multi-Strand Side Hair `H02s`/`H04s`):** Synthesize sleek side-of-jaw planes (`F01sL`/`F01sR`, `jaw_depth_px=14–20` — never puffy cheek bulges!), clipped rear-to-front directional 3D face shading (`F02tR`/`F02tL`, `clip="F01"`), and sculpted 3/4 noses (`F03tR`/`F03tL`, `clip="F01"` as front `F03` yields to `0`) via `rigkit.face3d` (`face3d.py`). Place `F02tR/L` immediately before `F01sR/L` (shared rear-to-front shadow profile -> `< 1 LSB` seamless transition, bounded monotonic hinge mapping -> `max|D| < 0.25` with zero mid-yaw double chin!). Composite lush multi-strand side-of-skull hair curtains (`H02s`/`H04s`, `w ≈ 340–400px`, `behind: ["F01", "F01sR"/"F01sL"]`) unfolding smoothly rearward on turns behind graceful cheek-framing locks (`H04`, `behind: ["F01", "F01"]`).
    - **Crisp, non-rubbery body motion (match Test Signal):** Omit `motion.turnChain` on fitted outfits/jackets/belts/skirts (it rubber-warps structured torsos/hips on head turns). Use subtle `bodyFollowLR: [0.025, 0.025]`, `bodyFollow: [0.12, 0.25]`, `limit.bend: 0.25`, and wide `bodyR` so the body sways naturally without squishing.
11. **Audit Attachment Polish & Auto-Generate Fix Prompts Before Shipping.** Run `python3 polish_audit.py avatar.l2d --out polish_out/ --prompt` (from `layer2d-agent-kit.zip`, or `python3 -m rigkit.polish models/<slug> --prompt`) across ALL outfit toggle states. It scores attachment polish `0–100`, renders zoomed close-ups (`polish_audit.png`), and outputs a copy-paste remediation prompt (`polish_fix_prompt.txt`) with exact layer IDs and pixel errors so even less experienced agents can fix every defect cleanly until `FAIL=0` and `score >= 92`.
12. **Always run a visual Playwright QA sweep before finishing.** Inspect rendered PNG contact sheets across:
   - Full yaw sweep (`a = -1.0, -0.75, -0.5, -0.25, 0.0, +0.25, +0.5, +0.75, +1.0`) AND fine center sweep (`-0.40 .. +0.40`) to catch any under-bangs or mask pops.
   - Upper-temple chroma gap check at extreme turns (`±1.0` settled 24 frames).
   - 3×3 head pitch grid (`AngleX × AngleY`).
   - All expressions, outfit toggles, pose-arm holds, and OBS `?obs=1` top-corner alpha (`alpha === 0`).

---

## 5. User Visual QA Checklist & Copy-Paste Prompts to Fix AI Defects

Reviewing an AI-generated `.l2d` avatar? First run `python3 polish_audit.py avatar.l2d --out polish_out/ --prompt` and paste `polish_fix_prompt.txt` back to your AI agent. Also watch visually for these common defects and use these exact prompts:

- **Hollow sock/sleeve/band back rim drawn over skin:** *"Split the socks (`S01R/L`) and sleeve cuffs (`J05R/L`) with partial masking: move the hollow back inner rim to `<ID>_back` behind the entering limb and keep only the curved front lip on `<ID>` in front. Add `<ID>_back` to `outfits` and `body.elbowHalf`."*
- **Bare shoulder gap/V-notch when toggling jacket OFF:** *"Hide the jacket and hair, then inspect `B02`/`B03R/L`. Keep the top shoulder ridge & armpit 100% opaque (`alpha=255`), lower/seat `B03R/L` tangent to `B02`'s collarbone slope so notch=0px, and map `B03/B04` in `body.elbowHalf`."*
- **Non-smooth stair-step or gap between neck & head:** *"Trim the flared upper jaw stub off the top of neck `B01` down to slender mid-neck width so `B01` enters behind `F01`'s chin smoothly with zero horizontal step."*
- **Socks not filling open-arch shoes (Mary Janes) wall-to-wall:** *"Composite `S02R/L` on a bright green backdrop. Smoothly flare `S01R/L`'s lower instep (`y >= 0.66h`) via `map_coordinates` so real shaded sock fabric fills the shoe arch wall-to-wall with zero gaps and zero internal sock outline."*
- **Face layer neck stem or double human ears (`F01` + `F05/F06`):** *"Inspect `F01` alone on green. Strip any hanging neck stem below the chin jawline (so nothing swings off `B01` on head turns) and erase baked-on ears on `F01`'s sides so ONLY separate `F05`/`F06` ears remain."*
- **Unfocused eyes, eye proportions, or flat/detached lower lash:** *"Run `polish_audit.py --prompt` to check `eye_gaze_focus` and `lower_lash`. Shift irises & pupils (`E02/E03`) inward toward the nose bridge (`outward_div <= 0%`), widen `E01` outward at a sleeker less-open height with crisp smaller irises, align `E04` highlights to one key light, and sculpt `E06` snugly along `E01`'s curved lower rim."*
- **Flat, puffy, or thin side of head on 3/4 head turns:** *"Build the full 3D side-of-head stack via `rigkit.face3d`: calibrate `F01`'s front contour 1:1 to `placed/F01.png` with a slender straight-angled ~38° turned jawline, add clipped rear-to-front directional face shading (`F02tR/L`) + sleek side-of-jaw planes (`F01sL/R`, `jaw_depth_px=14–20`, placed right after `F02tR/L`) + 3/4 nose (`F03tR/L` while `F03` yields to `0`), and composite lush multi-strand side-of-skull hair curtains (`H02s/H04s`) unfolding rearward behind cheek-framing locks (`H04`)."*
- **Rubbery body warping when moving or turning:** *"Remove `body.turnChain` and match Test Signal's solid body physics: `bodyFollowLR: [0.025, 0.025]`, `bodyFollow: [0.12, 0.25]`, `bodyR: 920`, `limit.bend: 0.25`, and subtle `turnBody` (`±8px`)."*
- **Oversized choker/belt overhanging into air or misaligned limbs:** *"Resize choker `A03` to `1.00–1.10×` neck width, tuck halter straps behind the choker, seat belt `K01` flush on `K02`, and anchor-solve all limb joints (`fit_anchor_segment`) within `< 2px`."*
- **Brow/hair pops or ear drift on head turns:** *"Run `qa_runner.py` and inspect `qa_turns_center.png` and `qa_pitch_grid.png`. Lock hair `op = 1.0`, lock depth shells to `behind = 1.0` across all yaw angles, put crown fill behind animal ears, and pad quads `>= 320px`."*
