/* Tiny PNG writer (no dependencies) for gallery images. */
const zlib = require('zlib');
const fs = require('fs');
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
exports.writePNG = function (path, W, H, rgba) {
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
};
// Simple RGBA canvas for composing sheets
exports.Sheet = class {
  constructor(W, H, bg) { this.W = W; this.H = H; this.d = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) { this.d.set(bg || [40, 44, 38], i * 4); this.d[i * 4 + 3] = 255; } }
  blit(img, ox, oy, scale = 1) {
    for (let y = 0; y < img.H * scale; y++) for (let x = 0; x < img.W * scale; x++) {
      const sx = Math.floor(x / scale), sy = Math.floor(y / scale), si = (sy * img.W + sx) * 4;
      if (!img.data[si + 3]) continue;
      const X = ox + x, Y = oy + y; if (X < 0 || Y < 0 || X >= this.W || Y >= this.H) continue;
      const o = (Y * this.W + X) * 4; this.d[o] = img.data[si]; this.d[o + 1] = img.data[si + 1]; this.d[o + 2] = img.data[si + 2]; this.d[o + 3] = 255;
    }
  }
  rect(x, y, w, h, c) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { if (xx < 0 || yy < 0 || xx >= this.W || yy >= this.H) continue; this.d.set([...c, 255], (yy * this.W + xx) * 4); } }
  // tiny 3x5 digit font for labels
  text(str, x, y, c = [40, 30, 24], k = 2) {
    const F = { 0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111', x: '000101010101000', '"': '101101000000000', '.': '000000000000010', '-': '000000111000000', ' ': '000000000000000', y: '101101111001111', r: '000111100100100', N: '111101101101101', T: '111010010010010', p: '110101110100100', t: '010111010010011' };
    let cx = x;
    for (const ch of String(str)) { const g = F[ch] || F[' ']; for (let i = 0; i < 15; i++) if (g[i] === '1') this.rect(cx + (i % 3) * k, y + Math.floor(i / 3) * k, k, k, c); cx += 4 * k; }
  }
  save(p) { exports.writePNG(p, this.W, this.H, this.d); }
};
