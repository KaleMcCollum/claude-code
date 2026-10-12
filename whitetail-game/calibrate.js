#!/usr/bin/env node
/* Headless deer calibration (deer-management-spec section 9).
   Usage: node calibrate.js [years=1000] [seed=1]
   Runs each land tier with an AI player, prints harvest score distribution, ages, sightings and money. */
require('./config.js');
require('./sim.js');
require('./antlers.js');
const WT = globalThis.WT;
const CFG = WT.CONFIG;

const YEARS = +process.argv[2] || 1000;
const WORLD_YEARS = +process.argv[4] || 50;
const SEED = +process.argv[3] || 1;

const TIERS = [
  { tier: 'Poor', acres: 100, neighborPressure: 0.6, sits: 26, place: 0.4, managed: false },
  { tier: 'Average', acres: 160, neighborPressure: 0.5, sits: 30, place: 0.5, managed: false },
  { tier: 'Good', acres: 240, neighborPressure: 0.5, sits: 32, place: 0.55, managed: true },
  { tier: 'Excellent', acres: 400, neighborPressure: 0.45, sits: 34, place: 0.6, managed: true },
  { tier: 'Elite', acres: 640, neighborPressure: 0.4, sits: 36, place: 0.65, managed: true },
  { tier: 'Public', acres: 600, neighborPressure: 0.8, sits: 30, place: 0.45, managed: false, type: 'public', base: 'Average' },
];
const BINS = [[0, 120], [120, 130], [130, 140], [140, 150], [150, 160], [160, 170], [170, 190], [190, 200], [200, 999]];
const binLabel = (b) => (b[0] === 0 ? 'Under 120"' : b[1] === 999 ? '200"+' : `${b[0]}-${b[1] - 1}"`);

function rutFor(day) {
  return CFG.calendar.rutPhases.find((p) => day >= p.from && day <= p.to);
}

function runTier(t) {
  const rng = WT.makeRng(SEED * 1000 + t.tier.length * 7);
  const L = CFG.landTiers[t.base || t.tier];
  const prop = {
    id: t.tier, acres: t.acres, type: t.type || 'private', neighborPressure: t.neighborPressure,
    food: L.food, water: L.water, bedding: L.bedding, security: t.type === 'public' ? 0.3 : L.security,
    soilQuality: L.soil, regionalGenetics: L.genetics,
  };
  WT.initHerd(prop, rng);
  const harvest = [], sightAge = {}, herdSizes = [];
  let money = 0, moneyByYear = [], seenSightings = 0, passedAt25 = 0, aliveAt45 = 0;
  const tracked = new Map(); // buck id -> year passed at 2.5
  const doeTags = 2;
  for (let y = 0; y < YEARS; y++) {
    const yearFactor = 1 + rng.range(-CFG.deer.yearlyVariance, CFG.deer.yearlyVariance);
    const winter = Math.min(1, Math.max(0, rng.normal(0.4, 0.2)));
    let buckTag = 1, does = 0;
    let pressure = prop.huntingPressure;
    const sitDays = new Set();
    while (sitDays.size < t.sits) sitDays.add(rng.int(0, CFG.calendar.seasonDays - 1));
    for (let day = 0; day < CFG.calendar.seasonDays; day++) {
      WT.inSeasonDailyMortality(prop, rng, CFG.calendar.seasonDays);
      pressure = Math.max(t.type === 'public' ? CFG.deer.pressure.publicFloor : 0, pressure * CFG.deer.pressure.decay);
      if (!sitDays.has(day)) continue;
      money -= 12; // consumables
      pressure = Math.min(1, pressure + CFG.deer.pressure.perSit);
      const rut = rutFor(day);
      const ctx = { pressure, rut, weather: rng.range(0.8, 1.2), tod: 1, place: t.place, matureRating: t.place, hours: 4, viewShare: WT.viewShare(t.acres) };
      for (const d of prop.herd.slice()) {
        if (!rng.chance(WT.sightingChance(d, ctx))) continue;
        seenSightings++;
        sightAge[Math.min(d.age, 6.5)] = (sightAge[Math.min(d.age, 6.5)] || 0) + 1;
        const mature = d.age >= 3.5;
        if (!rng.chance(mature ? CFG.deer.sighting.shotOpportunity.mature : CFG.deer.sighting.shotOpportunity.young)) continue;
        let shoot = false;
        if (d.sex === 'd' && d.age >= 1.5) shoot = does < doeTags && prop.herd.length > prop.capacity * 0.95;
        else if (d.sex === 'b' && d.age >= 1.5 && buckTag) {
          if (d.age >= 4.5) shoot = true;
          else if (d.age >= 3.5) shoot = d.gross >= (t.managed ? 145 : 120) || day > 84;
          else if (d.age >= 2.5) {
            if (!tracked.has(d.id)) tracked.set(d.id, y);
            shoot = (d.gross < 72 && rng.chance(0.3)) || (!t.managed && day > 86);
          }
        }
        if (!shoot) continue;
        if (!rng.chance(0.85)) continue; // miss / no recovery
        prop.herd.splice(prop.herd.indexOf(d), 1);
        money += WT.payoutFor(d, rng);
        if (d.sex === 'b') { buckTag = 0; harvest.push(d); } else does++;
      }
    }
    money -= 30 + does * 20;
    moneyByYear.push(money);
    herdSizes.push(prop.herd.length / prop.capacity);
    WT.yearCycle(prop, rng, { winter, yearFactor, seasonMortalityApplied: true });
    // survival check: bucks passed at 2.5, alive at 4.5?
    for (const [id, yr] of tracked) {
      if (y - yr === 2) {
        passedAt25++;
        if (prop.herd.some((d) => d.id === id)) aliveAt45++;
        tracked.delete(id);
      }
    }
  }
  return { t, harvest, sightAge, seenSightings, herdSizes, money, moneyByYear, passedAt25, aliveAt45, capacity: prop.capacity };
}

const results = TIERS.map(runTier);
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + '%' : '-');
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

console.log(`\nWhitetail Country calibration: ${YEARS} years per tier, seed ${SEED}\n`);
console.log('Harvested-buck gross score distribution');
console.log(pad('Gross', 12) + results.map((r) => padL(r.t.tier, 11)).join(''));
for (const b of BINS) {
  console.log(pad(binLabel(b), 12) + results.map((r) => padL(pct(r.harvest.filter((d) => d.gross >= b[0] && d.gross < b[1]).length, r.harvest.length), 11)).join(''));
}
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
console.log(pad('Bucks/yr', 12) + results.map((r) => padL((r.harvest.length / YEARS).toFixed(2), 11)).join(''));
console.log(pad('Avg gross', 12) + results.map((r) => padL(avg(r.harvest.map((d) => d.gross)).toFixed(1), 11)).join(''));
console.log(pad('Max gross', 12) + results.map((r) => padL(Math.max(0, ...r.harvest.map((d) => d.gross)).toFixed(1), 11)).join(''));
console.log(pad('Avg age', 12) + results.map((r) => padL(avg(r.harvest.map((d) => d.age)).toFixed(2), 11)).join(''));

console.log('\nHarvested-buck age');
for (const a of [1.5, 2.5, 3.5, 4.5, 5.5, 6.5]) {
  console.log(pad(a === 6.5 ? '6.5+' : a, 12) + results.map((r) => padL(pct(r.harvest.filter((d) => (a === 6.5 ? d.age >= 6.5 : d.age === a)).length, r.harvest.length), 11)).join(''));
}

console.log('\nSightings by age (all deer)');
for (const a of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5]) {
  console.log(pad(a === 6.5 ? '6.5+' : a, 12) + results.map((r) => padL(pct(r.sightAge[a] || 0, r.seenSightings), 11)).join(''));
}
console.log(pad('1.5+2.5 share', 12) + results.map((r) => padL(pct((r.sightAge[1.5] || 0) + (r.sightAge[2.5] || 0), r.seenSightings - (r.sightAge[0.5] || 0)), 11)).join('') + '  (of non-fawns)');
console.log(pad('Sight/sit', 12) + results.map((r) => padL((r.seenSightings / (YEARS * r.t.sits)).toFixed(2), 11)).join(''));

console.log('\nHerd and survival');
console.log(pad('Capacity', 12) + results.map((r) => padL(r.capacity, 11)).join(''));
console.log(pad('Herd/cap', 12) + results.map((r) => padL(avg(r.herdSizes).toFixed(2), 11)).join(''));
console.log(pad('Min/max', 12) + results.map((r) => padL(Math.min(...r.herdSizes).toFixed(2) + '/' + Math.max(...r.herdSizes).toFixed(2), 11)).join(''));
console.log(pad('2.5->4.5', 12) + results.map((r) => padL(pct(r.aliveAt45, r.passedAt25), 11)).join('') + '  (passed at 2.5, alive on property at 4.5)');

console.log('\nMoney (AI player: $12/sit consumables, tags)');
console.log(pad('$/season', 12) + results.map((r) => padL('$' + Math.round(r.money / YEARS), 11)).join(''));
console.log(pad('Yr 1-5', 12) + results.map((r) => padL('$' + Math.round(r.moneyByYear[4]), 11)).join(''));

const targets = { Average: [55, 22, 13, 7, 2.5, 0.5, 0.1, 0, 0], Elite: [25, 22, 22, 15, 9, 4, 2.5, 0.5, 0.03] };
console.log('\nSpec targets  (Average / Elite):');
BINS.forEach((b, k) => console.log(pad(binLabel(b), 12) + padL(targets.Average[k] + '%', 11) + padL(targets.Elite[k] + '%', 11)));

/* ---------------------------------------------------------------- whole-map test (deer spec section 10) */
{
  const world = WT.genWorld(SEED * 17 + 3);
  const rng = WT.makeRng(SEED * 99);
  const props = world.parcels.map((p) => {
    const pub = p.owner === 'public';
    const prop = WT.propFromHabitat({ id: p.id, acres: p.acres, type: pub ? 'public' : 'private', neighborPressure: pub ? 0.85 : rng.range(0.35, 0.7),
      npcStyle: pub ? 'meat' : rng.pick(['meat', 'meat', 'meat', 'normal', 'normal', 'manage']), neighbors: [...p.neighbors] }, p.habitat);
    WT.initHerd(prop, rng);
    return prop;
  });
  let wstate = { adj: 1, drift: 0 };
  console.log(`\nWhole-map test: ${props.length} parcels, ${WORLD_YEARS} years`);
  console.log('Year   Deer   Capacity  Ratio  Bucks 4.5+  Empty  Over 1.6x  Moved  NPC adj');
  const rows = [];
  for (let y = 0; y <= WORLD_YEARS; y++) {
    if (y > 0) {
      for (const p of props) for (let d = 0; d < 92; d++) WT.inSeasonDailyMortality(p, rng, 92);
      const res = WT.worldYear(props, rng, { winter: Math.min(1, Math.max(0, rng.normal(0.4, 0.2))), yearFactor: 1 + rng.range(-0.06, 0.06), seasonMortalityApplied: true }, wstate);
      wstate = res.world; rows.moved = res.moved;
    }
    const total = props.reduce((a, p) => a + p.herd.length, 0), cap = props.reduce((a, p) => a + p.capacity, 0);
    const mature = props.reduce((a, p) => a + p.herd.filter((d) => d.sex === 'b' && d.age >= 4.5).length, 0);
    const empty = props.filter((p) => p.herd.length === 0).length, over = props.filter((p) => p.herd.length > p.capacity * 1.6).length;
    rows.push(total / cap);
    if (y % 5 === 0) console.log(`${String(y).padStart(4)} ${String(total).padStart(6)} ${String(cap).padStart(10)} ${(total / cap).toFixed(2).padStart(6)} ${String(mature).padStart(11)} ${String(empty).padStart(6)} ${String(over).padStart(10)} ${String(rows.moved || 0).padStart(6)} ${wstate.adj.toFixed(2).padStart(8)}`);
  }
  const lo = Math.min(...rows), hi = Math.max(...rows);
  console.log(`World ratio range over ${WORLD_YEARS} years: ${lo.toFixed(2)} to ${hi.toFixed(2)} of capacity (target 0.8 to 1.15)`);
}
