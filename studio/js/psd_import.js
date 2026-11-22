/**
 * Pure client-side Adobe Photoshop PSD v1 binary parser + Layer2D Auto-Rig builder.
 * Supports:
 *   - 8-bit & 16-bit RGB / Grayscale PSD files
 *   - Raw (compression 0) & PackBits RLE (compression 1) channel decompression
 *   - Unicode layer names (luni) + Photoshop folder groups (lsct / lsdk)
 *   - Direct conversion to a runnable multi-angle Layer2D pack.json + WebP/PNG textures + studio.json
 */

import { canvasToBytes } from "./l2d_io.js";

const DEC_LATIN = new TextDecoder("latin1");
const DEC_UTF16BE = new TextDecoder("utf-16be");

function readStr(bytes, off, len) {
  return DEC_LATIN.decode(bytes.subarray(off, off + len));
}

function unpackBits(src, srcOff, srcEnd, dst, dstOff, expectedBytes) {
  let sp = srcOff;
  let dp = dstOff;
  const dstEnd = dstOff + expectedBytes;
  while (sp < srcEnd && dp < dstEnd) {
    let n = src[sp++];
    if (n >= 128) n -= 256;
    if (n >= 0) {
      const count = Math.min(n + 1, dstEnd - dp, srcEnd - sp);
      dst.set(src.subarray(sp, sp + count), dp);
      sp += n + 1;
      dp += count;
    } else if (n !== -128) {
      const count = Math.min(-n + 1, dstEnd - dp);
      const val = src[sp++];
      dst.fill(val, dp, dp + count);
      dp += count;
    }
  }
}

function decodeChannel(bytes, dv, off, dataLen, w, h, depth) {
  const pixels = w * h;
  if (pixels <= 0 || dataLen < 2) return new Uint8Array(pixels);
  const comp = dv.getUint16(off, false);
  const bytesPerSample = depth === 16 ? 2 : 1;
  const rowBytes = w * bytesPerSample;
  const raw = new Uint8Array(h * rowBytes);

  if (comp === 0) {
    const avail = Math.min(raw.length, dataLen - 2);
    raw.set(bytes.subarray(off + 2, off + 2 + avail), 0);
  } else if (comp === 1) {
    let lenOff = off + 2;
    let dataOff = off + 2 + h * 2;
    for (let y = 0; y < h; y++) {
      const lineLen = dv.getUint16(lenOff + y * 2, false);
      unpackBits(bytes, dataOff, dataOff + lineLen, raw, y * rowBytes, rowBytes);
      dataOff += lineLen;
    }
  } else {
    throw new Error(`Unsupported PSD channel compression mode ${comp} (only Raw/RLE supported)`);
  }

  if (depth === 8) return raw;
  // Downsample 16-bit big-endian to 8-bit
  const out = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) out[i] = raw[i * 2];
  return out;
}

export function parsePSD(buf) {
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf);
  if (bytes.length < 26 || readStr(bytes, 0, 4) !== "8BPS") {
    throw new Error("Not a valid Photoshop .psd file (missing 8BPS header)");
  }
  const version = dv.getUint16(4, false);
  if (version !== 1) throw new Error(`Unsupported PSD version ${version} (PSB v2 not supported in browser)`);
  const numChannels = dv.getUint16(12, false);
  const height = dv.getUint32(14, false);
  const width = dv.getUint32(18, false);
  const depth = dv.getUint16(22, false);
  const colorMode = dv.getUint16(24, false);
  if (depth !== 8 && depth !== 16) throw new Error(`Unsupported PSD bit depth ${depth}`);
  if (colorMode !== 3 && colorMode !== 1) throw new Error(`Unsupported PSD color mode ${colorMode} (RGB or Grayscale required)`);

  let p = 26;
  // Color Mode Data
  const colorLen = dv.getUint32(p, false);
  p += 4 + colorLen;
  // Image Resources
  const resLen = dv.getUint32(p, false);
  p += 4 + resLen;
  // Layer and Mask Information
  const layerMaskLen = dv.getUint32(p, false);
  p += 4;
  if (layerMaskLen === 0) {
    throw new Error("PSD contains no layers (flattened PSD — please export with layers intact)");
  }
  const layerInfoLen = dv.getUint32(p, false);
  p += 4;
  let layerCount = dv.getInt16(p, false);
  p += 2;
  layerCount = Math.abs(layerCount);

  const records = [];
  for (let i = 0; i < layerCount; i++) {
    const top = dv.getInt32(p, false); p += 4;
    const left = dv.getInt32(p, false); p += 4;
    const bottom = dv.getInt32(p, false); p += 4;
    const right = dv.getInt32(p, false); p += 4;
    const chCount = dv.getUint16(p, false); p += 2;
    const channels = [];
    for (let c = 0; c < chCount; c++) {
      const id = dv.getInt16(p, false); p += 2;
      const len = dv.getUint32(p, false); p += 4;
      channels.push({ id, len });
    }
    const sig = readStr(bytes, p, 4); p += 4;
    if (sig !== "8BIM") throw new Error(`Invalid PSD layer signature at layer ${i}`);
    const blendMode = readStr(bytes, p, 4); p += 4;
    const opacity = bytes[p++];
    const clipping = bytes[p++] === 1;
    const flags = bytes[p++];
    p++; // filler
    const extraLen = dv.getUint32(p, false); p += 4;
    const extraEnd = p + extraLen;

    // Layer mask data
    const maskLen = dv.getUint32(p, false); p += 4 + maskLen;
    // Blending ranges
    const rangesLen = dv.getUint32(p, false); p += 4 + rangesLen;
    // Pascal layer name (padded to multiple of 4 bytes)
    const nameLen = bytes[p++];
    let name = readStr(bytes, p, nameLen);
    const padTotal = ((1 + nameLen + 3) & ~3) - (1 + nameLen);
    p += nameLen + padTotal;

    // Additional Layer Information blocks (Unicode name 'luni', folder section 'lsct'/'lsdk')
    let sectionType = 0; // 0=normal, 1=open folder, 2=closed folder, 3=bounding divider
    while (p + 12 <= extraEnd) {
      const bSig = readStr(bytes, p, 4);
      if (bSig !== "8BIM" && bSig !== "8B64") break;
      const key = readStr(bytes, p + 4, 4);
      const bLen = dv.getUint32(p + 8, false);
      const bStart = p + 12;
      if (key === "luni" && bLen >= 4) {
        const uLen = dv.getUint32(bStart, false);
        if (bStart + 4 + uLen * 2 <= extraEnd) {
          name = DEC_UTF16BE.decode(bytes.subarray(bStart + 4, bStart + 4 + uLen * 2)).replace(/\0+$/, "");
        }
      } else if ((key === "lsct" || key === "lsdk") && bLen >= 4) {
        sectionType = dv.getUint32(bStart, false);
      }
      p = bStart + ((bLen + 1) & ~1);
    }
    p = extraEnd;

    records.push({
      name: name.trim() || `Layer_${i}`,
      top, left, bottom, right,
      w: Math.max(0, right - left),
      h: Math.max(0, bottom - top),
      channels,
      blendMode,
      opacity: opacity / 255,
      clipping,
      visible: (flags & 2) === 0,
      sectionType,
    });
  }

  // Decode channel image data for each layer (stored bottom-to-top in PSD, matching draw order!)
  const layers = [];
  const groupStack = [];
  for (const rec of records) {
    const chData = Object.create(null);
    for (const ch of rec.channels) {
      if (rec.w > 0 && rec.h > 0 && (ch.id === -1 || ch.id === 0 || ch.id === 1 || ch.id === 2)) {
        chData[ch.id] = decodeChannel(bytes, dv, p, ch.len, rec.w, rec.h, depth);
      }
      p += ch.len;
    }

    if (rec.sectionType === 3) {
      // Bottom-to-top: divider opens a folder scope
      groupStack.push(null);
      continue;
    }
    if (rec.sectionType === 1 || rec.sectionType === 2) {
      // Folder header closes the scope and retroactively names the group for children pushed since divider
      const idx = groupStack.lastIndexOf(null);
      if (idx >= 0) {
        for (let k = layers.length - 1; k >= 0; k--) {
          if (layers[k]._depth > idx) {
            layers[k].folderPath.unshift(rec.name);
          } else break;
        }
        groupStack.splice(idx, 1);
      }
      continue;
    }

    if (rec.w <= 0 || rec.h <= 0) continue;
    const nPix = rec.w * rec.h;
    const rgba = new Uint8ClampedArray(nPix * 4);
    const r = chData[0];
    const g = colorMode === 1 ? chData[0] : chData[1];
    const b = colorMode === 1 ? chData[0] : chData[2];
    const a = chData[-1];
    let nonEmpty = false;
    for (let i = 0; i < nPix; i++) {
      const av = a ? a[i] : 255;
      if (av > 2) nonEmpty = true;
      const o = i * 4;
      rgba[o] = r ? r[i] : 0;
      rgba[o + 1] = g ? g[i] : 0;
      rgba[o + 2] = b ? b[i] : 0;
      rgba[o + 3] = av;
    }
    if (!nonEmpty) continue;

    layers.push({
      name: rec.name,
      left: rec.left,
      top: rec.top,
      w: rec.w,
      h: rec.h,
      opacity: rec.opacity,
      clipping: rec.clipping,
      visible: rec.visible,
      folderPath: [],
      _depth: groupStack.length,
      rgba,
    });
  }

  return { width, height, depth, colorMode, layers };
}

/* ---------- Smart Layer Classifier & Multi-Angle Rig Bootstrap ---------- */
function sanitizeId(name, used) {
  let base = name.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!base) base = "L";
  if (/^[0-9]/.test(base)) base = "L_" + base;
  base = base.slice(0, 32);
  let id = base;
  let k = 2;
  while (used.has(id)) { id = `${base}_${k++}`; }
  used.add(id);
  return id;
}

function classifyLayer(name, folderPath, cy, canvasH) {
  const s = (folderPath.join("/") + "/" + name).toLowerCase();
  if (/tail|t01/.test(s)) return { head: false, kind: 5, pitchGroup: "face", role: "tail", chain: "tail" };
  if (/ear|we0|kemono|fox|wolf|cat/.test(s) && !/earring|pierc/.test(s)) {
    return { head: true, kind: 0, pitchGroup: "ear", role: "ear", chain: /l$|left/.test(s) ? "ear_L" : "ear_R" };
  }
  if (/bang|fringe|h03/.test(s)) return { head: true, kind: 0, pitchGroup: "bangs", role: "bangs", chain: "bangs" };
  if (/side.?hair|lock|h04|h02s/.test(s)) return { head: true, kind: 0, pitchGroup: "side", role: "side_hair", chain: /l$|left/.test(s) ? "hair_L" : "hair_R" };
  if (/back.?hair|h01|h02/.test(s)) return { head: true, kind: 0, pitchGroup: "back", role: "back_hair", chain: "back_hair" };
  if (/hair|ahoge|crown/.test(s)) return { head: true, kind: 0, pitchGroup: "crown", role: "hair", chain: "bangs" };
  if (/eye|iris|sclera|pupil|lash|brow|e0\d|br0/.test(s)) return { head: true, kind: 0, pitchGroup: "face", role: "eye" };
  if (/mouth|lip|tooth|tongue|m0\d/.test(s)) return { head: true, kind: 0, pitchGroup: "face", role: "mouth" };
  if (/face|head|cheek|blush|nose|f0\d/.test(s)) return { head: true, kind: 0, pitchGroup: "face", role: /face|f01/.test(s) ? "face" : "face_detail" };
  if (/glass|mask|pin|ribbon|hat|horn/.test(s)) return { head: cy < canvasH * 0.48, kind: 0, pitchGroup: "bangs", role: "accessory" };
  if (/arm|sleeve|hand|b03|b04/.test(s)) {
    const isL = /l$|left|_l/.test(s);
    return { head: false, kind: isL ? 3 : 2, pitchGroup: "face", role: "arm" };
  }
  if (/leg|thigh|sock|boot|shoe|b05|b06/.test(s)) return { head: false, kind: 6, pitchGroup: "face", role: "leg" };
  if (/skirt|c02/.test(s)) return { head: false, kind: 4, pitchGroup: "face", role: "skirt" };
  // Positional fallback: top 35% of canvas defaults to head
  const isHead = cy < canvasH * 0.34;
  return { head: isHead, kind: isHead ? 0 : 1, pitchGroup: isHead ? "face" : "face", role: isHead ? "head_misc" : "body" };
}

export async function buildPackFromPSD(psd, title = "Imported Avatar", opts = {}) {
  const { width: W, height: H, layers: psdLayers } = psd;
  const maxTexDim = opts.maxTexDim || 2048;
  const numSamples = opts.samples || 9;
  const maxTurn = 0.22;

  const usedIds = new Set();
  const textures = Object.create(null);
  const packLayers = [];
  const pitchGroups = {};
  const folderMap = {}; // studio.json folders
  const chainDefs = [];
  const chainIndexByName = Object.create(null);

  // Estimate head centre from face/eye layers or top-center fallback
  let headCx = W * 0.5, headCy = H * 0.22, faceW = W * 0.24, faceId = null, tailId = null, tailRect = null;
  for (const pl of psdLayers) {
    const cx = pl.left + pl.w * 0.5, cy = pl.top + pl.h * 0.5;
    const cls = classifyLayer(pl.name, pl.folderPath, cy, H);
    if (cls.role === "face" && !faceId) {
      headCx = cx; headCy = cy; faceW = Math.max(pl.w, W * 0.18);
    }
  }
  const headR = Math.max(180, faceW * 0.92);
  const neckPivot = [headCx, headCy + headR * 0.82];
  const waist = [W * 0.5, H * 0.48];

  const getOrAddChain = (name, cx, topY, botY, parent = "head") => {
    if (name in chainIndexByName) return chainIndexByName[name];
    const idx = chainDefs.length;
    chainIndexByName[name] = idx;
    const span = Math.max(80, botY - topY);
    chainDefs.push({
      name,
      parent,
      k: [0.55, 0.18],
      damp: 0.16,
      joints: [
        cx, topY,
        cx, topY + span * 0.33,
        cx, topY + span * 0.66,
        cx, botY,
      ],
      depth: 1.0,
      pin: false,
    });
    return idx;
  };

  let extUsed = "webp";
  let prevLayerId = null;

  for (const pl of psdLayers) {
    const id = sanitizeId(pl.name, usedIds);
    // Render RGBA onto canvas (scale down slightly if gigantic > maxTexDim)
    const scale = Math.min(1, maxTexDim / Math.max(pl.w, pl.h));
    const tw = Math.max(1, Math.round(pl.w * scale));
    const th = Math.max(1, Math.round(pl.h * scale));

    const srcC = document.createElement("canvas");
    srcC.width = pl.w; srcC.height = pl.h;
    srcC.getContext("2d").putImageData(new ImageData(pl.rgba, pl.w, pl.h), 0, 0);

    let outC = srcC;
    if (scale < 1) {
      outC = document.createElement("canvas");
      outC.width = tw; outC.height = th;
      outC.getContext("2d").drawImage(srcC, 0, 0, tw, th);
    }
    const { bytes, ext } = await canvasToBytes(outC, "image/webp", 0.92);
    extUsed = ext;
    textures[`tex/${id}.${ext}`] = bytes;

    const cx = pl.left + pl.w * 0.5;
    const cy = pl.top + pl.h * 0.5;
    const cls = classifyLayer(pl.name, pl.folderPath, cy, H);
    if (cls.role === "face" && !faceId) faceId = id;
    if (cls.role === "tail" && !tailId) { tailId = id; tailRect = pl; }

    pitchGroups[id] = cls.pitchGroup;
    const clip = pl.clipping && prevLayerId ? prevLayerId : null;
    if (clip) {
      const target = packLayers.find((l) => l.id === clip);
      if (target) target.clipTarget = true;
    }

    const layerEntry = {
      id,
      w: tw,
      h: th,
      kind: cls.kind,
      head: cls.head,
      jaw: false,
      noFade: cls.head,
      hole: false,
      clip,
      clipTarget: cls.role === "face",
      pad: cls.head ? 320.0 : 260.0,
      pitchGroup: cls.pitchGroup,
    };

    if (cls.chain) {
      const cIdx = getOrAddChain(cls.chain, cx, pl.top + pl.h * 0.1, pl.top + pl.h * 0.92, cls.role === "tail" ? "hips" : "head");
      layerEntry.chains = [cIdx];
      layerEntry.chainSigma = Math.round(Math.max(120, Math.min(420, Math.max(pl.w, pl.h) * 0.45)));
    }

    // Store original name & folder path in studio.json metadata
    const folder = pl.folderPath.length ? pl.folderPath.join(" / ") : (cls.head ? "Head" : "Body");
    folderMap[id] = { label: pl.name, folder, role: cls.role, origScale: scale };

    packLayers.push({
      ...layerEntry,
      _cx: cx,
      _cy: cy,
      _sx: pl.w / tw,
      _sy: pl.h / th,
      _op: pl.visible ? pl.opacity : 0.0,
      _role: cls.role,
    });
    prevLayerId = id;
  }

  // Build continuous multi-sample yaw keyforms (with volumetric parallax offsets ready for sculpting!)
  const samples = [];
  for (let si = 0; si < numSamples; si++) {
    const u = numSamples === 1 ? 0 : (si / (numSamples - 1)) * 2 - 1; // -1..+1
    const angle = +(u * maxTurn).toFixed(4);
    const sLayers = packLayers.map((L) => {
      const A = [L._sx, 0, 0, L._sy];
      let tx = L._cx, ty = L._cy;
      let turn = 0;
      if (L.head) {
        // Subtle depth parallax by part role (back hair shifts opposite, bangs/face forward)
        const depthMult = L._role === "back_hair" ? -0.35 : L._role === "ear" ? -0.15 : L._role === "bangs" ? 0.14 : 0.0;
        tx += Math.sin(angle) * headR * depthMult;
        turn = +(angle * (L._role === "back_hair" ? 0.45 : 0.72)).toFixed(4);
      }
      return {
        A,
        t: [+tx.toFixed(2), +ty.toFixed(2)],
        op: +L._op.toFixed(3),
        ...(L.head ? { turn } : {}),
      };
    });
    samples.push({
      angle,
      jaw: 0,
      chin: 0,
      chinAt: [headCx, headCy + headR * 0.65],
      layers: sLayers,
    });
  }

  // Strip temporary build fields from packLayers
  const cleanLayers = packLayers.map(({ _cx, _cy, _sx, _sy, _op, _role, ...rest }) => rest);

  const pack = {
    title: `${title} — Layer2D Avatar`,
    canvas: [W, H],
    bg: [0.05, 0.05, 0.07],
    views: {
      bust: [
        Math.round(headCx - headR * 1.9),
        Math.round(Math.max(0, headCy - headR * 1.6)),
        Math.round(headCx + headR * 1.9),
        Math.round(Math.min(H, headCy + headR * 2.5)),
      ],
      full: [0, 0, W, H],
    },
    texExt: extUsed,
    samples,
    layers: cleanLayers,
    head: {
      centre: [headCx, headCy],
      radius: headR,
      eu: [1.0, 0.0],
      ev: [0.0, 1.0],
      chin: headR * 0.68,
      neck: headR * 0.96,
      jawNear: headR * 0.35,
      pivot: neckPivot,
      turn: { R: -maxTurn, L: maxTurn },
    },
    motion: {
      sway: [3.2, 0.006, 0.012],
      stepBounce: 4.0,
      breath: [3.6, 0.0045],
      bodyFollow: [0.12, 0.24],
      bounces: [[7.0, 7.5, 8.0], 14.0, 0.12],
      dur: 13.0,
      earSoft: 5.0,
      sew: 160.0,
      limit: { bend: 0.28, lift: 0.06, earring: 0.6, arm: 0.08 },
      lockSigma: 50.0,
      lockLower: [1.5, 0.8, 3.0],
      springs: {
        skirt: [1.1, 0.25, 0.4, 4.0, 0.4],
        armR: [0.9, 0.35, 0.7, 8.0, 0.0],
        armL: [0.9, 0.35, 0.7, 8.0, 0.0],
      },
      timeline: {
        a: [[0, 0], [1.5, -0.8], [3.5, 0.8], [5.5, 0]],
        roll: [[0, 0], [1.5, 2], [3.5, -2], [5.5, 0]],
      },
      roll0: 0.0,
      waist,
      footY: H * 0.95,
      legTop: H * 0.58,
      shoulder: { armR: [W * 0.36, H * 0.33], armL: [W * 0.64, H * 0.33] },
      bodyC: W * 0.5,
      bodyR: W * 0.28,
      twistY: [H * 0.30, H * 0.50],
      skirtY: [H * 0.48, H * 0.68],
      seam: {
        armR: [-0.3, 0.95, -45.0, -25.0, 50.0, 100.0],
        armL: [0.3, 0.95, 45.0, -25.0, -50.0, 100.0],
      },
      armReach: H * 0.38,
      hair: [],
      field: [],
      earrings: {},
      locks: [],
      elbow: { armR: [W * 0.32, H * 0.46], armL: [W * 0.68, H * 0.46] },
      hand: { armR: [W * 0.30, H * 0.58], armL: [W * 0.70, H * 0.58] },
      shin: [H * 0.76, H * 0.92],
      hips: { R: [W * 0.42, H * 0.58], L: [W * 0.58, H * 0.58] },
      puppetFace: [headCx, headCy, headR * 0.6, headR * 0.65],
    },
    skirt: { y0: 0, xl: [0.0], xr: [1.0], ml: [0.0], mr: [0.0] },
    expr: {
      pieces: {},
      faces: {
        Neutral: { hide: [], add: [], move: {} },
        Happy: { hide: [], add: [], move: {}, eyes: 0.25 },
        Wink: { hide: [], add: [], move: {}, eyes: [1.0, 0.05] },
      },
      holds: {},
      raiseSleeves: {},
      eyes: {},
      blink: [2.8, 0.14],
      faceTimeline: [],
      holdTimeline: [],
      vowels: {},
    },
    hairTint: null,
    eyeTint: null,
    chains: chainDefs,
    chainWind: [0.0, 0.0],
    sheer: null,
    outfits: {},
    hairShadowId: null,
    highlightIds: [],
    pitchGroups,
    ...(tailId && tailRect ? {
      tail: {
        id: tailId,
        pivot: [Math.round(tailRect.left + tailRect.w * 0.25), Math.round(tailRect.top + tailRect.h * 0.2)],
        amp: 0.14,
        freq: 2.3,
        happyFaces: ["Happy"],
      },
    } : {}),
  };

  const studio = {
    version: 1,
    layers: folderMap,
    clips: [
      {
        id: "idle_showcase",
        name: "Idle Turn Showcase",
        fps: 30,
        duration: 5.0,
        loop: true,
        tracks: {
          a: [{ t: 0, v: 0, ease: "easeInOut" }, { t: 1.5, v: -0.75, ease: "easeInOut" }, { t: 3.5, v: 0.75, ease: "easeInOut" }, { t: 5.0, v: 0, ease: "easeInOut" }],
          pitch: [{ t: 0, v: 0, ease: "easeInOut" }, { t: 2.5, v: 0.25, ease: "easeInOut" }, { t: 5.0, v: 0, ease: "easeInOut" }],
          roll: [{ t: 0, v: 0, ease: "easeInOut" }, { t: 1.5, v: 0.04, ease: "easeInOut" }, { t: 3.5, v: -0.04, ease: "easeInOut" }, { t: 5.0, v: 0, ease: "easeInOut" }],
          eyes: [{ t: 0, v: 1, ease: "linear" }, { t: 2.2, v: 1, ease: "linear" }, { t: 2.3, v: 0, ease: "linear" }, { t: 2.42, v: 1, ease: "linear" }],
        },
      },
    ],
  };

  return { pack, textures, studio };
}
