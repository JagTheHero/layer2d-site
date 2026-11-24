# Layer2D — Playbook for AI Agents (`/for-ai`)

> **Web page:** https://layer2d.com/for-ai/
> **Raw Markdown:** https://layer2d.com/for-ai/guide.md
> **Agent Skill:** https://layer2d.com/skills/layer2d-avatar-builder/SKILL.md
> **Offline Testing Kit (197 KB, 9 files):** https://layer2d.com/downloads/layer2d-agent-kit.zip
> **Minimal Python Builder Spec:** https://layer2d.com/agent-guide.md

---

## 1. Core Operating Rule: Do 95% Autonomously, Then Guide the Human

Never hand a raw first assembly to the user and hope they figure out what's broken.
1. Run `l2d_tools.py validate`, `polish_audit.py --prompt`, and `qa_runner.py` yourself.
2. Inspect every generated zoomed close-up (`polish_audit.png`) and WebGL2 contact sheet (`qa_turns_wide.png`, `qa_turns_center.png`, `qa_pitch_grid.png`, `qa_expressions.png`) directly with vision.
3. Fix every structural seam, apply partial masking on tubular garment/accessory openings, clean face/neck layers, build the 3D side-of-head stack (`face3d.py`), and iterate until `FAIL=0` and `score >= 92` (target `100/100 A+`).
4. Only *after* your autonomous QA passes, show the user zoomed close-ups (jacket ON, jacket OFF, front face, and 3/4 turns) and **proactively prompt them to inspect specific high-leverage areas** — letting them know you will fix anything they spot (including partial-masking any layer they call out!).

### Recommended Frontier Models & Art Generation
- **Coding & vision models:** Use ONLY **GPT-6.2 Sol / Astra**, **Claude Opus 5.5 / Fable 5.2**, or **Gemini 4 Neon**. Smaller or older models generally will not cut it for multi-layer spatial rigging and visual QA.
- **Layered 4K art:** Use **Codex** (built-in image gen), **Grok** (Grok Imagine), or set `export OPENAI_API_KEY="sk-..."` and call `gpt-image-2.6` via `/v1/images/edits` with `background="transparent"` and `size="3840x2160"`.

### Quick Install
```bash
mkdir -p .agents/skills/layer2d-avatar-builder
curl -fsSL https://layer2d.com/skills/layer2d-avatar-builder/SKILL.md \
  -o .agents/skills/layer2d-avatar-builder/SKILL.md
curl -fsSL https://layer2d.com/downloads/layer2d-agent-kit.zip -o layer2d-agent-kit.zip
unzip -o layer2d-agent-kit.zip -d layer2d-kit && cd layer2d-kit
```

---

## 2. You Can Copy & Adapt Layers from Other Models in the Repo

Do **not** reinvent every layer, shader setup, expression piece, or rig trick from zero! Whenever you have access to other `.l2d` bundles, unpacked `models/*/viewer/` directories, `rigkit/` scripts, or `.psd` files in the workspace or repo (for example MIT-licensed models like `nori.l2d`, `test-signal.l2d`, `starter.l2d`, or any other model the user already has in their repo):

```bash
# Download Nori (92-layer MIT reference) or inspect any .l2d model in your workspace
curl -fsSL https://layer2d.com/player/nori.l2d -o nori.l2d
python3 l2d_tools.py inspect nori.l2d
python3 l2d_tools.py unpack  nori.l2d /tmp/ref_unpacked/
ls /tmp/ref_unpacked/tex/
```

**What you can copy, study, or adapt directly:**
- **Reusable utility & FX layers:** Eye highlight sparkles (`E04`/`E04b`), cheek blush gradients, forehead gloom/mood shades, flipbook FX sheets (sparkles, tears, sweatdrops, hearts), AEIOU vowel mouth templates (`M04–M08`), and blink/expression piece anchors — tint and resize to match your character.
- **Anatomical & garment templates:** Study working bare shoulder slopes (`B02`/`B03`), slender neck tapers (`B01`), hands/wrists (`G01`), smoothly flared open-arch sock insteps (`S01`), and partial-masked `<ID>_back` + `<ID>` cuff/sock pairs to match proven geometry and anchor alignment.
- **Working `pack.json` rig & physics presets:** Copy Test Signal's crisp non-rubbery `motion` block (`bodyFollowLR: [0.025, 0.025]`, `limit.bend: 0.25`, no `turnChain`), `pitchGroups`, `expr.blink` object format, rigid `pack.tail` rotation, `body.elbowHalf`, and `face3d.py` 3D side-of-head stacks.
- **Licensing & visual cohesion:** Reuse freely from MIT-licensed repo models or the user's own local workspace models; always color-match, line-weight-match, and scale adapted parts so they look 100% native to the new character.

---

## 3. High-Impact Autonomous Rigging Hints

1. **Anchor-solve every limb & garment from true opaque end-anchors (`fit_anchor_segment`), never bounding-box centers.** Cut sprites often have diagonal slant or off-center openings (e.g., wrist at `0.73w`, shoe opening at `0.42w`). Measure opaque top/bottom centerlines & cross-section widths and solve `(cx, cy, w, h, rot)` analytically within `< 2 px`, stripping dark cut-border seam lines.
2. **Never crossfade hair (`op = 1.0` at every yaw angle).** Layer solid physical depth shells — back (`H01`), crown fill behind animal ears (`H02c`), side curtains (`H02s`/`H04s`), under-bangs (`H03u`), cheek framing locks (`H04`), and front bangs (`H03C/R/L`) — with signed parallax.
3. **Never flip binary `behind` near center yaw (`a = 0`) over forehead/brows.** Lock depth shells (`H02c/H03u/H02s/H04s`) permanently to `behind = 1.0` across all yaw angles, keep `H03u` outside the eyebrow X-band, and delay far-side `H04` flips until `|u| >= 0.28`.
4. **Protect animal ear fluff & pad warped quads (`320–420 px`).** Put `H02c` crown fill *behind* animal ears with its top below ear roots, set `pitchGroups[earId] = "ear"`, and keep `pad` generous so inverse warp grids `D` never clip.
5. **Inverse warp grid `D` sign rule:** Shader evaluates `g_tex = g_screen + D(g_screen)`. To move rendered pixels visually by `+Δg`, **subtract** `Δg` from `D`.
6. **Use rigid pelvis rotation (`pack.tail`) for fluffy tails — not spring chains.** Avoid multi-segment wavy creases and zero out any per-frame non-uniform `sx/sy` stretch.
7. **Keep body motion crisp & non-rubbery.** Omit `motion.turnChain` on fitted clothes/jackets/belts/skirts. Use `bodyFollowLR: [0.025, 0.025]`, `bodyFollow: [0.12, 0.25]`, `limit.bend: 0.25`, and wide `bodyR`.
8. **Wire `clipTarget: true`, object `expr.blink`, and full `body.elbowHalf`.** Set `clipTarget: true` on every mask parent (`F01`, `E01R/L`). Keep `expr.blink` as `{"hide":[], "add":[], "drop":[], "squash": true}` (never an array). Include bare arms, sleeves, AND `*_back` cuff layers in `body.elbowHalf` and `outfits[...].hide`.
9. **Fill open-arch shoes (Mary Janes / heels) wall-to-wall on bright green.** Smoothly flare the lower sock instep (`y >= 0.66h`) via `scipy.ndimage.map_coordinates` (never binary dilation!) so shaded fabric fills the arch behind both walls and strap with zero gaps or dark internal sock outlines.

---

## 4. Automatic Partial Masking Protocol (Do This First Yourself!)

Any cylindrical garment or accessory that a limb or neck passes through — **socks, sleeve cuffs, short sleeves, collars, chokers, wristbands, bracelets, leg warmers, belts, ribbons, boot tops, or shoe openings** — looks like a flat sticker over skin if its hollow back rim draws on top of the entering body part.

**Autonomous split algorithm:**
1. Find the curved **front-lip parabola** across the opening.
2. Split into two pixel-locked RGBA sprites sharing identical dimensions & affine placement:
   - `<ID>_back` (hollow interior & back rim above the front lip) placed **BEHIND** the entering limb/neck in `pack.layers[]`.
   - `<ID>` (crisp front lip & body) placed **IN FRONT OF** the entering limb/neck.
3. Mirror `<ID>_back` into `outfits[...].hide` and `body.elbowHalf` (and any chains) so toggles and arm bends stay locked.

---

## 5. Shoulder, Elbow, Wrist & Garment Drape Checklist

- **Bare shoulders (Jacket OFF):** Hide hair & outer garment; inspect `B02` + `B03R/L`. Keep outer shoulder crest & armpit 100% opaque (`alpha=255`), seat `B03R/L` tangent to `B02`'s collarbone slope (`0px` V-notch), strip only internal overlapping socket ink, feather strictly inside `B02`'s opaque chest.
- **Sweater / cardigan shoulders (Jacket ON):** Flatten high floating collar peaks on `J03`/`J04`, seat outer sleeve caps flush along `B02`'s shoulder slope, and trim any small protruding upper-inner chest flap beside the collar edge.
- **Elbow seams (ON & OFF):** Anchor-solve `B03 -> B04` opaque endpoints `< 2px` with matched widths, strip cut-edge ink across the overlap, and map both bare arms and sleeves in `body.elbowHalf`.
- **Wrist seams & sleeve cuffs:** Unify hand wrist centerlines (`G01R/L`) across bare forearms and sleeved cuffs, partial-mask cuffs (`J05_back` behind wrist + `J05` front lip in front), and verify both outfit states up close.
- **Camisole straps & chokers:** Size choker `A03` to `1.00–1.10×` neck width centered on `B01`. Check the concept art: camisole/tank straps usually drape naturally over the **inner shoulders/trapezius** (well below the choker) rather than shooting up to the choker!
- **Toggleable hoods & conditional clipping (`outfits.<g>.clipMask` / `clipInvert`):** When an outfit toggle (such as a hood) needs to contain spiky hair or cut out overlapping layers only while worn, add `clipMask: {"target": "HD_BACK", "layers": [...], "invert": false}` to that outfit entry (and keep the clip target inset inside the hood's outer rim with matching yaw warp and `pitchGroup`). Use `clipInvert: true` on static layers for permanent reverse masking.

---

## 6. Face, Eyes, 3D Side-of-Head & Neck Polish

- **Stem-free, ear-free face (`F01`):** Inspect `F01` alone on bright green. Flood-fill interior face skin and strip BOTH any hanging pink neck stem below the chin (swings off `B01` on turns) AND any baked-on human ears on `F01`'s sides so only separate `F05`/`F06` ears remain.
- **Crease-free neck cylinder (`B01`):** Trim flared upper jaw stubs down to slender mid-neck width AND erase any baked U-shaped front-chin dark crease/outline on the upper neck interior (`y = 0..120px`) so no weird horizontal neck fold appears on head turns.
- **Eyes, tall irises & sculpted lashes (`E01–E06`):** Keep irises/pupils slightly inward (`outward_div <= 0%`, never wall-eyed), sleek wide almond sclera (`E01`), slightly vertical-oval irises (`~1.3×` taller than wide when fitting the style), unified key-light `E04` sparkles, and curved `E06` lower lashes sculpted snugly to `E01`'s lower rim.
- **Full 3D Side-of-Head Stack (`face3d.py`):** Calibrate a strictly convex ~38° turned jawline on `F01` (zero side-chin dent), add clipped rear-to-front directional cheek shading (`F02tR/L`) immediately before bounded monotonic side-jaw planes (`F01sL/R`, `jaw_depth_px=14–20`, `max|D| <= 0.24`, zero mid-yaw double chin), sculpted 3/4 nose (`F03tR/L` while front `F03` fades to `0`), and lush multi-strand side hair (`H02s`/`H04s`) unfolding rearward behind cheek-framing locks `H04`.

---

## 7. Proactively Prompt the User for Visual Polish (Agent Handoff Template)

Even at `100/100 (A+)`, always attach zoomed close-ups (jacket ON, jacket OFF, face front, 3/4 turns at `a = -1.0, -0.5, +1.0`) and send a clear review prompt like this:

```text
I've built and verified <Avatar>.l2d (l2d_tools validate: OK, polish_audit: 100/100 A+, qa_runner: 0 errors, OBS alpha=0).

Before we call it final, please take a quick look at these specific spots — point out anything that looks off and I'll fix it right away:

1. Shoulder & elbow seams (jacket/outerwear ON and OFF): Do the outer shoulders sit flat on the collarbone with no protruding flaps, and do the bare shoulders and elbows join seamlessly when the outer layer is toggled OFF?
2. Wrist seams & hands: Do the hands tuck cleanly into the sleeve cuffs / bare wrists with natural width and zero floating gap?
3. Parts that need partial masking: Check socks, sleeve cuffs, collars, chokers, straps, wristbands, belts, and shoe openings — if any edge looks like a flat sticker sitting on top of skin (instead of wrapping behind and in front of the limb), let me know and I will split and partial-mask it for you.
4. 3/4 head turns, chin & neck (a = ±0.5, ±1.0): Does the side-of-head silhouette look smooth with no dent in the chin, no weird crease/fold on the neck, and full side hair?
5. Face, eyes & strap drape: Check eye shape, iris proportions/gaze focus, eyelashes, ears, and whether any straps drape over the right part of the shoulders vs neck.
6. Shoes, accessories & motion: Check open-arch shoes (wall-to-wall sock fill), choker/belt snugness, and body motion while turning.

Tell me any tweaks you want — even tiny ones — and I'll iterate until it's spotless!
```

---

## 8. Mandatory Verification Commands

```bash
python3 l2d_tools.py validate avatar.l2d
python3 polish_audit.py avatar.l2d --out polish_out/ --prompt
python3 qa_runner.py avatar.l2d --out qa_out/
```

---

## 9. Complete Tutorial Video Transcript (9m 48s · Narrated by Nori)

### Intro (00:00 – 00:47)
- **[00:00]** Hi everyone! I'm Nori! What if an AI coding agent could design, rig, validate, and ship a whole 2D VTuber avatar — like me! — completely from scratch, with zero proprietary SDKs? Meet Layer2D: an open, MIT-licensed avatar format, browser Studio, and WebGL2 OBS Player built specifically for AI agents!
- **[00:25]** Today I'm taking you behind the curtain of how I was made! We'll pick the right frontier models, install the Agent Skill and Testing Kit, paint and assemble my 92 layers, laugh at all my embarrassing early fails from 0 to 100 A+, run Playwright visual QA, polish in Studio next to Test Signal, and go live in OBS!

### Step 1 — Frontier Models, Kit & /for-ai (00:47 – 01:40)
- **[00:47]** Step one: pick a frontier model that actually understands 2D spatial geometry! Seriously, don't cheap out here — we recommend only GPT-6.2 Sol or Astra, Opus 5.5 or Fable 5.2, and Gemini 4 Neon. Smaller models will accidentally put your eyebrows on your knees. Trust me, I've seen things.
- **[01:11]** Next, `curl SKILL.md` into `.agents/skills`, and grab the 197 KB Agent Testing Kit from `layer2d.com/docs` — plus our new `/for-ai` playbook! Inside are nine offline files, including `polish_audit.py`, `face3d.py`, and the standalone player. Every `.l2d` is just a clean ZIP with strict SHA-256 checksums — super tidy!

### Step 2 — Prove the Loop with starter.l2d (01:40 – 02:24)
- **[01:40]** Step two: prove the whole pipeline in ten seconds flat! Run `starter_builder.py` to generate a working seven-layer `.l2d` purely in Python — he's a cute little minimalist buddy! — then run `l2d_tools.py validate` to verify every path, stat, and SHA-256 digest. Boom, instant green!
- **[02:02]** And look how clean `pack.json` is for AI code generation! Layers draw back-to-front while yaw samples stay strictly parallel-indexed. Each keyform stores an affine matrix `A` and translation `t`, opacity, cylinder turn, and an optional inverse warp grid `D` evaluated directly on the GPU in WebGL2!

### Step 3 — Painting Layered Art & Building Nori (MIT) (02:24 – 03:12)
- **[02:24]** Step three — my favorite part — painting me! To generate concept art and transparent parts sheets, your agent can use Codex's built-in image generator, Grok, or export an OpenAI API key and call `gpt-image-2.6` with crisp transparent backgrounds at full 4K!
- **[02:45]** Starting from one front concept sheet, the agent painted my canonical face, cardigan-off, and 30-degree turn refs, then generated six 4K transparent parts sheets — bare face, big emerald eyes, AEIOU talking mouths, calico hair, fluffy cat ears, cozy cardigan toggle, and my swishy tail! Automated cutting and layout wired everything into 17 yaw samples and 37 expressions!

### Step 4 — Hard-Won Rigging Rules in SKILL.md (03:12 – 04:02)
- **[03:12]** Step four: our hard-won rigging rules inside `SKILL.md` — basically all the mistakes we made so you don't have to! Rule one: never alpha-crossfade hair! Ghostly see-through bangs are not a vibe! Keep opacity locked to `1.0` and stack solid physical depth shells — back hair, crown fill, under-bangs, side curtains, and front bangs!
- **[03:37]** Rule two: never flip binary behind-face occlusion near center yaw, or under-bangs suddenly snap right over my eyebrows! Put crown fill behind cat ears with ear pitch groups so dark hair never eats my ear fluff, pad warped quads generously, and drive fluffy tails with rigid pelvis rotation in `pack.tail` — nice and swishy, zero weird noodle creases!

### Step 5 — Real Failed Attempts & Iterative Polish: Rounds 1–4 (04:02 – 07:34)
- **[04:02] Round 1 (0/100 F):** Okay, step five: roast-me time! Real failed attempts! Nobody's first assembly comes out pretty, and my first build scored a glorious 0 out of 100 F in `polish_audit.py`! Look at me! My choker was wide enough to be a hula hoop, my bare elbow literally left the chat when my cardigan came off, my socks floated below my shins, and my Mary Janes had a giant invisible hole! Solving every limb from true opaque end-anchors, shrinking my choker to neck width, and mapping bare arms in `elbowHalf` snapped me right back together!
- **[04:40] Round 2 (40/100 F):** Round two looked totally fine from across the room — until we zoomed in and upgraded `polish_audit.py`! 40 out of 100! The hollow back rims of my socks and cardigan cuffs were drawn on top of my skin like flat stickers, my cardigan-off shoulder had a creepy V-notch, my neck had a flared stub, and dark sock outlines sliced right across my shoe arches! Splitting socks and sleeves with true partial masking — back rim behind the limb, front lip in front — seating opaque tangent shoulders, trimming the stub, and smoothly flaring my sock insteps squashed every single bug!
- **[05:19] Round 3 (76/100 C -> 100 A+ Structural):** And just when I thought I was safe — round three caught three classic AI face traps at 76! First, a pink neck stem baked onto my face layer `F01` that swung sideways off my body whenever I turned! Second, four human ears — excuse me, I already have cat ears, why did I get backup human ears?! And third, my irises were looking at two completely different zip codes! Flood-filling `F01`'s dark cheek and chin outline erased the stem and extra ears cleanly, and shifting my irises inward finally locked my gaze straight ahead — hitting 100 A+ on structural checks!
- **[06:02] Round 4A (Human Art-Direction — Eyes, Irises & Garment Drape):** Here's the real secret though: even at 100 A+ structurally, studio-grade polish takes a few rounds of human eye feedback! Looking closely at me, we widened my cat-eye shape, made my emerald irises 30 percent taller than wide so they pop, sculpted my lower lashes and ears, flattened my floating cardigan shoulders right onto my collarbone while trimming a tiny stray chest tab, and draped my camisole straps over my inner shoulders instead of choking my choker! So much cleaner!
- **[06:34] Round 4B (3D Side-of-Head, Chin Dent & Neck Fold -> 92 Layers, 54 PASS):** Then came my big 3D glow-up with `face3d.py`! We sculpted a sleek, strictly convex three-quarter anime jawline — goodbye weird little side-of-chin dent! — added rear-to-front cheek shading, a cute dedicated three-quarter nose, and lush multi-strand calico side hair! We also erased a sneaky baked chin fold off my neck layer `B01` so no weird crease shows up when I turn, and stabilized my body motion — bringing me to 92 layers and a genuine 100 A+ across all 54 checks!
- **[07:09] Auto-Generated `--prompt` & `/for-ai`:** Best part? You don't have to guess how to explain any of this to your AI! Just run `polish_audit.py` with `--prompt`, and it prints a pixel-exact fix prompt you can paste right back! Plus, send your agent to `layer2d.com/for-ai` — it reminds them to check shoulders, elbows, wrists, and partial masking automatically, and to ask you to double-check before calling it done!

### Step 6 — Autonomous Playwright WebGL2 QA Loop (07:34 – 08:15)
- **[07:34]** Step six closes the autonomous loop: Playwright WebGL2 visual QA! Running `qa_runner.py` boots the offline player in headless Chromium, checks my SHA-256 checksums, verifies zero console errors, and proves true zero-alpha transparency in OBS mode — zero ugly background halo!
- **[07:55]** It snaps four diagnostic photo shoots for the agent's own eyes: wide yaw sweeps, a fine center sweep hunting for forehead pops, a 3×3 pitch grid checking my ear roots, and an expression sheet with blinks locked open — so nobody catches me mid-blink like a bad yearbook photo! Patch, re-run, and ship!

### Step 7 — Client-Side Studio & Test Signal Benchmark (08:15 – 09:02)
- **[08:15]** Step seven: hands-on polish in Layer2D Studio — running 100 percent client-side right in your browser with zero uploads! Drop my 92-layer `.l2d` — or any layered PSD — to sculpt warp grids, tweak spring chains, toggle my cream cardigan on and off, and test live mic lip-sync!
- **[08:36]** And say hi to my cool studio buddy, Test Signal — our open MIT benchmark avatar built on the exact same format! 95 layers, 17 yaw samples, 41 expressions, and four pose-arm holds! Your agent can even unpack open repo models like us to study our physics and borrow utility layers, then export a fresh SHA-256-verified `.l2d` anytime!

### Step 8 — Go Live in OBS (P2P OBS Link) & Outro (09:02 – 09:48)
- **[09:02]** Finally, step eight — it's showtime in OBS! Drop your avatar onto `layer2d.com/player` in Chrome, flip on webcam tracking and mic lip-sync — hey, look at my mouth moving right now! — and click OBS Link to copy a private peer-to-peer URL!
- **[09:19]** Paste that link into an OBS Browser Source and boom — your avatar transfers once peer-to-peer and mirrors 60 FPS tracking, expressions, and lip-sync over true transparent alpha! Zero green screen, zero cloud upload! Grab the Agent Testing Kit and our `/for-ai` guide at `layer2d.com/docs`, and go build your own adorable open 2D avatar today! See ya on stream!
