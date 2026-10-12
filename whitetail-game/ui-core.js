/* Whitetail Country UI: core helpers, top bar, lodge (home), shop, inventory, skills, menus. */
(function () {
  const WT = window.WT;
  const UI = (window.WTUI = {});
  const C = () => WT.CONFIG;
  const S = () => WT.game.state;
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  UI.$ = $; UI.esc = esc;
  const money = WT.money;

  /* ---------------------------------------------------------------- canvas helpers */
  UI.stage = function (w, h, extraHtml = '') {
    return `<div class="stage"><canvas width="${w}" height="${h}"></canvas>${extraHtml}</div>`;
  };
  UI.imgToCanvas = function (img, canvas) {
    canvas.width = img.W; canvas.height = img.H;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(img.data, img.W, img.H), 0, 0);
    return canvas;
  };
  const spriteCache = new Map();
  // An RGBA render as an offscreen canvas (cached by key)
  UI.sprite = function (key, make) {
    if (spriteCache.has(key)) return spriteCache.get(key);
    const img = make();
    const c = document.createElement('canvas');
    UI.imgToCanvas(img, c);
    c.bounds = img.bounds;
    if (spriteCache.size > 400) spriteCache.clear();
    spriteCache.set(key, c);
    return c;
  };

  /* ---------------------------------------------------------------- toast + modal */
  let toastTimer = null;
  UI.toast = function (msg, kind) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'toast ' + (kind || '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  };
  UI.modal = function (html, onMount) {
    const m = $('#modal');
    m.innerHTML = `<div class="panel" role="dialog" aria-modal="true">${html}</div>`;
    m.hidden = false;
    if (onMount) onMount(m);
    const first = m.querySelector('button, input, select'); if (first) first.focus();
  };
  UI.closeModal = function () { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; };
  UI.err = (e) => { if (e) { UI.toast(e, 'bad'); return true; } return false; };

  /* ---------------------------------------------------------------- top bar */
  UI.topbar = function () {
    const st = S();
    if (!st) return;
    const P = C().progression;
    const need = P.xpForLevel(st.level);
    const w = st.weather;
    const rut = WT.rutPhase(Math.min(st.day, 91));
    const tags = `Buck ${st.tags.buck}${st.tags.buckFilled ? ' (filled)' : ''} · Doe ${st.tags.doe}`;
    $('#chips').innerHTML = [
      `<span class="chip money"><b>${money(st.cash)}</b></span>`,
      `<span class="chip"><b>${WT.dateLabel(Math.min(st.day, 91))}</b>, Yr ${st.year} · ${st.slot === 'morning' ? 'Morning' : 'Evening'}</span>`,
      `<span class="chip">Rifle season · <b>${rut.name}</b></span>`,
      w ? `<span class="chip"><b>${w.low}°/${w.high}°F</b> ${w.windDir} ${w.wind} mph${w.precip ? ' · ' + w.precip : ''}</span>` : '',
      `<span class="chip">Lv <b>${st.level}</b> <span class="xpbar" title="${st.xp} / ${need} XP"><i style="width:${Math.min(100, (100 * st.xp) / need)}%"></i></span></span>`,
      `<span class="chip">Tags: <b>${tags}</b></span>`,
    ].join('');
  };

  /* ---------------------------------------------------------------- router */
  let current = null, cleanup = null;
  UI.go = function (name, arg) {
    if (cleanup) { try { cleanup(); } catch (e) { /* ignore */ } cleanup = null; }
    current = name;
    UI.closeModal();
    const el = $('#screen');
    el.innerHTML = '';
    UI.topbar();
    const fn = UI.screens[name];
    cleanup = fn(el, arg) || null;
    window.scrollTo(0, 0);
  };
  UI.current = () => current;
  UI.screens = {};
  UI.refresh = () => UI.go(current);

  /* ---------------------------------------------------------------- wait / time */
  UI.wait = function () {
    if (UI.current() === 'hunt') return UI.toast('Finish or leave the hunt first.');
    const st = S();
    UI.modal(`<h2>Pass time</h2>
      <p class="dim">Days you don't hunt still pass. Pressure on your stands fades while you rest them.</p>
      <div class="row">
        ${st.slot === 'morning' ? '<button class="btn" data-w="session">Skip to this evening</button>' : ''}
        <button class="btn" data-w="day">Next morning</button>
        <button class="btn" data-w="week">Skip a week</button>
        <button class="btn ghost" data-w="close">Cancel</button>
      </div>`, (m) => {
      m.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => {
        const w = b.dataset.w;
        UI.closeModal();
        if (w === 'close') return;
        WT.skip(w);
        UI.afterTime();
      }));
    });
  };
  UI.afterTime = function () {
    if (WT.game.seasonOver) return UI.seasonOver();
    UI.go(UI.current() === 'hunt' || UI.current() === 'huntEnd' ? 'lodge' : UI.current());
  };
  UI.seasonOver = function () {
    UI.modal(`<h2>The season is over</h2>
      <p>Rifle season closed on Dec 31. Winter comes, fawns are born in spring, and every deer on the map ages a year.
      Some of the deer you know won't make it. You won't be told which.</p>
      <div class="row"><button class="btn blaze" id="ny">Start next season</button></div>`, (m) => {
      $('#ny', m).addEventListener('click', () => {
        const sum = WT.endSeason();
        UI.closeModal();
        const h = sum.harvest;
        UI.modal(`<h2>Year ${sum.year} in the books</h2>
          <dl class="kv">
            <dt>Hunts</dt><dd>${sum.hunts}</dd>
            <dt>Deer taken</dt><dd>${h.length ? h.map((r) => esc(r.label)).join(', ') : 'None'}</dd>
            <dt>Winter</dt><dd>${esc(sum.winter)}</dd>
            <dt>Summer</dt><dd>${esc(sum.growing)}</dd>
            <dt>Property tax</dt><dd>${money(sum.tax)}</dd>
            ${sum.plans ? `<dt>Cell plans</dt><dd>${money(sum.plans)}</dd>` : ''}
          </dl>
          ${sum.events.length ? '<h3>On your land</h3>' + sum.events.map((e) => `<p>${esc(e)}</p>`).join('') : ''}
          <p class="dim">New tags are on sale at the shop. Your hit list entries are a year older.</p>
          <div class="row"><button class="btn blaze" id="ok">Back to the lodge</button></div>`, (m2) => $('#ok', m2).addEventListener('click', () => UI.go('lodge')));
      });
    });
  };

  /* ================================================================ LODGE */
  // Palette shared with the deer art (art style spec) so the lodge and deer feel like one world.
  const LP = {
    plank: ['#3a281e', '#46301f', '#523a27'], seam: '#22170f', floor: ['#4a3324', '#3e2a1d'], trim: '#2a1d16',
    plaque: ['#5E4232', '#8C6E55'], stove: ['#1e1b1d', '#2e2a2c', '#3c3739'], fire: ['#ff6a1a', '#ffb347', '#ffe08a'],
    rug: ['#4E1E14', '#6b2a1a', '#8c6e55'],
  };
  const SKIN = ['#e0b48c', '#c8966e'];
  function lookFor(item) {
    if (!item) return null;
    const n = item.name;
    if (item.blaze || /blaze/i.test(n)) return { t: 'blaze' };
    if (/jeans/i.test(n)) return { t: 'denim' };
    if (/cotton tee|white/i.test(n)) return { t: 'solid', c: ['#e8e6e0', '#cfcac0'] };
    if (/Carhartt/i.test(n)) return { t: 'duck' };
    if (/Sitka/i.test(n)) return { t: 'sitka' };
    if (/First Lite/i.test(n)) return { t: 'firstlite' };
    if (/Under Armour/i.test(n)) return { t: 'solid', c: ['#2c2c2e', '#3c3c40'] };
    if (/rubber/i.test(n)) return { t: 'solid', c: ['#2f3b22', '#3d4a2c'] };
    if (/LaCrosse|Muck|Baffin|sneakers|boots/i.test(n)) return { t: 'solid', c: ['#2a2420', '#4a3a2e'] };
    if (/jersey/i.test(n)) return { t: 'solid', c: ['#8a6a44', '#a4825a'] };
    return { t: 'camo' };
  }
  function patColor(look, x, y) {
    const h = WT.hash2(x >> 1, y >> 1, 9);
    switch (look.t) {
      case 'blaze': return h < 0.8 ? '#ff6a1a' : '#e25812';
      case 'denim': return (x + y) % 3 === 0 ? '#5a76a8' : '#3f5a8a';
      case 'duck': return h < 0.75 ? '#8a6a3a' : '#7a5c30';
      case 'sitka': return h < 0.4 ? '#6b6f5e' : h < 0.75 ? '#8a8d7a' : '#4c5044';
      case 'firstlite': return h < 0.45 ? '#7c7462' : h < 0.8 ? '#a09680' : '#57503f';
      case 'solid': return (y % 4 === 0) ? look.c[1] : look.c[0];
      default: return h < 0.35 ? '#5a4a32' : h < 0.65 ? '#7a6a48' : h < 0.85 ? '#3e3424' : '#8c7a56';
    }
  }
  // Player character, 16 x 40 px, wearing exactly what's equipped.
  UI.drawPlayer = function (ctx, ox, oy, loadout, hand, t) {
    const cl = {};
    for (const slot in loadout.clothing) if (loadout.clothing[slot]) cl[slot] = WT.cloth(loadout.clothing[slot]);
    const breathe = Math.floor(t / 900) % 2;
    const px = (x, y, c) => { if (!c) return; ctx.fillStyle = c; ctx.fillRect(ox + x, oy + y + (y < 25 ? breathe : 0), 1, 1); };
    const fill = (x0, y0, x1, y1, look) => { if (!look) return; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(x, y, typeof look === 'string' ? look : patColor(look, x, y)); };
    const L = (slot) => lookFor(cl[slot]);
    // boots + legs
    const feet = L('feet') || { t: 'solid', c: ['#2a2420', '#4a3a2e'] };
    const legs = L('bibs') || L('pants') || { t: 'denim' };
    fill(4, 25, 7, 36, legs); fill(8, 25, 11, 36, legs);
    fill(3, 37, 7, 39, feet); fill(8, 37, 12, 39, feet);
    // torso: base -> mid -> jacket
    const top = L('jacket') || L('mid') || L('base') || { t: 'solid', c: ['#e8e6e0', '#cfcac0'] };
    fill(3, 11, 12, 24, top);
    fill(1, 11, 2, 23, top); fill(13, 11, 14, 23, top);
    const under = cl.jacket ? (L('mid') || L('base')) : cl.mid ? L('base') : null;
    if (under) { fill(6, 11, 9, 11, under); fill(1, 23, 2, 23, under); fill(13, 23, 14, 23, under); }
    if (cl.bibs) { fill(5, 16, 10, 24, L('bibs')); fill(4, 11, 4, 15, L('bibs')); fill(11, 11, 11, 15, L('bibs')); }
    if (cl.vest) { fill(3, 12, 5, 22, { t: 'blaze' }); fill(10, 12, 12, 22, { t: 'blaze' }); }
    // hands
    const gloves = L('hands');
    fill(1, 24, 2, 25, gloves || SKIN[0]); fill(13, 24, 14, 25, gloves || SKIN[0]);
    if (cl.muff) fill(3, 22, 12, 24, L('muff'));
    // head
    fill(5, 3, 10, 9, SKIN[0]); fill(5, 9, 10, 9, SKIN[1]);
    px(6, 6, '#2a1d16'); px(9, 6, '#2a1d16'); px(7, 8, SKIN[1]); px(8, 8, SKIN[1]);
    fill(5, 2, 10, 3, '#4a3020'); px(5, 4, '#4a3020'); px(10, 4, '#4a3020');
    fill(7, 10, 8, 10, SKIN[1]);
    if (cl.head) { const hl = L('head'); fill(4, 0, 11, 3, hl); if (/cap/i.test(cl.head.name)) fill(4, 4, 12, 4, hl); }
    // equipment belt
    const eq = loadout.equip || {};
    if (eq.light) { fill(5, 2, 10, 2, '#1e1e1e'); px(7, 2, '#fff6c8'); px(8, 2, '#fff6c8'); }
    if (eq.binoculars) { for (let k = 0; k < 6; k++) { px(4 + k, 12 + Math.floor(k / 2), '#1a1414'); px(11 - k, 12 + Math.floor(k / 2), '#1a1414'); } fill(6, 15, 9, 16, '#1e1e22'); px(6, 15, '#6a7a8a'); px(9, 15, '#6a7a8a'); }
    if (eq.rangefinder) fill(10, 17, 11, 18, '#2e2e3e');
    if (eq.grunt || eq.snort) { for (let y = 12; y <= 19; y++) px(y % 2 ? 6 : 9, y, '#1a1414'); fill(7, 19, 8, 20, '#8C6E55'); }
    // rifle in hand
    const rx = hand === 'left' ? -1 : 15, gx = hand === 'left' ? 0 : 15;
    fill(gx, 4, gx, 17, '#2a2a2e'); fill(rx, 10, rx + 1, 11, '#1a1a1e');
    fill(gx, 18, gx, 30, '#6b4a2e'); px(gx, 31, '#4a3020');
  };

  function drawLodge(canvas, t) {
    const st = S();
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.imageSmoothingEnabled = false;
    // wall planks
    for (let y = 0; y < 104; y++) {
      const band = Math.floor(y / 8);
      ctx.fillStyle = y % 8 === 7 ? LP.seam : LP.plank[band % 3];
      ctx.fillRect(0, y, W, 1);
    }
    // floor
    for (let y = 104; y < H; y++) { ctx.fillStyle = LP.floor[Math.floor((y - 104) / 5) % 2]; ctx.fillRect(0, y, W, 1); }
    ctx.fillStyle = LP.trim; ctx.fillRect(0, 102, W, 3);
    // window: season + weather outside
    const wx = 12, wy = 26, ww = 40, wh = 34;
    const month = st.day < 31 ? 0 : st.day < 61 ? 1 : 2;
    const sky = st.slot === 'morning' ? '#c9b8a8' : '#7d6f8a';
    ctx.fillStyle = sky; ctx.fillRect(wx, wy, ww, wh);
    ctx.fillStyle = ['#b08a3a', '#8a6e48', '#e8e6e6'][month]; ctx.fillRect(wx, wy + 22, ww, 12);
    ctx.fillStyle = month === 2 ? '#9a9aa6' : '#4a3a28'; for (let k = 0; k < 6; k++) ctx.fillRect(wx + 3 + k * 7, wy + 14 + (k % 2) * 2, 4, 9);
    const pr = st.weather && st.weather.precip;
    if (pr) { ctx.fillStyle = pr === 'snow' ? '#ffffff' : '#9fb3c8'; for (let k = 0; k < 18; k++) { const sx = (k * 13 + Math.floor(t / 120) * (pr === 'snow' ? 1 : 3)) % ww, sy = (k * 7 + Math.floor(t / 80) * (pr === 'snow' ? 1 : 4)) % wh; ctx.fillRect(wx + sx, wy + sy, 1, pr === 'snow' ? 1 : 2); } }
    ctx.fillStyle = '#2a1d16'; ctx.fillRect(wx - 3, wy - 3, ww + 6, 3); ctx.fillRect(wx - 3, wy + wh, ww + 6, 4); ctx.fillRect(wx - 3, wy, 3, wh); ctx.fillRect(wx + ww, wy, 3, wh); ctx.fillRect(wx + ww / 2 - 1, wy, 2, wh); ctx.fillRect(wx, wy + wh / 2 - 1, ww, 2);
    // wood stove + pipe
    const sx0 = 196;
    ctx.fillStyle = LP.stove[0]; ctx.fillRect(sx0 + 12, 0, 6, 74);
    ctx.fillStyle = LP.stove[1]; ctx.fillRect(sx0, 74, 30, 30); ctx.fillStyle = LP.stove[2]; ctx.fillRect(sx0 + 2, 76, 26, 3);
    ctx.fillStyle = '#120f10'; ctx.fillRect(sx0 + 6, 84, 18, 14);
    const fl = Math.floor(t / 150) % 3;
    ctx.fillStyle = LP.fire[0]; ctx.fillRect(sx0 + 8, 92 - fl, 14, 5 + fl);
    ctx.fillStyle = LP.fire[1]; ctx.fillRect(sx0 + 11, 94 - fl, 8, 3 + fl);
    ctx.fillStyle = LP.fire[2]; ctx.fillRect(sx0 + 14, 96 - (fl % 2), 2, 2);
    ctx.fillStyle = '#1e1b1d'; ctx.fillRect(sx0 + 2, 104, 4, 3); ctx.fillRect(sx0 + 24, 104, 4, 3);
    // rug
    ctx.fillStyle = LP.rug[0]; ctx.fillRect(84, 118, 72, 12); ctx.fillStyle = LP.rug[1]; ctx.fillRect(88, 120, 64, 8); ctx.fillStyle = LP.rug[2]; ctx.fillRect(92, 123, 56, 2);
    // mounts: biggest in the middle
    const wall = UI.wallMounts();
    const slots = [125, 88, 162]; // wall space between the window and the stove (more with lodge upgrades later)
    slots.forEach((_, k) => {
      const cx = slots[k], cy = 30;
      const rec = wall[k];
      ctx.fillStyle = LP.plaque[0]; ctx.fillRect(cx - 6, cy + 14, 12, 14); ctx.fillStyle = LP.plaque[1]; ctx.fillRect(cx - 5, cy + 15, 10, 12);
      if (!rec) return;
      const spr = UI.sprite('wall' + rec.id + ':' + rec.y, () => WT.renderMount(WT.snapDeer(rec.snap), 60, 64, 0.9));
      const by = spr.bounds ? spr.bounds.y1 : 50;
      ctx.drawImage(spr, cx - 30, cy + 22 - by); // neck sits on the plaque
    });
    if (!wall.length) { ctx.fillStyle = '#8C6E55'; ctx.font = '6px "Press Start 2P", monospace'; ctx.fillText('EMPTY WALL', 90, 60); }
    // the player
    UI.drawPlayer(ctx, 112, 80, st.loadout, st.settings.hand, t);
  }
  UI.wallMounts = function () {
    const st = S();
    return st.journal.filter((r) => r.wall && r.snap && r.snap.rack).sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || b.gross - a.gross).slice(0, 3);
  };

  UI.screens.lodge = function (el) {
    const st = S();
    const nav = [['shop', 'Shop'], ['inventory', 'Inventory'], ['land', 'Land'], ['skills', 'Skills' + (st.skillPts ? ' (' + st.skillPts + ')' : '')], ['trophies', 'Trophies'], ['hitlist', 'Hit List']];
    el.innerHTML = UI.stage(240, 135, `
      <div class="ov lov" style="left:8px;top:8px"><button class="btn ghost" data-go="shop">Shop</button></div>
      <div class="ov lov" style="right:8px;top:8px"><button class="btn ghost" data-go="inventory">Inventory</button></div>
      <div class="ov lov" style="left:8px;top:50%;transform:translateY(-50%);flex-direction:column"><button class="btn ghost" data-go="land">Land</button><button class="btn ghost" data-go="skills">${nav[3][1]}</button></div>
      <div class="ov lov" style="left:8px;bottom:8px"><button class="btn ghost" data-go="trophies">Trophies</button></div>
      <div class="ov lov" style="right:8px;bottom:8px"><button class="btn ghost" data-go="hitlist">Hit List</button></div>
      <div class="ov" style="left:50%;bottom:8px;transform:translateX(-50%)"><button class="btn blaze big" data-go="map">Hunt</button></div>
      <div class="ov lov" style="right:8px;top:50%;transform:translateY(-50%)"><button class="btn ghost small" data-menu>Menu</button></div>`) + `
      <nav class="lodge-bar">${nav.map(([k, n]) => `<button class="btn" data-go="${k}">${n}</button>`).join('')}<button class="btn" data-menu>Menu</button></nav>
      <div class="cols" style="margin-top:10px">
        <section class="panel news"><h2>Notice board</h2>${st.news.slice(0, 7).map((n) => `<p class="${n.kind}"><span class="faint">${WT.dateLabel(Math.min(n.d, 91))}:</span> ${esc(n.text)}</p>`).join('')}</section>
        <section class="panel"><h2>Today</h2>
          <dl class="kv">
            <dt>Weather</dt><dd>${esc(WT.weatherLine(st.weather))}</dd>
            <dt>Rut</dt><dd>${esc(WT.rutPhase(Math.min(st.day, 91)).name)}</dd>
            <dt>Sunrise</dt><dd>${WT.fmtTime(WT.sunTimes(st.day).rise)}</dd>
            <dt>Sunset</dt><dd>${WT.fmtTime(WT.sunTimes(st.day).set)}</dd>
            <dt>Tags</dt><dd>${st.tags.buck ? 'Buck tag in your wallet' : st.tags.buckFilled ? 'Buck tag filled' : '<span class="warn">No buck tag yet</span>'}, ${st.tags.doe} doe</dd>
          </dl>
          <p class="dim">Tap a mount on the wall in Trophies to see its score sheet. Wear blaze orange: it's rifle season.</p>
        </section>
      </div>`;
    el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => UI.go(b.dataset.go, b.dataset.go === 'map' ? { mode: 'hunt' } : undefined)));
    el.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', UI.menu));
    const canvas = $('canvas', el);
    let raf, last = 0;
    const loop = (t) => { if (t - last > 140) { drawLodge(canvas, t); last = t; } raf = requestAnimationFrame(loop); };
    drawLodge(canvas, 0);
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  };

  UI.menu = function () {
    const st = S();
    UI.modal(`<h2>Menu</h2>
      <p class="dim">The game saves itself after every hunt and purchase on this device.</p>
      <dl class="kv"><dt>World seed</dt><dd>${st.seed}</dd><dt>Hunts</dt><dd>${st.stats.hunts}</dd><dt>Hours on stand</dt><dd>${Math.round(st.stats.hours)}</dd><dt>Deer seen</dt><dd>${st.stats.seen}</dd><dt>Shots / misses</dt><dd>${st.stats.shots} / ${st.stats.misses}</dd></dl>
      <h3>Start over</h3>
      <div class="row"><button class="btn" id="newg">New world</button><span class="dim" id="newq"></span></div>
      <div class="row" style="margin-top:12px"><button class="btn ghost" id="cl">Close</button></div>`, (m) => {
      let armed = false;
      $('#newg', m).addEventListener('click', () => {
        if (!armed) { armed = true; $('#newq', m).innerHTML = '<span class="warn">This erases your save. Press again to confirm.</span>'; return; }
        WT.wipeSave(); WT.newGame(); WT.save(); UI.go('lodge');
      });
      $('#cl', m).addEventListener('click', UI.closeModal);
    });
  };

  /* ================================================================ SHOP */
  const TABS = [['rifles', 'Rifles'], ['scopes', 'Scopes'], ['stands', 'Stands'], ['clothing', 'Clothing'], ['optics', 'Optics & gear'], ['calls', 'Calls'], ['consum', 'Consumables'], ['cams', 'Trail cams'], ['tags', 'Tags']];
  let shopTab = 'tags';
  UI.screens.shop = function (el) {
    const st = S(), inv = st.inv;
    const tabBtns = TABS.map(([k, n]) => `<button class="btn small ${k === shopTab ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('');
    const row = (o) => `<div class="item ${o.locked ? 'locked' : ''}"><div><span class="nm">${esc(o.name)}</span>${(o.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div class="row">${o.owned ? `<span class="good">${esc(o.owned)}</span>` : ''}${o.price != null ? `<span class="dim">${o.price === 0 ? 'Free' : money(o.price)}</span>` : ''}${o.buy ? `<button class="btn small" data-buy="${o.buy}" ${o.locked ? 'disabled' : ''}>${esc(o.btn || 'Buy')}</button>` : ''}</div>
      ${o.stats ? `<div class="st">${o.stats}</div>` : ''}</div>`;
    let body = '';
    if (shopTab === 'rifles') {
      body = C().rifles.filter((r) => !r.award || inv.rifles.includes(r.id)).map((r) => row({
        name: `${r.name} (${r.cal})`, tags: [`Lv ${r.level}`, r.collect ? 'Collector' : null].filter(Boolean), price: r.price,
        stats: `Accuracy ${r.acc} · Range ${r.range} (about ${r.range * 3} yd) · Power ${r.power} · Recoil ${r.recoil} · ${r.mag} rounds`,
        owned: inv.rifles.includes(r.id) ? 'Owned' : null, buy: inv.rifles.includes(r.id) ? null : 'rifle:' + r.id, locked: r.level > st.level,
      })).join('') + `<p class="faint">Grandpa's Winchester 94 can't be bought. Some rifles are earned.</p>`;
    } else if (shopTab === 'scopes') {
      body = C().scopes.filter((s) => s.id !== 'none').map((s) => row({ name: s.name, price: s.price, stats: `Accuracy +${s.acc} · Low light ${s.low}`, owned: inv.scopes.includes(s.id) ? 'Owned' : null, buy: inv.scopes.includes(s.id) ? null : 'scope:' + s.id })).join('') + '<p class="faint">Mount scopes on your rifles in Inventory.</p>';
    } else if (shopTab === 'stands') {
      body = C().stands.filter((s) => s.id !== 'ground').map((s) => row({
        name: s.name, tags: [s.kind === 'permanent' ? 'Your land only' : 'Portable', s.bowOnly ? 'Bow only' : null].filter(Boolean), price: s.price,
        stats: `Cover ${s.cover} · Quiet ${s.noise} · Scent ${s.scent} · Steady rest ${s.accuracy} · Comfort ${s.comfort} · View ${s.visibility}${s.patienceHrs ? ` · ${s.patienceHrs > 0 ? '+' : ''}${s.patienceHrs} hr sit` : ''}${s.note ? '. ' + s.note : ''}`,
        owned: inv.stands[s.id] ? `${inv.stands[s.id]} in truck` : null, buy: 'stand:' + s.id,
      })).join('') + '<p class="faint">Stands go in your truck. Put them up from Land, or carry a portable one to a marked spot on public land.</p>';
    } else if (shopTab === 'clothing') {
      const slots = C().clothingSlots;
      body = slots.map((slot) => `<h3>${slot}</h3>` + C().clothing.filter((c) => c.slot === slot && !c.starter).map((c) => row({
        name: c.name, tags: [c.tier, c.blaze ? 'Blaze' : null].filter(Boolean), price: c.price,
        stats: `Warmth ${c.w} · Wind ${c.wd} · Water ${c.wa} · Cooling ${c.c} · Quiet ${c.q} · Scent ${c.s} · Camo ${c.cn}`,
        owned: inv.clothing.includes(c.id) ? 'Owned' : null, buy: inv.clothing.includes(c.id) ? null : 'clothing:' + c.id,
      })).join('')).join('');
    } else if (shopTab === 'optics' || shopTab === 'calls') {
      const cats = shopTab === 'optics' ? ['binoculars', 'rangefinder', 'light', 'heater', 'scentdevice'] : ['grunt', 'rattle', 'snort'];
      const statOf = (e) => e.cat === 'binoculars' ? `Spot ${e.spot} yd · Low light ${e.low} · Judging ${e.judge}` : e.cat === 'rangefinder' ? `Max ${e.maxRange} yd · Accuracy ${e.acc}` : e.cat === 'light' ? `Brightness ${e.bright} · ${e.life} hunts per battery set${e.red ? ' · red mode' : ''}` : e.cat === 'heater' ? `+${e.warm}°F in a blind · 1 lb lasts ${e.hrsPerTank} hr` : e.cat === 'scentdevice' ? 'Cuts scent detection about 35% downwind' : `Range ${e.range} yd · Realism ${e.realism}`;
      body = cats.map((cat) => `<h3>${cat === 'scentdevice' ? 'Scent control' : cat}</h3>` + C().equipment.filter((e) => e.cat === cat).map((e) => row({ name: e.name, tags: [e.tier], price: e.price, stats: statOf(e), owned: inv.equipment.includes(e.id) ? 'Owned' : null, buy: inv.equipment.includes(e.id) ? null : 'equip:' + e.id })).join('')).join('');
    } else if (shopTab === 'consum') {
      body = C().consumables.map((c) => row({
        name: c.packOf ? `${c.name.replace(/ \(1 use\)/, '')} (${c.packOf} uses)` : c.name, price: c.packOf ? c.packPrice : c.price,
        stats: consumDesc(c), owned: c.fuel ? (inv.propane ? `${inv.propane} on hand` : null) : inv.consum[c.id] ? `${inv.consum[c.id]} on hand` : null, buy: 'consum:' + c.id,
      })).join('');
    } else if (shopTab === 'cams') {
      body = C().cameras.map((c) => row({ name: c.name, tags: c.cell ? ['Cellular'] : [], price: c.price, stats: `Detection ${Math.round(c.detect * 100)} · Night photos ${Math.round(c.night * 100)}${c.cell ? ` · plan ${money(c.plan)}/yr, photos come to your phone` : ' · walk in to pull the card (spooks deer)'}`, owned: inv.cameras[c.id] ? `${inv.cameras[c.id]} in truck` : null, buy: 'camera:' + c.id })).join('');
    } else if (shopTab === 'tags') {
      const T = C().economy.tags;
      body = row({ name: 'Buck tag (any antlered deer)', price: T.buck, owned: st.tags.buck ? 'In wallet' : st.tags.buckFilled ? 'Filled' : null, buy: st.tags.buck + st.tags.buckFilled >= 1 ? null : 'tag:buck', stats: 'One per season. Antlerless deer (does, fawns, button bucks) need a doe tag.' }) +
        row({ name: 'Doe tag (antlerless)', price: T.doe, owned: st.tags.doe ? `${st.tags.doe} in wallet` : null, buy: st.tags.doe + st.tags.doeFilled >= T.maxDoeTags ? null : 'tag:doe', stats: `Up to ${T.maxDoeTags} per season. Shooting does keeps the herd healthy and puts meat in the freezer.` }) +
        `<p class="faint">Shoot an antlered deer without a buck tag (or the other way around) and the warden writes you a $500 ticket and takes the deer. Judge before you shoot.</p>`;
    }
    el.innerHTML = `<section class="panel"><div class="row" style="justify-content:space-between"><h2>Shop</h2><button class="btn small" data-back>Back to lodge</button></div>
      <p class="dim">You have ${money(st.cash)}. The only way to earn money is to kill deer.</p>
      <div class="tabs">${tabBtns}</div><div class="list">${body}</div></section>`;
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { shopTab = b.dataset.tab; UI.refresh(); }));
    el.querySelector('[data-back]').addEventListener('click', () => UI.go('lodge'));
    el.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => {
      const [kind, id] = b.dataset.buy.split(':');
      const e = WT.buy(kind, id);
      if (UI.err(e)) return;
      WT.save();
      UI.toast('Bought.', 'good');
      const y = window.scrollY; UI.refresh(); window.scrollTo(0, y);
    }));
  };
  function consumDesc(c) {
    const b = [];
    if (c.hands) b.push(`+${c.hands} hand warmth (double in a muff)`); if (c.feet) b.push(`+${c.feet} foot warmth`); if (c.core) b.push(`+${c.core} warmth`);
    if (c.sitMin) b.push(`+${c.sitMin} min sit`); if (c.heatMin) b.push(`+${c.heatMin} min in heat`); if (c.scentCut) b.push(`-${Math.round(c.scentCut * 100)}% scent`);
    if (c.rutLure) b.push('pulls bucks in the rut'); if (c.fuel) b.push('fuel for heaters'); if (c.battery) b.push('recharges your light'); if (c.crinkle) b.push('wrapper might crinkle');
    if (c.spot) b.push('a little sharper eyes');
    return b.join(' · ');
  }
  UI.consumDesc = consumDesc;

  /* ================================================================ INVENTORY (equip) */
  UI.outfitEditor = function (lo) {
    const inv = S().inv, cfg = C();
    const owned = (slot) => cfg.clothing.filter((c) => c.slot === slot && inv.clothing.includes(c.id));
    const slots = cfg.clothingSlots.map((slot) => `<label><span>${slot}</span><select data-slot="${slot}"><option value="">(none)</option>${owned(slot).map((c) => `<option value="${c.id}" ${lo.clothing[slot] === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>`).join('');
    const cats = ['binoculars', 'rangefinder', 'light', 'grunt', 'rattle', 'snort', 'heater', 'scentdevice'];
    const belt = cats.map((cat) => { const own = cfg.equipment.filter((e) => e.cat === cat && inv.equipment.includes(e.id)); return own.length ? `<label><span>${cat === 'scentdevice' ? 'scent' : cat}</span><select data-eq="${cat}"><option value="">(leave home)</option>${own.map((e) => `<option value="${e.id}" ${lo.equip[cat] === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>` : ''; }).join('');
    const rifles = inv.rifles.map((id) => { const r = WT.rifle(id); return `<option value="${id}" ${lo.rifle === id ? 'selected' : ''}>${esc(r.name)} (${esc(r.cal)})</option>`; }).join('');
    return `<h3>Clothing</h3><div class="slotgrid">${slots}</div>
      <h3>Weapon</h3><div class="slotgrid"><label><span>rifle</span><select data-rifle>${rifles}</select></label>
      <label><span>scope</span><select data-scope>${inv.scopes.map((id) => `<option value="${id}" ${inv.rifleScope[lo.rifle] === id ? 'selected' : ''}>${esc(WT.scope(id).name)}</option>`).join('')}</select></label></div>
      <h3>Equipment belt</h3>${belt ? `<div class="slotgrid">${belt}</div>` : '<p class="faint">No binoculars, rangefinder, calls or light yet. The shop has them.</p>'}`;
  };
  UI.bindOutfit = function (root, lo, onChange) {
    root.querySelectorAll('[data-slot]').forEach((s) => s.addEventListener('change', () => { lo.clothing[s.dataset.slot] = s.value || undefined; if (!s.value) delete lo.clothing[s.dataset.slot]; onChange(); }));
    root.querySelectorAll('[data-eq]').forEach((s) => s.addEventListener('change', () => { lo.equip[s.dataset.eq] = s.value || undefined; if (!s.value) delete lo.equip[s.dataset.eq]; onChange(); }));
    const r = root.querySelector('[data-rifle]'); if (r) r.addEventListener('change', () => { lo.rifle = r.value; onChange(true); });
    const sc = root.querySelector('[data-scope]'); if (sc) sc.addEventListener('change', () => { S().inv.rifleScope[lo.rifle] = sc.value; onChange(); });
  };

  UI.screens.inventory = function (el) {
    const st = S(), inv = st.inv;
    const lo = st.loadout;
    const plan = WT.sitPlan({ session: st.slot, standType: 'ladder', clothing: lo.clothing, equip: lo.equip, pack: {} });
    el.innerHTML = UI.stage(240, 135) + `
      <section class="panel" style="margin-top:10px"><div class="row" style="justify-content:space-between"><h2>Inventory</h2><button class="btn small" data-back>Back to lodge</button></div>
        <p>Total warmth <b>${Math.round(plan.outfit.warmth)}</b>: comfortable down to about <b>${plan.comfortable}°F</b>. This ${st.slot} will feel like <b>${plan.effTemp}°F</b> on a ladder stand.
          ${plan.blazeOk ? '<span class="good">Blaze orange: OK.</span>' : '<span class="bad">No blaze orange showing. Required in rifle season.</span>'}</p>
        <div id="outfit">${UI.outfitEditor(lo)}</div>
        <h3>Handedness</h3><div class="row"><button class="btn small ${st.settings.hand === 'right' ? 'on' : ''}" data-hand="right">Right-handed</button><button class="btn small ${st.settings.hand === 'left' ? 'on' : ''}" data-hand="left">Left-handed</button></div>
        <div class="cols" style="margin-top:6px">
          <div><h3>Pack (consumables)</h3>${C().consumables.filter((c) => (c.fuel ? inv.propane : inv.consum[c.id])).map((c) => `<p>${esc(c.name.replace(/ \(1 use\)/, ''))}: ${c.fuel ? inv.propane : inv.consum[c.id]}</p>`).join('') || '<p class="faint">Empty.</p>'}</div>
          <div><h3>In your truck</h3>${Object.entries(inv.stands).filter(([, n]) => n > 0).map(([id, n]) => `<p>${esc(WT.standType(id).name)} ×${n}</p>`).join('') || ''}${Object.entries(inv.cameras).filter(([, n]) => n > 0).map(([id, n]) => `<p>${esc(WT.camType(id).name)} ×${n}</p>`).join('')}${inv.equipment.some((e) => WT.equip(e).cat === 'light') ? `<p class="dim">Light battery: ${inv.lightCharge} hunts left</p>` : ''}</div>
        </div>
      </section>`;
    const canvas = $('canvas', el);
    const draw = (t) => {
      const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#2a1d16'; ctx.fillRect(0, 0, 240, 135);
      for (let y = 0; y < 135; y += 8) { ctx.fillStyle = y % 16 ? '#3a281e' : '#46301f'; ctx.fillRect(0, y, 240, 7); }
      ctx.save(); ctx.translate(96, 20); ctx.scale(3, 3 * 0.8); UI.drawPlayer(ctx, 0, 0, lo, st.settings.hand, t); ctx.restore();
    };
    let raf, last = 0; const loop = (t) => { if (t - last > 300) { draw(t); last = t; } raf = requestAnimationFrame(loop); }; draw(0); raf = requestAnimationFrame(loop);
    UI.bindOutfit(el, lo, () => { WT.save(); const y = window.scrollY; UI.refresh(); window.scrollTo(0, y); });
    el.querySelectorAll('[data-hand]').forEach((b) => b.addEventListener('click', () => { st.settings.hand = b.dataset.hand; WT.save(); UI.refresh(); }));
    el.querySelector('[data-back]').addEventListener('click', () => UI.go('lodge'));
    return () => cancelAnimationFrame(raf);
  };

  /* ================================================================ SKILLS */
  UI.screens.skills = function (el) {
    const st = S(), cfg = C();
    el.innerHTML = `<section class="panel"><div class="row" style="justify-content:space-between"><h2>Skills</h2><button class="btn small" data-back>Back to lodge</button></div>
      <p>Level ${st.level}. You earn points by sitting, seeing deer and harvesting. <b>${st.skillPts}</b> point${st.skillPts === 1 ? '' : 's'} to spend.</p>
      <div class="list">${Object.entries(cfg.skills).map(([k, s]) => `<div class="item"><div><span class="nm">${esc(s.name)}</span> <span class="dim">${st.skills[k]} / ${cfg.progression.skillMax}</span></div>
        <button class="btn small" data-sk="${k}" ${st.skillPts && st.skills[k] < cfg.progression.skillMax ? '' : 'disabled'}>+1</button><div class="st">${esc(s.desc)}</div></div>`).join('')}</div>
      <p class="faint">Patience now gives ${(cfg.comfort.basePatienceHrs + st.skills.patience * cfg.comfort.hrsPerPatiencePt).toFixed(1)} hours before stand comfort, clothing and snacks.</p></section>`;
    el.querySelectorAll('[data-sk]').forEach((b) => b.addEventListener('click', () => { WT.spendSkill(b.dataset.sk); WT.save(); UI.refresh(); }));
    el.querySelector('[data-back]').addEventListener('click', () => UI.go('lodge'));
  };

  /* ================================================================ BOOT */
  UI.boot = function () {
    let ok = false;
    try { ok = WT.hasSave() && !!WT.load(); } catch (e) { ok = false; }
    if (!ok) { WT.newGame(); WT.save(); }
    $('#waitBtn').addEventListener('click', UI.wait);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) UI.closeModal(); });
    UI.go('lodge');
    if (window.claude && window.claude.hot && window.claude.hot.snapshot) { try { window.claude.hot.snapshot(() => { WT.save(); return {}; }); } catch (e) { /* not in a viewer */ } }
  };
})();
