/* Whitetail Country: simulation core (world generation + deer herds).
   No DOM access, so it runs headless in Node for calibration (see calibrate.js). */
(function (root) {
  const WT = (root.WT = root.WT || {});
  const C = () => WT.CONFIG;

  /* ================================================================ RNG */
  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    const r = {
      next() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      range(lo, hi) { return lo + (hi - lo) * r.next(); },
      int(lo, hi) { return Math.floor(r.range(lo, hi + 1)); },
      chance(p) { return r.next() < p; },
      pick(arr) { return arr[Math.floor(r.next() * arr.length)]; },
      normal(mean, sd) {
        let u = 0, v = 0;
        while (u === 0) u = r.next();
        while (v === 0) v = r.next();
        return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      },
      span(x) { return Array.isArray(x) ? r.range(x[0], x[1]) : x; },
      getState() { return a; },
      setState(s) { a = s | 0; },
    };
    return r;
  }
  WT.makeRng = makeRng;

  function hash2(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  WT.hash2 = hash2;

  function valueNoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  // Genetics across the map: -1 (cold pocket) .. 0 (neutral, most of the map) .. +1 and a bit more (hot pocket).
  WT.geneField = function (world, x, y, yr) {
    const gm = C().deer.geneMap, s = world.seed + 771, W = world.W, Hh = world.H;
    const ang = hash2(1, 2, s) * Math.PI * 2;
    { const da = hash2(7, 8, s) * Math.PI * 2, k = (yr || 0) * gm.drift; x -= Math.cos(da) * k; y -= Math.sin(da) * k; } // the pattern slides slowly, pockets and all
    const raw = (px, py) => fbm(px / (W * gm.scale), py / (W * gm.scale), s, 2);
    if (world._geneMean === undefined) { let t = 0, n = 0; for (let yy = 0; yy < Hh; yy += 8) for (let xx = 0; xx < W; xx += 8) { t += raw(xx, yy); n++; } world._geneMean = t / n; } // so no map is all warm or all cold
    let c = (raw(x, y) - world._geneMean) * gm.amp + ((x / W - 0.5) * Math.cos(ang) + (y / Hh - 0.5) * Math.sin(ang)) * 2 * gm.tilt;
    let g = Math.sign(c) * Math.pow(Math.min(1, Math.abs(c)), gm.shape);
    const bump = (k, amp) => { const cx = (0.12 + 0.76 * hash2(k, 5, s)) * W, cy = (0.12 + 0.76 * hash2(k, 6, s)) * Hh, r = gm.pocket * W; return amp * Math.exp(-((x - cx) * (x - cx) + (y - cy) * (y - cy)) / (2 * r * r)); };
    if (hash2(3, 4, s) < gm.hotChance) g += bump(11, gm.hot);
    if (hash2(4, 3, s) < gm.coldChance) g -= bump(12, gm.cold);
    return clamp(g, -1.5, 1.6);
  };
  function fbm(x, y, s, oct) {
    let sum = 0, amp = 1, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += valueNoise(x * f, y * f, s + i * 101) * amp;
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  }

  const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
  const lerpTable = (tbl, d, col = 1) => {
    if (d <= tbl[0][0]) return tbl[0][col];
    for (let i = 1; i < tbl.length; i++) {
      if (d <= tbl[i][0]) {
        const [d0] = tbl[i - 1], [d1] = tbl[i];
        const t = (d - d0) / (d1 - d0);
        return tbl[i - 1][col] + (tbl[i][col] - tbl[i - 1][col]) * t;
      }
    }
    return tbl[tbl.length - 1][col];
  };
  WT.clamp = clamp;
  WT.lerpTable = lerpTable;

  /* ================================================================ COVER TYPES */
  const T = {
    WATER: 0, CREEK: 1, SLOUGH: 2, TIMBER: 3, BELT: 4, BRUSH: 5, PRAIRIE: 6, HAY: 7, PASTURE: 8,
    CORN: 9, SOY: 10, WHEAT: 11, SUNFLOWER: 12, ROAD: 13, YARD: 14, TOWN: 15, PLOT: 16, YOUNGTREES: 17, POND: 18, PLOT_NEW: 19,
  };
  WT.T = T;
  // food, bedding, water, cover (concealing), name
  const COVER = [];
  COVER[T.WATER] =     { f: 0,    b: 0,    w: 1,   c: 0,   name: 'River' };
  COVER[T.CREEK] =     { f: 0.05, b: 0.25, w: 1,   c: 0.3, name: 'Creek' };
  COVER[T.SLOUGH] =    { f: 0.1,  b: 0.9,  w: 0.6, c: 0.8, name: 'Cattail slough' };
  COVER[T.TIMBER] =    { f: 0.35, b: 0.8,  w: 0,   c: 1,   name: 'Hardwood timber' };
  COVER[T.BELT] =      { f: 0.2,  b: 0.55, w: 0,   c: 0.85,name: 'Shelterbelt' };
  COVER[T.BRUSH] =     { f: 0.4,  b: 0.8,  w: 0,   c: 0.8, name: 'Plum thicket / brush' };
  COVER[T.PRAIRIE] =   { f: 0.15, b: 0.7,  w: 0,   c: 0.6, name: 'Native prairie / CRP' };
  COVER[T.HAY] =       { f: 0.45, b: 0.05, w: 0,   c: 0.1, name: 'Hay ground' };
  COVER[T.PASTURE] =   { f: 0.3,  b: 0.05, w: 0,   c: 0.05,name: 'Pasture' };
  COVER[T.CORN] =      { f: 1,    b: 0.25, w: 0,   c: 0.5, name: 'Corn' };
  COVER[T.SOY] =       { f: 0.85, b: 0,    w: 0,   c: 0.1, name: 'Soybeans' };
  COVER[T.WHEAT] =     { f: 0.5,  b: 0,    w: 0,   c: 0.05,name: 'Wheat stubble' };
  COVER[T.SUNFLOWER] = { f: 0.6,  b: 0.1,  w: 0,   c: 0.3, name: 'Sunflowers' };
  COVER[T.ROAD] =      { f: 0,    b: 0,    w: 0,   c: 0,   name: 'Gravel road' };
  COVER[T.YARD] =      { f: 0.05, b: 0,    w: 0,   c: 0.2, name: 'Farmstead' };
  COVER[T.TOWN] =      { f: 0,    b: 0,    w: 0,   c: 0,   name: 'Town' };
  COVER[T.PLOT] =      { f: 1.1,  b: 0,    w: 0,   c: 0.1, name: 'Food plot' };
  COVER[T.YOUNGTREES] ={ f: 0.15, b: 0.35, w: 0,   c: 0.4, name: 'Young tree planting' };
  COVER[T.POND] =      { f: 0,    b: 0,    w: 1,   c: 0,   name: 'Pond' };
  COVER[T.PLOT_NEW] =  { f: 0.1,  b: 0,    w: 0,   c: 0,   name: 'Bare food plot (dirt until planted)' };
  WT.COVER = COVER;
  const isWater = (t) => t === T.WATER || t === T.CREEK || t === T.POND;
  WT.isWater = isWater;

  /* ================================================================ BFS helpers */
  function distanceField(W, H, isSource, maxD = 255) {
    const d = new Uint8Array(W * H).fill(maxD);
    const q = new Int32Array(W * H);
    let qh = 0, qt = 0;
    for (let i = 0; i < W * H; i++) if (isSource(i)) { d[i] = 0; q[qt++] = i; }
    while (qh < qt) {
      const i = q[qh++], x = i % W, y = (i / W) | 0, nd = d[i] + 1;
      if (nd >= maxD) continue;
      if (x > 0 && d[i - 1] > nd) { d[i - 1] = nd; q[qt++] = i - 1; }
      if (x < W - 1 && d[i + 1] > nd) { d[i + 1] = nd; q[qt++] = i + 1; }
      if (y > 0 && d[i - W] > nd) { d[i - W] = nd; q[qt++] = i - W; }
      if (y < H - 1 && d[i + W] > nd) { d[i + W] = nd; q[qt++] = i + W; }
    }
    return d;
  }

  /* ================================================================ WORLD GENERATION */
  const SURNAMES = ['Olson', 'Hanson', 'Larson', 'Nelson', 'Schmidt', 'Johnson', 'Berg', 'Lindqvist', 'Haugen', 'Wolff',
    'Kraft', 'Engen', 'Thorson', 'Bauer', 'Kessler', 'Moen', 'Skarphol', 'Rud', 'Halvorson', 'Vetter', 'Gunderson',
    'Fischer', 'Ostby', 'Lund', 'Brekke', 'Dahl', 'Rask', 'Strand', 'Tollefson', 'Wagner', 'Ziegler', 'Myhre', 'Aune'];
  const PLACE_BITS = ['Quarter', 'Place', 'Bottoms', 'Draw', 'Slough', 'Ridge', 'Section', 'Coulee', 'Flats', 'Hollow', 'Eighty', 'Creek'];
  const PUBLIC_NAMES = ['Sheyenne River WMA', 'Pipestem Lake NWR', 'Coteau Hills WMA', 'Lonetree WMA', 'Oak Creek State Land',
    'Wild Rice Bottoms WMA', 'Prairie Pothole PLOTS', 'Maple River WMA', 'Hawk Slough WPA', 'Kraft Slough NWR', 'Dakota Breaks State Land',
    'Little Missouri Walk-in', 'Crane Lake WPA', 'Buffalo Coulee WMA'];
  const TOWN_NAMES = ['Valley Forks', 'New Bergen', 'Minnewauken', 'Dawes', 'Kloten'];

  /* Fields (worlds made from version 2 on). Row crops are laid out the way they are farmed: rectangles, each one
     crop, never touching another field. They only take open ground, so rivers, creeks, sloughs, woods, roads and
     farmyards cut straight through them and are never moved. Returns a field id per tile (-1 = not a field). */
  function squareFields(cover, W, H, seed, big = 1) {
    const rng = makeRng(seed * 13 + 5), N = W * H;
    const isCrop = (c) => c === T.CORN || c === T.SOY || c === T.SUNFLOWER;
    const open = (c) => c === T.PRAIRIE || c === T.HAY || c === T.PASTURE || c === T.WHEAT || c === T.BRUSH;
    const was = new Uint8Array(N); let target = 0;
    for (let i = 0; i < N; i++) if (isCrop(cover[i])) {
      was[i] = cover[i]; target++;
      const h = hash2((i % W) >> 2, ((i / W) | 0) >> 2, seed + 3);
      cover[i] = h < 0.5 ? T.PRAIRIE : h < 0.8 ? T.HAY : T.PASTURE; // the old ragged crop ground goes back to grass
    }
    const field = new Int16Array(N).fill(-1);
    let placed = 0, id = 0;
    target *= 0.8;
    for (let tries = 0; tries < 6000 * big && placed < target; tries++) {
      const w = rng.int(6, 16), h = rng.int(5, 12), x0 = rng.int(1, W - w - 2), y0 = rng.int(1, H - h - 2);
      let conv = 0, wasC = 0, clash = false; const votes = {};
      for (let y = y0 - 1; y <= y0 + h && !clash; y++) for (let x = x0 - 1; x <= x0 + w; x++) {
        const i = y * W + x;
        if (field[i] >= 0) { clash = true; break; }                       // a field, or the gap around one
        if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) continue;
        if (open(cover[i])) conv++;
        if (was[i]) { wasC++; votes[was[i]] = (votes[was[i]] || 0) + 1; }
      }
      if (clash || conv / (w * h) < 0.72 || wasC / (w * h) < 0.3) continue;   // mostly open, and where crops grew before
      const crop = +Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = y * W + x; if (open(cover[i])) { cover[i] = crop; field[i] = id; placed++; } }
      id++;
    }
    return field;
  }

  function genWorld(seed, ver = 1) {
    const cfg = C().world;
    // version 3 worlds are 2.5 times the area; everything counted per map scales with it
    const big = ver >= 3 ? 2.5 : 1, side = Math.sqrt(big);
    const W = Math.round(cfg.width * side), H = Math.round(cfg.height * side), N = W * H;
    const rng = makeRng(seed * 7 + 13);
    const elev = new Float32Array(N), moist = new Float32Array(N), soil = new Float32Array(N), gen = new Float32Array(N);
    const cover = new Uint8Array(N);
    const s = seed * 31;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      elev[i] = fbm(x / 38, y / 38, s + 1, 4) * 0.75 + fbm(x / 11, y / 11, s + 2, 3) * 0.25;
      moist[i] = fbm(x / 26, y / 26, s + 3, 3);
      soil[i] = fbm(x / 30, y / 30, s + 4, 3);
      gen[i] = fbm(x / 110, y / 110, s + 5, 2);
    }

    // --- Rivers and creeks
    const water = new Uint8Array(N);
    const carve = (x, y, wdt, kind) => {
      for (let dy = -wdt; dy <= wdt; dy++) for (let dx = -wdt; dx <= wdt; dx++) {
        if (dx * dx + dy * dy > wdt * wdt + 0.5) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const k = yy * W + xx;
        if (water[k] !== 1) water[k] = kind;
      }
    };
    // main river, west to east, meandering
    let ry = H * rng.range(0.35, 0.65), drift = 0;
    const riverPath = [];
    for (let x = 0; x < W; x++) {
      drift += rng.range(-0.25, 0.25); drift = clamp(drift, -0.9, 0.9);
      ry += drift + Math.sin(x / 13 + seed) * 0.45;
      ry = clamp(ry, 12, H - 12);
      riverPath.push([x, Math.round(ry)]);
      carve(x, Math.round(ry), 1, 1);
      // fill vertical gaps
      if (x > 0) {
        const py = riverPath[x - 1][1], cy = Math.round(ry);
        for (let yy = Math.min(py, cy); yy <= Math.max(py, cy); yy++) carve(x, yy, 1, 1);
      }
    }
    // creeks flowing into the river from north and south
    const creekCount = Math.round(rng.int(3, 5) * big);
    for (let c = 0; c < creekCount; c++) {
      const fromTop = c % 2 === 0;
      let cx = rng.range(15, W - 15), cy = fromTop ? 0 : H - 1;
      let dx = 0;
      for (let step = 0; step < H; step++) {
        const k = Math.round(cy) * W + Math.round(cx);
        if (water[k] === 1) break;
        carve(Math.round(cx), Math.round(cy), 0, 2);
        dx += rng.range(-0.3, 0.3); dx = clamp(dx, -0.8, 0.8);
        cx = clamp(cx + dx, 2, W - 3);
        cy += fromTop ? 1 : -1;
        if (cy < 0 || cy >= H) break;
      }
    }
    // valleys: lower elevation near water
    const dWater0 = distanceField(W, H, (i) => water[i] > 0, 60);
    for (let i = 0; i < N; i++) elev[i] -= Math.exp(-dWater0[i] / 9) * 0.25;

    // --- Field cells (Voronoi)
    const cellSize = 13;
    const cellsX = Math.ceil(W / cellSize) + 1, cellsY = Math.ceil(H / cellSize) + 1;
    const cellPts = [];
    for (let cy = 0; cy < cellsY; cy++) for (let cx = 0; cx < cellsX; cx++) {
      cellPts.push([cx * cellSize + rng.range(0, cellSize), cy * cellSize + rng.range(0, cellSize)]);
    }
    const cropBag = [T.CORN, T.CORN, T.CORN, T.SOY, T.SOY, T.SOY, T.WHEAT, T.WHEAT, T.SUNFLOWER, T.HAY, T.HAY, T.PASTURE, T.PRAIRIE, T.PRAIRIE, T.PRAIRIE, T.BRUSH];
    const cellType = cellPts.map(() => rng.pick(cropBag));
    const cellOf = new Int32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const gx = Math.floor(x / cellSize), gy = Math.floor(y / cellSize);
      let best = 1e9, bi = 0;
      const jx = x + (fbm(x / 6, y / 6, s + 9, 2) - 0.5) * 5, jy = y + (fbm(x / 6, y / 6, s + 10, 2) - 0.5) * 5;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const cx = gx + ox, cy = gy + oy;
        if (cx < 0 || cy < 0 || cx >= cellsX || cy >= cellsY) continue;
        const ci = cy * cellsX + cx, p = cellPts[ci];
        const d = (p[0] - jx) ** 2 + (p[1] - jy) ** 2;
        if (d < best) { best = d; bi = ci; }
      }
      cellOf[y * W + x] = bi;
    }

    // --- Cover
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (water[i] === 1) { cover[i] = T.WATER; continue; }
      if (water[i] === 2) { cover[i] = T.CREEK; continue; }
      const dw = dWater0[i];
      const nTimber = fbm(x / 7, y / 7, s + 20, 2);
      if (dw <= 2 + nTimber * 6 && nTimber > 0.38) { cover[i] = T.TIMBER; continue; }
      if (dw <= 1 && nTimber > 0.3) { cover[i] = T.BRUSH; continue; }
      if (elev[i] < 0.3 && moist[i] > 0.52) { cover[i] = elev[i] < 0.24 && moist[i] > 0.6 ? T.POND : T.SLOUGH; continue; }
      if (moist[i] > 0.66 && fbm(x / 5, y / 5, s + 21, 2) > 0.6) { cover[i] = T.SLOUGH; continue; }
      // wooded draws on steeper ground
      const gx = elev[Math.min(i + 1, N - 1)] - elev[Math.max(i - 1, 0)];
      if (Math.abs(gx) > 0.03 && nTimber > 0.55) { cover[i] = T.TIMBER; continue; }
      cover[i] = cellType[cellOf[i]];
    }
    // ponds bordered by cattails
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (cover[i] !== T.POND) continue;
      for (const k of [i - 1, i + 1, i - W, i + W]) if (cover[k] !== T.POND && !isWater(cover[k])) cover[k] = T.SLOUGH;
    }
    // shelterbelts along some field-cell borders
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, a = cellOf[i];
      const t = cover[i];
      if (t !== cellType[a]) continue;
      for (const k of [i + 1, i + W]) {
        const b = cellOf[k];
        if (b === a || cover[k] !== cellType[b]) continue;
        const pair = a < b ? hash2(a, b, s) : hash2(b, a, s);
        if (pair < 0.22) cover[i] = T.BELT;
      }
    }

    // --- Roads on a loose section-line grid
    const sp = cfg.roadSpacing;
    const vRoads = [], hRoads = [];
    for (let rx = Math.round(sp * rng.range(0.4, 0.8)); rx < W - 6; rx += sp + rng.int(-6, 6)) vRoads.push(rx);
    for (let ry2 = Math.round(sp * rng.range(0.4, 0.8)); ry2 < H - 6; ry2 += sp + rng.int(-6, 6)) hRoads.push(ry2);
    // --- Version 4: roadless blocks that become the big public areas (chosen where the ground is already wild)
    const wild = ver >= 4 ? pickWildBlocks(cover, W, H, vRoads, hRoads, seed) : [];
    for (const b of wild) for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
      const i = y * W + x, c = cover[i];
      if (isWater(c) || c === T.TIMBER || c === T.SLOUGH || c === T.BRUSH) continue;
      const n = fbm(x / 10, y / 10, s + 77, 3), m = fbm(x / 7, y / 7, s + 78, 2), wc = cfg.wild; // nobody farms it: grass, brush, woods and wet ground
      cover[i] = n > wc.timber ? T.TIMBER : n > wc.brush ? T.BRUSH : moist[i] > 0.5 && m > wc.slough ? T.SLOUGH : T.PRAIRIE;
    }
    const road = new Uint8Array(N);
    vRoads.forEach((rx, k) => {
      const broken = rng.chance(0.35) ? [rng.int(10, H - 40), 0] : null;
      if (broken) broken[1] = broken[0] + rng.int(15, 35);
      for (let y = 0; y < H; y++) {
        if (broken && y > broken[0] && y < broken[1]) continue;
        if (wild.some((b) => b.i < k + 1 && k + 1 < b.i + b.cw && y > b.ry0 && y < b.ry1)) continue; // no road through roadless country
        const x = clamp(Math.round(rx + Math.sin(y / 17 + k * 3) * 2.2), 0, W - 1);
        road[y * W + x] = 1;
        if (y > 0) { const px = clamp(Math.round(rx + Math.sin((y - 1) / 17 + k * 3) * 2.2), 0, W - 1); for (let xx = Math.min(px, x); xx <= Math.max(px, x); xx++) road[y * W + xx] = 1; }
      }
    });
    hRoads.forEach((ry3, k) => {
      const broken = rng.chance(0.35) ? [rng.int(10, W - 50), 0] : null;
      if (broken) broken[1] = broken[0] + rng.int(20, 45);
      for (let x = 0; x < W; x++) {
        if (broken && x > broken[0] && x < broken[1]) continue;
        if (wild.some((b) => b.j < k + 1 && k + 1 < b.j + b.ch && x > b.rx0 && x < b.rx1)) continue;
        const y = clamp(Math.round(ry3 + Math.sin(x / 19 + k * 5) * 2), 0, H - 1);
        road[y * W + x] = 1;
        if (x > 0) { const py = clamp(Math.round(ry3 + Math.sin((x - 1) / 19 + k * 5) * 2), 0, H - 1); for (let yy = Math.min(py, y); yy <= Math.max(py, y); yy++) road[yy * W + x] = 1; }
      }
    });
    for (let i = 0; i < N; i++) if (road[i]) cover[i] = T.ROAD; // bridges included

    // --- Town at a central intersection
    const tx = vRoads[Math.floor(vRoads.length / 2)] || W / 2, ty = hRoads[Math.floor(hRoads.length / 2)] || H / 2;
    const towns = [{ name: rng.pick(TOWN_NAMES), x: tx, y: ty }];
    for (let y = ty - 4; y <= ty + 4; y++) for (let x = tx - 5; x <= tx + 5; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (cover[i] !== T.ROAD && !isWater(cover[i])) cover[i] = T.TOWN;
    }
    // --- Farmsteads along roads, with a shelterbelt on the north and west
    const farmsteads = [];
    for (let k = 0; k < Math.round(26 * big); k++) {
      const vertical = rng.chance(0.5);
      const list = vertical ? vRoads : hRoads;
      if (!list.length) break;
      const r0 = rng.pick(list);
      let x, y;
      if (vertical) { y = rng.int(4, H - 6); x = r0 + (rng.chance(0.5) ? 3 : -5); }
      else { x = rng.int(4, W - 6); y = r0 + (rng.chance(0.5) ? 3 : -5); }
      if (Math.abs(x - tx) < 12 && Math.abs(y - ty) < 10) continue;
      let ok = true;
      for (let yy = y - 1; yy <= y + 3 && ok; yy++) for (let xx = x - 1; xx <= x + 3; xx++) {
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) { ok = false; break; }
        const c = cover[yy * W + xx];
        if (isWater(c) || c === T.ROAD || c === T.TOWN || c === T.YARD) { ok = false; break; }
      }
      if (!ok) continue;
      for (let yy = y; yy <= y + 2; yy++) for (let xx = x; xx <= x + 2; xx++) cover[yy * W + xx] = T.YARD;
      for (let xx = x - 1; xx <= x + 3; xx++) cover[(y - 1) * W + xx] = T.BELT;
      for (let yy = y - 1; yy <= y + 3; yy++) cover[yy * W + x - 1] = T.BELT;
      farmsteads.push({ x: x + 1, y: y + 1 });
    }

    const world = { seed, W, H, cover, elev, soil, gen, moist, towns, farmsteads, riverPath, ver, big, wild };
    if (ver >= 2) world.fieldId = squareFields(cover, W, H, seed, big);
    computeDerivedLayers(world);
    genParcels(world, rng);
    if (ver >= 2) {
      // public land is not farmed: it cuts across any field that reaches into it
      let cut = false;
      for (let i = 0; i < N; i++) { const pid = world.parcelOf[i]; if (pid >= 0 && world.fieldId[i] >= 0 && world.parcels[pid].owner === 'public') { cover[i] = T.PRAIRIE; world.fieldId[i] = -1; cut = true; } }
      if (cut) { computeDerivedLayers(world); for (const p of world.parcels) p.habitat = tileHabitat(world, p.id); }
    }
    if (ver >= 3) {
      // a third of the public areas are bow only (at least one), picked the same way every time for a given map
      const pubs = world.parcels.filter((p) => p.owner === 'public').sort((a, b) => hash2(a.id, 3, seed + 41) - hash2(b.id, 3, seed + 41));
      const want = Math.max(1, Math.round(pubs.length * cfg.bowOnlyShare));
      pubs.forEach((p, k) => { p.bowOnly = k < want; });
      if (ver >= 4) { // a big area is bow only or not as a whole, never unit by unit
        const groups = new Map();
        for (const p of pubs) { const key = p.complex !== undefined ? 'c' + p.complex : 'p' + p.id; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(p); }
        // about a third of the public ACRES, not a third of the areas, or two big bow-only blocks could swallow the map
        const keys = [...groups.keys()], size = (key) => groups.get(key).reduce((t, p) => t + p.tiles, 0), total = keys.reduce((t, key) => t + size(key), 0);
        let bowT = 0; const bowKeys = new Set();
        for (const key of keys) if (bowT + size(key) <= total * (cfg.bowOnlyShare + 0.08)) { bowKeys.add(key); bowT += size(key); }
        if (!bowKeys.size) bowKeys.add(keys.slice().sort((a, b) => size(a) - size(b))[0]);
        keys.forEach((key) => groups.get(key).forEach((p) => { p.bowOnly = bowKeys.has(key); }));
        const cx = keys.filter((key) => key[0] === 'c'); // never every big area: rifle hunters need deep ground too
        if (cx.length && cx.every((key) => groups.get(key)[0].bowOnly)) groups.get(cx.sort((a, b) => groups.get(b).length - groups.get(a).length)[0]).forEach((p) => { p.bowOnly = false; });
      }
    }
    world.ready = true; // parcels are final from here on
    return world;
  }
  WT.genWorld = genWorld;

  // Which blocks of the road grid go roadless. Grid lines are the roads plus the map edges (an edge has no road on it).
  function pickWildBlocks(cover, W, H, vRoads, hRoads, seed) {
    const cfg = C().world.wild, xs = [-1, ...vRoads, W], ys = [-1, ...hRoads, H];
    const tx = vRoads[Math.floor(vRoads.length / 2)] ?? W / 2, ty = hRoads[Math.floor(hRoads.length / 2)] ?? H / 2; // where the town will be
    const WILD = new Set([T.TIMBER, T.BRUSH, T.SLOUGH, T.POND, T.WATER, T.CREEK, T.PRAIRIE, T.BELT]);
    const cands = [];
    for (const [cw, ch, kind] of [[2, 2, 'big'], [2, 1, 'mid'], [1, 2, 'mid']]) for (let i = 0; i + cw < xs.length; i++) for (let j = 0; j + ch < ys.length; j++) {
      const x0 = Math.max(0, xs[i] + 3), x1 = Math.min(W - 1, xs[i + cw] - 3), y0 = Math.max(0, ys[j] + 3), y1 = Math.min(H - 1, ys[j + ch] - 3);
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (kind === 'big' ? Math.min(bw, bh) < cfg.bigMin : Math.max(bw, bh) < cfg.bigMin || Math.min(bw, bh) < cfg.midMin) continue;
      if (tx > x0 - 12 && tx < x1 + 12 && ty > y0 - 12 && ty < y1 + 12) continue; // not on top of town
      if (xs[i] < 0 && xs[i + cw] >= W || ys[j] < 0 && ys[j + ch] >= H) continue;
      let wildN = 0, n = 0;
      for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) { n++; if (WILD.has(cover[y * W + x])) wildN++; }
      cands.push({ i, j, cw, ch, kind, x0, x1, y0, y1, tiles: bw * bh, score: wildN / n + hash2(i * 7 + cw, j * 5 + ch, seed + 97) * cfg.luck,
        // where the inside roads stop: just past the roads that bound the block, or at the map edge
        ry0: ys[j] < 0 ? -1 : ys[j] + 2, ry1: ys[j + ch] >= H ? H : ys[j + ch] - 2, rx0: xs[i] < 0 ? -1 : xs[i] + 2, rx1: xs[i + cw] >= W ? W : xs[i + cw] - 2 });
    }
    cands.sort((a, b) => b.score - a.score);
    const picked = []; let used = 0;
    const clash = (a, b) => a.i <= b.i + b.cw && b.i <= a.i + a.cw && a.j <= b.j + b.ch && b.j <= a.j + a.ch; // overlapping or sharing a road
    const take = (kind, count) => { for (const c of cands) { if (count <= 0) break; if (c.kind !== kind || picked.some((p) => clash(p, c)) || used + c.tiles > cfg.maxShare * W * H) continue; picked.push(c); used += c.tiles; count--; } };
    take('big', 1 + (hash2(1, 1, seed + 98) < cfg.secondBig ? 1 : 0));
    take('mid', 1 + (hash2(2, 2, seed + 98) < cfg.secondMid ? 1 : 0));
    return picked;
  }

  // distance to road/town, distance to water, deer travel
  function computeDerivedLayers(world) {
    const { W, H, cover } = world, N = W * H;
    world.distRoad = distanceField(W, H, (i) => cover[i] === T.ROAD || cover[i] === T.TOWN || cover[i] === T.YARD, 40);
    world.distWater = distanceField(W, H, (i) => isWater(cover[i]), 60);
    const travel = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, c = COVER[cover[i]];
      if (isWater(cover[i]) || cover[i] === T.ROAD || cover[i] === T.TOWN) continue;
      let f = 0, b = 0, cv = 0, cr = 0, n = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const t = cover[yy * W + xx], cc = COVER[t];
        f = Math.max(f, cc.f); b = Math.max(b, cc.b); cv += cc.c; n++;
        if (t === T.CREEK) cr = 1;
      }
      const edge = Math.min(f, b);                     // bedding meets food
      const corridor = (cover[i] === T.BELT || cover[i] === T.TIMBER || cover[i] === T.BRUSH) ? 0.35 : 0;
      const pinch = c.c > 0.6 && cv / n < 0.45 ? 0.35 : 0; // narrow strip of cover in open country
      travel[i] = edge * 0.55 + corridor + pinch + cr * 0.25 + (fbm(x / 9, y / 9, world.seed * 31 + 40, 2) - 0.5) * 0.3;
    }
    let mx = 0;
    for (let i = 0; i < N; i++) mx = Math.max(mx, travel[i]);
    for (let i = 0; i < N; i++) travel[i] = clamp(travel[i] / (mx * 0.8));
    world.travel = travel;
  }
  WT.computeDerivedLayers = computeDerivedLayers;

  /* ================================================================ PARCELS */
  function genParcels(world, rng) {
    const cfg = C().world;
    const { W, H, cover } = world, N = W * H;
    const parcelOf = new Int16Array(N).fill(-1);
    const passable = (i) => cover[i] !== T.ROAD && cover[i] !== T.TOWN;
    const targetTiles = cfg.parcelTargetAcres / cfg.acresPerTile;
    const minD = Math.sqrt(targetTiles) * 0.85;
    const seeds = [];
    for (let tries = 0; tries < 6000 * (world.big || 1); tries++) {
      const x = rng.int(1, W - 2), y = rng.int(1, H - 2), i = y * W + x;
      if (!passable(i) || isWater(cover[i])) continue;
      const md = minD * rng.range(0.7, 1.35);
      if (seeds.some((p) => (p[0] - x) ** 2 + (p[1] - y) ** 2 < md * md)) continue;
      seeds.push([x, y]);
    }
    // Dijkstra region growing; borders prefer roads, rivers, tree lines, field edges
    const dist = new Float32Array(N).fill(Infinity);
    const heap = [];
    const push = (d, i, p) => { heap.push([d, i, p]); let k = heap.length - 1; while (k > 0) { const pk = (k - 1) >> 1; if (heap[pk][0] <= heap[k][0]) break; [heap[pk], heap[k]] = [heap[k], heap[pk]]; k = pk; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    seeds.forEach(([x, y], p) => { const i = y * W + x; dist[i] = 0; push(0, i, p); });
    while (heap.length) {
      const [d, i, p] = pop();
      if (parcelOf[i] !== -1) continue;
      parcelOf[i] = p;
      const x = i % W, y = (i / W) | 0;
      const nb = [];
      if (x > 0) nb.push(i - 1); if (x < W - 1) nb.push(i + 1); if (y > 0) nb.push(i - W); if (y < H - 1) nb.push(i + W);
      for (const k of nb) {
        if (parcelOf[k] !== -1 || !passable(k)) continue;
        let cost = 1 + hash2(k % W, (k / W) | 0, world.seed + p) * 0.7;
        if (cover[k] === T.WATER && cover[i] !== T.WATER) cost += 22;
        if (cover[k] === T.BELT && cover[i] !== T.BELT) cost += 3;
        if (cover[k] !== cover[i]) cost += 1.2;
        const nd = d + cost;
        if (nd < dist[k]) { dist[k] = nd; push(nd, k, p); }
      }
    }
    // merge small parcels into the neighbor they share the longest border with
    const minTiles = cfg.minParcelAcres / cfg.acresPerTile;
    for (let pass = 0; pass < 4; pass++) {
      const count = new Map();
      for (let i = 0; i < N; i++) if (parcelOf[i] >= 0) count.set(parcelOf[i], (count.get(parcelOf[i]) || 0) + 1);
      let changed = false;
      for (const [p, n] of count) {
        if (n >= minTiles) continue;
        const border = new Map();
        for (let i = 0; i < N; i++) {
          if (parcelOf[i] !== p) continue;
          const x = i % W;
          for (const k of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
            if (k < 0 || k >= N) continue;
            const q = parcelOf[k];
            if (q >= 0 && q !== p) border.set(q, (border.get(q) || 0) + 1);
          }
        }
        let best = -1, bn = 0;
        for (const [q, bnum] of border) if (bnum > bn) { bn = bnum; best = q; }
        if (best >= 0) { for (let i = 0; i < N; i++) if (parcelOf[i] === p) parcelOf[i] = best; changed = true; }
      }
      if (!changed) break;
    }
    // relabel to compact ids
    const remap = new Map();
    for (let i = 0; i < N; i++) { const p = parcelOf[i]; if (p >= 0 && !remap.has(p)) remap.set(p, remap.size); }
    for (let i = 0; i < N; i++) if (parcelOf[i] >= 0) parcelOf[i] = remap.get(parcelOf[i]);
    world.parcelOf = parcelOf;
    const P = remap.size;
    const parcels = [];
    for (let p = 0; p < P; p++) parcels.push({ id: p, tiles: 0, minX: W, minY: H, maxX: 0, maxY: 0, sx: 0, sy: 0, neighbors: new Set() });
    for (let i = 0; i < N; i++) {
      const p = parcelOf[i]; if (p < 0) continue;
      const x = i % W, y = (i / W) | 0, P0 = parcels[p];
      P0.tiles++; P0.sx += x; P0.sy += y;
      if (x < P0.minX) P0.minX = x; if (x > P0.maxX) P0.maxX = x; if (y < P0.minY) P0.minY = y; if (y > P0.maxY) P0.maxY = y;
    }
    // neighbors (also across a road, so roads don't isolate land)
    for (let i = 0; i < N; i++) {
      const p = parcelOf[i]; if (p < 0) continue;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [0, 1], [2, 0], [0, 2], [3, 0], [0, 3]]) {
        const xx = x + dx, yy = y + dy; if (xx >= W || yy >= H) continue;
        const q = parcelOf[yy * W + xx];
        if (q >= 0 && q !== p) { parcels[p].neighbors.add(q); parcels[q].neighbors.add(p); }
      }
    }
    world.parcels = parcels;

    // ---- assign public areas: merge clumps of parcels with lots of water/bedding
    parcels.forEach((p) => { p.cx = p.sx / p.tiles; p.cy = p.sy / p.tiles; p.habitat = tileHabitat(world, p.id); });
    const totalTiles = parcels.reduce((a, p) => a + p.tiles, 0);
    const order = parcels.slice().sort((a, b) => (b.habitat.water + b.habitat.bedding + rng.range(0, 0.6)) - (a.habitat.water + a.habitat.bedding + rng.range(0, 0.6)));
    let publicTiles = 0, pubIdx = 0;
    const pubNames = PUBLIC_NAMES.slice();
    const v4 = world.ver >= 4, isRoadT = (i) => cover[i] === T.ROAD || cover[i] === T.TOWN;
    const roadTouch = () => { // which parcels have a road along them, and how much border each shares with each neighbour
      const touch = new Uint8Array(parcels.length), border = parcels.map(() => new Map());
      for (let i = 0; i < N; i++) {
        const p = parcelOf[i]; if (p < 0) continue; const x = i % W;
        for (const k of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
          if (k < 0 || k >= N) continue;
          if (isRoadT(k)) touch[p] = 1; else { const q = parcelOf[k]; if (q >= 0 && q !== p) border[p].set(q, (border[p].get(q) || 0) + 1); }
        }
      }
      return { touch, border };
    };
    let touch0 = null;
    if (v4) {
      touch0 = roadTouch().touch;
      // every parcel that sits in a roadless block is a unit of that block's public area
      world.wild.forEach((b, bi) => {
        const cname = pubNames.length ? pubNames.splice(rng.int(0, pubNames.length - 1), 1)[0] : `State Land #${bi + 1}`;
        // the private place that reaches in from one of the roads around it
        let wedge = null;
        if (b.kind === 'big' || hash2(bi, 9, world.seed + 55) < cfg.wild.midWedge) {
          const sides = []; if (b.ry0 >= 0) sides.push('top'); if (b.ry1 < H) sides.push('bottom'); if (b.rx0 >= 0) sides.push('left'); if (b.rx1 < W) sides.push('right');
          const side = sides[Math.floor(hash2(bi, 10, world.seed + 55) * sides.length) % sides.length], t = 0.3 + 0.4 * hash2(bi, 11, world.seed + 55);
          const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1, wd = cfg.wild.wedgeWide / 2, dp = cfg.wild.wedgeDeep;
          if (side === 'top' || side === 'bottom') { const cx = b.x0 + bw * t; wedge = { x0: cx - wd, x1: cx + wd, y0: side === 'top' ? b.y0 - 6 : b.y1 - bh * dp, y1: side === 'top' ? b.y0 + bh * dp : b.y1 + 6 }; }
          else if (side) { const cy = b.y0 + bh * t; wedge = { y0: cy - wd, y1: cy + wd, x0: side === 'left' ? b.x0 - 6 : b.x1 - bw * dp, x1: side === 'left' ? b.x0 + bw * dp : b.x1 + 6 }; }
        }
        let unit = 0;
        for (const p of parcels) {
          if (p.owner || p.cx < b.x0 || p.cx > b.x1 || p.cy < b.y0 || p.cy > b.y1) continue;
          if (wedge && p.cx >= wedge.x0 && p.cx <= wedge.x1 && p.cy >= wedge.y0 && p.cy <= wedge.y1) { p.inholding = true; continue; }
          p.owner = 'public'; p.complex = bi; p.complexName = cname; p.name = `${cname}, Unit ${++unit}`;
          publicTiles += p.tiles; pubIdx++;
        }
      });
    }
    for (const p of order) {
      if (publicTiles > totalTiles * (v4 ? cfg.wild.publicShare : cfg.publicShare)) break;
      if (p.merged || p.owner) continue;
      if (v4 && !touch0[p.id]) continue; // a small public area always has a road along it
      if ([...p.neighbors].some((q) => parcels[q].owner === 'public')) continue;
      p.owner = 'public';
      let area = p.tiles;
      const extra = rng.chance(0.25) ? 0 : rng.int(1, 3);
      const nbs = [...p.neighbors].filter((q) => !parcels[q].owner && !parcels[q].merged);
      for (let k = 0; k < extra && nbs.length; k++) {
        const q = nbs.splice(rng.int(0, nbs.length - 1), 1)[0];
        for (let i = 0; i < N; i++) if (parcelOf[i] === q) parcelOf[i] = p.id;
        parcels[q].merged = p.id;
        area += parcels[q].tiles;
      }
      p.tiles = area;
      p.name = area * cfg.acresPerTile < 100 ? `Walk-in Area #${rng.int(11, 98)}` : (pubNames.length ? pubNames.splice(rng.int(0, pubNames.length - 1), 1)[0] : `State Land #${pubIdx + 1}`);
      p.bowOnly = rng.chance(cfg.bowOnlyShare) && /NWR|WPA/.test(p.name) ? true : rng.chance(cfg.bowOnlyShare * 0.4);
      publicTiles += area; pubIdx++;
    }
    const pubs = parcels.filter((p) => p.owner === 'public' && p.merged === undefined);
    if (pubs.length && !pubs.some((p) => p.bowOnly)) pubs.sort((a, b) => b.tiles - a.tiles)[Math.min(1, pubs.length - 1)].bowOnly = true;
    if (v4) {
      // Every private parcel gets a road. One with none joins the neighbour it shares the most fence with (a private one
      // on a road if it can); one walled in by public land becomes part of that public land.
      for (let pass = 0; pass < 8; pass++) {
        const { touch, border } = roadTouch();
        let changed = false;
        for (const p of parcels) {
          if (p.merged !== undefined || p.owner === 'public' || touch[p.id]) continue;
          const nb = [...border[p.id]].filter(([q]) => parcels[q].merged === undefined);
          const priv = nb.filter(([q]) => parcels[q].owner !== 'public'), onRoad = priv.filter(([q]) => touch[q]);
          const from = onRoad.length ? onRoad : priv.length ? priv : nb;
          if (!from.length) continue;
          const q = from.sort((a, b) => b[1] - a[1])[0][0];
          for (let i = 0; i < N; i++) if (parcelOf[i] === p.id) parcelOf[i] = q;
          p.merged = q; parcels[q].tiles += p.tiles; changed = true;
          if (p.inholding && parcels[q].owner !== 'public') parcels[q].inholding = true;
          for (const [r, n] of border[p.id]) if (r !== q) border[q].set(r, (border[q].get(r) || 0) + n);
          for (const m of border) if (m.has(p.id)) { m.set(q, (m.get(q) || 0) + m.get(p.id)); m.delete(p.id); } // its fences are q's now
          border[q].delete(q);
        }
        if (!changed) break;
      }
    }
    // rebuild parcel list after merges (keep ids stable; merged parcels are removed)
    const alive = parcels.filter((p) => p.merged === undefined);
    const idMap = new Map(alive.map((p, k) => [p.id, k]));
    for (let i = 0; i < N; i++) if (parcelOf[i] >= 0) parcelOf[i] = idMap.get(parcelOf[i]);
    alive.forEach((p, k) => { p.id = k; });
    world.parcels = alive;
    recomputeParcelGeometry(world);

    // ---- owners, names
    for (const p of world.parcels) {
      if (p.owner === 'public') continue;
      p.owner = 'npc';
      const sur = rng.pick(SURNAMES);
      p.ownerName = sur;
      const bit = p.habitat.water > 0.5 && rng.chance(0.5) ? rng.pick(['Bottoms', 'Creek', 'Slough']) : rng.pick(PLACE_BITS);
      p.name = `${sur} ${bit}`;
      p.permission = rng.chance(cfg.permissionShare);
      if (p.inholding) p.permission = true; // the place inside the public land always rents its hunting
    }
    // starter parcel: NPC land nearest 100 acres with average-ish habitat, away from town
    const town = world.towns[0];
    let best = null, bestScore = 1e9;
    for (const p of world.parcels) {
      if (p.owner !== 'npc' || p.inholding) continue;
      const hq = habitatQuality(p.habitat);
      const sc = Math.abs(p.acres - cfg.starterAcres) * 1.5 + Math.abs(hq - 0.48) * 120 + (Math.hypot(p.cx - town.x, p.cy - town.y) < 25 ? 60 : 0);
      if (sc < bestScore) { bestScore = sc; best = p; }
    }
    best.owner = 'player';
    best.name = 'The Home Place';
    best.permission = false;
    world.starterId = best.id;
  }

  function recomputeParcelGeometry(world) {
    const { W, H, parcelOf } = world, N = W * H;
    const cfg = C().world;
    for (const p of world.parcels) { p.tiles = 0; p.minX = W; p.minY = H; p.maxX = 0; p.maxY = 0; p.sx = 0; p.sy = 0; p.neighbors = new Set(); }
    for (let i = 0; i < N; i++) {
      const id = parcelOf[i]; if (id < 0) continue;
      const p = world.parcels[id], x = i % W, y = (i / W) | 0;
      p.tiles++; p.sx += x; p.sy += y;
      if (x < p.minX) p.minX = x; if (x > p.maxX) p.maxX = x; if (y < p.minY) p.minY = y; if (y > p.maxY) p.maxY = y;
    }
    for (let i = 0; i < N; i++) {
      const id = parcelOf[i]; if (id < 0) continue;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [0, 1], [2, 0], [0, 2], [3, 0], [0, 3]]) {
        const xx = x + dx, yy = y + dy; if (xx >= W || yy >= H) continue;
        const q = parcelOf[yy * W + xx];
        if (q >= 0 && q !== id) { world.parcels[id].neighbors.add(q); world.parcels[q].neighbors.add(id); }
      }
    }
    for (const p of world.parcels) {
      p.cx = p.sx / p.tiles; p.cy = p.sy / p.tiles;
      p.acresExact = p.tiles * cfg.acresPerTile;
      p.acres = Math.round(p.acresExact);
      p.habitat = tileHabitat(world, p.id);
      // a representative tile inside the parcel for labels
      let bi = -1, bd = 1e9;
      for (let y = p.minY; y <= p.maxY; y++) for (let x = p.minX; x <= p.maxX; x++) {
        const i = y * W + x; if (parcelOf[i] !== p.id) continue;
        const d = (x - p.cx) ** 2 + (y - p.cy) ** 2; if (d < bd) { bd = d; bi = i; }
      }
      p.labelX = bi % W; p.labelY = (bi / W) | 0;
    }
  }
  WT.recomputeParcelGeometry = recomputeParcelGeometry;

  /* Property stats are calculated from the actual tiles. */
  function tileHabitat(world, pid, extra) {
    const { W, H, parcelOf, cover, soil, gen, distRoad, distWater } = world;
    let n = 0, f = 0, b = 0, wt = 0, dw = 0, dr = 0, so = 0, ge = 0, sanct = 0;
    const counts = {};
    const sanctSet = extra && extra.sanctuary ? extra.sanctuary : null;
    // once the map is final, each parcel's tiles are listed once so this doesn't scan the whole map every time
    let list = null;
    if (world.ready) {
      if (!world._tilesOf) { world._tilesOf = {}; for (let i = 0; i < W * H; i++) { const q = parcelOf[i]; if (q >= 0) (world._tilesOf[q] = world._tilesOf[q] || []).push(i); } }
      list = world._tilesOf[pid] || [];
    }
    const count = list ? list.length : W * H;
    for (let k = 0; k < count; k++) {
      const i = list ? list[k] : k;
      if (parcelOf[i] !== pid) continue;
      const t = cover[i], c = COVER[t];
      n++; f += c.f; b += c.b; if (isWater(t) || t === T.SLOUGH) wt += t === T.SLOUGH ? 0.5 : 1;
      dw += Math.min(distWater[i], 40); dr += Math.min(distRoad[i], 14); so += soil[i]; ge += gen[i];
      counts[t] = (counts[t] || 0) + 1;
      if (sanctSet && sanctSet.has(i)) sanct++;
    }
    if (!n) return { food: 0, water: 0, bedding: 0, security: 0, soil: 0, genetics: 0, counts };
    const food = clamp((f / n) * 1.25 + 0.05);
    const bedding = clamp((b / n) * 1.45);
    const water = clamp(Math.max((wt / n) * 9, 1 - dw / n / 26));
    const sanctFrac = Math.min(C().sanctuary.maxShare, sanct / n); // past the cap, more sanctuary adds nothing
    const security = clamp((dr / n) / 14 * 0.7 + bedding * 0.25 + sanctFrac * 1.2 + (n > 600 ? 0.08 : 0));
    // hidden layers mapped to a 0..1 spread
    const soilQ = clamp((so / n - 0.3) / 0.4);
    const genetics = clamp((ge / n - 0.3) / 0.4);
    return { food, water, bedding, security, soil: soilQ, genetics, counts, tiles: n };
  }
  WT.tileHabitat = tileHabitat;

  function habitatQuality(h) {
    return clamp(h.food * 0.35 + h.bedding * 0.25 + h.water * 0.15 + h.security * 0.15 + h.soil * 0.10);
  }
  WT.habitatQuality = habitatQuality;

  function coverBreakdown(h) {
    const c = h.counts, n = h.tiles || 1, g = (...ts) => ts.reduce((a, t) => a + (c[t] || 0), 0) / n;
    return [
      ['Crop', g(T.CORN, T.SOY, T.WHEAT, T.SUNFLOWER)],
      ['Hay/pasture', g(T.HAY, T.PASTURE)],
      ['Grass/CRP', g(T.PRAIRIE)],
      ['Timber', g(T.TIMBER, T.BELT, T.BRUSH, T.YOUNGTREES)],
      ['Slough/water', g(T.SLOUGH, T.WATER, T.CREEK, T.POND)],
      ['Food plot', g(T.PLOT)],
      ['Farmstead', g(T.YARD)],
    ].filter((r) => r[1] > 0.005);
  }
  WT.coverBreakdown = coverBreakdown;

  /* ================================================================ STAND SPOT RATINGS (hidden) */
  const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  WT.DIRS = DIRS;
  // Where a spot is: the tile it is on, plus what touches it (its 8 neighbours).
  const landKind = (c) => (c === T.SLOUGH ? 'swamp' : c === T.CORN || c === T.SOY || c === T.SUNFLOWER ? 'farm' : c === T.TIMBER || c === T.BELT || c === T.BRUSH || c === T.YOUNGTREES ? 'timber' : isWater(c) ? 'water' : c === T.ROAD || c === T.TOWN || c === T.YARD ? 'road' : 'prairie');
  function spotSetting(world, x, y) {
    const { W, H, cover } = world, own = landKind(cover[y * W + x]), t = { timber: false, swamp: false, farm: false, water: false, plot: false };
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const c = cover[yy * W + xx], k = landKind(c);
      if (k in t) t[k] = true;
      if (c === T.PLOT || c === T.PLOT_NEW) t.plot = true;
    }
    if (cover[y * W + x] === T.PLOT || cover[y * W + x] === T.PLOT_NEW) t.plot = true;
    // the tile you stand on decides first; on open ground, the best thing you touch decides
    const id = own === 'swamp' ? 'swamp' : own === 'timber' ? (t.swamp ? 'swampEdge' : 'timber') : t.swamp ? 'swampEdge' : t.timber ? 'treeline' : t.farm ? 'fieldEdge' : t.water ? 'bank' : 'open';
    return { id, own, touching: t };
  }
  WT.spotSetting = spotSetting;

  function spotRatings(world, x, y) {
    const { W, H, cover, travel, distRoad } = world;
    let fW = 0, bW = 0, wW = 0, tot = 0, open = 0, openN = 0, tv = 0, tvN = 0, vx = 0, vy = 0, plotN = 0, swamp = 0, swN = 0, shW = 0, shN = 0;
    const R = 7;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const d = Math.hypot(dx, dy); if (d > R) continue;
      const i = yy * W + xx, c = COVER[cover[i]], wgt = 1 / (1 + d * 0.5);
      fW += c.f * wgt; bW += c.b * wgt; wW += c.w * wgt; tot += wgt;
      if (d <= 4) { open += 1 - c.c; openN++; }
      if (d <= 2.5) { tv += travel[i]; tvN++; }
      if (d <= 1.5 && cover[i] === T.PLOT) plotN++; // a grown plot on this tile or one touching it
      if (d <= 4) { swN++; if (cover[i] === T.SLOUGH) swamp++; }
      if (d <= 3) { shN++; if (isWater(cover[i])) shW++; }
      if (d > 0) { const pull = (c.f + c.b) * wgt; vx += (dx / d) * pull; vy += (dy / d) * pull; }
    }
    const food = clamp(fW / tot * 1.6), bed = clamp(bW / tot * 1.5), wat = clamp(wW / tot * 4);
    const trav = clamp(tv / Math.max(1, tvN));
    const depth = clamp(distRoad[y * W + x] / 14);
    const set = spotSetting(world, x, y), SS = C().land.settings[set.id], LW = C().land.water;
    // how far you see is mostly the setting (in the timber, on a tree line, out in the open), a little the country around
    const vis = clamp(SS.view * 0.75 + clamp(open / Math.max(1, openN) * 1.1) * 0.25);
    const shore = set.touching.water && set.own !== 'water' ? 1 : 0; // the bank only counts if your tile touches the water
    void swamp; void swN; void shW; void shN;
    const jit = (k) => (hash2(x, y, world.seed + k) - 0.5) * 0.18;
    const r = {
      morning: clamp(0.38 * bed + 0.34 * trav + 0.18 * depth + 0.1 * wat - 0.12 * Math.max(0, food - 0.7) + 0.08 + jit(1) + LW.shore * shore + (SS.morning || 0)),
      evening: clamp(0.5 * food + 0.3 * trav + 0.12 * wat + 0.05 + jit(2) + 0.08 * Math.min(1, plotN / 3) + LW.shore * shore + (SS.evening || 0)), // a grown food plot right at the stand is a destination
      rut: clamp(0.5 * trav + 0.3 * bed + 0.15 * food + 0.08 + jit(3) + LW.shore * shore + (SS.rut || 0)),
      mature: clamp(0.45 * trav + 0.3 * depth + 0.2 * bed - 0.15 * Math.max(0, vis - 0.7) + jit(4) + (SS.mature || 0) + LW.shoreMature * shore), // in the swamp: full; touching it: half
      water: wat,
      visibility: vis,
      shore, setting: set.id, touching: set.touching,
      accessImpact: clamp(0.25 + depth * 0.35 + bed * 0.35 + jit(5) * 0.5),
    };
    // deer come from the direction of the strongest pull; you want the wind blowing FROM there
    // (deer upwind of you). Wind named by where it blows from; screen y grows south.
    let ang = Math.atan2(vx, -vy); if (ang < 0) ang += Math.PI * 2;
    const di = Math.round(ang / (Math.PI / 4)) % 8;
    r.deerFrom = DIRS[di];
    r.goodWinds = [DIRS[(di + 7) % 8], DIRS[di], DIRS[(di + 1) % 8]];
    if (hash2(x, y, world.seed + 9) < 0.5) r.goodWinds.push(DIRS[(di + 2) % 8]); else r.goodWinds.push(DIRS[(di + 6) % 8]);
    return r;
  }
  WT.spotRatings = spotRatings;

  /* ================================================================ DEER */
  const D = () => C().deer;
  let deerSeq = 1;
  WT.setDeerSeq = (n) => { deerSeq = n; };
  WT.getDeerSeq = () => deerSeq;

  const ageKey = (age) => Math.min(D().maxAge, Math.max(0.5, Math.round(age * 2) / 2));
  function ageTable(tbl, age) {
    const k = ageKey(age);
    if (tbl[k] !== undefined) return tbl[k];
    const keys = Object.keys(tbl).map(Number).sort((a, b) => a - b);
    let v = tbl[keys[0]];
    for (const kk of keys) if (kk <= k) v = tbl[kk];
    return v;
  }
  WT.ageTable = ageTable;

  function rollPotential(rng, prop, momGp) {
    const g = D().genetics;
    const warm = Math.max(0, prop.geneG || 0), gm = C().deer.geneMap;
    let gp = rng.normal(g.mean + (prop.regionalGenetics - 0.5) * 2 * g.regionalShift + (prop.geneBonus || 0), g.sd * (1 + gm.tail * warm));
    if (momGp) gp += clamp((momGp - g.mean) / g.sd, -1.5, 1.5) * g.heredity;
    if (rng.chance(g.giantChance * (1 + gm.giant * warm))) gp += rng.range(g.giantBonus[0], g.giantBonus[1]);
    return clamp(gp, g.min, g.max);
  }

  function makeDeer(rng, sex, age, prop, momGp, momStyle) {
    const d = {
      id: deerSeq++, sex, age,
      gp: sex === 'b' ? rollPotential(rng, prop, momGp) : rollPotential(rng, prop, momGp), // does carry genes too (soft heredity)
      w: clamp(rng.normal(0.45, 0.18), 0.05, 0.95),
      cond: clamp(rng.normal(0.75, 0.1), 0.3, 1),
      tOP: 0.6,
      hist: [],
      bodyGene: WT.rollBodyGene ? WT.rollBodyGene(rng) : 0,
      style: WT.rollRackStyle ? WT.rollRackStyle(rng, momStyle) : null,
    };
    d.tOP = timeOnProperty(d, prop, rng);
    grow(d, prop, rng, 1);
    return d;
  }
  WT.makeDeer = makeDeer;

  function timeOnProperty(d, prop, rng) {
    // buck home ranges are much bigger than 100 acres
    const acres = prop.effectiveAcres || prop.acres;
    const sizeF = clamp(Math.log(acres / 40) / Math.log(1200 / 40), 0.05, 1);
    const base = d.sex === 'd' ? 0.55 + sizeF * 0.35 : 0.35 + sizeF * 0.5;
    return clamp(base + (prop.security - 0.5) * 0.25 + rng.range(-0.1, 0.1), 0.15, 0.95);
  }

  function nutritionFactor(prop) {
    const n = D().nutrition;
    const base = n.min + (n.max - n.min) * clamp((prop.food * 0.5 + prop.water * 0.2 + prop.soilQuality * 0.3 - 0.1) / 0.8);
    const over = Math.max(0, (prop.herd ? prop.herd.length : 0) / Math.max(1, prop.capacity) - 1);
    const fed = Math.min(base + (prop.plotNutrition || 0), Math.max(base, n.fedCap)); // plots bring poor ground up to decent; rich ground gains nothing
    return clamp(fed - over * n.overCapacityPenalty, 0.6, n.max);
  }
  WT.nutritionFactor = nutritionFactor;

  function grow(d, prop, rng, yearFactor) {
    const cfg = D();
    // weight
    const wt = cfg.weights[d.sex === 'b' ? 'buck' : 'doe'];
    const wr = ageTable(wt, d.age);
    const nf = nutritionFactor(prop);
    let lw = rng.range(wr[0], wr[1]) * (0.85 + 0.2 * nf / cfg.nutrition.max) * (0.9 + 0.1 * d.cond);
    if (d.sex === 'b' && d.age >= 4.5 && rng.chance(cfg.weights.bigBuckChance)) lw += rng.range(15, 45);
    if (d.age >= 8.5) lw *= 0.94;
    d.lw = Math.round(lw);
    if (d.sex !== 'b' || d.age < 1.5) { d.gross = 0; d.net = 0; d.pL = 0; d.pR = 0; d.nt = false; d.abn = 0; d.rack = null; return; }
    const curve = ageTable(cfg.ageCurve, d.age);
    const cf = Array.isArray(curve) ? rng.range(curve[0], curve[1]) : curve;
    const condF = 0.9 + 0.1 * d.cond;
    const L = C().landWork, G0 = cfg.genetics;
    const top = clamp((prop.plotNutrition || 0) / L.plotNutritionMax) * L.topEnd * clamp((d.gp - G0.mean) / G0.sd, 0, 3.5); // good groceries let the gifted ones show it
    // Antlers come from genetics and age. Feed decides how many deer the land holds, how heavy they are and whether they
    // stay home; it does not make a rack bigger or smaller, so every buck is grown on the same ordinary feed.
    const target = Math.max(d.age < 2 ? 12 : 25, d.gp * cf * (cfg.nutrition.antlers ?? nf + top) * yearFactor * condF);
    // The rack is built as B&C components + 3D geometry; the score is measured from it (antlers.js).
    if (!d.style) d.style = WT.rollRackStyle(rng);
    const { comp, sheet } = WT.growRack(d.style, d.age, target, rng);
    d.rack = WT.packRack(comp);
    d.gross = sheet.gross; d.net = sheet.net; d.nt = sheet.isNT; d.abn = sheet.abnormal;
    d.pL = sheet.pointsL; d.pR = sheet.pointsR;
  }
  WT.growDeer = grow;

  WT.deerPoints = (d) => (d.sex === 'b' && d.age >= 1.5 ? d.pL + d.pR : 0);
  WT.deerLabel = (d) => {
    if (d.sex === 'd') return d.age < 1 ? 'doe fawn' : 'doe';
    if (d.age < 1) return 'button buck';
    const p = WT.deerPoints(d);
    return p <= 2 ? 'spike' : `${p} pointer`;
  };

  /* ---------------------------------------------------------------- property model for deer */
  function propFromHabitat(base, h) {
    base.food = h.food; base.water = h.water; base.bedding = h.bedding; base.security = h.security;
    base.soilQuality = h.soil; base.regionalGenetics = h.genetics;
    return base;
  }
  WT.propFromHabitat = propFromHabitat;

  function carryingCapacity(prop) {
    const den = D().density;
    const hq = habitatQuality({ food: prop.food, bedding: prop.bedding, water: prop.water, security: prop.security, soil: prop.soilQuality });
    const per100 = den.poor + (den.elite - den.poor) * clamp((hq - 0.25) / 0.65);
    const land = 1 - ((prop.mix && prop.mix.water) || 0); // water holds no deer
    const fed = 1 + (prop.plotCapacity || 0); // planted food lets the same ground carry more deer
    return Math.max(2, Math.round((prop.acres * land / 100) * per100 * (1 + C().sanctuary.capacity * (prop.sanct || 0)) * (1 + C().land.timberCapacity * ((prop.mix && prop.mix.timber) || 0)) * fed)); // working sanctuary holds more deer
  }
  WT.carryingCapacity = carryingCapacity;

  function initHerd(prop, rng) {
    prop.capacity = carryingCapacity(prop);
    prop.herd = [];
    prop.huntingPressure = prop.type === 'public' ? (prop.pressFloor ?? (prop.bowOnly ? D().pressure.bowOnlyFloor : D().pressure.publicFloor)) : 0.05;
    const n = prop.capacity;
    for (let k = 0; k < n; k++) {
      const r = rng.next();
      let sex, age;
      if (r < 0.22) { sex = rng.chance(0.5) ? 'b' : 'd'; age = 0.5; }
      else if (r < 0.6) { sex = 'd'; age = rng.pick([1.5, 1.5, 2.5, 2.5, 3.5, 4.5, 5.5, 6.5]); }
      else { sex = 'b'; age = rng.pick([1.5, 1.5, 1.5, 2.5, 2.5, 3.5, 4.5, 5.5]); }
      prop.herd.push(makeDeer(rng, sex, age, prop));
    }
    // burn in so age structure and scores settle
    for (let y = 0; y < 6; y++) yearCycle(prop, rng, { winter: rng.range(0.2, 0.6), yearFactor: 1 + rng.range(-0.05, 0.05), seasonMortalityApplied: false });
  }
  WT.initHerd = initHerd;

  function annualMortality(d, prop) {
    const m = D().mortality;
    let base = ageTable(d.sex === 'b' ? m.buck : m.doe, d.age);
    if (Array.isArray(base)) base = (base[0] + base[1]) / 2;
    if (prop.type === 'public' && prop.bowOnly && !prop.publicBuck && d.age >= 1.5) { // old saves only
      if (d.sex === 'b') base *= D().bowOnlyBuckSurvival; // few hunters, short range: bucks grow old here
    } else if (prop.type === 'public' && d.age >= 1.5) {
      const pb = prop.publicBuck || m.publicBuck;
      // what hunters take here (set by how easy the ground is to reach), plus old age: past his prime a buck dies more each year whoever hunts him
      if (d.sex === 'b') base = (pb[0] + pb[1]) / 2 + Math.max(0, base - ageTable(m.buck, 4.5));
      else base *= prop.publicDoe ?? (prop.bowOnly ? 1.25 : 1.6);
    }
    // the map-wide balance (too many or too few deer) works on does and fawns: that is who overpopulates.
    // Antlered bucks are left out of it, or a crowd of does would get the bucks shot.
    let mult = (d.sex === 'b' && d.age >= 1.5 ? 1 : prop.harvestAdj || 1) * (prop.cropAdj || 1);
    mult *= 0.7 + 0.6 * (prop.neighborPressure ?? 0.5);
    /* Who pulls the trigger. Other hunters kill a buck in two steps. First one of them has to get a look at him: that
       depends on the ground (how many hunters reach it) and on the buck (an old buck moves less in daylight, and a wary
       one less still). Then that hunter has to want him: few will shoot a fork, nearly all will shoot a 150.
       The ground's set rate is what its reference buck faces; every other buck is worked out from there. */
    const hs = m.hunters;
    if (d.sex === 'b' && d.age >= 1.5 && hs) {
      const pick = (v) => { const t = hs.share; if (v <= t[0][0]) return t[0][1]; for (let k = 1; k < t.length; k++) if (v <= t[k][0]) return t[k - 1][1] + (t[k][1] - t[k - 1][1]) * (v - t[k - 1][0]) / (t[k][0] - t[k - 1][0]); return t[t.length - 1][1]; };
      const wary = (a) => ageTable(hs.wary, Math.min(a, 6.5));
      const priv = prop.type !== 'public';
      // the two kinds of neighbour bend the curve: some shoot the first buck they see, some pass anything young
      const want = (v) => { const sh = pick(v); return priv && prop.npcStyle === 'meat' ? hs.meat + (1 - hs.meat) * sh : priv && prop.npcStyle === 'manage' ? Math.pow(sh, hs.manage) : sh; };
      const prime = ageTable(m.buck, 4.5), oldAge = Math.max(0, ageTable(m.buck, d.age) - prime);
      const setKill = clamp((priv ? prime : base - oldAge) - hs.natural, 0, hs.maxKill);
      const ref = priv ? hs.refPrivate : hs.refPublic;                      // [score, age] of the buck the set rate is for
      const looks = -Math.log(1 - setKill) / (want(ref[0]) * wary(ref[1])); // hunters who get a look at a bold young buck here in a year
      const trait = clamp(1 + hs.trait * (0.45 - (d.w ?? 0.45)) / 0.18, 0.4, 1.6); // his own nature: the wary ones show themselves less
      base = hs.natural + (1 - Math.exp(-looks * wary(d.age) * trait * want(d.gross || 0))) + oldAge;
    }
    if (d.sex === 'b' && prop.type !== 'public') mult *= 1 + (0.6 - d.tOP) * 0.7;
    // Cover, water and swamp keep hunters off a deer. On public land that is already counted: thick, wet ground is hard
    // to walk into, so fewer hunters reach it. Counting it again here used to halve the death rate on timber and swamp
    // public land, so for public bucks the rate is what access sets and nothing else.
    const counted = d.sex === 'b' && d.age >= 1.5 && prop.type === 'public' && !!hs;
    if (!counted) {
      mult *= 1.12 - 0.25 * prop.security;
      if (d.sex === 'b' && d.age >= 2.5) mult *= clamp(1 - C().landWork.buckSurvival * (prop.security - 0.45), 0.6, 1.15); // safe ground is how a buck gets old
      if (prop.mix && d.age >= 1.5) mult *= 1 - C().land.water.barrier * Math.min(1, (prop.mix.shoreline || 0) / C().land.water.barrierFull); // nobody hunts the far bank
      if (d.sex === 'b' && d.age >= 3.5 && prop.mix) mult *= 1 - C().land.swampOldBucks * Math.min(1, prop.mix.swamp / C().land.swampFull); // old bucks live in the swamp
    }
    return clamp(base * mult, 0.02, 0.95);
  }
  WT.annualMortality = annualMortality;

  // Hazard during one in-season day (simulated neighbor hunters). Applies inSeasonShare of hunter mortality.
  function inSeasonDailyMortality(prop, rng, seasonDays) {
    const m = D().mortality;
    const died = [];
    prop.herd = prop.herd.filter((d) => {
      if (d.age < 1) return true;
      const annual = annualMortality(d, prop) * (d.sex === 'b' ? 1 : 0.5);
      const seasonP = annual * m.inSeasonShare;
      const daily = 1 - Math.pow(1 - seasonP, 1 / seasonDays);
      if (rng.chance(daily)) { died.push(d); return false; }
      return true;
    });
    return died;
  }
  WT.inSeasonDailyMortality = inSeasonDailyMortality;

  /* One full year after hunting season, in spec order. env: { winter (0..1 severity), yearFactor, seasonMortalityApplied, predatorYear, disease } */
  function yearCycle(prop, rng, env) {
    const cfg = D();
    const m = cfg.mortality;
    prop.capacity = carryingCapacity(prop);
    const log = { died: 0, winterDied: 0, born: 0, left: 0, arrived: 0, disease: false };
    // 2. post-season mortality
    const share = env.seasonMortalityApplied ? 1 - m.inSeasonShare : 1;
    prop.herd = prop.herd.filter((d) => {
      let p = annualMortality(d, prop);
      if (d.age >= 1) { if (d.sex === 'b' || prop.type === 'public') p *= share; else p *= env.seasonMortalityApplied ? 1 - m.inSeasonShare * 0.5 : 1; }
      if (rng.chance(p)) { log.died++; return false; }
      return true;
    });
    // 3. winter
    const over = Math.max(0, prop.herd.length / Math.max(1, prop.capacity) - 1);
    prop.herd = prop.herd.filter((d) => {
      let p = m.winterBase * (0.5 + env.winter) + m.winterSevere * Math.max(0, env.winter - 0.55) * 2;
      if (d.age < 1) p *= 1.8; if (d.age >= 8.5) p *= 1.6;
      p *= 1 + over * 1.5;
      p *= 1.3 - d.cond * 0.5;
      if (rng.chance(clamp(p, 0, 0.8))) { log.winterDied++; return false; }
      d.cond = clamp(nutritionFactor(prop) - env.winter * 0.25 + rng.range(-0.08, 0.08), 0.2, 1);
      return true;
    });
    // 4. random events
    if (env.disease ?? rng.chance(cfg.events.diseaseChance)) {
      const k = rng.span(cfg.events.diseaseKill);
      prop.herd = prop.herd.filter(() => !rng.chance(k));
      log.disease = true;
    }
    const predator = env.predatorYear ?? rng.chance(cfg.events.predatorYear);
    // aging happens here so new fawns are 0.5 at the coming season
    prop.herd.forEach((d) => { d.age += 1; });
    prop.herd = prop.herd.filter((d) => d.age <= cfg.maxAge + 0.01);
    // 5-6. fawning + summer survival
    const nf = nutritionFactor(prop);
    const density = prop.herd.length / Math.max(1, prop.capacity);
    const fawnSurv = (prop.fawnAdj || 1) * clamp(rng.span(cfg.fawning.survival) + (prop.bedding - 0.5) * 0.25 - (predator ? 0.15 : 0) - Math.max(0, density - 1) * 0.3, 0.15, 0.85);
    const newFawns = [];
    for (const d of prop.herd) {
      if (d.sex !== 'd' || d.age < 1.4) continue;
      const rate = (d.age < 2 ? rng.span(cfg.fawning.yearling) : rng.span(cfg.fawning.adult)) * (0.7 + 0.3 * nf / cfg.nutrition.max) * clamp(1.6 - density * 0.65, 0.25, 1.1);
      let n = Math.floor(rate); if (rng.chance(rate - n)) n++;
      for (let k = 0; k < n; k++) {
        if (!rng.chance(fawnSurv)) continue;
        const f = makeDeer(rng, rng.chance(0.5) ? 'b' : 'd', 0.5, prop, d.gp, d.style);
        f.mom = d.id; newFawns.push(f); log.born++;
      }
    }
    prop.herd.push(...newFawns);
    // 7. dispersal and movement
    const dispP = rng.span(cfg.dispersal.yearlingBuck) * (1 - C().sanctuary.holdBucks * (prop.sanct || 0)); // sanctuary keeps young bucks home
    let leaving = 0;
    prop.herd = prop.herd.filter((d) => {
      if (d.sex === 'b' && Math.abs(d.age - 1.5) < 0.01 && rng.chance(dispP)) { leaving++; log.left++; if (env.emigrants) env.emigrants.push(d); return false; }
      if (d.age >= 2.5 && prop.huntingPressure > 0.6 && rng.chance((prop.huntingPressure - 0.6) * 0.15 * (1 - 2 * (prop.sanct || 0)))) { log.left++; if (env.emigrants) env.emigrants.push(d); return false; }
      return true;
    });
    // young bucks from surrounding land arrive
    // stand-alone runs (calibration) invent arrivals; map-wide runs move real deer between parcels instead
    if (!env.world) {
      const arrivals = Math.round(leaving * rng.range(0.75, 1.25) + (prop.acres / 100) * rng.range(0, 0.8));
      for (let k = 0; k < arrivals; k++) { prop.herd.push(makeDeer(rng, 'b', 1.5, prop)); log.arrived++; }
    }
    const cap = prop.capacity;
    if (env.world) { /* density handled by worldYear */ } else if (prop.herd.length < cap * 0.85) {
      const need = Math.round((cap * 0.85 - prop.herd.length) * rng.range(0.3, 0.6));
      for (let k = 0; k < need; k++) { prop.herd.push(makeDeer(rng, rng.chance(0.55) ? 'd' : 'b', rng.pick([1.5, 1.5, 2.5, 2.5, 3.5]), prop)); log.arrived++; }
    } else if (prop.herd.length > cap * 1.25) {
      let extra = Math.round((prop.herd.length - cap * 1.15) * rng.range(0.4, 0.7));
      while (extra-- > 0 && prop.herd.length) {
        const cands = prop.herd.filter((d) => d.age < 3);
        const pool = cands.length ? cands : prop.herd;
        const v = rng.pick(pool);
        prop.herd.splice(prop.herd.indexOf(v), 1); log.left++;
      }
    }
    if (env.world && prop.herd.length > cap * 1.25) {
      let extra = Math.round((prop.herd.length - cap * 1.15) * rng.range(0.4, 0.7));
      while (extra-- > 0) { const cands = prop.herd.filter((d) => d.age >= 1 && d.age < 3); if (!cands.length) break; const v = rng.pick(cands); prop.herd.splice(prop.herd.indexOf(v), 1); env.emigrants.push(v); log.left++; }
    }
    // 8. growth (antlers regrow, weights update, time-on-property refresh)
    for (const d of prop.herd) {
      if (d.age >= 1.4 || d.hist.length === 0 || d.lw === undefined) {
        grow(d, prop, rng, env.yearFactor);
      }
      d.tOP = clamp(d.tOP * 0.6 + timeOnProperty(d, prop, rng) * 0.4, 0.1, 0.95);
      d.hist.push([d.age, d.gross, d.lw]);
      if (d.hist.length > 10) d.hist.shift();
    }
    // pressure relaxes over the off-season
    prop.huntingPressure = prop.type === 'public' ? (prop.pressFloor ?? (prop.bowOnly ? D().pressure.bowOnlyFloor : D().pressure.publicFloor)) : 0.05;
    return log;
  }
  WT.yearCycle = yearCycle;

  /* Whole-map year (deer spec section 10): every parcel runs its cycle, dispersers walk to real
     neighboring parcels, and a gentle stabilizer keeps the world total inside a target range.
     props: array of property objects with .id, .neighbors (array of ids), .capacity, .herd */
  function worldYear(props, rng, env, world) {
    const byId = new Map(props.map((p) => [p.id, p]));
    world = world || { adj: 1, drift: 0, fawn: 1 };
    world.fawn = world.fawn || 1;
    const emigrants = [];
    const logs = [];
    for (const p of props) {
      p.harvestAdj = world.adj; p.fawnAdj = world.fawn;
      const from = emigrants.length;
      logs.push(yearCycle(p, rng, Object.assign({}, env, { world: true, emigrants })));
      for (let k = from; k < emigrants.length; k++) emigrants[k]._from = p.id;
    }
    // dispersers settle 1-3 parcels away, pulled toward land with room
    let moved = 0, lost = 0;
    for (const d of emigrants) {
      let cur = byId.get(d._from), hops = rng.int(1, 3);
      for (let h = 0; h < hops && cur; h++) {
        const nbs = (cur.neighbors || []).map((id) => byId.get(id)).filter(Boolean);
        if (!nbs.length) break;
        const wts = nbs.map((q) => Math.max(0.05, 1.2 - q.herd.length / Math.max(1, q.capacity)));
        let r = rng.next() * wts.reduce((a, b) => a + b, 0);
        let k = 0; while (r > wts[k]) { r -= wts[k]; k++; }
        cur = nbs[Math.min(k, nbs.length - 1)];
      }
      delete d._from;
      if (!cur || rng.chance(0.08) || (cur.herd.length > cur.capacity * 1.5 && rng.chance(0.25))) { lost++; continue; } // hit by a car, left the map, no room
      d.tOP = 0.4;
      // dispersers left before the growth step, so they grow this year's rack on their new ground
      grow(d, cur, rng, env.yearFactor);
      d.hist.push([d.age, d.gross, d.lw]); if (d.hist.length > 10) d.hist.shift();
      cur.herd.push(d); moved++;
    }
    // edges of the map: a trickle of young deer wanders in where there's room
    const total = props.reduce((a, p) => a + p.herd.length, 0), cap = props.reduce((a, p) => a + p.capacity, 0);
    for (const p of props) {
      const room = p.capacity * 0.8 - p.herd.length;
      if (room > 0 && total < cap * 0.95 && rng.chance(0.5)) {
        const n = Math.round(room * rng.range(0.15, 0.35));
        for (let k = 0; k < n; k++) p.herd.push(makeDeer(rng, rng.chance(0.55) ? 'b' : 'd', rng.pick([1.5, 1.5, 2.5]), p));
      }
    }
    // stabilizer: nudge NPC harvest when the world drifts outside 0.8-1.15 of capacity for several years
    const ratio = total / Math.max(1, cap);
    world.drift = ratio > 1.1 ? Math.max(1, world.drift + 1) : ratio < 0.85 ? Math.min(-1, world.drift - 1) : 0;
    if (world.drift >= 2) { world.adj = Math.min(1.6, world.adj * 1.06); world.fawn = Math.max(0.6, world.fawn * 0.95); }
    else if (world.drift <= -2) { world.adj = Math.max(0.6, world.adj / 1.06); world.fawn = Math.min(1.25, world.fawn / 0.95); }
    else { world.adj += (1 - world.adj) * 0.1; world.fawn += (1 - world.fawn) * 0.1; }
    return { world, moved, lost, ratio, logs };
  }
  WT.worldYear = worldYear;

  /* ---------------------------------------------------------------- encounter math */
  // Per-sit chance that a deer shows in daylight within view.
  function sightingChance(d, ctx) {
    const s = D().sighting;
    // "Old deer are hard to see" is about bucks. Does and fawns are what you mostly see in daylight.
    const antlered = d.sex === 'b' && d.age >= 1.5;
    const ageM = antlered ? ageTable(s.ageMult, Math.min(d.age, 6.5)) : ageTable(s.doeMult || s.ageMult, Math.min(d.age, 4.5));
    let p = s.baseActivity * ageM * (1 - d.w * s.warinessK * (antlered ? 1 : 0.5));
    const pr = clamp(ctx.pressure || 0);
    if (antlered && d.age >= 3.5) p *= Math.exp(-s.pressureK * pr * (d.age >= 4.5 ? 1.4 : 1)); // mature bucks go nocturnal under pressure
    else p *= 1 - 0.45 * pr;
    const rut = ctx.rut || { buck: 1, mature: 1, doe: 1 };
    p *= d.sex === 'b' ? (d.age >= 3.5 ? rut.mature : rut.buck) : rut.doe;
    p *= ctx.weather || 1;
    p *= ctx.tod || 1;
    // stand placement: mature bucks care about the mature rating
    const place = d.sex === 'b' && d.age >= 3.5 ? (ctx.place * 0.4 + (ctx.matureRating ?? ctx.place) * 0.6) : ctx.place;
    p *= 0.4 + 1.2 * clamp(place ?? 0.5);
    p *= ctx.spotMult ?? 1;                                              // how good the stand is, and how good today is for it
    if (antlered && d.age >= 3.5) p *= ctx.matureMult ?? 1;               // old bucks show where the big-buck rating is high
    p *= d.tOP / 0.6;
    p *= ctx.viewShare ?? 1;
    const hrs = ctx.hours ?? 4;
    p = 1 - Math.pow(1 - clamp(p, 0, 0.95), hrs / 4);
    return clamp(p, 0, 0.97);
  }
  WT.sightingChance = sightingChance;
  WT.viewShare = (acres) => { const s = D().sighting; return clamp(Math.pow(s.viewAcres / Math.max(acres, 1), s.viewExp), 0.05, 1); };

  /* ---------------------------------------------------------------- estimates (player knowledge) */
  // Returns a fuzzy range for age and score, narrowed by judging skill and photo count.
  function estimate(d, judge, salt) {
    const j = clamp(judge / 100);
    const h = hash2(d.id, salt | 0, 77);
    const ageErr = (1 - j) * 1.6 + 0.4;
    const ageMid = d.age + (h - 0.5) * ageErr;
    const lo = Math.max(0.5, Math.floor(ageMid - ageErr / 2) + 0.5), hi = Math.max(lo, Math.floor(ageMid + ageErr / 2) + 0.5);
    let score = null;
    if (d.sex === 'b' && d.age >= 1.5) {
      const err = 6 + (1 - j) * 24;
      const mid = d.gross + (hash2(d.id, salt | 0, 78) - 0.5) * err;
      score = [Math.max(10, Math.round((mid - err / 2) / 5) * 5), Math.round((mid + err / 2) / 5) * 5];
      if (score[1] <= score[0]) score[1] = score[0] + 5;
    }
    return { age: [lo, hi], score };
  }
  WT.estimate = estimate;

  // Pay follows size along a curve: antler inches for bucks, live weight for does.
  const payCurve = (pts, v) => {
    if (v <= pts[0][0]) return pts[0][1];
    for (let k = 1; k < pts.length; k++) if (v <= pts[k][0]) { const a = pts[k - 1], b = pts[k]; return a[1] + (b[1] - a[1]) * (v - a[0]) / (b[0] - a[0]); }
    return pts[pts.length - 1][1];
  };
  WT.payoutFor = function (d) {
    const e = C().economy;
    if (d.age < 1) return e.fawnPay;                                             // fawns and button bucks
    if (d.sex === 'd') return Math.round(payCurve(e.doePay, d.lw || 110) / 5) * 5;
    return Math.round(payCurve(e.buckPay, d.gross || 0) / 5) * 5;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
