/* Whitetail Country UI: the world map (choose where to hunt, buy and manage land). */
(function () {
  const WT = window.WT, UI = window.WTUI;
  const { $, esc } = UI;
  const S = () => WT.game.state;
  const Wd = () => WT.game.world;
  const T = WT.T;
  const LW = 480, LH = 270; // logical map canvas

  /* ---------------------------------------------------------------- palette (flat, one color per tile) */
  const PAL = {
    0: { oct: ['#4a6a8a', '#557898'], nov: ['#46627e', '#4f6c88'], dec: ['#b8c4cc', '#c6d0d6'] },
    1: { oct: ['#557898', '#5f84a2'], nov: ['#4f6c88', '#587692'], dec: ['#c6d0d6', '#d0d8dd'] },
    2: { oct: ['#8a8a4a', '#7c7c42'], nov: ['#7a6e44', '#6e633e'], dec: ['#c9c2a8', '#bdb69c'] },
    3: { oct: ['#a8682e', '#8c5a2a'], nov: ['#5e4a34', '#54422e'], dec: ['#7a6e64', '#6c6058'] },
    4: { oct: ['#7a6a2e', '#6a5c28'], nov: ['#4e4632', '#46402e'], dec: ['#6e6a62', '#625e56'] },
    5: { oct: ['#8a5a3a', '#7a4e34'], nov: ['#5c4636', '#524032'], dec: ['#9a908a', '#8e847e'] },
    6: { oct: ['#b49a5a', '#a88e50'], nov: ['#a08a5e', '#958056'], dec: ['#e2ddd2', '#d8d2c6'] },
    7: { oct: ['#a6a25a', '#9a964f'], nov: ['#958e62', '#8a845a'], dec: ['#e6e2d8', '#dcd8cc'] },
    8: { oct: ['#8a9a52', '#808e4c'], nov: ['#8c8a60', '#827f58'], dec: ['#e6e2d8', '#dcd8cc'] },
    9: { oct: ['#c8b062', '#b8a056'], nov: ['#b09a62', '#a48e5a'], dec: ['#d8d0bc', '#ccc4b0'] },
    10: { oct: ['#c09848', '#b08a42'], nov: ['#8c7a5a', '#827052'], dec: ['#e8e4dc', '#dedad0'] },
    11: { oct: ['#d2bc78', '#c6b06e'], nov: ['#b8a878', '#ac9c6e'], dec: ['#ece8e0', '#e2ded4'] },
    12: { oct: ['#5a4a2e', '#6a5634'], nov: ['#4a3e2a', '#544630'], dec: ['#c8c0b0', '#bcb4a4'] },
    13: { oct: ['#9a8e7e', '#9a8e7e'], nov: ['#9a8e7e', '#9a8e7e'], dec: ['#a49a8e', '#a49a8e'] },
    14: { oct: ['#8a3a2a', '#c8b89a'], nov: ['#8a3a2a', '#c8b89a'], dec: ['#8a3a2a', '#e8e4dc'] },
    15: { oct: ['#6a6060', '#8a3a2a'], nov: ['#6a6060', '#8a3a2a'], dec: ['#7a7070', '#9a4a3a'] },
    16: { oct: ['#5e9a3e', '#54903a'], nov: ['#6a8e44', '#60843e'], dec: ['#a8b89a', '#9cac8e'] },
    17: { oct: ['#8a9a4a', '#7c8c44'], nov: ['#76784a', '#6c6e44'], dec: ['#b0aca0', '#a4a094'] },
    18: { oct: ['#4a6a8a', '#557898'], nov: ['#46627e', '#4f6c88'], dec: ['#b8c4cc', '#c6d0d6'] },
    19: { oct: ['#6e5038', '#644832'], nov: ['#6e5038', '#644832'], dec: ['#d8d2c6', '#ccc6ba'] },
  };
  const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const TINT = { player: [70, 120, 200, 0.42], public: [80, 150, 70, 0.36], bow: [40, 110, 60, 0.5], perm: [220, 170, 70, 0.38] };
  const STAND_LETTER = { ground: 'G', saddle: 'S', hangon: 'H', climber: 'C', popup: 'P', tripod: 'T', ladder: 'L', box: 'B', house: 'X' };

  // Simple view: four colors that say what deer use the ground for.
  // The map shows the four kinds of ground, plus water, roads and your own food plots.
  const SIMPLE = {
    prairie: ['#b9a868', '#b2a160'], timber: ['#4f6b3a', '#56733f'], farm: ['#d9b24a', '#d2aa42'], farmOff: ['#cfc49a', '#c8bc90'],
    swamp: ['#5d6f6a', '#667a70'], plot: ['#6fb04a', '#68a644'], water: ['#4a78a8', '#4a78a8'], people: ['#8a8076', '#8a8076'],
  };
  const catOf = (c) => { const lt = WT.landType(c); return c === T.PLOT || c === T.PLOT_NEW ? 'plot' : lt === 'road' ? 'people' : lt === 'farm' && WT.cropsOff() ? 'farmOff' : lt; };
  UI.MAP_SIMPLE = SIMPLE;
  function huntable(d) { return d.owner === 'player' || d.owner === 'public' || d.permBought; }
  function buildBase(huntMode) {
    const w = Wd(), st = S();
    const simple = (st.settings.mapStyle || 'simple') === 'simple';
    const season = st.day < 31 ? 'oct' : st.day < 61 ? 'nov' : 'dec';
    const c = document.createElement('canvas'); c.width = w.W; c.height = w.H;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w.W, w.H);
    for (let i = 0; i < w.W * w.H; i++) {
      const x = i % w.W, y = (i / w.W) | 0;
      const p = simple ? SIMPLE[catOf(w.cover[i])] || SIMPLE.prairie : (PAL[w.cover[i]] || PAL[8])[season];
      const rgb = hexRgb(p[simple ? (WT.hash2(x >> 1, y >> 1, 3) < 0.5 ? 0 : 1) : (x + y) % 2 === 0 || WT.hash2(x, y, 3) < 0.5 ? 0 : 1]);
      img.data.set([...rgb, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
    const t = document.createElement('canvas'); t.width = w.W; t.height = w.H;
    const tctx = t.getContext('2d');
    const timg = tctx.createImageData(w.W, w.H);
    for (let i = 0; i < w.W * w.H; i++) {
      const pid = w.parcelOf[i]; if (pid < 0) continue;
      const d = st.parcels[pid];
      if (simple) {
        // simple view: no color wash; land you can't hunt is dimmed so your spots stand out
        if (huntMode && !huntable(d)) timg.data.set([20, 14, 10, 120], i * 4);
        continue;
      }
      const k = d.owner === 'player' ? 'player' : d.owner === 'public' ? (d.bowOnly ? 'bow' : 'public') : d.permBought ? 'perm' : null;
      if (!k) continue;
      const [r, g, b, a] = TINT[k];
      timg.data.set([r, g, b, Math.round(a * 255)], i * 4);
    }
    tctx.putImageData(timg, 0, 0);
    return { base: c, tint: t, season };
  }

  /* A map view bound to a canvas. opts: { onTap(x, y, pid), focus: pid, markers: fn(ctx, view) } */
  UI.mapView = function (canvas, opts) {
    const w = Wd();
    const ctx = canvas.getContext('2d');
    canvas.width = LW; canvas.height = LH;
    let layers = buildBase(opts.huntMode);
    const fitZoom = Math.min(LW / w.W, LH / w.H);
    const v = { cx: w.W / 2, cy: w.H / 2, z: fitZoom, sel: opts.sel ?? null, hover: null, tool: null };
    const clampView = () => {
      v.z = Math.max(fitZoom * 0.75, Math.min(28, v.z));
      // you can slide past the edge of the map, far enough to put any corner of it in the middle of the screen
      v.cx = Math.max(0, Math.min(w.W, v.cx));
      v.cy = Math.max(0, Math.min(w.H, v.cy));
    };
    v.focus = (pid, zoom) => { const p = w.parcels[pid]; v.cx = (p.minX + p.maxX + 1) / 2; v.cy = (p.minY + p.maxY + 1) / 2; v.z = zoom || Math.min(22, Math.min(LW / (p.maxX - p.minX + 12), LH / (p.maxY - p.minY + 12))); clampView(); draw(); };
    const toTile = (sx, sy) => [v.cx + (sx - LW / 2) / v.z, v.cy + (sy - LH / 2) / v.z];
    const toScreen = (tx, ty) => [(tx - v.cx) * v.z + LW / 2, (ty - v.cy) * v.z + LH / 2];
    v.toScreen = toScreen;
    function draw() {
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#1c1410'; ctx.fillRect(0, 0, LW, LH);
      const sx = v.cx - LW / 2 / v.z, sy = v.cy - LH / 2 / v.z;
      ctx.drawImage(layers.base, sx, sy, LW / v.z, LH / v.z, 0, 0, LW, LH);
      ctx.drawImage(layers.tint, sx, sy, LW / v.z, LH / v.z, 0, 0, LW, LH);
      // parcel borders (only the visible window)
      const x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy)), x1 = Math.min(w.W - 1, Math.ceil(sx + LW / v.z)), y1 = Math.min(w.H - 1, Math.ceil(sy + LH / v.z));
      const st = S();
      const simpleView = (st.settings.mapStyle || 'simple') === 'simple';
      const thick = v.z >= 6 ? 2 : 1;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * w.W + x, p = w.parcelOf[i];
        const r = x < w.W - 1 ? w.parcelOf[i + 1] : p, b = y < w.H - 1 ? w.parcelOf[i + w.W] : p;
        if (p === r && p === b) continue;
        const [X, Y] = toScreen(x, y);
        const col = (q) => {
          if (q === v.sel || p === v.sel) return '#ffe08a';
          const own = (id) => (id >= 0 ? st.parcels[id] : null);
          for (const id of [p, q]) { const d = own(id); if (d && d.owner === 'player') return '#7fb0ff'; }
          for (const id of [p, q]) { const d = own(id); if (d && d.owner === 'public') return d.bowOnly ? '#2f6a3e' : '#b6e08a'; }
          for (const id of [p, q]) { const d = own(id); if (d && d.permBought) return '#e2b04a'; }
          if (!opts.huntMode && (st.forSale.includes(q) || st.forSale.includes(p))) return '#ff8a3a';
          return simpleView ? null : 'rgba(28,20,16,.55)';
        };
        const bw = simpleView ? Math.max(2, thick) : thick;
        if (p !== r && p >= 0 | r >= 0) { const c = col(r); if (c) { ctx.fillStyle = c; ctx.fillRect(Math.round(X + v.z) - (bw >> 1), Math.round(Y), bw, Math.ceil(v.z)); } }
        if (p !== b && p >= 0 | b >= 0) { const c = col(b); if (c) { ctx.fillStyle = c; ctx.fillRect(Math.round(X), Math.round(Y + v.z) - (bw >> 1), Math.ceil(v.z), bw); } }
      }
      // sanctuary: hatched so you can see where you promised not to go
      if (v.z >= 3) for (const p of w.parcels) {
        const d = st.parcels[p.id]; if (d.owner !== 'player' || !d.sanctuary.length) continue;
        const work = WT.sanctuaryInfo(p.id).working;
        for (const i of d.sanctuary) { ctx.fillStyle = work.has(i) ? 'rgba(255,224,138,.42)' : 'rgba(255,90,60,.45)'; const [X, Y] = toScreen(i % w.W, (i / w.W) | 0); const n = Math.max(2, Math.round(v.z / 3)); for (let k = 0; k < v.z; k += n * 2) ctx.fillRect(Math.round(X + k), Math.round(Y), n, Math.ceil(v.z)); }
      }
      // labels
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      for (const p of w.parcels) {
        const d = st.parcels[p.id];
        const show = d.owner === 'player' || d.owner === 'public' || p.id === v.sel || d.permBought || (!opts.huntMode && st.forSale.includes(p.id));
        if (!show || v.z < 3.2 && p.id !== v.sel && d.owner !== 'player') continue;
        const [X, Y] = toScreen(p.labelX + 0.5, p.labelY + 0.5);
        if (X < -40 || Y < -10 || X > LW + 40 || Y > LH + 10) continue;
        let txt = d.owner === 'player' ? p.name : d.owner === 'public' ? p.name + (d.bowOnly ? ' (BOW)' : '') : st.forSale.includes(p.id) ? '$ FOR SALE' : p.name;
        if (v.z < 5) txt = d.owner === 'player' ? 'YOU' : d.owner === 'public' ? (d.bowOnly ? 'BOW' : 'PUB') : st.forSale.includes(p.id) ? '$' : '';
        if (!txt) continue;
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(20,14,10,.72)'; ctx.fillRect(Math.round(X - tw / 2 - 2), Math.round(Y - 9), Math.ceil(tw + 4), 11);
        ctx.fillStyle = d.owner === 'player' ? '#a9c6ff' : d.owner === 'public' ? '#b6e08a' : st.forSale.includes(p.id) ? '#ffb070' : '#EFE3D3';
        ctx.fillText(txt, Math.round(X), Math.round(Y));
      }
      // markers: stands, spots, cameras, plots
      const mark = (x, y, letter, fg, bg) => {
        const [X, Y] = toScreen(x + 0.5, y + 0.5);
        const s = v.z >= 8 ? 11 : 8;
        ctx.fillStyle = '#1c1410'; ctx.fillRect(Math.round(X - s / 2) - 1, Math.round(Y - s / 2) - 1, s + 2, s + 2);
        ctx.fillStyle = bg; ctx.fillRect(Math.round(X - s / 2), Math.round(Y - s / 2), s, s);
        if (s >= 10) { ctx.fillStyle = fg; ctx.font = '8px "Press Start 2P", monospace'; ctx.fillText(letter, Math.round(X) + 1, Math.round(Y) + 4); }
      };
      ctx.textAlign = 'center';
      for (const p of w.parcels) {
        const d = st.parcels[p.id];
        if (d.owner === 'player') {
          for (const s of d.stands) mark(s.x, s.y, STAND_LETTER[s.type] || '?', '#1c1410', '#C4A688');
          for (const c of d.cams) {
            // a camera on a stand's own tile rides on the stand marker as a corner badge
            if (d.stands.some((s) => s.x === c.x && s.y === c.y)) {
              const [X, Y] = toScreen(c.x + 0.5, c.y + 0.5), s = v.z >= 8 ? 11 : 8;
              ctx.fillStyle = '#1c1410'; ctx.fillRect(Math.round(X + s / 2) - 3, Math.round(Y - s / 2) - 4, 7, 7);
              ctx.fillStyle = c.queue && c.queue.length ? '#ffe08a' : '#B8B4C8'; ctx.fillRect(Math.round(X + s / 2) - 2, Math.round(Y - s / 2) - 3, 5, 5);
            } else mark(c.x, c.y, c.queue && c.queue.length ? '!' : '▪', '#1c1410', c.queue && c.queue.length ? '#ffe08a' : '#B8B4C8');
          }
        } else if (d.owner === 'npc' && (d.permBought || (p.id === v.sel && d.permission))) {
          for (const s of d.stands) mark(s.x, s.y, STAND_LETTER[s.type] || '?', '#1c1410', d.permBought ? '#d6a84a' : '#6a5a4a');
        } else if (d.owner === 'public') {
          for (const s of d.spots || []) mark(s.x, s.y, '✚', '#1c1410', '#b6e08a');
          for (const c of d.cams || []) {
            if ((d.spots || []).some((s) => s.x === c.x && s.y === c.y)) { const [X, Y] = toScreen(c.x + 0.5, c.y + 0.5), s = v.z >= 8 ? 11 : 8; ctx.fillStyle = '#1c1410'; ctx.fillRect(Math.round(X + s / 2) - 3, Math.round(Y - s / 2) - 4, 7, 7); ctx.fillStyle = c.queue && c.queue.length ? '#ffe08a' : '#B8B4C8'; ctx.fillRect(Math.round(X + s / 2) - 2, Math.round(Y - s / 2) - 3, 5, 5); }
            else mark(c.x, c.y, c.queue && c.queue.length ? '!' : '▪', '#1c1410', c.queue && c.queue.length ? '#ffe08a' : '#B8B4C8');
          }
        }
      }
      if (opts.overlay) opts.overlay(ctx, v);
    }
    v.draw = draw;
    v.rebuild = () => { layers = buildBase(opts.huntMode); draw(); };
    // input: drag to pan, wheel/pinch to zoom, tap to select
    const pts = new Map();
    let downAt = null, moved = 0, pinch0 = null;
    const rel = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * LW / r.width, (e.clientY - r.top) * LH / r.height]; };
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, rel(e)); downAt = rel(e); moved = 0; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: v.z }; } });
    canvas.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = rel(e), prev = pts.get(e.pointerId);
      pts.set(e.pointerId, p);
      if (pts.size === 2 && pinch0) { const [a, b] = [...pts.values()]; v.z = pinch0.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(1, pinch0.d); clampView(); draw(); moved += 10; return; }
      const dx = p[0] - prev[0], dy = p[1] - prev[1];
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 4) { v.cx -= dx / v.z; v.cy -= dy / v.z; clampView(); draw(); }
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch0 = null;
      if (moved <= 4 && downAt && pts.size === 0) {
        const [tx, ty] = toTile(p[0], p[1]);
        const x = Math.floor(tx), y = Math.floor(ty);
        if (x >= 0 && y >= 0 && x < w.W && y < w.H) opts.onTap(x, y, w.parcelOf[y * w.W + x]);
      }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); pinch0 = null; });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); const [mx, my] = rel(e); const [tx, ty] = toTile(mx, my); v.z *= e.deltaY < 0 ? 1.2 : 1 / 1.2; clampView(); v.cx = tx - (mx - LW / 2) / v.z; v.cy = ty - (my - LH / 2) / v.z; clampView(); draw(); }, { passive: false });
    v.zoomBy = (f) => { v.z *= f; clampView(); draw(); };
    draw();
    return v;
  };

  /* ---------------------------------------------------------------- helpers for cards */
  const stars = (n) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '?????');
  const pressureHtml = (v) => { const n = Math.min(5, Math.round(v * 10)); return `<span class="${n >= 4 ? 'bad' : n >= 2 ? 'warn' : 'good'}">${'■'.repeat(n)}${'□'.repeat(5 - n)}</span> <span class="faint">${n >= 4 ? 'burned, rest it' : n >= 2 ? 'getting hunted' : 'fresh'}</span>`; };
  // The four things that decide a sit up top; everything else folds under More info.
  UI.knowledgeHtml = function (s, extra = '') {
    const st = S(), k = WT.standKnowledge(s);
    const rec = (s.recent || []).slice(0, 4).map((r) => `<p class="dim">${WT.dateLabel(r.d)} ${r.s}: ${r.seen ? r.seen + ' deer seen' : 'nothing'} (wind ${r.wind})</p>`).join('');
    if (!k.known) return `<p class="dim">You haven't sat here yet. One sit tells you its rating, its winds and how far you can see.</p><dl class="kv"><dt>Pressure</dt><dd>${pressureHtml(k.pressure)}</dd></dl>${extra}`;
    const b = UI.betScore(s);
    const line = (name, o) => `<dt>${name}</dt><dd><span class="stars">${stars(o.stars)}</span></dd>`;
    return `<dl class="kv"><dt>Stand rating</dt><dd><b>${k.rating}</b> / 100</dd>
      <dt>This ${st.slot}</dt><dd><span class="stars">${stars(b.stars)}</span> <span class="faint">${b.notes.join(', ')}</span></dd>
      <dt>Wind</dt><dd>${st.weather.windDir} today · best on ${k.winds.join(', ')}</dd>
      <dt>Pressure</dt><dd>${pressureHtml(k.pressure)}</dd></dl>
      <details style="margin-top:6px"><summary class="btn small" style="display:inline-block;cursor:pointer">More info</summary>
      <dl class="kv" style="margin-top:6px"><dt>Rating means</dt><dd><span class="faint">better than ${k.rating}% of spots on the map</span></dd>
      <dt>Consistency</dt><dd>${k.consistency.name} <span class="faint">${k.consistency.note}</span></dd>
      <dt>View</dt><dd>${k.view}</dd>
      ${line('Mornings', k.morning)}${line('Evenings', k.evening)}${line('Rut', k.rut)}${line('Big bucks', k.mature)}
      <dt>Sits</dt><dd>${k.sits}</dd></dl>${extra}${rec ? '<h3>Recent sits</h3>' + rec : ''}</details>`;
  };
  function listingHtml(p) {
    const st = S(), w = Wd(), h = p.habitat;
    const price = WT.landPrice(p.id);
    const cb = WT.coverBreakdown(h).map(([n, f]) => `${n} ${Math.round(f * 100)}%`).join(' · ');
    let road = false;
    for (let y = p.minY; y <= p.maxY && !road; y++) for (let x = p.minX; x <= p.maxX; x++) { const i = y * w.W + x; if (w.parcelOf[i] === p.id && w.distRoad[i] <= 1) { road = true; break; } }
    const town = w.towns[0];
    const miles = (Math.hypot(p.cx - town.x, p.cy - town.y) * 104 / 5280).toFixed(1);
    const nbs = [...p.neighbors].map((q) => st.parcels[q].owner).reduce((a, o) => { a[o] = (a[o] || 0) + 1; return a; }, {});
    const nbTxt = Object.entries(nbs).map(([o, n]) => `${n} ${o === 'player' ? 'yours' : o === 'public' ? 'public' : 'private'}`).join(', ');
    return `<dl class="kv"><dt>Acres</dt><dd>${p.acres}</dd><dt>Price</dt><dd>${WT.money(price)} (${WT.money(price / p.acres)}/acre)</dd>
      <dt>Cover</dt><dd>${esc(cb)}</dd><dt>Road</dt><dd>${road ? 'Gravel road frontage' : 'Landlocked, field access only'}</dd><dt>Town</dt><dd>${miles} miles to ${esc(town.name)}</dd><dt>Neighbors</dt><dd>${esc(nbTxt)}</dd></dl>
      <p class="dim">${esc(flavor(h))}</p>`;
  }
  function flavor(h) {
    const cb = Object.fromEntries(WT.coverBreakdown(h));
    const bits = [];
    if ((cb['Timber'] || 0) > 0.25) bits.push('Wooded draws and tree rows'); else if ((cb['Timber'] || 0) > 0.08) bits.push('A few shelterbelts');
    if ((cb['Slough/water'] || 0) > 0.1) bits.push('cattail sloughs'); if ((cb['Grass/CRP'] || 0) > 0.25) bits.push('tall CRP grass');
    if ((cb['Crop'] || 0) > 0.4) bits.push('surrounded by crop ground'); else if ((cb['Crop'] || 0) > 0.1) bits.push('some crop fields');
    return bits.length ? bits.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.' : 'Open prairie.';
  }

  /* ---------------------------------------------------------------- legend, best bets, tutorial */
  UI.mapLegend = function (mode) {
    const simple = (S().settings.mapStyle || 'simple') === 'simple';
    const sw = (c, t, box) => `<span><span style="color:${c}">${box ? '▢' : '■'}</span> ${t}</span>`;
    const land = [sw('#7fb0ff', 'yours', 1), sw('#b6e08a', 'public', 1), sw('#e2b04a', 'permission', 1)].concat(mode === 'hunt' ? [] : [sw('#ff8a3a', 'for sale', 1)]);
    return (simple ? [sw(SIMPLE.prairie[0], 'prairie'), sw(SIMPLE.timber[0], 'timber'), sw(WT.cropsOff() ? SIMPLE.farmOff[0] : SIMPLE.farm[0], WT.cropsOff() ? 'farm (crops off)' : 'farm'), sw(SIMPLE.swamp[0], 'swamp'), sw(SIMPLE.water[0], 'water')] : []).concat(land).join('');
  };
  // Ranks a stand using only what the player has learned plus today's wind. Hidden values stay hidden.
  // Today's sit: stars are how close this sit is to the stand's own best (5 = as good as this stand gets).
  UI.betScore = function (s) {
    const st = S(), k = WT.standKnowledge(s);
    if (!k.known) return { stars: null, rating: null, score: 30, notes: ['never sat here'] };
    const d = WT.sitToday(s, st.slot === 'morning' ? 'morning' : 'evening');
    const notes = [d.windOk ? '<span class="good">wind is right</span>' : d.windNear ? '<span class="warn">wind is close</span>' : '<span class="bad">wrong wind</span>'];
    if (d.sesF < 0.75) notes.push(`better in the ${s.r.morning > s.r.evening ? 'morning' : 'evening'}`);
    if (d.presF < 0.8) notes.push('<span class="warn">pressured</span>');
    if (d.dayF < 0.8) notes.push('deer are off it today');
    { const w0 = Wd(), pid0 = w0.parcelOf[s.y * w0.W + s.x], ce = pid0 >= 0 ? WT.cropEffect(pid0) : null; if (ce && ce.phase === 'rush') notes.push('<span class="good">crops just came off</span>'); else if (ce && ce.phase === 'off' && ce.f < 0.95) notes.push('<span class="warn">crops are off</span>'); }
    return { stars: d.stars, rating: k.rating, score: k.rating * d.factor, notes };
  };
  UI.mapTutorial = function (page = 0) {
    const st = S();
    const swatch = (c) => `<span style="display:inline-block;width:14px;height:14px;background:${c};vertical-align:middle;margin-right:6px;border:1px solid #1c1410"></span>`;
    const box = (c) => `<span style="display:inline-block;width:14px;height:14px;border:3px solid ${c};vertical-align:middle;margin-right:6px"></span>`;
    const pages = [
      `<h2>Reading the map (1/3): four kinds of ground</h2>
       <p>${swatch(SIMPLE.prairie[0])}<b>Prairie</b>: open grass, hay and stubble. The most common ground and the middle of the road for deer. You can build anything on it, and it's where food plots and tree rows go.</p>
       <p>${swatch(SIMPLE.timber[0])}<b>Timber</b>: woods, tree rows and brush. Better than prairie: it holds more deer, and shots are close.</p>
       <p>${swatch(SIMPLE.farm[0])}<b>Farm</b>: someone's crop. You can't build or mark anything on it. It holds deer until the combines roll in the second week of October. Then for two weeks deer are packed into the cover beside it (the best hunting of the year if you have timber or swamp there), and after that they drift to the neighbors.</p>
       <p>${swatch(SIMPLE.swamp[0])}<b>Swamp</b>: rare, and where the old bucks live. Ladder stands and carried stands only: no blinds, no building.</p>
       <p>${swatch(SIMPLE.water[0])}<b>Water</b> · ${swatch(SIMPLE.people[0])}<b>Roads, farmyards and town</b>: deer avoid people, and stands near roads get bumped walking in.</p>`,
      `<h2>Reading the map (2/3): whose land</h2>
       <p>${box('#7fb0ff')}<b>Blue outline</b>: your land. Hunt any stand you put up. Bow or rifle.</p>
       <p>${box('#b6e08a')}<b>Green outline</b>: public land. Free, but crowded and pressured. Mark up to 3 spots per area. You need a mobile stand equipped under Gear: a hang-on, climber or saddle for a tree, or a pop-up blind for open ground.</p>
       <p>${box('#2f6a3e')}<b>Dark green</b>: bow-only public land. You need a bow equipped to hunt it.</p>
       <p>${box('#e2b04a')}<b>Gold outline</b>: a neighbor gave you permission. Hunt only their stands.</p>
       <p>${box('#ff8a3a')}<b>Orange outline</b> (Land screen): for sale.</p>
       <p class="dim">When you're picking a hunt, land you can't hunt is darkened so your spots stand out.</p>`,
      `<h2>Reading the map (3/3): where to sit</h2>
       <p><b>Edges are best.</b> Deer travel between cover and food. A stand where green meets gold, or in a tree row or creek that connects them, sees the most deer.</p>
       <p><b>Mornings:</b> sit near cover and catch deer going back to bed. <b>Evenings:</b> sit near food as they come out to feed. <b>The rut</b> (early to mid November): travel routes between cover are best all day.</p>
       <p><b>Wind:</b> deer smell you downwind. Each spot has winds that work; steady spots work on many winds, fickle ones on just one.</p>
       <p><b>Timber or open?</b> In timber deer show at 20 to 200 yards, an easy shot for a starter rifle. Open country shows more ground but deer are 150 to 500 yards out, which takes a real rifle and scope.</p>
       <p><b>Rating:</b> sit a spot once and you learn its rating out of 100. That number never changes, and great spots are rare. The stars are today's sit: 5 means the stand is at its best, fewer means wind, time of day or pressure is holding it back. A sit can never beat the stand's rating.</p>
       <p><b>Pressure:</b> hunting the same stand every day fills its pressure meter. Rest it a few days.</p>
       <p class="dim">Markers: letters are stands (L ladder, B box blind, H hang-on...), ✚ is a public spot.</p>`,
    ];
    UI.modal(`${pages[page]}<div class="row" style="margin-top:10px">${page > 0 ? '<button class="btn ghost" data-tp="-1">Back</button>' : ''}${page < pages.length - 1 ? '<button class="btn blaze" data-tp="1">Next</button>' : '<button class="btn blaze" data-tdone>Got it</button><button class="btn" data-tguide>Full guide</button>'}<button class="btn ghost small" data-tdone>Skip</button></div>`, (m) => {
      m.querySelectorAll('[data-tp]').forEach((b) => b.addEventListener('click', () => UI.mapTutorial(page + +b.dataset.tp)));
      m.querySelectorAll('[data-tguide]').forEach((b) => b.addEventListener('click', () => { st.settings.tutMap = true; WT.save(); UI.guide(); }));
      m.querySelectorAll('[data-tdone]').forEach((b) => b.addEventListener('click', () => { st.settings.tutMap = true; WT.save(); UI.closeModal(); }));
    });
  };

  /* ================================================================ MAP SCREEN */
  // What is stacked with a stand: a camera on it, food or water close enough to count.
  UI.stackHtml = function (pid, s) {
    const d = S().parcels[pid], info = WT.tileInfo(pid, s.x, s.y), out = [];
    if (d.owner === 'player' || d.owner === 'public') {
      for (const c of WT.camsAtStand(pid, s)) out.push(`<span class="good">Trail camera on this stand</span>: ${WT.camRate(c) != null ? WT.camRate(c).toFixed(1) + ' deer a week, ' : ''}${c.total || 0} photo${c.total === 1 ? '' : 's'} so far${c.total ? ` (${c.dayN || 0} in daylight, ${c.bucks || 0} of bucks)` : ''}${c.queue && c.queue.length ? `, <b>${c.queue.length} waiting on the card</b>` : ''}`);
      if (!WT.camsAtStand(pid, s).length) out.push('<span class="faint">No camera here. Hang one on this spot to learn what walks past this stand.</span>');
    }
    if (info.nearPlot) out.push(info.nearPlot.ready ? '<span class="good">Food plot at this stand</span>: counted in its rating, most of all for evening sits' : '<span class="warn">New food plot at this stand</span>: it grows in next season and the rating goes up then');
    if (info.nearWater) out.push('<span class="good">Water at this stand</span>: counted in its rating, most of all in early October');
    if (d.owner === 'player') { const cfg = WT.CONFIG.sanctuary, w2 = Wd(); const n = (d.sanctuary || []).filter((i) => Math.hypot(i % w2.W - s.x, ((i / w2.W) | 0) - s.y) <= cfg.standTiles).length; if (n) out.push(`<span class="bad">Too close to your sanctuary</span>: ${n} sanctuary tile${n === 1 ? '' : 's'} within 100 yards of this stand ${n === 1 ? "doesn't" : "don't"} count while it's here`); }
    return out.length ? `<h3>Stacked here</h3>${out.map((t) => `<p style="margin:2px 0">${t}</p>`).join('')}` : '';
  };

  // args: { mode: 'hunt' | 'land', pid, sid }
  UI.screens.map = function (el, args) {
    args = Object.assign({ mode: 'hunt' }, args || {});
    const st = S(), w = Wd();
    const land = args.mode === 'land';
    const state = { pid: args.pid ?? null, sid: args.sid ?? null, cid: null, tile: null, move: null, plot: { type: 'rye', acres: 1 }, standType: null, camType: null };
    el.innerHTML = UI.stage(LW, LH, `
      <div class="ov" style="right:8px;top:8px;flex-direction:column"><button class="btn ghost small" data-z="in">+</button><button class="btn ghost small" data-z="out">−</button><button class="btn ghost small" data-z="home">Home</button></div>
      <div class="ov" style="left:8px;top:8px"><button class="btn ghost small" data-back>Lodge</button><button class="btn ghost small ${land ? '' : 'on'}" data-mode="hunt">Hunt</button><button class="btn ghost small ${land ? 'on' : ''}" data-mode="land">Land</button></div>
      <div class="ov" style="right:8px;bottom:8px;flex-direction:column"><button class="btn ghost small" data-help aria-label="How to read the map">?</button></div>`) +
      `<div class="row" id="banner" style="margin-top:6px;padding:4px 8px;border:2px solid #ffe08a;align-items:center;justify-content:space-between" hidden></div>
      <div class="row dim" style="font-size:15px;gap:4px 12px;margin-top:6px">${UI.mapLegend(args.mode)}<span class="faint">Drag to move, pinch or +/− to zoom</span></div>
      <section class="panel" id="card" style="margin-top:8px"></section>`;
    const card = $('#card', el), banner = $('#banner', el);
    const plotDims = (acres) => { const side = Math.round(Math.sqrt(acres * 4)); return [Math.ceil(acres * 4 / side), side]; };
    const view = UI.mapView($('canvas', el), {
      sel: state.pid,
      huntMode: !land,
      onTap: (x, y, pid) => onTap(x, y, pid),
      overlay: (ctx, v) => {
        const t = state.tile; if (!t) return;
        const box = (x, y, wd, hg, col) => { const [X, Y] = v.toScreen(x, y); const W2 = Math.round(wd * v.z), H2 = Math.round(hg * v.z), X0 = Math.round(X), Y0 = Math.round(Y); ctx.fillStyle = col; ctx.fillRect(X0 - 1, Y0 - 1, W2 + 2, 2); ctx.fillRect(X0 - 1, Y0 + H2 - 1, W2 + 2, 2); ctx.fillRect(X0 - 1, Y0 - 1, 2, H2 + 2); ctx.fillRect(X0 + W2 - 1, Y0 - 1, 2, H2 + 2); };
        // where a plot would go if you planted it from this corner
        if (land && state.showPlot && st.parcels[state.pid] && st.parcels[state.pid].owner === 'player') { const [pw, ph] = plotDims(state.plot.acres); box(t.x, t.y, pw, ph, '#8fe06a'); }
        const m = Math.max(0, (9 / v.z - 1) / 2); // never smaller than a marker
        box(t.x - m, t.y - m, 1 + 2 * m, 1 + 2 * m, '#ffe08a');
      },
    });
    const refreshMap = () => { view.sel = state.pid; view.draw(); };
    el.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => { const z = b.dataset.z; if (z === 'in') view.zoomBy(1.4); else if (z === 'out') view.zoomBy(1 / 1.4); else view.focus(w.starterId); }));
    el.querySelector('[data-back]').addEventListener('click', () => UI.go('lodge'));
    el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.mode !== args.mode) UI.go('map', { mode: b.dataset.mode, pid: state.pid, sid: state.sid }); }));
    st.settings.mapStyle = 'simple';
    el.querySelector('[data-help]').addEventListener('click', () => UI.mapTutorial());
    if (!st.settings.tutMap) setTimeout(() => UI.mapTutorial(), 50);
    if (state.pid != null) view.focus(state.pid); else view.focus(w.starterId, 6);
    if (state.pid != null && state.sid) { const d0 = st.parcels[state.pid], s0 = [...(d0.stands || []), ...(d0.spots || [])].find((z) => z.sid === state.sid); if (s0) selectTile(state.pid, s0.x, s0.y); }

    function setBanner() {
      banner.hidden = !state.move;
      if (!state.move) return;
      el.querySelector('.stage').scrollIntoView({ block: 'nearest' }); // on a phone the map may have scrolled off the top
      banner.innerHTML = `<span style="color:var(--cream)">Tap where the ${state.move.kind === 'stand' ? 'stand' : 'camera'} goes</span><button class="btn small" id="mcancel">Cancel</button>`;
      $('#mcancel', banner).addEventListener('click', () => { state.move = null; setBanner(); });
    }
    // Pick a spot. A tap on or right beside a stand, spot or camera snaps to it, so what you add next lands on the same tile.
    function selectTile(pid, x, y) {
      const d = st.parcels[pid];
      state.pid = pid; state.sid = null; state.cid = null; state.tile = null; state.showPlot = false;
      if (d.owner === 'player' || d.owner === 'public' || d.permBought) {
        const info = WT.tileInfo(pid, x, y);
        const snap = info.stand || info.cam;
        state.tile = snap ? { x: snap.x, y: snap.y } : d.owner !== 'npc' ? { x, y } : null;
        if (state.tile) { const at = WT.tileInfo(pid, state.tile.x, state.tile.y); state.sid = at.stand ? at.stand.sid : null; state.cid = at.cam ? at.cam.cid : null; }
      }
      view.sel = pid;
    }
    function onTap(x, y, pid) {
      if (pid < 0) return;
      if (state.move) {
        if (pid !== state.pid) return UI.toast('Keep it on the same property.', 'bad');
        const e = state.move.kind === 'stand' ? WT.moveStand(pid, state.move.id, x, y) : WT.moveCamera(pid, state.move.id, x, y);
        if (UI.err(e)) return;
        state.move = null; setBanner(); done('Moved.', false, x, y);
        return;
      }
      selectTile(pid, x, y);
      refreshMap(); renderCard();
    }
    // after any change: save, redraw, keep the same spot selected
    function done(msg, terrain, x, y) {
      WT.save();
      if (msg) UI.toast(msg, 'good');
      const t = x != null ? { x, y } : state.tile;
      if (t) selectTile(state.pid, t.x, t.y);
      if (terrain) view.rebuild();
      refreshMap(); renderCard(); UI.topbar();
    }

    const rateTxt = (c) => { const r = WT.camRate(c); return r == null ? (WT.camType(c.type).cell ? 'no days logged yet' : 'check the card to see') : `${r.toFixed(1)} deer a week`; };
    function camBlock(c) {
      const ct = WT.camType(c.type), sg = WT.camSight(c);
      return `<div class="item" style="display:block;margin-top:6px"><div class="row"><span class="nm">${esc(ct.name)}</span><span class="dim">${ct.cell ? 'sends photos by itself' : c.queue && c.queue.length ? `<b>${c.queue.length} photos waiting on the card</b>` : 'nothing new on the card'}</span></div>
          <dl class="kv"><dt>Activity</dt><dd><b>${rateTxt(c)}</b></dd><dt>Photos</dt><dd>${c.total || 0}${c.total ? ` · ${c.dayN || 0} in daylight · ${c.bucks || 0} of bucks` : ''}</dd>
          <dt>Sees here</dt><dd>clear to ${sg.clear} yd, nothing past ${sg.reach} yd${sg.limited ? ' <span class="faint">(cover is cutting it short)</span>' : ''}</dd><dt>Up for</dt><dd>${c.days || 0} day${c.days === 1 ? '' : 's'}</dd></dl>
          <div class="row" style="margin-top:6px">${ct.cell ? '' : '<button class="btn small" id="ccheck">Check card</button>'}<button class="btn small" id="cmove">Move</button><button class="btn small" id="cpick">Pick up</button><button class="btn small" id="cphotos">Photos</button></div></div>`;
    }
    function addCamRow(onStand) {
      const cams = Object.entries(st.inv.cameras).filter(([, n]) => n > 0);
      return `<div class="row" style="margin-top:6px">${cams.length ? `<select id="camSel">${cams.map(([id, n]) => `<option value="${id}" ${state.camType === id ? 'selected' : ''}>${esc(WT.camType(id).name)} (${n})</option>`).join('')}</select><button class="btn small" id="addCam">Hang camera${onStand ? ' on this spot' : ' here'}</button>` : '<span class="faint">No cameras in your truck. Buy one at the Shop.</span>'}</div>`;
    }
    // every camera you have out, best first: this is how you find the next place to sit
    function camReport() {
      const all = WT.allCameras(); if (!all.length) return '';
      return `<h3>Camera report</h3><p class="dim">Busiest first. The camera getting the most deer, and the most in daylight, is the spot to hunt. Compare the same model against itself: a camera with more reach catches more deer on the same spot.</p><div class="list">${all.map((a) => `<button class="item" style="text-align:left;border:0" data-cam="${a.pid}:${a.cam.x},${a.cam.y}"><span><span class="nm">${esc(WT.camType(a.cam.type).name)}</span> <span class="dim">${esc(a.parcel)}${a.owner === 'public' ? ' (public)' : ''}</span></span><span>${rateTxt(a.cam)}</span><span class="st">${a.cam.total || 0} photos · ${a.cam.dayN || 0} daylight · ${a.cam.bucks || 0} bucks${a.cam.queue && a.cam.queue.length ? ` · <b>${a.cam.queue.length} on the card</b>` : ''}</span></button>`).join('')}</div>`;
    }
    const bar = (v) => { const n = Math.max(0, Math.min(5, Math.round(v * 5))); return `<span class="${n >= 4 ? 'good' : n >= 2 ? 'warn' : 'bad'}">${'■'.repeat(n)}${'□'.repeat(5 - n)}</span>`; };
    const mixLine = (pid) => { const m = WT.landMix(pid); return ['prairie', 'timber', 'farm', 'swamp'].filter((k) => m[k] >= 0.01).sort((a, b) => m[b] - m[a]).map((k) => `${WT.LAND[k].name} ${Math.round(m[k] * 100)}%`).join(' · '); };
    function landMeters(pid) {
      const ls = WT.landStats(pid), sa = WT.sanctuaryInfo(pid);
      const dead = sa.notCover + sa.nearStand;
      return `<dl class="kv" style="margin:4px 0"><dt>Food</dt><dd>${bar(ls.food)}</dd><dt>Water</dt><dd>${bar(ls.water)}</dd><dt>Bedding cover</dt><dd>${bar(ls.bedding)}</dd><dt>Security</dt><dd>${bar(ls.security)}</dd>
        <dt>Sanctuary</dt><dd>${sa.marked ? `${(sa.working.size / 4).toFixed(1)} ac working${sa.full ? ' <span class="good">(at the ' + Math.round(sa.maxShare * 100) + '% cap)</span>' : ` <span class="faint">counts up to ${Math.round(sa.maxShare * 100)}% of the land</span>`}${dead ? ` · <span class="bad">${dead} tile${dead === 1 ? '' : 's'} not counting</span>` : ''}` : '<span class="faint">none</span>'}</dd></dl>`;
    }
    function showAdvice(pid) {
      const a = WT.landAdvice(pid), p = w.parcels[pid];
      UI.modal(`<h2>${esc(p.name)}: what would help</h2>${landMeters(pid)}
        <div style="max-height:50vh;overflow:auto">${a.tips.map((t, i) => `<p style="margin:8px 0 2px"><b>${i + 1}. ${esc(t[0])}</b></p><p class="dim" style="margin:0">${esc(t[1])}</p>`).join('')}</div>
        <p class="faint" style="margin-top:8px">Most useful first. Red stripes on the map are sanctuary that isn't counting.</p>
        <div class="row" style="margin-top:8px"><button class="btn blaze" id="aclose">Got it</button><button class="btn ghost" id="aguide">How land works</button></div>`, (m) => {
        $('#aclose', m).addEventListener('click', UI.closeModal);
        $('#aguide', m).addEventListener('click', () => UI.guide('land'));
      });
    }
    function playerCard(p, d, pid) {
      const lim = WT.limits(pid), inv = st.inv, t = state.tile;
      const truck = Object.entries(inv.stands).filter(([id, n]) => n > 0 && WT.standType(id).kind !== 'mobile');
      const cams = Object.entries(inv.cameras).filter(([, n]) => n > 0);
      const pending = d.cams.reduce((a, c) => a + (c.queue ? c.queue.length : 0), 0);
      let html = `<p>${p.acres} acres${WT.contiguousAcres(pid) > p.acres ? ` (${WT.contiguousAcres(pid)} with your adjoining land)` : ''}. ${esc(flavor(p.habitat))}</p>
        <p class="dim">Stands ${d.stands.length}/${lim.stands} · Cameras ${d.cams.length}/${lim.cams} · Food plots ${WT.plotAcresUsed(pid)}/${lim.plotAcres} ac · Water holes ${d.waterholes.length}/${lim.waterholes}</p>
        <p class="dim">${mixLine(pid)}</p>${(() => { const ce = WT.cropEffect(pid); return ce.note ? `<p class="${ce.phase === 'rush' ? 'good' : ce.phase === 'off' && ce.f < 0.97 ? 'warn' : 'dim'}">${ce.phase === 'rush' ? 'Hunt it now: ' : ''}${esc(ce.note)}${ce.phase === 'rush' ? ` (${ce.left} more day${ce.left === 1 ? '' : 's'})` : ''}.</p>` : ''; })()}
        ${landMeters(pid)}
        <div class="row" style="margin:6px 0"><button class="btn" id="advice">Help: how do I make this land better?</button></div>`;
      if (!t) {
        html += `<p><b>Tap any spot on this land</b> to see what's there, build on it, or move and pick up what you've placed.</p>
          ${d.stands.length ? `<h3>Stands</h3><div class="row">${d.stands.map((s) => `<button class="btn small" data-goto="${s.x},${s.y}">${esc(s.name || WT.standType(s.type).name)}</button>`).join('')}</div>` : ''}
          ${d.cams.length ? `<h3>Cameras</h3><div class="row">${d.cams.map((c) => `<button class="btn small" data-goto="${c.x},${c.y}">${esc(WT.camType(c.type).name)}${c.queue && c.queue.length ? ` (${c.queue.length} new)` : ''}</button>`).join('')}<button class="btn small" id="checkCams">Check all cameras${pending ? ` (${pending} new)` : ''}</button></div>` : ''}
          <p class="faint">In your truck: ${[...truck.map(([id, n]) => `${n} × ${WT.standType(id).name}`), ...cams.map(([id, n]) => `${n} × ${WT.camType(id).name}`)].join(', ') || 'nothing. Stands and cameras are sold at the Shop'}.</p>
          ${pid !== w.starterId ? `<div class="row" style="margin-top:8px"><button class="btn small" id="sell">Sell this land for ${WT.money(WT.landPrice(pid) * (1 - WT.CONFIG.economy.landSellFee))}</button><span id="sellq" class="dim"></span></div>` : ''}`;
        return html;
      }
      const info = WT.tileInfo(pid, t.x, t.y), s = info.stand, c = info.cam;
      html += `<div class="row" style="justify-content:space-between;margin-top:6px"><h3 style="margin:0">This spot · ${WT.LAND[WT.landType(w.cover[info.i])].name}${info.sanctuary ? ' · sanctuary' : ''}</h3><button class="btn small ghost" id="unsel">Close spot</button></div><p class="faint" style="margin:2px 0">${esc(info.cover)}. ${esc(WT.LAND[WT.landType(w.cover[info.i])].rule)}</p>`;
      if (s) html += `<div class="item" style="display:block;margin-top:6px"><div class="row"><span class="nm">${esc(WT.standType(s.type).name)}</span><input type="text" id="sname" maxlength="28" value="${esc(s.name || '')}" placeholder="Name it" style="flex:1;min-width:90px"><button class="btn small" id="srename">Rename</button></div>
          <div class="row" style="margin-top:6px"><button class="btn blaze small" id="huntHere">Hunt here</button><button class="btn small" id="smove">Move</button><button class="btn small" id="spick">Pick up</button></div>
          ${UI.knowledgeHtml(s, UI.stackHtml(pid, s))}</div>`;
      if (c) html += camBlock(c);
      if (info.plot) { const pt = WT.plotType(info.plot.type); html += `<div class="item" style="display:block;margin-top:6px"><span class="nm">${esc(pt.name)} food plot</span> <span class="dim">${info.plot.acres} ac · ${info.plot.year === st.year ? 'planted this year, deer start using it next season' : 'growing: deer feed here'}</span><div class="row" style="margin-top:6px"><button class="btn small" id="unbuild">Plow it under</button></div></div>`; }
      if (info.trees) html += `<div class="item" style="display:block;margin-top:6px"><span class="nm">Tree row</span> <span class="dim">${info.trees.mature ? 'grown into cover' : `planted year ${info.trees.year}, becomes cover after ${WT.CONFIG.improvements.trees.matureYears} years`}</span><div class="row" style="margin-top:6px"><button class="btn small" id="unbuild">Pull the row</button></div></div>`;
      if (info.waterhole) html += `<div class="item" style="display:block;margin-top:6px"><span class="nm">Water hole</span><div class="row" style="margin-top:6px"><button class="btn small" id="unbuild">Fill it in</button></div></div>`;
      // add to this exact spot
      const noStand = !s || !(s.x === t.x && s.y === t.y), noCam = !c || !(c.x === t.x && c.y === t.y);
      html += `<h3>Add to this spot</h3>`;
      if (!s) html += `<div class="row">${truck.length ? `<select id="standSel">${truck.map(([id, n]) => `<option value="${id}" ${state.standType === id ? 'selected' : ''}>${esc(WT.standType(id).name)} (${n})</option>`).join('')}</select><button class="btn small" id="addStand">Put up stand</button>` : '<span class="faint">No stands in your truck. Buy one at the Shop.</span>'}</div>`;
      if (noCam) html += addCamRow(!!s);
      void noStand;
      if (!info.plot && !info.waterhole) html += `<div class="row" style="margin-top:6px">
          <select id="plotSel">${WT.CONFIG.improvements.foodplot.types.map((x) => `<option value="${x.id}" ${state.plot.type === x.id ? 'selected' : ''}>${esc(x.name)} (${WT.money(x.cost)}/ac)</option>`).join('')}</select>
          <select id="plotAc">${[[0.5, '½ acre'], [1, '1 acre'], [2, '2 acres'], [4, '4 acres']].map(([v, n]) => `<option value="${v}" ${state.plot.acres === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
          <button class="btn small" id="addPlot">Plant food plot (${WT.money(Math.round(WT.plotType(state.plot.type).cost * state.plot.acres))})</button></div>
        <p class="faint" style="margin:2px 0 0">The green box on the map is where the plot goes: this spot is its top-left corner. A stand or camera can sit right on it.</p>
        <div class="row" style="margin-top:6px">
          <button class="btn small" id="addWater">Dig water hole (${WT.money(WT.CONFIG.improvements.waterhole.cost)})</button>
          <button class="btn small" id="addTreesH">Tree row → (${WT.money(WT.CONFIG.improvements.trees.cost)})</button>
          <button class="btn small" id="addTreesV">Tree row ↓</button>
        </div>`;
      html += `<div class="row" style="margin-top:6px"><button class="btn small" id="sanct">${info.sanctuary ? 'Remove sanctuary here' : 'Make this sanctuary'}</button><button class="btn small ghost" data-guide="land">What does each of these do?</button></div>`;
      return html;
    }

    function renderCard() {
      const pid = state.pid;
      state.showPlot = false;
      if (pid == null) {
        const spots = WT.huntSpots();
        const ranked = spots.map((x) => Object.assign(x, UI.betScore(x.stand))).sort((a, b) => b.score - a.score);
        card.innerHTML = !land
          ? `<h2>Best bets this ${st.slot}</h2><p class="dim">Each stand has a fixed rating out of 100. Stars are how close this sit comes to that stand's best with today's ${st.weather.windDir} wind. Tap one, or tap a marker on the map.</p>
             <div class="list">${ranked.map((x) => `<button class="item" style="text-align:left;border:0" data-pick="${x.pid}:${x.stand.sid}"><span><span class="nm">${esc(x.stand.name || WT.standType(x.stand.type).name)}</span> <span class="dim">${esc(w.parcels[x.pid].name)}</span></span><span class="stars">${x.stars ? '★'.repeat(x.stars) + '☆'.repeat(5 - x.stars) : '?????'}</span><span class="st">${x.rating ? `Rating ${x.rating} · ` : ''}${x.notes.join(' · ')}</span></button>`).join('') || '<p class="faint">No stands or spots yet.</p>'}</div>
             <p class="faint">Want somewhere new? Tap a green public area, then tap the spot you want to mark.</p>`
          : `<h2>Land</h2><p class="dim">Tap your land to build on it. Tap any other parcel to see it. Orange borders are for sale, and some neighbors sell permission to hunt their stands.</p>
             <div class="row">${w.parcels.filter((p) => st.parcels[p.id].owner === 'player').map((p) => `<button class="btn small" data-jump="${p.id}">${esc(p.name)}</button>`).join('')}
             ${st.forSale.map((id) => `<button class="btn small" data-jump="${id}">For sale: ${w.parcels[id].acres} ac</button>`).join('')}</div>`;
        card.insertAdjacentHTML('beforeend', camReport());
        card.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => { const [pp, xy] = b.dataset.cam.split(':'), [x, y] = xy.split(',').map(Number); selectTile(+pp, x, y); view.focus(+pp); renderCard(); }));
        card.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => { const [p, s] = b.dataset.pick.split(':'); const d = st.parcels[+p], so = [...(d.stands || []), ...(d.spots || [])].find((z) => z.sid === s); selectTile(+p, so.x, so.y); view.focus(+p); renderCard(); }));
        card.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => { state.pid = +b.dataset.jump; state.tile = null; state.sid = null; view.focus(state.pid); renderCard(); }));
        return;
      }
      const p = w.parcels[pid], d = st.parcels[pid];
      const standObj = state.sid && ([...(d.stands || []), ...(d.spots || [])].find((s) => s.sid === state.sid));
      const canHunt = d.owner === 'player' || d.permBought || d.owner === 'public';
      let html = `<div class="row" style="justify-content:space-between"><h2>${esc(p.name)}${d.bowOnly ? ' <span class="tag">Bow only</span>' : ''}</h2><button class="btn small" id="clr">All parcels</button></div>`;
      const sBlock = standObj && canHunt ? WT.spotBlock(pid, standObj) : null;
      const standBlock = () => `${canHunt ? `<div class="row" style="margin-bottom:8px"><button class="btn blaze big" id="huntHere" style="flex:1">Hunt here</button></div>${sBlock ? `<p class="bad">${esc(sBlock)}</p>` : ''}` : ''}<div class="cols"><div><h3>${standObj.kind === 'spot' ? 'Marked spot' : esc(WT.standType(standObj.type).name)}</h3>
          <div class="row"><input type="text" id="sname" maxlength="28" value="${esc(standObj.name || '')}" placeholder="Name it"><button class="btn small" id="srename">Rename</button></div>
          ${UI.knowledgeHtml(standObj, UI.stackHtml(pid, standObj))}</div>
          <div><h3>Today</h3><p>${esc(WT.weatherLine(st.weather))}</p><p class="dim">Rut: ${esc(WT.rutPhase(Math.min(st.day, 91)).name)}. Next: ${st.slot}.</p>
          ${standObj.kind === 'spot' ? '<div class="row" style="margin-top:8px"><button class="btn small" id="rmSpot">Remove this spot</button></div>' : ''}</div></div>`;
      if (d.owner === 'player') {
        if (land) html += playerCard(p, d, pid);
        else html += standObj ? standBlock() + `<div class="row" style="margin-top:8px"><button class="btn small" id="toLand">Work on this land</button></div>` : `<p class="dim">Tap one of your stands to hunt it.</p><div class="row">${d.stands.map((s) => `<button class="btn small" data-goto="${s.x},${s.y}">${esc(s.name || WT.standType(s.type).name)}</button>`).join('')}<button class="btn small" id="toLand">Work on this land</button></div>`;
      } else if (st.forSale.includes(pid)) {
        html += `<h3>For sale</h3><p><b>${mixLine(pid)}</b></p>${listingHtml(p)}<div class="row"><button class="btn blaze" id="buyLand">Buy for ${WT.money(WT.landPrice(pid))}</button><span class="dim">You have ${WT.money(st.cash)}.</span></div>
          <p class="faint">The listing won't tell you how many deer are here or how good they are. Read the cover and take your chances.</p>`;
      } else if (d.owner === 'public') {
        const sc = d.scoutSits || 0;
        const q = WT.habitatQuality(p.habitat) * (1 - (d.pressure || 0.5) * 0.4);
        const scouted = sc >= 3 ? Math.max(1, Math.min(5, Math.round(1 + q * 5 + (WT.hash2(pid, 1, 2) - 0.5) * 2 / sc))) : 0;
        if (standObj) html += standBlock();
        html += `<p class="dim">${mixLine(pid)}</p><p>${p.acres} acres of public ground. Free to hunt, but everybody else knows about it too.${d.bowOnly ? ' <span class="warn">Bow only: equip a bow under Gear to hunt here.</span>' : ''}</p>
          <dl class="kv"><dt>How busy</dt><dd><b>${WT.crowd(pid).name}</b> <span class="faint">${WT.crowd(pid).note}</span></dd><dt>Scouted</dt><dd>${sc} hunt${sc === 1 ? '' : 's'}</dd><dt>Hunting</dt><dd>${scouted ? `<span class="stars">${stars(scouted)}</span>` : '<span class="faint">Hunt it a few times to get a feel for it</span>'}</dd>
          <dt>Your spots</dt><dd>${(d.spots || []).length} / ${WT.SPOT_LIMITS.perArea} here</dd></dl>
          ${state.cid ? camBlock(d.cams.find((c) => c.cid === state.cid)) : ''}
          ${state.tile && !standObj ? `<div class="row" style="margin-top:6px"><button class="btn" id="markHere" ${d.bowOnly && !WT.hasBow() ? 'disabled' : ''}>Mark ${state.cid ? 'this camera spot' : 'the spot you tapped'} to hunt</button></div>` : !state.tile ? '<p><b>Tap the map inside this area</b> to mark a spot to sit or hang a camera.</p>' : ''}
          ${state.tile && !(state.cid && d.cams.some((c) => c.cid === state.cid && c.x === state.tile.x && c.y === state.tile.y)) ? addCamRow(!!standObj) : ''}
          <p class="dim">Cameras here ${d.cams.length} / ${WT.camLimit(pid)}.</p>
          <p class="faint">Public land takes a mobile stand, equipped under Gear. A hang-on, climber or saddle needs a spot in the trees; a pop-up blind works anywhere.</p>`;
      } else {
        if (standObj && d.permBought) html += standBlock();
        html += `<p>${p.acres} acres owned by the ${esc(p.ownerName)} family.</p>`;
        if (d.permBought) html += `<p class="good">You have permission to hunt their ${d.stands.length} stand${d.stands.length === 1 ? '' : 's'}. Tap a gold stand.</p>`;
        else if (d.permission) html += `<p>The ${esc(p.ownerName)}s will let you hunt their stands for a one-time ${WT.money(d.permFee)}. You can only hunt from stands they've put up (${d.stands.length}).</p><button class="btn" id="perm">Buy permission (${WT.money(d.permFee)})</button>`;
        else html += '<p class="dim">Private. No hunting, not for sale right now.</p>';
      }
      card.innerHTML = html;
      state.showPlot = !!$('#addPlot', card);
      view.draw();
      const on = (id, fn) => { const b = $('#' + id, card); if (b) b.addEventListener('click', fn); };
      const t = state.tile;
      on('clr', () => { state.pid = null; state.sid = null; state.tile = null; state.move = null; setBanner(); refreshMap(); renderCard(); });
      on('unsel', () => { state.tile = null; state.sid = null; state.cid = null; refreshMap(); renderCard(); });
      on('advice', () => showAdvice(pid));
      on('toLand', () => UI.go('map', { mode: 'land', pid, sid: state.sid }));
      card.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => { const [x, y] = b.dataset.goto.split(',').map(Number); selectTile(pid, x, y); refreshMap(); renderCard(); }));
      card.querySelectorAll('[data-guide]').forEach((b) => b.addEventListener('click', () => UI.guide(b.dataset.guide)));
      on('srename', () => { WT.renameStand(standObj, $('#sname', card).value); WT.save(); UI.toast('Renamed.'); renderCard(); });
      on('huntHere', () => {
        const comp = WT.publicCompetition(pid);
        const go = (competition) => UI.go('loadout', { pid, sid: standObj.sid, competition });
        { const blk = WT.spotBlock(pid, standObj); if (blk && /bow only/i.test(blk)) return UI.toast(blk, 'bad'); }
        if (!comp) return go(false);
        UI.modal(`<h2>Company</h2><p>${esc(comp)}</p><div class="row"><button class="btn" id="anyway">Hunt anyway</button><button class="btn ghost" id="other">Pick another spot</button></div>`, (m) => {
          $('#anyway', m).addEventListener('click', () => go(true));
          $('#other', m).addEventListener('click', UI.closeModal);
        });
      });
      on('buyLand', () => { if (UI.err(WT.buyLand(pid))) return; done("It's yours.", true); });
      on('perm', () => { if (UI.err(WT.buyPermission(pid))) return; done(null, true); });
      on('markHere', () => { if (UI.err(WT.markSpot(pid, t.x, t.y))) return; done('Spot marked.'); });
      on('rmSpot', () => { WT.removeSpot(pid, standObj.sid); done('Spot removed.'); });
      const checkMsg = (n) => (n ? `${n} new photo${n === 1 ? '' : 's'}. Walking in left some scent.` : 'No new photos. Walking in left some scent.');
      on('checkCams', () => { const n = WT.checkCameras(pid); WT.save(); UI.toast(checkMsg(n)); renderCard(); refreshMap(); });
      on('ccheck', () => { const n = WT.checkCameras(pid, state.cid); WT.save(); UI.toast(checkMsg(n)); renderCard(); refreshMap(); });
      on('cphotos', () => UI.go('hitlist', { photos: true }));
      on('smove', () => { state.move = { kind: 'stand', id: state.sid }; setBanner(); UI.toast(WT.standType(standObj.type).kind === 'permanent' ? 'Tap the new spot. Moving a permanent stand costs $50, and you start learning the new spot from scratch.' : 'Tap the new spot. You start learning the new spot from scratch.'); });
      on('cmove', () => { state.move = { kind: 'cam', id: state.cid }; setBanner(); UI.toast('Tap the new spot.'); });
      on('spick', () => { if (UI.err(WT.removeStand(pid, state.sid))) return; done('Stand is back in your truck.'); });
      on('cpick', () => { if (UI.err(WT.removeCamera(pid, state.cid))) return; done('Camera is back in your truck.'); });
      let armed = false;
      on('unbuild', () => { const b = $('#unbuild', card); if (!armed) { armed = true; b.textContent = 'Press again (no refund)'; return; } if (UI.err(WT.removeImprovement(pid, t.x, t.y))) return; done('Removed.', true); });
      on('addStand', () => { state.standType = $('#standSel', card).value; if (UI.err(WT.placeStand(pid, state.standType, t.x, t.y))) return; done('Stand is up. Sit it once to learn the spot.'); });
      on('addCam', () => { state.camType = $('#camSel', card).value; if (UI.err(WT.placeCamera(pid, state.camType, t.x, t.y))) return; done(standObj ? 'Camera is on the stand.' : 'Camera is up.'); });
      on('addPlot', () => { if (UI.err(WT.plantPlot(pid, state.plot.type, t.x, t.y, state.plot.acres))) return; done('Planted. Deer start using it next season.', true); });
      on('addWater', () => { if (UI.err(WT.digWaterhole(pid, t.x, t.y))) return; done('Water hole dug.', true); });
      on('addTreesH', () => { if (UI.err(WT.plantTrees(pid, t.x, t.y, false))) return; done('Tree row planted.', true); });
      on('addTreesV', () => { if (UI.err(WT.plantTrees(pid, t.x, t.y, true))) return; done('Tree row planted.', true); });
      on('sanct', () => { if (UI.err(WT.toggleSanctuary(pid, t.x, t.y))) return; const sa = WT.sanctuaryInfo(pid); done(sa.nearStand ? 'Marked, but tiles within 100 yards of a stand do not count (red on the map).' : sa.full ? 'Marked. You are at the cap: more sanctuary adds nothing.' : 'Sanctuary updated.'); });
      const ps = $('#plotSel', card), pa = $('#plotAc', card);
      if (ps) ps.addEventListener('change', () => { state.plot.type = ps.value; renderCard(); });
      if (pa) pa.addEventListener('change', () => { state.plot.acres = +pa.value; renderCard(); });
      let sellArmed = false;
      on('sell', () => { if (!sellArmed) { sellArmed = true; $('#sellq', card).innerHTML = '<span class="warn">Press again to sell.</span>'; return; } if (UI.err(WT.sellLand(pid))) return; WT.save(); state.pid = null; state.tile = null; view.rebuild(); renderCard(); UI.topbar(); });
    }
    renderCard();
  };
  UI.screens.land = (el) => UI.screens.map(el, { mode: 'land' });
})();
