/* Whitetail Country UI: trophies (score sheets, trophy views, wall), hit list, trail camera photos. */
(function () {
  const WT = window.WT, UI = window.WTUI;
  const { $, esc } = UI;
  const S = () => WT.game.state;
  const Wd = () => WT.game.world;

  /* ---------------------------------------------------------------- image helpers */
  const canvasHtml = (id, w, h) => `<canvas class="pix" data-img="${id}" width="${w}" height="${h}"></canvas>`;
  function paint(root, id, img) { const c = root.querySelector(`[data-img="${id}"]`); if (c) UI.imgToCanvas(img, c); }
  UI.mountImg = (snap, w = 70, h = 76) => WT.renderMount(WT.snapDeer(snap), w, h);

  // Trail camera photo: images only. Night = IR grayscale; quality from camera tier and distance.
  UI.photoImg = function (ph, W = 160, H = 90) {
    const deer = WT.snapDeer(ph.snap);
    const ppi = Math.min(1.9, 17 / Math.max(5, ph.dist));
    const res = ppi * (0.35 + ph.q * 0.65);
    const view = { W, H, yaw: ph.yaw, elev: 3, center: [0, 28, 0], pose: { head: ph.pose }, day: ph.d, mode: ph.night ? 'ir' : 'day' };
    const img = WT.renderDeerLimited(deer, view, res, ppi);
    const out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      let r, g, b;
      if (img.data[o + 3]) { r = img.data[o]; g = img.data[o + 1]; b = img.data[o + 2]; }
      else if (ph.night) { const v = y < H * 0.45 ? 18 : 40 + (y - H * 0.45) * 0.6; r = g = b = v; }
      else { const sky = y < H * 0.4; r = sky ? 168 : 150; g = sky ? 172 : 130; b = sky ? 180 : 92; if (!sky && y < H * 0.48) { r = 70; g = 58; b = 42; } }
      const n = (WT.hash2(x, y, ph.d * 31 + ph.hour) - 0.5) * (ph.night ? 26 : 12) * (1.4 - ph.q);
      out[o] = r + n; out[o + 1] = g + n; out[o + 2] = b + n; out[o + 3] = 255;
    }
    return { data: out, W, H };
  };
  function photoHtml(ph, id) {
    const hh = ph.hour % 12 || 12, ap = ph.hour >= 12 ? 'PM' : 'AM';
    return `<figure class="photo">${canvasHtml(id, 160, 90)}<figcaption class="faint" style="font-size:15px;padding:2px 4px">${WT.dateLabel(ph.d)} Yr ${ph.y} · ${hh}:${String((ph.d * 7 + ph.hour * 13) % 60).padStart(2, '0')} ${ap} · ${esc(WT.camType(ph.camType).name)}</figcaption></figure>`;
  }

  /* ================================================================ SCORE SHEET */
  function sheetHtml(rec) {
    const sh = rec.sheet;
    if (!sh) return '';
    const names = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'].filter((n) => sh.sides.some((s) => s.tines[n] != null));
    const R = sh.sides[0], L = sh.sides[1];
    const f = (v) => (v == null ? '-' : (Math.round(v * 8) / 8).toFixed(3).replace(/\.?0+$/, '').replace(/\.125$/, ' 1/8').replace(/\.25$/, ' 2/8').replace(/\.375$/, ' 3/8').replace(/\.5$/, ' 4/8').replace(/\.625$/, ' 5/8').replace(/\.75$/, ' 6/8').replace(/\.875$/, ' 7/8'));
    const row = (name, a, b) => `<tr><td>${name}</td><td>${f(a)}</td><td>${f(b)}</td><td>${f(Math.abs((a || 0) - (b || 0)))}</td></tr>`;
    const abn = (s) => s.abn.map((a) => `${a.type} ${f(a.len)}`).join(', ') || 'none';
    return `<div class="sheet"><table>
      <tr><th>Measurement</th><th>Right</th><th>Left</th><th>Difference</th></tr>
      ${row('Main beam', R.beam, L.beam)}
      ${names.map((n) => row(`${n} (${n === 'G1' ? 'brow' : 'tine'})`, R.tines[n], L.tines[n])).join('')}
      ${[0, 1, 2, 3].map((k) => row(`H${k + 1} circumference`, R.H[k], L.H[k])).join('')}
      <tr><td>Points</td><td>${sh.pointsR}</td><td>${sh.pointsL}</td><td></td></tr>
      <tr><td>Abnormal points</td><td colspan="3" style="text-align:left">Right: ${esc(abn(R))}. Left: ${esc(abn(L))}.</td></tr>
      <tr><td>Inside spread</td><td colspan="2">${f(sh.insideSpread)}</td><td>credit ${f(sh.spreadCredit)}</td></tr>
      <tr class="tot"><td>Gross typical</td><td colspan="3">${f(sh.grossTypical)}</td></tr>
      <tr><td>Side-to-side differences</td><td colspan="3">−${f(sh.diffs)}</td></tr>
      <tr><td>Abnormal inches</td><td colspan="3">${f(sh.abnormal)}</td></tr>
      <tr class="tot"><td>Net typical</td><td colspan="3">${f(sh.netTypical)}</td></tr>
      ${sh.isNT ? `<tr class="tot"><td>Net non-typical</td><td colspan="3">${f(sh.netNonTypical)}</td></tr>` : ''}
      <tr class="tot"><td>Gross score</td><td colspan="3">${f(sh.gross)}</td></tr>
    </table></div><p class="dim">Scored ${sh.isNT ? 'non-typical' : 'typical'}: ${f(sh.net)} net. Outside spread ${f(sh.outsideSpread)}.</p>`;
  }

  UI.trophyDetail = function (rec, el, opts = {}) {
    const deer = WT.snapDeer(rec.snap);
    const isBuck = !!rec.sheet;
    const views = WT.TROPHY_VIEWS.map((v) => `<figure>${canvasHtml('v' + v.id, 128, 112)}<figcaption>${v.name}</figcaption></figure>`).join('');
    const hit = rec.hit;
    el.innerHTML = `<section class="panel"><div class="row" style="justify-content:space-between"><h2>${esc(rec.hit && rec.hit.name ? `"${rec.hit.name}", ` : '')}${esc(rec.label)}${rec.legal ? '' : ' <span class="tag">Confiscated</span>'}</h2><button class="btn small" id="back">${opts.backLabel || 'Back'}</button></div>
      <div class="views">${views}</div>
      <div class="cols" style="margin-top:10px">
        <div><dl class="kv">
          <dt>Age</dt><dd>${rec.age} years${hit ? ` <span class="dim">(you guessed ${hit.estAge})</span>` : ''}</dd>
          <dt>Weight</dt><dd>${rec.lw} lb live, ${rec.dw} lb dressed</dd>
          ${isBuck ? `<dt>Points</dt><dd>${rec.sheet.pointsR} × ${rec.sheet.pointsL}</dd><dt>Gross</dt><dd>${rec.sheet.gross}"</dd><dt>Net</dt><dd>${rec.sheet.net}" ${rec.sheet.isNT ? 'non-typical' : 'typical'}</dd>` : ''}
          <dt>Taken</dt><dd>${WT.dateLabel(rec.d)}, Year ${rec.y}, ${WT.fmtTime(rec.time)}, ${rec.dist} yd</dd>
          <dt>Where</dt><dd>${esc(rec.parcel)}</dd><dt>Rifle</dt><dd>${esc(rec.rifle)} (${esc(rec.cal)})</dd>
          <dt>Paid</dt><dd>${WT.money(rec.pay)}${rec.guessBonus ? ` + ${WT.money(rec.guessBonus)} guess bonus` : ''}</dd><dt>XP</dt><dd>+${rec.xp}</dd>
        </dl>
        ${isBuck && rec.legal ? `<div class="row" style="margin-top:8px"><button class="btn small" id="wall">${rec.wall ? 'Take off the wall' : 'Hang on the wall'}</button><button class="btn small" id="pin">${rec.pin ? 'Unpin from center' : 'Pin to center of wall'}</button></div>` : ''}
        ${hit ? `<h3>Your hit list history</h3>${hit.log.slice(0, 6).map((l) => `<p class="dim">${WT.dateLabel(l.d)} Yr ${l.y}: ${esc(l.kind === 'photo' ? 'trail cam' : 'seen')}, ${esc(l.where)}</p>`).join('')}` : ''}</div>
        <div>${isBuck ? sheetHtml(rec) : '<p class="dim">Antlerless deer. Good meat, and one less mouth on your land this winter.</p>'}</div>
      </div></section>`;
    const ppi = WT.MOUNT_PPI;
    WT.TROPHY_VIEWS.forEach((v) => paint(el, 'v' + v.id, WT.renderTrophy(deer, v.id, 128, 112, v.id === 'top' ? ppi * 1.6 : ppi, 40)));
    $('#back', el).addEventListener('click', opts.onBack || (() => UI.go('trophies')));
    const w = $('#wall', el); if (w) w.addEventListener('click', () => { rec.wall = !rec.wall; WT.save(); UI.trophyDetail(rec, el, opts); });
    const p = $('#pin', el); if (p) p.addEventListener('click', () => { S().journal.forEach((r) => { if (r !== rec) r.pin = false; }); rec.pin = !rec.pin; rec.wall = true; WT.save(); UI.trophyDetail(rec, el, opts); });
  };

  /* ================================================================ REVEAL (after a harvest) */
  UI.screens.reveal = function (el, rec) {
    if (!rec) return UI.go('lodge');
    if (!rec.sheet || rec.guessed) return UI.trophyDetail(rec, el, { backLabel: 'Back to the lodge', onBack: () => UI.go('lodge') });
    el.innerHTML = `<section class="panel"><h2>Walk up on him</h2>
      <div style="max-width:280px;margin:0 auto">${canvasHtml('m', 70, 76)}</div>
      <p>Before the tape comes out: what does he score? Guess within 5 inches of the gross score for a ${WT.money(50)} bragging-rights bonus from the guys at the café.</p>
      <div class="row"><input type="number" id="guess" min="20" max="260" step="1" inputmode="numeric" placeholder="Gross inches"><button class="btn blaze" id="lock">Lock it in</button><button class="btn ghost" id="skip">Skip</button></div></section>`;
    paint(el, 'm', UI.mountImg(rec.snap));
    const c = el.querySelector('[data-img="m"]'); c.style.width = '100%';
    const finish = (g) => {
      rec.guessed = true;
      if (g) {
        rec.guess = g;
        if (Math.abs(g - rec.sheet.gross) <= 5) { rec.guessBonus = 50; S().cash += 50; UI.toast(`You guessed ${g}". He grosses ${rec.sheet.gross}". +$50!`, 'good'); }
        else UI.toast(`You guessed ${g}". He grosses ${rec.sheet.gross}".`);
      }
      WT.save(); UI.topbar();
      UI.trophyDetail(rec, el, { backLabel: 'Back to the lodge', onBack: () => UI.go('lodge') });
    };
    $('#lock', el).addEventListener('click', () => { const g = +$('#guess', el).value; if (!g) return UI.toast('Type a number first.'); finish(g); });
    $('#skip', el).addEventListener('click', () => finish(null));
  };

  /* ================================================================ TROPHIES */
  UI.screens.trophies = function (el) {
    const st = S();
    const recs = st.journal;
    el.innerHTML = `<section class="panel"><div class="row" style="justify-content:space-between"><h2>Trophy room</h2><button class="btn small" id="back">Back to lodge</button></div>
      ${recs.length ? `<p class="dim">${recs.length} deer taken. Biggest gross: ${Math.max(0, ...recs.filter((r) => r.sheet).map((r) => r.sheet.gross)) || '-'}".</p>
      <div class="tiles">${recs.map((r, k) => `<button class="tile" data-k="${k}">${canvasHtml('t' + k, 70, 76)}<span class="cap">${esc(r.label)}${r.sheet ? ` · ${r.sheet.gross}"` : ''}</span><span class="cap faint">${WT.dateLabel(r.d)}, Yr ${r.y}${r.wall ? ' · on wall' : ''}</span></button>`).join('')}</div>`
      : '<p class="dim">Nothing yet. The wall is waiting.</p>'}</section>`;
    recs.forEach((r, k) => paint(el, 't' + k, UI.mountImg(r.snap)));
    el.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => UI.trophyDetail(recs[+b.dataset.k], el, { onBack: () => UI.go('trophies') })));
    $('#back', el).addEventListener('click', () => UI.go('lodge'));
  };

  /* ================================================================ HIT LIST */
  const STATUSES = ['Hit list', 'Pass', 'Cull', 'Doe', 'Watch'];
  let hlFilter = 'All', hlSort = 'last';
  UI.screens.hitlist = function (el, arg) {
    const st = S(), w = Wd();
    if (arg && arg.k != null) return hitDetail(el, arg.k);
    if (arg && arg.photos) return photosScreen(el);
    let list = st.hitList.slice();
    if (hlFilter !== 'All') list = list.filter((e) => e.status === hlFilter);
    const lastKey = (e) => (e.last ? e.last[0] * 1000 + e.last[1] : 0);
    if (hlSort === 'last') list.sort((a, b) => lastKey(b) - lastKey(a));
    if (hlSort === 'age') list.sort((a, b) => WT.estAgeNow(b) - WT.estAgeNow(a));
    if (hlSort === 'name') list.sort((a, b) => (a.name || '~').localeCompare(b.name || '~'));
    const idx = (e) => st.hitList.length - st.hitList.indexOf(e);
    el.innerHTML = `<section class="panel"><div class="row" style="justify-content:space-between"><h2>Hit list</h2><div class="row"><button class="btn small" id="photos">Camera photos (${st.photos.length})</button><button class="btn small" id="back">Back to lodge</button></div></div>
      <p class="dim">Every deer you've seen clearly or caught on camera. Pictures show him as he looked the last time you saw him. The game won't tell you if he's still alive.</p>
      <div class="row" style="margin-bottom:8px">${['All', ...STATUSES].map((s) => `<button class="btn small ${hlFilter === s ? 'on' : ''}" data-f="${s}">${s}</button>`).join('')}
        <select id="sort"><option value="last" ${hlSort === 'last' ? 'selected' : ''}>Last seen</option><option value="age" ${hlSort === 'age' ? 'selected' : ''}>Your age guess</option><option value="name" ${hlSort === 'name' ? 'selected' : ''}>Name</option></select></div>
      ${list.length ? `<div class="tiles">${list.map((e) => `<button class="tile" data-k="${e.k}">${canvasHtml('h' + e.k, 70, 76)}<span class="cap">${esc(e.name || 'Unnamed deer #' + idx(e))} <span class="tag">${esc(e.status)}</span></span>
        <span class="cap dim">About ${WT.estAgeNow(e)} yrs (your guess)</span><span class="cap faint">Last seen ${e.last ? `${WT.dateLabel(e.last[1])}, Yr ${e.last[0]}` : 'never'}</span></button>`).join('')}</div>`
      : '<p class="faint">Nobody on the list yet. Get a clear look at a buck (close, or through good binoculars) or catch one on a trail camera.</p>'}</section>`;
    list.forEach((e) => { if (e.snap) paint(el, 'h' + e.k, UI.mountImg(e.snap)); });
    el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { hlFilter = b.dataset.f; UI.refresh(); }));
    $('#sort', el).addEventListener('change', (ev) => { hlSort = ev.target.value; UI.refresh(); });
    el.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => hitDetail(el, +b.dataset.k)));
    $('#back', el).addEventListener('click', () => UI.go('lodge'));
    $('#photos', el).addEventListener('click', () => photosScreen(el));
    void w;
  };

  function hitDetail(el, k) {
    const st = S(), w = Wd();
    const e = WT.hitEntry(k);
    if (!e) return UI.go('hitlist');
    const ages = []; for (let a = 0.5; a <= 12.5; a += 1) ages.push(a);
    const lastSide = e.snap ? `<figure style="margin:0;background:#ece7df">${canvasHtml('side', 128, 96)}</figure>` : '';
    el.innerHTML = `<section class="panel"><div class="row" style="justify-content:space-between"><h2>${esc(e.name || 'Unnamed deer')}</h2><button class="btn small" id="back">Back to hit list</button></div>
      <div class="cols">
        <div><div class="views"><figure>${canvasHtml('mount', 70, 76)}<figcaption>Last clear look (${e.snap ? `${WT.dateLabel(e.snap.d)}, Yr ${e.snap.y}` : '-'})</figcaption></figure>${lastSide ? `<figure>${canvasHtml('side', 128, 96)}<figcaption>From the side</figcaption></figure>` : ''}</div>
          ${e.photos.length ? '<h3>Trail camera</h3><div class="views">' + e.photos.map((ph, i) => photoHtml(ph, 'p' + i)).join('') + '</div>' : ''}</div>
        <div>
          <label>Name <input type="text" id="nm" maxlength="30" value="${esc(e.name || '')}" placeholder="Big 10, Split G2..."></label>
          <div class="row" style="margin-top:6px"><label>Status <select id="stt">${STATUSES.map((s) => `<option ${e.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label>Your age guess <select id="age">${ages.map((a) => `<option value="${a}" ${WT.estAgeNow(e) === a ? 'selected' : ''}>${a} yrs</option>`).join('')}</select></label></div>
          <p class="faint">Your age guess goes up one year every season on its own.</p>
          <label>Notes<textarea id="notes" maxlength="400">${esc(e.notes || '')}</textarea></label>
          <div class="row" style="margin-top:6px"><button class="btn" id="save">Save</button><button class="btn ghost" id="rm">Remove from list</button><span id="rmq" class="dim"></span></div>
          <dl class="kv" style="margin-top:10px"><dt>Last seen</dt><dd>${esc(WT.lastSeenText(e))}</dd><dt>Seen on</dt><dd>${e.places.map((p) => esc(w.parcels[p] ? w.parcels[p].name : '?')).join(', ')}</dd><dt>Added</dt><dd>${WT.dateLabel(e.added[1])}, Year ${e.added[0]}</dd></dl>
          <h3>Sighting log</h3>${e.log.map((l) => `<p class="dim">${WT.dateLabel(l.d)} Yr ${l.y}, ${typeof l.t === 'number' && l.t > 24 ? '' : l.kind === 'photo' ? `${l.t}:00` : WT.fmtTime(l.t)}: ${esc(l.kind === 'photo' ? 'trail camera' : l.doing || 'seen')} · ${esc(l.where)}${l.dist ? ` · ${l.dist} yd` : ''}</p>`).join('')}
        </div>
      </div></section>`;
    if (e.snap) {
      paint(el, 'mount', UI.mountImg(e.snap));
      paint(el, 'side', WT.renderTrophy(WT.snapDeer(e.snap), 'side', 128, 96, 1.2, e.snap.d));
    }
    e.photos.forEach((ph, i) => paint(el, 'p' + i, UI.photoImg(ph)));
    $('#back', el).addEventListener('click', () => UI.go('hitlist'));
    $('#save', el).addEventListener('click', () => {
      e.name = $('#nm', el).value.trim() || null;
      e.status = $('#stt', el).value;
      const a = +$('#age', el).value; e.estAge = a; e.estYear = st.year;
      e.notes = $('#notes', el).value;
      WT.save(); UI.toast('Saved.', 'good'); hitDetail(el, k);
    });
    let armed = false;
    $('#rm', el).addEventListener('click', () => { if (!armed) { armed = true; $('#rmq', el).innerHTML = '<span class="warn">Press again to remove.</span>'; return; } WT.removeHit(k); WT.save(); UI.go('hitlist'); });
  }

  function photosScreen(el) {
    const st = S();
    el.innerHTML = `<section class="panel"><div class="row" style="justify-content:space-between"><h2>Camera photos</h2><button class="btn small" id="back">Back to hit list</button></div>
      <p class="dim">Newest first. Clear photos of bucks go on your hit list by themselves. Add anything else you want to keep track of.</p>
      ${st.photos.length ? `<div class="views">${st.photos.slice(0, 40).map((ph, i) => `<div>${photoHtml(ph, 'q' + i)}${!WT.hitEntry(ph.snap.k) && ph.q >= 0.45 ? `<button class="btn small" data-add="${i}" style="margin-top:4px">Add to hit list</button>` : WT.hitEntry(ph.snap.k) ? '<span class="faint">On your list</span>' : '<span class="faint">Too blurry to know him again</span>'}</div>`).join('')}</div>`
      : '<p class="faint">No photos yet. Buy a trail camera, hang it on your land, and check it (or get a cellular one).</p>'}</section>`;
    st.photos.slice(0, 40).forEach((ph, i) => paint(el, 'q' + i, UI.photoImg(ph)));
    el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
      const ph = st.photos[+b.dataset.add];
      WT.noteDeer(WT.snapDeer(ph.snap), { level: 3, pid: ph.pid, time: ph.hour, where: 'Trail camera', kind: 'photo', photo: ph, force: true });
      WT.save(); UI.toast('Added.', 'good'); photosScreen(el);
    }));
    $('#back', el).addEventListener('click', () => UI.go('hitlist'));
  }
})();
