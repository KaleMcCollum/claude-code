#!/usr/bin/env node
/* Reference gallery (anatomy spec section 6.4 and 6.5). Writes PNGs to tests/gallery/.
   Usage: node tests/gallery.js */
const path = require('path');
const fs = require('fs');
for (const f of ['config.js', 'sim.js', 'antlers.js', 'render.js']) require(path.join(__dirname, '..', f));
const WT = globalThis.WT;
const { Sheet } = require('./png.js');
const OUT = path.join(__dirname, 'gallery');
fs.mkdirSync(OUT, { recursive: true });

function makeBuck(seed, age, target, opts = {}) {
  const rng = WT.makeRng(seed);
  const deer = { id: seed, sex: 'b', age, w: 0.5, cond: 0.8, bodyGene: opts.bodyGene ?? 0.3, style: Object.assign(WT.rollRackStyle(rng), opts.style || {}) };
  deer.lw = opts.lw ?? 230;
  let tries = 0, res;
  do { res = WT.growRack(deer.style, age, target, WT.makeRng(seed * 7 + tries)); tries++; }
  while (opts.nt !== undefined && res.sheet.isNT !== opts.nt && tries < 400);
  deer.rack = WT.packRack(res.comp); deer.sheet = res.sheet;
  return deer;
}

// 1. Racks: four trophy views each
const racks = [
  [1, 2.5, 110, false], [2, 3.5, 130, false], [3, 5.5, 150, false], [4, 5.5, 170, false], [5, 6.5, 190, false],
  [6, 6.5, 180, true], [7, 7.5, 200, true], [8, 7.5, 220, true],
];
const cell = 180, ppi = WT.MOUNT_PPI, up = 3; // render at final low res, blow up with nearest neighbour
const sheet = new Sheet(cell * 4 * up, cell * racks.length * up, [232, 228, 220]);
const mounts = new Sheet(100 * 4 * 4, 110 * 3 * 4, [244, 242, 238]);
racks.forEach(([seed, age, t, nt], r) => {
  const deer = makeBuck(seed * 101, age, t, { nt });
  WT.TROPHY_VIEWS.forEach((v, c) => {
    const img = WT.renderTrophy(deer, v.id, cell, cell, v.id === 'top' ? ppi * 1.6 : ppi, 40);
    sheet.rect(c * cell * up, r * cell * up, cell * up - 3, cell * up - 3, [244, 242, 238]);
    sheet.blit(img, c * cell * up, r * cell * up, up);
  });
  mounts.blit(WT.renderMount(deer, 70, 76), (r % 4) * 400, Math.floor(r / 4) * 440, 5);
  const s = deer.sheet;
  console.log(`row ${r + 1}: target ${t}${nt ? ' NT' : ''}, age ${age}: gross ${s.gross} net ${s.net} ${s.isNT ? 'non-typical' : 'typical'} ${s.pointsL}x${s.pointsR} spread ${s.insideSpread} abn ${s.abnormal}`);
});
sheet.save(path.join(OUT, 'racks.png'));
[['d', 3.5, 145], ['d', 0.5, 85], ['b', 1.5, 140, 45], ['b', 2.5, 175, 90]].forEach(([sex, age, lw, t], k) => {
  const deer = sex === 'b' ? makeBuck(700 + k, age, t, { lw }) : { id: 700 + k, sex, age, lw, bodyGene: 0 };
  mounts.blit(WT.renderMount(deer, 70, 76), k * 400, 880, 5);
});
mounts.save(path.join(OUT, 'mounts.png'));

// 2. Bodies by age, side view
const bodies = [['fawn', 'd', 0.5, 80], ['doe 1.5', 'd', 1.5, 120], ['doe 3.5', 'd', 3.5, 145], ['buck 1.5', 'b', 1.5, 145, 45], ['buck 2.5', 'b', 2.5, 180, 85], ['buck 3.5', 'b', 3.5, 210, 120], ['buck 5.5', 'b', 5.5, 250, 150], ['buck 7.5', 'b', 7.5, 235, 140]];
const bw = 130, bh = 100;
const bs = new Sheet(bw * 12, bh * 6, [244, 242, 238]);
bodies.forEach(([name, sex, age, lw, t], k) => {
  const deer = sex === 'b' ? makeBuck(900 + k, age, t, { lw }) : { id: 900 + k, sex, age, lw, bodyGene: 0 };
  const img = WT.renderDeer(deer, { W: bw, H: bh, scale: 1.4, yaw: 90, elev: 3, center: [0, 30, 0], pose: { head: 'alert' }, day: k === 0 ? 5 : 40 });
  bs.blit(img, (k % 4) * bw * 3, Math.floor(k / 4) * bh * 3, 3);
  console.log(name, JSON.stringify(WT.bodyDims(deer, 40), (kk, v) => (typeof v === 'number' ? +v.toFixed(1) : v)));
});
bs.save(path.join(OUT, 'bodies.png'));

// 3. Same buck, 1.5 to 8.5, 45-degree view
const rng = WT.makeRng(4242);
const buck = { id: 4242, sex: 'b', age: 1.5, w: 0.5, cond: 0.85, bodyGene: 0.5, style: WT.rollRackStyle(rng), gp: 168 };
const curve = { 1.5: 0.36, 2.5: 0.6, 3.5: 0.79, 4.5: 0.91, 5.5: 0.98, 6.5: 1, 7.5: 0.98, 8.5: 0.93 };
const ys = new Sheet(200 * 8, 200, [244, 242, 238]);
Object.keys(curve).map(Number).sort((a, b) => a - b).forEach((age, k) => {
  buck.age = age; buck.lw = [150, 185, 215, 240, 255, 260, 250, 235][k];
  const res = WT.growRack(buck.style, age, buck.gp * curve[age], WT.makeRng(77 + k));
  buck.rack = WT.packRack(res.comp);
  const img = WT.renderTrophy(buck, 'q45', 200, 200, 3.6, 40);
  ys.blit(img, k * 200, 0);
  console.log(`year ${age}: ${res.sheet.gross}" ${res.sheet.pointsL}x${res.sheet.pointsR}`);
});
ys.save(path.join(OUT, 'same-buck-by-age.png'));
console.log('wrote', OUT);
