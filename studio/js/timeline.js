/**
 * Bottom Collapsible Keyframe Animation Timeline (Dope Sheet + Playback + WebM Video Export)
 * Improvements:
 *   - Frame-snapped keyframe timing & strict anti-overlap enforcement (dragged or inserted keys never stack!)
 *   - Full keyframe deletion (Delete/Backspace key, "- Key" toolbar button, right-click diamond)
 *   - Double-click empty lane to insert keyframe; click diamond to select & seek without spurious undo entries
 *   - Selected key index stays synced when dragging past neighbors
 *   - Dynamic tracks for all Blend Shapes in `pack.blendShapes`
 */

const CORE_TRACK_DEFS = [
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
    const inv = 1 - u;
    return 3 * inv * inv * u * bz.p1y + 3 * inv * u * u * bz.p2y + u * u * u;
  }
  return u * u * (3 - 2 * u);
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
    this.delBtn = document.getElementById("tl-del-key");

    this.dragKey = null;
    this.scrubbing = false;
    this._bindUI();
    this._bindState();
  }

  getTrackDefs() {
    const BS = (this.state.pack && this.state.pack.blendShapes) || [];
    if (!BS.length) return CORE_TRACK_DEFS;
    return [
      ...CORE_TRACK_DEFS,
      ...BS.map((bs) => ({
        key: `blend:${bs.id}`,
        blendId: bs.id,
        label: `BS: ${bs.name}`,
        fmt: (v) => Number(v || 0).toFixed(2),
        numeric: true,
      })),
    ];
  }

  _snapFrame(t, dur, fps, free = false) {
    const clamped = Math.max(0, Math.min(dur, t));
    if (free) return +clamped.toFixed(3);
    const frame = Math.round(clamped * fps);
    return +Math.min(dur, frame / fps).toFixed(3);
  }

  /**
   * Ensure a track has zero overlapping keyframes (keeps latest value when duplicates exist).
   */
  _dedupeTrack(arr, fps = 30) {
    if (!Array.isArray(arr) || arr.length <= 1) return;
    arr.sort((a, b) => a.t - b.t);
    const eps = Math.max(0.008, 0.45 / Math.max(1, fps));
    for (let i = arr.length - 1; i > 0; i--) {
      if (Math.abs(arr[i].t - arr[i - 1].t) < eps) {
        arr.splice(i - 1, 1);
      }
    }
  }

  /**
   * Return the nearest unoccupied frame timestamp to `desiredT` so dragged keyframes NEVER overlap another key!
   */
  _findFreeTime(arr, desiredT, ignoreObj, dur, fps, free = false) {
    const minGap = Math.max(0.012, 0.65 / Math.max(1, fps));
    const step = 1 / Math.max(1, fps);
    const baseT = this._snapFrame(desiredT, dur, fps, free);
    const isFree = (cand) => !arr.some((k) => k !== ignoreObj && Math.abs(k.t - cand) < minGap);
    if (isFree(baseT)) return baseT;

    const maxSteps = Math.ceil(dur / step) + 2;
    for (let s = 1; s <= maxSteps; s++) {
      const hi = +(baseT + s * step).toFixed(3);
      if (hi <= dur + 1e-4 && isFree(Math.min(dur, hi))) return Math.min(dur, hi);
      const lo = +(baseT - s * step).toFixed(3);
      if (lo >= -1e-4 && isFree(Math.max(0, lo))) return Math.max(0, lo);
    }
    return ignoreObj.t;
  }

  _getParamVal(td) {
    const st = this.state;
    if (td.blendId) return st.params.blend?.[td.blendId] ?? 0;
    if (td.key === "face") return st.params.face || "Neutral";
    return st.params[td.key] ?? 0;
  }

  _bindUI() {
    const st = this.state;
    const togglePlay = () => {
      st.timeline.playing = !st.timeline.playing;
      if (st.timeline.playing) { st.snapToKeyform = false; st.snapToPitch = false; }
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
      st.timeline.selectedKeyIdx = -1;
      this.renderTracks();
      this.drawDope();
      this._syncDeleteButton();
    });

    document.getElementById("tl-add-key").addEventListener("click", () => this.insertKeyframeAtPlayhead());
    if (this.delBtn) {
      this.delBtn.addEventListener("click", () => this.deleteSelectedKeyframe());
    }
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
      st.timeline.selectedKeyIdx = -1;
      this.syncClips();
      this.renderTracks();
      this.drawDope();
      this._syncDeleteButton();
    });
    document.getElementById("tl-export-video").addEventListener("click", () => this.exportVideo());

    // Dope sheet pointer interaction (scrub playhead, select/drag/right-click-delete/dblclick-add keyframes)
    this.canvas.addEventListener("pointerdown", (e) => this._onPointerDown(e));
    this.canvas.addEventListener("dblclick", (e) => this._onDoubleClick(e));
    this.canvas.addEventListener("contextmenu", (e) => this._onContextMenu(e));
    window.addEventListener("pointermove", (e) => this._onPointerMove(e));
    window.addEventListener("pointerup", () => { this.scrubbing = false; this.dragKey = null; });
  }

  _bindState() {
    const st = this.state;
    st.on("doc:loaded", () => {
      // Sanitize any overlapping keyframes in saved clips
      for (const clip of st.studio?.clips || []) {
        const fps = clip.fps || 30;
        for (const arr of Object.values(clip.tracks || {})) this._dedupeTrack(arr, fps);
      }
      this.syncClips();
      this.setExpanded(st.timeline.expanded);
      this.renderTracks();
      this.drawDope();
      this._syncDeleteButton();
    });
    st.on("mode:changed", () => this.setExpanded(st.timeline.expanded));
    st.on("params:changed", () => this.syncTrackValues());
    st.on("pack:mutated", (d) => {
      if (d?.structural && st.timeline.expanded) {
        this.renderTracks();
        this.drawDope();
        this._syncDeleteButton();
      }
    });
  }

  _syncDeleteButton() {
    if (!this.delBtn) return;
    const clip = this.state.getActiveClip();
    const tr = clip?.tracks?.[this.state.timeline.selectedTrack];
    const hasSel = Boolean(tr && this.state.timeline.selectedKeyIdx >= 0 && this.state.timeline.selectedKeyIdx < tr.length);
    this.delBtn.disabled = !hasSel;
  }

  setExpanded(exp) {
    this.state.timeline.expanded = exp;
    this.dock.classList.toggle("collapsed", !exp);
    this.collapsedBar.hidden = exp;
    this.expandedWrap.hidden = !exp;
    if (exp) {
      this.syncClips();
      this.renderTracks();
      this._syncDeleteButton();
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

  insertKeyframeAtPlayhead(overrideTrack = null, overrideTime = null) {
    const st = this.state;
    const clip = st.getActiveClip();
    if (!clip) return;
    const fps = clip.fps || st.timeline.fps || 30;
    const rawT = overrideTime !== null ? overrideTime : st.timeline.time;
    const t = this._snapFrame(rawT, clip.duration, fps, false);
    const trKey = overrideTrack || st.timeline.selectedTrack || "a";
    const defs = this.getTrackDefs();
    const td = defs.find((d) => d.key === trKey) || defs[0];

    st.pushUndo("Insert Keyframe");
    clip.tracks = clip.tracks || {};
    clip.tracks[trKey] = clip.tracks[trKey] || [];
    const val = this._getParamVal(td);
    const ease = st.studio?.bezier?.preset || (!td.numeric ? "step" : "easeInOut");
    const arr = clip.tracks[trKey];
    const minGap = Math.max(0.012, 0.55 / fps);
    const exIdx = arr.findIndex((k) => Math.abs(k.t - t) < minGap);
    if (exIdx >= 0) {
      arr[exIdx].v = val;
      arr[exIdx].ease = ease;
      st.timeline.selectedTrack = trKey;
      st.timeline.selectedKeyIdx = exIdx;
      this.onToast(`Updated keyframe on ${td.label} at ${arr[exIdx].t.toFixed(2)}s`);
    } else {
      const obj = { t, v: val, ease };
      arr.push(obj);
      arr.sort((a, b) => a.t - b.t);
      st.timeline.selectedTrack = trKey;
      st.timeline.selectedKeyIdx = arr.indexOf(obj);
      this.onToast(`Inserted keyframe on ${td.label} at ${t.toFixed(2)}s`);
    }
    this.renderTracks();
    this.drawDope();
    this._syncDeleteButton();
  }

  deleteSelectedKeyframe(trackKey = null, keyIdx = null) {
    const st = this.state;
    const clip = st.getActiveClip();
    if (!clip) return false;
    const trKey = trackKey || st.timeline.selectedTrack;
    const idx = keyIdx !== null ? keyIdx : st.timeline.selectedKeyIdx;
    const arr = clip.tracks?.[trKey];
    if (!arr || idx < 0 || idx >= arr.length) return false;

    const removed = arr[idx];
    st.pushUndo("Delete Keyframe");
    arr.splice(idx, 1);
    st.timeline.selectedTrack = trKey;
    st.timeline.selectedKeyIdx = arr.length ? Math.min(idx, arr.length - 1) : -1;
    this.applyAtTime(st.timeline.time);
    this.renderTracks();
    this.drawDope();
    this._syncDeleteButton();
    const td = this.getTrackDefs().find((d) => d.key === trKey);
    this.onToast(`Deleted keyframe on ${td ? td.label : trKey} at ${removed.t.toFixed(2)}s`);
    return true;
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

    for (const td of this.getTrackDefs()) {
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
              const span = b.t - a.t;
              const u = span > 1e-5 ? (t - a.t) / span : 1;
              const e = easeVal(u, a.ease || "easeInOut", bz);
              val = a.v + (b.v - a.v) * e;
            }
            break;
          }
        }
      }
      if (td.blendId) st.setBlendWeight(td.blendId, val);
      else if (td.key === "a") st.setAngle(val, false);
      else if (td.key === "pitch") st.setPitch(val, false);
      else if (td.key === "face") st.params.face = val === "Neutral" ? null : val;
      else if (td.key === "vowel") st.params.vowel = val || null;
      else st.params[td.key] = val;
    }

    this.timeMini.textContent = formatTime(t);
    this.syncTrackValues();
    if (st.timeline.expanded) this.drawDope();
  }

  renderTracks() {
    const st = this.state;
    const el = this.tracksCol;
    const defs = this.getTrackDefs();
    el.innerHTML = `<div class="tl-track-head-spacer"><span>Track</span><span style="text-align:right">Value</span></div>`;
    this._trackValEls = Object.create(null);
    for (const td of defs) {
      const row = document.createElement("div");
      row.className = "tl-track-row" + (st.timeline.selectedTrack === td.key ? " selected" : "");
      const v = this._getParamVal(td);
      const lbl = document.createElement("span");
      lbl.textContent = `▸ ${td.label}`;
      const valSpan = document.createElement("span");
      valSpan.className = "tl-track-val";
      valSpan.textContent = td.fmt(v);
      row.append(lbl, valSpan);
      row.addEventListener("click", () => {
        st.timeline.selectedTrack = td.key;
        st.timeline.selectedKeyIdx = -1;
        this.renderTracks();
        this.drawDope();
        this._syncDeleteButton();
      });
      el.appendChild(row);
      this._trackValEls[td.key] = valSpan;
    }
  }

  syncTrackValues() {
    const defs = this.getTrackDefs();
    if (!this._trackValEls || Object.keys(this._trackValEls).length !== defs.length) {
      this.renderTracks();
      return;
    }
    for (const td of defs) {
      const sp = this._trackValEls[td.key];
      if (!sp) continue;
      sp.textContent = td.fmt(this._getParamVal(td));
    }
  }

  drawDope() {
    const st = this.state;
    const clip = st.getActiveClip();
    const defs = this.getTrackDefs();
    const cv = this.canvas;
    const rect = this.dopeWrap.getBoundingClientRect();
    const minH = 24 + defs.length * 22 + 8;
    const drawH = Math.max(rect.height, minH);
    if (rect.width < 10 || drawH < 10) return;
    cv.style.height = `${drawH}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(rect.width * dpr), ph = Math.round(drawH * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, drawH);

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
    const majorStep = Math.max(10, Math.round(fps));
    ctx.font = '10.5px "JetBrains Mono", monospace';
    for (let f = 0; f <= totalFrames; f += Math.max(1, Math.round(majorStep / 3))) {
      const x = tToX(f / fps);
      const isMajor = f % majorStep === 0;
      ctx.strokeStyle = isMajor ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.moveTo(x, isMajor ? 16 : 20);
      ctx.lineTo(x, isMajor ? drawH : 24);
      ctx.stroke();
      if (isMajor) {
        ctx.fillStyle = "#a7abb4";
        ctx.fillText(`${f}f`, x - 8, 13);
      }
    }

    // 2. Track rows + diamond keyframes
    defs.forEach((td, rIdx) => {
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
        const isCrimson = isSel || Math.abs(k.t - st.timeline.time) < 0.025 || td.key === "face";
        ctx.save();
        ctx.translate(x, yMid);
        ctx.rotate(Math.PI / 4);
        const sz = isSel ? 8 : 6;
        ctx.fillStyle = isSel ? "#ff3b5c" : (isCrimson ? "#be1e3c" : "#f2f3f5");
        ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
        if (isSel) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.4;
          ctx.strokeRect(-sz / 2, -sz / 2, sz, sz);
        }
        ctx.restore();
      });
    });

    // 3. Crimson Playhead Line + Frame/Time Pill
    const px = tToX(st.timeline.time);
    ctx.strokeStyle = "#be1e3c";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 22); ctx.lineTo(px, drawH);
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

  _hitTestKey(e) {
    const clip = this.state.getActiveClip();
    if (!clip) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const padL = 20, padR = 24;
    const spanW = Math.max(40, rect.width - padL - padR);
    const defs = this.getTrackDefs();
    if (y <= 24) return { x, y, rIdx: -1, td: null, keyIdx: -1, xToT: (xx) => Math.max(0, Math.min(clip.duration, ((xx - padL) / spanW) * clip.duration)) };
    const rIdx = Math.floor((y - 24) / 22);
    const td = defs[rIdx] || null;
    let keyIdx = -1;
    if (td) {
      const keys = clip.tracks?.[td.key] || [];
      let bestDist = 9;
      for (let i = 0; i < keys.length; i++) {
        const kx = padL + (keys[i].t / clip.duration) * spanW;
        const d = Math.abs(x - kx);
        if (d < bestDist) { bestDist = d; keyIdx = i; }
      }
    }
    return {
      x, y, rIdx, td, keyIdx,
      xToT: (xx) => Math.max(0, Math.min(clip.duration, ((xx - padL) / spanW) * clip.duration)),
    };
  }

  _onPointerDown(e) {
    if (e.button !== 0) return;
    const st = this.state;
    const clip = st.getActiveClip();
    if (!clip) return;
    const hit = this._hitTestKey(e);
    if (!hit) return;

    if (hit.td && hit.keyIdx >= 0) {
      const keys = clip.tracks[hit.td.key];
      st.timeline.selectedTrack = hit.td.key;
      st.timeline.selectedKeyIdx = hit.keyIdx;
      this.dragKey = {
        trackKey: hit.td.key,
        keyObj: keys[hit.keyIdx],
        origT: keys[hit.keyIdx].t,
        undoPushed: false,
      };
      // Jump playhead to the selected keyframe for instant preview!
      st.timeline.playing = false;
      this.syncPlayButtons();
      st.timeline.time = keys[hit.keyIdx].t;
      this.applyAtTime(st.timeline.time);
      this.renderTracks();
      this._syncDeleteButton();
      return;
    }

    // Clicked empty track lane: select track, clear key selection, scrub playhead
    if (hit.td) {
      st.timeline.selectedTrack = hit.td.key;
      st.timeline.selectedKeyIdx = -1;
      this.renderTracks();
      this._syncDeleteButton();
    }
    this.scrubbing = true;
    st.timeline.playing = false;
    this.syncPlayButtons();
    const fps = clip.fps || st.timeline.fps || 30;
    st.timeline.time = this._snapFrame(hit.xToT(hit.x), clip.duration, fps, e.altKey);
    st.snapToKeyform = false;
    st.snapToPitch = false;
    this.applyAtTime(st.timeline.time);
  }

  _onDoubleClick(e) {
    const hit = this._hitTestKey(e);
    if (!hit || !hit.td) return;
    if (hit.keyIdx >= 0) return; // already a keyframe there
    const t = hit.xToT(hit.x);
    this.state.timeline.time = t;
    this.insertKeyframeAtPlayhead(hit.td.key, t);
  }

  _onContextMenu(e) {
    e.preventDefault();
    const hit = this._hitTestKey(e);
    if (hit && hit.td && hit.keyIdx >= 0) {
      this.deleteSelectedKeyframe(hit.td.key, hit.keyIdx);
    }
  }

  _onPointerMove(e) {
    const st = this.state;
    const clip = st.getActiveClip();
    if (!clip) return;
    if (!this.dragKey && !this.scrubbing) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padL = 20, padR = 24;
    const spanW = Math.max(40, rect.width - padL - padR);
    const rawT = Math.max(0, Math.min(clip.duration, ((x - padL) / spanW) * clip.duration));
    const fps = clip.fps || st.timeline.fps || 30;

    if (this.dragKey) {
      const arr = clip.tracks[this.dragKey.trackKey];
      const nextT = this._findFreeTime(arr, rawT, this.dragKey.keyObj, clip.duration, fps, e.altKey);
      if (Math.abs(nextT - this.dragKey.keyObj.t) > 1e-4) {
        if (!this.dragKey.undoPushed) {
          st.pushUndo("Move Keyframe");
          this.dragKey.undoPushed = true;
        }
        this.dragKey.keyObj.t = nextT;
        arr.sort((a, b) => a.t - b.t);
        st.timeline.selectedKeyIdx = arr.indexOf(this.dragKey.keyObj);
        st.timeline.time = nextT;
        this.applyAtTime(nextT);
      }
      return;
    }
    if (this.scrubbing) {
      st.timeline.time = this._snapFrame(rawT, clip.duration, fps, e.altKey);
      this.applyAtTime(st.timeline.time);
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
