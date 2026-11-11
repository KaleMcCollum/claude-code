#!/usr/bin/env node
/* Art check: if the game says a buck has N points, the full-size picture shows N countable points.
   Draws thousands of racks and checks (1) the drawing has exactly as many points as the score sheet,
   and (2) every point's outer part stands clear of every other part of the rack.
   Usage: node tests/points-test.js [count=6000] */
const path = require('path');
for (const f of ['config.js', 'sim.js', 'antlers.js', 'deerart.js']) require(path.join(__dirname, '..', f));
const WT = globalThis.WT;
const N = +process.argv[2] || 6000;
const rng = WT.makeRng(31337);
const ageCurve = { 1.5: 0.35, 2.5: 0.6, 3.5: 0.785, 4.5: 0.91, 5.5: 0.985, 6.5: 0.99, 7.5: 0.98, 8.5: 0.93 };
const ages = Object.keys(ageCurve).map(Number);
let countOk = 0, clearOk = 0, visOk = 0;
const byPts = {}, bad = [];
for (let k = 0; k < N; k++) {
  const age = rng.pick(ages);
  const gp = Math.min(215, Math.max(90, rng.normal(140, 15) + (rng.chance(1 / 400) ? rng.range(20, 40) : 0)));
  const style = WT.rollRackStyle(rng);
  const { comp, sheet } = WT.growRack(style, age, Math.max(12, gp * ageCurve[age] * rng.range(0.88, 1.06)), rng);
  const deer = { id: k + 1, sex: 'b', age, lw: 200, style, rack: WT.packRack(comp) };
  const spr = WT.deerSprite(deer, { lod: 0, frame: 'bust', day: 40 });
  const els = spr.rack.elements;
  const drawn = els.length; // 2 beams (their tips are points) + every tine, brow and abnormal point
  const sameCount = drawn === sheet.points;
  // a point is clear when its tip (the outer third) does not touch any other part of the rack
  const pointsEls = els.filter((e) => e.kind !== 'beam');
  const clear = pointsEls.every((e) => e.tipClash === 0);
  // and it must still be visible in the final image (not painted over, not off the canvas)
  const own = new Map();
  for (let i = 0; i < spr.ant.id.length; i++) { const id = spr.ant.id[i]; if (id) own.set(id, (own.get(id) || 0) + 1); }
  const visible = els.every((e) => (own.get(e.id) || 0) >= 2);
  if (sameCount) countOk++; if (clear) clearOk++; if (visible) visOk++;
  const b = (byPts[sheet.points] = byPts[sheet.points] || { n: 0, clear: 0 });
  b.n++; if (clear && sameCount && visible) b.clear++;
  if ((!sameCount || !visible) && bad.length < 8) bad.push({ k, age, points: sheet.points, drawn, visible });
}
const pct = (a, n) => ((100 * a) / n).toFixed(1) + '%';
console.log(`Racks drawn at full size: ${N}`);
console.log(`Drawn point count equals the score sheet: ${countOk}/${N}`);
console.log(`Every point visible in the picture:      ${visOk}/${N}`);
console.log(`Every point stands clear of the others:  ${clearOk}/${N} (${pct(clearOk, N)})`);
console.log('\nPoints  racks  fully clear');
for (const p of Object.keys(byPts).map(Number).sort((a, b) => a - b)) console.log(String(p).padStart(5), String(byPts[p].n).padStart(7), pct(byPts[p].clear, byPts[p].n).padStart(9));
bad.forEach((b) => console.log('  problem:', JSON.stringify(b)));
process.exitCode = countOk === N && visOk === N ? 0 : 1;
