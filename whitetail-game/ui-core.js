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
    c.bounds = img.bounds; c.anchor = img.anchor;
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
    $('#chips').innerHTML = [
      `<span class="chip money"><b>${money(st.cash)}</b></span>`,
      `<span class="chip"><b>${WT.dateLabel(Math.min(st.day, 91))}</b> · ${st.slot === 'morning' ? 'Morning' : 'Evening'}</span>`,
      w ? `<span class="chip"><b>${w.low}°/${w.high}°</b> wind ${w.windDir}</span>` : '',
      `<span class="chip">Tags <b>${st.tags.buck ? 'Buck' : st.tags.buckFilled ? 'Buck ✓' : '<span class="warn">no buck</span>'} · ${st.tags.doe} doe</b></span>`,
      `<span class="chip">Lv <b>${st.level}</b> <span class="xpbar" title="${st.xp} / ${need} XP"><i style="width:${Math.min(100, (100 * st.xp) / need)}%"></i></span></span>`,
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
    const hb = $('#huntBtn'); if (hb) hb.hidden = name === 'hunt' || name === 'map' && (!arg || arg.mode !== 'land');
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
            ${sum.tax ? `<dt>Property tax</dt><dd>${money(sum.tax)}</dd>` : ''}

          </dl>
          ${(() => {
            const rows = Object.entries(sum.money || {}).sort((a, b) => b[1] - a[1]);
            if (!rows.length) return '';
            const net = rows.reduce((a, r) => a + r[1], 0);
            return `<h3>Money this season</h3><dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="${v >= 0 ? 'good' : 'bad'}">${v >= 0 ? '+' : ''}${money(v)}</dd>`).join('')}<dt><b>Net</b></dt><dd class="${net >= 0 ? 'good' : 'bad'}"><b>${net >= 0 ? '+' : ''}${money(net)}</b></dd></dl>
              <p class="faint">Nothing is charged just for a year passing. Money only moves when you buy or hunt.</p>`;
          })()}
          ${(() => {
            const r = sum.recap; if (!r || !r.hunts) return '';
            const f1 = (v) => (v == null ? '-' : v.toFixed(1));
            return `<h3>How the season went</h3><dl class="kv">
              <dt>Time on stand</dt><dd>${r.hours} hours over ${r.hunts} hunts</dd>
              <dt>Deer seen</dt><dd>${r.seen} · ${r.bucks} different buck${r.bucks === 1 ? '' : 's'} seen clearly</dd>
              ${r.biggest ? `<dt>Biggest buck seen</dt><dd>${r.biggest.name ? `"${esc(r.biggest.name)}", ` : ''}${esc(r.biggest.text)} <span class="faint">${esc(r.biggest.where)}, ${WT.dateLabel(r.biggest.d)}${r.biggest.taken ? ' · you tagged him' : ''}</span></dd>` : ''}
              <dt>Bucks you passed</dt><dd>${r.passed}</dd>
              ${r.best ? `<dt>Best stand</dt><dd>${esc(r.best.name)} <span class="faint">${f1(r.best.rate)} deer a sit, ${r.best.sits} sits${r.bestWind ? ', best wind ' + r.bestWind : ''}</span></dd>` : ''}
              ${r.worst ? `<dt>Slowest stand</dt><dd>${esc(r.worst.name)} <span class="faint">${f1(r.worst.rate)} deer a sit, ${r.worst.sits} sits</span></dd>` : ''}
              <dt>Mornings / evenings</dt><dd>${f1(r.morning)} / ${f1(r.evening)} deer a sit</dd>
              <dt>Shots</dt><dd>${r.shots} taken, ${r.misses} missed · busted ${r.busted} time${r.busted === 1 ? '' : 's'}</dd></dl>
              ${r.neighbors.length ? `<p class="dim">Killed by others: ${r.neighbors.map((n) => esc(n.hit ? `"${n.hit}" (hit list)` : 'a ' + n.cls)).join(', ')}.</p>` : ''}
              ${r.tips.length ? `<h3>For next year</h3>${r.tips.map((t) => `<p>• ${esc(t)}</p>`).join('')}` : ''}`;
          })()}
          ${sum.sheds && sum.sheds.length ? `<h3>Shed hunting</h3><p>You walked your land in March and found ${sum.sheds.length} shed${sum.sheds.length === 1 ? '' : 's'}. Each one is a buck that made it through the winter:</p>${sum.sheds.map((sh) => `<p class="dim">• ${sh.name ? `"${esc(sh.name)}": ` : ''}${sh.side === 'both' ? 'a matched set' : 'one side'}, ${sh.pts} points, off a ${sh.age}-year-old on ${esc(sh.parcel)}</p>`).join('')}<p class="faint">They're in the Trophy Room.</p>` : sum.sheds ? '<h3>Shed hunting</h3><p class="dim">You walked your land in March and came back empty-handed.</p>' : ''}
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
  // Player character, 32 x 80 px, wearing exactly what's equipped. Blocks are laid out on a 16 x 40 grid and
  // drawn at double resolution so patterns, shading, the face and the weapon get real detail.
  UI.drawPlayer = function (ctx, ox, oy, loadout, hand, t) {
    const cl = {};
    for (const slot in loadout.clothing) if (loadout.clothing[slot]) cl[slot] = WT.cloth(loadout.clothing[slot]);
    const breathe = Math.floor(t / 900) % 2;
    const P = (x, y, c) => { if (!c) return; ctx.fillStyle = c; ctx.fillRect(ox + x, oy + y + (y < 50 ? breathe : 0), 1, 1); };
    const F = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) P(x, y, c); };
    // a block in coarse grid cells, patterned per fine pixel
    const fill = (x0, y0, x1, y1, look) => { if (!look) return; for (let y = y0 * 2; y <= y1 * 2 + 1; y++) for (let x = x0 * 2; x <= x1 * 2 + 1; x++) P(x, y, typeof look === 'string' ? look : patColor(look, x, y)); };
    const shade = (x0, y0, x1, y1, a = 0.24) => F(x0, y0, x1, y1, `rgba(0,0,0,${a})`);
    const lite = (x0, y0, x1, y1, a = 0.14) => F(x0, y0, x1, y1, `rgba(255,255,255,${a})`);
    const L = (slot) => lookFor(cl[slot]);
    // boots + legs
    const feet = L('feet') || { t: 'solid', c: ['#2a2420', '#4a3a2e'] };
    const legs = L('bibs') || L('pants') || { t: 'denim' };
    fill(4, 25, 7, 36, legs); fill(8, 25, 11, 36, legs);
    shade(15, 52, 16, 73, 0.45);                       // between the legs
    shade(14, 50, 14, 73); shade(23, 50, 23, 73);       // shadow side of each leg
    lite(8, 50, 8, 73); lite(17, 52, 17, 73);
    shade(9, 60, 13, 60, 0.16); shade(18, 61, 22, 61, 0.16); // knees
    fill(3, 37, 7, 39, feet); fill(8, 37, 12, 39, feet);
    F(6, 79, 15, 79, '#15110e'); F(16, 79, 25, 79, '#15110e'); shade(15, 74, 16, 78, 0.5);
    for (let k = 0; k < 2; k++) { P(10, 75 + k * 2, '#c8b89a'); P(20, 75 + k * 2, '#c8b89a'); } // laces
    lite(6, 74, 15, 74); lite(16, 74, 25, 74);
    // torso: base -> mid -> jacket
    const top = L('jacket') || L('mid') || L('base') || { t: 'solid', c: ['#e8e6e0', '#cfcac0'] };
    fill(3, 11, 12, 24, top);
    fill(1, 11, 2, 23, top); fill(13, 11, 14, 23, top);
    const under = cl.jacket ? (L('mid') || L('base')) : cl.mid ? L('base') : null;
    if (under) { fill(6, 11, 9, 11, under); fill(1, 23, 2, 23, under); fill(13, 23, 14, 23, under); }
    shade(5, 24, 5, 47, 0.3); shade(26, 24, 26, 47, 0.3);   // where the arms hang against the body
    shade(24, 24, 25, 49); shade(29, 22, 29, 47); shade(4, 22, 4, 47, 0.12);
    lite(6, 22, 7, 40); lite(2, 22, 2, 40);
    F(6, 22, 11, 23, 'rgba(255,255,255,.12)'); F(20, 22, 25, 23, 'rgba(0,0,0,.18)'); // shoulders
    if (cl.jacket) { shade(15, 24, 16, 49, 0.3); for (let y = 26; y < 48; y += 4) P(15, y, '#c8c0a8'); shade(8, 40, 12, 40, 0.3); shade(19, 40, 23, 40, 0.3); shade(8, 41, 8, 45, 0.2); shade(23, 41, 23, 45, 0.2); F(11, 22, 20, 23, 'rgba(0,0,0,.25)'); }
    else if (cl.mid) { shade(10, 42, 21, 42, 0.22); shade(10, 43, 10, 46, 0.18); shade(21, 43, 21, 46, 0.18); F(10, 48, 21, 49, 'rgba(0,0,0,.2)'); } // hand-warmer pocket, hem
    if (cl.bibs) { fill(5, 16, 10, 24, L('bibs')); fill(4, 11, 4, 15, L('bibs')); fill(11, 11, 11, 15, L('bibs')); F(9, 30, 10, 31, '#b8b0a0'); F(21, 30, 22, 31, '#b8b0a0'); shade(10, 32, 21, 32, 0.25); }
    else { F(6, 48, 25, 49, '#3a2a1c'); F(15, 48, 16, 49, '#c8b060'); } // belt and buckle
    if (cl.vest) { fill(3, 12, 5, 22, { t: 'blaze' }); fill(10, 12, 12, 22, { t: 'blaze' }); shade(11, 24, 11, 45, 0.2); shade(20, 24, 20, 45, 0.2); }
    // hands
    const gloves = L('hands');
    fill(1, 24, 2, 25, gloves || SKIN[0]); fill(13, 24, 14, 25, gloves || SKIN[0]);
    shade(2, 51, 5, 51, 0.3); shade(26, 51, 29, 51, 0.3); shade(3, 49, 3, 50, 0.18); shade(27, 49, 27, 50, 0.18); shade(5, 48, 5, 51, 0.2); shade(29, 48, 29, 51, 0.2);
    if (cl.muff) { fill(3, 22, 12, 24, L('muff')); shade(6, 44, 25, 44, 0.25); shade(6, 49, 25, 49, 0.3); }
    // head
    fill(5, 3, 10, 9, SKIN[0]);
    F(14, 20, 17, 21, SKIN[1]); shade(14, 20, 17, 20, 0.2);                      // neck
    F(9, 11, 9, 14, SKIN[1]); F(22, 11, 22, 14, SKIN[1]);                         // ears
    F(10, 4, 21, 7, '#4a3020'); F(10, 8, 10, 10, '#4a3020'); F(21, 8, 21, 10, '#4a3020'); F(12, 4, 17, 4, '#5e4028'); // hair
    F(12, 10, 14, 10, '#3a2618'); F(17, 10, 19, 10, '#3a2618');                    // brows
    F(12, 12, 13, 12, '#f2ece2'); F(18, 12, 19, 12, '#f2ece2'); P(13, 12, '#2a1d16'); P(18, 12, '#2a1d16'); // eyes
    F(15, 12, 16, 14, SKIN[1]); P(16, 15, '#b07c58'); P(15, 15, '#b07c58');        // nose
    F(13, 17, 18, 17, '#8a4a3a'); P(13, 17, '#a8684e'); P(18, 17, '#a8684e');      // mouth
    for (let y = 15; y <= 19; y++) for (let x = 10; x <= 21; x++) if ((y >= 18 || x <= 11 || x >= 20) && WT.hash2(x, y, 5) < 0.55) P(x, y, 'rgba(74,48,32,.5)'); // stubble
    shade(20, 8, 21, 19, 0.14); F(10, 19, 21, 19, 'rgba(0,0,0,.14)');
    if (cl.head) {
      const hl = L('head'); fill(4, 0, 11, 3, hl); shade(22, 0, 23, 7); lite(9, 0, 14, 1);
      if (/cap/i.test(cl.head.name)) { fill(4, 4, 12, 4, hl); shade(8, 9, 25, 9, 0.35); } else { F(8, 6, 23, 7, 'rgba(0,0,0,.22)'); for (let x = 9; x < 23; x += 2) P(x, 4, 'rgba(0,0,0,.2)'); } // brim or knit cuff
    }
    // equipment
    const eq = loadout.equip || {};
    if (eq.light) { F(10, 4, 21, 5, '#1e1e1e'); F(14, 3, 17, 6, '#3a3a3e'); F(15, 4, 16, 5, '#fff6c8'); }
    if (eq.binoculars) { for (let k = 0; k < 12; k++) { P(9 + k, 22 + Math.floor(k / 2), '#1a1414'); P(22 - k, 22 + Math.floor(k / 2), '#1a1414'); } F(11, 29, 20, 33, '#1e1e22'); F(15, 29, 16, 33, '#101014'); F(12, 30, 13, 31, '#6a7a8a'); F(18, 30, 19, 31, '#6a7a8a'); lite(11, 29, 20, 29); }
    if (eq.rangefinder) { F(20, 34, 23, 38, '#2e2e3e'); P(21, 35, '#8a9aaa'); }
    if (eq.grunt || eq.snort) { for (let y = 24; y <= 38; y++) P(y % 2 ? 12 : 19, y, '#1a1414'); F(14, 38, 17, 42, '#8C6E55'); F(14, 38, 17, 38, '#5a4634'); }
    if (WT.mobileStand && WT.mobileStand()) { F(6, 24, 7, 44, '#1e1e1e'); F(24, 24, 25, 44, '#1e1e1e'); } // pack straps for the stand on your back
    // weapon in hand
    const right = hand !== 'left', wx = right ? 30 : 0;
    if (WT.isBow && WT.isBow(loadout.rifle)) {
      const dir = right ? 1 : -1, bx = right ? 30 : 1;
      for (let y = 14; y <= 62; y++) { const bend = Math.round(3 * Math.sin((y - 14) / 48 * Math.PI)); P(bx + dir * bend, y, '#2a2a2e'); P(bx + dir * bend - dir, y, '#4a4a52'); }
      for (let y = 14; y <= 62; y++) P(bx - dir, y, 'rgba(232,228,220,.7)'); // string
      F(bx + dir * 2, 34, bx + dir * 3, 42, '#6b4a2e'); F(bx - 1, 12, bx + 1, 14, '#1a1a1e'); F(bx - 1, 62, bx + 1, 64, '#1a1a1e'); // grip and cams
    } else {
      F(wx, 8, wx + 1, 35, '#2a2a2e'); P(wx, 8, '#4a4a52'); for (let y = 8; y <= 35; y += 1) P(wx + (right ? 0 : 1), y, '#3c3c44'); // barrel
      F(right ? wx - 2 : wx + 2, 18, right ? wx - 1 : wx + 3, 26, '#1a1a1e'); P(right ? wx - 2 : wx + 3, 18, '#5a6a7a'); P(right ? wx - 2 : wx + 3, 26, '#5a6a7a'); // scope
      F(wx, 36, wx + 1, 62, '#6b4a2e'); for (let y = 36; y <= 62; y++) P(wx + (right ? 1 : 0), y, '#553a22'); F(wx, 63, wx + 1, 64, '#2a1d16'); // stock and butt pad
      F(wx, 40, wx + 1, 41, '#1a1a1e'); // bolt
    }
  };

  // The lodge is just you: a plank wall, a floor, and the hunter wearing what's equipped.
  function drawLodge(canvas, t) {
    const st = S();
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, floorY = H - 24;
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < floorY; y++) { ctx.fillStyle = y % 16 >= 14 ? LP.seam : LP.plank[Math.floor(y / 16) % 3]; ctx.fillRect(0, y, W, 1); }
    for (let k = 0; k < 40; k++) { ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect((k * 53) % W, Math.floor(k / 3) * 16 % floorY + 4 + (k % 3) * 3, 6 + (k % 5) * 3, 1); } // wood grain
    for (let y = floorY; y < H; y++) { ctx.fillStyle = LP.floor[Math.floor((y - floorY) / 8) % 2]; ctx.fillRect(0, y, W, 1); }
    ctx.fillStyle = LP.trim; ctx.fillRect(0, floorY - 2, W, 4);
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect((W >> 1) - 20, H - 13, 40, 3);
    UI.drawPlayer(ctx, (W >> 1) - 16, H - 92, st.loadout, st.settings.hand, t);
  }

  UI.screens.lodge = function (el) {
    const st = S();
    const nav = [['shop', 'Shop'], ['inventory', 'Gear' + (st.skillPts ? ' •' : '')], ['land', 'Land'], ['trophies', 'Trophy Room'], ['hitlist', 'Hit List']];
    const sun = WT.sunTimes(st.day);
    const needTag = !st.tags.buck && !st.tags.buckFilled;
    el.innerHTML = `<div class="row" style="margin-bottom:10px"><button class="btn blaze big" data-go="map" style="flex:1">Hunt</button><button class="btn ghost" data-menu aria-label="Menu">⋯</button></div>
      <div class="lodge-stage">${UI.stage(144, 120)}</div>
      <nav class="lodge-bar">${nav.map(([k, n]) => `<button class="btn" data-go="${k}">${n}</button>`).join('')}<button class="btn" data-guide>Guide</button></nav>
      <section class="panel news" style="margin-top:22px">
        <p><b>${esc(WT.rutPhase(Math.min(st.day, 91)).name)}</b> · ${esc(WT.weatherLine(st.weather))} · sun ${WT.fmtTime(sun.rise)} to ${WT.fmtTime(sun.set)}</p>
        ${st.day < 0 ? `<p class="good">Early archery season: bow only until Oct 1. ${WT.hasBow() ? 'Your bow is equipped.' : 'Equip your bow under Gear to hunt, or press Wait.'}</p>` : ''}
        ${needTag ? '<p class="warn">You need a buck tag before you can shoot a buck. Get one at the Shop.</p>' : ''}
        ${st.news.slice(0, 3).map((n) => `<p class="${n.kind}"><span class="faint">${WT.dateLabel(Math.min(n.d, 91))}:</span> ${esc(n.text)}</p>`).join('')}
      </section>`;
    el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => UI.go(b.dataset.go, b.dataset.go === 'map' ? { mode: 'hunt' } : undefined)));
    el.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', UI.menu));
    el.querySelectorAll('[data-guide]').forEach((b) => b.addEventListener('click', () => UI.guide()));
    const canvas = $('canvas', el);
    let raf, last = 0;
    const loop = (t) => { if (t - last > 140) { drawLodge(canvas, t); last = t; } raf = requestAnimationFrame(loop); };
    drawLodge(canvas, 0);
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  };

  /* ================================================================ GUIDE: how everything works */
  const GUIDE = [
    ['start', 'The basics', () => `
      <p>You hunt whitetails from October 1 to December 31, one morning or evening sit at a time. Then winter passes, every deer on the map gets a year older, and you do it again.</p>
      <p><b>Money</b> comes from deer you tag (bigger antlers pay more, a doe pays ${WT.money(WT.CONFIG.economy.doePayout)}), from leveling up, and ${WT.money(WT.CONFIG.economy.newDeerCash)} for each deer you add to your hit list. Nothing is charged when a year passes.</p>
      <p><b>You need a tag</b> for what you shoot: a buck tag for an antlered deer, a doe tag for anything without antlers. Shoot the wrong one and the DNR takes it (no pay, no mount, no fine).</p>
      <p><b>A turn:</b> Shop if you need something → Hunt → pick a stand → pack → sit. <b>Wait</b> (top right) skips a morning or evening.</p>`],
    ['deer', 'The deer', () => `
      <p>Every deer is its own animal with an age, a body and antlers that grow from its own genes. Nothing is rolled when you pull the trigger: the buck you see is the buck you get.</p>
      <p><b>Age is everything.</b> A buck adds antler every year until about 5½ to 6½. A 1½ year old with a small rack may be a giant in four years if he lives. Passing young bucks is how you grow big ones.</p>
      <p><b>They can die or leave.</b> Neighbors shoot deer, winters kill some, and young bucks move to other properties. Bigger, safer land keeps more of them.</p>
      <p><b>Four kinds of ground.</b> <b>Prairie</b> is the common middle ground and the only place plots and tree rows go. <b>Timber</b> holds more deer (an all-timber property holds about 30% more). <b>Swamp</b> is rare and keeps old bucks alive: bucks 3½ and up die up to 40% less on swampy land, they make their homes in it, and a stand in or beside swamp gets a better Big bucks rating. <b>Farm</b> fields can't be built on. They hold deer until the combines roll (a day in the second week of October, announced in the news). For the two weeks after, deer are packed into nearby cover: the more timber and swamp you have, the bigger the rush, up to about a third more deer seen. After that, land with lots of field and little cover sees fewer deer and loses more to the neighbors.</p>
      <p><b>Water</b> holds no deer (it doesn't count toward how many a property can carry), but it works for you three ways. A stand within about 100 yards of a bank sits on a funnel and rates higher. Land along a river or lake has no hunter on that side: with a third of your land on the water, about a quarter fewer of your deer are killed by others. And on days of 62°F or warmer, stands near water see up to a third more deer.</p>
      <p><b>Home areas:</b> each deer lives around one spot on its property, usually in cover. He can turn up at any stand, but about twice as often near home and half as often at the far end. Does stay tight, bucks roam wider, and in the rut bucks go anywhere. This is why two stands on the same land see different deer, and why a camera on one end won't show you the buck living on the other. Spread stands and cameras out.</p>
      <p><b>What you see:</b> does and fawns move in daylight. Old bucks mostly move at night, except in the rut (early to mid November), when they chase does all day.</p>
      <p><b>What your land does for them:</b> more food and water grows heavier, healthier deer. More cover and sanctuary means more deer live there, survive, and move in daylight.</p>`],
    ['stands', 'Stands and ratings', () => `
      <p><b>Rating (1 to 100)</b> is how good the spot is compared with every other spot on the map. An 80 beats 80% of them. It comes from the ground within about 250 yards: bedding cover, food, water, travel routes between them, and distance from roads. Great spots are rare. You learn the rating the first time you sit a stand, and it only changes if you change the ground around it.</p>
      <p><b>Stars (1 to 5)</b> are today's sit compared with that stand's own best. Five stars means the stand is as good as it gets today. Wrong wind, the wrong time of day, pressure or an off day pull stars down. A sit can never be better than the stand's rating.</p>
      <p><b>Consistency:</b> Steady stands work on five winds, Average on three, Fickle on only one. A fickle 90 is a great spot you can rarely hunt at its best.</p>
      <p><b>Pressure</b> builds every time you sit a stand, miss, or get busted, and drains when you leave it alone. A full meter means rest it.</p>
      <p><b>Public land comes in kinds.</b> Each area is Crowded, Average or Quiet, shown on its card. Crowded ground has trucks at every access, high pressure and mostly young bucks. Quiet ground is lightly hunted and holds deer close to private-land quality. On any public land there's a small chance each sit that a big buck from somewhere else is passing through, more in the rut and on quiet ground. You can't plan on him, but it's why a public sit is never a wasted sit.</p>
      <p><b>Public land</b> needs a mobile stand on your back: a hang-on, climber or saddle (these need a tree) or a pop-up blind (works anywhere). Buy one at the Shop and equip it under Gear. Mobile stands aren't left up on your own land.</p>
      <p><b>Timber or open:</b> in timber deer show at 20 to 200 yards. In open country you see more ground but deer are 150 to 500 yards out.</p>
      <p><b>Stand types</b> add concealment, quiet, a steadier rest, comfort and height. Box blinds and hunting houses hide you best and let you sit all day in the cold.</p>`],
    ['sit', 'On the stand', () => `
      <p>Time moves 10 minutes a step. <b>Sit</b> waits one step, <b>Fast-forward</b> runs until something shows up.</p>
      <p><b>Reading deer:</b> tap a deer to pick it. Far off you only get "has antlers". Binoculars and the scope sharpen the read to a point count, and up close to a rough score and weight. Raising glass is movement, so a close deer may catch you.</p>
      <p><b>How deer catch you:</b> <b>scent</b> (wrong wind is the big one; scent-control clothes, sprays and rubber boots help), <b>sight</b> (concealment from camo and the stand; fidgeting when you're cold), and <b>sound</b> (quiet clothes; a noisy walk in can clear the place out before you sit down).</p>
      <p><b>Comfort:</b> every degree colder than your clothes are rated for shortens the sit. Hand warmers, a heater and snacks stretch it. Overdress on a warm day and you sweat, which is scent.</p>
      <p><b>Calls:</b> a grunt tube, rattling antlers and a snort-wheeze can pull bucks in, mostly around the rut. Calling too much makes deer wary.</p>
      <p><b>Hit list:</b> a deer you've seen clearly before shows its name and the status you gave it (Hit list, Pass, Cull...) right above your read.</p>`],
    ['shot', 'Taking the shot', () => `
      <p><b>Distance decides it.</b> Inside 40 yards a clear rifle shot almost never misses. The bonus fades out by 100 yards, and past that it's your rifle, scope and Marksmanship skill.</p>
      <p><b>Bows</b> are a late-game tool for hunting big bucks (the first unlocks at level ${WT.CONFIG.rifles.filter((r) => r.bow).reduce((a, r) => Math.min(a, r.level), 99)}). They are short and quiet: strong inside 20 yards, fading fast, and not possible much past their range. Accuracy comes from the <b>Archery</b> skill, not Marksmanship. A bow shot barely adds pressure, often doesn't clear the rest of the group, and a miss frequently leaves the deer standing there for a second arrow.</p>
      <p><b>What a bow opens up:</b> the <b>early archery season</b> (if you own a bow the year starts Sep 17, two weeks before rifle season, with nobody else in the woods and deer that haven't been hunted), and <b>bow-only public land</b>, where far fewer bucks get killed, so they are older and bigger on average than anywhere else.</p>
      <p><b>Each rifle has a reach.</b> The starter .223 is good to about 100 yards and falls off fast after. Better rifles reach farther and hit harder, which means fewer wounded deer. A rangefinder removes the guesswork past 150 yards.</p>
      <p><b>Wait for a clear shot.</b> "Brush in the way" costs a lot of accuracy and wounds deer. Standing deer are easier than walking deer.</p>
      <p><b>Low light</b> hurts unless your scope gathers light well. Big antlers give you buck fever until your Marksmanship is up.</p>
      <p><b>A bad hit</b> can still be recovered (Woodcraft skill and a light help). A deer you never find still uses your tag.</p>`],
    ['land', 'Your land and stacking', () => `
      <p>On the <b>Land</b> map, tap any spot on your ground. The card shows what's on that spot and what you can add to it. Tap a stand or camera to move it or pick it up.</p>
      <p><b>Touching is the rule.</b> Things count together when their tiles touch: the same tile, or any of the 8 around it. Pick a tile and the map draws a faint ring around those 8. The stand's card lists what is touching it under More info.</p>
      <p>• <b>Stand</b>: where you hunt. Its rating reads the ground within about 250 yards, closest ground counting most.</p>
      <p>• <b>Food plot</b>: deer start using it the season after you plant. A stand gets an evening bonus when a grown plot tile touches its tile. It also makes that ground food, which lifts stands within a couple hundred yards a little and feeds the whole herd: heavier deer and better antlers. Clover lasts 4 years, the rest are replanted yearly. Corn and brassicas are best late in the season.</p>
      <p>• <b>Trail camera</b>: goes on your land or on public land (up to ${WT.CONFIG.publicCamsPerArea} per public area). It photographs deer that walk past, and it sees what a hunter sitting on that spot would see: a camera on a good spot fills up, a camera on a dead spot stays empty. That makes cheap cameras a scouting tool. Scatter them, see which one gets the most deer (and the most in daylight), then put a stand or mark a spot right on the winner.</p>
      <p>&nbsp;&nbsp;Each camera has a <b>clear range</b> (how far out you can tell what the deer is) and a <b>reach</b> (past that it never triggers). The cheapest is clear to ${WT.CONFIG.cameras[0].clear} yards and blind past ${WT.CONFIG.cameras[0].reach}; the best is clear to ${WT.CONFIG.cameras[WT.CONFIG.cameras.length - 1].clear} and reaches ${WT.CONFIG.cameras[WT.CONFIG.cameras.length - 1].reach}. Thick timber cuts both down. A camera touching a stand tags its photos with that stand; one touching a food plot or a standing crop field gets more pictures. Checking a card leaves scent; cellular cameras send photos by themselves.</p>
      <p>• <b>Water hole</b>: adds water to the spot. Raises nearby stand ratings (most in early October) and helps the herd.</p>
      <p>• <b>Tree row</b>: grows into cover after ${WT.CONFIG.improvements.trees.matureYears} years. Cover is bedding and a travel route, which is what morning and rut stands want.</p>
      <p>• <b>Sanctuary</b>: ground you give up and never hunt. It raises the property's Security: fewer deer die each year, and deer spend more of their time on your land, so you see them more. The rules: it only works in cover (timber, tree rows, brush, sloughs, CRP grass), a tile stops counting if one of your stands is within about 100 yards, and the bonus tops out at ${Math.round(WT.CONFIG.sanctuary.maxShare * 100)}% of the property. On the map, yellow stripes are working and red stripes aren't counting.</p>
      <p>• <b>Help button</b>: on the Land map, "Help: how do I make this land better?" looks at that property and tells you what is holding it back, most useful first.</p>
      <p><b>A classic setup:</b> a food plot along a timber edge, a stand on a tile touching the plot, and a camera on a tile touching both. The plot lifts the stand's rating, and the camera tells you who is eating there.</p>
      <p><b>Limits</b> scale with acres (stands, cameras, plot acres, water holes). Picking things up puts them back in your truck; plots, tree rows and water holes can be removed but aren't refunded.</p>`],
    ['gear', 'Gear, skills and levels', () => `
      <p><b>Clothing</b> has warmth (how cold you can sit), concealment, quiet and scent control. October's first week is mild; after the first cold front you need real layers to sit long.</p>
      <p><b>Optics:</b> binoculars and better scopes let you judge deer from farther away. A rangefinder gives exact yardage.</p>
      <p><b>Levels</b> come from hunting: seeing deer, long sits, and deer you tag. Each level pays cash and gives skill points, and unlocks better rifles.</p>
      <p><b>Skills:</b> Stealth (quieter, less noticed), Marksmanship (accuracy, less buck fever), Calling, Scent Discipline, Patience (longer sits) and Woodcraft (finding hit deer).</p>`],
    ['books', 'Hit list and trophies', () => `
      <p><b>Hit list:</b> nothing goes on it by itself. Add a deer from the stand once you've had a clear look, or from a trail camera photo. Each row shows where he was last seen, you can filter by property, and Pull cameras collects every card at once. Name them, guess their age, and mark them Hit list, Pass, Cull or Watch. The game doesn't tell you if a deer is alive, with two exceptions: you hear about it when a neighbor kills one of your hit list deer, and finding his sheds in spring means he made it through the winter.</p>
      <p><b>Shed hunting</b> happens by itself each March on land you own. Sheds are kept in the Trophy Room, and a hit list deer's page lists the years you found his.</p>
      <p><b>After a harvest</b> you guess the score, then see the real age, weight and the full score sheet.</p>
      <p><b>Mounts</b> cost money: shoulder mount ${WT.money(WT.CONFIG.economy.mounts.shoulder.price)}, European ${WT.money(WT.CONFIG.economy.mounts.euro.price)}, felt cap ${WT.money(WT.CONFIG.economy.mounts.cap.price)}. Mounted deer hang in the Trophy Room.</p>`],
  ];
  UI.guide = function (topic) {
    let k = Math.max(0, GUIDE.findIndex((g) => g[0] === topic));
    const show = () => UI.modal(`<h2>How the game works</h2>
      <div class="row" style="gap:4px">${GUIDE.map((g, i) => `<button class="btn small ${i === k ? 'on' : ''}" data-gi="${i}">${g[1]}</button>`).join('')}</div>
      <div style="margin-top:8px;max-height:52vh;overflow:auto"><h3>${GUIDE[k][1]}</h3>${GUIDE[k][2]()}</div>
      <div class="row" style="margin-top:10px">${k > 0 ? '<button class="btn ghost" data-gn="-1">Back</button>' : ''}${k < GUIDE.length - 1 ? '<button class="btn blaze" data-gn="1">Next</button>' : ''}<button class="btn ghost" id="gclose">Close</button></div>`, (m) => {
      m.querySelectorAll('[data-gi]').forEach((b) => b.addEventListener('click', () => { k = +b.dataset.gi; show(); }));
      m.querySelectorAll('[data-gn]').forEach((b) => b.addEventListener('click', () => { k += +b.dataset.gn; show(); }));
      $('#gclose', m).addEventListener('click', UI.closeModal);
    });
    show();
  };

  UI.menu = function () {
    const st = S();
    UI.modal(`<h2>Menu</h2>
      <p class="dim">The game saves itself after every hunt and purchase on this device.</p>
      <dl class="kv"><dt>World seed</dt><dd>${st.seed}</dd><dt>Hunts</dt><dd>${st.stats.hunts}</dd><dt>Hours on stand</dt><dd>${Math.round(st.stats.hours)}</dd><dt>Deer seen</dt><dd>${st.stats.seen}</dd><dt>Shots / misses</dt><dd>${st.stats.shots} / ${st.stats.misses}</dd></dl>
      <div class="row"><button class="btn" id="guide">How the game works</button><button class="btn" id="tut">How to read the map</button></div>
      <h3>Start over</h3>
      <div class="row"><button class="btn" id="newg">New world</button><span class="dim" id="newq"></span></div>
      <div class="row" style="margin-top:12px"><button class="btn ghost" id="cl">Close</button></div>`, (m) => {
      let armed = false;
      $('#newg', m).addEventListener('click', () => {
        if (!armed) { armed = true; $('#newq', m).innerHTML = '<span class="warn">This erases your save. Press again to confirm.</span>'; return; }
        UI.closeModal(); $('#screen').innerHTML = BUILDING;
        setTimeout(() => { WT.wipeSave(); WT.newGame(); WT.save(); UI.go('lodge'); UI.mapTutorial(); }, 60); // let the message paint first
      });
      $('#cl', m).addEventListener('click', UI.closeModal);
      $('#tut', m).addEventListener('click', () => UI.mapTutorial());
      $('#guide', m).addEventListener('click', () => UI.guide());
    });
  };

  /* ================================================================ SHOP */
  const TABS = [['rifles', 'Rifles & bows'], ['scopes', 'Scopes'], ['stands', 'Stands'], ['clothing', 'Clothing'], ['optics', 'Optics & gear'], ['calls', 'Calls'], ['consum', 'Consumables'], ['cams', 'Trail cams'], ['tags', 'Tags']];
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
        name: `${r.name} (${r.cal})`, tags: [`Lv ${r.level}`, r.bow ? 'Bow' : null, r.collect ? 'Collector' : null].filter(Boolean), price: r.price,
        stats: r.bow ? `Accuracy ${r.acc} · Good to about ${r.range * 3} yd · Quiet: barely adds pressure · ${r.mag} arrows · opens bow-only public land` : `Accuracy ${r.acc} · Range ${r.range} (about ${r.range * 3} yd) · Power ${r.power} · Recoil ${r.recoil} · ${r.mag} rounds`,
        owned: inv.rifles.includes(r.id) ? 'Owned' : null, buy: inv.rifles.includes(r.id) ? null : 'rifle:' + r.id, locked: r.level > st.level,
      })).join('') + `<p class="faint">Grandpa's Winchester 94 can't be bought. Some rifles are earned.</p>`;
    } else if (shopTab === 'scopes') {
      body = C().scopes.filter((s) => s.id !== 'none').map((s) => row({ name: s.name, price: s.price, stats: `Accuracy +${s.acc} · Low light ${s.low}`, owned: inv.scopes.includes(s.id) ? 'Owned' : null, buy: inv.scopes.includes(s.id) ? null : 'scope:' + s.id })).join('') + '<p class="faint">Mount scopes on your rifles in Inventory.</p>';
    } else if (shopTab === 'stands') {
      body = C().stands.filter((s) => s.id !== 'ground').map((s) => row({
        name: s.name, tags: [s.kind === 'permanent' ? 'Your land only' : s.kind === 'mobile' ? 'Carried: equip under Gear' : 'Your land, or carried to public', s.id !== 'popup' && s.kind === 'mobile' ? 'Needs a tree' : null].filter(Boolean), price: s.price,
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
      body = C().cameras.map((c) => row({ name: c.name, tags: c.cell ? ['Cellular'] : [], price: c.price, stats: `Clear to ${c.clear} yd · Sees to ${c.reach} yd · Detection ${Math.round(c.detect * 100)} · Night photos ${Math.round(c.night * 100)}${c.cell ? ' · photos come to your phone, no monthly plan' : ' · walk in to pull the card (spooks deer)'}`, owned: inv.cameras[c.id] ? `${inv.cameras[c.id]} in truck` : null, buy: 'camera:' + c.id })).join('');
    } else if (shopTab === 'tags') {
      const T = C().economy.tags;
      body = row({ name: 'Buck tag (any antlered deer)', price: T.buck, owned: st.tags.buck ? 'In wallet' : st.tags.buckFilled ? 'Filled' : null, buy: st.tags.buck + st.tags.buckFilled >= 1 ? null : 'tag:buck', stats: 'One per season. Antlerless deer (does, fawns, button bucks) need a doe tag.' }) +
        row({ name: 'Doe tag (antlerless)', price: T.doe, owned: st.tags.doe ? `${st.tags.doe} in wallet` : null, buy: st.tags.doe + st.tags.doeFilled >= T.maxDoeTags ? null : 'tag:doe', stats: `Up to ${T.maxDoeTags} per season. Shooting does keeps the herd healthy and puts meat in the freezer.` }) +
        `<p class="faint">Shoot an antlered deer without a buck tag (or the other way around) and the DNR takes the deer: no money and no mount. Judge before you shoot.</p>`;
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
      <section class="panel" style="margin-top:10px"><div class="row" style="justify-content:space-between"><h2>Gear</h2><button class="btn small" data-back>Back to lodge</button></div>
        <p>Total warmth <b>${Math.round(plan.outfit.warmth)}</b>: comfortable down to about <b>${plan.comfortable}°F</b>. This ${st.slot} will feel like <b>${plan.effTemp}°F</b> on a ladder stand.</p>
        <div id="outfit">${UI.outfitEditor(lo)}</div>
        <h3>Mobile stand <span class="faint">needed to hunt public land</span></h3>
        <div class="row">${(() => { const own = C().mobileStands.filter((id) => inv.stands[id] > 0); return own.length ? own.map((id) => `<button class="btn small ${lo.mobile === id ? 'on' : ''}" data-mob="${id}">${esc(WT.standType(id).name)}</button>`).join('') + `<button class="btn small ${WT.mobileStand() ? '' : 'on'}" data-mob="">None</button>` : '<span class="faint">You don\'t own one. Hang-ons, climbers, saddles and pop-up blinds are at the Shop. The first three need a tree; a pop-up works anywhere.</span>'; })()}</div>
        <h3>Handedness</h3><div class="row"><button class="btn small ${st.settings.hand === 'right' ? 'on' : ''}" data-hand="right">Right-handed</button><button class="btn small ${st.settings.hand === 'left' ? 'on' : ''}" data-hand="left">Left-handed</button></div>
        <div class="cols" style="margin-top:6px">
          <div><h3>Pack (consumables)</h3>${C().consumables.filter((c) => (c.fuel ? inv.propane : inv.consum[c.id])).map((c) => `<p>${esc(c.name.replace(/ \(1 use\)/, ''))}: ${c.fuel ? inv.propane : inv.consum[c.id]}</p>`).join('') || '<p class="faint">Empty.</p>'}</div>
          <div><h3>In your truck</h3>${Object.entries(inv.stands).filter(([, n]) => n > 0).map(([id, n]) => `<p>${esc(WT.standType(id).name)} ×${n}</p>`).join('') || ''}${Object.entries(inv.cameras).filter(([, n]) => n > 0).map(([id, n]) => `<p>${esc(WT.camType(id).name)} ×${n}</p>`).join('')}${inv.equipment.some((e) => WT.equip(e).cat === 'light') ? `<p class="dim">Light battery: ${inv.lightCharge} hunts left</p>` : ''}</div>
        </div>
        <h3>Skills${st.skillPts ? ` · <span class="good">${st.skillPts} point${st.skillPts === 1 ? '' : 's'} to spend</span>` : ''}</h3>
        <div class="list">${Object.entries(C().skills).map(([k, sk]) => `<div class="item"><div><span class="nm">${esc(sk.name)}</span> <span class="dim">${st.skills[k]} / ${C().progression.skillMax}</span></div>
          <button class="btn small" data-sk="${k}" ${st.skillPts && st.skills[k] < C().progression.skillMax ? '' : 'disabled'}>+1</button><div class="st">${esc(sk.desc)}</div></div>`).join('')}</div>
      </section>`;
    el.querySelectorAll('[data-mob]').forEach((b) => b.addEventListener('click', () => { if (UI.err(WT.setMobile(b.dataset.mob))) return; WT.save(); const y = window.scrollY; UI.refresh(); window.scrollTo(0, y); }));
    el.querySelectorAll('[data-sk]').forEach((b) => b.addEventListener('click', () => { WT.spendSkill(b.dataset.sk); WT.save(); const y = window.scrollY; UI.refresh(); window.scrollTo(0, y); }));
    const canvas = $('canvas', el);
    const draw = (t) => {
      const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#2a1d16'; ctx.fillRect(0, 0, 240, 135);
      for (let y = 0; y < 135; y += 8) { ctx.fillStyle = y % 16 ? '#3a281e' : '#46301f'; ctx.fillRect(0, y, 240, 7); }
      ctx.save(); ctx.translate(96, 20); ctx.scale(1.5, 1.5 * 0.8); UI.drawPlayer(ctx, 0, 0, lo, st.settings.hand, t); ctx.restore();
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
  const BUILDING = '<section class="panel"><h2>Building the countryside</h2><p class="dim">Laying out about 18,000 acres of prairie, timber, fields and swamp, and stocking every property with deer. This takes a few seconds.</p></section>';
  UI.boot = function () {
    let ok = false;
    try { ok = WT.hasSave() && !!WT.load(); } catch (e) { ok = false; }
    if (!ok) { $('#screen').innerHTML = BUILDING; return setTimeout(() => { WT.newGame(); WT.save(); UI.boot2(); }, 60); }
    UI.boot2();
  };
  UI.boot2 = function () {
    $('#waitBtn').addEventListener('click', UI.wait);
    $('#huntBtn').addEventListener('click', () => UI.go('map', { mode: 'hunt' }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) UI.closeModal(); });
    S().settings = S().settings || { hand: 'right' };
    UI.go('lodge');
    if (!S().settings.tutMap && UI.mapTutorial) UI.mapTutorial();
    if (window.claude && window.claude.hot && window.claude.hot.snapshot) { try { window.claude.hot.snapshot(() => { WT.save(); return {}; }); } catch (e) { /* not in a viewer */ } }
  };
})();
