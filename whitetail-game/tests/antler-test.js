#!/usr/bin/env node
/* Antler validation (anatomy spec section 6): constraint test and consistency test on 10,000+ racks.
   Usage: node tests/antler-test.js [count=12000] */
const path = require('path');
for (const f of ['config.js', 'sim.js', 'antlers.js']) require(path.join(__dirname, '..', f));
const WT = globalThis.WT;
const LIM = WT.ANTLER_LIMITS;
const N = +process.argv[2] || 12000;
const rng = WT.makeRng(2024);
const ageCurve = { 1.5: 0.35, 2.5: 0.6, 3.5: 0.785, 4.5: 0.91, 5.5: 0.985, 6.5: 0.99, 7.5: 0.98, 8.5: 0.93, 9.5: 0.85 };
const ages = Object.keys(ageCurve).map(Number);
const fails = [];
const byAge = {};
let consistent = 0, nt = 0, drop = 0;
const fail = (msg, info) => { if (fails.length < 25) fails.push(msg + ' ' + JSON.stringify(info)); else fails.length++; };
for (let k = 0; k < N; k++) {
  const age = rng.pick(ages);
  const gp = Math.min(215, Math.max(90, rng.normal(140, 15) + (rng.chance(1 / 400) ? rng.range(20, 40) : 0)));
  const target = Math.max(12, gp * ageCurve[age] * rng.range(0.88, 1.06));
  const style = WT.rollRackStyle(rng);
  const { comp, sheet } = WT.growRack(style, age, target, rng);
  // consistency: rebuild from stored (packed) components and re-measure
  const again = WT.measureRack(WT.buildRack(WT.unpackRack(WT.packRack(comp)), style));
  if (Math.abs(again.gross - sheet.gross) < 0.5 && Math.abs(again.net - sheet.net) < 0.5) consistent++;
  else fail('re-measure mismatch', { gross: sheet.gross, again: again.gross });
  // constraints
  for (const s of sheet.sides) {
    if (s.beam > LIM.beam + 0.01) fail('beam over limit', { beam: s.beam });
    for (const n of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']) if ((s.tines[n] || 0) > LIM[n] + 0.01) fail(n + ' over limit', { len: s.tines[n] });
    if (s.H[0] > LIM.H1 + 0.01) fail('H1 over limit', { H1: s.H[0] });
    if (s.H.some((h, i) => i > 0 && h > s.H[0] + 0.01)) fail('mass does not taper', { H: s.H });
    if (s.typicalPts > LIM.typicalPointsPerSide) fail('too many typical points', { p: s.typicalPts });
    for (const a of s.abn) { const r = LIM.abn[a.type]; if (a.len < 1 || a.len > r[1] + 0.01) fail('abnormal out of range', a); if (a.type === 'drop') drop++; }
    for (const [n, l] of Object.entries(s.tines)) if (l < 1) fail('typical point under 1 inch', { n, l });
  }
  if (sheet.insideSpread > LIM.spread + 0.01) fail('spread over limit', { spread: sheet.insideSpread });
  if (sheet.spreadCredit > Math.max(sheet.sides[0].beam, sheet.sides[1].beam) + 0.01) fail('spread credit > beam', {});
  if (sheet.gross < 5 || sheet.gross > 260) fail('gross out of range', { gross: sheet.gross });
  if (age <= 1.5 && sheet.points > 10) fail('yearling with too many points', { p: sheet.points });
  // tine order along the beam (G1 before G2 before G3 ...): positions are fixed fractions in buildRack
  if (sheet.isNT) nt++;
  (byAge[age] = byAge[age] || []).push(sheet);
}
const pct = (a, n) => ((100 * a) / n).toFixed(1) + '%';
console.log(`Racks generated: ${N}`);
console.log(`Consistency (re-measured geometry == score sheet): ${consistent}/${N}`);
console.log(`Constraint failures: ${fails.length}`);
fails.slice(0, 25).forEach((f) => console.log('  ' + f));
console.log(`Non-typical: ${pct(nt, N)}   racks with a drop tine side: ${drop}`);
console.log('\nAge   avg gross   min   max   avg points   avg spread   NT');
for (const a of ages) {
  const L = byAge[a] || [];
  const avg = (f) => (L.reduce((s, x) => s + f(x), 0) / L.length);
  console.log(`${String(a).padEnd(5)} ${avg((x) => x.gross).toFixed(1).padStart(9)} ${Math.min(...L.map((x) => x.gross)).toFixed(0).padStart(5)} ${Math.max(...L.map((x) => x.gross)).toFixed(0).padStart(5)} ${avg((x) => x.points).toFixed(1).padStart(12)} ${avg((x) => x.insideSpread).toFixed(1).padStart(12)} ${pct(L.filter((x) => x.isNT).length, L.length).padStart(6)}`);
}
console.log('\nScore distribution test: run `node calibrate.js` (harvest tables vs spec targets).');
process.exitCode = fails.length || consistent < N ? 1 : 0;
