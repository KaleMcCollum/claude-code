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
    let anom = prev ? prev.anom * 0.65 + rng.normal(0, 6) : rng.normal(0, 6);
    let front = false;
    if (rng.chance(0.13)) { front = true; anom -= rng.range(8, 18); }
    const after = prev && prev.front;
    const windDir = front ? rng.pick(['NW', 'N', 'NW', 'W']) : rng.pick(['NW', 'NW', 'N', 'W', 'S', 'S', 'SE', 'SW', 'E', 'NE']);
    const wind = Math.round(front ? rng.range(14, 28) : after ? rng.range(2, 9) : rng.range(3, 20));
    const low = Math.round(lo + anom), high = Math.round(hi + anom);
    const precipChance = front ? 0.4 : 0.12;
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
    const world = WT.genWorld(seed);
    G.world = world;
    const rng = WT.makeRng(seed ^ 0x5eed);
    G.rng = rng;
    WT.setDeerSeq(1);
    const st = {
      v: 1, seed, year: 1, day: 0, slot: 'morning',
      cash: C().economy.startingCash, xp: 0, level: 1, skillPts: 2,
      skills: { stealth: 0, shooting: 0, calling: 0, scent: 0, patience: 0, woodcraft: 0 },
      inv: {
        rifles: ['ruger_ranch'], scopes: ['simmons'], rifleScope: { ruger_ranch: 'simmons' },
        stands: { ground: 1 }, clothing: C().clothing.filter((c) => c.starter).map((c) => c.id),
        equipment: [], cameras: {}, consum: {}, propane: 0, lightCharge: 0,
      },
      loadout: { rifle: 'ruger_ranch', clothing: { base: 'tee', mid: 'sweat_blaze', pants: 'jeans', feet: 'sneakers' }, equip: {}, pack: {} },
      tags: { buck: 0, doe: 0, buckFilled: 0, doeFilled: 0 },
      parcels: {}, tileMods: {}, forSale: [],
      journal: [], news: [], hitList: [], photos: [], settings: { hand: 'right' },
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
    const hs = pickGoodTile(home.id, rng);
    st.parcels[home.id].stands.push(makeStand('ladder', hs.x, hs.y, 'Old ladder'));
    rotateListings();
    st.weather = rollWeather(0, null, rng);
    news(`Welcome to the Home Place: ${home.acres} acres of your own. Buy a buck tag at the shop, check your gear, then press HUNT.`);
    news('Rifle season runs Oct 1 to Dec 31 this year. Blaze orange is required.');
    news('Tip: your starter clothes are miserable below 50°F. A cheap jacket, bibs, rubber boots and a hat from the shop will let you sit for hours instead of minutes.');
    return st;
  };

  function initParcelHerd(pid) {
    const p = G.world.parcels[pid], d = S().parcels[pid];
    const prop = makeProp(pid);
    WT.initHerd(prop, G.rng);
    d.herd = prop.herd; d.capacity = prop.capacity; d.pressure = prop.huntingPressure;
  }

  // Property view handed to the deer simulation. Stats are computed from tiles + improvements.
  function makeProp(pid) {
    const p = G.world.parcels[pid], d = S().parcels[pid];
    const h = WT.tileHabitat(G.world, pid, { sanctuary: new Set(d.sanctuary || []) });
    // a little extra water from water holes in dry spots
    if (d.waterholes && d.waterholes.length) h.water = clamp(h.water + 0.12 * d.waterholes.length);
    p.habitat = h;
    const prop = WT.propFromHabitat({ id: pid, acres: p.acres, type: d.owner === 'public' ? 'public' : 'private', neighborPressure: d.neighborPressure }, h);
    prop.effectiveAcres = contiguousAcres(pid);
    prop.herd = d.herd || [];
    prop.huntingPressure = d.pressure ?? 0.05;
    prop.npcStyle = d.npcStyle;
    prop.capacity = WT.carryingCapacity(prop);
    return prop;
  }
  WT.makeProp = makeProp;

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
      if (w.parcelOf[i] !== pid || !standableTile(w.cover[i])) continue;
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
    G.world = WT.genWorld(st.seed);
    G.state = st;
    G.rng = WT.makeRng(1); G.rng.setState(st.rngState);
    WT.setDeerSeq(st.deerSeq || 1);
    // reapply ownership + tile modifications
    for (const p of G.world.parcels) { const d = st.parcels[p.id]; if (d) p.owner = d.owner; }
    applyTileMods();
    return st;
  };
  WT.wipeSave = function () { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage blocked */ } };

  function applyTileMods() {
    const w = G.world, mods = S().tileMods;
    for (const k in mods) w.cover[+k] = mods[k];
    WT.computeDerivedLayers(w);
    for (const p of w.parcels) p.habitat = WT.tileHabitat(w, p.id, { sanctuary: new Set(S().parcels[p.id].sanctuary || []) });
  }
  function setTile(i, t) { G.world.cover[i] = t; S().tileMods[i] = t; }

  /* ================================================================ news */
  function news(text, kind) {
    const st = S();
    st.news.unshift({ y: st.year, d: st.day, text, kind: kind || 'info' });
    if (st.news.length > 60) st.news.length = 60;
  }
  WT.news = news;

  /* ================================================================ progression */
  WT.addXp = function (n) {
    const st = S(), P = C().progression;
    st.xp += Math.round(n);
    const ups = [];
    while (st.level < P.maxLevel && st.xp >= P.xpForLevel(st.level)) {
      st.xp -= P.xpForLevel(st.level);
      st.level++; st.skillPts += P.skillPointsPerLevel;
      ups.push(st.level);
      const unlocked = C().rifles.filter((r) => r.level === st.level);
      unlocked.forEach((r) => {
        if (r.award) { if (!st.inv.rifles.includes(r.id)) { st.inv.rifles.push(r.id); st.inv.rifleScope[r.id] = 'simmons'; } news(`Level ${st.level}! ${r.name} has been handed down to you.`, 'good'); }
        else news(`Level ${st.level} unlocked the ${r.name} (${r.cal}) at the shop.`, 'good');
      });
    }
    if (ups.length) news(`Level up! You're level ${st.level}. +${ups.length * P.skillPointsPerLevel} skill points.`, 'good');
    return ups;
  };
  WT.spendSkill = function (k) {
    const st = S();
    if (st.skillPts <= 0 || st.skills[k] >= C().progression.skillMax) return false;
    st.skills[k]++; st.skillPts--; return true;
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
    if (st.cash < price) return `Not enough money. You need ${WT.money(price)}.`;
    st.cash -= price;
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
    while (out.length < C().world.forSaleCount && pool.length) {
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
    st.cash -= price;
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
    st.cash += val;
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
    st.cash -= d.permFee; d.permBought = true;
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
    if (type === 'ground') return 'Ground sits are free on public land. On your land, put up a real stand.';
    if (d.stands.length >= WT.limits(pid).stands) return `Stand limit reached (${WT.limits(pid).stands} for this acreage).`;
    if (d.stands.some((s) => Math.abs(s.x - x) + Math.abs(s.y - y) < 3)) return 'Too close to another stand.';
    if (d.sanctuary.includes(i)) return "That's inside your sanctuary.";
    st.inv.stands[type]--;
    const s = makeStand(type, x, y);
    d.stands.push(s);
    return null;
  };
  WT.removeStand = function (pid, sid) {
    const st = S(), d = st.parcels[pid];
    const s = d.stands.find((z) => z.sid === sid); if (!s) return 'No stand.';
    const kind = WT.standType(s.type).kind;
    if (kind === 'permanent') { if (st.cash < 50) return 'Moving a permanent stand costs $50 in labor.'; st.cash -= 50; }
    d.stands = d.stands.filter((z) => z.sid !== sid);
    st.inv.stands[s.type] = (st.inv.stands[s.type] || 0) + 1;
    return null;
  };
  WT.placeCamera = function (pid, type, x, y) {
    const st = S(), d = st.parcels[pid], w = G.world, i = tileAt(x, y);
    if (d.owner !== 'player') return 'Cameras go on your own land.';
    if (i < 0 || w.parcelOf[i] !== pid || !standableTile(w.cover[i])) return 'Pick a spot inside your property.';
    if (!st.inv.cameras[type]) return 'Buy a camera at the shop first.';
    if (d.cams.length >= WT.limits(pid).cams) return `Camera limit reached (${WT.limits(pid).cams}).`;
    st.inv.cameras[type]--;
    d.cams.push({ cid: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), type, x, y, pending: 0, total: 0 });
    return null;
  };
  WT.removeCamera = function (pid, cid) {
    const st = S(), d = st.parcels[pid];
    const c = d.cams.find((z) => z.cid === cid); if (!c) return 'No camera.';
    d.cams = d.cams.filter((z) => z.cid !== cid);
    st.inv.cameras[c.type] = (st.inv.cameras[c.type] || 0) + 1;
    return null;
  };
  WT.plantPlot = function (pid, typeId, x, y, acres) {
    const st = S(), d = st.parcels[pid], w = G.world, TT = T();
    const pt = WT.plotType(typeId);
    if (d.owner !== 'player') return 'Plant food plots on your own land.';
    const lim = WT.limits(pid);
    if (WT.plotAcresUsed(pid) + acres > lim.plotAcres + 1e-6) return `Plots are limited to ${lim.plotAcres} acres here (8% of the property).`;
    const side = Math.round(Math.sqrt(acres * 4));
    const tiles = [];
    for (let yy = y; yy < y + side; yy++) for (let xx = x; xx < x + Math.ceil(acres * 4 / side); xx++) {
      const i = tileAt(xx, yy);
      if (i < 0 || w.parcelOf[i] !== pid) return 'The plot runs past your property line. Pick another corner.';
      const c = w.cover[i];
      if (!standableTile(c) || c === TT.TIMBER || c === TT.BELT || c === TT.SLOUGH || c === TT.PLOT || c === TT.PLOT_NEW) return 'Plots need open ground (no timber, sloughs, water or existing plots).';
      if (d.sanctuary.includes(i)) return "That's inside your sanctuary.";
      tiles.push(i);
    }
    const cost = Math.round(pt.cost * acres);
    if (st.cash < cost) return `Seed, fertilizer and equipment rental run ${WT.money(cost)}.`;
    st.cash -= cost;
    tiles.forEach((i) => setTile(i, TT.PLOT_NEW));
    d.plots.push({ type: typeId, acres, tiles, year: st.year, quality: null });
    WT.computeDerivedLayers(w);
    news(`Planted ${acres} acre${acres > 1 ? 's' : ''} of ${pt.name.toLowerCase()}. It will be ready next season.`);
    return null;
  };
  WT.digWaterhole = function (pid, x, y) {
    const st = S(), d = st.parcels[pid], w = G.world, i = tileAt(x, y), TT = T();
    if (d.owner !== 'player') return 'Only on your land.';
    if (i < 0 || w.parcelOf[i] !== pid || !standableTile(w.cover[i])) return 'Pick a spot inside your property.';
    if (d.waterholes.length >= WT.limits(pid).waterholes) return 'Water hole limit reached.';
    const cost = C().improvements.waterhole.cost;
    if (st.cash < cost) return `A dozer and liner cost ${WT.money(cost)}.`;
    st.cash -= cost; setTile(i, TT.POND); d.waterholes.push(i);
    WT.computeDerivedLayers(w);
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
      if (!standableTile(c) || c === TT.TIMBER || c === TT.BELT || c === TT.YOUNGTREES || c === TT.PLOT || c === TT.PLOT_NEW) continue;
      tiles.push(i);
    }
    if (tiles.length < 3) return 'Not enough open ground in a row there.';
    if (st.cash < cost) return `Seedlings and fabric cost ${WT.money(cost)}.`;
    st.cash -= cost;
    tiles.forEach((i) => setTile(i, TT.YOUNGTREES));
    d.trees.push({ tiles, year: st.year });
    WT.computeDerivedLayers(w);
    return null;
  };
  WT.toggleSanctuary = function (pid, x, y) {
    const st = S(), d = st.parcels[pid], w = G.world;
    if (d.owner !== 'player') return 'Only on your land.';
    let added = 0, removed = 0;
    const inSanct = d.sanctuary.includes(tileAt(x, y));
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const i = tileAt(x + dx, y + dy);
      if (i < 0 || w.parcelOf[i] !== pid) continue;
      if (d.stands.some((s) => tileAt(s.x, s.y) === i) || d.cams.some((c) => tileAt(c.x, c.y) === i)) continue;
      const k = d.sanctuary.indexOf(i);
      if (inSanct && k >= 0) { d.sanctuary.splice(k, 1); removed++; }
      else if (!inSanct && k < 0) { d.sanctuary.push(i); added++; }
    }
    return added || removed ? null : 'Nothing changed there.';
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
    const comfortable = cf.neutralTemp - warmth;
    const deficit = comfortable - effTemp;
    let hrs = cf.basePatienceHrs + st.skills.patience * cf.hrsPerPatiencePt + stand.patienceHrs;
    for (const id in pack) { const c = WT.consum(id); if (c && pack[id] > 0 && c.sitMin) hrs += (c.sitMin * Math.min(pack[id], 2)) / 60; }
    let cold = 0, hot = 0, sweat = 0;
    if (deficit > 0) { cold = deficit; hrs -= (deficit * cf.minPerDegree) / 60; }
    const over = effTemp - comfortable - cf.overheatMargin;
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
  WT.hasBow = () => false; // bows arrive in a later update
  WT.SPOT_LIMITS = { perArea: 3, total: 10 };
  WT.markSpot = function (pid, x, y) {
    const st = S(), d = st.parcels[pid], w = G.world, i = tileAt(x, y);
    if (d.owner !== 'public') return 'Spots are marked on public land. On your own land, put up a stand.';
    if (d.bowOnly && !WT.hasBow()) return 'This area is bow only. Bows are coming in a later update.';
    if (i < 0 || w.parcelOf[i] !== pid || !standableTile(w.cover[i])) return 'Pick a tree or ground spot inside the public area.';
    d.spots = d.spots || [];
    const total = WT.publicAreas().reduce((a, p) => a + (st.parcels[p.id].spots || []).length, 0);
    if (d.spots.length >= WT.SPOT_LIMITS.perArea) return `You can mark ${WT.SPOT_LIMITS.perArea} spots per public area. Remove one first.`;
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
    const inv = S().inv, out = [{ id: 'ground', ok: true }];
    for (const id of ['climber', 'hangon', 'saddle', 'popup']) {
      if (!inv.stands[id]) continue;
      const t = WT.standType(id);
      if (t.bowOnly && !WT.hasBow()) { out.push({ id, ok: false, why: 'bow only' }); continue; }
      if (id !== 'popup' && spot && !spot.tree) { out.push({ id, ok: false, why: 'needs a tree' }); continue; }
      out.push({ id, ok: true });
    }
    return out;
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

  /* ================================================================ hit list (screens spec) */
  // Frozen look of a deer at a moment: enough to re-render it exactly as it looked then.
  WT.snapshot = function (deer) {
    return { k: deer.id, sex: deer.sex, age: deer.age, lw: deer.lw, bg: deer.bodyGene, style: deer.style, rack: deer.rack, y: S().year, d: S().day };
  };
  WT.snapDeer = (s) => ({ id: s.k, sex: s.sex, age: s.age, lw: s.lw, bodyGene: s.bg, style: s.style, rack: s.rack });
  function suggestAge(deer, level) {
    const err = level >= 4 ? 0.5 : 1.5;
    const h = WT.hash2(deer.id, S().year, 31) - 0.5;
    return Math.max(0.5, Math.round((deer.age + h * 2 * err) * 2) / 2 - (Math.round((deer.age + h * 2 * err) * 2) % 2 === 0 ? 0.5 : 0));
  }
  WT.hitEntry = (deerId) => S().hitList.find((e) => e.k === deerId);
  WT.estAgeNow = (e) => e.estAge + (S().year - e.estYear);
  // Record a sighting or photo. Adds bucks seen clearly; does only when asked (force).
  WT.noteDeer = function (deer, info) {
    const st = S();
    let e = WT.hitEntry(deer.id);
    const clear = info.level >= 3;
    const antlered = deer.sex === 'b' && deer.age >= 1.5;
    if (!e) {
      if (!clear || (!antlered && !info.force)) return null;
      e = {
        k: deer.id, name: info.name || null, status: antlered ? 'Watch' : deer.sex === 'd' && deer.age >= 1 ? 'Doe' : 'Watch',
        estAge: suggestAge(deer, info.level), estYear: st.year, notes: '', places: [], log: [], snap: null, photos: [], added: [st.year, st.day],
      };
      st.hitList.unshift(e);
      info.added = true;
    }
    if (clear) e.snap = WT.snapshot(deer);
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

  // Public land: other hunters
  WT.publicCompetition = function (pid) {
    const st = S(), d = st.parcels[pid];
    if (d.owner !== 'public') return null;
    const weekend = st.day % 7 >= 5;
    const p = 0.12 + (weekend ? 0.15 : 0) + (/Seek|Peak/.test(WT.rutPhase(st.day).name) ? 0.1 : 0);
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
    const end = plan.win[1];
    const log = [];
    if (!hasLight && setup.session !== 'evening') start = plan.legalStart + 0.4;
    // evening hunters time their walk-in so they're on stand for the last light
    if (setup.session === 'evening') start = Math.max(start, Math.min(end, plan.sun.set) - plan.maxHrs + 0.25);
    const endEarly = !hasLight && setup.session !== 'morning' ? plan.sun.set : end; // no light: walk out before dark
    const sitEnd = Math.min(endEarly, start + plan.maxHrs);
    const rating = standRatingFor(stand.r, setup.session, st.day);
    const goodWind = stand.r.goodWinds.includes(st.weather.windDir);
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
    const pPerSit = cfg.deer.pressure.perSit * (goodWind ? 1 : 1.8) * (0.6 + walkNoise) + competition;
    const pressureCtx = clamp((d.pressure || 0) * 0.4 + (stand.pressure || 0) * 0.45 + competition);
    // how far you can see from here: timber stands see 60 yd, a field-edge box blind 500
    const vis = clamp(stand.r.visibility * 0.65 + sType.visibility / 100 * 0.35);
    const maxView = Math.round(45 + vis * vis * 455);

    const ctx = {
      pressure: pressureCtx, rut, weather: st.weather.move * (used.tinks && /Seek|Peak|Pre/.test(rut.name) ? 1.15 : 1),
      tod: setup.session === 'allday' ? 1.15 : 1, place: rating, matureRating: stand.r.mature,
      hours: plan.windowHrs, viewShare: WT.viewShare(parcel.acres) * (0.6 + sType.visibility / 100 * 0.5) * (0.7 + stand.r.visibility * 0.5),
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
    for (const deer of herd) {
      if (deer.mom && herd.some((m) => m.id === deer.mom)) continue; // fawns follow mom
      if (!rng.chance(WT.sightingChance(deer, ctx))) continue;
      const members = [deer, ...(byMom[deer.id] || []).filter(() => rng.chance(0.85))];
      sched.push({ t: pickTime(deer), members });
    }
    // rut: a buck sometimes trails a doe group
    if (/Seek|Peak/.test(rut.name)) for (const sg of sched) if (sg.members[0].sex === 'd' && rng.chance(0.25)) {
      const b = herd.find((x) => x.sex === 'b' && x.age >= 1.5 && !sched.some((q) => q.members.includes(x)) && rng.chance(0.3 * x.tOP));
      if (b) sg.members.push(b);
    }
    if (rng.chance(walkNoise * 0.6) && sched.length) {
      sched.splice(rng.int(0, sched.length - 1), 1);
      log.push({ t: start, kind: 'bad', text: 'Walking in you hear a snort and crashing brush. Something was bedded close and blew out ahead of you.' });
    } else if (walkNoise > 0.45) log.push({ t: start, kind: 'warn', text: 'Your walk in was noisy. Leaves crunched with every step.' });
    for (const sg of sched) if (sg.t < start) sg.done = true; // came through before you got there
    sched.sort((a, b) => a.t - b.t);
    // how close deer tend to come: earned with placement, wind, concealment, quiet and scent control
    const closeF = clamp(0.2 + rating * 0.35 + (goodWind ? 0.15 : -0.1) + conceal * 0.12 + quiet * 0.08 + scentCtl * 0.1);

    const H = {
      setup, plan, rifle, scope, eq, used, prop, parcel, stand, sType, rating, goodWind, rut, maxView, closeF,
      start, end, sitEnd, now: start, sched, log, visible: [], seenIds: new Set(), unknown: 0, calls: 0,
      scentCtl, conceal, quiet, walkNoise, pPerSit, ctx, hasLight, over: false, endReason: null,
      rounds: rifle.mag, harvested: [], wounded: [], shots: 0, misses: 0, xp: 0, groupSeq: 1, selected: null, ranged: {},
      cover: w.cover[stand.y * w.W + stand.x], addedToList: [],
    };
    const where = d.owner === 'public' ? ' (public land)' : d.owner === 'npc' ? ` (${parcel.ownerName}'s land)` : '';
    const sName = stand.name || WT.standType(standTypeId).name.toLowerCase();
    log.unshift({ t: start, kind: 'head', text: `${WT.fmtTime(start)}. You ${hasLight || setup.session === 'evening' ? 'head in' : 'stumble in without a light'} to ${stand.kind === 'spot' ? 'your marked spot' : 'the'} ${sName} on ${parcel.name}${where}.` });
    log.push({ t: start, kind: 'info', text: `${WT.weatherLine(st.weather)}. It feels like ${plan.effTemp}°F. ${goodWind ? 'The wind feels right for this spot.' : 'The wind is wrong for this spot. Anything downwind will smell you.'}` });
    if (setup.competition) log.push({ t: start, kind: 'warn', text: 'You can hear another hunter walking in somewhere off to the east.' });
    if (plan.deficit > 0) log.push({ t: start, kind: 'warn', text: `You're dressed for about ${plan.comfortable}°F. You'll get cold after ${fmtDur(plan.maxHrs)}.` });
    if (plan.hot > 0) log.push({ t: start, kind: 'warn', text: 'You were sweating on the walk in. Your scent is going to carry.' });
    if (!plan.blazeOk) log.push({ t: start, kind: 'bad', text: 'You forgot blaze orange. If the warden checks you it is a $100 ticket.' });
    G.hunt = H;
    st.stats.hunts++;
    st.seasonLog.hunts++;
    return H;
  };

  function fmtDur(h) { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return hh ? `${hh} hr${mm ? ' ' + mm + ' min' : ''}` : `${mm} min`; }
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
    return { x, dist: Math.max(5, Math.round(dist)) };
  }
  WT.groupPos = pathPos;

  function spawnGroup(H, sg) {
    const rng = G.rng;
    const fromCall = !!sg.fromCall;
    const mature = sg.members.some((m) => m.sex === 'b' && m.age >= 3.5);
    const close = clamp(H.closeF + (fromCall ? 0.25 : 0) - (mature ? 0.12 : 0) + rng.range(-0.25, 0.25));
    const d0 = Math.round(H.maxView * rng.range(0.55, 1));
    const d1 = Math.round(H.maxView * rng.range(0.5, 1));
    const dmin = Math.max(6, Math.round(Math.min(d0, d1) * (1 - close) * rng.range(0.55, 1)));
    const left = rng.chance(0.5);
    const feeding = !mature && rng.chance(H.cover === T().PLOT || COVER_FOOD(H) ? 0.55 : 0.3);
    const quick = rng.chance(mature ? 0.4 : 0.2);
    const g = {
      gid: H.groupSeq++, members: sg.members.map((deer, k) => ({ deer, dx: (k ? rng.range(-0.18, 0.18) : 0), dd: (k ? rng.range(-6, 10) : 0), lag: k * 0.06 })),
      x0: left ? -1.15 : 1.15, x1: (left ? 1 : -1) * rng.range(0.6, 1.2), d0, d1, dmin, p: 0,
      stay: quick ? rng.int(1, 2) : feeding ? rng.int(5, 10) : rng.int(2, 5), feeding, alert: 0, gone: false, fromCall,
      offersShot: rng.chance(clamp((mature ? 0.32 : 0.55) + H.sType.accuracy / 400 + (fromCall ? 0.15 : 0))), clear: false, pose: 'walk', step: 0,
    };
    g.lead = g.members[0].deer;
    g.dist = pathPos(g, 0).dist;
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
      const first = !H.seenIds.has(m.deer.id);
      if (first) { H.seenIds.add(m.deer.id); H.xp += C().progression.xpPerSighting; }
      if (lvl >= 3) {
        const where = (H.stand.name || WT.standType(H.stand.type).name) + ', ' + H.parcel.name;
        const doing = g.feeding ? 'feeding' : g.alert ? 'alert' : 'walking';
        const already = WT.hitEntry(m.deer.id);
        if (!already || !m.logged) {
          const e = WT.noteDeer(m.deer, { level: lvl, pid: H.setup.pid, time: H.now, where, dist: H.ranged[g.gid] ? dist : null, doing, kind: 'sighting' });
          if (e) { m.logged = true; if (!already) { H.addedToList.push(e); H.log.push({ t: H.now, kind: 'info', text: 'You got a clear look. Added to your hit list.' }); } }
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
          g.gone = true; g.busted = true;
          H.prop.huntingPressure = clamp(H.prop.huntingPressure + 0.03);
          H.stand.pressure = clamp((H.stand.pressure || 0) + 0.06);
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
    for (const sg of H.sched) {
      if (sg.done || sg.cancel || sg.t > H.now) continue;
      sg.done = true;
      spawnGroup(H, sg);
    }
    moveGroups(H);
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
    if (H.rounds <= 0) return { ok: false, reason: 'Out of rounds.' };
    return { ok: true, clear: t.g.clear };
  };

  function hitChance(H, g, m) {
    const st = S();
    const r = H.rifle, sc = H.scope;
    const dist = Math.max(5, g.dist + m.dd);
    const effRange = r.range * 3;
    let acc = r.acc * 0.55 + sc.acc + st.skills.shooting * 0.8 + H.sType.accuracy * 0.18 + 25;
    acc -= r.recoil * 0.15 * (1 - st.skills.shooting / 60);
    if (dist > effRange) acc -= (dist - effRange) * 0.45;
    if (dist > 150) acc -= H.ranged[g.gid] ? 0 : (dist - 150) * 0.08;
    if (WT.lightFactor(H) < 1) acc -= 18 * (1 - sc.low / 100);
    if (!g.clear) acc -= 35;
    if (g.pose === 'walk') acc -= 8;
    if (H.plan.cold > 8) acc -= Math.min(15, (H.plan.cold - 8) * 0.8) * clamp((H.now - H.start) / Math.max(0.5, H.plan.maxHrs));
    if (m.deer.sex === 'b' && m.deer.gross > 130) acc -= Math.max(0, 14 - st.skills.shooting * 0.5); // buck fever
    if (g.alert) acc -= 5;
    return clamp(acc / 100, 0.05, 0.97);
  }

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
    H.log.push({ t: H.now, kind: 'shot', text: `BOOM. The ${r.name} (${r.cal}) barks${g.clear ? '' : ' through the brush'}.` });
    H.prop.huntingPressure = clamp(H.prop.huntingPressure + 0.05);
    H.stand.pressure = clamp((H.stand.pressure || 0) + 0.06);
    // everyone else in the group bolts
    g.members.forEach((x) => { if (x !== m) x.fled = true; });
    if (!rng.chance(p)) {
      H.misses++; st.stats.misses++;
      H.log.push({ t: H.now, kind: 'bad', text: rng.pick(['Clean miss. Dirt kicks up behind it.', 'You see the bullet smack a branch. Miss.', 'The deer flinches at the shot and bounds off untouched.']) });
      g.alert = 2;
      if (rng.chance(0.3 * (1 - r.recoil / 150)) && H.rounds > 0) { g.p = Math.max(0, g.p - 0.1); g.dmin += 30; H.log.push({ t: H.now, kind: 'warn', text: 'It stops farther out and looks back. Follow-up shot?' }); }
      else { g.gone = true; H.log.push({ t: H.now, kind: 'bad', text: 'Gone.' }); }
      cleanup(H); return;
    }
    const effRange = r.range * 3;
    const vital = clamp(0.62 + r.power * 0.0035 - Math.max(0, dist - effRange) * 0.005 + st.skills.shooting * 0.004 + (g.clear ? 0.05 : -0.2));
    g.gone = true;
    if (rng.chance(vital)) harvest(H, g, deer, dist, rng.chance(0.5) ? 'drops in its tracks' : `runs ${rng.int(30, 90)} yards and piles up`);
    else {
      const recover = clamp(0.3 + st.skills.woodcraft * 0.012 + r.power * 0.002 + (H.hasLight ? 0.08 : -0.05));
      H.log.push({ t: H.now, kind: 'warn', text: 'Hit! It hunches and runs hard. That looked a little far back.' });
      if (rng.chance(recover)) harvest(H, g, deer, dist, 'after a long blood trail, you find it piled up in the cattails');
      else {
        H.wounded.push(deer); st.stats.wounded++;
        H.prop.herd.splice(H.prop.herd.indexOf(deer), 1); // a lost deer is a dead deer
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
    H.prop.herd.splice(H.prop.herd.indexOf(deer), 1);
    const antlered = deer.sex === 'b' && deer.age >= 1.5;
    // legal check: antlered deer need a buck tag; antlerless deer (does, fawns, button bucks) a doe tag
    let legal = true, tagUsed;
    if (antlered) { if (st.tags.buck > 0) { st.tags.buck--; st.tags.buckFilled++; tagUsed = 'buck'; } else legal = false; }
    else if (st.tags.doe > 0) { st.tags.doe--; st.tags.doeFilled++; tagUsed = 'doe'; } else legal = false;
    const sheet = antlered ? WT.measureRack(WT.rackGeom(deer)) : null;
    let pay = legal ? WT.payoutFor(deer, rng) : 0;
    let xp = antlered ? P.xpBuckBase + Math.max(0, deer.gross - 100) * P.xpPerInch : P.xpDoe;
    xp += deer.age >= 4.5 ? 40 : 0;
    if (!legal) { xp = 10; st.cash -= 500; }
    const entry = WT.hitEntry(deer.id);
    const rec = {
      id: deer.id, y: st.year, d: st.day, sex: deer.sex, age: deer.age, lw: deer.lw, dw: Math.round(deer.lw * cfg.deer.weights.dressed),
      gross: deer.gross || 0, net: deer.net || 0, pL: deer.pL || 0, pR: deer.pR || 0, nt: !!deer.nt, abn: deer.abn || 0, sheet,
      pay, xp: Math.round(xp), parcel: H.parcel.name, rifle: H.rifle.name, cal: H.rifle.cal, dist, label: WT.deerLabel(deer), session: H.setup.session, time: H.now,
      snap: WT.snapshot(deer), legal, tagUsed, hit: entry ? { name: entry.name, estAge: WT.estAgeNow(entry), status: entry.status, log: entry.log.slice(0, 12), photos: entry.photos.slice(0, 3), notes: entry.notes } : null,
      wall: antlered && legal,
    };
    if (entry) WT.removeHit(deer.id);
    st.journal.unshift(rec);
    st.seasonLog.harvest.push(rec);
    st.cash += pay;
    H.xp += xp;
    H.harvested.push(rec);
    if (legal) H.log.push({ t: H.now, kind: 'good', text: `It ${how}. Deer down! Time to go see what you got.` });
    else H.log.push({ t: H.now, kind: 'bad', text: `It ${how}. Walking up, your stomach drops: ${antlered ? 'antlers. You only had a doe tag.' : 'no antlers, and you only had a buck tag.'} A warden writes you a $500 ticket and takes the deer.` });
    H.lastHarvest = rec;
  }

  // Raise binoculars or the scope: a closer look (and movement a close deer may catch)
  WT.raiseOptic = function (kind) {
    const H = G.hunt; if (!H) return null;
    const optic = kind === 'scope' ? Object.assign({ kind: 'scope' }, H.scope) : H.eq.binoculars ? Object.assign({ kind: 'bino' }, H.eq.binoculars) : null;
    if (!optic) return null;
    H.raised = true;
    for (const g of H.visible) observe(H, g, optic);
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
      let p = 0.035 * rutF * skill * rangeF * (d.tOP / 0.6) * (kind === 'rattle' ? 1.3 : 1) * WT.viewShare(H.parcel.acres) ** 0.5;
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
    H.stand.pressure = clamp((H.stand.pressure || 0) + H.pPerSit * 1.5);
    H.stand.sits = (H.stand.sits || 0) + 1;
    H.stand.sessions = H.stand.sessions || {};
    H.stand.sessions[H.setup.session] = (H.stand.sessions[H.setup.session] || 0) + 1;
    H.stand.recent = H.stand.recent || [];
    H.stand.recent.unshift({ y: st.year, d: st.day, s: H.setup.session, seen: H.seenIds.size, wind: st.weather.windDir });
    if (H.stand.recent.length > 8) H.stand.recent.length = 8;
    if (d.owner === 'public') d.scoutSits = (d.scoutSits || 0) + 1;
    const P = cfg.progression;
    H.xp += hours * P.xpPerHourSat;
    st.stats.hours += hours; st.stats.seen += H.seenIds.size;
    H.levelUps = WT.addXp(H.xp);
    if (!H.plan.blazeOk && G.rng.chance(0.15)) { st.cash -= 100; news('A game warden checked you without blaze orange. $100 fine.', 'bad'); H.log.push({ t: H.now, kind: 'bad', text: 'A game warden is waiting at your truck. No blaze orange: $100 fine.' }); }
    st.lastHunt = { pid: H.setup.pid, sid: H.stand.sid, session: H.setup.session, seen: H.seenIds.size, harvested: H.harvested.length };
    advanceAfterHunt(H.setup.session);
    WT.save();
    return H;
  };

  // What you've learned about a stand or spot: revealed by sitting it (stars), never the raw numbers.
  WT.standKnowledge = function (s) {
    const sits = s.sits || 0, ses = s.sessions || {};
    const conf = (n) => (n >= 4 ? 'sure' : n >= 2 ? 'getting a feel' : n >= 1 ? 'first impression' : 'unknown');
    const stars = (v, n, salt) => {
      if (!n) return null;
      const noise = (WT.hash2(s.x, s.y, salt) - 0.5) * 2 * (1.6 / n);
      return Math.max(1, Math.min(5, Math.round(1 + v * 4 + noise)));
    };
    return {
      morning: { stars: stars(s.r.morning, (ses.morning || 0) + (ses.allday || 0), 1), conf: conf((ses.morning || 0) + (ses.allday || 0)) },
      evening: { stars: stars(s.r.evening, (ses.evening || 0) + (ses.allday || 0), 2), conf: conf((ses.evening || 0) + (ses.allday || 0)) },
      rut: { stars: stars(s.r.rut, sits >= 3 ? sits - 1 : 0, 3), conf: conf(sits - 1) },
      mature: { stars: stars(s.r.mature, sits >= 4 ? sits - 2 : 0, 4), conf: conf(sits - 2) },
      winds: sits >= 2 ? s.r.goodWinds.slice(0, Math.min(4, sits)) : null,
      view: sits >= 1 ? (s.r.visibility > 0.7 ? 'Long views' : s.r.visibility > 0.4 ? 'Medium views' : 'Tight cover, short views') : null,
      sits,
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

  function nextDay() {
    const st = S(), cfg = C(), rng = G.rng;
    st.day++;
    st.slot = 'morning';
    const decay = cfg.deer.pressure.decay;
    for (const p of G.world.parcels) {
      const d = st.parcels[p.id];
      const floor = d.owner === 'public' ? cfg.deer.pressure.publicFloor : 0.02;
      d.pressure = Math.max(floor, (d.pressure || 0) * decay);
      for (const s of d.stands) s.pressure = (s.pressure || 0) * decay;
      // neighbors and other hunters
      const prop = makeProp(p.id);
      const died = WT.inSeasonDailyMortality(prop, rng, cfg.calendar.seasonDays);
      d.herd = prop.herd;
    }
    cameraDay();
    if (st.day >= cfg.calendar.seasonDays) { G.seasonOver = true; return; }
    st.weather = rollWeather(st.day, st.weather, rng);
    const rut = WT.rutPhase(st.day), prev = WT.rutPhase(st.day - 1);
    if (rut !== prev) news(`${rut.name} has started.${/Seek/.test(rut.name) ? ' Mature bucks are on their feet in daylight. Hunt all day if you can.' : ''}`, 'info');
    if (st.weather.front) news('Cold front coming through today. Tomorrow should be a good one.');
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
      if (d.owner !== 'player' || !d.cams.length) continue;
      for (const cam of d.cams) {
        const ct = WT.camType(cam.type);
        const i = cam.y * G.world.W + cam.x;
        const traffic = 0.25 + G.world.travel[i] * 0.9;
        for (const deer of d.herd) {
          if (deer.age < 1 && rng.chance(0.6)) continue;
          const p0 = 0.09 * ct.detect * traffic * (deer.tOP / 0.6) * WT.viewShare(p.acres) ** 0.6;
          if (!rng.chance(p0)) continue;
          const night = deer.sex === 'b' && deer.age >= 3.5 ? rng.chance(0.85) : rng.chance(0.45);
          const dist = Math.round(rng.range(6, 28));
          const photo = { y: st.year, d: st.day, hour: night ? rng.pick([22, 23, 1, 2, 3, 4, 5]) : rng.pick([7, 8, 17, 18]), night, dist, yaw: rng.pick([-90, -60, -30, 30, 60, 90, 150, -150]),
            pose: rng.pick(['walk', 'down', 'up', 'alert']), cam: cam.cid, camType: cam.type, pid: p.id, snap: WT.snapshot(deer) };
          photo.q = clamp((night ? ct.night : 0.95) * (1 - dist / 45));
          if (ct.cell) deliverPhoto(photo, deer);
          else { (cam.queue = cam.queue || []).push(photo); cam.pending = cam.queue.length; }
        }
      }
    }
    if (st.photos.length > 80) st.photos.length = 80;
  }
  function deliverPhoto(photo, deer) {
    const st = S();
    st.photos.unshift(photo);
    // a decent photo of a buck puts him on the hit list (images only, never numbers)
    if (deer && photo.q >= 0.45) WT.noteDeer(deer, { level: 3, pid: photo.pid, time: photo.hour, where: 'Trail camera, ' + G.world.parcels[photo.pid].name, dist: null, doing: 'on camera', kind: 'photo', photo });
  }
  WT.checkCameras = function (pid) {
    const st = S(), d = st.parcels[pid];
    let n = 0;
    for (const cam of d.cams) {
      if (!cam.queue) continue;
      for (const ph of cam.queue) { const deer = d.herd.find((x) => x.id === ph.snap.k); deliverPhoto(ph, deer); n++; }
      cam.queue = []; cam.pending = 0;
    }
    d.pressure = clamp((d.pressure || 0) + 0.04);
    return n;
  };

  /* ================================================================ season end */
  WT.endSeason = function () {
    const st = S(), cfg = C(), rng = G.rng, w = G.world;
    const summary = { year: st.year, harvest: st.seasonLog.harvest.slice(), hunts: st.seasonLog.hunts, tax: 0, events: [] };
    // taxes
    let tax = 0;
    for (const p of w.parcels) if (st.parcels[p.id].owner === 'player') tax += WT.landPrice(p.id) * cfg.economy.propertyTaxRate;
    tax = Math.round(tax);
    st.cash -= tax; summary.tax = tax;
    // cellular plans
    let plans = 0;
    for (const p of w.parcels) for (const c of st.parcels[p.id].cams) { const ct = WT.camType(c.type); if (ct.cell) plans += ct.plan; }
    if (plans) { st.cash -= plans; summary.plans = plans; }
    // improvements mature
    const TT = T();
    for (const p of w.parcels) {
      const d = st.parcels[p.id];
      for (const pl of d.plots) {
        if (pl.quality === null || pl.year === st.year) {
          const pt = WT.plotType(pl.type);
          const shade = pl.tiles.reduce((a, i) => a + (G.world.distWater[i] < 3 ? 0.05 : 0), 0) / pl.tiles.length;
          const q = clamp(0.45 + p.habitat.soil * 0.35 + rng.range(-0.25, 0.25) - shade - (pl.acres < 1 ? 0.15 : 0) + (pl.acres >= 2 ? 0.05 : 0));
          pl.quality = q < 0.3 ? 'poor' : q < 0.55 ? 'fair' : q < 0.8 ? 'good' : 'excellent';
          pl.q = q * pt.food;
          pl.tiles.forEach((i) => setTile(i, TT.PLOT));
          summary.events.push(`Your ${pt.name.toLowerCase()} plot on ${p.name} came in ${pl.quality}.`);
        }
      }
      // annual plots need replanting; clover lasts several years
      d.plots = d.plots.filter((pl) => {
        const pt = WT.plotType(pl.type);
        const life = pt.perennial || 1;
        if (st.year + 1 - pl.year >= life + 1) { pl.tiles.forEach((i) => setTile(i, TT.PASTURE)); summary.events.push(`A ${pt.name.toLowerCase()} plot on ${p.name} ran its course. Replant it.`); return false; }
        return true;
      });
      for (const tr of d.trees) {
        if (!tr.mature && st.year + 1 - tr.year >= cfg.improvements.trees.matureYears) { tr.mature = true; tr.tiles.forEach((i) => setTile(i, TT.BELT)); summary.events.push(`A shelterbelt row on ${p.name} has grown into real cover.`); }
      }
    }
    WT.computeDerivedLayers(w);
    // deer: yearly cycle for every property
    const winter = clamp(rng.normal(0.4, 0.2));
    const yearFactor = 1 + rng.range(-cfg.deer.yearlyVariance, cfg.deer.yearlyVariance);
    summary.winter = winter > 0.65 ? 'a brutal winter' : winter > 0.45 ? 'a typical North Dakota winter' : 'a mild winter';
    summary.growing = yearFactor > 1.03 ? 'a wet summer with great growing conditions' : yearFactor < 0.97 ? 'a dry summer' : 'an average summer';
    // whole-map year: every parcel's cycle, dispersal between real parcels, population stabilizer
    const props = w.parcels.map((p) => { const pr = makeProp(p.id); pr.neighbors = [...p.neighbors]; pr.npcStyle = st.parcels[p.id].npcStyle; return pr; });
    const res = WT.worldYear(props, rng, { winter, yearFactor, seasonMortalityApplied: true }, st.worldSim);
    st.worldSim = res.world;
    props.forEach((pr, k) => {
      const p = w.parcels[k], d = st.parcels[p.id];
      d.herd = pr.herd; d.capacity = pr.capacity; d.pressure = pr.huntingPressure;
      for (const s2 of d.stands) s2.pressure = 0;
      for (const s2 of d.spots || []) s2.pressure = 0;
      if (res.logs[k].disease && d.owner === 'player') summary.events.push(`EHD hit ${p.name} in late summer. You found dead deer near the water.`);
    });
    // reset season
    st.year++; st.day = 0; st.slot = 'morning';
    st.tags = { buck: 0, doe: 0, buckFilled: 0, doeFilled: 0 };
    st.seasonLog = { hunts: 0, harvest: [] };
    st.weather = rollWeather(0, null, rng);
    rotateListings();
    G.seasonOver = false;
    news(`Year ${st.year}. New season, new tags. Property tax: ${WT.money(tax)}.`);
    WT.save();
    return summary;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
