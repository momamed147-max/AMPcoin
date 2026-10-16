// Quantise the flat placeholder PNGs to an 8-bit palette.
//
// They are simple shapes, but they were saved as 256x256 32bpp ARGB, which is
// 16-31kb each for graphics that need a fraction of that. Displayed at 31px in
// most places, and requested by every visitor.
//
// Median-cut to 256 colours, kept at the same pixel dimensions so every one of
// the ~20 call sites keeps working with no path changes. Reported before/after
// so the saving is measurable rather than assumed.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PUBLIC = path.join(__dirname, '..', 'frontend', 'public');

function readPng(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

// Median cut over the opaque-ish pixels.
function buildPalette(pixels, max = 256) {
  let buckets = [pixels];
  while (buckets.length < max) {
    let target = -1, bestScore = -1;
    buckets.forEach((b, i) => {
      if (b.length < 2) return;
      let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
      for (const p of b) {
        if (p[0] < rMin) rMin = p[0]; if (p[0] > rMax) rMax = p[0];
        if (p[1] < gMin) gMin = p[1]; if (p[1] > gMax) gMax = p[1];
        if (p[2] < bMin) bMin = p[2]; if (p[2] > bMax) bMax = p[2];
      }
      const score = Math.max(rMax - rMin, gMax - gMin, bMax - bMin);
      if (score > bestScore) { bestScore = score; target = i; }
    });
    if (target === -1 || bestScore <= 0) break;
    const b = buckets[target];
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (const p of b) {
      if (p[0] < rMin) rMin = p[0]; if (p[0] > rMax) rMax = p[0];
      if (p[1] < gMin) gMin = p[1]; if (p[1] > gMax) gMax = p[1];
      if (p[2] < bMin) bMin = p[2]; if (p[2] > bMax) bMax = p[2];
    }
    const range = Math.max(rMax - rMin, gMax - gMin, bMax - bMin);
    const chan = range === rMax - rMin ? 0 : range === gMax - gMin ? 1 : 2;
    const sorted = [...b].sort((a, c) => a[chan] - c[chan]);
    const mid = sorted.length >> 1;
    buckets.splice(target, 1, sorted.slice(0, mid), sorted.slice(mid));
  }
  return buckets.filter((b) => b.length).map((b) => {
    let r = 0, g = 0, bl = 0, a = 0;
    for (const p of b) { r += p[0]; g += p[1]; bl += p[2]; a += p[3]; }
    const n = b.length;
    return [Math.round(r / n), Math.round(g / n), Math.round(bl / n), Math.round(a / n)];
  });
}

function crc32(buf) {
  let c, table = crc32.t;
  if (!table) {
    table = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writeIndexed(file, img, palette) {
  const { width, height, data, channels } = img;
  const idx = new Uint8Array(width * height);
  // Cache lookups; these images have huge runs of identical pixels.
  const cache = new Map();
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    let key;
    if (channels === 4) key = (data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3];
    else if (channels === 3) key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
    else key = data[o];
    let hit = cache.get(key);
    if (hit === undefined) {
      const rgb = channels === 4 ? [data[o], data[o + 1], data[o + 2]] : channels === 3 ? [data[o], data[o + 1], data[o + 2]] : [data[o], data[o], data[o]];
      let best = 0, bestD = Infinity;
      for (let p = 0; p < palette.length; p++) {
        const dr = rgb[0] - palette[p][0], dg = rgb[1] - palette[p][1], db = rgb[2] - palette[p][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = p; }
      }
      hit = best;
      cache.set(key, hit);
    }
    idx[i] = hit;
  }

  // Filter type 0 per scanline, then deflate hard.
  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    idx.copy
      ? Buffer.from(idx.buffer, y * width, width).copy(raw, y * (width + 1) + 1)
      : raw.set(idx.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 3;   // colour type: indexed
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((p, i) => { plte[i * 3] = p[0]; plte[i * 3 + 1] = p[1]; plte[i * 3 + 2] = p[2]; });
  const trns = Buffer.alloc(palette.length);
  palette.forEach((p, i) => { trns[i] = p[3]; });

  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('tRNS', trns),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

const targets = ['default-item.png', 'default-avatar.png'];
console.log('\n  placeholder images');
for (const name of targets) {
  const file = path.join(PUBLIC, name);
  const before = fs.statSync(file).size;
  const img = readPng(file);
  const pixels = [];
  for (let i = 0; i < img.width * img.height; i++) {
    const o = i * img.channels;
    pixels.push(img.channels === 4
      ? [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]]
      : [img.data[o], img.data[o + 1], img.data[o + 2], 255]);
  }
  const palette = buildPalette(pixels, 256);
  writeIndexed(file, img, palette);
  const after = fs.statSync(file).size;
  console.log(`    ${name.padEnd(22)} ${Math.round(before / 1024)}kb -> ${Math.round(after / 1024)}kb ` +
    `(${palette.length} colours, ${img.width}x${img.height}) saved ${Math.round((1 - after / before) * 100)}%`);
}
console.log('');