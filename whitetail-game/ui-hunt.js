/* Whitetail Country UI: loadout, the hunt view (first person from the stand), hunt summary. */
(function () {
  const WT = window.WT, UI = window.WTUI;
  const { $, esc } = UI;
  const S = () => WT.game.state;
  const Wd = () => WT.game.world;
  const T = WT.T;
  // Scene pixels. The view is tall: on a phone it is narrower and much taller, so deer are drawn big.
  let SW = 240, SH = 170, SHIFT = 8, GRD = 86, BIG = 1.4;
  let OW = 176, OH = 125;
  function setSceneSize() {
    const phone = typeof window !== 'undefined' && window.innerWidth < 700;
    SW = phone ? 180 : 240; SH = phone ? 232 : 170;
    SHIFT = Math.round(SH * 0.4) - 60;           // the backdrop is designed with its horizon at y = 60; slide it down
    GRD = SH - SHIFT - 60 - 16;                  // rows of ground between the horizon and a deer at 20 yards
    BIG = Math.min(1.5, GRD / 61);               // deer grow with the taller view
    OH = Math.round(OW * SH / SW);
  }
  const HORIZON = 60;
  // One perspective rule for both size and height on screen: 1 at 20 yards, shrinking with distance.
  // Far deer sit up by the horizon and are small; near deer are low and big. Never one without the other.
  const persp = (d) => 32 / (Math.max(15, d) + 12);
  const groundY = (d) => HORIZON + 4 + GRD * persp(d);

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
    const sel = { session: sessions.includes(args.session) ? args.session : sessions[0], carry: isSpot ? WT.mobileStand() : null };
    const block = WT.spotBlock(args.pid, stand);
    const state = { edit: false };
    const render = () => {
      const standType = sel.carry || (isSpot ? 'hangon' : stand.type);
      // keep the pack within what you own
      for (const id in lo.pack) { const have = id === 'propane' ? st.inv.propane : st.inv.consum[id] || 0; if (lo.pack[id] > have) lo.pack[id] = have; }
      const plan = WT.sitPlan({ session: sel.session, standType, clothing: lo.clothing, equip: lo.equip, pack: lo.pack });
      const warns = [];
      if (block) warns.unshift(`<span class="bad">${esc(block)}</span>`);
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
      el.innerHTML = `<section class="panel"><div class="row" style="justify-content:space-between"><h2>${esc(stand.name || (isSpot ? 'Marked spot' : WT.standType(stand.type).name))} · ${esc(p.name)}</h2><button class="btn small" id="back">Back to map</button></div>
        <div class="row" style="margin-bottom:8px"><button class="btn blaze big" id="go" style="flex:1" ${block ? 'disabled' : ''}>Start the hunt</button>${block ? '<button class="btn" id="toGear">Gear</button>' : ''}</div>
        <div class="row">${sessions.map((s) => `<button class="btn ${sel.session === s ? 'on' : ''}" data-ses="${s}">${WT.CONFIG.sessions[s].name}</button>`).join('')}
${isSpot && sel.carry ? `<span class="dim">Carrying: ${esc(WT.standType(sel.carry).name)}</span>` : ''}</div>
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
        </section>`;
      $('#back', el).addEventListener('click', () => UI.go('map', { mode: 'hunt', pid: args.pid, sid: args.sid }));
      { const tg = $('#toGear', el); if (tg) tg.addEventListener('click', () => UI.go('inventory')); }
      $('#chg', el).addEventListener('click', () => { state.edit = !state.edit; render(); });
      el.querySelectorAll('[data-ses]').forEach((b) => b.addEventListener('click', () => { sel.session = b.dataset.ses; render(); }));
      el.querySelectorAll('[data-pk]').forEach((b) => b.addEventListener('click', () => { const id = b.dataset.pk; lo.pack[id] = Math.max(0, (lo.pack[id] || 0) + +b.dataset.d); render(); }));
      UI.bindOutfit(el, lo, () => render());
      $('#go', el).addEventListener('click', () => {
        if (block) return UI.toast(block, 'bad');
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
    timber: ['#96894e', '#887b45'], snow: ['#e8e4dc', '#d8d4cc'], slough: ['#7f7c4c', '#716e42'],
  };
  function groundColors(H) {
    const day = S().day, c = H.cover;
    if (day > 62) return SCENE.snow;
    if (c === T.PLOT || c === T.PLOT_NEW) return SCENE.plot;
    if (c === T.CORN || c === T.SUNFLOWER) return WT.cropsOff() ? SCENE.stubble : SCENE.corn; // combined fields are stubble
    if (c === T.SOY) return WT.cropsOff() ? SCENE.stubble : SCENE.soy;
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
      swamp: f(T.SLOUGH), land: WT.landType(H.cover),
      woods: f(T.TIMBER, T.BRUSH), belt: f(T.BELT, T.YOUNGTREES), plot: (cnt[T.PLOT] || 0) > 0, newPlot: (cnt[T.PLOT_NEW] || 0) > 0,
      cropKind: f(T.CORN, T.SUNFLOWER) > 0.1 ? 'corn' : f(T.SOY) > 0.1 ? 'soy' : f(T.WHEAT) > 0.15 ? 'wheat' : null,
      water: f(T.WATER, T.CREEK, T.POND) > 0.02, slough: f(T.SLOUGH) > 0.08, corn: f(T.CORN, T.SUNFLOWER) > 0.12, farm: f(T.YARD) > 0.02,
    };
  }

  function drawScene(canvas, H, t) {
    if (canvas.width !== SW || canvas.height !== SH) { canvas.width = SW; canvas.height = SH; }
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const st = S();
    if (!H._info) Object.defineProperty(H, '_info', { value: sceneInfo(H), enumerable: false, configurable: true });
    const info = H._info, snow = st.day > 62, bare = st.day >= 31, seed = H.stand.x * 31 + H.stand.y;
    const R = (c, x, y, wd, hg) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(wd)), Math.max(1, Math.round(hg))); };
    const hs = (a, b) => WT.hash2(a, b, seed);
    const sky = skyColors(H);
    const SHd = SH - SHIFT; // everything below is drawn in backdrop coordinates (horizon at 60), slid down by SHIFT
    ctx.save(); ctx.translate(0, SHIFT);
    R(sky[0], 0, -SHIFT, SW, 22 + SHIFT); R(sky[1], 0, 22, SW, 20); R(sky[2], 0, 42, SW, HORIZON - 42);
    const night = H.now < H.plan.sun.rise - 0.6 || H.now > H.plan.sun.set + 0.6;
    if (night) { for (let n = 0; n < 26; n++) R('#d8dcf0', (n * 53 + seed * 7) % SW, (n * 29 + seed * 3) % 44, 1, 1); }
    else {
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      for (let n = 0; n < 4; n++) { const cx = ((n * 71 + seed * 13 + Math.floor(t / 2600)) % (SW + 60)) - 30, cy = 8 + (n * 11) % 26, cw = 22 + (n * 9) % 18; ctx.fillRect(cx, cy, cw, 3); ctx.fillRect(cx + 4, cy - 2, cw - 10, 2); }
      const sun = H.plan.sun, dawn = Math.abs(H.now - sun.rise) < 0.8, dusk = Math.abs(H.now - sun.set) < 0.8;
      if (dawn || dusk) { const sx = dawn ? SW * 0.72 : SW * 0.28, sy = HORIZON - 8 - Math.round(((dawn ? H.now - sun.rise : sun.set - H.now) + 0.8) * 8); ctx.fillStyle = 'rgba(255,214,150,.35)'; ctx.fillRect(sx - 9, sy - 3, 18, 6); R('#ffe2a8', sx - 4, sy - 4, 8, 8); R('#ffe2a8', sx - 5, sy - 3, 10, 6); }
    }
    const leaf = [['#a8682e', '#8c5226'], ['#b88a30', '#96702a'], ['#8a4a2a', '#6e3a22']];
    const gc = groundColors(H);
    const swampy = info.land === 'swamp' || info.swamp > 0.3;
    const woodsy = !swampy && (info.woods + info.belt * 0.5 > 0.3 || H.maxView <= 230);
    let base = HORIZON; // where the backdrop meets the ground
    if (swampy) {
      /* ---- swamp: a wall of cattails, dead snags standing in it, mist, a thin far tree line ---- */
      base = Math.max(HORIZON + 2, Math.min(78, Math.round(groundY(H.maxView)) - 2));
      const farT = snow ? '#7a7672' : '#4a4436', reed = snow ? ['#cfc4a0', '#b8ac88'] : bare ? ['#a89868', '#8e8054'] : ['#9a9450', '#847e42'], head = '#4a3020', snag = snow ? '#6a645e' : '#4e463c';
      for (let x = 0; x < SW; x += 3) { const hh = 4 + Math.floor(hs(x, 51) * 6); R(farT, x, base - 22 - hh, 3, hh + 6); }           // far timber
      ctx.fillStyle = snow ? 'rgba(236,238,242,.5)' : 'rgba(214,214,204,.42)'; ctx.fillRect(0, base - 20, SW, 8);                          // mist lying on the marsh
      for (let n = 0; n < 7; n++) { const x = Math.floor(hs(n, 52) * (SW - 8)) + 4, hgt = 22 + Math.floor(hs(n, 53) * 26); R(snag, x, base - hgt, 2, hgt); R(snag, x - 3, base - hgt + 4 + (n % 4), 3, 1); R(snag, x + 2, base - hgt + 9 + (n % 3), 4, 1); R(snag, x + 2, base - hgt + 2, 2, 1); if (snow) R('#e8e4dc', x - 3, base - hgt + 3 + (n % 4), 3, 1); }
      if (!bare) for (let n = 0; n < 9; n++) { const x = Math.floor(hs(n, 54) * SW), wd = 10 + (n % 4) * 3; R('#6e7a3e', x, base - 13, wd, 7); R('#7e8a48', x + 2, base - 15, wd - 5, 4); } // willow brush
      if (info.water) { R(snow ? '#b8c4cc' : '#51666c', 0, base - 3, SW, 3); R(snow ? '#c8d2d8' : '#6f868a', 0, base - 2, SW, 1); }
      for (let x = 0; x < SW; x += 2) { const hh = 7 + Math.floor(hs(x, 55) * 9); R(reed[(x >> 1) % 2], x, base - hh, 1, hh); R(reed[1], x + 1, base - hh + 2, 1, hh - 2); if (hs(x, 56) < 0.45) R(head, x, base - hh - 2, 1, 3); if (snow && hs(x, 57) < 0.3) R('#e8e4dc', x, base - hh - 3, 1, 1); } // the cattail wall
    } else if (woodsy) {
      /* ---- timber: a wall of woods pulled in close, right behind the farthest deer you could see ---- */
      base = Math.max(HORIZON + 2, Math.min(78, Math.round(groundY(H.maxView)) - 2));
      const farC = snow ? '#8a8682' : bare ? '#5a4c40' : '#7a5230', midT = snow ? '#5a544e' : '#3e3024', nearT = snow ? '#3e3832' : '#2a2018', nearS = snow ? '#2e2a26' : '#1c140e';
      // far woods: a solid band with a ragged top, sky showing above it
      for (let x = 0; x < SW; x += 2) { const top = 16 + Math.floor(hs(x, 21) * 9) + Math.round(3 * Math.sin(x / 17 + seed)); R(farC, x, top, 2, base - top); }
      if (!bare) for (let n = 0; n < 60; n++) { const lc = leaf[n % 3]; R(lc[n % 2], Math.floor(hs(n, 22) * SW) - 3, 14 + Math.floor(hs(n, 23) * 26), 7 + (n % 4), 4 + (n % 3)); }
      // middle trunks
      for (let n = 0; n < 46; n++) { const x = Math.floor(hs(n, 24) * SW), top = 12 + Math.floor(hs(n, 25) * 14); R(midT, x, top, 1 + (n % 3 === 0 ? 1 : 0), base - top); if (bare) { R(midT, x - 2, top + 4 + (n % 5), 2, 1); R(midT, x + 1, top + 8 + (n % 4), 3, 1); } }
      if (info.water) { R(snow ? '#b8c4cc' : '#5f7f9c', 0, base - 4, SW, 3); R(snow ? '#c8d2d8' : '#7a98b2', 0, base - 3, SW, 1); } // creek through the trees
      // near trunks: big, dark, running off the top of the picture
      for (let n = 0; n < 13; n++) {
        const x = Math.round((n + hs(n, 26) * 0.8) * SW / 13), tw = 3 + Math.floor(hs(n, 27) * 4), by = base + Math.floor(hs(n, 28) * 2);
        R(nearT, x, -SHIFT, tw, by + SHIFT); R(nearS, x + tw - 1, -SHIFT, 1, by + SHIFT);
        if (bare) { for (let q = 0; q < 3; q++) { const yy = 6 + q * 9 + (n % 4), dir = (n + q) % 2 ? 1 : -1; for (let m = 0; m < 7; m++) R(nearT, x + (dir > 0 ? tw : 0) + dir * m, yy - Math.floor(m * 0.6), 1, 1); if (snow) R('#e8e4dc', x + (dir > 0 ? tw : -6), yy - 4, 6, 1); } }
        if (snow) R('#e8e4dc', x, by - 1, tw, 1);
      }
      // the canopy overhead in October
      if (!bare) for (let n = 0; n < 34; n++) { const lc = leaf[n % 3]; R(lc[1], Math.floor(hs(n, 29) * SW) - 6, Math.floor(hs(n, 30) * (12 + SHIFT)) - 2 - SHIFT, 14 + (n % 5), 6); R(lc[0], Math.floor(hs(n, 29) * SW) - 3, Math.floor(hs(n, 30) * (12 + SHIFT)) - 3 - SHIFT, 8, 4); }
    } else {
      /* ---- open country: rolling hills, a tree or two, grass ---- */
      const hill = snow ? ['#c4c8d0', '#d4d6da', '#e2e0da'] : bare ? ['#8e8a74', '#9a8c60', '#a48e5e'] : ['#93966e', '#a39a5c', '#b49a5a'];
      const crest = (x, k) => [38, 46, 53][k] + Math.round([5, 4, 3][k] * Math.sin(x / [47, 31, 23][k] + seed * (k + 1)) + [3, 2, 2][k] * Math.sin(x / [19, 13, 9][k] + seed));
      for (let k = 0; k < 3; k++) {
        for (let x = 0; x < SW; x += 2) { const c0 = crest(x, k); R(hill[k], x, c0, 2, HORIZON - c0); }
        if (k === 1) { // a shelterbelt or a couple of lone trees on the middle ridge
          const nT = info.belt > 0.02 ? 9 : 2;
          for (let n = 0; n < nT; n++) {
            const x = info.belt > 0.02 ? 30 + n * 7 + Math.floor(hs(n, 31) * 3) + (seed % 90) : Math.round(30 + hs(n, 32) * 60 + n * 110), by = crest(x, 1) + 1;
            if (info.belt > 0.02) { for (let r = 0; r < 10; r += 2) { const wd = 1 + Math.round(r * 0.5); R(snow ? '#3a4a3a' : '#2e4a30', x - wd / 2, by - 10 + r, wd, 2); } }
            else { R(snow ? '#4a443e' : '#3a2c20', x, by - 12, 2, 12); if (bare) { R('#3a2c20', x - 3, by - 9, 3, 1); R('#3a2c20', x + 2, by - 11, 4, 1); R('#3a2c20', x - 2, by - 13, 6, 1); } else { const lc = leaf[n % 3]; R(lc[1], x - 5, by - 17, 12, 8); R(lc[0], x - 3, by - 19, 8, 5); } }
          }
        }
      }
      // grass on the near hill
      for (let n = 0; n < 40; n++) { const x = Math.floor(hs(n, 33) * SW), yy = crest(x, 2) + 2 + Math.floor(hs(n, 34) * Math.max(1, HORIZON - crest(x, 2) - 3)); R(snow ? '#c8bc98' : bare ? '#8a7a4c' : '#8c7a3e', x, yy - 2, 1, 3); }
      if (info.farm) { const fx = Math.round(SW * 0.55) + (seed % 40), fy = crest(fx, 1) + 2; R('#7a2e22', fx, fy - 11, 18, 11); R(snow ? '#e8e4dc' : '#4a3a34', fx - 1, fy - 14, 20, 4); R('#b0b0b4', fx + 21, fy - 13, 6, 13); R(snow ? '#e8e4dc' : '#7a7a80', fx + 21, fy - 15, 6, 2); }
      // water at the foot of the hills
      if (info.water) { const wc = snow ? ['#b8c4cc', '#d0d8dd'] : ['#5f7f9c', '#86a4bc']; R(wc[0], 0, HORIZON - 5, SW, 6); for (let n = 0; n < 16; n++) R(wc[1], Math.floor(hs(n, 35) * SW), HORIZON - 4 + (n % 4), 6 + (n % 5), 1); R(snow ? '#e8e4dc' : '#7c7040', 0, HORIZON, SW, 1); }
      if (info.slough && !info.water) { R(snow ? '#c8bc98' : '#8a8048', 0, HORIZON - 3, SW, 4); for (let x = 2; x < SW; x += 5) R(snow ? '#b8a878' : '#6e6238', x, HORIZON - 5 - Math.floor(hs(x, 36) * 2), 1, 3); }
    }
    // a standing corn field beside the stand is a wall of gold at the back of the ground until the combines roll
    if (info.cropKind === 'corn' && !WT.cropsOff() && !snow) { for (let x = 0; x < SW; x += 2) { const hh = 6 + Math.floor(hs(x, 61) * 3); R(x % 4 ? '#c4aa5c' : '#a48c44', x, base - hh, 2, hh); if (hs(x, 62) < 0.3) R('#8c7436', x, base - hh - 1, 1, 2); } }
    else if (info.cropKind === 'soy' && !WT.cropsOff() && !snow) R('#9a7c42', 0, base - 2, SW, 2);
    // ground bands, nearer = taller bands
    let y = base, k = 0;
    while (y < SHd) { const bh = Math.max(1, Math.floor((y - base) / 6) + 1); R(gc[k % 2], 0, y, SW, bh); y += bh; k++; }
    if (swampy) { const wc = snow ? '#b8c4cc' : '#4f6064'; for (let n = 0; n < 9; n++) { const yy = base + 3 + Math.floor(hs(n, 58) * (SHd - base - 22)), x0 = Math.floor(hs(n, 59) * (SW - 30)), wd = 18 + Math.floor(hs(n, 60) * 46); R(wc, x0, yy, wd, 1); R(wc, x0 + 4, yy + 1, wd - 10, 1); } } // standing water between the hummocks
    // fields and plots are strips of ground colour: a crop field far out, your food plot in the middle distance
    if (info.cropKind && gc !== SCENE.corn && gc !== SCENE.soy) {
      const cc = snow ? ['#d8cfb4', '#cabfa2'] : WT.cropsOff() ? [['#a8875c', '#94724a'], ['#8f6f4a', '#7c5e3e'], ['#b89a70', '#a48860']][seed % 3] : info.cropKind === 'corn' ? ['#c4aa5c', '#a48c44'] : info.cropKind === 'soy' ? ['#a8884a', '#8e7240'] : ['#d0ba76', '#bca866'];
      const y0 = base + 3; R(cc[0], 0, y0, SW, 5); R(cc[1], 0, y0 + 1, SW, 1); R(cc[1], 0, y0 + 3, SW, 1);
    }
    if (info.plot || info.newPlot) {
      const grown = info.plot, c1 = snow ? (grown ? '#c2d0b0' : '#cfc8bc') : grown ? '#5e9a3e' : '#6e5038', c2 = snow ? (grown ? '#b0c09e' : '#bdb6aa') : grown ? '#4f8a34' : '#5e4430';
      // the plot takes up about half of the ground, with a short clipped texture: one-pixel flecks, nothing tall
      const gh = SHd - base, ph = Math.round(gh * 0.5), y0 = base + Math.round(gh * 0.14);
      R(c1, 0, y0, SW, ph);
      for (let yy = y0 + 2, band = 0; yy < y0 + ph - 1; yy += 3 + Math.floor(band / 3), band++) R(c2, 0, yy, SW, 1);
      const f1 = snow ? (grown ? '#d2dcc4' : '#dcd6cc') : grown ? '#7fba56' : '#84634a', f2 = snow ? (grown ? '#a4b492' : '#b0a89c') : grown ? '#3f7a2c' : '#4a3626';
      for (let n = 0; n < 260; n++) { const fx = Math.floor(hs(n, 41) * SW), fy = y0 + 1 + Math.floor(hs(n, 42) * (ph - 2)); R(n % 3 ? f1 : f2, fx, fy, fy > y0 + ph * 0.5 ? 2 : 1, 1); }
    }
    // nothing stands on the ground where deer walk: the scenery stays up on the horizon
    if (st.weather.precip === 'snow') { ctx.fillStyle = '#ffffff'; for (let n = 0; n < 40; n++) ctx.fillRect((n * 37 + Math.floor(t / 90)) % SW, (n * 23 + Math.floor(t / 60)) % SH - SHIFT, 1, 1); }
    if (st.weather.precip === 'rain') { ctx.fillStyle = '#9fb3c8'; for (let n = 0; n < 40; n++) ctx.fillRect((n * 37 + Math.floor(t / 40)) % SW, (n * 23 + Math.floor(t / 25) * 3) % SH - SHIFT, 1, 3); }
    // deer, far to near
    const items = [];
    const lf = WT.lightFactor(H);
    for (const g of H.visible) for (const m of g.members) {
      if (m.fled) continue;
      const dist = Math.max(15, g.dist + m.dd);
      const ppiT = Math.max(0.13 * BIG, Math.min(1.3 * BIG, 1.3 * BIG * persp(dist)));
      const lod = Math.max(0, Math.min(4, Math.round(Math.log2(WT.ART_PPI / ppiT))));
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
      // ground cover right where the deer stands, in front of its legs. How tall depends on the ground:
      // cattails to the neck in swamp, standing crops the same, a few inches of yellow grass on prairie, green in the woods.
      {
        const inCrop = info.cropKind && !WT.cropsOff() && !snow && gy <= base + 9;
        const kind = inCrop ? info.cropKind : swampy ? 'swamp' : woodsy ? 'woods' : 'prairie';
        const tall = { swamp: 38, corn: 40, soy: 16, woods: 6, prairie: 5 }[kind] ?? 5;   // inches
        const cols = snow ? ['#d8d0b4', '#c2b894'] : kind === 'swamp' ? (bare ? ['#a89868', '#8e8054'] : ['#9a9450', '#847e42']) : kind === 'corn' ? ['#c4aa5c', '#a48c44'] : kind === 'soy' ? ['#a8884a', '#8e7240']
          : kind === 'woods' ? (bare ? ['#7c8648', '#6a7440'] : ['#6f9a48', '#5c843c']) : ['#d6bc66', '#bca252'];
        const hMax = Math.max(1, tall * ppi), sw = Math.max(1, Math.round(ppi * 0.9)), half = it.w * 0.85 + sw * 2;
        const n = Math.max(3, Math.round(half * 2 / (sw * (tall > 20 ? 1.6 : 2.4))));
        for (let q = 0; q < n; q++) {
          const hv = WT.hash2(m.deer.id, q, 71), sx = Math.round(x - half + (q + hv * 0.7) * (half * 2 / n));
          const hh = Math.max(1, Math.round(hMax * (0.55 + 0.45 * WT.hash2(q, m.deer.id, 72))));
          ctx.fillStyle = cols[q % 2]; ctx.fillRect(sx, gy - hh + 1, sw, hh);
          if (kind === 'swamp' && hh > 4 && hv < 0.4) { ctx.fillStyle = '#4a3020'; ctx.fillRect(sx, gy - hh - Math.max(1, Math.round(3 * ppi)) + 1, sw, Math.max(2, Math.round(5 * ppi))); } // cattail head
          if (kind === 'corn' && hh > 5 && hv < 0.5) { ctx.fillStyle = cols[1]; ctx.fillRect(sx - sw, gy - Math.round(hh * 0.6), sw * 3, Math.max(1, Math.round(ppi))); }               // a leaf
        }
      }
      // brush between you and the deer: no clean shot
      if (!g.clear) { ctx.fillStyle = gc[0]; const bw = Math.max(1, Math.round(4 * ppi)); for (let k = -3; k <= 3; k++) ctx.fillRect(x + k * bw * 2, gy - Math.round((12 + (k & 1) * 4) * ppi), bw, Math.round(16 * ppi) + 1); }
      const box = { id: m.deer.id, x0: dx + b.x0 * sc2, y0: dy + b.y0 * sc2, x1: dx + (b.x1 + 1) * sc2, y1: dy + (b.y1 + 1) * sc2 };
      hits.push({ id: box.id, x0: box.x0, x1: box.x1, y0: box.y0 + SHIFT, y1: box.y1 + SHIFT }); // taps come in screen rows
      if (H.selected === m.deer.id) {
        ctx.fillStyle = '#ff6a1a';
        const X0 = Math.round(box.x0) - 2, Y0 = Math.round(box.y0) - 2, X1 = Math.round(box.x1) + 1, Y1 = Math.round(box.y1) + 1;
        ctx.fillRect(X0, Y0, 3, 1); ctx.fillRect(X0, Y0, 1, 3); ctx.fillRect(X1 - 2, Y0, 3, 1); ctx.fillRect(X1, Y0, 1, 3);
        ctx.fillRect(X0, Y1, 3, 1); ctx.fillRect(X0, Y1 - 2, 1, 3); ctx.fillRect(X1 - 2, Y1, 3, 1); ctx.fillRect(X1, Y1 - 2, 1, 3);
      }
    }
    ctx.restore();
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
  function drawOptic(canvas, H, kind, optic, t) {
    if (canvas.width !== OW || canvas.height !== OH) { canvas.width = OW; canvas.height = OH; }
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const st = S();
    const gc = groundColors(H), sky = skyColors(H);
    ctx.fillStyle = gc[0]; ctx.fillRect(0, 0, OW, OH);
    ctx.fillStyle = sky[2]; ctx.fillRect(0, 0, OW, Math.round(OH * 0.26));
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
    setSceneSize();
    el.innerHTML = UI.stage(SW, SH, `<div class="ov" style="left:6px;top:6px;font-size:18px;background:rgba(28,20,16,.75);padding:2px 6px" id="clock"></div>
      <div class="ov" style="right:6px;bottom:6px;font-size:18px;background:rgba(28,20,16,.75);padding:2px 6px" id="hud"></div>`) + `
      <section class="panel" style="margin-top:10px">
        <div class="log" id="log" aria-live="polite"></div>
      </section>`;
    // the buttons live above the view so Shoot is never a scroll away
    el.insertAdjacentHTML('afterbegin', '<section class="panel" style="margin-bottom:8px;padding:8px"><div class="row" id="ctl" style="gap:6px"></div></section>');
    const canvas = $('canvas', el);
    // a tall view that fills the screen; the buttons and the log sit below it
    Object.assign(el.querySelector('.stage').style, { aspectRatio: `${SW} / ${SH}`, width: `min(100%, calc(86vh * ${SW} / ${SH}))`, margin: '0 auto' });
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
      $('#hud', el).innerHTML = `${H.rounds}/${H.rifle.mag} ${H.rifle.bow ? 'arrows' : 'rds'}${rng ? ` · <span class="good">${rng} yd</span>` : ''}${optic ? ` · ${opticKind === 'scope' ? 'scope' : 'binos'} up` : ''}`;
    };
    const controls = () => {
      if (H.over) return showSummary();
      const any = H.visible.length > 0;
      const chk = H.selected ? WT.shotCheck(H, H.selected) : { ok: false, reason: 'Tap a deer in the view to pick your target.' };
      $('#ctl', el).innerHTML = `
        <button class="btn blaze" id="shoot" ${chk.ok ? '' : 'disabled'} title="${esc(chk.reason || '')}">Shoot</button>
        <button class="btn" id="sit">${any ? 'Watch' : 'Sit'} ▸</button>
        <button class="btn ${auto ? 'on' : ''}" id="auto">${auto ? 'Stop' : 'Fast-forward'} ▸▸</button>
        ${H.eq.binoculars ? `<button class="btn ${opticKind === 'bino' ? 'on' : ''}" id="bino">Binos</button>` : ''}
        ${H.rifle.bow ? '' : `<button class="btn ${opticKind === 'scope' ? 'on' : ''}" id="scope">Scope</button>`}
        ${H.eq.rangefinder ? '<button class="btn" id="rng" ' + (H.selected ? '' : 'disabled') + '>Range</button>' : ''}
        ${H.eq.grunt ? '<button class="btn" data-call="grunt">Grunt</button>' : ''}${H.eq.rattle ? '<button class="btn" data-call="rattle">Rattle</button>' : ''}${H.eq.snort ? '<button class="btn" data-call="snort">Snort-wheeze</button>' : ''}
        <button class="btn" id="addList" ${H.selected ? '' : 'disabled'}>Add to hit list</button>
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
