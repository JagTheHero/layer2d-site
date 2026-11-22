/**
 * Bottom Collapsible Keyframe Animation Timeline (Dope Sheet + Playback + WebM Video Export)
 * Matches studio_concept_rigging.png (collapsed 34px bar) and studio_concept_animate.png (expanded 218px dope sheet).
 */

const TRACK_DEFS = [
  { key: "a", label: "Angle X", fmt: (v) => `${(v * 32.5).toFixed(1)}°`, numeric: true },
  { key: "pitch", label: "Angle Y", fmt: (v) => `${(v * 30.0).toFixed(1)}°`, numeric: true },
  { key: "roll", label: "Angle Z", fmt: (v) => `${((v * 180) / Math.PI).toFixed(1)}°`, numeric: true },
  { key: "eyes", label: "Eye Open", fmt: (v) => Number(v).toFixed(2), numeric: true },
  { key: "vowel", label: "Mouth Vowel", fmt: (v) => v || "—", numeric: false },
  { key: "face", label: "Expression", fmt: (v) => v || "Neutral", numeric: false },
  { key: "tailSway", label: "Tail Wag", fmt: (v) => Number(v).toFixed(2), numeric: true },
];

function easeVal(u, ease = "easeInOut", bz = null) {
  u = Math.max(0, Math.min(1, u));
  if (ease === "linear") return u;
  if (ease === "step") return 0;
  if (ease === "back") {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
  }
  if (ease === "custom" && bz) {
    // Evaluate cubic Bezier y(t) approximately at t = u
    const inv = 1 - u;
    return 3 * inv * inv * u * bz.p1y + 3 * inv * u * u * bz.p2y + u * u * u;
  }
  return u * u * (3 - 2 * u); // smooth easeInOut
}

export class TimelineController {
  constructor(state, engine, onToast) {
    this.state = state;
    this.engine = engine;
    this.onToast = onToast;

    this.dock = document.getElementById("timeline-dock");
    this.collapsedBar = document.getElementById("tl-collapsed-bar");
    this.expandedWrap = document.getElementById("tl-expanded");
    this.tracksCol = document.getElementById("tl-tracks-col");
    this.dopeWrap = document.getElementById("tl-dope-wrap");
    this.canvas = document.getElementById("tl-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.timeMini = document.getElementById("tl-time-mini");
    this.clipSel = document.getElementById("tl-clip-select");

    this.dragKey = null;
    this.scrubbing = false;
    this._bindUI();
    this._bindState();
  }

  _bindUI() {
    const st = this.state;
    const togglePlay = () => {
      st.timeline.playing = !st.timeline.playing;
      if (st.timeline.playing) st.snapToKeyform = false;
      this.syncPlayButtons();
    };

    document.getElementById("tl-play-mini").addEventListener("click", togglePlay);
    document.getElementById("tl-play").addEventListener("click", togglePlay);
    document.getElementById("tl-expand-btn").addEventListener("click", () => this.setExpanded(true));
    document.getElementById("tl-collapse-btn").addEventListener("click", () => this.setExpanded(false));

    document.getElementById("tl-first").addEventListener("click", () => { st.timeline.time = 0; this.applyAtTime(0); });
    document.getElementById("tl-last").addEventListener("click", () => {
      const c = st.getActiveClip();
      if (!c) return;
      st.timeline.time = c.duration;
      this.applyAtTime(c.duration);
    });
    document.getElementById("tl-prev").addEventListener("click", () => this._jumpKey(-1));
    document.getElementById("tl-next").addEventListener("click", () => this._jumpKey(1));

    const loopCb = document.getElementById("tl-loop");
    loopCb.addEventListener("change", () => { st.timeline.loop = loopCb.checked; });
    const fpsSel = document.getElementById("tl-fps");
    fpsSel.addEventListener("change", () => {
      st.timeline.fps = Number(fpsSel.value);
      const c = st.getActiveClip();
      if (c) c.fps = st.timeline.fps;
      this.drawDope();
    });

    this.clipSel.addEventListener("change", () => {
      st.timeline.clipIdx = Number(this.clipSel.value);
      st.timeline.time = 0;
      this.renderTracks();
      this.drawDope();
    });

    document.getElementById("tl-add-key").addEventListener("click", () => this.insertKeyframeAtPlayhead());
    document.getElementById("tl-new-clip").addEventListener("click", () => {
      const name = prompt("New animation clip name:", `Clip ${(st.studio?.clips?.length || 0) + 1}`);
      if (!name) return;
      st.pushUndo("Add Animation Clip");
      st.studio.clips.push({
        id: name.toLowerCase().replace(/[^a-z0-9_]+/g, "_"),
        name,
        fps: st.timeline.fps,
        duration: 5.0,
        loop: true,
        tracks: { a: [{ t: 0, v: 0, ease: "easeInOut" }, { t: 5.0, v: 0, ease: "easeInOut" }] },
      });
      st.timeline.clipIdx = st.studio.clips.length - 1;
      this.syncClips();
      this.renderTracks();
      this.drawDope();
    });
    document.getElementById("tl-export-video").addEventListener("click", () => this.exportVideo());

    // Dope sheet pointer interaction (scrub playhead, select/drag diamond keyframes)
    this.canvas.addEventListener("pointerdown", (e) => this._onPointerDown(e));
    window.addEventListener("pointermove", (e) => this._onPointerMove(e));
    window.addEventListener("pointerup", () => { this.scrubbing = false; this.dragKey = null; });
  }

  _bindState() {
    const st = this.state;
    st.on("doc:loaded", () => {
      this.syncClips();
      this.setExpanded(st.timeline.expanded);
      this.renderTracks();
      this.drawDope();
    });
    st.on("mode:changed", () => this.setExpanded(st.timeline.expanded));
    st.on("params:changed", () => this.renderTracks());
  }

  setExpanded(exp) {
    this.state.timeline.expanded = exp;
    this.dock.classList.toggle("collapsed", !exp);
    this.collapsedBar.hidden = exp;
    this.expandedWrap.hidden = !exp;
    if (exp) {
      this.syncClips();
      this.renderTracks();
      requestAnimationFrame(() => this.drawDope());
    }
  }

  syncClips() {
    const clips = (this.state.studio && this.state.studio.clips) || [];
    this.clipSel.innerHTML = "";
    clips.forEach((c, i) => {
      const o = document.createElement("option");
      o.value = String(i); o.textContent = c.name;
      if (i === this.state.timeline.clipIdx) o.selected = true;
      this.clipSel.appendChild(o);
    });
  }

  syncPlayButtons() {
    const playing = this.state.timeline.playing;
    const svg = playing
      ? `<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3.5" width="3" height="9"/><rect x="9.5" y="3.5" width="3" height="9"/></svg>`
      : `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.2l8 4.8-8 4.8V3.2z"/></svg>`;
    document.getElementById("tl-play").innerHTML = svg;
    document.getElementById("tl-play-mini").innerHTML = svg;
  }

  _jumpKey(dir) {
    const clip = this.state.getActiveClip();
    if (!clip) return;
    const times = new Set([0, clip.duration]);
    for (const tr of Object.values(clip.tracks || {})) for (const k of tr) times.add(+k.t.toFixed(3));
    const sorted = [...times].sort((a, b) => a - b);
    const cur = this.state.timeline.time;
    const next = dir > 0 ? sorted.find((t) => t > cur + 0.01) : [...sorted].reverse().find((t) => t < cur - 0.01);
    if (next !== undefined) {
      this.state.timeline.time = next;
      this.applyAtTime(next);
    }
  }

  insertKeyframeAtPlayhead() {
    const st = this.state;
    const clip = st.getActiveClip();
    if (!clip) return;
    st.pushUndo("Insert Keyframe");
    const t = +st.timeline.time.toFixed(3);
    const trKey = st.timeline.selectedTrack || "a";
    clip.tracks[trKey] = clip.tracks[trKey] || [];
    const val = trKey === "face" ? (st.params.face || "Neutral") : (st.params[trKey] ?? 0);
    const ease = st.studio?.bezier?.preset || (trKey === "face" || trKey === "vowel" ? "step" : "easeInOut");
    const arr = clip.tracks[trKey];
    const ex = arr.find((k) => Math.abs(k.t - t) < 0.03);
    if (ex) { ex.v = val; ex.ease = ease; }
    else { arr.push({ t, v: val, ease }); arr.sort((a, b) => a.t - b.t); }
    this.drawDope();
    this.onToast(`Keyframe inserted on ${trKey} at ${t.toFixed(2)}s`);
  }

  step(dt) {
    const st = this.state;
    const clip = st.getActiveClip();
    if (!clip || !st.timeline.playing) return;
    let t = st.timeline.time + dt;
    if (t > clip.duration) {
      if (st.timeline.loop) t = t % Math.max(0.1, clip.duration);
      else { t = clip.duration; st.timeline.playing = false; this.syncPlayButtons(); }
    }
    st.timeline.time = t;
    this.applyAtTime(t);
  }

  applyAtTime(t) {
    const st = this.state;
    const clip = st.getActiveClip();
    if (!clip) return;
    const bz = st.studio?.bezier;

    for (const td of TRACK_DEFS) {
      const keys = clip.tracks?.[td.key];
      if (!keys || !keys.length) continue;
      let val = keys[0].v;
      if (t <= keys[0].t) {
        val = keys[0].v;
      } else if (t >= keys[keys.length - 1].t) {
        val = keys[keys.length - 1].v;
      } else {
        for (let i = 0; i < keys.length - 1; i++) {
          const a = keys[i], b = keys[i + 1];
          if (t >= a.t && t <= b.t) {
            if (!td.numeric || a.ease === "step") {
              val = a.v;
            } else {
              const u = (t - a.t) / Math.max(1e-5, b.t - a.t);
              const e = easeVal(u, a.ease || "easeInOut", bz);
              val = a.v + (b.v - a.v) * e;
            }
            break;
          }
        }
      }
      if (td.key === "a") st.setAngle(val, false);
      else if (td.key === "face") st.params.face = val === "Neutral" ? null : val;
      else if (td.key === "vowel") st.params.vowel = val || null;
      else st.params[td.key] = val;
    }

    this.timeMini.textContent = formatTime(t);
    this.renderTracks();
    if (st.timeline.expanded) this.drawDope();
  }

  renderTracks() {
    const st = this.state;
    const el = this.tracksCol;
    el.innerHTML = `<div class="tl-track-head-spacer"><span>Track</span><span style="text-align:right">Value</span></div>`;
    for (const td of TRACK_DEFS) {
      const row = document.createElement("div");
      row.className = "tl-track-row" + (st.timeline.selectedTrack === td.key ? " selected" : "");
      const v = td.key === "face" ? (st.params.face || "Neutral") : (st.params[td.key] ?? 0);
      row.innerHTML = `<span>▸ ${td.label}</span><span class="tl-track-val">${td.fmt(v)}</span>`;
      row.addEventListener("click", () => {
        st.timeline.selectedTrack = td.key;
        this.renderTracks();
        this.drawDope();
      });
      el.appendChild(row);
    }
  }

  drawDope() {
    const st = this.state;
    const clip = st.getActiveClip();
    const cv = this.canvas;
    const rect = this.dopeWrap.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(rect.width * dpr), ph = Math.round(rect.height * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const dur = Math.max(0.5, clip ? clip.duration : 5.0);
    const fps = (clip && clip.fps) || st.timeline.fps || 30;
    const padL = 20, padR = 24;
    const spanW = Math.max(40, rect.width - padL - padR);
    const tToX = (t) => padL + (t / dur) * spanW;

    // 1. Ruler header (24px)
    ctx.fillStyle = "#13151b";
    ctx.fillRect(0, 0, rect.width, 24);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath(); ctx.moveTo(0, 24); ctx.lineTo(rect.width, 24); ctx.stroke();

    const totalFrames = Math.round(dur * fps);
    const majorStep = Math.max(10, Math.round(fps)); // every 1 second (e.g. 30f, 60f, 90f, 120f, 150f)
    ctx.font = '10.5px "JetBrains Mono", monospace';
    for (let f = 0; f <= totalFrames; f += Math.max(1, Math.round(majorStep / 3))) {
      const x = tToX(f / fps);
      const isMajor = f % majorStep === 0;
      ctx.strokeStyle = isMajor ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.moveTo(x, isMajor ? 16 : 20);
      ctx.lineTo(x, isMajor ? rect.height : 24);
      ctx.stroke();
      if (isMajor) {
        ctx.fillStyle = "#a7abb4";
        ctx.fillText(`${f}f`, x - 8, 13);
      }
    }

    // 2. Track rows + diamond keyframes
    TRACK_DEFS.forEach((td, rIdx) => {
      const yTop = 24 + rIdx * 22;
      const yMid = yTop + 11;
      if (st.timeline.selectedTrack === td.key) {
        ctx.fillStyle = "rgba(190, 30, 60, 0.14)";
        ctx.fillRect(0, yTop, rect.width, 22);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.beginPath(); ctx.moveTo(0, yTop + 22); ctx.lineTo(rect.width, yTop + 22); ctx.stroke();

      const keys = (clip && clip.tracks && clip.tracks[td.key]) || [];
      keys.forEach((k, kIdx) => {
        const x = tToX(k.t);
        const isSel = st.timeline.selectedTrack === td.key && st.timeline.selectedKeyIdx === kIdx;
        const isCrimson = isSel || Math.abs(k.t - st.timeline.time) < 0.04 || td.key === "face";
        ctx.save();
        ctx.translate(x, yMid);
        ctx.rotate(Math.PI / 4);
        const sz = isSel ? 7.5 : 6;
        ctx.fillStyle = isCrimson ? "#be1e3c" : "#f2f3f5";
        ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
        if (isSel) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.2;
          ctx.strokeRect(-sz / 2, -sz / 2, sz, sz);
        }
        ctx.restore();
      });
    });

    // 3. Crimson Playhead Line + Frame/Time Pill (matching studio_concept_animate.png!)
    const px = tToX(st.timeline.time);
    ctx.strokeStyle = "#be1e3c";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 22); ctx.lineTo(px, rect.height);
    ctx.stroke();

    const curFrame = Math.round(st.timeline.time * fps);
    const pillTxt = `${curFrame}f (${formatTime(st.timeline.time)})`;
    const tw = ctx.measureText(pillTxt).width + 14;
    const bx = Math.max(4, Math.min(rect.width - tw - 4, px - tw / 2));
    ctx.fillStyle = "#be1e3c";
    ctx.beginPath();
    ctx.roundRect(bx, 3, tw, 17, 3);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(pillTxt, bx + 7, 14.5);
  }

  _onPointerDown(e) {
    const st = this.state;
    const clip = st.getActiveClip();
    if (!clip) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const padL = 20, padR = 24;
    const spanW = Math.max(40, rect.width - padL - padR);
    const xToT = (xx) => Math.max(0, Math.min(clip.duration, ((xx - padL) / spanW) * clip.duration));

    // Hit test diamond keyframes first
    if (y > 24) {
      const rIdx = Math.floor((y - 24) / 22);
      const td = TRACK_DEFS[rIdx];
      if (td) {
        st.timeline.selectedTrack = td.key;
        const keys = clip.tracks?.[td.key] || [];
        for (let i = 0; i < keys.length; i++) {
          const kx = padL + (keys[i].t / clip.duration) * spanW;
          if (Math.abs(x - kx) <= 8) {
            st.timeline.selectedKeyIdx = i;
            st.pushUndo("Move Keyframe");
            this.dragKey = { trackKey: td.key, keyObj: keys[i], xToT };
            this.renderTracks();
            this.drawDope();
            return;
          }
        }
      }
    }

    // Otherwise scrub playhead
    this.scrubbing = true;
    st.timeline.playing = false;
    this.syncPlayButtons();
    st.timeline.time = xToT(x);
    st.snapToKeyform = false;
    this.applyAtTime(st.timeline.time);
  }

  _onPointerMove(e) {
    const st = this.state;
    const clip = st.getActiveClip();
    if (!clip) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padL = 20, padR = 24;
    const spanW = Math.max(40, rect.width - padL - padR);
    const t = Math.max(0, Math.min(clip.duration, ((x - padL) / spanW) * clip.duration));

    if (this.dragKey) {
      this.dragKey.keyObj.t = +t.toFixed(3);
      clip.tracks[this.dragKey.trackKey].sort((a, b) => a.t - b.t);
      this.applyAtTime(st.timeline.time);
      return;
    }
    if (this.scrubbing) {
      st.timeline.time = t;
      this.applyAtTime(t);
    }
  }

  /* ---------- Client-Side WebM Video Recording directly from WebGL2 Canvas ---------- */
  async exportVideo() {
    const st = this.state;
    const clip = st.getActiveClip();
    if (!clip || typeof MediaRecorder === "undefined") {
      this.onToast("MediaRecorder is not supported in this browser.");
      return;
    }
    const stream = this.engine.canvas.captureStream(st.timeline.fps || 30);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${clip.id || "layer2d_clip"}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      this.onToast(`Exported ${clip.name} (${(blob.size / 1e6).toFixed(2)} MB WebM)`);
    };

    const prevLoop = st.timeline.loop;
    st.timeline.loop = false;
    st.timeline.time = 0;
    st.timeline.playing = true;
    this.syncPlayButtons();
    rec.start();
    this.onToast(`Recording ${clip.duration.toFixed(1)}s WebM clip…`);

    setTimeout(() => {
      if (rec.state === "recording") rec.stop();
      st.timeline.loop = prevLoop;
      st.timeline.playing = false;
      this.syncPlayButtons();
    }, Math.ceil(clip.duration * 1000) + 120);
  }
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec - Math.floor(sec)) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}
