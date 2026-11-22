/**
 * Layer2D (.l2d) client-side ZIP reader, writer, SHA-256 verifier,
 * File System Access save helper, and IndexedDB draft recovery.
 * 100% pure browser ES module — zero backend required.
 */

const ENC = new TextEncoder();
const DEC = new TextDecoder("utf-8");

/* ---------- Pure-JS FIPS 180-4 SHA-256 (works on http:// and file:// too) ---------- */
const SHA256_K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);

export function sha256JsHex(u8) {
  const bitLen = u8.length * 8;
  const padLen = ((u8.length + 9 + 63) >> 6) << 6;
  const msg = new Uint8Array(padLen);
  msg.set(u8);
  msg[u8.length] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  dv.setUint32(padLen - 4, bitLen >>> 0, false);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((v) => v.toString(16).padStart(8, "0")).join("");
}

export async function sha256Hex(u8) {
  if (globalThis.crypto && crypto.subtle) {
    try {
      const digest = await crypto.subtle.digest("SHA-256", u8);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    } catch (_) { /* fall through */ }
  }
  return sha256JsHex(u8);
}

/* ---------- CRC32 for ZIP ---------- */
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[i] = c >>> 0;
}
export function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(u8) {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const cs = new CompressionStream("deflate-raw");
    const ab = await new Response(new Blob([u8]).stream().pipeThrough(cs)).arrayBuffer();
    return new Uint8Array(ab);
  } catch (_) {
    return null;
  }
}

/* ---------- ZIP Reader (.l2d spec-compliant) ---------- */
export async function parseZip(buf) {
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a valid .l2d archive (missing ZIP directory)");
  const cdCount = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);
  const files = Object.create(null);
  const seen = new Set();

  for (let i = 0; i < cdCount; i++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) throw new Error("Corrupt .l2d central directory");
    const method = dv.getUint16(ptr + 10, true);
    const compSz = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commLen = dv.getUint16(ptr + 32, true);
    const localOff = dv.getUint32(ptr + 42, true);
    const name = DEC.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commLen;

    if (!name || name.startsWith("/") || name.startsWith("\\") || name.split(/[\\/]/).includes("..")) {
      throw new Error(`Unsafe path in .l2d archive: ${name}`);
    }
    if (seen.has(name)) throw new Error(`Duplicate entry in .l2d archive: ${name}`);
    seen.add(name);
    if (name.endsWith("/")) continue;

    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataOff = localOff + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(dataOff, dataOff + compSz);
    if (method === 0) {
      files[name] = raw.slice();
    } else if (method === 8) {
      if (typeof DecompressionStream === "undefined") {
        throw new Error("Browser lacks DecompressionStream for compressed .l2d entries");
      }
      const ds = new DecompressionStream("deflate-raw");
      const out = await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer();
      files[name] = new Uint8Array(out);
    } else {
      throw new Error(`Unsupported ZIP method ${method} for ${name}`);
    }
  }
  return files;
}

/* ---------- ZIP Writer (deterministic, STORE textures + DEFLATE JSON) ---------- */
export async function writeZip(entries) {
  // entries: Array<{ name: string, data: Uint8Array, compress?: boolean }>
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  // Deterministic DOS timestamp: 2026-01-01 00:00:00
  const dosTime = 0x0000;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const ent of sorted) {
    const nameBytes = ENC.encode(ent.name);
    const raw = ent.data instanceof Uint8Array ? ent.data : new Uint8Array(ent.data);
    const crc = crc32(raw);
    let method = 0;
    let payload = raw;
    if (ent.compress && raw.length > 256) {
      const def = await deflateRaw(raw);
      if (def && def.length < raw.length) {
        method = 8;
        payload = def;
      }
    }

    const lh = new Uint8Array(30 + nameBytes.length);
    const ldv = new DataView(lh.buffer);
    ldv.setUint32(0, 0x04034b50, true);
    ldv.setUint16(4, 20, true);           // version needed
    ldv.setUint16(6, 0x0800, true);       // UTF-8 filename flag
    ldv.setUint16(8, method, true);
    ldv.setUint16(10, dosTime, true);
    ldv.setUint16(12, dosDate, true);
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, payload.length, true);
    ldv.setUint32(22, raw.length, true);
    ldv.setUint16(26, nameBytes.length, true);
    ldv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(ch.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);           // version made by
    cdv.setUint16(6, 20, true);           // version needed
    cdv.setUint16(8, 0x0800, true);       // UTF-8 flag
    cdv.setUint16(10, method, true);
    cdv.setUint16(12, dosTime, true);
    cdv.setUint16(14, dosDate, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, payload.length, true);
    cdv.setUint32(24, raw.length, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);

    localParts.push(lh, payload);
    centralParts.push(ch);
    offset += lh.length + payload.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const c of centralParts) cdSize += c.length;

  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(4, 0, true);
  edv.setUint16(6, 0, true);
  edv.setUint16(8, sorted.length, true);
  edv.setUint16(10, sorted.length, true);
  edv.setUint32(12, cdSize, true);
  edv.setUint32(16, cdOffset, true);
  edv.setUint16(20, 0, true);

  const total = cdOffset + cdSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of localParts) { out.set(p, pos); pos += p.length; }
  for (const p of centralParts) { out.set(p, pos); pos += p.length; }
  out.set(eocd, pos);
  return out;
}

/* ---------- High-Level .l2d Read & Write ---------- */
export async function readL2D(buf) {
  const files = await parseZip(buf);
  const manifestRaw = files["layer2d.json"];
  if (!manifestRaw) throw new Error(".l2d archive missing layer2d.json");
  const manifest = JSON.parse(DEC.decode(manifestRaw));
  if (manifest.format !== "layer2d/v1") {
    throw new Error(`Unsupported .l2d format: ${manifest.format} (expected layer2d/v1)`);
  }
  const csRaw = files["SHA256SUMS.json"];
  if (!csRaw) throw new Error(".l2d archive missing SHA256SUMS.json");
  const checksums = JSON.parse(DEC.decode(csRaw));
  const members = Object.keys(files).filter((k) => k !== "SHA256SUMS.json");
  if (Object.keys(checksums).length !== members.length || members.some((k) => !(k in checksums))) {
    throw new Error(".l2d SHA256SUMS.json member mismatch");
  }
  await Promise.all(members.map(async (k) => {
    const digest = await sha256Hex(files[k]);
    if (digest !== checksums[k]) throw new Error(`SHA-256 mismatch in .l2d archive: ${k}`);
  }));

  const entry = manifest.entry || "pack.json";
  if (!files[entry]) throw new Error(`.l2d archive missing ${entry}`);
  const pack = JSON.parse(DEC.decode(files[entry]));
  const studio = files["studio.json"] ? JSON.parse(DEC.decode(files["studio.json"])) : null;

  // Separate texture files (tex/*) and optional preview.png
  const textures = Object.create(null);
  for (const [k, v] of Object.entries(files)) {
    if (k.startsWith("tex/")) textures[k] = v;
  }
  const preview = files["preview.png"] || null;
  return { manifest, pack, studio, textures, preview };
}

export function computeManifest(pack, prevManifest = {}) {
  const expr = pack.expr || {};
  const vowels = Object.keys(expr.vowels || {});
  const stats = {
    layers: (pack.layers || []).length,
    chains: (pack.chains || []).length,
    samples: (pack.samples || []).length,
    expressions: Object.keys(expr.faces || {}).length,
    holds: Object.keys(expr.holds || {}).length,
    outfits: Object.keys(pack.outfits || {}).length,
    exprPieces: Object.keys(expr.pieces || {}).length,
    vowels,
  };
  const capabilities = {
    headYawSamples: stats.samples,
    headPitch2D: true,
    springChains: stats.chains > 0,
    tailRig: Boolean(pack.tail && pack.tail.id),
    obsAlpha: true,
    micLipSync: vowels.length > 0,
    webcamTracking: true,
  };
  const id = (prevManifest.id || (pack.title || "avatar").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "avatar").slice(0, 48);
  const name = prevManifest.name || (pack.title ? pack.title.split("—")[0].trim() : "Avatar");
  return {
    format: "layer2d/v1",
    id,
    name,
    title: pack.title || `${name} — Layer2D Avatar`,
    version: prevManifest.version || "1.0.0",
    author: prevManifest.author || "Layer2D Studio",
    license: prevManifest.license || "MIT",
    createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    entry: "pack.json",
    texExt: pack.texExt || "webp",
    canvas: pack.canvas || [1200, 2000],
    stats,
    capabilities,
    ...(prevManifest.preview ? { preview: prevManifest.preview } : {}),
  };
}

export async function buildL2D({ pack, manifest, textures, studio = null, preview = null }) {
  // Clean temporary runtime-only keys before serializing pack.json
  const cleanPack = { ...pack };
  delete cleanPack.lidx;

  const finalManifest = computeManifest(cleanPack, {
    ...manifest,
    preview: preview ? "preview.png" : undefined,
  });

  const members = Object.create(null);
  members["layer2d.json"] = ENC.encode(JSON.stringify(finalManifest, null, 2) + "\n");
  members["pack.json"] = ENC.encode(JSON.stringify(cleanPack));
  if (studio) {
    members["studio.json"] = ENC.encode(JSON.stringify(studio, null, 2) + "\n");
  }
  if (preview) {
    members["preview.png"] = preview instanceof Uint8Array ? preview : new Uint8Array(preview);
  }
  for (const [k, v] of Object.entries(textures || {})) {
    if (!k.startsWith("tex/")) continue;
    members[k] = v instanceof Uint8Array ? v : new Uint8Array(v);
  }

  // Compute deterministic SHA256SUMS.json across every non-checksum member
  const sums = {};
  const keys = Object.keys(members).sort();
  for (const k of keys) {
    sums[k] = await sha256Hex(members[k]);
  }
  members["SHA256SUMS.json"] = ENC.encode(JSON.stringify(sums, null, 2) + "\n");

  const entries = Object.keys(members).sort().map((name) => ({
    name,
    data: members[name],
    compress: name.endsWith(".json"),
  }));
  return { bytes: await writeZip(entries), manifest: finalManifest };
}

/* ---------- Canvas -> WebP / PNG Bytes ---------- */
export async function canvasToBytes(canvas, mime = "image/webp", quality = 0.92) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
  if (blob && blob.type === mime) {
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: mime === "image/webp" ? "webp" : "png" };
  }
  const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return { bytes: new Uint8Array(await png.arrayBuffer()), ext: "png" };
}

/* ---------- Save via File System Access API (with download fallback) ---------- */
export async function saveBytesToDisk(bytes, suggestedName, fileHandle = null) {
  const blob = new Blob([bytes], { type: "application/vnd.layer2d+zip" });
  if (fileHandle && fileHandle.createWritable) {
    try {
      const w = await fileHandle.createWritable();
      await w.write(blob);
      await w.close();
      return { handle: fileHandle, mode: "direct" };
    } catch (_) { /* fall through */ }
  }
  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: "Layer2D Avatar (.l2d)", accept: { "application/vnd.layer2d+zip": [".l2d"] } }],
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return { handle, mode: "picker" };
    } catch (e) {
      if (e && e.name === "AbortError") return { handle: fileHandle, mode: "cancelled" };
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { handle: null, mode: "download" };
}

/* ---------- IndexedDB Autosave Recovery ---------- */
const DB_NAME = "layer2d_studio_v1";
const STORE = "drafts";

function openDB() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAutosave(l2dBytes, name) {
  try {
    const db = await openDB();
    if (!db) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ name, bytes: l2dBytes, ts: Date.now() }, "latest");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) { /* non-fatal */ }
}

export async function loadAutosave() {
  try {
    const db = await openDB();
    if (!db) return null;
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get("latest");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (_) {
    return null;
  }
}
