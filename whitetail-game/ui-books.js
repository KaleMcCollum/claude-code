/* Whitetail Country UI: trophies (score sheets, trophy views, wall), hit list, trail camera photos. */
(function () {
  const WT = window.WT, UI = window.WTUI;
  const { $, esc } = UI;
  const S = () => WT.game.state;
  const Wd = () => WT.game.world;

  /* ---------------------------------------------------------------- image helpers */
  const canvasHtml = (id, w, h, dark) => `<canvas class="pix" data-img="${id}" width="${w}" height="${h}"${dark ? ' style="background:#523a2b"' : ''}></canvas>`;
  const boneMount = (r) => r.mount === 'euro' || r.mount === 'cap'; // skull and cap need a dark wall behind them
  function paint(root, id, img) { const c = root.querySelector(`[data-img="${id}"]`); if (c) UI.imgToCanvas(img, c); }
  // Every picture of a deer is the same front-facing art; the mount is the full-size bust.
  UI.mountImg = (snap, mount) => WT.deerSprite(WT.snapDeer(snap), { lod: 0, frame: 'bust', day: snap.d, mount });

  // Trail camera photo: images only. Night = infrared gray; clarity from camera tier and distance.
  UI.photoImg = function (ph, W = 160, H = 90) {
    const deer = WT.snapDeer(ph.snap);
    const close = ph.dist <= 13;
    let lod = close ? 1 : 2, k = 1;
    if (ph.q < 0.45) { lod++; k = 2; } // a blurry photo is a coarser picture blown up
    const pose = ph.pose === 'down' ? 'down' : ph.pose === 'walk' ? 'walk' : 'alert';
    let spr = WT.deerSprite(deer, { lod, frame: 'full', pose, day: ph.d, mode: ph.night ? 'ir' : 'day' });
    const ax = spr.anchor.x * k, ay = spr.anchor.y * k;
    if (k > 1) spr = WT.scaleSprite(spr, k);
    const out = new Uint8ClampedArray(W * H * 4);
    const horizon = Math.round(H * 0.42);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      let r, g, b;
      if (ph.night) { const v = y < horizon ? 14 : 34 + (y - horizon) * 0.7; r = g = b = v; }
      else { const sky = y < horizon; r = sky ? 176 : 156; g = sky ? 182 : 136; b = sky ? 190 : 96; if (!sky && y < horizon + 5) { r = 74; g = 62; b = 46; } }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
    // close deer fill the frame (legs run off the bottom); farther deer stand in it
    const gx = Math.round(W * (0.3 + 0.4 * WT.hash2(ph.snap.k, ph.d, ph.hour)));
    const gy = close && pose !== 'down' ? H + Math.round(18 * k) : H - 6;
    for (let y = 0; y < spr.H; y++) for (let x = 0; x < spr.W; x++) {
      const si = (y * spr.W + x) * 4; if (!spr.data[si + 3]) continue;
      const X = gx - ax + x, Y = gy - ay + y; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const o = (Y * W + X) * 4; out[o] = spr.data[si]; out[o + 1] = spr.data[si + 1]; out[o + 2] = spr.data[si + 2];
    }
    for (let i = 0; i < W * H; i++) { const n = (WT.hash2(i % W, (i / W) | 0, ph.d * 31 + ph.hour) - 0.5) * (ph.night ? 26 : 10) * (1.4 - ph.q); const o = i * 4; out[o] += n; out[o + 1] += n; out[o + 2] += n; }
    return { data: out, W, H };
  };
  function photoHtml(ph, id) {
    const hh = ph.hour % 12 || 12, ap = ph.hour >= 12 ? 'PM' : 'AM';
    const known = WT.hitEntry(ph.snap.k);
    const tag = known && ph.q >= 0.45 ? `<span class="good">Hit list: ${esc(known.name || 'unnamed deer')}</span> · ` : '';
    return `<figure class="photo">${canvasHtml(id, 160, 90)}<figcaption class="faint" style="font-size:15px;padding:2px 4px">${tag}${ph.read ? `<span class="dim">${esc(ph.read)}</span><br>` : ''}${WT.dateLabel(ph.d)} Yr ${ph.y} · ${hh}:${String((ph.d * 7 + ph.hour * 13) % 60).padStart(2, '0')} ${ap} · ${esc(WT.camType(ph.camType).name)}${ph.at ? ` · at ${esc(ph.at)}` : ''}</figcaption></figure>`;
  }

  /* ================================================================ SCORE SHEET */
  function sheetHtml(rec) {
    const sh = rec.sheet;
    if (!sh) return '';
    const names = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'].filter((n) => sh.sides.some((s) => s.tines[n] != null));
    const R = sh.sides[0], L = sh.sides[1];
    const f = (v) => (v == null ? '-' : (Math.round(v * 8) / 8).toFixed(3).replace(/\.?0+$/, '').replace(/\.125$/, ' 1/8').replace(/\.25$/, ' 2/8').replace(/\.375$/, ' 3/8').replace(/\.5$/, ' 4/8').replace(/\.625$/, ' 5/8').replace(/\.75$/, ' 6/8').replace(/\.875$/, ' 7/8').replace(/^(-?)0 (\d\/8)$/, '$1$2'));
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

  const MOUNTS = () => WT.CONFIG.economy.mounts;
  UI.trophyDetail = function (rec, el, opts = {}) {
    const deer = WT.snapDeer(rec.snap);
    const isBuck = !!rec.sheet;
    const views = `<figure class="hero">${canvasHtml('vfront', 88, 92, boneMount(rec))}</figure>`;
    const hit = rec.hit;
    el.innerHTML = `<section class="panel"><div class="row" style="justify-content:space-between"><h2>${esc(rec.hit && rec.hit.name ? `"${rec.hit.name}", ` : '')}${esc(rec.label)}${rec.legal ? '' : ' <span class="tag">Confiscated</span>'}</h2><button class="btn small" id="back">${opts.backLabel || 'Back'}</button></div>
      <div class="cols">
        <div>${views}<dl class="kv" style="margin-top:10px">
          <dt>Age</dt><dd>${rec.age} years${hit ? ` <span class="dim">(you guessed ${hit.estAge})</span>` : ''}</dd>
          <dt>Weight</dt><dd>${rec.lw} lb live, ${rec.dw} lb dressed</dd>
          ${isBuck ? `<dt>Points</dt><dd>${rec.sheet.pointsR} × ${rec.sheet.pointsL}</dd><dt>Gross</dt><dd>${rec.sheet.gross}"</dd><dt>Net</dt><dd>${rec.sheet.net}" ${rec.sheet.isNT ? 'non-typical' : 'typical'}</dd>` : ''}
          <dt>Taken</dt><dd>${WT.dateLabel(rec.d)}, Year ${rec.y}, ${WT.fmtTime(rec.time)}, ${rec.dist} yd</dd>
          <dt>Where</dt><dd>${esc(rec.parcel)}</dd><dt>Rifle</dt><dd>${esc(rec.rifle)} (${esc(rec.cal)})</dd>
          <dt>Paid</dt><dd>${WT.money(rec.pay)}${rec.guessBonus ? ` + ${WT.money(rec.guessBonus)} guess bonus` : ''}</dd><dt>XP</dt><dd>+${rec.xp}</dd>
        </dl>
        ${isBuck && rec.legal ? `<h3>Taxidermy</h3><p class="dim">${rec.mount ? `${esc(MOUNTS()[rec.mount].name)} in your trophy room.` : 'Not mounted. Pay the taxidermist to put him in your trophy room.'}</p><div class="row">${Object.keys(MOUNTS()).map((k) => `<button class="btn small ${rec.mount === k ? 'on' : ''}" data-mount="${k}" ${rec.mount === k ? 'disabled' : ''}>${esc(MOUNTS()[k].name)} ${rec.mount === k ? '✓' : WT.money(MOUNTS()[k].price)}</button>`).join('')}</div>` : ''}
        ${hit ? `<h3>Your hit list history</h3>${hit.log.slice(0, 6).map((l) => `<p class="dim">${WT.dateLabel(l.d)} Yr ${l.y}: ${esc(l.kind === 'photo' ? 'trail cam' : 'seen')}, ${esc(l.where)}</p>`).join('')}` : ''}</div>
        <div>${isBuck ? sheetHtml(rec) : '<p class="dim">Antlerless deer. Good meat, and one less mouth on your land this winter.</p>'}</div>
      </div></section>`;
    paint(el, 'vfront', UI.mountImg(rec.snap, rec.mount));
    $('#back', el).addEventListener('click', opts.onBack || (() => UI.go('trophies')));
    el.querySelectorAll('[data-mount]').forEach((b) => b.addEventListener('click', () => {
      if (UI.err(WT.mountDeer(rec, b.dataset.mount))) return;
      UI.toast(`${MOUNTS()[rec.mount].name} ordered. He's in the trophy room.`, 'good'); UI.topbar(); UI.trophyDetail(rec, el, opts);
    }));
  };

  /* ================================================================ REVEAL (after a harvest) */
  UI.screens.reveal = function (el, rec) {
    if (!rec) return UI.go('lodge');
    if (!rec.sheet || rec.guessed) return UI.trophyDetail(rec, el, { backLabel: 'Back to the lodge', onBack: () => UI.go('lodge') });
    el.innerHTML = `<section class="panel"><h2>Walk up on him</h2>
      <div style="max-width:280px;margin:0 auto">${canvasHtml('m', 88, 92)}</div>
      <p>Before the tape comes out: what does he score? Guess within 5 inches of the gross score for a ${WT.money(50)} bragging-rights bonus from the guys at the café.</p>
      <div class="row"><input type="number" id="guess" min="20" max="260" step="1" inputmode="numeric" placeholder="Gross inches"><button class="btn blaze" id="lock">Lock it in</button><button class="btn ghost" id="skip">Skip</button></div></section>`;
    paint(el, 'm', UI.mountImg(rec.snap));
    const c = el.querySelector('[data-img="m"]'); c.style.width = '100%';
    const finish = (g) => {
      rec.guessed = true;
      if (g) {
        rec.guess = g;
        if (Math.abs(g - rec.sheet.gross) <= 5) { rec.guessBonus = 50; S().cash += 50; WT.ledger('Score guess bonus', 50); UI.toast(`You guessed ${g}". He grosses ${rec.sheet.gross}". +$50!`, 'good'); }
        else UI.toast(`You guessed ${g}". He grosses ${rec.sheet.gross}".`);
      }
      WT.save(); UI.topbar();
      UI.trophyDetail(rec, el, { backLabel: 'Back to the lodge', onBack: () => UI.go('lodge') });
    };
    $('#lock', el).addEventListener('click', () => { const g = +$('#guess', el).value; if (!g) return UI.toast('Type a number first.'); finish(g); });
    $('#skip', el).addEventListener('click', () => finish(null));
  };

  /* ================================================================ TROPHIES */
  // One mount at a time on the wall; arrows, swipe or arrow keys pan to the next.
  let roomAt = 0;
  function drawRoom(canvas, rec) {
    const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    ctx.imageSmoothingEnabled = false;
    const planks = ['#5a4030', '#523a2b', '#4a3426'];
    for (let y = 0; y < H; y++) { ctx.fillStyle = y % 12 === 11 ? '#2d1c14' : planks[Math.floor(y / 12) % 3]; ctx.fillRect(0, y, W, 1); }
    if (!rec) return;
    const spr = UI.sprite('room' + rec.id + ':' + rec.y + ':' + rec.mount, () => UI.mountImg(rec.snap, rec.mount));
    const cx = W >> 1, b = spr.bounds || { y0: 0, y1: spr.height };
    const top = Math.round((H - (b.y1 - b.y0)) / 2) - b.y0 - (rec.mount === 'shoulder' ? 2 : 0);
    // wooden plaque behind the mount
    const py = top + spr.anchor.y, shield = (x0, y0, w, h, c) => { ctx.fillStyle = c; for (let r = 0; r < h; r++) { const t = r / h, k = t < 0.55 ? 1 : Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.55) / 0.45, 2))); const hw = Math.round(w / 2 * (0.25 + 0.75 * k)); ctx.fillRect(x0 - hw, y0 + r, hw * 2, 1); } };
    if (rec.mount === 'cap') { shield(cx, py - 8, 34, 32, '#2a1a12'); shield(cx, py - 6, 30, 28, '#7a5234'); }
    else if (rec.mount === 'euro') { shield(cx, py - 10, 40, 50, '#2a1a12'); shield(cx, py - 8, 36, 46, '#6b4a2e'); }
    else { shield(cx, py + 6, 44, 40, '#2a1a12'); shield(cx, py + 8, 40, 36, '#6b4a2e'); }
    ctx.drawImage(spr, cx - spr.anchor.x, top);
  }
  UI.screens.trophies = function (el) {
    const st = S();
    const recs = st.journal, mounted = WT.mountedDeer();
    roomAt = Math.max(0, Math.min(roomAt, mounted.length - 1));
    const biggest = Math.max(0, ...recs.filter((r) => r.sheet && r.legal).map((r) => r.sheet.gross));
    el.innerHTML = `<section class="panel"><div class="row" style="justify-content:space-between"><h2>Trophy room</h2><button class="btn small" id="back">Back to lodge</button></div>
      ${mounted.length ? `<div class="room">${UI.stage(120, 104, `<div class="ov" style="left:6px;top:50%;transform:translateY(-50%)"><button class="btn" id="prev" aria-label="Previous mount">◀</button></div><div class="ov" style="right:6px;top:50%;transform:translateY(-50%)"><button class="btn" id="next" aria-label="Next mount">▶</button></div>`)}
        <p id="cap" style="text-align:center;margin:8px 0 4px"></p><div class="row" style="justify-content:center"><button class="btn small" id="det">Score sheet</button></div></div>`
      : `<p class="dim">No mounts yet. After you tag a buck, pay the taxidermist: shoulder mount ${WT.money(MOUNTS().shoulder.price)}, European ${WT.money(MOUNTS().euro.price)}, felt cap ${WT.money(MOUNTS().cap.price)}.</p>`}</section>
      <section class="panel" style="margin-top:10px"><h3>Every deer you've taken</h3>
      ${recs.length ? `<p class="dim">${recs.length} deer taken${biggest ? `. Biggest gross: ${biggest}"` : ''}. Tap one to see it or get it mounted.</p>
      <div class="tiles">${recs.map((r, k) => `<button class="tile" data-k="${k}">${canvasHtml('t' + k, 88, 92, boneMount(r))}<span class="cap">${esc(r.label)}${r.sheet ? ` · ${r.sheet.gross}"` : ''}</span><span class="cap faint">${WT.dateLabel(r.d)}, Yr ${r.y}${r.mount ? ' · ' + esc(MOUNTS()[r.mount].name.toLowerCase()) : !r.legal ? ' · taken by DNR' : ''}</span></button>`).join('')}</div>`
      : '<p class="dim">Nothing yet.</p>'}</section>`;
    recs.forEach((r, k) => paint(el, 't' + k, UI.mountImg(r.snap, r.mount)));
    el.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => UI.trophyDetail(recs[+b.dataset.k], el, { onBack: () => UI.go('trophies') })));
    $('#back', el).addEventListener('click', () => UI.go('lodge'));
    if (!mounted.length) return;
    const canvas = $('.room canvas', el);
    const show = () => {
      const r = mounted[roomAt];
      drawRoom(canvas, r);
      $('#cap', el).innerHTML = `<b>${esc(r.hit && r.hit.name ? `"${r.hit.name}"` : r.label)}</b> · ${r.sheet.gross}" gross · ${r.sheet.pointsR} × ${r.sheet.pointsL}<br><span class="dim">${esc(MOUNTS()[r.mount].name)} · ${WT.dateLabel(r.d)}, Year ${r.y} · ${esc(r.parcel)}</span><br><span class="faint">${roomAt + 1} of ${mounted.length}</span>`;
    };
    const move = (d) => { roomAt = (roomAt + d + mounted.length) % mounted.length; show(); };
    $('#prev', el).addEventListener('click', () => move(-1));
    $('#next', el).addEventListener('click', () => move(1));
    $('#det', el).addEventListener('click', () => UI.trophyDetail(mounted[roomAt], el, { onBack: () => UI.go('trophies') }));
    if (mounted.length < 2) { $('#prev', el).hidden = true; $('#next', el).hidden = true; }
    let sx = null;
    canvas.addEventListener('pointerdown', (e) => { sx = e.clientX; });
    canvas.addEventListener('pointerup', (e) => { if (sx != null && Math.abs(e.clientX - sx) > 30) move(e.clientX < sx ? 1 : -1); sx = null; });
    const key = (e) => { if (e.key === 'ArrowLeft') move(-1); else if (e.key === 'ArrowRight') move(1); };
    window.addEventListener('keydown', key);
    show();
    return () => window.removeEventListener('keydown', key);
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
      ${list.length ? `<div class="tiles">${list.map((e) => `<button class="tile" data-k="${e.k}">${canvasHtml('h' + e.k, 88, 92)}<span class="cap">${esc(e.name || 'Unnamed deer #' + idx(e))} <span class="tag">${esc(e.status)}</span></span>
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
    el.innerHTML = `<section class="panel"><div class="row" style="justify-content:space-between"><h2>${esc(e.name || 'Unnamed deer')}</h2><button class="btn small" id="back">Back to hit list</button></div>
      <div class="cols">
        <div><div class="views"><figure>${canvasHtml('mount', 88, 92)}<figcaption>Last clear look (${e.snap ? `${WT.dateLabel(e.snap.d)}, Yr ${e.snap.y}` : '-'})</figcaption></figure></div>
          ${e.photos.length ? '<h3>Trail camera</h3><div class="views">' + e.photos.map((ph, i) => photoHtml(ph, 'p' + i)).join('') + '</div>' : ''}</div>
        <div>
          <label>Name <input type="text" id="nm" maxlength="30" value="${esc(e.name || '')}" placeholder="Big 10, Split G2..."></label>
          <div class="row" style="margin-top:6px"><label>Status <select id="stt">${STATUSES.map((s) => `<option ${e.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label>Your age guess <select id="age">${ages.map((a) => `<option value="${a}" ${WT.estAgeNow(e) === a ? 'selected' : ''}>${a} yrs</option>`).join('')}</select></label></div>
          <p class="faint">Your age guess goes up one year every season on its own.</p>
          <label>Notes<textarea id="notes" maxlength="400">${esc(e.notes || '')}</textarea></label>
          <div class="row" style="margin-top:6px"><button class="btn" id="save">Save</button><button class="btn ghost" id="rm">Remove from list</button><span id="rmq" class="dim"></span></div>
          ${e.read ? `<p style="margin-top:10px"><b>Your best read:</b> ${esc(e.read)}</p>` : ''}
          <dl class="kv" style="margin-top:10px"><dt>Last seen</dt><dd>${esc(WT.lastSeenText(e))}</dd><dt>Seen on</dt><dd>${e.places.map((p) => esc(w.parcels[p] ? w.parcels[p].name : '?')).join(', ')}</dd><dt>Added</dt><dd>${WT.dateLabel(e.added[1])}, Year ${e.added[0]}</dd></dl>
          <h3>Sighting log</h3>${e.log.map((l) => `<p class="dim">${WT.dateLabel(l.d)} Yr ${l.y}, ${typeof l.t === 'number' && l.t > 24 ? '' : l.kind === 'photo' ? `${l.t}:00` : WT.fmtTime(l.t)}: ${esc(l.kind === 'photo' ? 'trail camera' : l.doing || 'seen')} · ${esc(l.where)}${l.dist ? ` · ${l.dist} yd` : ''}</p>`).join('')}
        </div>
      </div></section>`;
    if (e.snap) {
      paint(el, 'mount', UI.mountImg(e.snap));
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
