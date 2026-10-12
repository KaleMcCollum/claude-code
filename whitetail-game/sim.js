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
  COVER[T.PLOT_NEW] =  { f: 0.1,  b: 0,    w: 0,   c: 0,   name: 'New food plot (grows in next year)' };
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

  function genWorld(seed) {
    const cfg = C().world;
    const W = cfg.width, H = cfg.height, N = W * H;
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
    const creekCount = rng.int(3, 5);
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
    const road = new Uint8Array(N);
    vRoads.forEach((rx, k) => {
      const broken = rng.chance(0.35) ? [rng.int(10, H - 40), 0] : null;
      if (broken) broken[1] = broken[0] + rng.int(15, 35);
      for (let y = 0; y < H; y++) {
        if (broken && y > broken[0] && y < broken[1]) continue;
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
    for (let k = 0; k < 26; k++) {
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

    const world = { seed, W, H, cover, elev, soil, gen, moist, towns, farmsteads, riverPath };
    computeDerivedLayers(world);
    genParcels(world, rng);
    return world;
  }
  WT.genWorld = genWorld;

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
    for (let tries = 0; tries < 6000; tries++) {
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
    for (const p of order) {
      if (publicTiles > totalTiles * cfg.publicShare) break;
      if (p.merged || p.owner) continue;
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
    }
    // starter parcel: NPC land nearest 100 acres with average-ish habitat, away from town
    const town = world.towns[0];
    let best = null, bestScore = 1e9;
    for (const p of world.parcels) {
      if (p.owner !== 'npc') continue;
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
    for (let i = 0; i < W * H; i++) {
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
    const sanctFrac = sanct / n;
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
  function spotRatings(world, x, y) {
    const { W, H, cover, travel, distRoad } = world;
    let fW = 0, bW = 0, wW = 0, tot = 0, open = 0, openN = 0, tv = 0, tvN = 0, vx = 0, vy = 0;
    const R = 7;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const d = Math.hypot(dx, dy); if (d > R) continue;
      const i = yy * W + xx, c = COVER[cover[i]], wgt = 1 / (1 + d * 0.5);
      fW += c.f * wgt; bW += c.b * wgt; wW += c.w * wgt; tot += wgt;
      if (d <= 4) { open += 1 - c.c; openN++; }
      if (d <= 2.5) { tv += travel[i]; tvN++; }
      if (d > 0) { const pull = (c.f + c.b) * wgt; vx += (dx / d) * pull; vy += (dy / d) * pull; }
    }
    const food = clamp(fW / tot * 1.6), bed = clamp(bW / tot * 1.5), wat = clamp(wW / tot * 4);
    const trav = clamp(tv / Math.max(1, tvN));
    const depth = clamp(distRoad[y * W + x] / 14);
    const vis = clamp(open / Math.max(1, openN) * 1.1);
    const jit = (k) => (hash2(x, y, world.seed + k) - 0.5) * 0.18;
    const r = {
      morning: clamp(0.38 * bed + 0.34 * trav + 0.18 * depth + 0.1 * wat - 0.12 * Math.max(0, food - 0.7) + 0.08 + jit(1)),
      evening: clamp(0.5 * food + 0.3 * trav + 0.12 * wat + 0.05 + jit(2)),
      rut: clamp(0.5 * trav + 0.3 * bed + 0.15 * food + 0.08 + jit(3)),
      mature: clamp(0.45 * trav + 0.3 * depth + 0.2 * bed - 0.15 * Math.max(0, vis - 0.7) + jit(4)),
      water: wat,
      visibility: vis,
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
    let gp = rng.normal(g.mean + (prop.regionalGenetics - 0.5) * 2 * g.regionalShift, g.sd);
    if (momGp) gp += clamp((momGp - g.mean) / g.sd, -1.5, 1.5) * g.heredity;
    if (rng.chance(g.giantChance)) gp += rng.range(g.giantBonus[0], g.giantBonus[1]);
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
    return clamp(base - over * n.overCapacityPenalty, 0.6, n.max);
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
    const target = Math.max(d.age < 2 ? 12 : 25, d.gp * cf * nf * yearFactor * condF);
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
    return Math.max(2, Math.round((prop.acres / 100) * per100));
  }
  WT.carryingCapacity = carryingCapacity;

  function initHerd(prop, rng) {
    prop.capacity = carryingCapacity(prop);
    prop.herd = [];
    prop.huntingPressure = prop.type === 'public' ? D().pressure.publicFloor : 0.05;
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
    if (prop.type === 'public' && d.age >= 1.5) {
      if (d.sex === 'b') base = (m.publicBuck[0] + m.publicBuck[1]) / 2 + (d.age >= 4.5 ? 0.04 : 0);
      else base *= 1.6;
    }
    let mult = prop.harvestAdj || 1;
    mult *= 0.7 + 0.6 * (prop.neighborPressure ?? 0.5);
    // NPC hunters: 'meat' hunters shoot the first buck they see, 'manage' hunters pass young bucks
    if (d.sex === 'b' && prop.npcStyle === 'meat') mult *= d.age <= 2.5 ? 1.25 : 0.95;
    if (d.sex === 'b' && prop.npcStyle === 'manage') mult *= d.age <= 2.5 ? 0.6 : d.age >= 4.5 ? 1.2 : 0.9;
    if (d.sex === 'b' && prop.type !== 'public') mult *= 1 + (0.6 - d.tOP) * 0.7;
    mult *= 1.12 - 0.25 * prop.security;
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
    const dispP = rng.span(cfg.dispersal.yearlingBuck);
    let leaving = 0;
    prop.herd = prop.herd.filter((d) => {
      if (d.sex === 'b' && Math.abs(d.age - 1.5) < 0.01 && rng.chance(dispP)) { leaving++; log.left++; if (env.emigrants) env.emigrants.push(d); return false; }
      if (d.age >= 2.5 && prop.huntingPressure > 0.6 && rng.chance((prop.huntingPressure - 0.6) * 0.15)) { log.left++; if (env.emigrants) env.emigrants.push(d); return false; }
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
    prop.huntingPressure = prop.type === 'public' ? D().pressure.publicFloor : 0.05;
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
      if (!cur || rng.chance(0.08) || (cur.herd.length > cur.capacity * 1.2 && rng.chance(0.6))) { lost++; continue; } // hit by a car, left the map, no room
      d.tOP = 0.4;
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
    if (world.drift >= 2) { world.adj = Math.min(1.5, world.adj * 1.06); world.fawn = Math.max(0.7, world.fawn * 0.95); }
    else if (world.drift <= -2) { world.adj = Math.max(0.6, world.adj / 1.06); world.fawn = Math.min(1.25, world.fawn / 0.95); }
    else { world.adj += (1 - world.adj) * 0.1; world.fawn += (1 - world.fawn) * 0.1; }
    return { world, moved, lost, ratio, logs };
  }
  WT.worldYear = worldYear;

  /* ---------------------------------------------------------------- encounter math */
  // Per-sit chance that a deer shows in daylight within view.
  function sightingChance(d, ctx) {
    const s = D().sighting;
    const ageM = ageTable(s.ageMult, Math.min(d.age, 6.5));
    let p = s.baseActivity * ageM * (1 - d.w * s.warinessK);
    const pr = clamp(ctx.pressure || 0);
    if (d.age >= 3.5) p *= Math.exp(-s.pressureK * pr * (d.age >= 4.5 ? 1.4 : 1));
    else p *= 1 - 0.45 * pr;
    const rut = ctx.rut || { buck: 1, mature: 1, doe: 1 };
    p *= d.sex === 'b' ? (d.age >= 3.5 ? rut.mature : rut.buck) : rut.doe;
    p *= ctx.weather || 1;
    p *= ctx.tod || 1;
    // stand placement: mature bucks care about the mature rating
    const place = d.sex === 'b' && d.age >= 3.5 ? (ctx.place * 0.4 + (ctx.matureRating ?? ctx.place) * 0.6) : ctx.place;
    p *= 0.4 + 1.2 * clamp(place ?? 0.5);
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

  WT.payoutFor = function (d, rng) {
    const e = C().economy;
    if (d.sex === 'd') return e.doePayout;
    if (d.age < 1) return Math.round(e.doePayout * 0.8);
    const g = d.gross;
    for (const b of e.payouts) {
      if (g >= b.min && g < b.max) {
        if (b.young) return d.age <= 2.5 ? Math.round(rng ? rng.range(b.young[0], b.young[1]) : (b.young[0] + b.young[1]) / 2) : e.oldBuckUnder120;
        return b.pay;
      }
    }
    return e.doePayout;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
