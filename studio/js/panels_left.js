/**
 * Left Dock Panels:
 *   1. Rig/Model/Mesh/Physics mode:
 *      - PARTS & LAYERS hierarchical outliner (folders, search, eye toggle, draw-order z, drag-to-reorder)
 *      - PARAMETERS Cubism-style sliders with clickable diamond keyforms, inline + / - keyform CRUD
 *        for BOTH Angle X AND Angle Y, Mouth Vowels, and additive BLEND SHAPES!
 *   2. Expressions/Animate mode:
 *      - EXPRESSIONS visual 2-column thumbnail card grid (rendered live from WebGL2 engine!)
 *      - TOGGLES & HOLDS clean flat switch list
 */

export class LeftPanels {
  constructor(state, engine, onAction) {
    this.state = state;
    this.engine = engine;
    this.onAction = onAction;
    this.thumbCache = Object.create(null);
    this._paramCtrls = null;
    this._vowelChips = [];
    this._blendCtrls = [];

    this.rigView = document.getElementById("left-rig-view");
    this.exprView = document.getElementById("left-expr-view");
    this.treeEl = document.getElementById("layer-tree");
    this.paramEl = document.getElementById("param-list");
    this.exprGridEl = document.getElementById("expr-card-grid");
    this.toggleListEl = document.getElementById("toggle-list");
    this.searchInput = document.getElementById("layer-search");

    this._bindStatic();
    this._bindState();
  }

  _bindStatic() {
    this.searchInput.addEventListener("input", () => {
      this.state.layerSearch = this.searchInput.value.trim().toLowerCase();
      this.renderLayerTree();
    });
    document.getElementById("btn-add-layer").addEventListener("click", () => this.onAction("import-layer"));
    document.getElementById("btn-dup-layer").addEventListener("click", () => this.onAction("dup-layer"));
    document.getElementById("btn-del-layer").addEventListener("click", () => this.onAction("del-layer"));
    document.getElementById("btn-param-mirror").addEventListener("click", () => this.onAction("mirror-lr"));
    document.getElementById("btn-param-reset").addEventListener("click", () => {
      const p = this.state.params;
      p.a = 0; p.pitch = 0; p.roll = 0; p.eyes = 1; p.vowel = null; p.tailSway = 0; p.bodySway = 0;
      for (const bs of this.state.pack?.blendShapes || []) p.blend[bs.id] = bs.default ?? 0;
      const nS = (this.state.pack?.samples || []).length;
      if (nS) this.state.snapToSample(Math.floor(nS / 2));
      else this.state.emit("params:changed");
    });
    document.getElementById("btn-new-expr-quick").addEventListener("click", () => this.onAction("new-expr"));
  }

  _bindState() {
    const st = this.state;
    st.on("doc:loaded", () => {
      this._thumbJobId = (this._thumbJobId || 0) + 1;
      this.thumbCache = Object.create(null);
      this._paramCtrls = null;
      this._vowelChips = [];
      this._blendCtrls = [];
      this.syncModeView();
      this.renderLayerTree();
      this.renderParams();
      if (st.mode === "expressions" || st.mode === "animate") this.renderExprCards();
    });
    st.on("mode:changed", () => {
      this.syncModeView();
      if (st.mode === "expressions" || st.mode === "animate") this.renderExprCards();
    });
    st.on("selection:changed", () => this.renderLayerTree());
    st.on("rigTarget:changed", () => this.syncParams());
    st.on("pack:mutated", (d) => {
      if (d?.structural) {
        this.renderLayerTree();
        this.renderParams();
        if (st.mode === "expressions" || st.mode === "animate") this.renderExprCards();
      }
    });
    st.on("params:changed", () => {
      this.syncParams();
      if (st.mode === "expressions" || st.mode === "animate") this.syncExprActive();
    });
  }

  syncModeView() {
    const isExprSide = this.state.mode === "expressions" || this.state.mode === "animate";
    this.rigView.hidden = isExprSide;
    this.exprView.hidden = !isExprSide;
  }

  /* ---------- PARTS & LAYERS Outliner ---------- */
  renderLayerTree() {
    const P = this.state.pack;
    const el = this.treeEl;
    const prevScroll = el.scrollTop;
    el.innerHTML = "";
    if (!P) return;

    const q = this.state.layerSearch;
    const metaLayers = (this.state.studio && this.state.studio.layers) || {};

    const groups = new Map();
    for (let i = P.layers.length - 1; i >= 0; i--) {
      const L = P.layers[i];
      const m = metaLayers[L.id] || { label: L.id, folder: L.head ? "Head" : "Body" };
      const label = m.label && m.label !== L.id ? `${m.label} (${L.id})` : L.id;
      if (q && !label.toLowerCase().includes(q) && !(m.folder || "").toLowerCase().includes(q)) continue;
      const folder = m.folder || "Layers";
      if (!groups.has(folder)) groups.set(folder, []);
      groups.get(folder).push({ idx: i, L, label });
    }

    const eyeSvgOn = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4-6.5-4-6.5-4z"/><circle cx="8" cy="8" r="1.8"/></svg>`;
    const eyeSvgOff = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 2l12 12M5 5.3A6.8 6.8 0 0 1 8 4.5c4 0 6.5 3.5 6.5 3.5a11 11 0 0 1-2.2 2.4M10.8 10.8A6.5 6.5 0 0 1 8 11.5c-4 0-6.5-3.5-6.5-3.5a12 12 0 0 1 1.9-2.2"/></svg>`;

    for (const [folder, items] of groups.entries()) {
      const collapsed = this.state.selectedFolderCollapsed.has(folder) && !q;
      const fRow = document.createElement("div");
      fRow.className = "folder-row" + (collapsed ? " collapsed" : "");
      fRow.innerHTML = `
        <svg class="tree-chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4.5l3 3 3-3"/></svg>
        <svg class="tree-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 4.5h4.5l1.5 1.5H14v7H2V4.5z"/></svg>
        <span class="layer-name">${folder}</span>
        <span class="layer-z">${items.length}</span>
      `;
      fRow.addEventListener("click", () => {
        if (this.state.selectedFolderCollapsed.has(folder)) this.state.selectedFolderCollapsed.delete(folder);
        else this.state.selectedFolderCollapsed.add(folder);
        this.renderLayerTree();
      });
      el.appendChild(fRow);

      if (collapsed) continue;
      for (const { idx, L, label } of items) {
        const isSel = idx === this.state.selectedLayerIdx;
        const isHid = this.state.hiddenIds.has(L.id);
        const row = document.createElement("div");
        row.className = "layer-row" + (isSel ? " selected" : "") + (isHid ? " is-hidden" : "");
        row.draggable = true;
        row.dataset.idx = String(idx);
        const badge = L.clip ? `<span class="layer-tag" title="Clipped to ${L.clip}">C</span>`
          : L.behind ? `<span class="layer-tag" title="Behind occlusion mask">B</span>` : "";
        row.innerHTML = `
          <svg class="tree-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="2.5" width="10" height="11" rx="1"/></svg>
          <span class="layer-name" title="${label}">${label}</span>
          ${badge}
          <button class="eye-btn" type="button" title="Toggle Visibility">${isHid ? eyeSvgOff : eyeSvgOn}</button>
          <span class="layer-z">${idx}</span>
        `;
        row.addEventListener("click", (e) => {
          if (e.target.closest(".eye-btn")) return;
          this.state.selectLayer(idx);
        });
        row.querySelector(".eye-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.state.hiddenIds.has(L.id)) this.state.hiddenIds.delete(L.id);
          else this.state.hiddenIds.add(L.id);
          this.renderLayerTree();
          this.state.emit("view:changed");
        });

        row.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/plain", String(idx));
          e.dataTransfer.effectAllowed = "move";
        });
        row.addEventListener("dragover", (e) => {
          e.preventDefault();
          row.classList.add("drag-over");
        });
        row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          row.classList.remove("drag-over");
          const from = Number(e.dataTransfer.getData("text/plain"));
          if (!Number.isNaN(from) && from !== idx) this.state.reorderLayer(from, idx);
        });

        el.appendChild(row);
      }
    }
    el.scrollTop = prevScroll;
  }

  /* ---------- PARAMETERS (Angle X & Angle Y Keyforms + Blend Shapes) ---------- */
  _paramDefs() {
    const st = this.state;
    const P = st.pack;
    const samples = (P && P.samples) || [];
    const turnR = P?.head?.turn?.R || -0.22;
    const turnL = P?.head?.turn?.L || 0.22;
    const yawKeys = samples.map((s, idx) => {
      const normA = s.angle < 0 ? -s.angle / turnR : s.angle / turnL;
      return {
        u: clamp01((normA + 1) * 0.5),
        idx,
        label: `Angle X ${(normA * 32.5).toFixed(1)}°`,
      };
    });

    const pitchSamples = st.getPitchSamplesView();
    const pitchKeys = pitchSamples.map((s, idx) => ({
      u: clamp01((s.pitch + 1) * 0.5),
      idx,
      label: `Angle Y ${(s.pitch * 30).toFixed(1)}°`,
      hasEdits: Boolean(s.layers && Object.keys(s.layers).length),
    }));

    return [
      {
        id: "a", name: "Angle X", min: -32.5, max: 32.5, defaultVal: 0,
        getVal: () => st.params.a * 32.5,
        fmt: (v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1)),
        keys: yawKeys,
        isYaw: true,
        canEditKeys: true,
        onAddKey: () => this.onAction("add-yaw-key"),
        onDelKey: () => this.onAction("del-yaw-key"),
        onKeyClick: (k) => st.snapToSample(k.idx),
        onDrag: (u) => { st.snapToKeyform = false; st.setAngle(u * 2 - 1, false); },
        onInput: (v) => { st.snapToKeyform = false; st.setAngle(clamp(v / 32.5, -1, 1), false); },
        onReset: () => {
          const mid = Math.floor(samples.length / 2);
          if (samples.length) st.snapToSample(mid);
          else { st.snapToKeyform = false; st.setAngle(0, false); }
        },
      },
      {
        id: "pitch", name: "Angle Y", min: -30, max: 30, defaultVal: 0,
        getVal: () => st.params.pitch * 30,
        fmt: (v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1)),
        keys: pitchKeys,
        isPitch: true,
        canEditKeys: true,
        onAddKey: () => this.onAction("add-pitch-key"),
        onDelKey: () => this.onAction("del-pitch-key"),
        onKeyClick: (k) => st.snapToPitchSample(k.idx),
        onDrag: (u) => { st.snapToPitch = false; st.setPitch(u * 2 - 1, false); },
        onInput: (v) => { st.snapToPitch = false; st.setPitch(clamp(v / 30, -1, 1), false); },
        onReset: () => {
          const ps = st.getPitchSamplesView();
          const mid = ps.findIndex((s) => Math.abs(s.pitch) < 1e-4);
          if (mid >= 0) st.snapToPitchSample(mid);
          else { st.snapToPitch = false; st.setPitch(0, false); }
        },
      },
      {
        id: "roll", name: "Angle Z", min: -20, max: 20, defaultVal: 0,
        getVal: () => (st.params.roll * 180) / Math.PI,
        fmt: (v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1)),
        keys: [{ u: 0 }, { u: 0.5 }, { u: 1 }],
        onKeyClick: (k) => { st.params.roll = ((k.u * 2 - 1) * 20 * Math.PI) / 180; st.emit("params:changed"); },
        onDrag: (u) => { st.params.roll = ((u * 2 - 1) * 20 * Math.PI) / 180; st.emit("params:changed"); },
        onInput: (v) => { st.params.roll = (clamp(v, -20, 20) * Math.PI) / 180; st.emit("params:changed"); },
        onReset: () => { st.params.roll = 0; st.emit("params:changed"); },
      },
      {
        id: "eyes", name: "Eye Open", min: 0, max: 1.25, defaultVal: 1.0,
        getVal: () => st.params.eyes,
        fmt: (v) => v.toFixed(2),
        keys: [{ u: 0 }, { u: 0.8 }, { u: 1 }],
        onKeyClick: (k) => { st.params.eyes = k.u * 1.25; st.emit("params:changed"); },
        onDrag: (u) => { st.params.eyes = u * 1.25; st.emit("params:changed"); },
        onInput: (v) => { st.params.eyes = clamp(v, 0, 1.25); st.emit("params:changed"); },
        onReset: () => { st.params.eyes = 1.0; st.emit("params:changed"); },
      },
      {
        id: "tailSway", name: "Tail Sway", min: -1, max: 1, defaultVal: 0,
        getVal: () => st.params.tailSway,
        fmt: (v) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
        keys: [{ u: 0 }, { u: 0.5 }, { u: 1 }],
        onKeyClick: (k) => { st.params.tailSway = k.u * 2 - 1; st.emit("params:changed"); },
        onDrag: (u) => { st.params.tailSway = u * 2 - 1; st.emit("params:changed"); },
        onInput: (v) => { st.params.tailSway = clamp(v, -1, 1); st.emit("params:changed"); },
        onReset: () => { st.params.tailSway = 0; st.emit("params:changed"); },
      },
    ];
  }

  _buildSliderRow(d) {
    const row = document.createElement("div");
    row.className = "param-row" + (d.canEditKeys ? " has-kf-btns" : "");

    const nameCell = document.createElement("div");
    nameCell.className = "param-name-cell";
    const lbl = document.createElement("span");
    lbl.className = "param-name";
    lbl.textContent = d.name;
    lbl.title = `Double-click to reset ${d.name}`;
    lbl.addEventListener("dblclick", () => d.onReset());
    nameCell.appendChild(lbl);

    if (d.canEditKeys) {
      const kfBtns = document.createElement("span");
      kfBtns.className = "kf-mini-btns";
      const addB = document.createElement("button");
      addB.type = "button";
      addB.className = "kf-mini-btn";
      addB.textContent = "+";
      addB.title = `Add ${d.name} Keyform at current slider value`;
      addB.addEventListener("click", (e) => { e.stopPropagation(); d.onAddKey(); });
      const delB = document.createElement("button");
      delB.type = "button";
      delB.className = "kf-mini-btn";
      delB.textContent = "−";
      delB.title = `Delete active ${d.name} Keyform`;
      delB.addEventListener("click", (e) => { e.stopPropagation(); d.onDelKey(); });
      kfBtns.append(addB, delB);
      nameCell.appendChild(kfBtns);
    }

    const wrap = document.createElement("div");
    wrap.className = "param-track-wrap";
    const track = document.createElement("div");
    track.className = "param-track";

    const fill = document.createElement("div");
    fill.className = "param-fill";
    track.appendChild(fill);

    const diamonds = [];
    for (const k of d.keys || []) {
      const dm = document.createElement("span");
      dm.className = "param-diamond" + (k.hasEdits ? " has-edits" : "");
      dm.style.left = `${k.u * 100}%`;
      if (k.label) dm.title = `Click to edit ${k.label} (drag track to scrub)`;
      track.appendChild(dm);
      diamonds.push({ el: dm, key: k });
    }

    const thumb = document.createElement("span");
    thumb.className = "param-thumb";
    track.appendChild(thumb);

    const limits = document.createElement("div");
    limits.className = "param-limits";
    limits.innerHTML = `<span>${d.min}</span><span>${d.max > 0 && d.min < 0 ? "+" + d.max : d.max}</span>`;

    const scrub = (clientX, shiftSnap = false) => {
      const r = track.getBoundingClientRect();
      if (r.width <= 0) return;
      const u = clamp01((clientX - r.left) / r.width);
      if (shiftSnap && d.keys && d.keys.length && d.onKeyClick) {
        let best = d.keys[0], bestD = Infinity;
        for (const k of d.keys) {
          const dist = Math.abs(k.u - u);
          if (dist < bestD) { bestD = dist; best = k; }
        }
        d.onKeyClick(best);
      } else {
        d.onDrag(u);
      }
    };

    wrap.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      wrap.classList.add("dragging");
      wrap.setPointerCapture(e.pointerId);

      const hitDiamond = diamonds.find((item) => item.el === e.target);
      const startX = e.clientX;
      let dragged = false;

      if (!hitDiamond) {
        dragged = true;
        scrub(e.clientX, e.shiftKey);
      }

      const onM = (ev) => {
        if (!dragged && Math.abs(ev.clientX - startX) >= 3) dragged = true;
        if (dragged) scrub(ev.clientX, ev.shiftKey);
      };
      const onU = () => {
        wrap.classList.remove("dragging");
        if (wrap.hasPointerCapture(e.pointerId)) wrap.releasePointerCapture(e.pointerId);
        window.removeEventListener("pointermove", onM);
        window.removeEventListener("pointerup", onU);
        window.removeEventListener("pointercancel", onU);
        if (!dragged && hitDiamond && d.onKeyClick) {
          d.onKeyClick(hitDiamond.key);
        }
      };
      window.addEventListener("pointermove", onM);
      window.addEventListener("pointerup", onU);
      window.addEventListener("pointercancel", onU);
    });

    wrap.addEventListener("dblclick", (e) => {
      e.preventDefault();
      d.onReset();
    });

    wrap.append(track, limits);

    const inp = document.createElement("input");
    inp.className = "param-val";
    inp.type = "text";
    inp.addEventListener("change", () => {
      const n = parseFloat(inp.value);
      if (!Number.isNaN(n)) d.onInput(n);
      else this.syncParams();
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") inp.blur();
    });

    row.append(nameCell, wrap, inp);
    return { row, def: d, fill, thumb, diamonds, inp };
  }

  renderParams() {
    const st = this.state;
    const P = st.pack;
    const el = this.paramEl;
    const prevScroll = el.scrollTop;
    el.innerHTML = "";
    this._paramCtrls = null;
    this._vowelChips = [];
    this._blendCtrls = [];
    if (!P) return;

    const defs = this._paramDefs();
    const ctrls = [];
    for (const d of defs) {
      const ctrl = this._buildSliderRow(d);
      el.appendChild(ctrl.row);
      ctrls.push(ctrl);
    }

    // Mouth Vowel row
    const vRow = document.createElement("div");
    vRow.className = "param-row";
    vRow.innerHTML = `<span class="param-name">Mouth Vowel</span>`;
    const vBar = document.createElement("div");
    vBar.className = "vowel-bar";
    vBar.style.gridColumn = "span 2";
    for (const v of ["A", "E", "I", "O", "U"]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "vowel-chip";
      b.dataset.vowel = v;
      b.textContent = v;
      b.addEventListener("click", () => {
        st.params.vowel = st.params.vowel === v ? null : v;
        st.emit("params:changed");
      });
      vBar.appendChild(b);
      this._vowelChips.push(b);
    }
    vRow.appendChild(vBar);
    el.appendChild(vRow);

    // BLEND SHAPES Section
    const bsHead = document.createElement("div");
    bsHead.className = "param-section-head";
    const bsTitle = document.createElement("span");
    bsTitle.textContent = "BLEND SHAPES";
    const bsAdd = document.createElement("button");
    bsAdd.type = "button";
    bsAdd.className = "btn-xs";
    bsAdd.textContent = "+ New";
    bsAdd.title = "Create a new additive Blend Shape parameter";
    bsAdd.addEventListener("click", () => this.onAction("new-blend-shape"));
    bsHead.append(bsTitle, bsAdd);
    el.appendChild(bsHead);

    const shapes = P.blendShapes || [];
    if (!shapes.length) {
      const empty = document.createElement("div");
      empty.className = "param-empty-note";
      empty.textContent = "Additive deformers that layer cleanly over Angle X & Y. Click + New to sculpt one.";
      el.appendChild(empty);
    } else {
      for (const bs of shapes) {
        const min = bs.min ?? 0, max = bs.max ?? 1;
        const bRow = document.createElement("div");
        bRow.className = "blend-row";
        bRow.dataset.bsId = bs.id;

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "blend-edit-btn";
        editBtn.title = `Sculpt Blend Shape "${bs.name}" (activates target & sets weight to 1)`;
        editBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M11.5 2.5l2 2-7.5 7.5-3 .8.8-3 7.7-7.3z"/></svg>`;
        editBtn.addEventListener("click", () => {
          if (st.rigTarget.type === "blend" && st.rigTarget.id === bs.id) {
            st.snapToSample(st.activeSampleIdx);
          } else {
            st.setRigTarget({ type: "blend", id: bs.id });
          }
        });

        const nameEl = document.createElement("span");
        nameEl.className = "param-name blend-name";
        nameEl.textContent = bs.name;
        nameEl.title = `${bs.name} — click to sculpt, double-click to reset`;
        nameEl.addEventListener("click", () => st.setRigTarget({ type: "blend", id: bs.id }));
        nameEl.addEventListener("dblclick", () => st.setBlendWeight(bs.id, bs.default ?? 0));

        const rng = document.createElement("input");
        rng.type = "range";
        rng.className = "prop-range blend-range";
        rng.min = String(min);
        rng.max = String(max);
        rng.step = "0.01";
        rng.value = String(st.params.blend?.[bs.id] ?? bs.default ?? 0);
        rng.addEventListener("input", () => st.setBlendWeight(bs.id, parseFloat(rng.value)));

        const valOut = document.createElement("span");
        valOut.className = "mono blend-val";
        valOut.textContent = Number(rng.value).toFixed(2);

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "kf-mini-btn blend-del-btn";
        delBtn.textContent = "×";
        delBtn.title = `Delete Blend Shape "${bs.name}"`;
        delBtn.addEventListener("click", () => st.deleteBlendShape(bs.id));

        bRow.append(editBtn, nameEl, rng, valOut, delBtn);
        el.appendChild(bRow);
        this._blendCtrls.push({ bs, row: bRow, editBtn, rng, valOut });
      }
    }

    this._paramCtrls = ctrls;
    this.syncParams();
    el.scrollTop = prevScroll;
  }

  /** Fast in-place DOM sync during continuous slider scrubbing / timeline playback (zero DOM churn!). */
  syncParams() {
    if (!this._paramCtrls || !this.state.pack) {
      this.renderParams();
      return;
    }
    const st = this.state;
    for (const c of this._paramCtrls) {
      const d = c.def;
      const val = d.getVal();
      const uVal = clamp01((val - d.min) / (d.max - d.min));
      const originU = d.min < 0 ? 0.5 : 0;
      c.fill.style.left = `${Math.min(originU, uVal) * 100}%`;
      c.fill.style.width = `${Math.abs(uVal - originU) * 100}%`;
      c.thumb.style.left = `${uVal * 100}%`;

      const isTargetRow = (d.isYaw && st.rigTarget.type === "yaw") || (d.isPitch && st.rigTarget.type === "pitch");
      c.row.classList.toggle("is-rig-target", isTargetRow);

      for (const item of c.diamonds) {
        if (d.isYaw) {
          const onKey = st.snapToKeyform
            ? item.key.idx === st.activeSampleIdx
            : Math.abs(item.key.u - uVal) < 0.008;
          item.el.classList.toggle("active", onKey);
        } else if (d.isPitch) {
          const onKey = st.snapToPitch
            ? item.key.idx === st.activePitchIdx
            : Math.abs(item.key.u - uVal) < 0.012;
          item.el.classList.toggle("active", onKey);
        } else {
          item.el.classList.toggle("active", Math.abs(item.key.u - uVal) < 0.008);
        }
      }

      if (document.activeElement !== c.inp) {
        c.inp.value = d.fmt(val);
      }
    }
    for (const b of this._vowelChips) {
      b.classList.toggle("active", st.params.vowel === b.dataset.vowel);
    }
    for (const bc of this._blendCtrls) {
      const w = st.params.blend?.[bc.bs.id] ?? bc.bs.default ?? 0;
      const isEditing = st.rigTarget.type === "blend" && st.rigTarget.id === bc.bs.id;
      bc.row.classList.toggle("is-rig-target", isEditing);
      bc.editBtn.classList.toggle("active", isEditing);
      if (document.activeElement !== bc.rng) bc.rng.value = String(w);
      bc.valOut.textContent = Number(w).toFixed(2);
    }
  }

  /* ---------- EXPRESSIONS & TOGGLES Left View ---------- */
  renderExprCards() {
    const st = this.state;
    const P = st.pack;
    const prevGridScroll = this.exprGridEl.scrollTop;
    const prevToggleScroll = this.toggleListEl.scrollTop;
    this.exprGridEl.innerHTML = "";
    this.toggleListEl.innerHTML = "";
    this._thumbJobId = (this._thumbJobId || 0) + 1;
    const jobId = this._thumbJobId;
    if (!P) return;

    const faces = Object.keys((P.expr && P.expr.faces) || {});
    const pending = [];
    for (const name of faces) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "expr-card" + ((st.params.face === name || (!st.params.face && name === "Neutral")) ? " active" : "");
      card.dataset.face = name;
      const img = document.createElement("img");
      img.className = "expr-thumb";
      img.alt = "";
      if (this.thumbCache[name]) {
        img.src = this.thumbCache[name];
      } else {
        pending.push({ name, img });
      }
      const lbl = document.createElement("span");
      lbl.className = "expr-label";
      lbl.title = name;
      lbl.textContent = name;
      card.append(img, lbl);
      card.addEventListener("click", () => {
        st.params.face = name === "Neutral" ? null : (st.params.face === name ? null : name);
        st.selectedExprName = name;
        st.emit("params:changed");
        st.emit("selection:changed");
      });
      this.exprGridEl.appendChild(card);
    }

    if (pending.length) {
      let idx = 0;
      const step = () => {
        if (this._thumbJobId !== jobId || !this.engine.ready) return;
        const batch = pending.slice(idx, idx + 8);
        idx += batch.length;
        const urls = this.engine.renderExpressionThumbBatch(batch.map((b) => b.name), 128, 92);
        for (let i = 0; i < batch.length; i++) {
          this.thumbCache[batch[i].name] = urls[i] || "";
          if (urls[i]) batch[i].img.src = urls[i];
        }
        if (idx < pending.length) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    for (const [key, cfg] of Object.entries(P.outfits || {})) {
      const on = (key in st.params.wear ? st.params.wear[key] : (cfg.default !== false ? 1 : 0)) > 0.5;
      const row = document.createElement("div");
      row.className = "toggle-row";
      row.innerHTML = `
        <span class="toggle-name">${cfg.label || key}</span>
        <button class="switch" type="button" aria-pressed="${on ? "true" : "false"}"></button>
      `;
      row.querySelector(".switch").addEventListener("click", (e) => {
        const next = e.currentTarget.getAttribute("aria-pressed") !== "true";
        st.params.wear[key] = next ? 1 : 0;
        e.currentTarget.setAttribute("aria-pressed", next ? "true" : "false");
        st.emit("params:changed");
      });
      this.toggleListEl.appendChild(row);
    }

    for (const hName of Object.keys((P.expr && P.expr.holds) || {})) {
      const on = st.params.hold === hName;
      const row = document.createElement("div");
      row.className = "toggle-row";
      row.innerHTML = `
        <span class="toggle-name">${hName}</span>
        <button class="switch" type="button" data-hold="${hName}" aria-pressed="${on ? "true" : "false"}"></button>
      `;
      row.querySelector(".switch").addEventListener("click", () => {
        st.params.hold = st.params.hold === hName ? null : hName;
        st.selectedHoldName = hName;
        st.emit("params:changed");
      });
      this.toggleListEl.appendChild(row);
    }
    this.exprGridEl.scrollTop = prevGridScroll;
    this.toggleListEl.scrollTop = prevToggleScroll;
  }

  syncExprActive() {
    const st = this.state;
    this.exprGridEl.querySelectorAll(".expr-card").forEach((c) => {
      const nm = c.dataset.face;
      c.classList.toggle("active", st.params.face === nm || (!st.params.face && nm === "Neutral"));
    });
    this.toggleListEl.querySelectorAll(".switch[data-hold]").forEach((s) => {
      s.setAttribute("aria-pressed", st.params.hold === s.dataset.hold ? "true" : "false");
    });
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
