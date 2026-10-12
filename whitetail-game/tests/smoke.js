#!/usr/bin/env node
/* Headless smoke test: plays a season of hunts through the game API. Usage: node tests/smoke.js [seed] */
const path = require('path');
globalThis.localStorage = { _s: {}, getItem(k) { return this._s[k] || null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } };
for (const f of ['config.js', 'sim.js', 'antlers.js', 'render.js', 'game.js']) require(path.join(__dirname, '..', f));
const WT = globalThis.WT;
const seed = +process.argv[2] || 7;
let t = Date.now();
const st = WT.newGame(seed);
console.log('new game ms', Date.now() - t, 'parcels', WT.game.world.parcels.length, 'cash', st.cash);
console.log(WT.buy('tag', 'buck') || 'bought buck tag', '|', WT.buy('tag', 'doe') || 'bought doe tag', '|', WT.buy('equip', 'bino_bush') || 'bought binos', '|', WT.buy('stand', 'climber') || 'bought climber');
for (const c of ['beanie_wal', 'gl_jersey', 'bt_rubber', 'jk_hw', 'bib_wal', 'vest_blaze']) WT.buy('clothing', c);
const cloth = Object.assign({}, st.loadout.clothing, { head: 'beanie_wal', hands: 'gl_jersey', feet: 'bt_rubber', jacket: 'jk_hw', bibs: 'bib_wal', vest: 'vest_blaze' });
WT.buy('consum', 'handwarm', 6);
const pub = WT.publicAreas().find((p) => !st.parcels[p.id].bowOnly);
for (let k = 0, n = 0; k < 400 && n < 3; k++) { const x = pub.minX + (k * 7) % (pub.maxX - pub.minX + 1), y = pub.minY + (k * 13) % (pub.maxY - pub.minY + 1); if (!WT.markSpot(pub.id, x, y)) n++; }
const spots = WT.huntSpots();
console.log('hunt spots', spots.map((s) => s.kind + ':' + (s.stand.name || s.stand.type)).join(', '));
let seen = 0, shots = 0, kills = 0;
for (let h = 0; h < 30 && WT.game.state.day < 92; h++) {
  const sp = spots[h % spots.length];
  const H = WT.startHunt({ pid: sp.pid, stand: sp.stand, carry: sp.kind === 'public' ? 'climber' : null, session: WT.game.state.slot, rifle: 'ruger_ranch', clothing: cloth, equip: { binoculars: 'bino_bush' }, pack: { handwarm: (st.inv.consum.handwarm || 0) > 0 ? 1 : 0 } });
  let guard = 0;
  while (!H.over && guard++ < 200) {
    WT.tick();
    if (H.over) break;
    if (H.visible.length) {
      WT.raiseOptic('bino');
      const m = H.visible[0].members[0];
      if (WT.shotCheck(H, m.deer.id).ok && Math.random() < 0.3) { WT.shoot(m.deer.id); shots++; }
    }
  }
  if (!H.over) WT.endHunt('left');
  seen += H.seenIds.size; kills += H.harvested.length;
  // make sure the log never names a deer's age, score or sex during the hunt
  for (const l of H.log) if (/\b(\d+(\.\d)? ?yrs?|\d+")|\bbucks?\b|\bdoes?\b|pointer|spike|fawn/i.test(l.text) && !/buck tag|doe tag/.test(l.text)) console.log('  LEAK?', l.text);
}
console.log(`30 hunts: deer seen ${seen}, shots ${shots}, harvested ${kills}, hit list ${WT.game.state.hitList.length}, cash ${Math.round(WT.game.state.cash)}, level ${WT.game.state.level}`);
for (const r of WT.game.state.journal) console.log('  harvest:', r.label, r.age, r.gross, r.legal ? 'legal' : 'ILLEGAL', '$' + r.pay);
WT.skip('week');
while (WT.game.state.day < 92 && !WT.game.seasonOver) WT.skip('day');
t = Date.now();
const sum = WT.endSeason();
console.log('season end ms', Date.now() - t, 'year', WT.game.state.year, 'tax', sum.tax, 'events', sum.events.length);
console.log('save bytes', localStorage._s['whitetail-country-save-v1'].length);
WT.load();
console.log('reload ok, year', WT.game.state.year, 'parcels', Object.keys(WT.game.state.parcels).length);
