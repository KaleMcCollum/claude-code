/* Whitetail Country UI: loadout, the hunt view (first person from the stand), hunt summary. */
(function () {
  const WT = window.WT, UI = window.WTUI;
  const { $, esc } = UI;
  const S = () => WT.game.state;
  const Wd = () => WT.game.world;
  const T = WT.T;
  const SW = 240, SH = 135; // scene pixels
  const HORIZON = 60;
  // One perspective rule for both size and height on screen: 1 at 20 yards, shrinking with distance.
  // Far deer sit up by the horizon and are small; near deer are low and big. Never one without the other.
  const persp = (d) => 32 / (Math.max(15, d) + 12);
  const groundY = (d) => HORIZON + 4 + 61 * persp(d);

  function findStand(pid, sid) {
    const d = S().parcels[pid];
    return [...(d.stands || []), ...(d.spots || [])].find((s) => s.sid === sid);
  }

  /* ================================================================ LOADOUT */
  UI.screens.loadout = function (el, args) {
    const st = S(), w = Wd();
    const d = st.parcels[args.pid], p = w.parcels[args.pid];
    const stand = findStand(args.pid, args.sid);
    if (!stand) return UI.go('map', { mode: 'hunt' });
    const lo = st.loadout;
    lo.pack = lo.pack || {};
    const isSpot = stand.kind === 'spot';
    const sessions = st.slot === 'morning' ? ['morning', 'allday'] : ['evening'];
    const sel = { session: sessions.includes(args.session) ? args.session : sessions[0], carry: args.carry || (isSpot ? (WT.mobileOptions(stand).filter((o) => o.ok).slice(-1)[0] || { id: 'ground' }).id : null) };
    const state = { edit: false };
    const render = () => {
      const standType = sel.carry || stand.type;
      // keep the pack within what you own
      for (const id in lo.pack) { const have = id === 'propane' ? st.inv.propane : st.inv.consum[id] || 0; if (lo.pack[id] > have) lo.pack[id] = have; }
      const plan = WT.sitPlan({ session: sel.session, standType, clothing: lo.clothing, equip: lo.equip, pack: lo.pack });
      const warns = [];
      if (!plan.blazeOk) warns.push('<span class="bad">Rifle season: blaze orange required.</span>');
      if (plan.hot > 0) warns.push('<span class="warn">You\'ll likely overheat and sweat.</span>');
      if (!plan.allDayOk) warns.push(`<span class="warn">You can only sit about ${WT.fmtDur(plan.maxHrs)}. An all-day sit needs about ${WT.fmtDur(plan.windowHrs)}.</span>`);
      if (plan.heaterNote) warns.push(`<span class="warn">${esc(plan.heaterNote)}</span>`);
      if (!st.tags.buck && !st.tags.doe) warns.push('<span class="bad">You have no tags. You can hunt and scout, but not shoot.</span>');
      if (!lo.equip.light && sel.session !== 'evening') warns.push('<span class="warn">No light: you\'ll stumble in late after first light.</span>');
      if (!lo.equip.light && sel.session !== 'morning') warns.push('<span class="warn">No light: you\'ll have to leave at sunset.</span>');
      // only what you already own: buying happens in the Shop, not here
      const owned = WT.CONFIG.consumables.filter((c) => !c.battery && (c.fuel ? st.inv.propane : st.inv.consum[c.id] || 0) > 0);
      const outfitLine = Object.values(lo.clothing).filter(Boolean).map((id) => WT.cloth(id).name).join(', ');
      const beltLine = Object.values(lo.equip).filter(Boolean).map((id) => WT.equip(id).name).join(', ');
      const r = WT.rifle(lo.rifle);
      el.innerHTML = `<section class="panel"><div class="row" style="justify-content:space-between"><h2>${esc(stand.name || WT.standType(stand.type).name)} · ${esc(p.name)}</h2><button class="btn small" id="back">Back to map</button></div>
        <div class="row">${sessions.map((s) => `<button class="btn ${sel.session === s ? 'on' : ''}" data-ses="${s}">${WT.CONFIG.sessions[s].name}</button>`).join('')}
          ${isSpot ? WT.mobileOptions(stand).filter((o) => o.ok).map((o) => `<button class="btn small ${sel.carry === o.id ? 'on' : ''}" data-carry="${o.id}">${esc(WT.standType(o.id).name.replace(/ \(.*\)/, ''))}</button>`).join('') : ''}</div>
        <p class="dim">${esc(WT.CONFIG.sessions[sel.session].note)}</p>
        <div class="item" style="margin-top:8px"><div><span class="nm">${esc(r.name)}</span> <span class="dim">${esc(r.cal)}</span></div><button class="btn small" id="chg">${state.edit ? 'Done' : 'Change gear'}</button>
          <div class="st">${esc(outfitLine)}${beltLine ? '<br>' + esc(beltLine) : ''}</div></div>
        ${state.edit ? `<div id="outfit">${UI.outfitEditor(lo)}</div>` : ''}
        <h3>Pack</h3>
        ${owned.length ? `<div class="row">${owned.map((c) => { const have = c.fuel ? st.inv.propane : st.inv.consum[c.id]; const n = lo.pack[c.id] || 0; return `<span class="item" style="grid-template-columns:auto auto auto auto;gap:6px" title="${esc(UI.consumDesc(c))}"><span class="nm">${esc(c.name.replace(/ \(.*\)/, ''))}</span>
          <button class="btn small" data-pk="${c.id}" data-d="-1" ${n ? '' : 'disabled'}>−</button><span>${n}/${have}</span><button class="btn small" data-pk="${c.id}" data-d="1" ${n < have ? '' : 'disabled'}>+</button></span>`; }).join('')}</div>`
          : '<p class="faint">Nothing in your pack. Hand warmers and snacks are in the Shop.</p>'}
        <div class="item" style="margin-top:12px;display:block">
          <p style="margin:0">Feels like <b>${plan.effTemp}°F</b>. Dressed for <b>${plan.comfortable}°F</b>. You can sit <b>${WT.fmtDur(plan.maxHrs)}</b> of ${WT.fmtDur(plan.windowHrs)}.</p>
          ${warns.length ? `<p style="margin:4px 0 0">${warns.join('<br>')}</p>` : ''}
        </div>
        <div class="row" style="margin-top:10px"><button class="btn blaze big" id="go">Start the hunt</button></div></section>`;
      $('#back', el).addEventListener('click', () => UI.go('map', { mode: 'hunt', pid: args.pid, sid: args.sid }));
      $('#chg', el).addEventListener('click', () => { state.edit = !state.edit; render(); });
      el.querySelectorAll('[data-ses]').forEach((b) => b.addEventListener('click', () => { sel.session = b.dataset.ses; render(); }));
      el.querySelectorAll('[data-carry]').forEach((b) => b.addEventListener('click', () => { sel.carry = b.dataset.carry; render(); }));
      el.querySelectorAll('[data-pk]').forEach((b) => b.addEventListener('click', () => { const id = b.dataset.pk; lo.pack[id] = Math.max(0, (lo.pack[id] || 0) + +b.dataset.d); render(); }));
      UI.bindOutfit(el, lo, () => render());
      $('#go', el).addEventListener('click', () => {
        WT.save();
        WT.startHunt({ pid: args.pid, stand, carry: sel.carry, session: sel.session, rifle: lo.rifle, clothing: Object.assign({}, lo.clothing), equip: Object.assign({}, lo.equip), pack: Object.assign({}, lo.pack), competition: !!args.competition });
        UI.go('hunt');
      });
    };
    render();
  };

  /* ================================================================ HUNT SCENE */
  const SCENE = {
    corn: ['#b8a056', '#a48e4a'], soy: ['#a8884a', '#987a42'], stubble: ['#c6b06e', '#b8a262'], grass: ['#a88e50', '#9a8248'], plot: ['#5e9a3e', '#54903a'],
    timber: ['#5e4a34', '#4e3e2c'], snow: ['#e8e4dc', '#d8d4cc'], slough: ['#8a7c48', '#7a6e40'],
  };
  function groundColors(H) {
    const day = S().day, c = H.cover;
    if (day > 62) return SCENE.snow;
    if (c === T.PLOT || c === T.PLOT_NEW) return SCENE.plot;
    if (c === T.CORN || c === T.SUNFLOWER) return SCENE.corn;
    if (c === T.SOY) return SCENE.soy;
    if (c === T.WHEAT || c === T.HAY || c === T.PASTURE) return SCENE.stubble;
    if (c === T.SLOUGH) return SCENE.slough;
    if (c === T.TIMBER || c === T.BELT || c === T.BRUSH) return SCENE.timber;
    return SCENE.grass;
  }
  function skyColors(H) {
    const t = H.now, sun = H.plan.sun;
    if (t < sun.rise - 0.6 || t > sun.set + 0.6) return ['#141826', '#1c2032', '#262a3c'];
    if (t < sun.rise + 0.4) return ['#4a4a6a', '#a07a7a', '#e0a070'];
    if (t > sun.set - 0.5) return ['#3a3a5a', '#9a6a6a', '#e08a50'];
    return ['#8a9ab0', '#a6b2c2', '#c4ccd4'];
  }
  // Deer are always drawn facing the hunter. Distance picks the sprite size (each step is half the last).
  const poseFor = (g) => (g.pose === 'down' ? 'down' : g.pose === 'walk' ? 'walk' : 'alert');

  /* ---- the flat backdrop ----
     Flat bands of sky and ground, the way it started, with flat detail that says what kind of place this is:
     a tree line that matches the cover around the stand, a green strip if there's a food plot, a blue strip for
     water, cattails, corn rows or grass on the ground. No perspective on the scenery; only the deer change size. */
  function sceneInfo(H) {
    const w = Wd(), cnt = {}; let n = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = H.stand.x + dx, y = H.stand.y + dy; if (x < 0 || y < 0 || x >= w.W || y >= w.H) continue;
      const c = w.cover[y * w.W + x]; cnt[c] = (cnt[c] || 0) + 1; n++;
    }
    const f = (...ts) => ts.reduce((a, t) => a + (cnt[t] || 0), 0) / Math.max(1, n);
    return {
      woods: f(T.TIMBER, T.BRUSH), belt: f(T.BELT, T.YOUNGTREES), plot: (cnt[T.PLOT] || 0) > 0, newPlot: (cnt[T.PLOT_NEW] || 0) > 0,
      water: f(T.WATER, T.CREEK, T.POND) > 0.02, slough: f(T.SLOUGH) > 0.08, corn: f(T.CORN, T.SUNFLOWER) > 0.12, farm: f(T.YARD) > 0.02,
    };
  }

  function drawScene(canvas, H, t) {
    if (canvas.width !== SW) { canvas.width = SW; canvas.height = SH; }
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const st = S();
    if (!H._info) Object.defineProperty(H, '_info', { value: sceneInfo(H), enumerable: false, configurable: true });
    const info = H._info, snow = st.day > 62, bare = st.day >= 31, seed = H.stand.x * 31 + H.stand.y;
    const R = (c, x, y, wd, hg) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(wd)), Math.max(1, Math.round(hg))); };
    const hs = (a, b) => WT.hash2(a, b, seed);
    const sky = skyColors(H);
    R(sky[0], 0, 0, SW, 22); R(sky[1], 0, 22, SW, 20); R(sky[2], 0, 42, SW, HORIZON - 42);
    const night = H.now < H.plan.sun.rise - 0.6 || H.now > H.plan.sun.set + 0.6;
    if (night) { for (let n = 0; n < 26; n++) R('#d8dcf0', (n * 53 + seed * 7) % SW, (n * 29 + seed * 3) % 44, 1, 1); }
    else {
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      for (let n = 0; n < 4; n++) { const cx = ((n * 71 + seed * 13 + Math.floor(t / 2600)) % (SW + 60)) - 30, cy = 8 + (n * 11) % 26, cw = 22 + (n * 9) % 18; ctx.fillRect(cx, cy, cw, 3); ctx.fillRect(cx + 4, cy - 2, cw - 10, 2); }
      const sun = H.plan.sun, dawn = Math.abs(H.now - sun.rise) < 0.8, dusk = Math.abs(H.now - sun.set) < 0.8;
      if (dawn || dusk) { const sx = dawn ? SW * 0.72 : SW * 0.28, sy = HORIZON - 8 - Math.round(((dawn ? H.now - sun.rise : sun.set - H.now) + 0.8) * 8); ctx.fillStyle = 'rgba(255,214,150,.35)'; ctx.fillRect(sx - 9, sy - 3, 18, 6); R('#ffe2a8', sx - 4, sy - 4, 8, 8); R('#ffe2a8', sx - 5, sy - 3, 10, 6); }
    }
    // the tree line on the horizon: a wall of timber, a shelterbelt, or a thin far line in open country
    const line = snow ? '#6a6660' : '#3e3428', trunk = snow ? '#4a443e' : '#2e241a';
    const leaf = [['#a8682e', '#8c5226'], ['#b88a30', '#96702a'], ['#8a4a2a', '#6e3a22']];
    for (let x = 0; x < SW; x += 3) R(line, x, HORIZON - 3 - Math.floor(hs(x, 5) * 4), 3, 3 + Math.floor(hs(x, 5) * 4));
    if (info.farm) { R('#7a2e22', 176, HORIZON - 13, 20, 13); R(snow ? '#e8e4dc' : '#4a3a34', 175, HORIZON - 16, 22, 4); R('#b0b0b4', 200, HORIZON - 15, 7, 15); R(snow ? '#e8e4dc' : '#7a7a80', 200, HORIZON - 17, 7, 2); }
    const treeN = Math.round(Math.min(1, info.woods * 2.2) * 34), spruceN = Math.round(Math.min(1, info.belt * 5) * 14) + (info.woods < 0.1 && info.belt < 0.02 ? 0 : 2);
    for (let k = 0; k < treeN; k++) {
      const x = Math.round(hs(k, 1) * (SW - 6)) + 3, hgt = 16 + Math.floor(hs(k, 2) * 24), base = HORIZON + 1 + Math.floor(hs(k, 3) * 3);
      R(trunk, x, base - hgt, 2, hgt);
      if (bare) { R(trunk, x - 3, base - hgt + 5, 3, 1); R(trunk, x + 2, base - hgt + 3, 4, 1); R(trunk, x - 2, base - hgt + 10, 2, 1); R(trunk, x + 2, base - hgt + 9, 3, 1); if (snow) R('#e8e4dc', x - 3, base - hgt + 4, 3, 1); }
      else { const lc = leaf[k % 3]; R(lc[1], x - 5, base - hgt - 2, 12, 9); R(lc[0], x - 3, base - hgt - 5, 8, 6); R(lc[1], x - 7, base - hgt + 3, 5, 4); }
    }
    for (let k = 0; k < spruceN; k++) {
      const x = Math.round(hs(k, 7) * (SW - 10)) + 5, hgt = 12 + Math.floor(hs(k, 8) * 8);
      for (let r = 0; r < hgt; r += 2) { const wd = 1 + Math.round(r * 0.55); R(snow ? '#3a4a3a' : '#2e4a30', x - wd / 2, HORIZON - hgt + r, wd, 2); if (snow && r % 4 === 0) R('#e8e4dc', x - wd / 2, HORIZON - hgt + r, Math.max(1, wd - 1), 1); }
    }
    // ground bands, nearer = taller bands
    const gc = groundColors(H);
    let y = HORIZON, k = 0;
    while (y < SH) { const bh = Math.max(1, Math.floor((y - HORIZON) / 6) + 1); R(gc[k % 2], 0, y, SW, bh); y += bh; k++; }
    // strips across the ground: water far out, the food plot in the middle distance
    if (info.water) { R(snow ? '#b8c4cc' : '#5f7f9c', 0, 64, SW, 3); R(snow ? '#c8d2d8' : '#6f8faa', 0, 65, SW, 1); }
    if (info.plot || info.newPlot) {
      const grown = info.plot, c1 = snow ? (grown ? '#c2d0b0' : '#cfc8bc') : grown ? '#5e9a3e' : '#6e5038', c2 = snow ? (grown ? '#b0c09e' : '#bdb6aa') : grown ? '#4f8a34' : '#5e4430';
      R(c1, 0, 74, SW, 12); R(c2, 0, 77, SW, 2); R(c2, 0, 82, SW, 2);
    }
    // nothing stands on the ground where deer walk: the scenery stays up on the horizon
    if (st.weather.precip === 'snow') { ctx.fillStyle = '#ffffff'; for (let n = 0; n < 40; n++) ctx.fillRect((n * 37 + Math.floor(t / 90)) % SW, (n * 23 + Math.floor(t / 60)) % SH, 1, 1); }
    if (st.weather.precip === 'rain') { ctx.fillStyle = '#9fb3c8'; for (let n = 0; n < 40; n++) ctx.fillRect((n * 37 + Math.floor(t / 40)) % SW, (n * 23 + Math.floor(t / 25) * 3) % SH, 1, 3); }
    // deer, far to near
    const items = [];
    const lf = WT.lightFactor(H);
    for (const g of H.visible) for (const m of g.members) {
      if (m.fled) continue;
      const dist = Math.max(15, g.dist + m.dd);
      const ppiT = Math.max(0.13, Math.min(1.3, 1.3 * persp(dist)));
      const lod = Math.max(1, Math.min(4, Math.round(Math.log2(WT.ART_PPI / ppiT))));
      const sc = ppiT / (WT.ART_PPI / Math.pow(2, lod));
      const pose = poseFor(g);
      const step = pose === 'walk' ? Math.floor(t / 300) % 2 : 0;
      const spr = UI.sprite(`hv${m.deer.id}:${m.deer.age}:${lod}:${pose}:${step}:${lf < 1 ? 'l' : 'd'}`, () => WT.deerSprite(m.deer, { lod, frame: 'full', pose, step, day: st.day, mode: lf < 1 ? 'low' : 'day' }));
      const b = spr.bounds || { x0: 0, y0: 0, x1: spr.width, y1: spr.height };
      items.push({ g, m, dist, ppiT, sc, spr, b, w: Math.max(3, (b.x1 - b.x0 + 1) * sc), x: SW / 2 + (g.x + m.dx) * (SW / 2 - 14) });
    }
    // spread them out: no deer drawn on top of another
    items.sort((p, q) => p.x - q.x || p.m.deer.id - q.m.deer.id);
    for (let pass = 0; pass < 8; pass++) {
      for (let i = 0; i + 1 < items.length; i++) {
        const A = items[i], B = items[i + 1], need = (A.w + B.w) / 2 + 2, gap = B.x - A.x;
        if (gap < need) { const push = (need - gap) / 2; A.x -= push; B.x += push; }
      }
      for (const it of items) it.x = Math.max(16 + it.w / 2, Math.min(SW - 16 - it.w / 2, it.x));
    }
    items.sort((p, q) => q.dist - p.dist);
    const hits = [];
    for (const it of items) {
      const { g, m, dist, ppiT: ppi, sc: scl, spr, b } = it;
      const sc2 = scl;
      const x = Math.round(it.x), gy = Math.round(groundY(dist));
      const dw = Math.max(1, Math.round(spr.width * sc2)), dh = Math.max(1, Math.round(spr.height * sc2));
      const dx = Math.round(x - spr.anchor.x * sc2), dy = Math.round(gy - spr.anchor.y * sc2);
      ctx.drawImage(spr, 0, 0, spr.width, spr.height, dx, dy, dw, dh);
      // brush between you and the deer: no clean shot
      if (!g.clear) { ctx.fillStyle = gc[0]; const bw = Math.max(1, Math.round(4 * ppi)); for (let k = -3; k <= 3; k++) ctx.fillRect(x + k * bw * 2, gy - Math.round((12 + (k & 1) * 4) * ppi), bw, Math.round(16 * ppi) + 1); }
      const box = { id: m.deer.id, x0: dx + b.x0 * sc2, y0: dy + b.y0 * sc2, x1: dx + (b.x1 + 1) * sc2, y1: dy + (b.y1 + 1) * sc2 };
      hits.push(box);
      if (H.selected === m.deer.id) {
        ctx.fillStyle = '#ff6a1a';
        const X0 = Math.round(box.x0) - 2, Y0 = Math.round(box.y0) - 2, X1 = Math.round(box.x1) + 1, Y1 = Math.round(box.y1) + 1;
        ctx.fillRect(X0, Y0, 3, 1); ctx.fillRect(X0, Y0, 1, 3); ctx.fillRect(X1 - 2, Y0, 3, 1); ctx.fillRect(X1, Y0, 1, 3);
        ctx.fillRect(X0, Y1, 3, 1); ctx.fillRect(X0, Y1 - 2, 1, 3); ctx.fillRect(X1 - 2, Y1, 3, 1); ctx.fillRect(X1, Y1 - 2, 1, 3);
      }
    }
    // foreground: what you're sitting in
    const fg = st.day > 62 ? '#4a4038' : '#2e2418';
    const sid = H.sType.id;
    if (sid === 'box' || sid === 'house' || sid === 'popup') {
      ctx.fillStyle = sid === 'popup' ? '#3a3226' : '#2a2018';
      ctx.fillRect(0, 0, SW, 8); ctx.fillRect(0, SH - 18, SW, 18); ctx.fillRect(0, 0, 10, SH); ctx.fillRect(SW - 10, 0, 10, SH);
      ctx.fillStyle = '#1c1410'; ctx.fillRect(10, SH - 19, SW - 20, 1);
    } else if (sid === 'ground') {
      ctx.fillStyle = fg; for (let x = 0; x < SW; x += 4) ctx.fillRect(x, SH - 6 - (WT.hash2(x, 1, 2) * 10 | 0), 2, 16);
    } else {
      ctx.fillStyle = fg; ctx.fillRect(0, 0, 14, SH); ctx.fillRect(4, 10, 40, 3); ctx.fillRect(SW - 30, 30, 30, 3); ctx.fillRect(16, SH - 10, SW - 32, 3);
    }
    // darkness
    if (lf < 1) { ctx.fillStyle = `rgba(10,12,26,${lf < 0.4 ? 0.6 : 0.3})`; ctx.fillRect(0, 0, SW, SH); }
    return hits;
  }

  // Binoculars (two circles) or scope (one circle + crosshair) framed on head, neck and chest
  const OW = 176, OH = 99; // the optics view is drawn bigger: the full-size head fills the lens
  function drawOptic(canvas, H, kind, optic, t) {
    if (canvas.width !== OW) { canvas.width = OW; canvas.height = OH; }
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const st = S();
    const gc = groundColors(H), sky = skyColors(H);
    ctx.fillStyle = gc[0]; ctx.fillRect(0, 0, OW, OH);
    ctx.fillStyle = sky[2]; ctx.fillRect(0, 0, OW, 26);
    const target = (() => {
      if (H.selected) { const f = WT.findTarget(H, H.selected); if (f) return f; }
      const g = H.visible.find((x) => !x.gone); return g ? { g, m: g.members[0] } : null;
    })();
    if (target) {
      const { g, m } = target;
      const dist = Math.max(5, g.dist + m.dd);
      // what your glass can resolve decides which size of sprite you get; it is blown up to fill the lens
      const level = WT.detailLevel(H, dist, optic);
      const lod = Math.max(0, Math.min(4, 4 - level)), k = Math.pow(2, lod);
      const lf = WT.lightFactor(H);
      const pose = poseFor(g) === 'down' ? 'down' : 'alert';
      const spr = UI.sprite(`op${m.deer.id}:${m.deer.age}:${lod}:${pose}:${lf < 1 ? 'l' : 'd'}`, () => WT.deerSprite(m.deer, { lod, frame: 'bust', pose, day: st.day, mode: lf < 1 ? 'low' : 'day' }));
      const bob = g.pose === 'walk' ? (Math.floor(t / 400) % 2) * 2 : 0;
      const w = spr.width * k, h = spr.height * k;
      ctx.drawImage(spr, 0, 0, spr.width, spr.height, Math.round(OW / 2 - w / 2), Math.round(OH / 2 - h / 2) + 2 + bob, w, h);
    }
    // mask: dark everywhere except the lens circles
    const mk = document.createElement('canvas'); mk.width = OW; mk.height = OH;
    const mc = mk.getContext('2d');
    mc.fillStyle = '#0a0806'; mc.fillRect(0, 0, OW, OH);
    mc.globalCompositeOperation = 'destination-out';
    const circle = (x, y, r) => { mc.beginPath(); mc.arc(x, y, r, 0, Math.PI * 2); mc.fill(); };
    if (kind === 'scope') circle(OW / 2, OH / 2, 48); else { circle(OW / 2 - 28, OH / 2, 47); circle(OW / 2 + 28, OH / 2, 47); }
    ctx.drawImage(mk, 0, 0);
    if (kind === 'scope') { ctx.fillStyle = '#0a0806'; ctx.fillRect(OW / 2 - 48, OH / 2, 40, 1); ctx.fillRect(OW / 2 + 8, OH / 2, 40, 1); ctx.fillRect(OW / 2, OH / 2 - 48, 1, 40); ctx.fillRect(OW / 2, OH / 2 + 8, 1, 40); ctx.fillRect(OW / 2 - 48, OH / 2 - 1, 16, 3); ctx.fillRect(OW / 2 + 32, OH / 2 - 1, 16, 3); }
    if (!target) { ctx.fillStyle = '#EFE3D3'; ctx.font = '8px "Press Start 2P", monospace'; ctx.textAlign = 'center'; ctx.fillText('NOTHING IN VIEW', OW / 2, OH / 2); }
  }

  UI.screens.hunt = function (el) {
    const H = WT.game.hunt;
    if (!H) return UI.go('lodge');
    const st = S();
    let optic = null, opticKind = null, auto = false, autoTimer = null, hits = [], raf;
    el.innerHTML = UI.stage(SW, SH, `<div class="ov" style="left:6px;top:6px;font-size:18px;background:rgba(28,20,16,.75);padding:2px 6px" id="clock"></div>
      <div class="ov" style="right:6px;top:6px;font-size:18px;background:rgba(28,20,16,.75);padding:2px 6px" id="hud"></div>`) + `
      <section class="panel" style="margin-top:10px">
        <div class="row" id="ctl"></div>
        <div class="log" id="log" style="margin-top:10px" aria-live="polite"></div>
      </section>`;
    const canvas = $('canvas', el);
    const logEl = $('#log', el);
    let shown = 0;
    const renderLog = () => {
      const frag = H.log.slice(shown).map((l) => `<p class="${l.kind}"><span class="t">${WT.fmtTime(l.t)}</span>${esc(l.text).replace(/\n/g, '<br>')}</p>`).join('');
      if (frag) { logEl.insertAdjacentHTML('beforeend', frag); logEl.scrollTop = logEl.scrollHeight; shown = H.log.length; }
    };
    const draw = (t) => { if (optic) drawOptic(canvas, H, opticKind, optic, t); else hits = drawScene(canvas, H, t); };
    const hud = () => {
      const legal = WT.huntLegal(H);
      $('#clock', el).innerHTML = `${WT.fmtTime(H.now)} · ${legal ? 'legal light' : '<span class="warn">not legal light</span>'} · sit left ${WT.fmtDur(Math.max(0, H.sitEnd - H.now))}`;
      const rng = H.selected && H.visible.length ? (() => { const f = WT.findTarget(H, H.selected); return f && H.ranged[f.g.gid]; })() : null;
      $('#hud', el).innerHTML = `${H.rounds}/${H.rifle.mag} rds${rng ? ` · <span class="good">${rng} yd</span>` : ''}${optic ? ` · ${opticKind === 'scope' ? 'scope' : 'binos'} up` : ''}`;
    };
    const controls = () => {
      if (H.over) return showSummary();
      const any = H.visible.length > 0;
      const chk = H.selected ? WT.shotCheck(H, H.selected) : { ok: false, reason: 'Tap a deer in the view to pick your target.' };
      $('#ctl', el).innerHTML = `
        <button class="btn" id="sit">${any ? 'Watch' : 'Sit'} ▸</button>
        <button class="btn ${auto ? 'on' : ''}" id="auto">${auto ? 'Stop' : 'Fast-forward'} ▸▸</button>
        ${H.eq.binoculars ? `<button class="btn ${opticKind === 'bino' ? 'on' : ''}" id="bino">Binos</button>` : ''}
        <button class="btn ${opticKind === 'scope' ? 'on' : ''}" id="scope">Scope</button>
        ${H.eq.rangefinder ? '<button class="btn" id="rng" ' + (H.selected ? '' : 'disabled') + '>Range</button>' : ''}
        ${H.eq.grunt ? '<button class="btn" data-call="grunt">Grunt</button>' : ''}${H.eq.rattle ? '<button class="btn" data-call="rattle">Rattle</button>' : ''}${H.eq.snort ? '<button class="btn" data-call="snort">Snort-wheeze</button>' : ''}
        <button class="btn" id="addList" ${H.selected ? '' : 'disabled'}>Add to hit list</button>
        <button class="btn blaze" id="shoot" ${chk.ok ? '' : 'disabled'} title="${esc(chk.reason || '')}">Shoot</button>
        <button class="btn ghost" id="leave">Leave</button>
        <span class="dim" style="flex-basis:100%">${(() => { const f = H.selected && WT.findTarget(H, H.selected); if (!f || !f.m.read) return ''; const kn = WT.knownDeer(f.m); return `${kn ? `<span class="good">Hit list: ${esc(kn.name ? `"${kn.name}"` : 'unnamed deer')} · ${esc(kn.status)}.</span> ` : ''}<span class="deer" style="color:var(--cream)">Your read: ${esc(f.m.read.text)}.</span> `; })()}${chk.ok ? (chk.clear ? 'Clear shot.' : 'Brush in the way. A shot now could wound.') : esc(chk.reason || '')}</span>`;
      const on = (id, fn) => { const b = $('#' + id, el); if (b) b.addEventListener('click', fn); };
      on('sit', () => { step(); });
      on('auto', () => { auto = !auto; if (auto) runAuto(); else stopAuto(); controls(); });
      on('bino', () => toggleOptic('bino'));
      on('scope', () => toggleOptic('scope'));
      on('rng', () => { WT.range(H.selected); after(); });
      on('addList', () => { const e = WT.addSelectedToList(H.selected); if (!UI.err(e)) UI.toast('Added to your hit list.', 'good'); after(); });
      on('shoot', () => { stopAuto(); WT.shoot(H.selected); H.selected = null; optic = null; opticKind = null; if (H.harvested.length) WT.endHunt('tagged'); after(); });
      on('leave', () => { stopAuto(); WT.endHunt('left'); after(); });
      el.querySelectorAll('[data-call]').forEach((b) => b.addEventListener('click', () => { WT.call(b.dataset.call); after(); }));
    };
    const toggleOptic = (kind) => {
      if (opticKind === kind) { optic = null; opticKind = null; }
      else { optic = WT.raiseOptic(kind); opticKind = optic ? kind : null; }
      after();
    };
    const after = () => { renderLog(); hud(); controls(); draw(performance.now()); };
    const step = () => { optic = null; opticKind = null; const interesting = WT.tick(); after(); return interesting; };
    const runAuto = () => {
      stopAuto();
      autoTimer = setInterval(() => {
        if (H.over) { stopAuto(); return; }
        const had = H.visible.length;
        const r = WT.tick();
        after();
        if (H.visible.length > had || (r && H.visible.length) || H.over) { auto = false; stopAuto(); controls(); }
      }, 260);
    };
    const stopAuto = () => { if (autoTimer) clearInterval(autoTimer); autoTimer = null; };
    canvas.addEventListener('click', (e) => {
      if (optic || H.over) return;
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) * SW / r.width, y = (e.clientY - r.top) * SH / r.height;
      // nearest deer first (last drawn)
      const hit = hits.slice().reverse().find((b) => x >= b.x0 - 3 && x <= b.x1 + 3 && y >= b.y0 - 3 && y <= b.y1 + 3);
      H.selected = hit ? hit.id : null;
      after();
    });
    function showSummary() {
      const hrs = Math.max(0, Math.min(H.now, H.end) - H.start);
      $('#ctl', el).innerHTML = `<div style="flex-basis:100%"><h2>Hunt over</h2>
        <dl class="kv"><dt>On stand</dt><dd>${WT.fmtDur(hrs)}</dd><dt>Deer seen</dt><dd>${H.seenIds.size}</dd><dt>Added to hit list</dt><dd>${H.addedToList.length}</dd>
        <dt>Shots</dt><dd>${H.shots}${H.misses ? ` (${H.misses} missed)` : ''}</dd><dt>XP</dt><dd>+${Math.round(H.xp)}${H.levelUps && H.levelUps.length ? ` · <span class="good">Level ${S().level}!</span>` : ''}</dd>
        <dt>Used</dt><dd>${Object.entries(H.used).filter(([, n]) => n).map(([id, n]) => `${WT.consum(id) ? esc(WT.consum(id).name.replace(/ \(1 use\)/, '')) : id} ×${n}`).join(', ') || 'nothing'}</dd></dl>
        <div class="row" style="margin-top:8px">${H.harvested.map((r, k) => `<button class="btn blaze" data-see="${k}">See your deer</button>`).join('')}<button class="btn" id="home">Back to the lodge</button><button class="btn" id="again">Hunt again</button></div></div>`;
      el.querySelectorAll('[data-see]').forEach((b) => b.addEventListener('click', () => UI.go('reveal', H.harvested[+b.dataset.see])));
      $('#home', el).addEventListener('click', () => { if (WT.game.seasonOver) return UI.seasonOver(); UI.go('lodge'); });
      $('#again', el).addEventListener('click', () => { if (WT.game.seasonOver) return UI.seasonOver(); UI.go('map', { mode: 'hunt', pid: H.setup.pid, sid: H.stand.sid }); });
      UI.topbar();
    }
    after();
    let last = 0;
    const loop = (t) => { if (t - last > 150) { draw(t); last = t; } raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); stopAuto(); };
  };
})();
