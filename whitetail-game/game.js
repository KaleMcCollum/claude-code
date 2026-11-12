/* Whitetail Country: game state, economy, gear math, hunt engine. No DOM. */
(function (root) {
  const WT = (root.WT = root.WT || {});
  const C = () => WT.CONFIG;
  const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
  const byId = (list, id) => list.find((x) => x.id === id);
  const T = () => WT.T;

  const G = (WT.game = { state: null, world: null, rng: null });
  const S = () => G.state;

  /* ================================================================ lookups */
  WT.rifle = (id) => byId(C().rifles, id);
  WT.scope = (id) => byId(C().scopes, id);
  WT.standType = (id) => byId(C().stands, id);
  WT.cloth = (id) => byId(C().clothing, id);
  WT.equip = (id) => byId(C().equipment, id);
  WT.consum = (id) => byId(C().consumables, id);
  WT.camType = (id) => byId(C().cameras, id);
  WT.plotType = (id) => byId(C().improvements.foodplot.types, id);

  /* ================================================================ calendar */
  WT.dateLabel = (day) => {
    const m = C().calendar.monthStarts.slice().reverse().find((mm) => day >= mm.start);
    return `${m.name} ${day - m.start + 1}`;
  };
  WT.rutPhase = (day) => C().calendar.rutPhases.find((p) => day >= p.from && day <= p.to) || C().calendar.rutPhases[0];
  WT.sunTimes = (day) => ({ rise: WT.lerpTable(C().calendar.sunrise, day), set: WT.lerpTable(C().calendar.sunset, day) });
  WT.fmtTime = (h) => {
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    const H = mm === 60 ? hh + 1 : hh, M = mm === 60 ? 0 : mm;
    const ap = H >= 12 ? 'PM' : 'AM';
    return `${((H + 11) % 12) + 1}:${String(M).padStart(2, '0')} ${ap}`;
  };
  WT.money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  WT.money2 = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2);

  /* ================================================================ weather */
  function rollWeather(day, prev, rng) {
    const lo = WT.lerpTable(C().calendar.temps, day, 1), hi = WT.lerpTable(C().calendar.temps, day, 2);
    // The first week is mild, calm and steady so a new hunter can sit in starter clothes.
    // Then the first cold front of the fall arrives and the weather follows the normal slide into winter.
    const fairDays = C().calendar.fairDays || 0, fair = day < fairDays;
    let anom = prev ? prev.anom * 0.65 + rng.normal(0, fair ? 2 : 6) : rng.normal(0, fair ? 2 : 6);
    let front = false;
    if (fairDays && day === fairDays) { front = true; anom -= rng.range(5, 9); }
    else if (!fair && rng.chance(0.13)) { front = true; anom -= rng.range(8, 18); }
    const after = prev && prev.front;
    const windDir = front ? rng.pick(['NW', 'N', 'NW', 'W']) : rng.pick(['NW', 'NW', 'N', 'W', 'S', 'S', 'SE', 'SW', 'E', 'NE']);
    const wind = Math.round(front ? rng.range(14, 28) : after ? rng.range(2, 9) : fair ? rng.range(2, 8) : rng.range(3, 20));
    const low = Math.round(lo + anom), high = Math.round(hi + anom);
    const precipChance = front ? 0.4 : fair ? 0.04 : 0.12;
    const precip = rng.chance(precipChance) ? (low < 30 ? 'snow' : 'rain') : null;
    let move = 1;
    if (front) move *= 1.1;
    if (after) move *= 1.35;
    if (high > hi + 10) move *= 0.75;
    if (wind > 18) move *= 0.8;
    if (precip === 'rain') move *= 0.9;
    if (precip === 'snow' && !front) move *= 1.1;
    return { low, high, anom, front, afterFront: after, windDir, wind, precip, move };
  }
  WT.weatherLine = (w) => {
    const bits = [`${w.low}°/${w.high}°F`, `wind ${w.windDir} ${w.wind} mph`];
    if (w.precip) bits.push(w.precip);
    if (w.front) bits.push('cold front moving in');
    else if (w.afterFront) bits.push('cold and calm after the front');
    return bits.join(', ');
  };
  WT.sessionTemp = (w, session) => {
    if (session === 'morning') return w.low + (w.high - w.low) * 0.25;
    if (session === 'evening') return w.low + (w.high - w.low) * 0.7;
    return w.low + (w.high - w.low) * 0.5;
  };

  /* ================================================================ new game */
  WT.newGame = function (seed) {
    seed = seed || ((Math.random() * 1e9) | 0);
    const world = WT.genWorld(seed, 7); // version 6 worlds: lakes, state land that cuts across the road grid, private places of every size. Version 7: no land left belonging to nobody
    captureNatural(world);
    G.world = world;
    const rng = WT.makeRng(seed ^ 0x5eed);
    G.rng = rng;
    WT.setDeerSeq(1);
    const st = {
      v: 1, seed, year: 1, day: 0, slot: 'morning',
      cash: C().economy.startingCash, xp: 0, level: 1, skillPts: 2,
      skills: Object.fromEntries(Object.keys(C().skills).map((k) => [k, 0])),
      inv: {
        rifles: ['ruger_ranch'], scopes: ['simmons'], rifleScope: { ruger_ranch: 'simmons' },
        stands: { ground: 1 }, clothing: C().clothing.filter((c) => c.starter).map((c) => c.id),
        equipment: [], cameras: {}, consum: {}, propane: 0, lightCharge: 0,
      },
      loadout: { rifle: 'ruger_ranch', clothing: { base: 'tee', mid: 'sweat_blaze', pants: 'jeans', feet: 'sneakers' }, equip: {}, pack: {} },
      tags: { buck: 0, doe: 0, buckFilled: 0, doeFilled: 0 },
      parcels: {}, tileMods: {}, forSale: [],
      genV: 7,
      journal: [], news: [], hitList: [], photos: [], settings: { hand: 'right', bowThird: true, pubHerds: true, pubCrowd: true, bowHerds: true, fineRefund: true },
      stats: { hunts: 0, hours: 0, seen: 0, shots: 0, misses: 0, wounded: 0 },
      weather: null, rngState: 0, deerSeq: 1, lastHunt: null, seasonLog: { hunts: 0, harvest: [] },
    };
    G.state = st;
    // dynamic parcel data + herds
    for (const p of world.parcels) {
      const dyn = {
        owner: p.owner, permission: !!p.permission, permBought: false, bowOnly: !!p.bowOnly,
        stands: [], cams: [], plots: [], waterholes: [], trees: [], sanctuary: [],
        scoutSits: 0, spots: [], neighborPressure: p.owner === 'public' ? 0.85 : rng.range(0.35, 0.7),
        npcStyle: p.owner === 'public' ? 'meat' : rng.pick(['meat', 'meat', 'meat', 'normal', 'normal', 'manage']),
      };
      st.parcels[p.id] = dyn;
    }
    for (const p of world.parcels) initParcelHerd(p.id);
    // neighbors' stands on parcels that sell permission
    for (const p of world.parcels) {
      const d = st.parcels[p.id];
      if (d.owner === 'npc' && d.permission) {
        const n = Math.max(1, Math.min(3, Math.floor(p.acres / 70)));
        for (let k = 0; k < n; k++) {
          const spot = pickGoodTile(p.id, rng);
          if (spot) d.stands.push(makeStand(rng.pick(['ladder', 'ladder', 'box', 'tripod', 'hangon']), spot.x, spot.y));
        }
        d.permFee = Math.round(p.acres * rng.range(...C().world.permissionFeePerAcre) / 5) * 5;
      }
    }
    // starter land gets one cheap ladder stand at a decent spot
    const home = world.parcels[world.starterId];
    // ...tucked in the tightest cover on the place, so a beginner's deer are close enough for the starter rifle
    let hs = pickGoodTile(home.id, rng);
    {
      const w = world; let best = null;
      for (let y = home.minY; y <= home.maxY; y++) for (let x = home.minX; x <= home.maxX; x++) {
        const i = y * w.W + x;
        if (w.parcelOf[i] !== home.id || !standableTile(w.cover[i]) || WT.landType(w.cover[i]) !== 'timber' && WT.landType(w.cover[i]) !== 'prairie') continue;
        const r = WT.spotRatings(w, x, y), score = -r.visibility - Math.abs(spotPercentile(peakOf(r)) - 0.6); // tight cover, a decent (not great) spot
        if (!best || score > best.score) best = { x, y, score };
      }
      if (best) hs = best;
    }
    st.parcels[home.id].stands.push(makeStand('ladder', hs.x, hs.y, 'Old ladder'));
    rotateListings();
    st.weather = rollWeather(0, null, rng);
    st.cropDay = rng.int(C().land.crops.offDay[0], C().land.crops.offDay[1]);
    // A new game opens in the off-season: sign is on the ground to scout, plots can be laid out and planted, and
    // stands and cameras can be set up without losing days. It ends with your first hunt or the first day you wait.
    {
      const carried = [];
      for (const p of world.parcels) { const d = st.parcels[p.id]; if (d.owner !== 'player' && d.owner !== 'public') continue; for (const deer of d.herd) if (deer.sex === 'b' && deer.age >= 1.5 && deer.rack) carried.push({ id: deer.id, pid: p.id, age: Math.max(1.5, deer.age - 1), pR: deer.pR || 0, pL: deer.pL || 0, gross: deer.gross || 0, snap: WT.snapshot(deer) }); }
      st.sheds = []; layDownSign(carried);
      st.scoutLeft = C().scouting.searches; st.plantingOpen = true;
    }
    news('It is the off-season. Before opening day you can scout for sign (5 searches), lay out and plant food plots, and put up stands and cameras without losing any days. It ends when you first hunt or wait.', 'good');
    news(`Welcome to the Home Place: ${home.acres} acres of your own. Scout it, set it up, buy a buck tag at the Shop, then press HUNT.`);
    news('Rifle season runs Oct 1 to Dec 31 this year.');
    news('Tip: the first week of October is mild, so your starter clothes are fine for now. After the first cold front (around Oct 8) you will need a jacket, bibs, boots and a hat to sit more than a few minutes.');
    return st;
  };

  function initParcelHerd(pid) {
    const p = G.world.parcels[pid], d = S().parcels[pid];
    const prop = makeProp(pid);
    WT.initHerd(prop, G.rng);
    d.herd = prop.herd; d.capacity = prop.capacity; d.pressure = prop.huntingPressure;
  }

  /* The four kinds of ground (plus water and roads). */
  WT.landType = function (c) {
    const TT = T();
    if (c === TT.SLOUGH) return 'swamp';
    if (c === TT.CORN || c === TT.SOY || c === TT.SUNFLOWER) return 'farm';
    if (c === TT.TIMBER || c === TT.BELT || c === TT.BRUSH || c === TT.YOUNGTREES) return 'timber';
    if (WT.isWater(c)) return 'water';
    if (c === TT.ROAD || c === TT.TOWN || c === TT.YARD) return 'road';
    return 'prairie';
  };
  WT.LAND = {
    prairie: { name: 'Prairie', rule: 'Open ground. Build anything here; the place for food plots and tree rows.' },
    timber: { name: 'Timber', rule: 'Woods. Holds more deer. Any stand or camera; no food plots without open ground.' },
    farm: { name: 'Farm field', rule: "Somebody's crop. Nothing can be built or marked here, and it can't be sanctuary." },
    swamp: { name: 'Swamp', rule: 'Where old bucks live. Ladder stands and carried stands only: no blinds or big stands, no plots, trees or water holes.' },
    water: { name: 'Water', rule: '' }, road: { name: 'Road or farmyard', rule: '' },
  };
  WT.landMix = function (pid) {
    const w = G.world; w._mix = w._mix || {};
    if (w._mix[pid]) return w._mix[pid];
    const p = w.parcels[pid], m = { prairie: 0, timber: 0, farm: 0, swamp: 0, water: 0, road: 0 }; let n = 0;
    for (let y = p.minY; y <= p.maxY; y++) for (let x = p.minX; x <= p.maxX; x++) { const i = y * w.W + x; if (w.parcelOf[i] !== pid) continue; m[WT.landType(w.cover[i])]++; n++; }
    // shoreline: share of the land that lies within about 70 yards of open water
    let land = 0, bank = 0;
    for (let y = p.minY; y <= p.maxY; y++) for (let x = p.minX; x <= p.maxX; x++) {
      const i = y * w.W + x; if (w.parcelOf[i] !== pid || WT.isWater(w.cover[i])) continue;
      land++;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w.W && yy < w.H && WT.isWater(w.cover[yy * w.W + xx])) { near = true; break; } }
      if (near) bank++;
    }
    for (const k in m) m[k] /= Math.max(1, n);
    m.shoreline = bank / Math.max(1, land);
    return (w._mix[pid] = m);
  };
  // What a planted plot touching the stand is worth right now. Depends on the crop and the date:
  // clover and beans pull early, corn and brassicas late, rye is steady. A plot that came in well pulls harder.
  WT.plotPull = function (pid, x, y, day) {
    const st = S(), d = st.parcels[pid]; if (!d || !d.plots) return { f: 1, plot: null };
    day = day ?? st.day;
    const lateW = clamp((day - 25) / 30); // 0 through Oct 25, 1 from Nov 25
    let best = null;
    for (const pl of d.plots) {
      if (!pl.planted || !pl.type || !WT.touchesPlot(pl, { x, y })) continue;
      const pt = WT.plotType(pl.type), val = pt.early * (1 - lateW) + pt.late * lateW;
      const qf = { poor: 0.6, fair: 0.85, good: 1, excellent: 1.2 }[pl.quality] || 0.85;
      const f = 1 + C().plotPull * Math.max(0, val - 0.5) * qf;
      if (!best || f > best.f) best = { f, plot: pl, val, type: pt };
    }
    return best || { f: 1, plot: null };
  };
  // On a warm day deer stay close to water: a stand near it sees more.
  WT.warmWater = function (s) {
    const cfg = C().land.water, hi = S().weather ? S().weather.high : 0;
    return hi >= cfg.warmHigh ? 1 + cfg.warmBoost * (s.r.water || 0) : 1;
  };
  // Crops: standing until the combines roll, then two weeks of deer packed into cover, then they drift away.
  WT.cropsOff = () => S().day >= (S().cropDay ?? 9);
  WT.cropEffect = function (pid) {
    const st = S(), cfg = C().land.crops, m = WT.landMix(pid), farm = m.farm;
    const cover = Math.min(1, (m.timber + m.swamp) * 3 + m.prairie * 0.5); // grass is some cover too
    if (farm < 0.05) return { f: 1, phase: 'none', farm, note: null };
    if (!WT.cropsOff()) return { f: 1 + cfg.standing * farm, phase: 'standing', farm, note: 'crops are still standing and holding deer' };
    const since = st.day - (st.cropDay ?? 9);
    if (since <= cfg.rushDays) return { f: 1 + farm * (cfg.rush[0] + cfg.rush[1] * cover), phase: 'rush', farm, cover, left: cfg.rushDays - since, note: cover > 0.3 ? 'crops just came off: deer are packed into your cover' : 'crops just came off: deer are on the move' };
    return { f: 1 - farm * cfg.after * (1 - cfg.coverSaves * cover), phase: 'off', farm, cover, note: cover > 0.6 ? 'crops are off, but your cover is holding deer' : 'crops are off: deer are drifting to the neighbors' };
  };

  /* Home areas. Every deer lives around one spot on its property, picked from the deer itself so it never moves
     (unless he changes properties). Homes favour cover three to one. A deer can show at any stand, but about twice
     as often near home and half as often at the far end. Bucks roam wider than does, and in the rut bucks go anywhere. */
  function parcelTiles(pid) {
    const w = G.world; w._ptiles = w._ptiles || {};
    if (w._ptiles[pid]) return w._ptiles[pid];
    const p = w.parcels[pid], list = [];
    for (let y = p.minY; y <= p.maxY; y++) for (let x = p.minX; x <= p.maxX; x++) { const i = y * w.W + x; if (w.parcelOf[i] !== pid) continue; const lt = WT.landType(w.cover[i]); const n = lt === 'swamp' ? 6 : lt === 'farm' || lt === 'water' || lt === 'road' ? 0 : WT.COVER[w.cover[i]].b >= 0.5 ? 3 : 1; for (let k = 0; k < n; k++) list.push(i); }
    return (w._ptiles[pid] = list.length ? list : [p.labelY * w.W + p.labelX]);
  }
  WT.deerHome = function (pid, deer) {
    const w = G.world, list = parcelTiles(pid), home = deer.mom && (S().parcels[pid].herd || []).some((m) => m.id === deer.mom) ? deer.mom : deer.id; // a fawn lives where its mother does
    let pool = list;
    if (S().parcels[pid].owner === 'public' && deer.sex === 'b' && deer.age >= 3.5) pool = WT.access(pid).deep; // old bucks on public live where people don't walk
    const i = pool[Math.floor(WT.hash2(home, pid, 91) * pool.length) % pool.length];
    return { x: i % w.W, y: (i / w.W) | 0 };
  };
  WT.homeFactor = function (pid, deer, x, y, rut) {
    const cfg = C().home, antlered = deer.sex === 'b' && deer.age >= 1.5;
    // A deer's range is a deer's range, however big the area around it. On a huge public area the deer on the far
    // side might as well be on another property, so the odds of one that lives a long way off fall away with its size.
    const acres = G.world.parcels[pid].acres, big = Math.min(1, 250 / acres);
    if (antlered && rut && big === 1) return 1;
    const h = WT.deerHome(pid, deer), size = Math.sqrt(Math.min(acres, 250) * 4);
    const reach = size * (antlered ? cfg.buckReach : cfg.doeReach) * (antlered && rut ? 2.5 : 1), near = Math.exp(-Math.pow(Math.hypot(h.x - x, h.y - y) / reach, 2));
    if (antlered && rut) return big + (1 - big) * near; // in the rut a buck covers a lot of ground, but not two miles of it
    return cfg.far * big + (cfg.near - cfg.far * big) * near;
  };

  /* Sanctuary is ground you give up. A marked tile only works if it is cover (timber, tree rows, brush, slough,
     CRP grass, young trees) and no stand of yours is within about 100 yards. The bonus stops at 25% of the land. */
  const SANCT_COVER = () => [T().TIMBER, T().BELT, T().BRUSH, T().PRAIRIE, T().SLOUGH, T().YOUNGTREES];
  WT.sanctuaryInfo = function (pid) {
    const d = S().parcels[pid], w = G.world, cfg = C().sanctuary, ok = SANCT_COVER();
    const working = new Set(); let notCover = 0, nearStand = 0;
    for (const i of d.sanctuary || []) {
      const x = i % w.W, y = (i / w.W) | 0;
      if (!ok.includes(w.cover[i])) { notCover++; continue; }
      if ((d.stands || []).some((s) => Math.hypot(s.x - x, s.y - y) <= cfg.standTiles)) { nearStand++; continue; }
      working.add(i);
    }
    const tiles = Math.max(1, w.parcels[pid].tiles || Math.round(w.parcels[pid].acres * 4));
    const share = working.size / tiles;
    return { working, marked: (d.sanctuary || []).length, notCover, nearStand, share, counted: Math.min(cfg.maxShare, share), maxShare: cfg.maxShare, full: share >= cfg.maxShare };
  };
  // The four things the land itself gives deer, 0..1 each (with water holes and working sanctuary counted)
  WT.landStats = function (pid) { const pr = makeProp(pid); return { food: pr.food, water: pr.water, bedding: pr.bedding, security: pr.security }; };

  // Plain advice for one property: what is weakest and what to do about it, most useful first.
  WT.landAdvice = function (pid) {
    const st = S(), w = G.world, d = st.parcels[pid], p = w.parcels[pid], TT = T();
    const ls = WT.landStats(pid), lim = WT.limits(pid), sa = WT.sanctuaryInfo(pid), tips = [];
    const money = WT.money, imp = C().improvements;
    const tilesOf = (...ts) => { let n = 0; for (let y = p.minY; y <= p.maxY; y++) for (let x = p.minX; x <= p.maxX; x++) { const i = y * w.W + x; if (w.parcelOf[i] === pid && ts.includes(w.cover[i])) n++; } return n; };
    const coverAc = tilesOf(...SANCT_COVER()) / 4, plotLeft = lim.plotAcres - WT.plotAcresUsed(pid);
    const near = (a, list, r) => list.some((b) => Math.hypot(a.x - b.x, a.y - b.y) <= r);
    const plotTiles = d.plots.flatMap((q) => q.tiles.map((i) => ({ x: i % w.W, y: (i / w.W) | 0 })));
    // the land
    void plotLeft;
    if (ls.food < 0.5) tips.push(['Food is the weak spot', `Deer here have to leave to eat. Lay out food plot sites on your prairie (free, 2 × 2 tiles each) and plant them in spring after the season. More food means heavier deer, better antlers, and a reason for deer to be on your side of the fence in the evening. Winter rye is the cheap one (${money(imp.foodplot.types[0].cost)} a plot); corn and brassicas hold deer late.`]);
    { const bare = d.plots.filter((q) => !q.planted).length; if (bare) tips.push([WT.plantingOpen() ? 'Plots waiting to be planted' : 'Bare plots', WT.plantingOpen() ? `${bare} plot site${bare === 1 ? ' is' : 's are'} bare dirt. Spring planting is open now: pick a crop for each before your first hunt.` : `${bare} plot site${bare === 1 ? ' is' : 's are'} bare dirt and feeding nothing this season. You can plant them next spring.`]); }
    if (ls.water < 0.45 && d.waterholes.length < lim.waterholes) tips.push(['Water is scarce', `Dig a water hole (${money(imp.waterhole.cost)}). It helps the herd, and a stand near it is better in early October when it's warm.`]);
    if (ls.bedding < 0.4) tips.push(['Not much cover', `Deer feed here but bed somewhere else, so mornings are slow. Plant tree rows (${money(imp.trees.cost)} each). They take ${imp.trees.matureYears} years to become cover, so start early, and run them between cover and food to make a travel route.`]);
    if (ls.security < 0.55) {
      if (!sa.marked && coverAc >= 2) tips.push(['Deer don\'t feel safe here', `Set aside some cover as sanctuary: ground you never hunt. You have about ${Math.round(coverAc)} acres of cover and none of it is sanctuary. It counts up to ${Math.round(sa.maxShare * 100)}% of the property (about ${Math.round(p.acres * sa.maxShare)} acres). Fewer deer die, and they spend more time on your land.`]);
      else if (!sa.full && sa.marked) tips.push(['Room for more sanctuary', `${(sa.working.size / 4).toFixed(1)} acres of sanctuary are working. It keeps helping up to about ${Math.round(p.acres * sa.maxShare)} acres.`]);
      else if (coverAc < 2) tips.push(['No cover to protect', 'Sanctuary only works in cover, and this land has almost none. Plant tree rows first.']);
    }
    if (sa.nearStand) tips.push(['A stand is spoiling your sanctuary', `${sa.nearStand} sanctuary tile${sa.nearStand === 1 ? ' is' : 's are'} within 100 yards of a stand, so ${sa.nearStand === 1 ? 'it doesn\'t' : 'they don\'t'} count. Move the stand back or shrink the sanctuary.`]);
    if (sa.notCover) tips.push(['Sanctuary in the open', `${sa.notCover} sanctuary tile${sa.notCover === 1 ? ' is' : 's are'} on open ground and ${sa.notCover === 1 ? 'does' : 'do'} nothing. Sanctuary only works in timber, brush, sloughs, CRP grass or tree rows.`]);
    // the hunting setup
    if (!d.stands.length) tips.push(['No stand here', 'Buy a stand at the Shop and put it up. A ladder stand on the edge where cover meets food is the safe first pick.']);
    const unknown = d.stands.filter((s) => !(s.sits > 0));
    if (unknown.length) tips.push(['Stands you have never sat', `${unknown.map((s) => s.name || WT.standType(s.type).name).join(', ')}: one sit tells you the spot's rating, winds and view.`]);
    const weak = d.stands.filter((s) => s.sits > 0 && WT.standTraits(s).rating < 45);
    if (weak.length) tips.push(['A stand in a poor spot', `${weak.map((s) => `${s.name || WT.standType(s.type).name} (rating ${WT.standTraits(s).rating})`).join(', ')}. Move it. Hang a few cheap cameras around the property first and put the stand where the busiest one is.`]);
    if (d.stands.length && !d.stands.some((s) => WT.standView(s).far <= 230)) tips.push(['No close-range stand', 'Every stand here looks over open ground, so deer are 150 yards or more out. Put one in timber or brush for shots under 100 yards, which is what the starter rifle can do.']);
    if (d.stands.length && !d.cams.length) tips.push(['No cameras', 'A trail camera tells you which deer live here and whether they move in daylight. Hang one on your best stand, and scatter cheap ones to find a better spot.']);
    const blind = d.stands.filter((s) => !WT.camsAtStand(pid, s).length);
    if (d.cams.length && blind.length && st.inv.cameras && Object.values(st.inv.cameras).some((n) => n > 0)) tips.push(['Cameras sitting in the truck', `You have a camera in the truck and ${blind.length} stand${blind.length === 1 ? '' : 's'} without one.`]);
    if (plotTiles.length && d.stands.length && !plotTiles.some((t) => near(t, d.stands, 2.5))) tips.push(['Nobody is watching your food plot', 'A stand within about 90 yards of a grown plot gets an evening bonus. Put one on the plot\'s downwind corner.']);
    const burned = d.stands.filter((s) => (s.pressure || 0) > 0.35);
    if (burned.length) tips.push(['Rest a stand', `${burned.map((s) => s.name || WT.standType(s.type).name).join(', ')}: the pressure meter is high. Leave it alone for three or four days.`]);
    if (d.stands.length < lim.stands && d.stands.length >= 1 && d.stands.every((s) => s.sits > 0)) tips.push(['Room for another stand', `This land takes ${lim.stands} stands and has ${d.stands.length}. A second stand that works on a different wind means you can hunt here on more days without burning the first.`]);
    { const mx = WT.landMix(pid), ce = WT.cropEffect(pid);
      if (mx.farm > 0.25 && mx.timber + mx.swamp < 0.12) tips.push(['A lot of crop field and not much cover', `${Math.round(mx.farm * 100)}% of this land is farm field you can't build on. Once the crops come off, deer leave it. Plant tree rows on the prairie beside the fields so they have somewhere to go that is still yours.`]);
      if (ce.phase === 'rush') tips.unshift(['Hunt here now', `The crops just came off and deer are packed into the cover. This lasts about ${ce.left} more day${ce.left === 1 ? '' : 's'}.`]);
      if (mx.swamp > 0.04 && !d.stands.some((s) => WT.landType(w.cover[s.y * w.W + s.x]) === 'swamp' || WT.standTraits(s).rating && s.r.mature > 0.6)) tips.push(['You have swamp and no stand on it', 'Swamp is where the old bucks live. Put a ladder stand in it or on its edge (ladders are the only stand allowed there).']); }
    if (!tips.length) tips.push(['This place is in good shape', 'Nothing is holding it back. Keep the pressure low, pass young bucks, and let them get old.']);
    return { stats: ls, sanctuary: sa, tips };
  };

  // Property view handed to the deer simulation. Stats are computed from tiles + improvements.
  function makeProp(pid) {
    const p = G.world.parcels[pid], d = S().parcels[pid];
    const h = WT.tileHabitat(G.world, pid, { sanctuary: WT.sanctuaryInfo(pid).working });
    // a little extra water from water holes in dry spots
    if (d.waterholes && d.waterholes.length) h.water = clamp(h.water + 0.12 * d.waterholes.length);
    p.habitat = h;
    const prop = WT.propFromHabitat({ id: pid, acres: p.acres, type: d.owner === 'public' ? 'public' : 'private', neighborPressure: d.owner === 'public' ? 0.5 : d.neighborPressure }, h); // on public the hunters are counted by access, not here
    prop.effectiveAcres = contiguousAcres(pid);
    prop.geneG = WT.geneAt(pid); // the genetics map: hot pockets and cold ones, sliding slowly across the country
    prop.geneFor = (deer) => { const h = WT.deerHome(pid, deer); return WT.geneTile(h.x, h.y); }; // read at the spot each deer lives, so one big property can be good at one end and poor at the other
    prop.herd = d.herd || [];
    prop.huntingPressure = d.pressure ?? 0.05;
    prop.sanct = WT.sanctuaryInfo(pid).counted;
    prop.bowOnly = !!d.bowOnly;
    if (d.owner === 'player') { // your work on the land, per 100 acres of it
      const L = C().landWork, mixL = WT.landMix(pid), per100 = 100 / Math.max(20, p.acres * (1 - mixL.water));
      const qf = { poor: 0.6, fair: 0.85, good: 1, excellent: 1.2 };
      const plotPts = (d.plots || []).reduce((a, pl) => a + (pl.planted && pl.type ? WT.plotType(pl.type).food / 0.8 * (qf[pl.quality] || 0.85) : 0), 0) * per100;
      const treePts = (d.trees || []).reduce((a, tr) => a + (tr.mature ? 1 : L.youngTree), 0) * per100;
      prop.food = clamp(prop.food + Math.min(L.plotFoodMax, L.plotFood * plotPts));
      prop.plotNutrition = Math.min(L.plotNutritionMax, L.plotNutrition * plotPts);
      prop.plotCapacity = Math.min(L.plotCapacityMax, L.plotCapacity * plotPts);
      { const AL = C().deer.antlers.land; prop.plotAntler = Math.min(AL.plotMax, AL.plot * plotPts); } // a small bump to rack size on planted land
      prop.bedding = clamp(prop.bedding + Math.min(L.treeBedMax, L.treeBed * treePts));
      prop.security = clamp(prop.security + Math.min(L.treeSecurityMax, L.treeSecurity * treePts));
    }
    prop.landQuality = WT.landQualityOf(prop.geneG) + (prop.plotAntler || 0); // the genetics map, plus a little for your food plots: what the antler model multiplies by
    prop.mix = WT.landMix(pid);
    if (d.owner === 'public') { const cr = WT.crowd(pid); prop.publicBuck = cr.buckDeaths; prop.publicDoe = cr.doeMult; prop.pressFloor = cr.floor;
      { // each buck faces the hunters who reach where HE lives: lots by the road, hardly any far back
        const pc = C().publicCrowd, walk = WT.pubWalk(), W = G.world.W, memo = new Map();
        prop.publicBuckFor = (deer) => { const key = deer.id + (deer.age >= 3.5 ? 'o' : 'y'); if (!memo.has(key)) { const h = WT.deerHome(pid, deer), wv = walk[h.y * W + h.x], e = isFinite(wv) ? Math.exp(-wv / pc.access.reach) : 0; memo.set(key, pc.natural + Math.min(pc.maxKill, pc.killPerEase * e) * (cr.bow ? pc.bow.kill : 1)); } return memo.get(key); };
      } }
    prop.npcStyle = d.npcStyle;
    prop.capacity = WT.carryingCapacity(prop);
    return prop;
  }
  /* Land quality for antlers comes straight off the genetics map (see deer.antlers.land): ordinary ground is `neutral`,
     a full hot pocket `hot`, a full cold pocket `cold`. Crops and soil have no say in it; your own food plots add a
     little on top (makeProp). */
  WT.landQualityOf = function (g) {
    const L = C().deer.antlers.land; g = Math.max(-1, Math.min(1, g || 0));
    return g >= 0 ? L.neutral + (L.hot - L.neutral) * g : L.neutral + (L.neutral - L.cold) * g;
  };
  WT.geneName = (g) => (g < -0.6 ? 'Cold' : g < -0.2 ? 'Cool' : g <= 0.2 ? 'Ordinary' : g <= 0.6 ? 'Warm' : 'Hot');
  WT.makeProp = makeProp;
  // The genetics map at one tile, this year. Worked out once per tile per year.
  WT.geneTile = function (x, y) { const w = G.world, yr = S().year || 1; if (w._geneTYr !== yr || !w._geneT) { w._geneT = new Float32Array(w.W * w.H).fill(NaN); w._geneTYr = yr; } const i = y * w.W + x; if (w._geneT[i] !== w._geneT[i]) w._geneT[i] = WT.geneField(w, x, y, yr - 1); return w._geneT[i]; };
  // How the genetics map lies across one property: its coldest, average and hottest ground.
  WT.geneRange = function (pid) { const w = G.world, p = w.parcels[pid]; let lo = 9, hi = -9, sum = 0, n = 0; const st = p.tiles > 1600 ? 2 : 1; for (let y = p.minY; y <= p.maxY; y += st) for (let x = p.minX; x <= p.maxX; x += st) { if (w.parcelOf[y * w.W + x] !== pid) continue; const g = WT.geneTile(x, y); if (g < lo) lo = g; if (g > hi) hi = g; sum += g; n++; } return n ? { lo, hi, avg: sum / n } : { lo: 0, hi: 0, avg: 0 }; };
  WT.geneAt = function (pid) { const w = G.world, p = w.parcels[pid], yr = S().year || 1; if (w._geneYr !== yr) { w._gene = {}; w._geneYr = yr; } if (w._gene[pid] === undefined) w._gene[pid] = WT.geneField(w, p.cx, p.cy, yr - 1); return w._gene[pid]; };

  function contiguousAcres(pid) {
    const d = S().parcels[pid];
    if (d.owner !== 'player') return G.world.parcels[pid].acres;
    const seen = new Set([pid]), q = [pid];
    let acres = 0;
    while (q.length) {
      const id = q.pop(); acres += G.world.parcels[id].acres;
      for (const nb of G.world.parcels[id].neighbors) if (!seen.has(nb) && S().parcels[nb].owner === 'player') { seen.add(nb); q.push(nb); }
    }
    return acres;
  }
  WT.contiguousAcres = contiguousAcres;

  function pickGoodTile(pid, rng) {
    const w = G.world, p = w.parcels[pid];
    let best = null, bs = -1;
    for (let k = 0; k < 120; k++) {
      const x = rng.int(p.minX, p.maxX), y = rng.int(p.minY, p.maxY), i = y * w.W + x;
      if (w.parcelOf[i] !== pid || !standableTile(w.cover[i]) || WT.landType(w.cover[i]) === 'farm') continue; // never in a crop field
      const sc = w.travel[i] + rng.range(0, 0.4);
      if (sc > bs) { bs = sc; best = { x, y }; }
    }
    return best;
  }

  function standableTile(t) {
    const TT = T();
    return !(WT.isWater(t) || t === TT.ROAD || t === TT.TOWN || t === TT.YARD);
  }
  WT.standableTile = standableTile;

  let standSeq = 1;
  function makeStand(type, x, y, name) {
    const r = WT.spotRatings(G.world, x, y);
    return { sid: 's' + Date.now().toString(36) + (standSeq++), type, x, y, name: name || null, sits: 0, seen: 0, pressure: 0, noise: (WT.hash2(x, y, 99) - 0.5), r };
  }
  WT.makeStand = makeStand;

  /* ================================================================ save / load */
  const SAVE_KEY = 'whitetail-country-save-v1';
  WT.save = function () {
    const st = S(); if (!st) return false;
    st.rngState = G.rng.getState();
    st.deerSeq = WT.getDeerSeq();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(st)); return true; } catch (e) { return false; }
  };
  WT.hasSave = function () { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } };
  WT.load = function (raw) {
    let st = raw;
    if (!st) { try { st = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { st = null; } }
    if (!st || st.v !== 1) return null;
    G.world = WT.genWorld(st.seed, st.genV || 1); // a save keeps the kind of map it was made on
    captureNatural(G.world);
    G.state = st;
    G.rng = WT.makeRng(1); G.rng.setState(st.rngState);
    WT.setDeerSeq(st.deerSeq || 1);
    // reapply ownership + tile modifications
    for (const p of G.world.parcels) { const d = st.parcels[p.id]; if (d) p.owner = d.owner; }
    applyTileMods();
    refreshStands();
    // repair saves from before the dispersal fix: antlered bucks that never grew a rack
    for (const p of G.world.parcels) {
      const d = st.parcels[p.id];
      for (const deer of d.herd || []) if (deer.sex === 'b' && deer.age >= 1.5 && !deer.rack) WT.growDeer(deer, makeProp(p.id), G.rng, 1);
    }
    if (st.cropDay === undefined) st.cropDay = 9;
    // older saves: plots paid for under the old rules count as planted for this season
    for (const p of G.world.parcels) for (const pl of (st.parcels[p.id].plots || [])) if (pl.planted === undefined) { pl.planted = !!pl.type; pl.last = pl.type || null; if (pl.type) pl.tiles.forEach((i) => { G.world.cover[i] = T().PLOT; st.tileMods[i] = T().PLOT; }); }
    if (st.skills.composure === undefined) st.skills.composure = Math.min(20, Math.floor(Math.max(st.skills.shooting || 0, st.skills.archery || 0) / 2)); // buck fever used to sit under Marksmanship and Archery
    for (const k in C().skills) if (st.skills[k] === undefined) st.skills[k] = 0; // skills added since this save
    // older saves: bow-only public land now holds an older, bigger herd. Restock it once.
    if (!st.settings || !st.settings.bowHerds) {
      st.settings = st.settings || {};
      for (const p of G.world.parcels) if (st.parcels[p.id].owner === 'public' && st.parcels[p.id].bowOnly) initParcelHerd(p.id);
      st.settings.bowHerds = true;
    }
    // older saves: about a third of public areas should be bow only. Convert more if this map came up short,
    // leaving alone any area where you already have a spot or a camera.
    if (!st.settings.bowThird) {
      const pubs = G.world.parcels.filter((p) => st.parcels[p.id].owner === 'public');
      const want = Math.max(1, Math.round(pubs.length * C().world.bowOnlyShare));
      let have = pubs.filter((p) => st.parcels[p.id].bowOnly).length;
      const free = pubs.filter((p) => { const d = st.parcels[p.id]; return !d.bowOnly && !(d.spots || []).length && !(d.cams || []).length; }).sort((a, b) => WT.hash2(a.id, 3, st.seed + 41) - WT.hash2(b.id, 3, st.seed + 41));
      const changed = [];
      while (have < want && free.length) { const p = free.shift(), d = st.parcels[p.id]; d.bowOnly = true; G.world.parcels[p.id].bowOnly = true; const keep = (d.herd || []).filter((x) => st.hitList.some((e) => e.k === x.id)); initParcelHerd(p.id); st.parcels[p.id].herd.push(...keep); changed.push(p.name); have++; }
      if (changed.length) st.news.unshift({ d: st.day, kind: 'info', text: `The state made ${changed.length === 1 ? 'one more public area' : changed.length + ' more public areas'} bow only: ${changed.join(', ')}.` });
      st.settings.bowThird = true;
    }
    // older saves: regular public land was hunted down to yearlings. Restock it once, keeping any deer on your hit list.
    if (!st.settings.pubCrowd) {
      for (const p of G.world.parcels) {
        const d = st.parcels[p.id]; if (d.owner !== 'public' || d.bowOnly) continue;
        const keep = (d.herd || []).filter((x) => st.hitList.some((e) => e.k === x.id));
        initParcelHerd(p.id);
        st.parcels[p.id].herd.push(...keep);
      }
      st.settings.pubHerds = true; st.settings.pubCrowd = true;
    }
    // older saves: untagged deer used to cost a $500 ticket. Pay those back once.
    st.settings = st.settings || {};
    if (!st.settings.fineRefund) {
      const n = (st.journal || []).filter((r) => r.legal === false).length;
      if (n) { st.cash += 500 * n; st.news.unshift({ d: st.day, kind: 'good', text: `The DNR dropped the no-tag fine${n > 1 ? 's' : ''}. ${WT.money(500 * n)} refunded.` }); }
      st.settings.fineRefund = true;
    }
    // older saves: bucks hung on the wall for free keep their shoulder mounts
    for (const r of st.journal || []) if (r.mount === undefined) r.mount = r.wall && r.legal && r.sheet ? 'shoulder' : null;
    return st;
  };
  // Taxidermy: pay to mount a buck you took legally. Changing the mount later costs the new mount's price.
  WT.mountDeer = function (rec, type) {
    const m = C().economy.mounts[type], st = S();
    if (!m) return 'No such mount.';
    if (!rec || !rec.sheet || !rec.legal) return 'Only a buck you tagged can be mounted.';
    if (rec.mount === type) return 'Already mounted that way.';
    if (st.cash < m.price) return `A ${m.name.toLowerCase()} costs ${WT.money(m.price)}. You have ${WT.money(st.cash)}.`;
    st.cash -= m.price; ledger('Taxidermy', -m.price);
    rec.mount = type; WT.save();
    return null;
  };
  WT.mountedDeer = () => S().journal.filter((r) => r.mount && r.snap && r.snap.rack).sort((a, b) => b.gross - a.gross);
  WT.wipeSave = function () { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage blocked */ } };

  function applyTileMods() {
    const w = G.world, mods = S().tileMods;
    for (const k in mods) w.cover[+k] = mods[k];
    WT.computeDerivedLayers(w);
    for (const p of w.parcels) p.habitat = WT.tileHabitat(w, p.id, { sanctuary: WT.sanctuaryInfo(p.id).working });
  }
  function setTile(i, t) { G.world.cover[i] = t; S().tileMods[i] = t; delete G.world._mix; delete G.world._ptiles; }
  // A stand's rating is read off the ground around it, so anything you plant, dig or grow nearby counts.
  // Call after the ground changes (and on load, for saves where a plot went in after the stand).
  function refreshStands() {
    const w = G.world, st = S();
    for (const p of w.parcels) {
      const d = st.parcels[p.id];
      for (const s of [...(d.stands || []), ...(d.spots || [])]) { s.r = WT.spotRatings(w, s.x, s.y); delete s._traits; }
    }
  }
  WT.refreshStands = refreshStands;
  const rememberCover = (d, i) => { d.prev = d.prev || {}; if (d.prev[i] === undefined) d.prev[i] = G.world.cover[i]; };
  const restoreCover = (d, i) => { setTile(i, d.prev && d.prev[i] !== undefined ? d.prev[i] : T().PASTURE); if (d.prev) delete d.prev[i]; };

  /* ================================================================ news */
  function news(text, kind) {
    const st = S();
    st.news.unshift({ y: st.year, d: st.day, text, kind: kind || 'info' });
    if (st.news.length > 60) st.news.length = 60;
  }
  WT.news = news;

  /* ================================================================ money ledger (shown at season end) */
  // this season's running tally, used for the end-of-season recap
  function slog() {
    const L = S().seasonLog;
    L.byStand = L.byStand || {}; L.bySes = L.bySes || {}; L.bucks = L.bucks || {}; L.hours = L.hours || 0; L.shots = L.shots || 0; L.misses = L.misses || 0; L.busted = L.busted || 0; L.neighbors = L.neighbors || [];
    return L;
  }
  function ledger(cat, amt) {
    const st = S(); if (!st || !amt) return;
    const L = (st.seasonLog.money = st.seasonLog.money || {});
    L[cat] = (L[cat] || 0) + amt;
  }
  WT.ledger = ledger;

  /* ================================================================ progression */
  WT.addXp = function (n) {
    const st = S(), P = C().progression;
    st.xp += Math.round(n);
    const ups = [];
    while (st.level < P.maxLevel && st.xp >= P.xpForLevel(st.level)) {
      st.xp -= P.xpForLevel(st.level);
      st.level++; st.skillPts += P.skillPointsPerLevel;
      const bonus = C().economy.levelUpCash(st.level); st.cash += bonus; ledger('Level-up bonuses', bonus); st.levelCashTotal = (st.levelCashTotal || 0) + bonus;
      ups.push(st.level);
      const unlocked = C().rifles.filter((r) => r.level === st.level);
      unlocked.forEach((r) => {
        if (r.award) { if (!st.inv.rifles.includes(r.id)) { st.inv.rifles.push(r.id); st.inv.rifleScope[r.id] = 'simmons'; } news(`Level ${st.level}! ${r.name} has been handed down to you.`, 'good'); }
        else news(`Level ${st.level} unlocked the ${r.name} (${r.cal}) at the shop.`, 'good');
      });
    }
    if (ups.length) news(`Level up! You're level ${st.level}. +${ups.length * P.skillPointsPerLevel} skill points and ${WT.money(ups.reduce((a, l) => a + C().economy.levelUpCash(l), 0))}.`, 'good');
    return ups;
  };
  WT.spendSkill = function (k) {
    const st = S();
    if (st.skillPts <= 0 || (st.skills[k] || 0) >= WT.skillCap(k).now) return false;
    st.skills[k] = (st.skills[k] || 0) + 1; st.skillPts--; return true;
  };
  // Skill points can't be banked: while one is unspent and something can take it, you don't go hunting.
  WT.mustSpend = function () {
    const st = S(); if (!(st.skillPts > 0)) return null;
    if (!Object.keys(C().skills).some((k) => (st.skills[k] || 0) < WT.skillCap(k).now)) return null;
    return `You have ${st.skillPts} skill point${st.skillPts === 1 ? '' : 's'} to spend. Points can't be saved up: spend ${st.skillPts === 1 ? 'it' : 'them'} before you hunt.`;
  };
  // How high a skill can go: at your level now, ever, and the next level that opens more.
  WT.skillCap = function (k) {
    const st = S(), sk = C().skills[k], max = sk.max || C().progression.skillMax;
    if (!sk.unlock) return { now: max, max, next: null };
    let now = 0, next = null;
    for (const [lvl, cap] of sk.unlock) { if (st.level >= lvl) now = Math.min(max, cap); else if (!next) next = { level: lvl, cap: Math.min(max, cap) }; }
    return { now, max, next };
  };
  // What a skill is doing for you right now, in plain numbers, so a point is never a mystery.
  WT.skillNow = function (k) {
    const st = S(), P = C().progression, K = P.skill, n = st.skills[k] || 0, cf = C().comfort, A = C().publicCrowd.access;
    switch (k) {
      case 'shooting': return `+${Math.round(n * 0.8)} rifle accuracy, recoil bothers you ${Math.round(100 * n / 60)}% less`;
      case 'archery': return `starter bow good to ${WT.bowRange('bear_cruzer')} yd, the crossbow to ${WT.bowRange('ravin_r10')} yd`;
      case 'hiking': return `you can hunt about ${Math.round(Math.min(A.walkMax, WT.hikeReach() * A.walkMin * (1 - A.hikeFaster * n)) / 5) * 5} minutes from the road, and walk ${Math.round(100 * A.hikeFaster * n)}% faster`;
      case 'toughness': return `comfortable ${Math.round(n * K.toughness.cold)}°F colder than your clothes alone`;
      case 'patience': return `${(cf.basePatienceHrs + n * cf.hrsPerPatiencePt).toFixed(1)} hours on stand before comfort, clothing and snacks`;
      case 'stealth': return `about ${n}% quieter in the stand, and quieter walking in`;
      case 'scent': return `scent control +${Math.round(n * 1.2)} on top of your clothes and stand`;
      case 'composure': return `a 150" buck costs you ${Math.round(WT.buckFever({ sex: 'b', gross: 155 }))} accuracy to buck fever, a 170" costs ${Math.round(WT.buckFever({ sex: 'b', gross: 175 }))} (18 and 24 with none)`;
      case 'woodcraft': return `${Math.round((0.3 + n * 0.012) * 100)}% base chance to recover a wounded deer, ${C().scouting.searches + Math.floor(n / C().scouting.woodcraftPer)} scouting searches`;
      case 'judging': return `you read a rack ${Math.round(100 * n * K.judging.reach)}% farther off, and your score guess is ${Math.round(100 * K.judging.errorCut * n / P.skillMax)}% tighter`;
      case 'calling': return `calls pull about ${Math.round(n * 1.2)}% better`;
      case 'habitat': return `planting costs ${Math.round(100 * n * K.habitat.cost)}% less, and plots come up better`;
      default: return '';
    }
  };
  // How far back on public land you can go (tiles of walking from the road).
  WT.hikeReach = function () { const a = C().publicCrowd.access; return a.hikeBase + a.hikePer * (S().skills.hiking || 0); };
  const tooFar = (pid, x, y) => {
    const a = C().publicCrowd.access, need = WT.spotDepth(pid, x, y).tiles, have = S().skills.hiking || 0;
    if (!isFinite(need)) return 'No road reaches this ground. You can only walk in from land next to it that you own or have permission on.';
    if (need <= WT.hikeReach() + 1e-6) return null;
    const pts = Math.ceil((need - a.hikeBase) / a.hikePer), max = C().skills.hiking.max;
    return pts > max ? 'That is further back than anyone walks in from the road. The way in is across land next to it that you own or have permission on.'
      : `That is too far back for you yet. It takes Backcountry ${pts} (you have ${have}), or a way in across land next to it that you own or have permission on.`;
  };

  /* ================================================================ shop */
  WT.buy = function (kind, id, qty = 1) {
    const st = S(), inv = st.inv;
    let price = 0, item;
    switch (kind) {
      case 'rifle': item = WT.rifle(id); if (inv.rifles.includes(id)) return 'You already own it.'; if (item.level > st.level) return `Requires level ${item.level}.`; if (item.award) return 'This one can only be earned.'; price = item.price; break;
      case 'scope': item = WT.scope(id); if (inv.scopes.includes(id)) return 'Already owned.'; price = item.price; break;
      case 'stand': item = WT.standType(id); price = item.price * qty; break;
      case 'clothing': item = WT.cloth(id); if (inv.clothing.includes(id)) return 'Already owned.'; price = item.price; break;
      case 'equip': item = WT.equip(id); if (inv.equipment.includes(id)) return 'Already owned.'; price = item.price; break;
      case 'camera': item = WT.camType(id); price = item.price * qty; break;
      case 'consum': item = WT.consum(id); price = item.packOf ? item.packPrice * qty : item.price * qty; break;
      case 'tag':
        if (id === 'buck') { if (st.tags.buck + st.tags.buckFilled >= 1) return 'One buck tag per season.'; price = C().economy.tags.buck; }
        else { if (st.tags.doe + st.tags.doeFilled >= C().economy.tags.maxDoeTags) return `Limit ${C().economy.tags.maxDoeTags} doe tags per season.`; price = C().economy.tags.doe; }
        break;
      default: return 'Unknown item.';
    }
    if (item && kind !== 'rifle' && (item.level || 1) > st.level) return `${item.name} opens at level ${item.level}. You are level ${st.level}.`;
    if (st.cash < price) return `Not enough money. You need ${WT.money(price)}.`;
    st.cash -= price;
    ledger(kind === 'tag' ? 'Tags' : kind === 'consum' ? 'Consumables' : 'Gear', -price);
    switch (kind) {
      case 'rifle': inv.rifles.push(id); inv.rifleScope[id] = inv.scopes.includes('bushnell') ? 'bushnell' : 'simmons'; break;
      case 'scope': inv.scopes.push(id); break;
      case 'stand': inv.stands[id] = (inv.stands[id] || 0) + qty; break;
      case 'clothing': inv.clothing.push(id); break;
      case 'equip': inv.equipment.push(id); if (item.cat === 'light') inv.lightCharge = Math.max(inv.lightCharge, item.life); break;
      case 'camera': inv.cameras[id] = (inv.cameras[id] || 0) + qty; break;
      case 'consum':
        if (item.fuel) inv.propane += qty;
        else inv.consum[id] = (inv.consum[id] || 0) + (item.packOf ? item.packOf * qty : qty);
        break;
      case 'tag': if (id === 'buck') st.tags.buck++; else st.tags.doe++; break;
    }
    return null;
  };

  /* ================================================================ land market */
  WT.landPrice = function (pid) {
    const w = G.world, p = w.parcels[pid], h = p.habitat, cfg = C().world.pricePerAcre;
    const cb = WT.coverBreakdown(h);
    const share = (name) => (cb.find((r) => r[0] === name) || [0, 0])[1];
    const coverMult = 1 + cfg.cover * (share('Timber') + share('Grass/CRP') * 0.6 + share('Slough/water') * 0.5);
    const waterMult = 1 + cfg.water * h.water;
    const roadFrontage = h.security < 0.5 ? 1 + cfg.access : 1;
    const publicNb = [...p.neighbors].some((q) => S().parcels[q].owner === 'public') ? 1.05 : 1;
    const noise = 1 + (WT.hash2(pid, S().seed, 5) - 0.5) * 2 * cfg.noise;
    const big = p.acres >= 300 ? 1 - cfg.bigDiscount : 1;
    const hidden = 1 + (h.soil - 0.5) * 0.08 + (h.genetics - 0.5) * 0.06; // only a loose link to hidden quality
    const ppa = cfg.base * coverMult * waterMult * roadFrontage * publicNb * noise * big * hidden;
    return Math.round(ppa * p.acres / 50) * 50;
  };
  function rotateListings() {
    const st = S(), w = G.world;
    const cands = w.parcels.filter((p) => st.parcels[p.id].owner === 'npc');
    const out = [];
    const rng = G.rng;
    const pool = cands.slice();
    while (out.length < Math.round(C().world.forSaleCount * ((G.world.big || 1) > 1 ? 1.7 : 1)) && pool.length) {
      const p = pool.splice(rng.int(0, pool.length - 1), 1)[0];
      // listings nearer your land are a little more likely
      out.push(p.id);
    }
    st.forSale = out;
  }
  WT.buyLand = function (pid) {
    const st = S(), d = st.parcels[pid];
    if (!st.forSale.includes(pid)) return 'That parcel is not for sale.';
    const price = WT.landPrice(pid);
    if (st.cash < price) return `You need ${WT.money(price)}. Keep hunting and saving.`;
    st.cash -= price; ledger('Land', -price);
    d.owner = 'player'; d.permission = false; d.permBought = false;
    G.world.parcels[pid].owner = 'player';
    st.forSale = st.forSale.filter((x) => x !== pid);
    d.stands = []; // the old owner took their stands
    d.purchasePrice = price;
    news(`You bought ${G.world.parcels[pid].name} (${G.world.parcels[pid].acres} acres) for ${WT.money(price)}.`, 'good');
    return null;
  };
  WT.sellLand = function (pid) {
    const st = S(), d = st.parcels[pid];
    if (d.owner !== 'player') return 'Not yours to sell.';
    if (pid === G.world.starterId) return "You can't sell the Home Place.";
    const val = Math.round(WT.landPrice(pid) * (1 - C().economy.landSellFee));
    st.cash += val; ledger('Land', val);
    for (const s of d.stands) st.inv.stands[s.type] = (st.inv.stands[s.type] || 0) + (WT.standType(s.type).kind === 'permanent' ? 0 : 1);
    for (const c of d.cams) st.inv.cameras[c.type] = (st.inv.cameras[c.type] || 0) + 1;
    d.stands = []; d.cams = []; d.owner = 'npc'; G.world.parcels[pid].owner = 'npc';
    news(`Sold ${G.world.parcels[pid].name} for ${WT.money(val)}.`);
    return null;
  };
  WT.buyPermission = function (pid) {
    const st = S(), d = st.parcels[pid];
    if (d.owner !== 'npc' || !d.permission) return 'This landowner is not giving permission.';
    if (d.permBought) return 'You already have permission.';
    if (st.cash < d.permFee) return `You need ${WT.money(d.permFee)}.`;
    st.cash -= d.permFee; ledger('Land', -d.permFee); d.permBought = true;
    news(`${G.world.parcels[pid].ownerName} shook your hand. You can hunt their stands on ${G.world.parcels[pid].name} from now on.`, 'good');
    return null;
  };

  /* ================================================================ land development */
  WT.limits = function (pid) {
    const p = G.world.parcels[pid], a = p.acres;
    return {
      stands: Math.max(1, Math.floor(a / 100 * C().standLimitPer100)),
      cams: Math.max(1, Math.floor(a / 100 * C().improvements.camera.per100)),
      plotAcres: Math.floor(a * C().improvements.foodplot.maxShare * 4) / 4,
      waterholes: Math.max(1, Math.floor(a / 100 * C().improvements.waterhole.per100)),
    };
  };
  WT.plotAcresUsed = (pid) => S().parcels[pid].plots.reduce((s, p) => s + p.acres, 0);

  function tileAt(x, y) { const w = G.world; if (x < 0 || y < 0 || x >= w.W || y >= w.H) return -1; return y * w.W + x; }
  WT.tileAt = tileAt;

  WT.placeStand = function (pid, type, x, y) {
    const st = S(), d = st.parcels[pid], w = G.world, i = tileAt(x, y);
    if (d.owner !== 'player') return 'You can only build on your own land.';
    if (i < 0 || w.parcelOf[i] !== pid) return 'Pick a spot inside your property line.';
    if (!standableTile(w.cover[i])) return "Can't put a stand there.";
    if (!st.inv.stands[type]) return 'You do not have one of those in your truck. Buy it at the shop.';
    if (w.cover[i] === T().PLOT || w.cover[i] === T().PLOT_NEW) return 'Stands go on the edge of a food plot, not in it. Pick a tile touching the plot.';
    { const lt = WT.landType(w.cover[i]); if (lt === 'farm') return "That's a crop field. Nothing can go up in it; put the stand on the edge."; if (lt === 'swamp' && !C().land.swampStands.includes(type)) return 'Only a ladder stand can go up in the swamp: no blinds, tripods or box stands.'; }
    if (type === 'ground' || WT.standType(type).kind === 'mobile') return 'That one is carried, not left up. Equip it under Gear to hunt public land; on your own land put up a ladder, tripod, pop-up or box blind.';
    if (d.stands.length >= WT.limits(pid).stands) return `Stand limit reached (${WT.limits(pid).stands} for this acreage).`;
    if (d.stands.some((s) => Math.abs(s.x - x) + Math.abs(s.y - y) < 3)) return 'Too close to another stand.';
    if (d.sanctuary.includes(i)) return "That's inside your sanctuary.";
    st.inv.stands[type]--;
    const s = makeStand(type, x, y);
    d.stands.push(s);
    return null;
  };
  /* Land work takes time, not money. Moving or picking up a stand, and hanging, moving or taking down a camera, use up
     the day: it is the next morning when you are done. One work day covers every job you do before you next hunt or
     wait, so a morning spent hanging six cameras is still one day. In the off-season none of it costs anything. */
  WT.workCostsDay = () => { const st = S(); return !WT.offseason() && !G.seasonOver && !(st.workedUntil === st.day && st.slot === 'morning'); };
  function workDay(what) {
    const st = S();
    if (!WT.workCostsDay()) return false;
    WT.skip('day'); st.workedUntil = st.day;
    news(`You spent the day ${what}.`, 'info');
    return true;
  }
  WT.removeStand = function (pid, sid) {
    const st = S(), d = st.parcels[pid];
    const s = d.stands.find((z) => z.sid === sid); if (!s) return 'No stand.';
    const kind = WT.standType(s.type).kind;
    void kind; // picking a stand up is free
    d.stands = d.stands.filter((z) => z.sid !== sid);
    st.inv.stands[s.type] = (st.inv.stands[s.type] || 0) + 1;
    workDay('taking down a stand');
    return null;
  };
  // Move a stand you already have up. It costs no money: it costs the day. In the off-season it costs nothing.
  // What you learned about the old spot stays behind.
  WT.moveStand = function (pid, sid, x, y) {
    const st = S(), d = st.parcels[pid], w = G.world, i = tileAt(x, y);
    const s = d.stands.find((z) => z.sid === sid); if (!s) return 'No stand.';
    if (i < 0 || w.parcelOf[i] !== pid) return 'Pick a spot inside your property line.';
    if (!standableTile(w.cover[i])) return "Can't put a stand there.";
    if (d.stands.some((z) => z !== s && Math.abs(z.x - x) + Math.abs(z.y - y) < 3)) return 'Too close to another stand.';
    if (w.cover[i] === T().PLOT || w.cover[i] === T().PLOT_NEW) return 'Stands go on the edge of a food plot, not in it. Pick a tile touching the plot.';
    { const lt = WT.landType(w.cover[i]); if (lt === 'farm') return "That's a crop field. Nothing can go up in it."; if (lt === 'swamp' && !C().land.swampStands.includes(s.type)) return 'Only a ladder stand can go up in the swamp.'; }
    if (d.sanctuary.includes(i)) return "That's inside your sanctuary.";

    const n = makeStand(s.type, x, y, s.name);
    Object.assign(s, { x, y, r: n.r, sits: 0, seen: 0, pressure: 0, sessions: {}, recent: [], noise: n.noise, tree: undefined });
    delete s._traits;
    workDay(`moving ${s.name || 'a stand'}`);
    return null;
  };
  WT.moveCamera = function (pid, cid, x, y) {
    const d = S().parcels[pid], w = G.world, i = tileAt(x, y);
    const c = d.cams.find((z) => z.cid === cid); if (!c) return 'No camera.';
    if (i < 0 || w.parcelOf[i] !== pid || !standableTile(w.cover[i])) return 'Pick a spot inside your property.';
    c.x = x; c.y = y;
    workDay('moving a camera');
    return null;
  };
  // Take out an improvement on this tile and put the ground back the way it was. No refund.
  WT.removeImprovement = function (pid, x, y) {
    const d = S().parcels[pid], w = G.world, i = tileAt(x, y);
    if (d.owner !== 'player') return 'Only on your land.';
    const pl = d.plots.find((q) => q.tiles.includes(i)), tr = d.trees.find((q) => q.tiles.includes(i)), wh = d.waterholes.indexOf(i);
    if (pl) { pl.tiles.forEach((k) => restoreCover(d, k)); d.plots = d.plots.filter((q) => q !== pl); }
    else if (tr) { tr.tiles.forEach((k) => restoreCover(d, k)); d.trees = d.trees.filter((q) => q !== tr); }
    else if (wh >= 0) { restoreCover(d, i); d.waterholes.splice(wh, 1); }
    else return 'Nothing you built is on that spot.';
    WT.computeDerivedLayers(w); refreshStands();
    return null;
  };
  // Everything on (or right at) a spot: things within one tile of each other count as the same setup.
  const NEAR = (a, x, y) => Math.abs(a.x - x) <= 1 && Math.abs(a.y - y) <= 1;
  // A camera covers a stand from the stand's own tile, or from a food plot that the stand touches.
  WT.plotAt = (pid, x, y) => { const w = G.world, i = y * w.W + x; return (S().parcels[pid].plots || []).find((q) => q.tiles.includes(i)) || null; };
  WT.touchesPlot = (plot, a) => plot.tiles.some((i) => Math.abs((i % G.world.W) - a.x) <= 1 && Math.abs(((i / G.world.W) | 0) - a.y) <= 1);
  WT.standForCam = function (pid, cam) {
    const d = S().parcels[pid], list = d.owner === 'public' ? d.spots || [] : d.stands || [];
    const same = list.find((z) => z.x === cam.x && z.y === cam.y); if (same) return same;
    const plot = d.owner === 'player' ? WT.plotAt(pid, cam.x, cam.y) : null;
    return plot ? list.find((z) => WT.touchesPlot(plot, z)) || null : null;
  };
  WT.camsAtStand = (pid, s) => (S().parcels[pid].cams || []).filter((c) => { if (c.x === s.x && c.y === s.y) return true; const plot = S().parcels[pid].owner === 'player' ? WT.plotAt(pid, c.x, c.y) : null; return !!plot && WT.touchesPlot(plot, s); });
  WT.tileInfo = function (pid, x, y) {
    const st = S(), d = st.parcels[pid], w = G.world, i = tileAt(x, y), TT = T();
    const pick = (list) => (list || []).find((a) => a.x === x && a.y === y) || (list || []).find((a) => NEAR(a, x, y));
    const stand = d.owner === 'public' ? pick(d.spots) : pick(d.stands);
    const cam = d.owner === 'player' || d.owner === 'public' ? pick(d.cams) : null;
    const plotOf = (k) => (d.plots || []).find((q) => q.tiles.includes(k));
    let nearPlot = null, nearWater = false;
    for (let dy = -1; dy <= 1 && i >= 0; dy++) for (let dx = -1; dx <= 1; dx++) { // this tile and the 8 touching it
      const k = tileAt(x + dx, y + dy); if (k < 0) continue;
      const c = w.cover[k];
      if (c === TT.PLOT || c === TT.PLOT_NEW) nearPlot = nearPlot && nearPlot.ready ? nearPlot : { ready: c === TT.PLOT, plot: plotOf(k) };
      if (c === TT.POND || c === TT.WATER || c === TT.CREEK) nearWater = true;
    }
    return {
      i, cover: i >= 0 ? WT.COVER[w.cover[i]].name : '', stand, cam,
      plot: plotOf(i), trees: (d.trees || []).find((q) => q.tiles.includes(i)), waterhole: (d.waterholes || []).includes(i),
      sanctuary: (d.sanctuary || []).includes(i), nearPlot, nearWater, buildable: i >= 0 && w.parcelOf[i] === pid && standableTile(w.cover[i]),
    };
  };
  // What touches a tile: the tile itself and its 8 neighbours. This is the whole stacking rule.
  WT.touching = function (pid, x, y) {
    const st = S(), d = st.parcels[pid], w = G.world, TT = T(), out = { stand: null, cams: [], plot: false, newPlot: false, field: false, water: false };
    if (!d) return out;
    const near = (a) => Math.abs(a.x - x) <= 1 && Math.abs(a.y - y) <= 1;
    out.stand = WT.standForCam(pid, { x, y }); // the stand on this tile, or the one touching the plot this tile is part of
    out.cams = (d.cams || []).filter((a) => a.x === x && a.y === y); void near;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const i = tileAt(x + dx, y + dy); if (i < 0) continue;
      const c = w.cover[i];
      if (c === TT.PLOT) out.plot = true; if (c === TT.PLOT_NEW) out.newPlot = true;
      if (WT.landType(c) === 'farm') out.field = true;
      if (WT.isWater(c)) out.water = true;
    }
    return out;
  };
  WT.camLimit = (pid) => (S().parcels[pid].owner === 'public' ? C().publicCamsPerArea : WT.limits(pid).cams);
  // What a camera can really see where it hangs: its own reach, cut down by the cover around it.
  WT.camSight = function (cam) {
    const ct = WT.camType(cam.type), r = WT.spotRatings(G.world, cam.x, cam.y);
    const terrain = Math.round(40 + r.visibility * 260); // thick timber about 40 yards, wide open about 300
    const reach = Math.min(ct.reach, terrain);
    return { reach, clear: Math.min(ct.clear, Math.round(reach * 0.7)), limited: terrain < ct.reach, r };
  };
  // Photos per week over the days you have results for
  WT.camRate = (cam) => { const days = WT.camType(cam.type).cell ? cam.days : cam.daysChecked; return days ? (cam.total || 0) / days * 7 : null; };
  WT.allCameras = function () {
    const out = [];
    for (const p of G.world.parcels) { const d = S().parcels[p.id]; for (const c of d.cams || []) out.push({ pid: p.id, cam: c, parcel: p.name, owner: d.owner, rate: WT.camRate(c) }); }
    return out.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
  };
  WT.placeCamera = function (pid, type, x, y) {
    const st = S(), d = st.parcels[pid], w = G.world, i = tileAt(x, y);
    if (d.owner !== 'player' && d.owner !== 'public') return 'Cameras go on your own land or on public land.';
    if (d.owner === 'public' && d.bowOnly && !WT.hasBow()) return 'This area is bow only. Equip a bow under Gear.';
    if (i < 0 || w.parcelOf[i] !== pid || !standableTile(w.cover[i])) return d.owner === 'public' ? 'Pick a spot inside the public area.' : 'Pick a spot inside your property.';
    if (WT.landType(w.cover[i]) === 'farm') return "That's a crop field. Hang the camera on the edge.";
    if (!st.inv.cameras[type]) return 'Buy a camera at the shop first.';
    const camLim = WT.camLimit(pid);
    if (d.cams.length >= camLim) return `Camera limit reached (${camLim} ${d.owner === 'public' ? 'per public area' : 'for this acreage'}).`;
    if (d.cams.some((c) => c.x === x && c.y === y)) return 'There is already a camera on this spot.';
    st.inv.cameras[type]--;
    d.cams.push({ cid: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), type, x, y, pending: 0, total: 0 });
    workDay('hanging cameras');
    return null;
  };
  WT.removeCamera = function (pid, cid) {
    const st = S(), d = st.parcels[pid];
    const c = d.cams.find((z) => z.cid === cid); if (!c) return 'No camera.';
    d.cams = d.cams.filter((z) => z.cid !== cid);
    st.inv.cameras[c.type] = (st.inv.cameras[c.type] || 0) + 1;
    workDay('pulling cameras');
    return null;
  };
  /* Food plots through the year. A plot is a 2 x 2 site you lay out any time for free; it is bare dirt until it is
     planted. Planting happens once a year, in spring after shed hunting: you pick a crop for each site and pay for it.
     A planted plot feeds deer all season. When the season ends every plot goes back to dirt and has to be replanted. */
  WT.plotSites = function () {
    const out = [];
    for (const p of G.world.parcels) { const d = S().parcels[p.id]; if (d.owner !== 'player') continue; d.plots.forEach((pl, k) => out.push({ pid: p.id, k, parcel: p.name, plot: pl })); }
    return out;
  };
  WT.plantingOpen = () => !!S().plantingOpen;
  // choices: [{ pid, k, type }] (type null = leave it dirt this year)
  // What one plot costs you to plant: the seed price, less what Land Management saves.
  WT.plotCost = (typeId) => Math.round(WT.plotType(typeId).cost * WT.PLOT_ACRES * (1 - (S().skills.habitat || 0) * C().progression.skill.habitat.cost));
  WT.plantPlots = function (choices) {
    const st = S(), w = G.world, TT = T(), rng = G.rng;
    if (!WT.plantingOpen()) return 'Planting is done in spring, after the season ends.';
    const todo = choices.filter((c) => c.type && st.parcels[c.pid] && st.parcels[c.pid].plots[c.k] && !st.parcels[c.pid].plots[c.k].planted);
    { const lock = todo.map((c) => WT.plotType(c.type)).find((t) => (t.level || 1) > st.level); if (lock) return `${lock.name} seed opens at level ${lock.level}.`; }
    const cost = todo.reduce((a, c) => a + WT.plotCost(c.type), 0);
    if (st.cash < cost) return `That comes to ${WT.money(cost)} and you have ${WT.money(st.cash)}.`;
    for (const c of todo) {
      const p = w.parcels[c.pid], pl = st.parcels[c.pid].plots[c.k], pt = WT.plotType(c.type);
      const q = clamp(0.5 + p.habitat.soil * 0.35 + rng.range(-0.25, 0.25) + (st.skills.habitat || 0) * C().progression.skill.habitat.quality); // someone who knows dirt gets a better stand of it
      pl.type = c.type; pl.last = c.type; pl.planted = true; pl.year = st.year;
      pl.quality = q < 0.3 ? 'poor' : q < 0.55 ? 'fair' : q < 0.8 ? 'good' : 'excellent'; pl.q = q * pt.food;
      pl.tiles.forEach((i) => setTile(i, TT.PLOT));
    }
    if (cost) { st.cash -= cost; ledger('Food plots', -cost); }
    WT.computeDerivedLayers(w); refreshStands();
    return null;
  };
  WT.PLOT_ACRES = 1; // every food plot is 2 x 2 tiles: one acre
  WT.plantPlot = function (pid, typeId, x, y) {
    const acres = WT.PLOT_ACRES;
    const st = S(), d = st.parcels[pid], w = G.world, TT = T();
    const pt = typeId ? WT.plotType(typeId) : null;
    if (d.owner !== 'player') return 'Food plots go on your own land.';
    const lim = WT.limits(pid);
    void lim; // no cap: every plot costs you 2 x 2 tiles of prairie
    const side = Math.round(Math.sqrt(acres * 4));
    const tiles = [];
    for (let yy = y; yy < y + side; yy++) for (let xx = x; xx < x + Math.ceil(acres * 4 / side); xx++) {
      const i = tileAt(xx, yy);
      if (i < 0 || w.parcelOf[i] !== pid) return 'The plot runs past your property line. Pick another corner.';
      const c = w.cover[i];
      if (!standableTile(c) || WT.landType(c) !== 'prairie' || c === TT.PLOT || c === TT.PLOT_NEW) return 'Food plots go on prairie: open grass, hay or stubble. Not timber, swamp, crop fields or water.';
      if (d.sanctuary.includes(i)) return "That's inside your sanctuary.";
      if (d.stands.some((z) => z.y * w.W + z.x === i)) return 'A stand is in the way. Stands sit on the edge of a plot, so plant beside it.';
      tiles.push(i);
    }
    void pt;
    tiles.forEach((i) => { rememberCover(d, i); setTile(i, TT.PLOT_NEW); });
    d.plots.push({ type: null, last: typeId || null, acres, tiles, year: st.year, quality: null, planted: false });
    WT.computeDerivedLayers(w); refreshStands();
    return null;
  };
  WT.digWaterhole = function (pid, x, y) {
    const st = S(), d = st.parcels[pid], w = G.world, i = tileAt(x, y), TT = T();
    if (d.owner !== 'player') return 'Only on your land.';
    if (i < 0 || w.parcelOf[i] !== pid || !standableTile(w.cover[i])) return 'Pick a spot inside your property.';
    if (['farm', 'swamp'].includes(WT.landType(w.cover[i]))) return 'Water holes go on prairie or in timber, not in a crop field or the swamp.';
    if (d.waterholes.length >= WT.limits(pid).waterholes) return 'Water hole limit reached.';
    const cost = C().improvements.waterhole.cost;
    if (st.cash < cost) return `A dozer and liner cost ${WT.money(cost)}.`;
    st.cash -= cost; ledger('Land work', -cost); rememberCover(d, i); setTile(i, TT.POND); d.waterholes.push(i);
    WT.computeDerivedLayers(w); refreshStands();
    return null;
  };
  WT.plantTrees = function (pid, x, y, vertical) {
    const st = S(), d = st.parcels[pid], w = G.world, TT = T();
    if (d.owner !== 'player') return 'Only on your land.';
    const cost = C().improvements.trees.cost;
    const tiles = [];
    for (let k = 0; k < 6; k++) {
      const i = vertical ? tileAt(x, y + k) : tileAt(x + k, y);
      if (i < 0 || w.parcelOf[i] !== pid) break;
      const c = w.cover[i];
      if (!standableTile(c) || WT.landType(c) !== 'prairie' || c === TT.PLOT || c === TT.PLOT_NEW) continue;
      tiles.push(i);
    }
    if (tiles.length < 3) return 'Tree rows need open prairie in a row: not crop fields, swamp or existing woods.';
    if (st.cash < cost) return `Seedlings and fabric cost ${WT.money(cost)}.`;
    st.cash -= cost; ledger('Land work', -cost);
    tiles.forEach((i) => { rememberCover(d, i); setTile(i, TT.YOUNGTREES); });
    d.trees.push({ tiles, year: st.year });
    WT.computeDerivedLayers(w); refreshStands();
    return null;
  };
  WT.toggleSanctuary = function (pid, x, y, r = 0) { // r = 0: just this tile; r = 1: this tile and the 8 around it
    const st = S(), d = st.parcels[pid], w = G.world, ok = SANCT_COVER();
    if (d.owner !== 'player') return 'Only on your land.';
    let added = 0, removed = 0, open = 0;
    const inSanct = d.sanctuary.includes(tileAt(x, y));
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const i = tileAt(x + dx, y + dy);
      if (i < 0 || w.parcelOf[i] !== pid) continue;
      const k = d.sanctuary.indexOf(i);
      if (inSanct) { if (k >= 0) { d.sanctuary.splice(k, 1); removed++; } continue; }
      if (d.stands.some((s) => tileAt(s.x, s.y) === i) || d.cams.some((c) => tileAt(c.x, c.y) === i)) continue;
      if (!ok.includes(w.cover[i])) { open++; continue; }
      if (k < 0) { d.sanctuary.push(i); added++; }
    }
    if (!added && !removed) return open ? 'Sanctuary has to be cover: timber, tree rows, brush, slough or CRP grass. Open ground does nothing for deer.' : 'Nothing changed there.';
    return null;
  };

  /* ================================================================ gear math */
  // Which clothing layers show and what they add up to.
  WT.outfitStats = function (clothing, extras) {
    const cfg = C();
    const items = {};
    for (const slot of cfg.clothingSlots) { const id = clothing[slot]; if (id) items[slot] = WT.cloth(id); }
    let warmth = 0;
    for (const slot in items) warmth += Math.min(items[slot].w, cfg.warmthCaps[slot] ?? 99);
    const top = items.jacket || items.mid || items.base;
    const bottom = items.bibs || items.pants;
    const hands = items.muff || items.hands;
    const vis = [items.head, top, bottom, hands].filter(Boolean);
    const avg = (arr, k, dflt = 0) => {
      const xs = arr.filter(Boolean);
      return xs.length ? xs.reduce((a, b) => a + b[k], 0) / Math.max(xs.length, 4) : dflt;
    };
    const conceal = avg(vis, 'cn');
    const quiet = avg([top, bottom, items.feet, hands], 'q');
    const scent = Object.values(items).filter((x) => !x.overlay).reduce((a, b) => a + b.s, 0) / Math.max(4, Object.values(items).filter((x) => !x.overlay).length);
    const windR = avg([items.head, top, bottom, hands], 'wd');
    const waterR = avg([items.head, top, bottom, items.feet], 'wa');
    const cooling = avg([items.head, top, bottom, items.base], 'c', 50);
    const blaze = !!((items.head && items.head.blaze) || items.vest || (items.jacket ? items.jacket.blaze : items.mid && items.mid.blaze));
    const cotton = !!(items.base && items.base.cotton);
    const rubber = items.feet && (items.feet.id === 'bt_rubber' || items.feet.s >= 60);
    let handW = 0, feetW = 0, coreW = 0;
    if (extras) {
      if (extras.handwarm) handW += (items.muff ? 8 : 4);
      if (extras.toewarm) feetW += 4;
      if (extras.bodywarm) coreW += 5;
    }
    return { warmth: warmth + handW + feetW + coreW, conceal, quiet, scent, windR, waterR, cooling, blaze, cotton, rubber, items };
  };

  // Everything about how long and how well you can sit.
  WT.sitPlan = function (setup) {
    const st = S(), cfg = C(), cf = cfg.comfort;
    const w = st.weather;
    const stand = WT.standType(setup.standType);
    const pack = setup.pack || {};
    const extras = { handwarm: pack.handwarm > 0, toewarm: pack.toewarm > 0, bodywarm: pack.bodywarm > 0 };
    const o = WT.outfitStats(setup.clothing, extras);
    const air = WT.sessionTemp(w, setup.session);
    let windPart = Math.min(25, w.wind) * 0.6 * (1 - o.windR / 100) * (stand.windCut ? 0.25 : stand.blind ? 0.6 : 1);
    let wetPart = w.precip ? (w.precip === 'rain' ? 8 : 5) * (1 - o.waterR / 100) * (stand.windCut ? 0.1 : stand.blind ? 0.5 : 1) : 0;
    let warmth = o.warmth;
    if (pack.coffee) warmth += 1.5; if (pack.hamcheese) warmth += 1.5;
    let heater = null, heaterNote = '';
    const heaterId = setup.equip && setup.equip.heater;
    if (heaterId) {
      const h = WT.equip(heaterId);
      if (!stand.blind) heaterNote = 'Heaters only work in ground or box blinds.';
      else if (!(pack.propane > 0)) heaterNote = 'No propane packed.';
      else heater = h;
    }
    const effTemp = air - windPart - wetPart + (heater ? heater.warm * Math.min(1, (pack.propane * heater.hrsPerTank) / 6) : 0);
    const tk = C().progression.skill.toughness, tough = st.skills.toughness || 0;
    const dressedFor = cf.neutralTemp - warmth, comfortable = dressedFor - tough * tk.cold; // a tough hunter is fine a few degrees colder than the clothes say
    const deficit = comfortable - effTemp;
    let hrs = cf.basePatienceHrs + st.skills.patience * cf.hrsPerPatiencePt + stand.patienceHrs;
    for (const id in pack) { const c = WT.consum(id); if (c && pack[id] > 0 && c.sitMin) hrs += (c.sitMin * Math.min(pack[id], 2)) / 60; }
    let cold = 0, hot = 0, sweat = 0;
    if (deficit > 0) { cold = deficit; hrs -= (deficit * cf.minPerDegree) / 60; }
    const over = effTemp - dressedFor - cf.overheatMargin - tough * tk.heat;
    if (over > 0) {
      hot = over;
      let heatHrs = over * 4 / 60 * (1 - o.cooling / 150);
      if (pack.gatorade) heatHrs -= 0.5; if (pack.water) heatHrs -= 0.33;
      hrs -= Math.max(0, heatHrs);
      sweat = clamp(over / 25 * (1 - o.cooling / 120) * (o.cotton ? 1.5 : 1) - (pack.gatorade ? 0.3 : 0));
    }
    hrs = Math.max(cf.minSitMin / 60, hrs);
    const sun = WT.sunTimes(st.day);
    const legalStart = sun.rise - 0.5, legalEnd = sun.set + 0.5;
    const win = setup.session === 'morning' ? [legalStart - 0.25, 11] : setup.session === 'evening' ? [13.5, legalEnd] : [legalStart - 0.25, legalEnd];
    const windowHrs = win[1] - win[0];
    // fidgeting: being cold or hot makes you move
    const fidget = clamp(1 + Math.max(0, cold - 5) / 15 + hot / 20, 1, 3);
    return {
      outfit: o, air: Math.round(air), effTemp: Math.round(effTemp), comfortable: Math.round(comfortable), deficit, maxHrs: hrs,
      windowHrs, win, legalStart, legalEnd, sun, heater, heaterNote, fidget, sweat, cold, hot,
      blazeOk: o.blaze, allDayOk: setup.session !== 'allday' || hrs >= windowHrs - 0.5,
    };
  };

  /* ================================================================ huntable locations */
  // Valid spots: stands on land you own, stands on land you have permission for, and spots you marked on public land.
  WT.huntSpots = function () {
    const st = S(), w = G.world, out = [];
    for (const p of w.parcels) {
      const d = st.parcels[p.id];
      if (d.owner === 'player') d.stands.forEach((s) => out.push({ kind: 'owned', pid: p.id, stand: s }));
      else if (d.owner === 'npc' && d.permBought) d.stands.forEach((s) => out.push({ kind: 'permission', pid: p.id, stand: s }));
      else if (d.owner === 'public') (d.spots || []).forEach((s) => out.push({ kind: 'public', pid: p.id, stand: s }));
    }
    return out;
  };
  WT.publicAreas = () => G.world.parcels.filter((p) => S().parcels[p.id].owner === 'public');
  WT.ownsBow = () => S().inv.rifles.some((id) => WT.isBow(id));
  WT.earlySeason = () => S().day < 0; // Sep 17 to Sep 30: archery only, and nobody else is in the woods yet
  WT.isBow = (id) => !!(WT.rifle(id) || {}).bow;
  // How far a bow is good to in your hands, in yards. The bow sets the ceiling; Archery decides how much of it you get.
  WT.bowRange = function (r) { r = typeof r === 'string' ? WT.rifle(r) : r; const P = C().progression, k = clamp((S().skills.archery || 0) / P.skillMax); return Math.round((r.maxYd || r.range * 3) * (P.bowSkillStart + (1 - P.bowSkillStart) * k)); };
  WT.hasBow = () => WT.isBow(S().loadout.rifle); // a bow in your hands, not just in the closet
  // The mobile stand on your back (saddle, hang-on, climber or pop-up). Public land can't be hunted without one.
  WT.mobileStand = function () { const st = S(), id = st.loadout.mobile; return id && (st.inv.stands[id] || 0) > 0 ? id : null; };
  WT.setMobile = function (id) { const st = S(); if (id && !(st.inv.stands[id] > 0)) return 'You do not own that one.'; st.loadout.mobile = id || null; return null; };
  // How much of the herd one stand can meet. On a huge area a stand only ever deals with the deer around it.
  WT.localShare = (acres) => WT.viewShare(Math.min(acres, 250)) * (0.35 + 0.65 * Math.min(1, 250 / acres));
  WT.SPOT_LIMITS = { perArea: 5, total: 16 };
  WT.spotLimit = (pid) => Math.max(WT.SPOT_LIMITS.perArea, Math.min(12, Math.round(G.world.parcels[pid].acres / 150))); // a big area has room for more spots
  WT.markSpot = function (pid, x, y) {
    const st = S(), d = st.parcels[pid], w = G.world, i = tileAt(x, y);
    if (d.owner !== 'public') return 'Spots are marked on public land. On your own land, put up a stand.';
    if (d.bowOnly && !WT.hasBow()) return 'This area is bow only. Equip a bow under Gear.';
    if (i < 0 || w.parcelOf[i] !== pid || !standableTile(w.cover[i])) return 'Pick a tree or ground spot inside the public area.';
    if (WT.landType(w.cover[i]) === 'farm') return "That's a crop field. Mark the edge of it instead.";
    { const far = tooFar(pid, x, y); if (far) return far; }
    d.spots = d.spots || [];
    const total = WT.publicAreas().reduce((a, p) => a + (st.parcels[p.id].spots || []).length, 0);
    if (d.spots.length >= WT.spotLimit(pid)) return `You can mark ${WT.spotLimit(pid)} spots on this public area. Remove one first.`;
    if (total >= WT.SPOT_LIMITS.total) return `You can mark ${WT.SPOT_LIMITS.total} public spots in total. Remove one first.`;
    if (d.spots.some((s) => Math.abs(s.x - x) + Math.abs(s.y - y) < 3)) return 'Too close to another of your spots.';
    const s = makeStand('ground', x, y, `Spot ${d.spots.length + 1}`);
    s.kind = 'spot';
    s.tree = [T().TIMBER, T().BELT, T().BRUSH, T().YOUNGTREES].includes(w.cover[i]);
    d.spots.push(s);
    return null;
  };
  WT.removeSpot = function (pid, sid) { const d = S().parcels[pid]; d.spots = (d.spots || []).filter((s) => s.sid !== sid); };
  WT.renameStand = function (stand, name) { stand.name = String(name || '').slice(0, 28) || null; };
  // Portable gear you can carry to a public spot (or hang at it)
  WT.mobileOptions = function (spot) {
    const id = WT.mobileStand();
    if (!id) return [];
    if (id !== 'popup' && spot && !spot.tree && WT.landType(G.world.cover[spot.y * G.world.W + spot.x]) !== 'swamp') return [{ id, ok: false, why: 'needs a tree' }];
    return [{ id, ok: true }];
  };
  // Can you hunt this public spot right now? Returns null, or the reason you can't.
  WT.spotBlock = function (pid, spot) {
    const d = S().parcels[pid];
    if (WT.earlySeason() && !WT.hasBow()) return 'Early archery season: bow only until Oct 1. Equip your bow under Gear, or press Wait.';
    if (d.bowOnly && !WT.hasBow()) return 'This area is bow only. Equip a bow under Gear.';
    if (spot.kind !== 'spot') return null;
    if (d.owner === 'public') { const far = tooFar(pid, spot.x, spot.y); if (far) return far; }
    const id = WT.mobileStand();
    if (!id) return 'You need a mobile stand to hunt public land. Buy a hang-on, climber, saddle or pop-up blind at the Shop and equip it under Gear.';
    const lt = WT.landType(G.world.cover[spot.y * G.world.W + spot.x]);
    if (lt === 'swamp' && id === 'popup') return 'No blinds in the swamp. Equip a hang-on, climber or saddle.';
    if (id !== 'popup' && !spot.tree && lt !== 'swamp') return `A ${WT.standType(id).name} needs a tree, and this spot is in the open. Equip a pop-up blind, or mark a spot in the trees.`;
    return null;
  };

  /* ================================================================ detail levels (hunt view spec) */
  // 0 dot, 1 silhouette, 2 basic (antlers yes/no, rack size), 3 clear (rack shape, body build), 4 detailed (points, mass, age cues)
  WT.DETAIL = ['Dot', 'Silhouette', 'Basic', 'Clear', 'Detailed'];
  const BINO_RANGES = { bino_bush: { rack: 200, pts: 75 }, bino_diamond: { rack: 300, pts: 150 }, bino_viper: { rack: 400, pts: 250 }, bino_swaro: { rack: 500, pts: 350 } };
  WT.lightFactor = function (H) {
    const sun = H.plan.sun;
    let f = 1;
    if (H.now < sun.rise + 0.05 || H.now > sun.set - 0.05) f = 0.55; // first and last 30 minutes
    if (H.now < H.plan.legalStart || H.now > H.plan.legalEnd) f = 0.25;
    return f;
  };
  WT.weatherDrop = (st) => (st.weather.precip ? 1 : 0);
  WT.detailLevel = function (H, dist, optic) {
    const st = S();
    dist = dist / (1 + (st.skills.judging || 0) * C().progression.skill.judging.reach); // a practised eye reads a rack from farther off
    const lf = WT.lightFactor(H);
    let lvl;
    if (!optic) {
      const d = dist / (0.6 + 0.4 * lf);
      lvl = d <= 20 ? 4 : d <= 40 ? 3 : d <= 100 ? 2 : d <= 200 ? 1 : 0;
      if (lf < 1) lvl = Math.max(0, lvl - 1);
    } else {
      const r = optic.kind === 'scope' ? { rack: 120 + optic.low * 3, pts: 40 + optic.low * 2.4 } : BINO_RANGES[optic.id];
      const k = lf < 1 ? 0.5 + (optic.low || 0) / 200 : 1;
      const d = dist / k;
      lvl = d <= r.pts ? 4 : d <= r.pts * 1.6 ? 3 : d <= r.rack ? 2 : d <= r.rack * 1.5 ? 1 : 0;
    }
    lvl -= WT.weatherDrop(st);
    return Math.max(0, lvl);
  };
  // pixels per inch your eyes/optics can resolve at a distance (render resolution)
  WT.resolvePpi = function (H, dist, optic) {
    const lf = WT.lightFactor(H);
    let M;
    if (!optic) M = 30 * (0.6 + 0.4 * lf);
    else if (optic.kind === 'scope') M = (150 + optic.low * 6) * (lf < 1 ? 0.5 + optic.low / 200 : 1);
    else M = BINO_RANGES[optic.id].pts * 4 * (lf < 1 ? 0.5 + optic.low / 200 : 1);
    return (M / Math.max(5, dist)) * (S().weather.precip ? 0.7 : 1);
  };


  /* ================================================================ judging a deer by eye (rough reads) */
  // How good your glass is: 0 naked eye, 1-4 binocular tiers, scopes rank by quality.
  WT.opticTier = (optic) => !optic ? 0 : optic.kind === 'scope' ? Math.max(1, Math.min(3, Math.round((optic.low || 10) / 30))) : ({ bino_bush: 1, bino_diamond: 2, bino_viper: 3, bino_swaro: 4 }[optic.id] || 1);
  const PT_NAME = { 1: 'spike', 2: 'spike', 3: 'fork', 4: '4 pointer', 5: '5 pointer', 6: '6 pointer', 7: '7 pointer', 8: '8 pointer', 9: '9 pointer', 10: '10 pointer', 11: '11 pointer', 12: '12 pointer' };
  const ptName = (n) => PT_NAME[n] || `${n} pointer`;
  // A rough, honest read: wider ranges far away or through cheap glass, tighter up close with good glass.
  WT.judgeDeer = function (deer, level, tier) {
    const h = (k) => WT.hash2(deer.id, Math.floor(S().day / 3) * 7 + tier, k); // steady for a few days, not every glance
    const lw = deer.lw || 150;
    const body = lw < 120 ? 'small-bodied' : lw < 180 ? 'medium-bodied' : 'big-bodied';
    if (level <= 0) return { text: 'a deer, too far or too dark to judge yet', level };
    if (level === 1) return { text: `a ${body} deer, too far to see antlers`, level };
    const antlered = deer.sex === 'b' && deer.age >= 1.5;
    const wRange = (spread) => { const mid = lw + (h(5) - 0.5) * spread; return [Math.round((mid - spread / 2) / 5) * 5, Math.round((mid + spread / 2) / 5) * 5]; };
    if (!antlered) {
      if (level === 2) return { text: `no antlers that you can see, ${body}`, level };
      const who = deer.age < 1 ? (deer.sex === 'b' && level >= 4 ? 'button buck (fawn, no real antlers)' : 'fawn') : deer.age >= 3.5 ? 'big mature doe' : 'doe';
      if (level === 3) return { text: `looks like a ${who}`, level };
      const wr = wRange(50 - tier * 6);
      return { text: `${who}, roughly ${wr[0]}-${wr[1]} lb`, level, weight: wr };
    }
    const P = WT.deerPoints(deer), g = deer.gross || 0;
    const size = g < 60 ? 'small' : g < 100 ? 'medium' : 'big';
    if (level === 2) return { text: `has antlers, a ${size} rack`, level };
    const sheet = deer.rack ? WT.unpackRack(deer.rack) : null;
    const extras = [];
    if (sheet && sheet.spread >= 16.5) extras.push('outside the ears');
    else if (sheet && sheet.spread < 13) extras.push('inside the ears');
    const g2 = sheet ? Math.max(sheet.sides[0].tines.G2 || 0, sheet.sides[1].tines.G2 || 0) : 0;
    if (g2 >= 9) extras.push('tall tines');
    if (sheet) {
      // forks and drops are the kind of thing you notice
      const shown = WT.rackPointList(sheet).flatMap((x) => x.abn);
      const splits = [...new Set(shown.filter((a) => a.type === 'split').map((a) => (a.on === 'G1' ? 'brow' : a.on === 'beam' ? 'beam tip' : a.on)))];
      if (splits.length) extras.push(level >= 4 ? 'split ' + splits.join(' and ') : 'a split tine');
      if (shown.some((a) => a.type === 'drop')) extras.push('a drop tine');
    }
    if (deer.nt) extras.push('some junk points');
    if (level === 3) {
      // point range of 2-3 that always includes the truth
      const width = tier >= 3 || (S().skills.judging || 0) >= 20 ? 1 : 2;
      const lo = Math.max(2, P - Math.floor(h(1) * (width + 1)));
      const hi = lo + width;
      const an = (n) => (n === 8 || n === 11 || n === 18 ? 'an' : 'a');
      const txt = lo <= 2 ? `looks like a spike to a small ${hi >= 6 ? '6' : ptName(hi)}` : `looks like ${an(lo)} ${ptName(lo).replace(' pointer', '')} to ${an(hi)} ${ptName(hi)}`;
      return { text: `${txt}${extras.length ? ', ' + extras.join(', ') : ''}`, level, pts: [lo, hi] };
    }
    // detailed: count the points, call it, and give a rough score and weight
    const adj = g < 85 ? 'small' : g < 115 ? 'decent' : g < 135 ? 'good' : g < 155 ? 'big' : 'giant';
    const jk = C().progression.skill.judging, jf = 1 - jk.errorCut * clamp((S().skills.judging || 0) / C().progression.skillMax);
    const err = [22, 16, 12, 9, 6][tier] * jf;
    const mid = g + (h(2) - 0.5) * err * 0.8;
    const sc = [Math.max(10, Math.round((mid - err / 2) / 5) * 5), Math.round((mid + err / 2) / 5) * 5];
    if (sc[1] <= sc[0]) sc[1] = sc[0] + 5;
    const wr = wRange(Math.max(15, (50 - tier * 7) * jf));
    const label = `${adj} ${P <= 2 ? 'spike' : P}${deer.nt ? ' with stickers' : ''}`;
    return { text: `${label}${extras.length ? ' (' + extras.filter((x) => x !== 'some junk points').join(', ') + ')' : ''}. Rough guess ${sc[0]}-${sc[1]}", ${wr[0]}-${wr[1]} lb`, level, label, score: sc, weight: wr, pts: [P, P] };
  };

  /* ================================================================ hit list (screens spec) */
  // Frozen look of a deer at a moment: enough to re-render it exactly as it looked then.
  WT.snapshot = function (deer) {
    return { k: deer.id, sex: deer.sex, age: deer.age, lw: deer.lw, bg: deer.bodyGene, style: deer.style, rack: deer.rack, gross: deer.gross, nt: deer.nt, pL: deer.pL, pR: deer.pR, y: S().year, d: S().day };
  };
  WT.snapDeer = (s) => ({ id: s.k, sex: s.sex, age: s.age, lw: s.lw, bodyGene: s.bg, style: s.style, rack: s.rack });
  function suggestAge(deer, level) {
    const err = level >= 4 ? 0.5 : 1.5;
    const h = WT.hash2(deer.id, S().year, 31) - 0.5;
    return Math.max(0.5, Math.round((deer.age + h * 2 * err) * 2) / 2 - (Math.round((deer.age + h * 2 * err) * 2) % 2 === 0 ? 0.5 : 0));
  }
  WT.hitEntry = (deerId) => S().hitList.find((e) => e.k === deerId);
  // In the stand you know a hit list deer again once you've had a clear look at it (read level 3+).
  WT.knownDeer = (m) => (m && m.read && m.read.level >= 3 ? WT.hitEntry(m.deer.id) || null : null);
  WT.estAgeNow = (e) => e.estAge + (S().year - e.estYear);
  // Record a sighting or photo. Adds bucks seen clearly; does only when asked (force).
  WT.noteDeer = function (deer, info) {
    const st = S();
    let e = WT.hitEntry(deer.id);
    const clear = info.level >= 3;
    const antlered = deer.sex === 'b' && deer.age >= 1.5;
    if (!e) {
      if (!clear || !info.force) return null; // you decide who goes on the list
      e = {
        k: deer.id, name: info.name || null, status: antlered ? 'Watch' : deer.sex === 'd' && deer.age >= 1 ? 'Doe' : 'Watch',
        estAge: suggestAge(deer, info.level), estYear: st.year, notes: '', places: [], log: [], snap: null, photos: [], added: [st.year, st.day],
      };
      st.hitList.unshift(e);
      info.added = true;
      st.cash += C().economy.newDeerCash; ledger('New deer found', C().economy.newDeerCash);
    }
    if (clear) e.snap = WT.snapshot(deer);
    if (info.read && (!e.readLvl || info.level >= e.readLvl || e.readYear !== st.year)) { e.read = info.read; e.readLvl = info.level; e.readYear = st.year; }
    e.last = [st.year, st.day];
    if (!e.places.includes(info.pid)) e.places.push(info.pid);
    e.log.unshift({ y: st.year, d: st.day, t: info.time, where: info.where, dist: info.dist, doing: info.doing, kind: info.kind });
    if (e.log.length > 30) e.log.length = 30;
    if (info.photo) { e.photos.unshift(info.photo); if (e.photos.length > 6) e.photos.length = 6; }
    return e;
  };
  WT.removeHit = (k) => { S().hitList = S().hitList.filter((e) => e.k !== k); };
  WT.lastSeenText = function (e) {
    const st = S();
    if (!e.last) return 'Never';
    const ago = st.year - e.last[0];
    const when = `${WT.dateLabel(e.last[1])}, Year ${e.last[0]}`;
    if (ago === 0) return when;
    return `${when} (${ago === 1 ? 'last season' : ago + ' seasons ago'}). Not seen this season.`;
  };

  /* ================================================================ hunt engine */
  const TICK = 1 / 6; // 10 minutes

  function standRatingFor(r, session, day) {
    const rut = WT.rutPhase(day);
    const rutW = rut.name.startsWith('Seek') || rut.name.startsWith('Peak') ? 0.45 : rut.name === 'Pre-rut' ? 0.25 : 0;
    const base = session === 'morning' ? r.morning : session === 'evening' ? r.evening : (r.morning + r.evening) / 2 + 0.05;
    const late = day > 60 && session !== 'morning' ? r.evening * 0.15 : 0;
    const early = day < 15 ? r.water * 0.15 : 0;
    return clamp(base * (1 - rutW) + r.rut * rutW + late + early);
  }

  /* A stand's numbers never change: a rating (its percentile among every spot on the map, and the best it can
     ever hunt), a consistency, its winds and how far you see. What changes sit to sit is "today": wind, time of
     day, pressure and luck can only pull a sit DOWN from the stand's best, never above it. */
  // The ground as it was before you changed anything: ratings are ranked against it, and your improvements
  // can move a stand's rating by at most 15 points either way.
  function captureNatural(w) { w._nat = { W: w.W, H: w.H, seed: w.seed, cover: w.cover.slice(), travel: w.travel.slice(), distRoad: w.distRoad.slice() }; delete w._peaks; }
  WT.captureNatural = captureNatural;
  const peakOf = (r) => clamp(Math.max(r.morning, r.evening, r.rut) * 0.8 + r.mature * 0.2);
  function spotPercentile(v) {
    const w = G.world;
    if (!w._peaks) {
      const a = [];
      for (let y = 1; y < w.H; y += 3) for (let x = 1; x < w.W; x += 3) a.push(peakOf(WT.spotRatings(w._nat || w, x, y)));
      w._peaks = a.sort((p, q) => p - q);
    }
    let lo = 0, hi = w._peaks.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (w._peaks[mid] < v) lo = mid + 1; else hi = mid; }
    return lo / w._peaks.length;
  }
  const CONSIST = {
    steady: { name: 'Steady', span: 2, swing: 0.1, note: 'hunts near its best most days' },
    average: { name: 'Average', span: 1, swing: 0.25, note: 'needs the right wind' },
    fickle: { name: 'Fickle', span: 0, swing: 0.45, note: 'only at its best on one wind, and not every day' },
  };
  WT.standTraits = function (s) {
    if (s._traits) return s._traits;
    const h = WT.hash2(s.x, s.y, G.world.seed + 77);
    const kind = h < 0.3 ? 'steady' : h < 0.75 ? 'average' : 'fickle';
    const c = CONSIST[kind], D = WT.DIRS, ci = Math.max(0, D.indexOf(s.r.goodWinds[1]));
    const winds = [], near = [];
    for (let k = -c.span; k <= c.span; k++) winds.push(D[(ci + k + 8) % 8]);
    near.push(D[(ci - c.span - 1 + 8) % 8], D[(ci + c.span + 1) % 8]);
    const t = { kind, name: c.name, note: c.note, swing: c.swing, winds, near, rating: (() => { const cur = spotPercentile(peakOf(s.r)), w = G.world, nat = w._nat ? spotPercentile(peakOf(WT.spotRatings(w._nat, s.x, s.y))) : cur; return Math.max(1, Math.min(99, Math.round((nat + Math.max(-0.15, Math.min(0.15, cur - nat))) * 100))); })() };
    Object.defineProperty(s, '_traits', { value: t, enumerable: false, configurable: true }); // not saved
    return t;
  };
  // How good is this sit compared with the stand's best? factor 0..1, stars 1..5 (5 = the stand at its peak).
  WT.sitToday = function (s, session, day, windDir) {
    const st = S(), t = WT.standTraits(s), r = s.r;
    day = day ?? st.day; windDir = windDir || st.weather.windDir;
    const windOk = t.winds.includes(windDir), windNear = t.near.includes(windDir);
    const windF = windOk ? 1 : windNear ? 0.85 : 0.65; // a wrong wind already gets you winded; it shouldn't also empty the woods
    const dayF = 1 - t.swing * WT.hash2(s.x * 31 + day, s.y * 17 + (session === 'evening' ? 1 : 0), G.world.seed + 913);
    const sesF = Math.min(1, standRatingFor(r, session, day) / Math.max(0.05, r.morning, r.evening, r.rut));
    const presF = 1 - Math.min(0.4, (s.pressure || 0) * 0.8);
    const factor = windF * dayF * sesF * presF;
    return { factor, stars: Math.max(1, Math.min(5, Math.floor(factor / 0.18))), windOk, windNear, windF, dayF, sesF, presF };
  };
  // Deer multipliers from the stand's rating and today's stars, and for old bucks from the big-buck rating.
  WT.spotMult = function (s, today) {
    const m = C().sightMult, r = WT.standTraits(s).rating / 100, f = today ? today.factor / Math.max(0.5, today.presF || 1) : 0.6; // pressure is applied per deer, not here too
    return (m.ratingBase + m.ratingGain * Math.pow(r, m.ratingPow)) * (m.starBase + m.starGain * f) / m.norm;
  };
  WT.matureMult = function (s) { const m = C().sightMult; return (m.matureBase + m.matureGain * Math.pow(clamp(s.r.mature), m.maturePow)) * m.matureLift; };
  // How far out deer show from a stand: timber is 10 to 120 yards, open country 150 to 500.
  // The stand's setting in words: where it is and what it touches.
  WT.settingOf = function (x, y) {
    const set = WT.spotSetting(G.world, x, y), cfg = C().land.settings[set.id], t = set.touching, extra = [];
    if (set.id !== 'treeline' && set.own !== 'timber' && t.timber) extra.push('timber');
    if (set.id !== 'fieldEdge' && t.farm) extra.push('a crop field');
    if (set.id !== 'bank' && t.water) extra.push('water');
    if (t.plot) extra.push('a food plot');
    return { id: set.id, name: cfg.name, note: cfg.note, extra, own: set.own };
  };
  WT.standView = function (s, typeId) {
    const sType = WT.standType(typeId || s.type);
    const vis = clamp(s.r.visibility * 0.85 + sType.visibility / 100 * 0.15);
    const open = clamp((vis - 0.22) / 0.72); return { vis, near: Math.round((10 + Math.pow(open, 1.3) * 150) / 5) * 5, far: Math.round((110 + open * 400) / 10) * 10 }; // thick timber: about 10 to 120 yards. Wide open: 150 to 500
  };

  // Public land: other hunters
  /* How people get onto public land. Hunters drive to any road that touches public ground and walk from there, across
     as much public land as they like but never across private. Every tile costs a step, more through timber, swamp
     and water. The result is the cost to reach every public tile (Infinity where no road leads). `extra` adds the
     borders of land YOU can cross (yours, or where you have paid permission) as ways in. Worked out from the map. */
  function walkField(extra) {
    const w = G.world, cfg = C().publicCrowd.access, TT = T(), W = w.W, N = W * w.H;
    const pub = new Uint8Array(w.parcels.length); for (const p of w.parcels) if (p.owner === 'public') pub[p.id] = 1;
    const isRoad = (i) => w.cover[i] === TT.ROAD || w.cover[i] === TT.TOWN;
    const step = (i) => { const c = w.cover[i]; if (WT.isWater(c)) return cfg.water; const lt = WT.landType(c); return lt === 'swamp' ? cfg.swamp : lt === 'timber' ? cfg.timber : 1; };
    const nb = (i) => { const x = i % W, o = []; if (x > 0) o.push(i - 1); if (x < W - 1) o.push(i + 1); if (i >= W) o.push(i - W); if (i + W < N) o.push(i + W); return o; };
    const dist = new Float64Array(N).fill(Infinity), heap = [];
    const push = (d, i) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const pk = (k - 1) >> 1; if (heap[pk][0] <= heap[k][0]) break; [heap[pk], heap[k]] = [heap[k], heap[pk]]; k = pk; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    for (let i = 0; i < N; i++) {
      const p = w.parcelOf[i]; if (p < 0 || !pub[p]) continue;
      if (nb(i).some((k) => isRoad(k) || (extra && w.parcelOf[k] >= 0 && extra.has(w.parcelOf[k])))) { dist[i] = step(i); push(dist[i], i); }
    }
    while (heap.length) {
      const [d, i] = pop(); if (d > dist[i] + 1e-9) continue;
      for (const k of nb(i)) { const p = w.parcelOf[k]; if (p < 0 || !pub[p]) continue; const nd = d + step(k); if (nd < dist[k] - 1e-6) { dist[k] = nd; push(nd, k); } } // the margin matters: equal routes differ by rounding, and without it they requeue each other forever
    }
    return dist;
  }
  const pubWalk = () => G.world._pubWalk || (G.world._pubWalk = walkField(null));
  WT.pubWalk = pubWalk;
  // The same walk for you: the road, or straight across the fence from land you own or have permission on.
  function myWalk() {
    const w = G.world, st = S(), ids = w.parcels.filter((p) => st.parcels[p.id].owner === 'player' || st.parcels[p.id].permBought).map((p) => p.id), key = ids.join(',');
    if (!w._myWalk || w._myWalk.key !== key) w._myWalk = { key, dist: walkField(new Set(ids)) };
    return w._myWalk.dist;
  }
  // One public area, summed up: how much of it is an easy walk, how far its near and far ends are, where its far back is.
  WT.access = function (pid) {
    const w = G.world; w._acc = w._acc || {};
    if (w._acc[pid]) return w._acc[pid];
    const cfg = C().publicCrowd.access, walk = pubWalk(), p0 = w.parcels[pid], land = [];
    let ease = 0, near = Infinity, far = 0;
    for (let y = p0.minY; y <= p0.maxY; y++) for (let x = p0.minX; x <= p0.maxX; x++) {
      const i = y * w.W + x; if (w.parcelOf[i] !== pid || WT.isWater(w.cover[i])) continue;
      const d = walk[i]; land.push([i, d]);
      if (isFinite(d)) { ease += Math.exp(-d / cfg.reach); near = Math.min(near, d); far = Math.max(far, d); }
    }
    land.sort((p, q) => q[1] - p[1]);
    return (w._acc[pid] = { locked: !isFinite(near), ease: land.length ? ease / land.length : 0, near, far, deep: land.slice(0, Math.max(1, Math.round(land.length * cfg.oldBuckHome))).map((p) => p[0]) });
  };
  // Private land that shares a fence with a public area: crossing it is a way in that skips the walk from the road.
  WT.waysIn = function (pid) {
    const w = G.world, st = S(), p0 = w.parcels[pid]; w._adj = w._adj || {};
    if (!w._adj[pid]) {
      const set = new Set();
      for (let y = p0.minY; y <= p0.maxY; y++) for (let x = p0.minX; x <= p0.maxX; x++) {
        const i = y * w.W + x; if (w.parcelOf[i] !== pid) continue;
        for (const k of [x > 0 ? i - 1 : -1, x < w.W - 1 ? i + 1 : -1, i - w.W, i + w.W]) { if (k < 0 || k >= w.cover.length) continue; const q = w.parcelOf[k]; if (q >= 0 && q !== pid && w.parcels[q].owner !== 'public') set.add(q); }
      }
      w._adj[pid] = [...set];
    }
    return w._adj[pid].map((q) => { const d = st.parcels[q]; return { pid: q, name: w.parcels[q].name, yours: d.owner === 'player', paid: !!d.permBought, rents: d.owner === 'npc' && !!d.permission, fee: d.permFee, forSale: (st.forSale || []).includes(q) }; });
  };
  // Can you get in at all?
  WT.canReach = function (pid) {
    const w = G.world, walk = myWalk(), p0 = w.parcels[pid];
    for (let y = p0.minY; y <= p0.maxY; y++) for (let x = p0.minX; x <= p0.maxX; x++) { const i = y * w.W + x; if (w.parcelOf[i] === pid && isFinite(walk[i])) return true; }
    return false;
  };
  /* One spot. pub: how far the public has to walk to it (sets how hunted it is; q is that as 0 at the road .. 1 far back).
     tiles: how far YOU walk, which may be shorter across land of your own (viaLand). walkMin: minutes off your sit. */
  WT.spotDepth = function (pid, x, y) {
    const cfg = C().publicCrowd.access, i = y * G.world.W + x, pub = pubWalk()[i], mine = myWalk()[i];
    const fast = 1 - cfg.hikeFaster * (S().skills.hiking || 0);
    return { pub, tiles: mine, viaLand: mine < pub - 0.5, q: isFinite(pub) ? 1 - Math.exp(-pub / cfg.reach) : 1,
      walkMin: isFinite(mine) ? Math.round(Math.min(cfg.walkMax, mine * cfg.walkMin * fast) / 5) * 5 : 0 };
  };
  // How hunted a public area is. Everything here follows from how easy it is to reach, and from bow-only or not.
  WT.crowd = function (pid) {
    const cfg = C().publicCrowd, d = S().parcels[pid];
    if (d.owner !== 'public') return null;
    const a = WT.access(pid), bow = !!d.bowOnly, b = cfg.bow;
    const lvl = a.locked ? cfg.landlocked : cfg.levels.find((l) => a.ease >= l.min);
    const mid = cfg.natural + Math.min(cfg.maxKill, cfg.killPerEase * a.ease) * (bow ? b.kill : 1);
    return { id: lvl.id, bow, ease: a.ease, name: bow ? 'Bow only, ' + lvl.name.toLowerCase() : lvl.name, note: (bow ? 'bow hunters only, and far fewer of them. ' : '') + lvl.note,
      buckDeaths: [mid - 0.03, mid + 0.03], doeMult: 1 + cfg.doeExtra * clamp(a.ease / cfg.doeFull) * (bow ? b.kill : 1),
      floor: clamp(cfg.floorMin + cfg.floorPerEase * a.ease, cfg.floorMin, cfg.floorMax) * (bow ? b.floor : 1),
      company: Math.min(cfg.companyMax, cfg.companyPerEase2 * a.ease * a.ease) * (bow ? b.company : 1) };
  };
  WT.publicCompetition = function (pid, spot) {
    const st = S(), d = st.parcels[pid];
    if (d.owner !== 'public') return null;
    const weekend = st.day % 7 >= 5;
    const cr = WT.crowd(pid); if (!(cr.company > 0)) return null;
    const deep = spot ? 1 - C().publicCrowd.access.deepCompany * WT.spotDepth(pid, spot.x, spot.y).q : 1; // few people walk that far
    // on a big area what matters is how hunted this exact spot is, not the area's average
    const pc = C().publicCrowd, sd = spot ? WT.spotDepth(pid, spot.x, spot.y) : null, here = sd ? Math.min(pc.companyMax, pc.companyPerEase2 * Math.pow(1 - sd.q, 2)) * (cr.bow ? pc.bow.company : 1) : cr.company;
    const p = here + (here > 0.01 ? (weekend ? 0.15 : 0) + (/Seek|Peak/.test(WT.rutPhase(st.day).name) ? 0.1 : 0) : 0) * (sd ? 1 - sd.q : 1);
    const h = WT.hash2(pid, st.year * 1000 + st.day * 2 + (st.slot === 'evening' ? 1 : 0), 17);
    return h < p ? 'Another truck is already parked at the access. Someone is hunting near your spot.' : null;
  };

  WT.startHunt = function (setup) {
    const st = S(), w = G.world, rng = G.rng, cfg = C();
    const d = st.parcels[setup.pid], parcel = w.parcels[setup.pid];
    const stand = setup.stand;
    const standTypeId = setup.carry || stand.type;
    const sType = WT.standType(standTypeId);
    const plan = WT.sitPlan({ session: setup.session, standType: standTypeId, clothing: setup.clothing, equip: setup.equip, pack: setup.pack });
    const rifle = WT.rifle(setup.rifle);
    const scope = WT.scope(st.inv.rifleScope[setup.rifle] || 'simmons');
    const eq = {};
    for (const cat in setup.equip || {}) if (setup.equip[cat]) eq[cat] = WT.equip(setup.equip[cat]);
    const used = {};
    for (const id in setup.pack || {}) {
      const n = setup.pack[id]; if (!n) continue;
      if (id === 'propane') { const need = plan.heater ? Math.min(n, Math.ceil(Math.min(plan.maxHrs, plan.windowHrs) / plan.heater.hrsPerTank)) : 0; st.inv.propane -= need; used.propane = need; continue; }
      const have = st.inv.consum[id] || 0;
      st.inv.consum[id] = Math.max(0, have - n); used[id] = Math.min(n, have);
    }
    let hasLight = !!eq.light && st.inv.lightCharge > 0;
    if (eq.light && st.inv.lightCharge <= 0 && (st.inv.consum.batteries || 0) > 0) { st.inv.consum.batteries--; st.inv.lightCharge = eq.light.life; hasLight = true; used.batteries = 1; }
    if (hasLight) st.inv.lightCharge--;

    let start = plan.win[0];
    // A far public spot costs you the walk: you get on stand that much later, and it comes out of how long you can stay.
    const depth = d.owner === 'public' && stand.kind === 'spot' ? WT.spotDepth(setup.pid, stand.x, stand.y) : null;
    const walkHrs = depth ? depth.walkMin / 60 : 0, sitHrs = Math.max(0.75, plan.maxHrs - walkHrs);
    const end = plan.win[1];
    const log = [];
    if (!hasLight && setup.session !== 'evening') start = plan.legalStart + 0.4;
    if (setup.session !== 'evening') start += walkHrs;
    // evening hunters time their walk-in so they're on stand for the last light
    if (setup.session === 'evening') start = Math.max(start + walkHrs, Math.min(end, plan.sun.set) - sitHrs + 0.25);
    const endEarly = !hasLight && setup.session !== 'morning' ? plan.sun.set : end; // no light: walk out before dark
    const sitEnd = Math.min(endEarly, start + sitHrs);
    const today = WT.sitToday(stand, setup.session, st.day);
    const rating = standRatingFor(stand.r, setup.session, st.day) * today.dayF;
    const goodWind = today.windOk;
    const rut = WT.rutPhase(st.day);

    const ozon = eq.scentdevice ? eq.scentdevice.scentCut : 0;
    let scentCtl = plan.outfit.scent / 100 * 0.45 + st.skills.scent * 0.012 + sType.scent / 100 * 0.2 + (plan.outfit.rubber ? 0.08 : 0);
    if (used.scentkiller) scentCtl += 0.25; if (used.coverscent) scentCtl += 0.1;
    scentCtl = clamp(scentCtl + ozon * 0.6 - plan.sweat * 0.35, 0, 0.92);
    const conceal = clamp(plan.outfit.conceal / 100 * 0.5 + sType.cover / 100 * 0.45 + 0.05);
    const quiet = clamp(plan.outfit.quiet / 100 * 0.5 + st.skills.stealth * 0.01 + sType.noise / 100 * 0.25);

    const prop = makeProp(setup.pid);
    let walkNoise = (1 - quiet) * 0.5 + stand.r.accessImpact * 0.35 + (!hasLight && setup.session !== 'evening' ? 0.15 : 0) - st.skills.stealth * 0.006;
    if (eq.light && !eq.light.red && setup.session !== 'evening') walkNoise += 0.05;
    walkNoise = clamp(walkNoise, 0.02, 0.9);
    const competition = setup.competition ? 0.12 : 0;
    const pPerSit = cfg.deer.pressure.perSit * (goodWind ? 1 : 1.25) * (0.6 + walkNoise) + competition;
    const pressureCtx = clamp((d.pressure || 0) * 0.4 + (stand.pressure || 0) * 0.45 + competition);
    // how far you can see from here: timber stands see 60 yd, a field-edge box blind 500
    const view = WT.standView(stand, standTypeId);
    const maxView = view.far, minView = view.near;

    const ctx = {
      pressure: pressureCtx, rut, weather: WT.cropEffect(setup.pid).f * WT.warmWater(stand) * WT.plotPull(setup.pid, stand.x, stand.y).f * st.weather.move * (used.tinks && /Seek|Peak|Pre/.test(rut.name) ? 1.15 : 1),
      // early archery: deer haven't been hunted yet
      tod: (setup.session === 'allday' ? 1.15 : 1) * (st.day < 0 ? 1.2 : 1),
      place: 0.5, matureRating: 0.5, // neutral: the stand's worth comes through the two multipliers below
      spotMult: WT.spotMult(stand, today), matureMult: WT.matureMult(stand) * (depth ? C().publicCrowd.access.deepMature[0] + (C().publicCrowd.access.deepMature[1] - C().publicCrowd.access.deepMature[0]) * depth.q : 1),
      hours: plan.windowHrs, viewShare: WT.localShare(parcel.acres) * (0.6 + sType.visibility / 100 * 0.5) * (0.92 + stand.r.visibility * 0.2),
    };
    const herd = d.herd;
    const sched = [];
    const byMom = {};
    herd.forEach((deer) => { if (deer.mom) (byMom[deer.mom] = byMom[deer.mom] || []).push(deer); });
    const pickTime = (deer) => {
      const r = rng.next();
      // deer keep their own schedule: if you arrive late or leave early, you miss them
      if (setup.session === 'morning') return plan.legalStart - 0.1 + Math.pow(r, 1.6) * (end - plan.legalStart + 0.1);
      if (setup.session === 'evening') return end - Math.pow(r, 1.7) * (end - plan.win[0]);
      const midday = /Seek|Peak/.test(rut.name) && deer.sex === 'b' ? 0.35 : 0.12;
      if (rng.chance(midday)) return 10.5 + rng.range(0, 3.5);
      return rng.chance(0.5) ? plan.legalStart + Math.pow(rng.next(), 1.6) * 3 : plan.legalEnd - Math.pow(rng.next(), 1.6) * 3;
    };
    const S2 = cfg.deer.sighting, out = new Set(), rutOn = /Seek|Peak/.test(rut.name);
    const signHere = WT.signTouching(setup.pid, stand.x, stand.y); // whose scrapes, beds and rubs this stand sits on
    const hasMom = (deer) => deer.mom && herd.some((m) => m.id === deer.mom);
    for (const deer of herd) {
      if (hasMom(deer) || out.has(deer.id)) continue; // fawns follow mom
      if (!rng.chance(Math.min(0.97, WT.sightingChance(deer, ctx) * WT.homeFactor(setup.pid, deer, stand.x, stand.y, rutOn) * WT.signBoost(signHere, deer, 'stand', rutOn)))) continue;
      const members = [deer, ...(byMom[deer.id] || []).filter(() => rng.chance(0.85))];
      // does often travel together: a second doe and her fawns may come along
      if (deer.sex === 'd' && deer.age >= 1 && rng.chance(S2.doeGroup || 0)) {
        const pal = herd.find((x) => x.sex === 'd' && x.age >= 1 && x !== deer && !out.has(x.id) && !hasMom(x));
        if (pal) members.push(pal, ...(byMom[pal.id] || []).filter(() => rng.chance(0.85)));
      }
      members.forEach((m) => out.add(m.id));
      sched.push({ t: pickTime(deer), members });
    }
    // a fawn whose mother stayed hidden can still wander out by itself
    for (const deer of herd) {
      if (!hasMom(deer) || out.has(deer.id)) continue;
      if (rng.chance(WT.sightingChance(deer, ctx) * (S2.fawnAlone || 0) * WT.homeFactor(setup.pid, deer, stand.x, stand.y, rutOn))) { out.add(deer.id); sched.push({ t: pickTime(deer), members: [deer] }); }
    }
    // rut: a buck sometimes trails a doe group
    if (/Seek|Peak/.test(rut.name)) for (const sg of sched) if (sg.members[0].sex === 'd' && rng.chance(0.25)) {
      const b = herd.find((x) => x.sex === 'b' && x.age >= 1.5 && !sched.some((q) => q.members.includes(x)) && rng.chance(0.3 * x.tOP));
      if (b) sg.members.push(b);
    }
    // the neighbours' deer: they wander through too, most often the ones that live near your fence
    const visitorOf = new Map();
    {
      const V = cfg.visitors;
      for (const nb of parcel.neighbors) {
        const nd = st.parcels[nb]; if (!nd || !nd.herd) continue;
        const nbMom = {}; nd.herd.forEach((x) => { if (x.mom) (nbMom[x.mom] = nbMom[x.mom] || []).push(x); });
        for (const deer of nd.herd) {
          if (deer.mom && nd.herd.some((q) => q.id === deer.mom)) continue; // fawns come with their mother
          const antlered = deer.sex === 'b' && deer.age >= 1.5;
          const h = WT.deerHome(nb, deer), dist = Math.hypot(h.x - stand.x, h.y - stand.y);
          const reach = (antlered ? V.buckReach : V.doeReach) * (antlered && rutOn ? V.rutReach : 1);
          const vf = (antlered ? V.buckShare : V.doeShare) * Math.exp(-Math.pow(dist / reach, 2));
          if (vf < 0.01 || !rng.chance(Math.min(0.97, WT.sightingChance(deer, ctx) * vf * WT.signBoost(signHere, deer, 'stand', rutOn)))) continue;
          const members = [deer, ...(nbMom[deer.id] || []).filter(() => rng.chance(0.85))];
          members.forEach((x) => visitorOf.set(x.id, nb));
          sched.push({ t: pickTime(deer), members });
        }
      }
    }
    // walking in can bump deer, but only ones that were already close (due within the hour)
    const nearby = sched.filter((g) => g.t < start + 1);
    if (nearby.length && rng.chance(walkNoise * 0.45)) {
      sched.splice(sched.indexOf(rng.pick(nearby)), 1);
      log.push({ t: start, kind: 'bad', text: 'Walking in you hear a snort and crashing brush. Something was bedded close and blew out ahead of you.' });
    } else if (walkNoise > 0.45) log.push({ t: start, kind: 'warn', text: 'Your walk in was noisy. Leaves crunched with every step.' });
    for (const sg of sched) if (sg.t < start) sg.done = true; // came through before you got there
    sched.sort((a, b) => a.t - b.t);
    // how close deer tend to come: earned with placement, wind, concealment, quiet and scent control
    const closeF = clamp(0.2 + rating * 0.35 + (goodWind ? 0.15 : -0.1) + conceal * 0.12 + quiet * 0.08 + scentCtl * 0.1);

    const H = {
      setup, plan, rifle, scope, eq, used, prop, parcel, stand, sType, rating, goodWind, rut, maxView, minView, today, closeF, signHere,
      start, end, sitEnd, now: start, sched, log, visible: [], seenIds: new Set(), unknown: 0, calls: 0,
      scentCtl, conceal, quiet, walkNoise, pPerSit, ctx, hasLight, over: false, endReason: null,
      visitorOf, rounds: rifle.mag, harvested: [], wounded: [], shots: 0, misses: 0, xp: 0, groupSeq: 1, selected: null, ranged: {},
      cover: w.cover[stand.y * w.W + stand.x], addedToList: [],
    };
    const where = d.owner === 'public' ? ' (public land)' : d.owner === 'npc' ? ` (${parcel.ownerName}'s land)` : '';
    const sName = stand.name || WT.standType(standTypeId).name.toLowerCase();
    log.unshift({ t: start, kind: 'head', text: `${WT.fmtTime(start)}. You ${hasLight || setup.session === 'evening' ? 'head in' : 'stumble in without a light'} to ${stand.kind === 'spot' ? 'your marked spot' : 'the'} ${sName} on ${parcel.name}${where}.` });
    log.push({ t: start, kind: 'info', text: `${WT.weatherLine(st.weather)}. It feels like ${plan.effTemp}°F. ${goodWind ? 'The wind feels right for this spot.' : 'The wind is wrong for this spot. Anything downwind will smell you.'}` });
    if (setup.competition) log.push({ t: start, kind: 'warn', text: 'You can hear another hunter walking in somewhere off to the east.' });
    if (plan.deficit > 0) log.push({ t: start, kind: 'warn', text: `You're dressed for about ${plan.comfortable}°F. You'll get cold after ${fmtDur(plan.maxHrs)}.` });
    if (plan.hot > 0) log.push({ t: start, kind: 'warn', text: 'You were sweating on the walk in. Your scent is going to carry.' });
    st.plantingOpen = false; st.scouted = []; // the season has started: what's planted is planted, scouting is over
    G.hunt = H;
    st.stats.hunts++;
    st.seasonLog.hunts++;
    return H;
  };

  function fmtDur(h) { const t = Math.round(h * 60), hh = Math.floor(t / 60), mm = t % 60; return hh ? `${hh} hr${mm ? ' ' + mm + ' min' : ''}` : `${mm} min`; }
  WT.fmtDur = fmtDur;

  const FLAVOR = [
    'A fox squirrel cuts loose in the oaks behind you.', 'A rooster pheasant cackles out in the CRP.', 'Geese work low over the field, talking the whole way.',
    'A hen turkey putts somewhere off in the timber.', 'Wind rattles the dry corn leaves.', 'A coyote yips way off to the north.',
    'A chickadee lands on your barrel and looks at you.', 'Somewhere a tractor fires up.', 'A pickup rattles by on the gravel road.',
    'Blue jays scream at something in the shelterbelt.', 'Sharp-tailed grouse flush off the hill.', 'A great horned owl hoots twice.',
    'You catch movement. Just a rabbit.', 'The cattails hiss in the wind.', 'A distant rifle shot rolls across the prairie.',
  ];
  const NUM = ['', 'A deer', 'Two deer', 'Three deer', 'Four deer', 'Five deer', 'Six deer'];
  const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const FROM = { 3: 'the timber', 4: 'the shelterbelt', 5: 'the plum thicket', 6: 'the CRP', 2: 'the cattails', 9: 'the standing corn', 10: 'the beans', 7: 'the hay', 16: 'the food plot', 11: 'the stubble' };

  // Position of a deer group along its path through the view (x: -1 left .. 1 right; dist in yards)
  function pathPos(g, p) {
    const x = g.x0 + (g.x1 - g.x0) * p;
    const edge = p < 0.5 ? g.d0 : g.d1;
    const dist = g.dmin + (edge - g.dmin) * Math.pow(2 * p - 1, 2);
    return { x, dist: Math.max(8, Math.round(dist)) };
  }
  WT.groupPos = pathPos;

  // deer in a group stand apart, more yards apart the farther out they are
  function spreadMembers(g) { for (const m of g.members) m.dd = Math.round((m.df || 0) * g.dist); }

  function spawnGroup(H, sg) {
    const rng = G.rng;
    const fromCall = !!sg.fromCall;
    const mature = sg.members.some((m) => m.sex === 'b' && m.age >= 3.5);
    // a buck whose scrape, rub or bed your stand touches is coming to that exact spot: he passes close
    const sgn = H.signHere && sg.members.map((m) => H.signHere.get(m.id)).find(Boolean);
    const close = clamp(H.closeF + (fromCall ? 0.25 : 0) - (mature ? 0.12 : 0) + (sgn ? (sgn.scrape ? 0.4 : 0.22) : 0) + rng.range(-0.25, 0.25));
    // deer show somewhere between the stand's near and far range and work in toward the near end
    const span = H.maxView - H.minView;
    const d0 = Math.round(H.minView + span * rng.range(0.55, 1));
    const d1 = Math.round(H.minView + span * rng.range(0.45, 1));
    const dmin = Math.max(8, Math.round(H.minView + (Math.min(d0, d1) - H.minView) * (1 - close) * rng.range(0.1, 1)));
    const left = rng.chance(0.5);
    const feeding = !mature && rng.chance(H.cover === T().PLOT || COVER_FOOD(H) ? 0.55 : 0.3);
    const quick = rng.chance(mature ? 0.4 : 0.2);
    const g = {
      gid: H.groupSeq++, members: sg.members.map((deer, k) => ({ deer, dx: (k ? rng.range(-0.3, 0.3) : 0), df: (k ? rng.range(-0.1, 0.22) : 0), dd: 0, lag: k * 0.06 })),
      x0: left ? -0.95 : 0.95, x1: (left ? 1 : -1) * rng.range(0.5, 1.1), d0, d1, dmin, p: 0,
      stay: quick ? rng.int(2, 3) : feeding ? rng.int(5, 10) : rng.int(3, 6), feeding, alert: 0, gone: false, fromCall,
      offersShot: rng.chance(clamp((mature ? 0.32 : 0.55) + H.sType.accuracy / 400 + (fromCall ? 0.15 : 0))), clear: false, pose: 'walk', step: 0,
    };
    g.lead = g.members[0].deer;
    const p0 = pathPos(g, 0); g.dist = p0.dist; g.x = p0.x;
    spreadMembers(g);
    H.visible.push(g);
    const n = g.members.length;
    const fromWhere = FROM[H.cover] || rng.pick(['the timber', 'the cattails', 'the shelterbelt', 'the CRP']);
    const side = left ? 'left' : 'right';
    H.log.push({ t: H.now, kind: 'deer', gid: g.gid, text: fromCall ? `Something is coming to the call from your ${side}!` : `${NUM[Math.min(n, 6)] || 'Several deer'} ${n > 1 ? 'step' : 'steps'} out of ${fromWhere} on your ${side}.` });
    observe(H, g);
    return g;
  }
  const COVER_FOOD = (H) => [T().CORN, T().SOY, T().WHEAT, T().SUNFLOWER, T().HAY, T().PLOT].includes(H.cover);

  // Look at a group with the naked eye (or the optic you're holding). Adds clear bucks to the hit list.
  function observe(H, g, optic) {
    const st = S();
    for (const m of g.members) {
      const dist = Math.max(5, g.dist + m.dd);
      const lvl = WT.detailLevel(H, dist, optic);
      m.level = Math.max(m.level || 0, lvl);
      const tier = WT.opticTier(optic);
      if (!m.read || lvl > m.read.level || (lvl === m.read.level && tier > (m.readTier || 0))) { m.read = WT.judgeDeer(m.deer, lvl, tier); m.readTier = tier; }
      const first = !H.seenIds.has(m.deer.id);
      if (first) { H.seenIds.add(m.deer.id); H.xp += C().progression.xpPerSighting; }
      if (lvl >= 3) {
        const where = (H.stand.name || WT.standType(H.stand.type).name) + ', ' + H.parcel.name;
        if (m.deer.sex === 'b' && m.deer.age >= 1.5 && m.read) { const L = slog(), b0 = L.bucks[m.deer.id]; if (!b0 || lvl >= b0.lvl) L.bucks[m.deer.id] = { t: m.read.text, lvl, g: m.deer.gross || 0, where, d: st.day }; }
        const doing = g.feeding ? 'feeding' : g.alert ? 'alert' : 'walking';
        const already = WT.hitEntry(m.deer.id);
        if (!already || !m.logged || (already && m.read && (already.readLvl || 0) < lvl)) {
          const e = WT.noteDeer(m.deer, { level: lvl, pid: H.setup.pid, time: H.now, where, dist: H.ranged[g.gid] ? dist : null, doing, kind: 'sighting', read: m.read && m.read.text });
          if (e) { m.logged = true; if (!already) { H.addedToList.push(e); H.log.push({ t: H.now, kind: 'good', text: `You got a clear look. New deer on your hit list. +${WT.money(C().economy.newDeerCash)}` }); } }
        }
      }
    }
    void st;
  }
  WT.observe = observe;

  function detectCheck(H, g) {
    const rng = G.rng;
    const lead = g.members.reduce((a, b) => (b.deer.w > a.deer.w ? b : a)).deer;
    const wary = (0.6 + lead.w) * (lead.age >= 3.5 ? 1.35 : 1) * g.members.length ** 0.3;
    const close = g.dist < 25 ? 2.6 : g.dist < 60 ? 1.8 : g.dist < 120 ? 1.1 : 0.5;
    const scent = (H.goodWind ? 0.02 : 0.18) * (1 - H.scentCtl) * (g.dist < 150 ? 1 : 0.4);
    const sight = 0.04 * (1 - H.conceal) * H.plan.fidget * close * (H.raised ? 2.2 : 1);
    const sound = 0.02 * (1 - H.quiet) * close * (H.used.snickers && rng.chance(0.3) ? 3 : 1);
    const p = clamp((scent + sight + sound) * wary, 0, 0.8);
    if (!rng.chance(p)) return null;
    g.alert++;
    return scent > sight && scent > sound ? 'scent' : sight > sound ? 'sight' : 'sound';
  }

  function moveGroups(H) {
    const rng = G.rng;
    for (const g of H.visible) {
      if (g.gone) continue;
      g.p = Math.min(1, g.p + 1 / g.stay);
      const pos = pathPos(g, g.p);
      g.x = pos.x; g.dist = pos.dist;
      spreadMembers(g);
      g.step = (g.step + 0.5) % 1;
      g.pose = g.alert ? 'alert' : g.feeding && rng.chance(0.6) ? 'down' : rng.chance(0.2) ? 'up' : 'walk';
      g.clear = g.offersShot ? rng.chance(g.pose === 'walk' ? 0.55 : 0.8) : rng.chance(0.15);
      if (g.p >= 1) {
        g.gone = true;
        H.log.push({ t: H.now, kind: 'info', gid: g.gid, text: `${g.members.length > 1 ? 'They drift' : 'It drifts'} off ${rng.pick(['into the timber', 'over the hill', 'into the cattails', 'down the shelterbelt', 'across the field', 'into the CRP'])}.` });
        continue;
      }
      observe(H, g);
      const why = detectCheck(H, g);
      if (why) {
        if (g.alert >= 2 || why === 'scent') {
          g.gone = true; g.busted = true; slog().busted++;
          H.prop.huntingPressure = clamp(H.prop.huntingPressure + 0.015);
          H.stand.pressure = clamp((H.stand.pressure || 0) + 0.03);
          const txt = why === 'scent' ? 'A loud snort. One of them winded you. White flags bound away.' : why === 'sight' ? 'One catches your movement. Stomp, stomp, snort, and gone.' : 'A head snaps up at the sound. Then they are gone.';
          H.log.push({ t: H.now, kind: 'bad', gid: g.gid, text: txt });
          for (const sg of H.sched) if (sg.t < H.now + 0.75 && rng.chance(0.4)) sg.cancel = true;
        } else {
          g.pose = 'alert';
          H.log.push({ t: H.now, kind: 'warn', gid: g.gid, text: 'One of them snaps its head up and stares your way. Freeze.' });
        }
      }
    }
    H.visible = H.visible.filter((g) => !g.gone);
    if (H.selected && !H.visible.some((g) => g.members.some((m) => m.deer.id === H.selected))) H.selected = null;
  }

  // Advance the clock one tick. Returns true if something worth pausing for happened.
  WT.tick = function () {
    const H = G.hunt; if (!H || H.over) return false;
    const rng = G.rng;
    const before = H.log.length;
    H.raised = false;
    H.now += TICK;
    moveGroups(H); // deer already in view move first, so new arrivals get at least one look
    for (const sg of H.sched) {
      if (sg.done || sg.cancel || sg.t > H.now) continue;
      sg.done = true;
      spawnGroup(H, sg);
    }
    if (!H.visible.length && rng.chance(0.07)) H.log.push({ t: H.now, kind: 'flavor', text: rng.pick(FLAVOR) });
    const sun = H.plan.sun;
    if (H.now - TICK < H.plan.legalStart && H.now >= H.plan.legalStart) H.log.push({ t: H.now, kind: 'info', text: 'Legal shooting light.' });
    if (H.now - TICK < sun.rise && H.now >= sun.rise) H.log.push({ t: H.now, kind: 'flavor', text: 'Sunrise. Frost glitters on the stubble.' });
    if (H.now - TICK < sun.set && H.now >= sun.set) H.log.push({ t: H.now, kind: 'flavor', text: 'The sun drops below the horizon. Prime time.' });
    if (H.now - TICK < H.plan.legalEnd && H.now >= H.plan.legalEnd) H.log.push({ t: H.now, kind: 'info', text: 'End of legal shooting light.' });
    if (H.now >= H.sitEnd && H.sitEnd < H.end) { WT.endHunt(H.plan.deficit > 0 ? 'cold' : !H.hasLight && H.sitEnd >= H.plan.sun.set - 0.01 ? 'nolight' : 'patience'); return true; }
    if (H.now >= H.end) { WT.endHunt(H.setup.session === 'morning' ? 'late' : 'dark'); return true; }
    return H.log.length > before && H.log.slice(before).some((l) => l.kind !== 'flavor' && l.kind !== 'info') || H.visible.length > 0;
  };

  WT.huntLegal = (H) => H.now >= H.plan.legalStart && H.now <= H.plan.legalEnd;
  WT.findTarget = function (H, deerId) {
    for (const g of H.visible) for (const m of g.members) if (m.deer.id === deerId) return { g, m };
    return null;
  };

  // What's stopping you from shooting the selected deer? (never reveals what the deer is)
  WT.shotCheck = function (H, deerId) {
    const st = S();
    const t = WT.findTarget(H, deerId);
    if (!t) return { ok: false, reason: 'Tap a deer in the view to pick your target.' };
    if (!WT.huntLegal(H)) return { ok: false, reason: 'Not legal shooting light.' };
    if (st.tags.buck < 1 && st.tags.doe < 1) return { ok: false, reason: 'You have no unfilled tags.' };
    if (H.rounds <= 0) return { ok: false, reason: H.rifle.bow ? 'Out of arrows.' : 'Out of rounds.' };
    if (H.rifle.bow && Math.max(5, t.g.dist + t.m.dd) > WT.bowRange(H.rifle) + 12) return { ok: false, reason: `Too far for you with a bow. Wait until it's inside about ${WT.bowRange(H.rifle)} yards. More Archery skill stretches that.` };
    return { ok: true, clear: t.g.clear };
  };

  // Buck fever: accuracy lost on a big rack. Bigger rack, more shake; Composure takes it back.
  WT.buckFever = function (deer) {
    const k = C().progression.skill.composure, s = deer.sex === 'b' ? deer.gross || 0 : 0, row = k.fever.find((r) => s >= r[0]);
    return row ? Math.max(0, row[1] - (S().skills.composure || 0) * k.perPoint) : 0;
  };
  WT.nerves = () => ({ alert: Math.max(0, 1 - (S().skills.composure || 0) / C().progression.skill.composure.alertFull) });
  function hitChance(H, g, m) {
    const st = S();
    const r = H.rifle, sc = H.scope;
    const dist = Math.max(5, g.dist + m.dd);
    const effRange = r.bow ? WT.bowRange(r) : r.range * 3;
    if (r.bow) { // an arrow: deadly close, fading as it nears your range (which Archery sets), hopeless past it
      const ar = st.skills.archery || 0, close = effRange * 0.4;
      let a = r.acc + ar * 0.7 + H.sType.accuracy * 0.18 + 18;
      if (dist > close) a -= (Math.min(dist, effRange) - close) * 30 / (effRange - close);
      if (dist > effRange) a -= (dist - effRange) * 2.5;
      if (WT.lightFactor(H) < 1) a -= 10;
      if (!g.clear) a -= 30;
      if (g.pose === 'walk') a -= 12;
      if (g.alert) a -= 12 * WT.nerves().alert; // a wound-up deer jumps the string
      a -= WT.buckFever(m.deer);
      return clamp(a / 100, 0.02, 0.96);
    }
    let acc = r.acc * 0.55 + sc.acc + st.skills.shooting * 0.8 + H.sType.accuracy * 0.18 + 25;
    acc -= r.recoil * 0.15 * (1 - st.skills.shooting / 60);
    if (dist > effRange) acc -= (dist - effRange) * 0.45;
    if (dist > 150) acc -= H.ranged[g.gid] ? 0 : (dist - 150) * 0.08;
    if (WT.lightFactor(H) < 1) acc -= 18 * (1 - sc.low / 100);
    if (!g.clear) acc -= 35;
    if (g.pose === 'walk') acc -= 8;
    if (H.plan.cold > 8) acc -= Math.min(15, (H.plan.cold - 8) * 0.8) * clamp((H.now - H.start) / Math.max(0.5, H.plan.maxHrs));
    acc -= WT.buckFever(m.deer); // buck fever: a head game, so it is Composure that beats it, not Marksmanship
    if (g.alert) acc -= 5 * WT.nerves().alert;
    // close deer are hard to miss with a rifle: full bonus inside 40 yards, fading out by 100
    acc += dist <= 40 ? 40 : dist < 100 ? 40 * (100 - dist) / 60 : 0;
    const floor = dist <= 40 ? (g.clear ? 0.95 : 0.7) : 0.05;
    return clamp(acc / 100, floor, 0.98);
  }

  WT._hit = hitChance;
  WT.shoot = function (deerId) {
    const H = G.hunt, st = S(), rng = G.rng, cfg = C();
    const chk = WT.shotCheck(H, deerId);
    if (!chk.ok) { H.log.push({ t: H.now, kind: 'warn', text: chk.reason }); return; }
    const { g, m } = WT.findTarget(H, deerId);
    const deer = m.deer;
    const dist = Math.max(5, g.dist + m.dd);
    H.rounds--; H.shots++; st.stats.shots++;
    const p = hitChance(H, g, m);
    const r = H.rifle;
    H.log.push({ t: H.now, kind: 'shot', text: r.bow ? `Thwack. The ${r.name} sends an arrow${g.clear ? '' : ' through the brush'}.` : `BOOM. The ${r.name} (${r.cal}) barks${g.clear ? '' : ' through the brush'}.` });
    H.prop.huntingPressure = clamp(H.prop.huntingPressure + (r.bow ? 0.008 : 0.03)); // a bow doesn't wake the county
    H.stand.pressure = clamp((H.stand.pressure || 0) + (r.bow ? 0.012 : 0.04));
    // everyone else in the group bolts
    g.members.forEach((x) => { if (x !== m && (!r.bow || rng.chance(0.5))) x.fled = true; }); // an arrow doesn't always clear the field
    if (!rng.chance(p)) {
      H.misses++; st.stats.misses++;
      H.log.push({ t: H.now, kind: 'bad', text: rng.pick(['Clean miss. Dirt kicks up behind it.', 'You see the bullet smack a branch. Miss.', 'The deer flinches at the shot and bounds off untouched.']) });
      g.alert = 2;
      if (r.bow && rng.chance(0.5) && H.rounds > 0) { g.alert = 1; H.log.push({ t: H.now, kind: 'warn', text: 'It jumps, looks around, and stays. It never figured out what that was. Nock another arrow.' }); }
      else if (rng.chance(0.3 * (1 - r.recoil / 150)) && H.rounds > 0) { g.p = Math.max(0, g.p - 0.1); g.dmin += 30; H.log.push({ t: H.now, kind: 'warn', text: 'It stops farther out and looks back. Follow-up shot?' }); }
      else { g.gone = true; H.log.push({ t: H.now, kind: 'bad', text: 'Gone.' }); }
      cleanup(H); return;
    }
    const effRange = r.bow ? WT.bowRange(r) : r.range * 3;
    const vital = r.bow ? clamp(0.7 + (st.skills.archery || 0) * 0.006 + (g.clear ? 0.05 : -0.2) - Math.max(0, dist - effRange * 0.5) * 0.008) : clamp(0.62 + r.power * 0.0035 - Math.max(0, dist - effRange) * 0.005 + st.skills.shooting * 0.004 + (g.clear ? 0.05 : -0.2) + (dist <= 40 ? 0.2 : dist < 100 ? 0.2 * (100 - dist) / 60 : 0));
    g.gone = true;
    if (rng.chance(vital)) harvest(H, g, deer, dist, rng.chance(0.5) ? 'drops in its tracks' : `runs ${rng.int(30, 90)} yards and piles up`);
    else {
      const recover = clamp(0.3 + st.skills.woodcraft * 0.012 + r.power * 0.002 + (H.hasLight ? 0.08 : -0.05));
      H.log.push({ t: H.now, kind: 'warn', text: 'Hit! It hunches and runs hard. That looked a little far back.' });
      if (rng.chance(recover)) harvest(H, g, deer, dist, 'after a long blood trail, you find it piled up in the cattails');
      else {
        H.wounded.push(deer); st.stats.wounded++;
        { const hi = H.prop.herd.indexOf(deer); if (hi >= 0) H.prop.herd.splice(hi, 1); else if (H.visitorOf && H.visitorOf.has(deer.id)) { const vh = S().parcels[H.visitorOf.get(deer.id)].herd, vi = vh.indexOf(deer); if (vi >= 0) vh.splice(vi, 1); } } // a neighbour's deer comes off the neighbour's herd; a traveler is in nobody's // a lost deer is a dead deer
        const antlered = deer.sex === 'b' && deer.age >= 1.5;
        if (antlered && st.tags.buck > 0) { st.tags.buck--; st.tags.buckFilled++; } else if (st.tags.doe > 0) { st.tags.doe--; st.tags.doeFilled++; } else { st.tags.buck--; st.tags.buckFilled++; }
        H.log.push({ t: H.now, kind: 'bad', text: "You track until the blood runs out. Never found. You tag it anyway. It's the right thing to do." });
        H.endReason = 'wounded';
        H.prop.huntingPressure = clamp(H.prop.huntingPressure + cfg.economy.woundedLossPressure);
      }
    }
    cleanup(H);
  };

  function cleanup(H) { H.visible = H.visible.filter((g) => !g.gone); }

  function harvest(H, g, deer, dist, how) {
    const st = S(), rng = G.rng, cfg = C(), P = cfg.progression;
    { const hi = H.prop.herd.indexOf(deer); if (hi >= 0) H.prop.herd.splice(hi, 1); else if (H.visitorOf && H.visitorOf.has(deer.id)) { const vh = S().parcels[H.visitorOf.get(deer.id)].herd, vi = vh.indexOf(deer); if (vi >= 0) vh.splice(vi, 1); } } // a neighbour's deer comes off the neighbour's herd; a traveler is in nobody's
    const antlered = deer.sex === 'b' && deer.age >= 1.5;
    // legal check: antlered deer need a buck tag; antlerless deer (does, fawns, button bucks) a doe tag
    let legal = true, tagUsed;
    if (antlered) { if (st.tags.buck > 0) { st.tags.buck--; st.tags.buckFilled++; tagUsed = 'buck'; } else legal = false; }
    else if (st.tags.doe > 0) { st.tags.doe--; st.tags.doeFilled++; tagUsed = 'doe'; } else legal = false;
    if (antlered && !deer.rack) WT.growDeer(deer, H.prop, rng, 1); // safety net for an older save
    const geom = antlered ? WT.rackGeom(deer) : null;
    const sheet = geom ? WT.measureRack(geom) : null;
    let pay = legal ? WT.payoutFor(deer, rng) : 0;
    let xp = antlered ? P.xpBuckBase + Math.max(0, deer.gross - 100) * P.xpPerInch : P.xpDoe;
    xp += deer.age >= 4.5 ? 40 : 0;
    if (!legal) xp = 10; // no tag for it: the DNR takes the deer, but there is no fine
    const entry = WT.hitEntry(deer.id);
    const rec = {
      id: deer.id, y: st.year, d: st.day, sex: deer.sex, age: deer.age, lw: deer.lw, dw: Math.round(deer.lw * cfg.deer.weights.dressed),
      gross: deer.gross || 0, net: deer.net || 0, pL: deer.pL || 0, pR: deer.pR || 0, nt: !!deer.nt, abn: deer.abn || 0, sheet,
      pay, xp: Math.round(xp), parcel: H.parcel.name, rifle: H.rifle.name, cal: H.rifle.cal, dist, label: WT.deerLabel(deer), session: H.setup.session, time: H.now,
      snap: WT.snapshot(deer), legal, tagUsed, hit: entry ? { name: entry.name, estAge: WT.estAgeNow(entry), status: entry.status, log: entry.log.slice(0, 12), photos: entry.photos.slice(0, 3), notes: entry.notes } : null,
      mount: null,
    };
    if (entry) WT.removeHit(deer.id);
    st.journal.unshift(rec);
    st.seasonLog.harvest.push(rec);
    st.cash += pay; ledger('Deer harvested', pay);
    H.xp += xp;
    H.harvested.push(rec);
    if (legal) H.log.push({ t: H.now, kind: 'good', text: `It ${how}. Deer down! Time to go see what you got.` });
    else H.log.push({ t: H.now, kind: 'bad', text: `It ${how}. Walking up, your stomach drops: ${antlered ? 'antlers. You only had a doe tag.' : 'no antlers, and you only had a buck tag.'} You call it in, and the DNR takes the deer.` });
    H.lastHarvest = rec;
  }

  // Raise binoculars or the scope: a closer look (and movement a close deer may catch)
  WT.raiseOptic = function (kind) {
    const H = G.hunt; if (!H) return null;
    const optic = kind === 'scope' ? Object.assign({ kind: 'scope' }, H.scope) : H.eq.binoculars ? Object.assign({ kind: 'bino' }, H.eq.binoculars) : null;
    if (!optic) return null;
    H.raised = true;
    for (const g of H.visible) observe(H, g, optic);
    const tgt = H.selected ? WT.findTarget(H, H.selected) : H.visible[0] ? { g: H.visible[0], m: H.visible[0].members[0] } : null;
    if (tgt && tgt.m.read) { const kn = WT.knownDeer(tgt.m); H.log.push({ t: H.now, kind: 'deer', text: `Through the ${kind === 'scope' ? 'scope' : 'binos'}: ${tgt.m.read.text}.${kn ? ` That's ${kn.name ? `"${kn.name}"` : 'an unnamed deer'} from your hit list (${kn.status}).` : ''}` }); }
    // raising optics at close range is movement
    for (const g of H.visible) {
      if (g.dist > 40 || g.gone) continue;
      if (G.rng.chance((1 - H.conceal) * 0.25 * (g.dist < 20 ? 1.6 : 1))) {
        g.alert++;
        H.log.push({ t: H.now, kind: 'warn', text: 'A deer catches the movement as you raise your ' + (kind === 'scope' ? 'rifle' : 'binoculars') + '. It stares right at you.' });
        if (g.alert >= 2) { g.gone = true; H.log.push({ t: H.now, kind: 'bad', text: 'Snort! Busted.' }); }
      }
    }
    cleanup(H);
    return optic;
  };

  WT.range = function (deerId) {
    const H = G.hunt, t = WT.findTarget(H, deerId);
    if (!t || !H.eq.rangefinder) return null;
    const dist = Math.max(5, t.g.dist + t.m.dd);
    if (dist > H.eq.rangefinder.maxRange) { H.log.push({ t: H.now, kind: 'warn', text: 'No reading. Too far for your rangefinder.' }); return null; }
    H.ranged[t.g.gid] = dist;
    H.log.push({ t: H.now, kind: 'info', text: `Rangefinder: ${dist} yards.` });
    return dist;
  };

  WT.addSelectedToList = function (deerId) {
    const H = G.hunt, t = WT.findTarget(H, deerId);
    if (!t) return 'Pick a deer first.';
    const lvl = t.m.level || 0;
    if (lvl < 3) return "You haven't seen it clearly enough to know it again. Glass it closer.";
    const e = WT.noteDeer(t.m.deer, { level: lvl, pid: H.setup.pid, time: H.now, where: H.parcel.name, dist: null, doing: 'seen', kind: 'sighting', force: true });
    return e ? null : 'Could not add.';
  };

  // Calls: grunt, rattle, snort
  WT.call = function (kind) {
    const H = G.hunt, st = S(), rng = G.rng;
    const item = H.eq[kind]; if (!item) return;
    H.calls++;
    const rut = H.rut.name;
    const rutF = /Seek/.test(rut) ? 1.6 : /Peak/.test(rut) ? 1.2 : /Pre/.test(rut) ? 1.1 : /Post/.test(rut) ? 0.6 : 0.4;
    const skill = 0.5 + item.realism / 200 + st.skills.calling * 0.012;
    const overuse = Math.max(0, H.calls - 3) * 0.12;
    const verb = kind === 'grunt' ? 'You hit a few soft grunts.' : kind === 'rattle' ? 'You crash the antlers together, grind, tickle, crash again.' : 'You let out a snort-wheeze. Aggressive.';
    H.log.push({ t: H.now, kind: 'info', text: verb });
    H.raised = true;
    if (kind === 'rattle') H.prop.huntingPressure = clamp(H.prop.huntingPressure + 0.015);
    const vis = H.visible.find((g) => !g.gone && g.members.some((m) => m.deer.sex === 'b' && m.deer.age >= 1.5));
    if (vis) {
      const buck = vis.members.find((m) => m.deer.sex === 'b' && m.deer.age >= 1.5).deer;
      const mature = buck.age >= 3.5;
      if (kind === 'snort' && !mature) { vis.gone = true; H.log.push({ t: H.now, kind: 'bad', text: 'The deer wants no part of that. It tucks tail and leaves.' }); cleanup(H); return; }
      if (rng.chance(clamp(0.35 * rutF * skill * (kind === 'snort' && mature ? 1.5 : 1) - overuse))) {
        vis.dmin = Math.max(6, Math.round(vis.dmin * 0.45)); vis.offersShot = true; vis.stay += 2; vis.p = Math.min(vis.p, 0.4);
        H.log.push({ t: H.now, kind: 'good', text: 'Ears swivel your way. It turns and starts walking toward you, stiff-legged.' });
      } else if (rng.chance(overuse + (mature ? 0.1 : 0.05))) {
        vis.gone = true; H.log.push({ t: H.now, kind: 'bad', text: "It doesn't like it. It circles downwind and vanishes." }); cleanup(H);
      } else H.log.push({ t: H.now, kind: 'info', text: 'It looks your way, then goes back to what it was doing.' });
      return;
    }
    const cands = H.prop.herd.filter((d) => d.sex === 'b' && d.age >= 1.5 && !H.seenIds.has(d.id));
    const rangeF = item.range / 200;
    let pick = null;
    for (const d of cands) {
      let p = 0.035 * rutF * skill * rangeF * (d.tOP / 0.6) * (kind === 'rattle' ? 1.3 : 1) * WT.localShare(H.parcel.acres) ** 0.5;
      if (kind === 'snort') p *= d.age >= 3.5 ? 1.8 : 0.3;
      if (d.age >= 3.5) p *= 0.6 * Math.exp(-H.ctx.pressure * 1.5);
      p -= overuse * 0.02;
      if (rng.chance(p)) { pick = d; break; }
    }
    if (pick) {
      H.sched.push({ t: H.now + TICK * rng.int(1, 3), members: [pick], fromCall: true });
      H.log.push({ t: H.now, kind: 'info', text: 'You hear something. Maybe a stick crack downwind?' });
    } else if (overuse > 0.2 && rng.chance(0.3)) {
      H.log.push({ t: H.now, kind: 'warn', text: "That's a lot of calling. Anything mature in earshot is getting suspicious." });
      H.ctx.pressure = clamp(H.ctx.pressure + 0.05);
    }
  };

  WT.endHunt = function (reason) {
    const H = G.hunt, st = S(), cfg = C();
    if (!H || H.over) return H;
    H.over = true;
    H.endReason = H.endReason || reason || 'left';
    const hours = Math.max(0, Math.min(H.now, H.end) - H.start);
    const msg = { cold: "You're shaking too hard to hold the rifle still. Time to go.", patience: "Your back hurts and you can't sit still anymore. You climb down.", nolight: 'No flashlight, so you head out while you can still see the trail.', late: 'Late morning. The woods go quiet. You head back to the truck.', dark: 'Legal light is over. You unload and walk out under the stars.', left: 'You pack up and head out.', tagged: 'You get to work with the knife.', wounded: 'A long, quiet walk back to the truck.' }[H.endReason] || 'You head out.';
    H.log.push({ t: H.now, kind: 'head', text: msg });
    const d = st.parcels[H.setup.pid];
    d.pressure = clamp((H.prop.huntingPressure || 0) + H.pPerSit);
    H.stand.pressure = clamp((H.stand.pressure || 0) + H.pPerSit);
    H.stand.sits = (H.stand.sits || 0) + 1;
    H.stand.sessions = H.stand.sessions || {};
    H.stand.sessions[H.setup.session] = (H.stand.sessions[H.setup.session] || 0) + 1;
    H.stand.recent = H.stand.recent || [];
    H.stand.recent.unshift({ y: st.year, d: st.day, s: H.setup.session, seen: H.seenIds.size, wind: st.weather.windDir });
    {
      const L = slog(), key = H.stand.sid, ses = H.setup.session;
      const bs = (L.byStand[key] = L.byStand[key] || { name: H.stand.name || (H.stand.kind === 'spot' ? 'Marked spot' : WT.standType(H.stand.type).name), parcel: H.parcel.name, sits: 0, seen: 0, wind: {} });
      bs.sits++; bs.seen += H.seenIds.size; bs.wind[st.weather.windDir] = (bs.wind[st.weather.windDir] || 0) + H.seenIds.size;
      const ss = (L.bySes[ses] = L.bySes[ses] || { sits: 0, seen: 0 }); ss.sits++; ss.seen += H.seenIds.size;
      L.hours += hours; L.shots += H.shots; L.misses += H.misses;
    }
    if (H.stand.recent.length > 8) H.stand.recent.length = 8;
    if (d.owner === 'public') d.scoutSits = (d.scoutSits || 0) + 1;
    const P = cfg.progression;
    H.xp += hours * P.xpPerHourSat;
    st.stats.hours += hours; st.stats.seen += H.seenIds.size;
    H.levelUps = WT.addXp(H.xp);
    st.lastHunt = { pid: H.setup.pid, sid: H.stand.sid, session: H.setup.session, seen: H.seenIds.size, harvested: H.harvested.length };
    advanceAfterHunt(H.setup.session);
    WT.save();
    return H;
  };

  // What you've learned about a stand or spot: revealed by sitting it (stars), never the raw numbers.
  // What you know about a stand. One sit tells you what it is; after that the numbers never move.
  WT.standKnowledge = function (s) {
    const sits = s.sits || 0, known = sits >= 1, t = WT.standTraits(s), v = WT.standView(s);
    const stars = (x) => (known ? Math.max(1, Math.min(5, Math.round(1 + x * 4))) : null);
    const conf = known ? '' : 'unknown';
    return {
      known, sits, rating: known ? t.rating : null, consistency: known ? t : null,
      morning: { stars: stars(s.r.morning), conf }, evening: { stars: stars(s.r.evening), conf },
      rut: { stars: stars(s.r.rut), conf }, mature: { stars: stars(s.r.mature), conf },
      winds: known ? t.winds : null,
      view: known ? `${v.vis > 0.7 ? 'Open country' : v.vis > 0.4 ? 'Mixed cover' : 'Timber'}: deer show at ${v.near} to ${v.far} yards` : null,
      pressure: s.pressure || 0,
    };
  };

  /* ================================================================ time */
  function advanceAfterHunt(session) {
    const st = S();
    if (session === 'morning') st.slot = 'evening';
    else nextDay();
  }
  WT.skip = function (what) {
    const st = S();
    if (what === 'session') { if (st.slot === 'morning') st.slot = 'evening'; else nextDay(); }
    else if (what === 'day') nextDay();
    else if (what === 'week') { for (let k = 0; k < 7 && st.day < C().calendar.seasonDays && !G.seasonOver; k++) nextDay(); }
    WT.save();
  };

  // Somebody else killed a deer. You always hear about a hit list deer; other good bucks only if they died on or next to your land.
  function neighborKill(p, d, deer) {
    const st = S(), rng = G.rng, w = G.world;
    const e = WT.hitEntry(deer.id);
    const antlered = deer.sex === 'b' && deer.age >= 1.5 && deer.gross;
    const mine = d.owner === 'player', nextDoor = [...p.neighbors].some((q) => st.parcels[q].owner === 'player');
    if (!e && !(antlered && deer.gross >= 125 && (mine || nextDoor) && rng.chance(0.6))) return;
    let who;
    if (d.owner === 'npc') who = `The ${p.ownerName}s`;
    else if (d.owner === 'public') who = `A hunter on ${p.name}`;
    else { const nb = [...p.neighbors].map((q) => w.parcels[q]).filter((q) => st.parcels[q.id].owner === 'npc' && q.ownerName); who = nb.length ? `The ${rng.pick(nb).ownerName}s` : 'A neighbor'; }
    const cls = antlered ? `${Math.floor(deer.gross / 10) * 10}-class buck` : deer.sex === 'd' ? 'doe' : 'young deer';
    if (e) {
      e.dead = { y: st.year, d: st.day, by: who };
      news(`${who} killed ${e.name ? `"${e.name}"` : `an unnamed ${antlered ? 'buck' : 'deer'}`}, one of your hit list deer${antlered ? ` (a ${cls})` : ''}.`, 'bad');
    } else news(`${who} killed a ${cls}${mine ? ' that lived on your land' : ' next door'}.`, 'warn');
    slog().neighbors.push({ who, cls, hit: e ? e.name || 'unnamed' : null });
  }
  function nextDay() {
    const st = S(), cfg = C(), rng = G.rng;
    st.plantingOpen = false;
    st.day++;
    st.slot = 'morning';
    const decay = cfg.deer.pressure.decay;
    for (const p of G.world.parcels) {
      const d = st.parcels[p.id];
      const floor = d.owner === 'public' ? WT.crowd(p.id).floor : 0.02;
      d.pressure = Math.max(floor, (d.pressure || 0) * decay);
      for (const s of [...d.stands, ...(d.spots || [])]) s.pressure = (s.pressure || 0) * decay; // marked public spots rest too
      // neighbors and other hunters
      const prop = makeProp(p.id);
      if (st.day <= 0) continue; // before Oct 1 nobody else is hunting
      if (WT.cropsOff()) prop.cropAdj = 1 + cfg.land.crops.neighbors * prop.mix.farm; // bare fields push deer in front of the neighbors
      const died = WT.inSeasonDailyMortality(prop, rng, cfg.calendar.seasonDays);
      d.herd = prop.herd;
      for (const deer of died) neighborKill(p, d, deer);
    }
    cameraDay();
    if (st.day >= cfg.calendar.seasonDays) { G.seasonOver = true; return; }
    st.weather = rollWeather(st.day, st.weather, rng);
    if (st.day === 0) news('Rifle season is open. Everybody is in the woods now.', 'info');
    if (st.day === (st.cropDay ?? 9)) news(`The combines rolled today. Crops are off. For the next two weeks deer that lived in the fields are packed into whatever cover is left: the best hunting of the year on land with timber or swamp beside the fields. After that they start drifting to the neighbors.`, 'good');
    const rut = WT.rutPhase(st.day), prev = WT.rutPhase(st.day - 1);
    if (rut !== prev) news(`${rut.name} has started.${/Seek/.test(rut.name) ? ' Mature bucks are on their feet in daylight. Hunt all day if you can.' : ''}`, 'info');
    if (st.weather.front && st.day === (cfg.calendar.fairDays || -1)) news('The first cold front of the fall is here. The mild weather is over: dress for it, or your sits will be short. Deer will be on their feet tomorrow.', 'warn');
    else if (st.weather.front) news('Cold front coming through today. Tomorrow should be a good one.');
    if (rng.chance(0.04)) {
      const pub = WT.publicAreas();
      if (pub.length) news(`Rumor: a truck at the gas station had a big buck in the bed from ${rng.pick(pub).name}.`);
    }
  }

  // Trail cameras: images only. A photo stores a frozen snapshot of the deer so it re-renders exactly as it looked.
  function cameraDay() {
    const st = S(), rng = G.rng;
    for (const p of G.world.parcels) {
      const d = st.parcels[p.id];
      if ((d.owner !== 'player' && d.owner !== 'public') || !d.cams.length) continue;
      for (const cam of d.cams) {
        const ct = WT.camType(cam.type);
        const i = cam.y * G.world.W + cam.x;
        cam.days = (cam.days || 0) + 1;
        // a camera sees what a hunter sitting on that spot would: the better the spot, the more deer walk past it
        const sight = WT.camSight(cam), r = sight.r;
        const tw = WT.touching(p.id, cam.x, cam.y), onFood = tw.plot ? 0.35 : tw.field && !WT.cropsOff() ? 0.3 : 0; // touching a grown plot or a standing crop
        const traffic = 0.15 + 1.3 * Math.max(r.morning, r.evening, r.rut * 0.8) + onFood;
        const watched = Math.pow(sight.reach / 60, 0.7); // more ground in view, more deer caught
        const spotOf = d.owner === 'public' ? d.spots || [] : d.stands;
        const rutCam = /Seek|Peak/.test(WT.rutPhase(Math.min(st.day, 91)).name);
        const signCam = WT.signTouching(p.id, cam.x, cam.y);
        const at = WT.standForCam(p.id, cam); void spotOf;
        for (const deer of d.herd) {
          if (deer.age < 1 && rng.chance(0.6)) continue;
          const p0 = 0.075 * ct.detect * traffic * watched * (deer.tOP / 0.6) * WT.localShare(p.acres) ** 0.6 * WT.homeFactor(p.id, deer, cam.x, cam.y, rutCam) * WT.signBoost(signCam, deer, 'camera', rutCam);
          if (!rng.chance(p0)) continue;
          const night = deer.sex === 'b' && deer.age >= 3.5 ? rng.chance(0.85) : rng.chance(0.45);
          const dist = Math.round(4 + (sight.reach - 4) * Math.pow(rng.next(), 1.4));
          const photo = { y: st.year, d: st.day, hour: night ? rng.pick([22, 23, 1, 2, 3, 4, 5]) : rng.pick([7, 8, 17, 18]), night, dist, yaw: rng.pick([-90, -60, -30, 30, 60, 90, 150, -150]),
            pose: rng.pick(['walk', 'down', 'up', 'alert']), cam: cam.cid, camType: cam.type, pid: p.id, snap: WT.snapshot(deer), sid: at ? at.sid : null, at: at ? (at.name || (at.kind === 'spot' ? 'marked spot' : WT.standType(at.type).name)) : null };
          // sharp out to the camera's clear range, then fading to nothing at the edge of its reach
          photo.q = clamp((night ? ct.night : 0.95) * (dist <= sight.clear ? 1 : Math.max(0, 1 - (dist - sight.clear) / Math.max(1, sight.reach - sight.clear)) * 0.8));
          if (ct.cell) cam.daysChecked = cam.days;
          if (ct.cell) deliverPhoto(photo, deer);
          else { (cam.queue = cam.queue || []).push(photo); cam.pending = cam.queue.length; }
        }
      }
    }
    if (st.photos.length > 80) st.photos.length = 80;
  }
  function deliverPhoto(photo, deer) {
    const st = S();
    const d0 = WT.snapDeer(photo.snap);
    d0.gross = photo.snap.gross; d0.nt = photo.snap.nt; d0.pL = photo.snap.pL; d0.pR = photo.snap.pR;
    photo.read = WT.judgeDeer(d0, photo.q >= 0.75 && !photo.night ? 4 : photo.q >= 0.45 ? 3 : 2, 1).text;
    st.photos.unshift(photo);
    const camRec = (st.parcels[photo.pid].cams || []).find((c) => c.cid === photo.cam);
    if (camRec) { camRec.total = (camRec.total || 0) + 1; if (!photo.night) camRec.dayN = (camRec.dayN || 0) + 1; if (photo.snap.sex === 'b' && photo.snap.rack) camRec.bucks = (camRec.bucks || 0) + 1; }
    const known = WT.hitEntry(photo.snap.k);
    if (known && known.name && photo.q >= 0.45) news(`Trail camera on ${G.world.parcels[photo.pid].name}: looks like "${known.name}" is still around.`, 'good');
    // a decent photo of a buck puts him on the hit list (images only, never numbers)
    if (deer && photo.q >= 0.45) WT.noteDeer(deer, { level: 3, pid: photo.pid, time: photo.hour, where: 'Trail camera, ' + G.world.parcels[photo.pid].name, dist: null, doing: 'on camera', kind: 'photo', photo });
  }
  WT.checkCameras = function (pid, cid) {
    const st = S(), d = st.parcels[pid];
    let n = 0;
    for (const cam of d.cams) {
      if (cid && cam.cid !== cid) continue;
      if (!cam.queue) { cam.daysChecked = cam.days || 0; continue; }
      for (const ph of cam.queue) { const deer = d.herd.find((x) => x.id === ph.snap.k); deliverPhoto(ph, deer); n++; }
      cam.daysChecked = cam.days || 0;
      cam.queue = []; cam.pending = 0;
    }
    d.pressure = clamp((d.pressure || 0) + 0.02);
    return n;
  };

  WT.checkAllCameras = function () {
    let n = 0, places = 0;
    for (const p of G.world.parcels) { const d = S().parcels[p.id]; if ((d.cams || []).some((c) => c.queue && c.queue.length) || (d.cams || []).some((c) => !WT.camType(c.type).cell)) { if ((d.cams || []).length) { n += WT.checkCameras(p.id); places++; } } }
    return { n, places };
  };

  /* ================================================================ season end */
  /* Sign. Every buck leaves sign around the spot he lives: a bed at home, rubs on timber and tree lines close by,
     scrapes on the edges he travels, and his sheds if he made it through winter. It is laid down at the end of each
     season on land you own and on public land, and stays hidden until you search the 3 x 3 block it is in. */
  function layDownSign(carried) {
    const st = S(), w = G.world, out = [];
    const racks = new Map(carried.map((c) => [c.id, c]));
    for (const p of w.parcels) {
      const d = st.parcels[p.id]; if (d.owner !== 'player' && d.owner !== 'public') continue;
      const near = (h, r, ok, salt, deer, n) => { // up to n tiles within r of home that pass ok, chosen the same way every time
        const c = [];
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = h.x + dx, y = h.y + dy; if (x < 1 || y < 1 || x >= w.W - 1 || y >= w.H - 1) continue; const i = y * w.W + x; if (w.parcelOf[i] === p.id && ok(x, y, i)) c.push(i); }
        c.sort((a, b2) => WT.hash2(a, deer.id, salt) - WT.hash2(b2, deer.id, salt));
        return c.slice(0, n);
      };
      const dry = (i) => { const lt = WT.landType(w.cover[i]); return lt !== 'water' && lt !== 'road'; };
      for (const deer of d.herd) {
        if (deer.sex !== 'b' || deer.age < 1.5) continue;
        const h = WT.deerHome(p.id, deer), hi = h.y * w.W + h.x;
        if (dry(hi)) out.push({ p: p.id, i: hi, t: 'bed', k: deer.id, f: 0 });
        const nRub = 1 + Math.floor(WT.hash2(deer.id, 1, st.year + 5) * 3), nScr = 1 + Math.floor(WT.hash2(deer.id, 2, st.year + 6) * 2);
        for (const i of near(h, 4, (x, y, i) => { const id = WT.spotSetting(w, x, y).id; return WT.landType(w.cover[i]) === 'timber' || id === 'treeline'; }, 81, deer, nRub)) out.push({ p: p.id, i, t: 'rub', k: deer.id, f: 0 });
        for (const i of near(h, 5, (x, y, i) => dry(i) && WT.landType(w.cover[i]) !== 'farm' && (['treeline', 'fieldEdge', 'swampEdge', 'bank'].includes(WT.spotSetting(w, x, y).id) || w.travel[i] > 0.55), 82, deer, nScr)) out.push({ p: p.id, i, t: 'scrape', k: deer.id, f: 0 });
        const rk = racks.get(deer.id);
        if (rk) { const side = WT.hash2(deer.id, 3, st.year) < 0.3 ? 'both' : WT.hash2(deer.id, 4, st.year) < 0.5 ? 'R' : 'L'; for (const i of near(h, 3, (x, y, i) => dry(i), 83, deer, 1)) out.push({ p: p.id, i, t: 'shed', k: deer.id, f: 0, sh: { age: rk.age, side, pts: side === 'both' ? rk.pR + rk.pL : side === 'R' ? rk.pR : rk.pL, snap: rk.snap } }); }
      }
    }
    st.sign = out;
  }
  WT.offseason = () => !!S().plantingOpen; // from the end of one season until your first hunt or wait of the next
  // Search one 3 x 3 block. Returns { found: [...] } or an error string.
  WT.scoutBlock = function (pid, x, y) {
    const st = S(), w = G.world, d = st.parcels[pid];
    if (!WT.offseason()) return 'Scouting is for the off-season, after one season ends and before you hunt the next.';
    if (!d || (d.owner !== 'player' && d.owner !== 'public')) return 'You can scout your own land and public land.';
    if (!(st.scoutLeft > 0)) return 'You have used all your searches this off-season.';
    st.scoutLeft--;
    const found = [];
    for (const sg of st.sign || []) {
      if (sg.f || sg.p !== pid) continue;
      const sx = sg.i % w.W, sy = (sg.i / w.W) | 0;
      if (Math.abs(sx - x) > 1 || Math.abs(sy - y) > 1) continue;
      sg.f = 1; found.push(sg);
      if (sg.t === 'shed') {
        const e = WT.hitEntry(sg.k), parcel = w.parcels[pid].name;
        st.sheds.unshift({ k: sg.k, y: st.year - 1, age: sg.sh.age, side: sg.sh.side, pts: sg.sh.pts, parcel, snap: sg.sh.snap, name: e ? e.name || null : null });
        if (e) { (e.sheds = e.sheds || []).unshift({ y: st.year - 1, age: sg.sh.age, side: sg.sh.side, pts: sg.sh.pts, parcel }); e.last = [st.year, 0]; sg.name = e.name || null; }
      }
    }
    if (st.sheds.length > 120) st.sheds.length = 120;
    (st.scouted = st.scouted || []).push({ p: pid, x, y });
    // an empty block still tells you something: which way the tracks lead (toward the nearest sign you haven't found)
    let hint = null;
    if (!found.length) {
      let best = null;
      for (const sg of st.sign || []) { if (sg.f || sg.p !== pid) continue; const dx = (sg.i % w.W) - x, dy = ((sg.i / w.W) | 0) - y, dd = Math.hypot(dx, dy); if (!best || dd < best.dd) best = { dx, dy, dd }; }
      if (best) { let a = Math.atan2(best.dx, -best.dy); if (a < 0) a += Math.PI * 2; hint = { dir: ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(a / (Math.PI / 4)) % 8], far: best.dd > 8 }; }
    }
    return { found, hint };
  };
  WT.foundSign = (pid) => (S().sign || []).filter((sg) => sg.f && (pid == null || sg.p === pid));
  // Sign belongs to the buck that made it. Everything of his within one tile of (x, y), found or not.
  WT.signTouching = function (pid, x, y) {
    const w = G.world, out = new Map();
    for (const sg of S().sign || []) {
      if (sg.p !== pid || sg.t === 'shed') continue;
      if (Math.abs((sg.i % w.W) - x) > 1 || Math.abs(((sg.i / w.W) | 0) - y) > 1) continue;
      const cur = out.get(sg.k) || {}; cur[sg.t] = true; if (sg.f) cur.found = true; out.set(sg.k, cur);
    }
    return out;
  };
  // How much more often THAT buck shows at a stand or camera touching his sign. His scrape still pulls him in the rut.
  WT.signBoost = function (touch, deer, kind, rutOn) {
    const t = touch && touch.get(deer.id); if (!t) return 1;
    const m = C().scouting[kind];
    return Math.max(t.scrape ? (kind === 'stand' && rutOn ? m.scrapeRut : m.scrape) : 1, t.bed ? m.bed : 1, t.rub ? m.rub : 1);
  };
  // A scrape touching a stand is worked in the rut: a small bonus whether or not you have found it.
  WT.scrapeNear = (pid, x, y) => { const w = G.world; return (S().sign || []).some((sg) => sg.t === 'scrape' && sg.p === pid && Math.abs((sg.i % w.W) - x) <= 1 && Math.abs(((sg.i / w.W) | 0) - y) <= 1); };

  // A plain look back at the season: what worked, so next year's plan writes itself.
  function buildRecap() {
    const st = S(), L = slog(), out = { hours: Math.round(L.hours), hunts: L.hunts || 0, shots: L.shots, misses: L.misses, busted: L.busted, tips: [] };
    const stands = Object.values(L.byStand).map((b) => Object.assign({ rate: b.seen / Math.max(1, b.sits) }, b));
    out.seen = stands.reduce((a, b) => a + b.seen, 0);
    const tried = stands.filter((b) => b.sits >= 2).sort((a, b) => b.rate - a.rate);
    out.best = tried[0] || stands.slice().sort((a, b) => b.rate - a.rate)[0] || null;
    out.worst = tried.length > 1 ? tried[tried.length - 1] : null;
    if (out.best) { const wn = Object.entries(out.best.wind).sort((a, b) => b[1] - a[1])[0]; out.bestWind = wn && wn[1] > 0 ? wn[0] : null; }
    const m = L.bySes.morning, e = L.bySes.evening;
    out.morning = m ? m.seen / m.sits : null; out.evening = e ? e.seen / e.sits : null;
    const bucks = Object.entries(L.bucks).map(([id, b]) => Object.assign({ id: +id }, b)).sort((a, b) => b.g - a.g);
    out.bucks = bucks.length;
    const taken = new Set(L.harvest.map((r) => r.id));
    if (bucks[0]) { const he = WT.hitEntry(bucks[0].id); out.biggest = { text: bucks[0].t, where: bucks[0].where, d: bucks[0].d, name: he ? he.name : null, taken: taken.has(bucks[0].id) }; }
    out.passed = bucks.filter((b) => !taken.has(b.id)).length;
    out.neighbors = L.neighbors.slice(0, 6);
    // next year's plan
    if (out.best && out.best.sits >= 2) out.tips.push(`${out.best.name} was your best stand: ${out.best.rate.toFixed(1)} deer a sit over ${out.best.sits} sits${out.bestWind ? `, best on a ${out.bestWind} wind` : ''}. Build next year around it.`);
    if (out.worst && out.worst.rate < (out.best ? out.best.rate * 0.5 : 0)) out.tips.push(`${out.worst.name} saw ${out.worst.rate.toFixed(1)} deer a sit. Move it, or put a camera there first to see if it's worth keeping.`);
    if (out.morning != null && out.evening != null && Math.abs(out.morning - out.evening) > 0.4) out.tips.push(`${out.morning > out.evening ? 'Mornings' : 'Evenings'} were better for you (${Math.max(out.morning, out.evening).toFixed(1)} deer a sit against ${Math.min(out.morning, out.evening).toFixed(1)}).`);
    if (out.busted >= 4) out.tips.push(`Deer caught you ${out.busted} times. Check the wind before you pick a stand, and look at quieter, better-hiding clothes.`);
    if (out.shots >= 3 && out.misses / out.shots > 0.5) out.tips.push(`You missed ${out.misses} of ${out.shots} shots. Wait for closer deer and clear shots, or put skill points in Marksmanship.`);
    if (out.hunts && out.hunts < 20) out.tips.push(`You hunted ${out.hunts} time${out.hunts === 1 ? '' : 's'} in a 92-day season. Warmer clothes let you sit longer and later into the year.`);
    if (out.biggest && !out.biggest.taken) out.tips.push(`The biggest buck you saw got away${out.biggest.name ? ` ("${out.biggest.name}")` : ''}. If the sheds turn up this spring, he's still out there.`);
    return out;
  }
  WT.endSeason = function () {
    const st = S(), cfg = C(), rng = G.rng, w = G.world;
    const summary = { year: st.year, harvest: st.seasonLog.harvest.slice(), hunts: st.seasonLog.hunts, tax: 0, events: [], money: Object.assign({}, st.seasonLog.money || {}) };
    // land kept planted breeds a little better each year; let it go and that slips back
    for (const p of G.world.parcels) { const e = st.parcels[p.id]; if (e.owner !== 'player') { if (e.managed) e.managed = 0; continue; } const fed = makeProp(p.id).plotNutrition >= C().landWork.plotNutritionMax * 0.5; e.managed = Math.max(0, Math.min(C().deer.geneMap.managedMaxYears, (e.managed || 0) + (fed ? 1 : -1))); }
    // taxes
    let tax = 0;
    for (const p of w.parcels) if (st.parcels[p.id].owner === 'player') tax += WT.landPrice(p.id) * cfg.economy.propertyTaxRate;
    tax = Math.round(tax);
    if (tax) { st.cash -= tax; ledger('Property tax', -tax); }
    summary.tax = tax;
    // cellular plans
    let plans = 0;
    for (const p of w.parcels) for (const c of st.parcels[p.id].cams) { const ct = WT.camType(c.type); if (ct.cell) plans += ct.plan; }
    void plans; // cellular cameras no longer charge a yearly plan: nothing is taken automatically when a year passes
    // improvements mature
    const TT = T();
    // this year's plots fed this year's deer: remember what they gave before the plots go back to dirt,
    // or next year's antlers would be grown as if nothing had been planted
    const plotFed = {};
    for (const p of w.parcels) if (st.parcels[p.id].owner === 'player') { const pr = makeProp(p.id); plotFed[p.id] = { food: pr.food, n: pr.plotNutrition || 0, c: pr.plotCapacity || 0, a: pr.plotAntler || 0 }; }
    for (const p of w.parcels) {
      const d = st.parcels[p.id];
      // the season is over: every plot is bare dirt again until you replant it this spring
      for (const pl of d.plots) { if (pl.type) pl.last = pl.type; pl.type = null; pl.planted = false; pl.quality = null; pl.tiles.forEach((i) => setTile(i, TT.PLOT_NEW)); }
      for (const tr of d.trees) {
        if (!tr.mature && st.year + 1 - tr.year >= cfg.improvements.trees.matureYears) { tr.mature = true; tr.tiles.forEach((i) => setTile(i, TT.BELT)); summary.events.push(`A shelterbelt row on ${p.name} has grown into real cover.`); }
      }
    }
    WT.computeDerivedLayers(w); refreshStands();
    // deer: yearly cycle for every property
    const winter = clamp(rng.normal(0.4, 0.2));
    const yearFactor = 1 + rng.range(-cfg.deer.yearlyVariance, cfg.deer.yearlyVariance);
    summary.winter = winter > 0.65 ? 'a brutal winter' : winter > 0.45 ? 'a typical North Dakota winter' : 'a mild winter';
    summary.growing = yearFactor > 1.03 ? 'a wet, green summer' : yearFactor < 0.97 ? 'a dry summer' : 'an average summer';
    // what every buck on your land was carrying this fall (he drops it in late winter if he lives)
    const carried = [];
    for (const p of w.parcels) { const d = st.parcels[p.id]; if (d.owner !== 'player' && d.owner !== 'public') continue; for (const deer of d.herd) if (deer.sex === 'b' && deer.age >= 1.5 && deer.rack) carried.push({ id: deer.id, pid: p.id, age: deer.age, pR: deer.pR || 0, pL: deer.pL || 0, gross: deer.gross || 0, snap: WT.snapshot(deer) }); }
    summary.recap = buildRecap();
    // whole-map year: every parcel's cycle, dispersal between real parcels, population stabilizer
    const props = w.parcels.map((p) => { const pr = makeProp(p.id); pr.neighbors = [...p.neighbors]; pr.npcStyle = st.parcels[p.id].npcStyle; const pf = plotFed[p.id]; if (pf) { pr.plotNutrition = Math.max(pr.plotNutrition || 0, pf.n); pr.plotCapacity = Math.max(pr.plotCapacity || 0, pf.c); if (pf.a > (pr.plotAntler || 0)) { pr.landQuality += pf.a - (pr.plotAntler || 0); pr.plotAntler = pf.a; } } /* this year's plots fed this year's herd and the racks it grows */ return pr; });
    const res = WT.worldYear(props, rng, { winter, yearFactor, seasonMortalityApplied: true }, st.worldSim);
    st.worldSim = res.world;
    props.forEach((pr, k) => {
      const p = w.parcels[k], d = st.parcels[p.id];
      d.herd = pr.herd; d.capacity = pr.capacity; d.pressure = pr.huntingPressure;
      for (const s2 of d.stands) s2.pressure = 0;
      for (const s2 of d.spots || []) s2.pressure = 0;
      if (res.logs[k].disease && d.owner === 'player') summary.events.push(`EHD hit ${p.name} in late summer. You found dead deer near the water.`);
    });
    // off-season scouting: this year's sign is on the ground now. Nothing is found until you go and look.
    st.sheds = st.sheds || [];
    layDownSign(carried);
    st.scoutLeft = C().scouting.searches + Math.floor((st.skills.woodcraft || 0) / C().scouting.woodcraftPer);
    summary.scout = st.scoutLeft;
    // reset season
    st.plantingOpen = true; // spring: choose what goes in each plot before the first hunt
    st.year++; st.day = WT.ownsBow() ? -(cfg.calendar.earlyBowDays || 0) : 0; st.slot = 'morning';
    st.tags = { buck: 0, doe: 0, buckFilled: 0, doeFilled: 0 };
    st.seasonLog = { hunts: 0, harvest: [] };
    st.weather = rollWeather(0, null, rng);
    st.cropDay = rng.int(C().land.crops.offDay[0], C().land.crops.offDay[1]);
    rotateListings();
    G.seasonOver = false;
    if (st.day < 0) news(`Early archery season is open: ${WT.dateLabel(st.day)} to Sep 30, bow only. You have the woods to yourself until rifle season opens Oct 1.`, 'good');
    news(`Year ${st.year}. New season, new tags.${tax ? ' Property tax: ' + WT.money(tax) + '.' : ''}`);
    WT.save();
    return summary;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
