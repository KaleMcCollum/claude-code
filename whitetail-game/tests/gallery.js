#!/usr/bin/env node
/* Reference gallery for the deer art. Writes PNGs to tests/gallery/.
   Usage: node tests/gallery.js */
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
for (const f of ['config.js', 'sim.js', 'antlers.js', 'deerart.js']) require(path.join(__dirname, '..', f));
const WT = globalThis.WT;
const { Sheet } = require('./png.js');
const OUT = path.join(__dirname, 'gallery');
fs.mkdirSync(OUT, { recursive: true });
const BG = [248, 248, 248];

function makeBuck(seed, age, target, opts = {}) {
  const rng = WT.makeRng(seed);
  const deer = { id: seed, sex: 'b', age, w: 0.5, cond: 0.8, bodyGene: 0.3, style: Object.assign(WT.rollRackStyle(rng), opts.style || {}) };
  deer.lw = opts.lw ?? 230;
  let tries = 0, res;
  do { res = WT.growRack(deer.style, age, target, WT.makeRng(seed * 7 + tries)); tries++; }
  while (((opts.nt !== undefined && res.sheet.isNT !== opts.nt) || (opts.points && res.sheet.points !== opts.points)) && tries < 600);
  deer.rack = WT.packRack(res.comp); deer.sheet = res.sheet; deer.gross = res.sheet.gross;
  return deer;
}
exports.makeBuck = makeBuck;

// minimal PNG reader for the style reference (8-bit RGB/RGBA, non-interlaced)
function readPNG(file) {
  const b = fs.readFileSync(file);
  let p = 8, W, H, ct, idat = [];
  while (p < b.length) { const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len); if (type === 'IHDR') { W = d.readUInt32BE(0); H = d.readUInt32BE(4); ct = d[9]; } if (type === 'IDAT') idat.push(d); p += 12 + len; }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(W * H * bpp), stride = W * bpp;
  for (let y = 0; y < H; y++) {
    const ft = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x], a = x >= bpp ? px[y * stride + x - bpp] : 0, u = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let r = v;
      if (ft === 1) r = v + a; else if (ft === 2) r = v + u; else if (ft === 3) r = v + ((a + u) >> 1); else if (ft === 4) { const pa = Math.abs(u - c), pb = Math.abs(a - c), pc = Math.abs(a + u - 2 * c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? u : c); }
      px[y * stride + x] = r & 255;
    }
  }
  return { W, H, bpp, px };
}

// 1. side by side with the owner's reference
const refFile = path.join(__dirname, '..', 'art', 'style-reference.png');
{
  const k = 6;
  const sheet = new Sheet((61 + 88 * 3) * k + 40, 92 * k + 20, BG);
  if (fs.existsSync(refFile)) {
    const ref = readPNG(refFile), per = 12.1;
    for (let j = 0; j < 82; j++) for (let i = 0; i < 61; i++) { const sx = Math.min(ref.W - 1, Math.floor(per * (i + 0.5))), sy = Math.min(ref.H - 1, Math.floor(3.8 + per * (j + 0.5))); const o = (sy * ref.W + sx) * ref.bpp; sheet.rect(10 + i * k, 10 + (j + 8) * k, k, k, [ref.px[o], ref.px[o + 1], ref.px[o + 2]]); }
  }
  [[4101, 6.5, 172, 8], [4102, 5.5, 158, 10], [4103, 5.5, 150, 9]].forEach(([seed, age, t, pts], n) => {
    const d = makeBuck(seed, age, t, { points: pts, nt: false, lw: 250 });
    sheet.blit(WT.deerSprite(d, { lod: 0, frame: 'bust', day: 40 }), 20 + (61 + 88 * n) * k, 10, k);
    sheet.text(`${d.sheet.points}pt ${Math.round(d.sheet.gross)}"`, 30 + (61 + 88 * n) * k, 92 * k - 4, [60, 40, 30], 3);
  });
  sheet.save(path.join(OUT, 'vs-reference.png'));
}

// 2. rack variety: random bucks by age, each labelled with points and gross score
{
  const rows = [[1.5, 30, 62], [2.5, 62, 105], [3.5, 95, 135], [4.5, 115, 155], [5.5, 125, 170], [6.5, 140, 195]];
  const cols = 9, k = 3, cw = 88 * k, ch = 92 * k + 16;
  const sheet = new Sheet(cols * cw, rows.length * ch, BG);
  const rng = WT.makeRng(99);
  rows.forEach(([age, lo, hi], r) => {
    for (let c = 0; c < cols; c++) {
      const d = makeBuck(1000 + r * 50 + c, age, lo + (hi - lo) * (c + rng.next() * 0.6) / cols, { lw: 150 + age * 16 });
      sheet.blit(WT.deerSprite(d, { lod: 0, frame: 'bust', day: 40 }), c * cw, r * ch, k);
      sheet.text(`${d.sheet.pointsL}x${d.sheet.pointsR} ${Math.round(d.sheet.gross)}"${d.sheet.isNT ? ' NT' : ''}`, c * cw + 8, r * ch + 92 * k, [60, 40, 30], 2);
    }
  });
  sheet.save(path.join(OUT, 'racks.png'));
}

// 3. non-typicals and oddballs
{
  const k = 4, cw = 88 * k, ch = 92 * k + 18;
  const sheet = new Sheet(6 * cw, 2 * ch, BG);
  let n = 0;
  for (let seed = 7000; n < 12 && seed < 9000; seed++) {
    const d = makeBuck(seed, n < 6 ? 5.5 : 7.5, 150 + (n % 6) * 12, { lw: 250 });
    if (!d.sheet.isNT && d.sheet.abnormal < 3) continue;
    sheet.blit(WT.deerSprite(d, { lod: 0, frame: 'bust', day: 40 }), (n % 6) * cw, Math.floor(n / 6) * ch, k);
    sheet.text(`${d.sheet.pointsL}x${d.sheet.pointsR} ${Math.round(d.sheet.gross)}" NT`, (n % 6) * cw + 8, Math.floor(n / 6) * ch + 92 * k, [60, 40, 30], 2);
    n++;
  }
  sheet.save(path.join(OUT, 'non-typicals.png'));
}

// 4. bodies: the three buck bodies, doe and fawn (bust and full), and every level of detail
{
  const k = 4;
  const deer = [
    { id: 1, sex: 'b', age: 0.5, lw: 80 }, { id: 2, sex: 'd', age: 3.5, lw: 145 },
    makeBuck(301, 1.5, 48, { lw: 145 }), makeBuck(302, 2.5, 100, { lw: 185 }), makeBuck(303, 5.5, 155, { lw: 250 }),
  ];
  const sheet = new Sheet(5 * 88 * k, 92 * k + 104 * k + 20, BG);
  deer.forEach((d, i) => {
    sheet.blit(WT.deerSprite(d, { lod: 0, frame: 'bust', day: 40 }), i * 88 * k, 0, k);
    const f = WT.deerSprite(d, { lod: 1, frame: 'full', day: i === 0 ? 5 : 40 });
    sheet.blit(f, i * 88 * k + (88 * k - f.W * k * 2) / 2, 92 * k + 10, k * 2);
  });
  sheet.save(path.join(OUT, 'bodies.png'));
  const big = makeBuck(303, 5.5, 155, { lw: 250 });
  const lods = new Sheet(5 * 90 * 4 + 200, 95 * 4 + 105 * 8 + 30, BG);
  for (let lod = 0; lod <= 4; lod++) {
    lods.blit(WT.deerSprite(big, { lod, frame: 'bust', day: 40 }), lod * 90 * 4, 0, 4 * Math.pow(2, lod));
    if (lod >= 1) { const f = WT.deerSprite(big, { lod, frame: 'full', day: 40 }); lods.blit(f, (lod - 1) * 320 + 20, 95 * 4 + 20 + (105 * 8 - f.H * 8), 8); }
  }
  ['walk', 'down'].forEach((pose, i) => { const f = WT.deerSprite(big, { lod: 1, frame: 'full', pose, day: 40 }); lods.blit(f, 1300 + i * 330, 95 * 4 + 20 + (105 * 8 - f.H * 8), 8); });
  lods.save(path.join(OUT, 'levels-of-detail.png'));
}

// 5. the same buck from 1.5 to 8.5
{
  const k = 3;
  const rng = WT.makeRng(4242);
  const buck = { id: 4242, sex: 'b', age: 1.5, w: 0.5, cond: 0.85, bodyGene: 0.5, style: WT.rollRackStyle(rng), gp: 172 };
  const curve = { 1.5: 0.36, 2.5: 0.6, 3.5: 0.79, 4.5: 0.91, 5.5: 0.98, 6.5: 1, 7.5: 0.98, 8.5: 0.93 };
  const sheet = new Sheet(8 * 88 * k, 92 * k + 16, BG);
  Object.keys(curve).map(Number).sort((a, b) => a - b).forEach((age, i) => {
    buck.age = age; buck.lw = [150, 185, 215, 240, 255, 260, 250, 235][i];
    const res = WT.growRack(buck.style, age, buck.gp * curve[age], WT.makeRng(77 + i));
    buck.rack = WT.packRack(res.comp);
    sheet.blit(WT.deerSprite(buck, { lod: 0, frame: 'bust', day: 40 }), i * 88 * k, 0, k);
    sheet.text(`${age}yr ${res.sheet.pointsL}x${res.sheet.pointsR} ${Math.round(res.sheet.gross)}"`, i * 88 * k + 8, 92 * k, [60, 40, 30], 2);
  });
  sheet.save(path.join(OUT, 'same-buck-by-age.png'));
}
if (require.main === module) console.log('wrote', OUT);
