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
  const SIMPLE = { cover: ['#4f6b3a', '#56733f'], food: ['#c9ac5c', '#c2a555'], water: ['#4a78a8', '#4a78a8'], people: ['#8a8076', '#8a8076'] };
  const CAT = {};
  [T.TIMBER, T.BELT, T.BRUSH, T.PRAIRIE, T.SLOUGH, T.YOUNGTREES].forEach((t) => { CAT[t] = 'cover'; });
  [T.CORN, T.SOY, T.WHEAT, T.SUNFLOWER, T.HAY, T.PASTURE, T.PLOT, T.PLOT_NEW].forEach((t) => { CAT[t] = 'food'; });
  [T.WATER, T.CREEK, T.POND].forEach((t) => { CAT[t] = 'water'; });
  [T.ROAD, T.YARD, T.TOWN].forEach((t) => { CAT[t] = 'people'; });
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
      const p = simple ? SIMPLE[CAT[w.cover[i]] || 'food'] : (PAL[w.cover[i]] || PAL[8])[season];
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
      v.z = Math.max(fitZoom, Math.min(28, v.z));
      const hw = LW / 2 / v.z, hh = LH / 2 / v.z; // keep the map filling the view (no black edges)
      v.cx = w.W > 2 * hw ? Math.max(hw, Math.min(w.W - hw, v.cx)) : w.W / 2;
      v.cy = w.H > 2 * hh ? Math.max(hh, Math.min(w.H - hh, v.cy)) : w.H / 2;
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
          for (const c of d.cams) mark(c.x, c.y, c.queue && c.queue.length ? '!' : '▪', '#1c1410', '#B8B4C8');
          for (const s of d.stands) mark(s.x, s.y, STAND_LETTER[s.type] || '?', '#1c1410', v.sel === p.id && opts.selStand === s.sid ? '#ffe08a' : '#C4A688');
        } else if (d.owner === 'npc' && (d.permBought || (p.id === v.sel && d.permission))) {
          for (const s of d.stands) mark(s.x, s.y, STAND_LETTER[s.type] || '?', '#1c1410', d.permBought ? (opts.selStand === s.sid ? '#ffe08a' : '#d6a84a') : '#6a5a4a');
        } else if (d.owner === 'public') {
          for (const s of d.spots || []) mark(s.x, s.y, '✚', '#1c1410', opts.selStand === s.sid ? '#ffe08a' : '#b6e08a');
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
  UI.knowledgeHtml = function (s) {
    const st = S(), k = WT.standKnowledge(s);
    const rec = (s.recent || []).slice(0, 4).map((r) => `<p class="dim">${WT.dateLabel(r.d)} ${r.s}: ${r.seen ? r.seen + ' deer seen' : 'nothing'} (wind ${r.wind})</p>`).join('');
    if (!k.known) return `<p class="dim">You haven't sat here yet. One sit tells you what this spot is: its rating, its winds and how far you can see. Those never change.</p><dl class="kv"><dt>Pressure</dt><dd>${pressureHtml(k.pressure)}</dd></dl>`;
    const b = UI.betScore(s);
    const line = (name, o) => `<dt>${name}</dt><dd><span class="stars">${stars(o.stars)}</span></dd>`;
    return `<dl class="kv"><dt>Stand rating</dt><dd><b>${k.rating}</b> / 100 <span class="faint">better than ${k.rating}% of spots</span></dd>
      <dt>This ${st.slot}</dt><dd><span class="stars">${stars(b.stars)}</span> <span class="faint">of its best · ${b.notes.join(', ')}</span></dd>
      <dt>Pressure</dt><dd>${pressureHtml(k.pressure)}</dd>
      <dt>Consistency</dt><dd>${k.consistency.name} <span class="faint">${k.consistency.note}</span></dd>
      <dt>Best winds</dt><dd>${k.winds.join(', ')}</dd>
      <dt>View</dt><dd>${k.view}</dd>
      ${line('Mornings', k.morning)}${line('Evenings', k.evening)}${line('Rut', k.rut)}${line('Big bucks', k.mature)}
      <dt>Sits</dt><dd>${k.sits}</dd></dl>${rec ? '<h3>Recent sits</h3>' + rec : ''}`;
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
    return (simple ? [sw(SIMPLE.cover[0], 'cover'), sw(SIMPLE.food[0], 'food'), sw(SIMPLE.water[0], 'water')] : []).concat(land).join('');
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
    return { stars: d.stars, rating: k.rating, score: k.rating * d.factor, notes };
  };
  UI.mapTutorial = function (page = 0) {
    const st = S();
    const swatch = (c) => `<span style="display:inline-block;width:14px;height:14px;background:${c};vertical-align:middle;margin-right:6px;border:1px solid #1c1410"></span>`;
    const box = (c) => `<span style="display:inline-block;width:14px;height:14px;border:3px solid ${c};vertical-align:middle;margin-right:6px"></span>`;
    const pages = [
      `<h2>Reading the map (1/3): the ground</h2>
       <p>The map shows what deer use each piece of ground for.</p>
       <p>${swatch(SIMPLE.cover[0])}<b>Cover</b>: timber, tree rows, brush, CRP grass and cattail sloughs. Deer bed here during the day.</p>
       <p>${swatch(SIMPLE.food[0])}<b>Food</b>: crop fields, hay, pasture and your food plots. Deer feed here at dawn and dusk.</p>
       <p>${swatch(SIMPLE.water[0])}<b>Water</b>: rivers, creeks and ponds.</p>
       <p>${swatch(SIMPLE.people[0])}<b>Roads, farms and town</b>: people. Deer avoid them, and stands near roads get bumped walking in.</p>
       <p class="dim">Tap Detail on the map to see every crop and tree row instead.</p>`,
      `<h2>Reading the map (2/3): whose land</h2>
       <p>${box('#7fb0ff')}<b>Blue outline</b>: your land. Hunt any stand you put up. Bow or rifle.</p>
       <p>${box('#b6e08a')}<b>Green outline</b>: public land. Free, but crowded and pressured. Mark up to 3 spots per area and bring a climber or hang-on (or sit on the ground).</p>
       <p>${box('#2f6a3e')}<b>Dark green</b>: bow-only public land. Locked until bows arrive.</p>
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
    UI.modal(`${pages[page]}<div class="row" style="margin-top:10px">${page > 0 ? '<button class="btn ghost" data-tp="-1">Back</button>' : ''}${page < pages.length - 1 ? '<button class="btn blaze" data-tp="1">Next</button>' : '<button class="btn blaze" data-tdone>Got it</button>'}<button class="btn ghost small" data-tdone>Skip</button></div>`, (m) => {
      m.querySelectorAll('[data-tp]').forEach((b) => b.addEventListener('click', () => UI.mapTutorial(page + +b.dataset.tp)));
      m.querySelectorAll('[data-tdone]').forEach((b) => b.addEventListener('click', () => { st.settings.tutMap = true; WT.save(); UI.closeModal(); }));
    });
  };

  /* ================================================================ MAP SCREEN */
  // args: { mode: 'hunt' | 'land', pid, sid }
  UI.screens.map = function (el, args) {
    args = Object.assign({ mode: 'hunt' }, args || {});
    const st = S(), w = Wd();
    const state = { pid: args.pid ?? null, sid: args.sid ?? null, tool: null, toolArg: null };
    el.innerHTML = UI.stage(LW, LH, `
      <div class="ov" style="right:8px;top:8px;flex-direction:column"><button class="btn ghost small" data-z="in">+</button><button class="btn ghost small" data-z="out">−</button><button class="btn ghost small" data-z="home">Home</button></div>
      <div class="ov" style="left:8px;top:8px"><button class="btn ghost small" data-back>Lodge</button><span class="btn ghost small" style="cursor:default">${args.mode === 'hunt' ? 'Where to hunt?' : 'Land'}</span></div>
      <div class="ov" style="left:8px;bottom:8px;font-size:15px;background:rgba(28,20,16,.85);padding:3px 6px;gap:4px 10px;max-width:calc(100% - 16px)">${UI.mapLegend(args.mode)}</div>
      <div class="ov" style="right:8px;bottom:8px;flex-direction:column"><button class="btn ghost small" data-style>${(st.settings.mapStyle || 'simple') === 'simple' ? 'Detail' : 'Simple'}</button><button class="btn ghost small" data-help aria-label="How to read the map">?</button></div>`) +
      `<section class="panel" id="card" style="margin-top:10px"></section>`;
    const card = $('#card', el);
    const view = UI.mapView($('canvas', el), {
      sel: state.pid,
      huntMode: args.mode === 'hunt',
      onTap: (x, y, pid) => onTap(x, y, pid),
      overlay: (ctx, v) => {
        if (!state.tool || state.pid == null) return;
        ctx.fillStyle = '#ffe08a'; ctx.font = '8px "Press Start 2P", monospace'; ctx.textAlign = 'left';
        ctx.fillText('TAP THE MAP TO PLACE', 8, LH - 26);
      },
    });
    const refreshMap = () => { view.sel = state.pid; view.draw(); };
    el.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => { const z = b.dataset.z; if (z === 'in') view.zoomBy(1.4); else if (z === 'out') view.zoomBy(1 / 1.4); else view.focus(w.starterId); }));
    el.querySelector('[data-back]').addEventListener('click', () => UI.go('lodge'));
    el.querySelector('[data-style]').addEventListener('click', () => { st.settings.mapStyle = (st.settings.mapStyle || 'simple') === 'simple' ? 'detail' : 'simple'; WT.save(); UI.go('map', Object.assign({}, args, { pid: state.pid, sid: state.sid })); });
    el.querySelector('[data-help]').addEventListener('click', () => UI.mapTutorial());
    if (!st.settings.tutMap) setTimeout(() => UI.mapTutorial(), 50);
    if (state.pid != null) view.focus(state.pid); else view.focus(w.starterId, 6);

    function onTap(x, y, pid) {
      if (pid < 0) return;
      const d = st.parcels[pid];
      // tools apply to the selected parcel
      if (state.tool && pid === state.pid) return applyTool(x, y);
      // tapping a stand / spot marker picks it
      const near = (list) => (list || []).find((s) => Math.abs(s.x - x) <= 1 && Math.abs(s.y - y) <= 1);
      const s = d.owner === 'player' || d.permBought ? near(d.stands) : d.owner === 'public' ? near(d.spots) : null;
      state.pid = pid; state.sid = s ? s.sid : null; state.tool = null;
      view.sel = pid;
      refreshMap(); renderCard();
    }

    function applyTool(x, y) {
      const pid = state.pid, d = st.parcels[pid];
      let e = null;
      switch (state.tool) {
        case 'mark': e = WT.markSpot(pid, x, y); break;
        case 'stand': e = WT.placeStand(pid, state.toolArg, x, y); break;
        case 'camera': e = WT.placeCamera(pid, state.toolArg, x, y); break;
        case 'plot': e = WT.plantPlot(pid, state.toolArg.type, x, y, state.toolArg.acres); break;
        case 'water': e = WT.digWaterhole(pid, x, y); break;
        case 'trees': e = WT.plantTrees(pid, x, y, state.toolArg); break;
        case 'sanct': e = WT.toggleSanctuary(pid, x, y); break;
        case 'remove': {
          const s = d.stands.find((z) => Math.abs(z.x - x) <= 1 && Math.abs(z.y - y) <= 1);
          const c = d.cams.find((z) => Math.abs(z.x - x) <= 1 && Math.abs(z.y - y) <= 1);
          const sp = (d.spots || []).find((z) => Math.abs(z.x - x) <= 1 && Math.abs(z.y - y) <= 1);
          if (s) e = WT.removeStand(pid, s.sid); else if (c) e = WT.removeCamera(pid, c.cid); else if (sp) WT.removeSpot(pid, sp.sid); else e = 'Nothing there to pick up.';
          break;
        }
      }
      if (UI.err(e)) return;
      WT.save();
      UI.toast('Done.', 'good');
      if (['plot', 'water', 'trees', 'sanct'].includes(state.tool)) view.rebuild();
      if (state.tool !== 'sanct' && state.tool !== 'remove') state.tool = null;
      refreshMap(); renderCard(); UI.topbar();
    }

    function renderCard() {
      const pid = state.pid;
      if (pid == null) {
        const spots = WT.huntSpots();
        const ranked = spots.map((x) => Object.assign(x, UI.betScore(x.stand))).sort((a, b) => b.score - a.score);
        card.innerHTML = args.mode === 'hunt'
          ? `<h2>Best bets this ${st.slot}</h2><p class="dim">Each stand has a fixed rating out of 100. Stars are how close this sit comes to that stand's best with today's ${st.weather.windDir} wind. Tap one, or tap a marker on the map.</p>
             <div class="list">${ranked.map((x) => `<button class="item" style="text-align:left;border:0" data-pick="${x.pid}:${x.stand.sid}"><span><span class="nm">${esc(x.stand.name || WT.standType(x.stand.type).name)}</span> <span class="dim">${esc(w.parcels[x.pid].name)}</span></span><span class="stars">${x.stars ? '★'.repeat(x.stars) + '☆'.repeat(5 - x.stars) : '?????'}</span><span class="st">${x.rating ? `Rating ${x.rating} · ` : ''}${x.notes.join(' · ')}</span></button>`).join('') || '<p class="faint">No stands or spots yet.</p>'}</div>
             <p class="faint">Want somewhere new? Tap a green public area and mark a spot.</p>`
          : `<h2>Land</h2><p class="dim">Tap any parcel to see it. Orange borders are for sale. You can buy permission to hunt some neighbors' stands.</p>
             <div class="row">${w.parcels.filter((p) => st.parcels[p.id].owner === 'player').map((p) => `<button class="btn small" data-jump="${p.id}">${esc(p.name)}</button>`).join('')}
             ${st.forSale.map((id) => `<button class="btn small" data-jump="${id}">For sale: ${w.parcels[id].acres} ac</button>`).join('')}</div>`;
        card.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => { const [p, s] = b.dataset.pick.split(':'); state.pid = +p; state.sid = s; view.focus(+p); renderCard(); }));
        card.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => { state.pid = +b.dataset.jump; view.focus(state.pid); renderCard(); }));
        return;
      }
      const p = w.parcels[pid], d = st.parcels[pid];
      const standObj = state.sid && ([...(d.stands || []), ...(d.spots || [])].find((s) => s.sid === state.sid));
      let html = `<div class="row" style="justify-content:space-between"><h2>${esc(p.name)}${d.bowOnly ? ' <span class="tag">Bow only</span>' : ''}</h2><button class="btn small" id="clr">All parcels</button></div>`;
      if (standObj && (args.mode === 'hunt' || d.owner !== 'player' || true)) {
        const huntable = d.owner === 'player' || d.permBought || d.owner === 'public';
        html += `<div class="cols"><div><h3>${standObj.kind === 'spot' ? 'Marked spot' : esc(WT.standType(standObj.type).name)}</h3>
          <div class="row"><input type="text" id="sname" maxlength="28" value="${esc(standObj.name || '')}" placeholder="Name it"><button class="btn small" id="srename">Rename</button></div>
          ${UI.knowledgeHtml(standObj)}</div>
          <div><h3>Today</h3><p>${esc(WT.weatherLine(st.weather))}</p><p class="dim">Rut: ${esc(WT.rutPhase(Math.min(st.day, 91)).name)}. Next: ${st.slot}.</p>
          ${huntable ? `<button class="btn blaze big" id="huntHere" ${d.bowOnly && !WT.hasBow() ? 'disabled' : ''}>Hunt here</button>` : ''}</div></div>`;
      }
      if (d.owner === 'player') {
        const lim = WT.limits(pid), inv = st.inv;
        const truck = Object.entries(inv.stands).filter(([id, n]) => n > 0 && id !== 'ground');
        const cams = Object.entries(inv.cameras).filter(([, n]) => n > 0);
        const pending = d.cams.reduce((a, c) => a + (c.queue ? c.queue.length : 0), 0);
        html += `<p>${p.acres} acres${WT.contiguousAcres(pid) > p.acres ? ` (${WT.contiguousAcres(pid)} acres with your adjoining land)` : ''}. ${esc(flavor(p.habitat))}</p>
          <p class="dim">Stands ${d.stands.length}/${lim.stands} · Cameras ${d.cams.length}/${lim.cams} · Food plots ${WT.plotAcresUsed(pid)}/${lim.plotAcres} ac · Water holes ${d.waterholes.length}/${lim.waterholes} · Sanctuary ${d.sanctuary.length} tiles</p>
          <h3>Work on your land</h3>
          <div class="row">
            ${truck.length ? `<select id="standSel">${truck.map(([id, n]) => `<option value="${id}">${esc(WT.standType(id).name)} (${n})</option>`).join('')}</select><button class="btn small" data-tool="stand">Put up stand</button>` : '<span class="faint">No stands in your truck.</span>'}
          </div>
          <div class="row" style="margin-top:6px">
            ${cams.length ? `<select id="camSel">${cams.map(([id, n]) => `<option value="${id}">${esc(WT.camType(id).name)} (${n})</option>`).join('')}</select><button class="btn small" data-tool="camera">Hang camera</button>` : '<span class="faint">No cameras in your truck.</span>'}
            ${d.cams.length ? `<button class="btn small" id="checkCams">Check cameras${pending ? ` (${pending} new)` : ''}</button>` : ''}
          </div>
          <div class="row" style="margin-top:6px">
            <select id="plotSel">${WT.CONFIG.improvements.foodplot.types.map((t) => `<option value="${t.id}">${esc(t.name)} (${WT.money(t.cost)}/ac)</option>`).join('')}</select>
            <select id="plotAc"><option value="0.5">½ acre</option><option value="1" selected>1 acre</option><option value="2">2 acres</option><option value="4">4 acres</option></select>
            <button class="btn small" data-tool="plot">Plant food plot</button>
          </div>
          <div class="row" style="margin-top:6px">
            <button class="btn small" data-tool="water">Dig water hole (${WT.money(WT.CONFIG.improvements.waterhole.cost)})</button>
            <button class="btn small" data-tool="trees">Plant tree row (${WT.money(WT.CONFIG.improvements.trees.cost)})</button>
            <button class="btn small" data-tool="sanct">Sanctuary</button>
            <button class="btn small" data-tool="remove">Pick up / remove</button>
          </div>
          <p class="faint">You won't know how good a spot is until you hunt it. Moving a stand resets what you've learned.</p>
          ${pid !== w.starterId ? `<div class="row" style="margin-top:8px"><button class="btn small" id="sell">Sell for ${WT.money(WT.landPrice(pid) * (1 - WT.CONFIG.economy.landSellFee))}</button><span id="sellq" class="dim"></span></div>` : ''}`;
      } else if (st.forSale.includes(pid)) {
        html += `<h3>For sale</h3>${listingHtml(p)}<div class="row"><button class="btn blaze" id="buyLand">Buy for ${WT.money(WT.landPrice(pid))}</button><span class="dim">You have ${WT.money(st.cash)}.</span></div>
          <p class="faint">The listing won't tell you how many deer are here or how good they are. Read the cover and take your chances.</p>`;
      } else if (d.owner === 'public') {
        const sc = d.scoutSits || 0;
        const q = WT.habitatQuality(p.habitat) * (1 - (d.pressure || 0.5) * 0.4);
        const scouted = sc >= 3 ? Math.max(1, Math.min(5, Math.round(1 + q * 5 + (WT.hash2(pid, 1, 2) - 0.5) * 2 / sc))) : 0;
        html += `<p>${p.acres} acres of public ground. Free to hunt, but everybody else knows about it too.${d.bowOnly ? ' <span class="warn">Bow only: bows are coming in a later update.</span>' : ''}</p>
          <dl class="kv"><dt>Scouted</dt><dd>${sc} hunt${sc === 1 ? '' : 's'}</dd><dt>Hunting</dt><dd>${scouted ? `<span class="stars">${stars(scouted)}</span>` : '<span class="faint">Hunt it a few times to get a feel for it</span>'}</dd>
          <dt>Your spots</dt><dd>${(d.spots || []).length} / ${WT.SPOT_LIMITS.perArea} here</dd></dl>
          <div class="row"><button class="btn small" data-tool="mark" ${d.bowOnly && !WT.hasBow() ? 'disabled' : ''}>Mark a spot</button>${(d.spots || []).length ? '<button class="btn small" data-tool="remove">Remove a spot</button>' : ''}</div>
          <p class="faint">Mark a tree to hunt from a climber or hang-on, or any spot to sit on the ground. Only mobile stands are allowed on public land.</p>`;
      } else {
        html += `<p>${p.acres} acres owned by the ${esc(p.ownerName)} family.</p>`;
        if (d.permBought) html += `<p class="good">You have permission to hunt their ${d.stands.length} stand${d.stands.length === 1 ? '' : 's'}. Tap a gold stand.</p>`;
        else if (d.permission) html += `<p>The ${esc(p.ownerName)}s will let you hunt their stands for a one-time ${WT.money(d.permFee)}. You can only hunt from stands they've put up (${d.stands.length}).</p><button class="btn" id="perm">Buy permission (${WT.money(d.permFee)})</button>`;
        else html += '<p class="dim">Private. No hunting, not for sale right now.</p>';
      }
      card.innerHTML = html;
      $('#clr', card).addEventListener('click', () => { state.pid = null; state.sid = null; state.tool = null; refreshMap(); renderCard(); });
      const on = (id, fn) => { const b = $('#' + id, card); if (b) b.addEventListener('click', fn); };
      on('srename', () => { WT.renameStand(standObj, $('#sname', card).value); WT.save(); UI.toast('Renamed.'); });
      on('huntHere', () => {
        const comp = WT.publicCompetition(pid);
        const go = (competition) => UI.go('loadout', { pid, sid: standObj.sid, competition });
        if (!comp) return go(false);
        UI.modal(`<h2>Company</h2><p>${esc(comp)}</p><div class="row"><button class="btn" id="anyway">Hunt anyway</button><button class="btn ghost" id="other">Pick another spot</button></div>`, (m) => {
          $('#anyway', m).addEventListener('click', () => go(true));
          $('#other', m).addEventListener('click', UI.closeModal);
        });
      });
      on('buyLand', () => { if (UI.err(WT.buyLand(pid))) return; WT.save(); view.rebuild(); renderCard(); UI.topbar(); UI.toast('It\'s yours.', 'good'); });
      on('perm', () => { if (UI.err(WT.buyPermission(pid))) return; WT.save(); view.rebuild(); renderCard(); UI.topbar(); });
      on('checkCams', () => { const n = WT.checkCameras(pid); WT.save(); UI.toast(n ? `${n} new photo${n === 1 ? '' : 's'}. Walking in left some scent.` : 'No new photos. Walking in left some scent.'); renderCard(); refreshMap(); });
      let sellArmed = false;
      on('sell', () => { if (!sellArmed) { sellArmed = true; $('#sellq', card).innerHTML = '<span class="warn">Press again to sell.</span>'; return; } if (UI.err(WT.sellLand(pid))) return; WT.save(); state.pid = null; view.rebuild(); renderCard(); UI.topbar(); });
      card.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
        state.tool = b.dataset.tool;
        if (state.tool === 'stand') state.toolArg = $('#standSel', card).value;
        if (state.tool === 'camera') state.toolArg = $('#camSel', card).value;
        if (state.tool === 'plot') state.toolArg = { type: $('#plotSel', card).value, acres: +$('#plotAc', card).value };
        if (state.tool === 'trees') state.toolArg = false;
        card.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x === b));
        UI.toast(state.tool === 'remove' ? 'Tap a stand, camera or spot to pick it up.' : state.tool === 'sanct' ? 'Tap to add or remove sanctuary (no hunting). Tap another tool when done.' : 'Tap the map inside the property.');
        refreshMap();
      }));
    }
    renderCard();
  };
  UI.screens.land = (el) => UI.screens.map(el, { mode: 'land' });
})();
