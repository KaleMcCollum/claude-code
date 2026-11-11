/* Whitetail Country: deer art.
   Every deer is drawn front-facing as pixel art in the style of art/style-reference.png:
   one hand-drawn face shared by all deer, a few bodies by age and size, and antlers drawn in 2D
   straight from the buck's real rack components (the same numbers the score sheet is measured from),
   so a 9 pointer shows 9 points. Pure JS, outputs RGBA buffers (browser and Node).

   Levels of detail: LOD 0 is the full-size sprite (2.6 px per inch, like the reference);
   each LOD after that is half the size. Far deer and weak optics use smaller LODs. */
(function (root) {
  const WT = (root.WT = root.WT || {});
  const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const PPI0 = 2.6;
  WT.ART_PPI = PPI0;

  /* ---------------------------------------------------------------- palette (sampled from the reference) */
  const K = { NONE: 0, HL: 1, HM: 2, HD: 3, HDD: 4, CREAM: 5, CREAMD: 6, EARW: 7, EARP: 8, LINE: 9, CROWN: 10, TUFT: 11, BRIDGE: 12, EYE: 13, RING: 14, MUZ: 15, NOSE: 16, AL: 17, AM: 18, AS: 19, AD: 20, ADD: 21, HOOF: 22, SPOT: 23 };
  const RGB = [];
  RGB[K.HL] = hex('#b29881'); RGB[K.HM] = hex('#9b7f6a'); RGB[K.HD] = hex('#7e6656'); RGB[K.HDD] = hex('#66513f');
  RGB[K.CREAM] = hex('#ede1d1'); RGB[K.CREAMD] = hex('#d6c8b4');
  RGB[K.EARW] = hex('#e3e3e3'); RGB[K.EARP] = hex('#a48f98'); RGB[K.LINE] = hex('#2d170c');
  RGB[K.CROWN] = hex('#461914'); RGB[K.TUFT] = hex('#553936'); RGB[K.BRIDGE] = hex('#675762');
  RGB[K.EYE] = hex('#1a0e10'); RGB[K.RING] = hex('#ede1d1'); RGB[K.MUZ] = hex('#bfb8ca'); RGB[K.NOSE] = hex('#322f42');
  RGB[K.AL] = hex('#b29881'); RGB[K.AM] = hex('#715842'); RGB[K.AS] = hex('#664937'); RGB[K.AD] = hex('#3c2013'); RGB[K.ADD] = hex('#2d170c');
  RGB[K.HOOF] = hex('#2d170c'); RGB[K.SPOT] = hex('#e3d6c4');
  WT.ART_K = K; WT.ART_RGB = RGB;
  const isAntler = (c) => c >= K.AL && c <= K.ADD;

  /* ---------------------------------------------------------------- the face (hand-drawn, left half; mirrored) */
  const CH = { '.': 0, o: K.LINE, w: K.EARW, p: K.EARP, h: K.HL, m: K.HM, s: K.HD, C: K.CROWN, t: K.TUFT, b: K.BRIDGE, e: K.EYE, r: K.RING, z: K.MUZ, n: K.NOSE, k: K.EYE, c: K.CREAM };
  const EAR_CH = 'owp';
  // LOD 0: 24 columns per half (ear 0-11, head 12-23), crown top on row 2.
  const FACE0 = [
    '....oooo................',
    '..ooowwoooo.............',
    '..owwwwwwooo.....CCCCCCC',
    '..owpwwwwwwooo.hCCCCCCCC',
    '..owppwwwwwwwohhCCCCCCCC',
    '..oowpppwwwwwwhhrCCCCCCt',
    '...oowwpppwwwwhrrrCCCttt',
    '....oowwwpppwwhrrrrhtttt',
    '......ooowwppphreeerhbbb',
    '........ooooowhrreeehbbb',
    '.............hhhrreehbbb',
    '.............hhhhrrhhbbb',
    '.............hhhhhhhhbbb',
    '.............hhhhhhhhbbb',
    '..............hhhhhhzzzz',
    '..............hhhhhhzzzn',
    '..............hhhhhzzznn',
    '..............mhhhhznknn',
    '..............mmhhhznnkk',
    '...............mhhhzznnk',
    '...............mmhhzzznn',
    '...............mmhhzzzzz',
    '................mmhhzzkk',
    '................mmmhzzzz',
    '.................mmmczzz',
  ];
  // LOD 1: half size (12 columns per half), crown top on row 1.
  const FACE1 = [
    '.ooo........',
    'owwwoo...CCC',
    '.wpwwwohCCCC',
    '..wwppwhrCCt',
    '....wwhrertb',
    '......hhrrhb',
    '......hhhhhb',
    '.......hhhzz',
    '.......hhznn',
    '.......mhzzn',
    '.......mhzzz',
    '........mzzk',
    '........mmzz',
  ];
  // LOD 2: quarter size (6 columns per half), crown top on row 1.
  const FACE2 = [
    '.o....',
    'owwCCC',
    '..wheC',
    '...hhb',
    '...hzz',
    '...mzn',
    '....zz',
  ];
  const FACES = [
    { half: FACE0, crown: 2, pedX: 6.5, pedY: -1.6, eyeRow: 8 },
    { half: FACE1, crown: 1, pedX: 3.2, pedY: -0.6, eyeRow: 4 },
    { half: FACE2, crown: 1, pedX: 1.6, pedY: 0, eyeRow: 2 },
  ];
  // Slimmer faces for younger deer: drop columns (from the cheek) and muzzle rows from the mature face.
  function slimHalf(half, dropCols, dropRows) {
    return half.filter((_, r) => !dropRows.includes(r)).map((row) => row.split('').filter((_, c) => !dropCols.includes(c)).join(''));
  }
  const VARIANT = {
    // [dropCols, dropRows] per LOD
    mature: [[[], []], [[], []], [[], []]],
    adult: [[[14], []], [[], []], [[], []]],
    young: [[[14, 19], [13]], [[7], []], [[], []]],
    fawn: [[[14, 19], [12, 13, 20]], [[7], [6]], [[], [3]]],
  };
  const faceCache = {};
  function faceFor(lod, variant, kind, down) {
    const key = lod + variant + kind + (down ? 'd' : '');
    if (faceCache[key]) return faceCache[key];
    const F = FACES[lod];
    const [dc, dr] = VARIANT[variant][lod];
    let half = slimHalf(F.half, dc, dr);
    // head down (feeding): you see the crown, ears and eyes; the muzzle is foreshortened away
    if (down) half = half.slice(0, F.eyeRow + (lod === 0 ? 5 : lod === 1 ? 3 : 2));
    const hw = half[0].length;
    const rows = half.map((row) => row + row.split('').reverse().join(''));
    const ear = [], face = [];
    for (const row of rows) {
      const e = new Uint8Array(row.length), f = new Uint8Array(row.length);
      for (let i = 0; i < row.length; i++) {
        let ch = row[i];
        // does and fawns have no dark rutty crown
        if (kind !== 'buck' && ch === 'C') ch = 't';
        if (kind === 'fawn' && ch === 't') ch = 's';
        if (EAR_CH.includes(ch)) e[i] = CH[ch]; else f[i] = CH[ch];
      }
      ear.push(e); face.push(f);
    }
    return (faceCache[key] = { ear, face, hw, crown: F.crown, pedX: F.pedX - dc.filter((c) => c >= 17).length, pedY: F.pedY, rows: rows.length });
  }

  /* ---------------------------------------------------------------- bodies (inches, front view) */
  // Three buck bodies by age and size, plus doe and fawn.
  const BODY = {
    fawn: { sh: 27, chestW: 8, chestH: 10.5, neckW: 4.4, legW: 1.5, headUp: 10.5, face: 'fawn' },
    slim: { sh: 34, chestW: 10, chestH: 13.5, neckW: 5.8, legW: 1.9, headUp: 13, face: 'young' },
    doe: { sh: 35, chestW: 11, chestH: 14.5, neckW: 6, legW: 1.9, headUp: 13, face: 'adult' },
    medium: { sh: 37, chestW: 12.5, chestH: 16, neckW: 7.8, legW: 2.2, headUp: 13.5, face: 'adult' },
    heavy: { sh: 40, chestW: 15, chestH: 19, neckW: 10.4, legW: 2.5, headUp: 14, face: 'mature' },
  };
  WT.ART_BODY = BODY;
  WT.deerLook = function (deer, day) {
    const antlered = deer.sex === 'b' && deer.age >= 1.5;
    const kind = antlered ? 'buck' : deer.age < 1 ? 'fawn' : 'doe';
    let body;
    if (deer.age < 1) body = 'fawn';
    else if (deer.sex === 'd') body = deer.age < 2 ? 'slim' : 'doe';
    else body = deer.age < 2 ? 'slim' : deer.age < 4 ? 'medium' : 'heavy';
    const B = BODY[body];
    // necks swell in the rut and are thinner early season (bucks only)
    const rut = antlered && WT.rutNeck ? WT.rutNeck(day) : 1;
    return { kind, body, B, face: kind === 'doe' && body === 'slim' ? 'young' : B.face, neckW: B.neckW * (body === 'heavy' ? 0.82 + 0.18 * (rut - 0.86) / 0.14 : 1), button: deer.sex === 'b' && deer.age < 1 };
  };

  /* ---------------------------------------------------------------- pixel buffer */
  function Buf(W, H) { this.W = W; this.H = H; this.c = new Uint8Array(W * H); }
  Buf.prototype.set = function (x, y, c) { if (x >= 0 && y >= 0 && x < this.W && y < this.H) this.c[y * this.W + x] = c; };
  Buf.prototype.get = function (x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H ? this.c[y * this.W + x] : 0; };
  Buf.prototype.rect = function (x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, typeof c === 'function' ? c(x, y) : c); };
  // ellipse with banded shading: light upper-left, dark lower-right
  Buf.prototype.ellipse = function (cx, cy, rx, ry, cols) {
    const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx), y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / Math.max(0.5, rx), dy = (y + 0.5 - cy) / Math.max(0.5, ry);
      if (dx * dx + dy * dy > 1) continue;
      if (typeof cols === 'number') { this.set(x, y, cols); continue; }
      const l = -dx * 0.55 - dy * 0.6;
      this.set(x, y, l > 0.42 ? cols[0] : l < -0.5 ? cols[2] : cols[1]);
    }
  };

  /* ---------------------------------------------------------------- antlers: look genes */
  // Stable per buck: the same style every year, derived from his rack style seed.
  WT.rackLook = function (style) {
    const r = WT.makeRng(((style && style.seed) | 0) + 7717);
    const s = style || {};
    const jit = []; for (let i = 0; i < 12; i++) jit.push(r.range(-1, 1));
    return {
      rise: clamp(18 + r.next() * 18 + ((s.tall || 1) - 1) * 40, 12, 42),   // how steeply the beam leaves the head (deg)
      hold: 0.15 + r.next() * 0.4,                                          // how long the beam stays shallow before it turns up
      curl: 3 + (s.curl ?? 0.7) * 8.5 * r.range(0.6, 1.2),                   // inward lean of the upper beam (deg)
      proj: 0.76 + r.next() * 0.08,                                         // how much of the beam length shows from the front
      tineDelta: r.range(-1.5, 4) + (s.lean ?? 0) * 1.5,                    // tines lean a touch more or less than the beam
      tineCurve: r.range(-2, 5),                                            // extra inward bend along each tine (deg)
      fan: r.range(-1, 1.2),                                                // outer tines lean a little more or less
      browLean: r.range(-5, 9), browOut: 0.45 + r.next() * 0.7, cluster: r.next(), jit,
      arc: 8 + r.next() * 10,          // how far the upper beam and the tines curve in toward their tips (deg)
      tineArc: r.range(0.75, 1.1),     // tines arc a little more or less than the beam
    };
  };

  /* ---------------------------------------------------------------- antlers: geometry in inches (per side, +x = outward, +y = up) */
  const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
  const X0 = 2.4; // pedicle center, inches from the midline
  const RAD = Math.PI / 180;
  // The main beam from the front: an outward sweep to the widest point, then a rise that leans back in.
  function beamPath(beamLen, halfW, look) {
    const L2 = beamLen * look.proj;
    const run = Math.max(0.3, halfW - X0);
    const NA = 26, NB = 18;
    let th0 = look.rise * RAD, ux, uy, lenA;
    for (let attempt = 0; attempt < 7; attempt++) {
      ux = [0]; uy = [0];
      for (let i = 0; i < NA; i++) {
        const s = (i + 0.5) / NA;
        const h = th0 + (Math.PI / 2 - th0) * smooth((s - look.hold) / (1 - look.hold));
        ux.push(ux[i] + Math.cos(h) / NA); uy.push(uy[i] + Math.sin(h) / NA);
      }
      lenA = run / ux[NA];
      if (lenA <= L2 * 0.78 || th0 < 0.12) break;
      th0 *= 0.72; // too wide for its length: flatten the sweep
    }
    const pts = [];
    for (let i = 0; i <= NA; i++) pts.push([X0 + ux[i] * lenA, uy[i] * lenA]);
    const LB = Math.max(L2 - lenA, L2 * 0.22, 0.8);
    // small racks (spikes, forks) stand up and a little out; bigger frames lean back in
    let lean = look.curl * 0.55 - Math.max(0, 2.6 - run) * 9;
    let arc = (look.arc ?? 14) * (run < 2.6 ? 0.55 : 1);
    const top = pts[NA];
    // rises close to vertical, then arcs in toward the tip; never so far that the tips cross
    const minX = Math.max(X0 * 0.9, halfW * 0.6);
    let rise = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      rise = [];
      let p = top;
      for (let i = 0; i < NB; i++) {
        const s = (i + 0.5) / NB;
        const a = (90 + lean * smooth(s / 0.5) + arc * Math.pow(s, 1.7)) * RAD;
        p = [p[0] + Math.cos(a) * LB / NB, p[1] + Math.sin(a) * LB / NB];
        rise.push(p);
      }
      if (rise[NB - 1][0] >= minX) break;
      lean *= 0.55; arc *= 0.72;
    }
    pts.push(...rise);
    const heading = [];
    for (let i = 0; i < pts.length - 1; i++) heading.push(Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]));
    heading.push(heading[heading.length - 1]);
    return { pts, heading, len: lenA + LB, lenA, lean, arc, run };
  }
  const plen = (pts) => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };
  function pointAt(path, dist) {
    const { pts, heading } = path;
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc + seg >= dist) { const t = (dist - acc) / (seg || 1); return { p: [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t], h: heading[i - 1], s: (acc + seg * t) / path.len, i }; }
      acc += seg;
    }
    return { p: pts[pts.length - 1], h: heading[heading.length - 1], s: 1, i: pts.length - 1 };
  }
  function distAtX(path, x) {
    const { pts } = path;
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (pts[i][0] >= x) { const t = clamp((x - pts[i - 1][0]) / Math.max(1e-6, pts[i][0] - pts[i - 1][0])); return acc + seg * t; }
      acc += seg;
      if (acc >= path.lenA) return path.lenA;
    }
    return acc;
  }
  // A point (tine, brow, sticker...) as a gently curving line: angle in degrees from "straight out", 90 = straight up.
  function spur(base, ang0, curve, len, n = 10, ease = 1.6) {
    const pts = [base];
    let p = base;
    for (let k = 0; k < n; k++) {
      const a = (ang0 + curve * Math.pow((k + 0.5) / n, ease)) * RAD;
      p = [p[0] + Math.cos(a) * len / n, p[1] + Math.sin(a) * len / n];
      pts.push(p);
    }
    return pts;
  }

  /* Which points a rack has, exactly as the score sheet counts them. */
  WT.rackPointList = function (comp) {
    return comp.sides.map((S, si) => {
      const typical = S.names.filter((n) => (S.tines[n] || 0) >= 1);
      const abn = comp.abn.filter((a) => a.side === si && a.len >= 1 && (!a.on || a.on === 'beam' || typical.includes(a.on)));
      return { typical, abn, points: 1 + typical.length + abn.length };
    });
  };

  /* Lay out one side in inches. Each element has candidates(): alternative lines to try so it stands clear. */
  function layoutSide(comp, si, look) {
    const S = comp.sides[si];
    const list = WT.rackPointList(comp)[si];
    const H = S.H;
    const halfW = comp.spread / 2 + (H[2] / Math.PI) * 0.5 + 0.2;
    const beam = beamPath(S.beam, halfW, look);
    const els = [];
    const beamW = [H[0] / Math.PI * 1.2, H[1] / Math.PI, H[2] / Math.PI * 0.95, H[3] / Math.PI * 0.9];
    els.push({ kind: 'beam', name: 'beam', pts: beam.pts, wProfile: beamW, len: beam.len, tA: beam.lenA / beam.len });
    const jit = (k) => look.jit[(k + si * 5) % look.jit.length];
    const massF = clamp(H[1] / 4.2, 0.75, 1.15);
    // brow tine: straight up off the base, like the reference
    if (list.typical.includes('G1')) {
      const len = S.tines.G1;
      const a0 = 90 + look.browLean + jit(0) * 3;
      const make = (dOut, dAng) => { const at = pointAt(beam, clamp(look.browOut + dOut, 0.15, beam.len * 0.25)); return spur([at.p[0], at.p[1] + beamW[0] * 0.3], a0 + dAng - 3, 11 * clamp(len / 5, 0.4, 1.2), len); };
      els.push({ kind: 'brow', name: 'G1', w0: clamp(0.62 + len * 0.06, 0.7, 1.15) * massF, len, candidates: () => [[0, 0], [0, 6], [-0.25, 4], [0, 12], [-0.25, 12], [0, -6], [0, 18], [-0.3, 20], [0.4, 0], [-0.35, 26]].map(([o, a]) => make(o, a)) });
    }
    // the other typical tines, plus "extra" upright abnormal points, stand along the outer sweep of the beam
    const order = list.typical.filter((n) => n !== 'G1').map((n) => ({ name: n, len: S.tines[n], typical: true }));
    list.abn.filter((a) => a.type === 'extra').forEach((a) => { const k = clamp(Math.round((a.u - 0.3) / 0.5 * order.length), 0, order.length); order.splice(k, 0, { name: 'extra', len: a.len }); });
    const n = order.length;
    const steepRack = beam.run < 2.3; // spikes and forks: hardly any sweep, so points branch off the rising beam
    const thickOf = (u) => clamp(0.72 + u.len * 0.045, 0.8, 1.2) * massF * (u.typical ? 1 : 0.75);
    // spacing: even across the outer sweep, but never closer than the tines are thick (plus a pixel of daylight)
    const fOut = 0.9, fIn = n <= 1 ? 0 : clamp(0.62 - 0.1 * (n - 2) - look.cluster * 0.1, 0.25, 0.68);
    const pref = n > 1 ? beam.run * (fOut - fIn) / (n - 1) : 0;
    const xs = [];
    let squeeze = 1;
    for (let pass = 0; pass < 2; pass++) {
      let x = halfW - (beamW[2] / 2 + thickOf(order[n - 1] || { len: 4, typical: true }) * squeeze / 2 + 1.5 / PPI0);
      for (let j = n - 1; j >= 0; j--) {
        xs[j] = x;
        if (j > 0) x -= Math.max(Math.min(pref, 2.2), (thickOf(order[j]) + thickOf(order[j - 1])) * squeeze * 0.5 + 1.5 / PPI0);
      }
      const xMin = X0 + Math.min(1.5, beam.run * 0.25);
      if (n < 2 || xs[0] >= xMin) break;
      squeeze = clamp((xs[n - 1] - xMin) / Math.max(0.1, xs[n - 1] - xs[0]), 0.45, 1); // crowded racks: slimmer tines, tighter spacing
    }
    if (n === 1) xs[0] = Math.min(xs[0], X0 + beam.run * (0.56 + look.cluster * 0.26));
    // tines are placed from the outside in, so each one can step clear of the last
    for (let j = n - 1; j >= 0; j--) {
      const u = order[j];
      const thick = thickOf(u) * (squeeze < 1 ? 0.5 + squeeze * 0.5 : 1);
      const lean0 = clamp(beam.lean * 0.6 + clamp(look.tineDelta, -1.5, 3) + look.fan * (j - (n - 1) / 2) + jit(j + 1) * 1.2, -5, 9); // the base of a tine stands near parallel to the beam's rise
      const curve = (beam.arc * (look.tineArc ?? 1) + jit(j + 5) * 1.5) * clamp(u.len / 9, 0.35, 1); // long tines show the arc most
      const make = (dIn, dAng) => {
        let dist;
        if (steepRack) dist = beam.len * clamp(0.4 + 0.36 * (n === 1 ? 0.4 : j / (n - 1)) - dIn * 0.05, 0.25, 0.82);
        else dist = distAtX(beam, Math.max(X0 + 0.7, xs[n - 1] - (xs[n - 1] - xs[j]) * (squeeze < 1 ? squeeze : 1) - dIn));
        const at = pointAt(beam, dist);
        const hd = at.h / RAD;
        let ang = 90 + lean0 + dAng;
        if (hd > 58) ang = Math.max(ang, Math.min(90 + lean0 + 16 + dAng, hd + 20)); // branch inward off a rising beam
        return spur([at.p[0], at.p[1] + beamW[1] * 0.25], ang, curve, u.len);
      };
      els.push({ kind: u.typical ? 'tine' : 'abn', name: u.name, w0: thick, len: u.len, order: j,
        candidates: () => [[0, 0], [0, 3], [0.35, 0], [0.35, 3], [0, -3], [0.7, 0], [0.7, 3], [-0.3, 0], [1.1, 2], [0, 5], [1.5, 3], [1.1, 5], [-0.3, -3]].map(([i, a]) => make(i, a)) });
    }
    // the rest of the abnormal points
    list.abn.filter((a) => a.type !== 'extra').forEach((a, k) => {
      const flip = jit(k + 7) > 0 ? 1 : -1;
      const el = { kind: 'abn', name: a.type, type: a.type, len: a.len, on: a.on, w0: clamp(0.5 + a.len * 0.045, 0.55, 0.95) * (a.type === 'drop' ? 1.25 : a.type === 'split' ? 1.35 : 1) };
      if (a.on) {
        // off a tine: needs that tine's final line, so it is resolved at draw time
        el.candidates = (byName) => {
          const t = byName(a.on); if (!t) return [];
          const tp = t.pts, at = (f) => { const idx = clamp(Math.round(f * (tp.length - 1)), 1, tp.length - 2); return { p: tp[idx], ang: Math.atan2(tp[idx + 1][1] - tp[idx - 1][1], tp[idx + 1][0] - tp[idx - 1][0]) / RAD }; };
          const out = [];
          const fs = a.type === 'split' ? [a.at, a.at - 0.1, a.at + 0.08] : [a.at, a.at + 0.15, a.at - 0.12, a.at + 0.3];
          const spread = a.type === 'split' ? 36 : a.type === 'kicker' ? 55 : 70;
          for (const f of fs) { const q = at(clamp(f, 0.15, 0.9)); for (const sg of [-flip, flip]) out.push(spur(q.p, q.ang + spread * sg, (a.type === 'split' ? 24 : 16) * -sg, a.len, 7, 1)); }
          return out;
        };
      } else if (a.type === 'burr') {
        el.candidates = () => { const at = pointAt(beam, Math.min(0.5, beam.len * 0.08)); return [150 + jit(k) * 10, 125, 60, -25, -50].map((ang) => spur(at.p, ang, 16, a.len, 6, 1)); };
      } else if (a.type === 'drop') {
        el.blunt = true; el.w0 = clamp(0.8 + a.len * 0.05, 0.9, 1.3) * massF;
        el.candidates = () => [0, 0.12, -0.12, 0.22, -0.2].map((d) => { const at = pointAt(beam, distAtX(beam, X0 + beam.run * clamp(0.78 + (a.u - 0.45) * 0.5 + d, 0.6, 0.98))); return spur([at.p[0], at.p[1] - beamW[1] * 0.3], -92 + jit(k) * 5, 30, a.len, 8, 1.3); });
      } else { // sticker off the beam: a short point angled up and out
        el.candidates = () => [0, 0.1, -0.1, 0.2].flatMap((d) => { const at = pointAt(beam, beam.len * clamp(a.u + d, 0.2, 0.92)); const hd = at.h / RAD; return [hd - 55, hd + 60, hd - 85].map((ang) => spur(at.p, ang, 20, a.len, 6, 1)); });
      }
      els.push(el);
    });
    return els;
  }

  /* ---------------------------------------------------------------- antlers: pixel strokes */
  // Layer buffers: palette color + element id per pixel (ids let tests check every point is distinct).
  function AntlerLayer(W, H) { this.W = W; this.H = H; this.c = new Uint8Array(W * H); this.id = new Uint16Array(W * H); }
  function strokePixels(el, toPx, ppi) {
    // returns [{x, y, t, k, w, steep}] for a tapered pixel-art stroke
    const pts = el.pts.map(toPx);
    const total = plen(pts);
    const out = [];
    if (total < 0.01) return out;
    const widthAt = (t) => {
      let wIn;
      if (el.wProfile) { const p = el.wProfile; const f = t * 3.2; const i = Math.min(2, Math.floor(f)); wIn = t > 0.94 ? 0.3 : p[i] + (p[i + 1] - p[i]) * Math.min(1, f - i); if (t > 0.8) wIn *= 1 - (t - 0.8) * 2.2; }
      else wIn = el.w0 * (el.blunt ? 1 : t < 0.3 ? 1 : t < 0.7 ? 0.8 : 0.62);
      let w = Math.max(1, Math.round(wIn * ppi));
      if (!el.wProfile && el.kind !== 'beam') w = Math.min(w, 3);
      const left = (1 - t) * total;
      if (left < 1.6) w = 1;                                 // a one pixel tip
      else if (left < Math.max(4, total * 0.3)) w = Math.min(w, 2);
      return Math.min(w, 4);
    };
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0], ay = pts[i - 1][1], bx = pts[i][0], by = pts[i][1];
      const seg = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(seg / 0.25));
      const steep = Math.abs(by - ay) >= Math.abs(bx - ax);
      for (let s = 0; s <= steps; s++) {
        const f = s / steps, cx = ax + (bx - ax) * f, cy = ay + (by - ay) * f;
        const t = (acc + seg * f) / total;
        const w = widthAt(t);
        if (steep) { const xs = Math.floor(cx - w / 2 + 0.5), y = Math.floor(cy); for (let k = 0; k < w; k++) out.push({ x: xs + k, y, t, k, w, steep }); }
        else { const ys = Math.floor(cy - w / 2 + 0.5), x = Math.floor(cx); for (let k = 0; k < w; k++) out.push({ x, y: ys + k, t, k, w, steep }); }
      }
      acc += seg;
    }
    return out;
  }
  // Shading from the reference: light left edges and tips, mid bodies, dark undersides and lower beams.
  function shade(el, px) {
    const { t, k, w, steep } = px;
    if (el.kind === 'beam') {
      const tA = el.tA;
      if (t > 0.93) return K.AL;
      if (t < tA) { // the outward sweep: lit on top near the head, dark underneath further out
        const u = t / tA;
        if (!steep) {
          if (u < 0.3) return w >= 2 && k === w - 1 ? K.AM : K.AL;
          if (u < 0.45) return k === 0 ? K.AL : k === w - 1 && w >= 2 ? K.AS : K.AM;
          if (w === 1) return K.AD;
          return k < Math.max(1, Math.floor(w / 2)) ? K.AM : K.AD;
        }
        if (u < 0.3) return k === 0 ? K.AL : K.AM;
        return w >= 3 && k === 0 ? K.AM : K.AD;
      }
      const v = (t - tA) / (1 - tA);
      if (v < 0.3 && tA > 0.25) return w >= 3 && k === 0 ? K.AM : K.AD; // the foot of the rise stays in shadow
      return k === 0 ? K.AL : K.AM;
    }
    if (el.kind === 'brow') {
      if (t > 0.82) return K.AM;
      return w >= 2 && k === 0 && steep ? K.AM : K.AS;
    }
    // tines and abnormal points
    if (t > 0.86) return K.AL;
    if (t < 0.1 && el.kind === 'tine') return K.AM;
    if (w === 1) return t > 0.5 ? K.AL : K.AM;
    if (steep) return k === 0 ? K.AL : K.AM;
    return k === 0 ? K.AL : K.AM;
  }

  /* Draw a full rack into an AntlerLayer. geom: { cx, top (px of the pedicles), ppi, squash }.
     Returns the placed elements; each point has .clash = how many of its outer pixels touch another part. */
  function drawRack(layer, comp, style, geom) {
    const look = WT.rackLook(style);
    const { cx, top, ppi } = geom;
    const squash = geom.squash || 1;
    let nextId = 1;
    const placed = [];
    const occ = layer.id; // element ids double as the occupancy grid
    const W = layer.W, Hh = layer.H;
    const stamp = (el, pixels) => { for (const p of pixels) { if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= Hh) continue; const i = p.y * W + p.x; layer.c[i] = shade(el, p); occ[i] = el.id; } };
    // how many of a point's outer pixels touch some other part of the rack (other than what it grows from)
    const clash = (id, pixels, parentIds, from) => {
      let n = 0;
      for (const p of pixels) {
        if (p.t < from) continue;
        if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= Hh) { n++; continue; }
        let hit = false;
        for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = p.x + dx, y = p.y + dy; if (x < 0 || y < 0 || x >= W || y >= Hh) continue;
          const o = occ[y * W + x];
          if (o && o !== id && !parentIds.includes(o)) { hit = true; break; }
        }
        if (hit) n++;
      }
      return n;
    };
    // painting over another point (not just brushing past it) could hide it completely
    const covers = (id, pixels, parentIds) => {
      let n = 0;
      for (const p of pixels) {
        if (p.t < 0.12 || p.x < 0 || p.y < 0 || p.x >= W || p.y >= Hh) continue;
        const o = occ[p.y * W + p.x];
        if (o && o !== id && !parentIds.includes(o) && o > 2) n++;
      }
      return n;
    };
    const sides = [];
    for (let si = 0; si < 2; si++) {
      const sgn = si === 0 ? -1 : 1;
      const toPx = (p) => [cx + sgn * p[0] * ppi, top - p[1] * ppi * squash];
      sides.push({ els: layoutSide(comp, si, look), toPx, sgn });
    }
    // beams first
    for (const s of sides) { const b = s.els[0]; b.id = nextId++; b.side = s.sgn; stamp(b, strokePixels(b, s.toPx, ppi)); placed.push(b); }
    // at a distance only the big parts of a rack can be made out
    const minLen = ppi >= 2 ? 0 : ppi >= 1 ? 1.2 : ppi >= 0.5 ? 3.5 : ppi >= 0.25 ? 7 : 99;
    // tines from the outside in, then brows, then abnormal points
    const rank = (e) => (e.kind === 'tine' || e.name === 'extra' ? 0 : e.kind === 'brow' ? 1 : 2);
    for (const pass of [0, 1, 2]) for (const s of sides) {
      const byName = (nm) => s.els.find((e) => e.name === nm && e.pts && (e.kind === 'tine' || e.kind === 'brow' || (nm === 'beam' && e.kind === 'beam')));
      for (const e of s.els.slice(1)) {
        if (rank(e) !== pass || e.len < minLen) continue;
        e.id = nextId++; e.side = s.sgn;
        const parentIds = [s.els[0].id];
        if (e.on) { const par = byName(e.on); if (par) parentIds.push(par.id); }
        let best = null;
        for (const pts of e.candidates(byName)) {
          const el = Object.assign({}, e, { pts });
          const px = strokePixels(el, s.toPx, ppi);
          // the tip must stand clear (that is what you count); a clean lower half is a bonus
          const tip = clash(e.id, px, parentIds, 0.62), c = tip * 12 + clash(e.id, px, parentIds, 0.38) + covers(e.id, px, parentIds) * 30;
          if (!best || c < best.c) best = { pts, px, c, tip };
          if (c === 0) break;
        }
        if (!best) continue;
        e.pts = best.pts; e.clash = best.c; e.tipClash = best.tip;
        stamp(e, best.px);
        placed.push(e);
      }
    }
    // nothing gets lost: a tiny point that ended up painted over is drawn again on top
    const own = new Map();
    for (let i = 0; i < occ.length; i++) if (occ[i]) own.set(occ[i], (own.get(occ[i]) || 0) + 1);
    for (const e of placed) {
      if (e.kind === 'beam' || (own.get(e.id) || 0) >= 3) continue;
      const s = sides.find((q) => q.sgn === e.side);
      stamp(e, strokePixels(e, s.toPx, ppi));
    }
    return { elements: placed, points: sides.map((s) => s.els.length) };
  }
  WT.drawRack = drawRack;
  WT.AntlerLayer = AntlerLayer;

  /* ---------------------------------------------------------------- compose a deer */
  /* opts: { lod: 0-4, frame: 'bust' | 'full', pose: 'alert' | 'walk' | 'down', step: 0|1, day, mode: 'day'|'low'|'ir' }
     Returns { data (RGBA), W, H, bounds, anchor: {x, y} (ground center for 'full', skull top for 'bust'), rack } */
  WT.deerSprite = function (deer, opts) {
    opts = opts || {};
    const lod = clamp(opts.lod | 0, 0, 4);
    const ppi = PPI0 / Math.pow(2, lod);
    const px = (inch) => Math.round(inch * ppi);
    const L = WT.deerLook(deer, opts.day);
    const B = L.B;
    const pose = opts.pose || 'alert';
    const bust = opts.frame !== 'full';
    const down = pose === 'down';
    let W, H, cx, skullY, groundY;
    const legLen = B.sh - B.chestH - 0.5;
    if (bust) {
      W = Math.ceil(88 / Math.pow(2, lod)); H = Math.ceil(92 / Math.pow(2, lod));
      cx = W / 2; skullY = Math.round(52 / Math.pow(2, lod));
      groundY = skullY + px(B.sh + B.headUp);
    } else {
      W = Math.ceil(36 * ppi) + 4; H = Math.ceil(78 * ppi) + 3;
      cx = W / 2; groundY = H - 1;
      const headUp = pose === 'walk' ? B.headUp - 4 : B.headUp;
      skullY = down ? groundY - px(14) : groundY - px(B.sh + headUp);
    }
    const buf = new Buf(W, H);
    const icx = Math.floor(cx);
    const chestTop = groundY - px(legLen + B.chestH), chestCy = groundY - px(legLen + B.chestH / 2);
    const rx = Math.max(1, B.chestW * ppi / 2), ry = Math.max(1, B.chestH * ppi / 2);
    const step = opts.step ? 1 : 0;
    const walking = pose === 'walk';
    if (lod <= 3) {
      // hind legs and hindquarters (in shadow behind the chest)
      const lw = Math.max(1, px(B.legW * 0.9));
      const hx = Math.max(1, Math.round(B.chestW * 0.34 * ppi));
      for (const sgn of [-1, 1]) {
        const x0 = sgn < 0 ? icx - hx - lw + 1 : icx + hx;
        const lift = walking && (sgn > 0) === !!step ? Math.max(1, px(1.5)) : 0;
        buf.rect(x0, chestCy, x0 + lw - 1, groundY - lift, K.HDD);
        buf.rect(x0, groundY - lift - Math.max(0, px(1.2) - 1), x0 + lw - 1, groundY - lift, K.HOOF);
      }
      buf.ellipse(cx, chestCy + ry * 0.12, rx * 1.1, ry * 0.95, K.HD);
      // front legs
      const fw = Math.max(1, px(B.legW)), fx = Math.max(1, Math.round(B.chestW * 0.2 * ppi));
      for (const sgn of [-1, 1]) {
        const x0 = sgn < 0 ? icx - fx - fw + 1 : icx + fx;
        const lift = walking && (sgn < 0) === !!step ? Math.max(1, px(2)) : 0;
        const knee = groundY - px(legLen * 0.5);
        buf.rect(x0, chestCy, x0 + fw - 1, groundY - lift, (x) => (fw >= 3 && x === x0 ? K.HL : sgn > 0 && fw >= 2 && x === x0 + fw - 1 ? K.HD : K.HM));
        if (fw >= 3) buf.rect(sgn < 0 ? x0 : x0 + fw - 1, knee, sgn < 0 ? x0 : x0 + fw - 1, groundY - lift, K.NONE); // slimmer below the knee
        if (fw >= 2) buf.rect(sgn < 0 ? x0 - 1 : x0 + fw, chestCy, sgn < 0 ? x0 - 1 : x0 + fw, knee - Math.round((knee - chestCy) * 0.35), K.HM); // forearm
        buf.rect(x0 + (fw >= 3 && sgn < 0 ? 1 : 0), groundY - lift - Math.max(0, px(1.2) - 1), x0 + fw - 1 - (fw >= 3 && sgn > 0 ? 1 : 0), groundY - lift, K.HOOF);
      }
      // chest
      buf.ellipse(cx, chestCy, rx, ry, [K.HL, K.HM, K.HD]);
    } else {
      // far away: a body, a hint of legs
      buf.ellipse(cx, chestCy, Math.max(1, rx), Math.max(1, ry), K.HM);
      buf.rect(icx - 1, chestCy, icx - 1, groundY, K.HD); buf.rect(icx + 1, chestCy, icx + 1, groundY, K.HD);
    }
    // neck: from the chest up behind the face (or down to a lowered head)
    const F = lod <= 2 ? faceFor(lod, L.face, L.kind, down) : null;
    const headH = F ? F.rows - F.crown : Math.max(2, px(9));
    const jawY = skullY + Math.round(headH * 0.62);
    const nTop = Math.max(1, L.neckW * ppi / 2 * 0.8), nBot = Math.max(1, L.neckW * ppi / 2 * 1.14);
    if (!down) {
      const y0 = skullY + Math.round(headH * 0.56), y1 = Math.max(y0 + 1, chestTop + Math.round(ry * 0.5));
      for (let y = y0; y <= y1; y++) {
        const f = (y - y0) / Math.max(1, y1 - y0);
        const hw = nTop + (nBot - nTop) * f;
        const xa = Math.round(cx - hw), xb = Math.round(cx + hw) - 1;
        for (let x = xa; x <= xb; x++) buf.set(x, y, hw >= 3 && x >= xb - Math.max(0, Math.round(hw * 0.22) - 1) ? K.HD : K.HM);
      }
      // cream throat patch under the jaw
      if (lod <= 2) {
        const prx = Math.max(1, L.neckW * ppi / 2 * 0.58), pry = Math.max(1, 2.35 * ppi);
        buf.ellipse(cx, skullY + headH + pry * 0.75, prx, pry, K.CREAM);
      }
    } else if (lod <= 3) {
      // head down: a short thick neck dropping in front of the chest
      for (let y = chestCy; y <= skullY + Math.round(headH * 0.5); y++) { const hw = nTop * 0.95; buf.rect(Math.round(cx - hw), y, Math.round(cx + hw) - 1, y, K.HM); }
    }
    // head: ears, then antlers, then the face
    const headTop = skullY - (F ? F.crown : 0);
    let rackInfo = null;
    const antlered = L.kind === 'buck' && deer.rack && deer.style;
    const ant = antlered ? new AntlerLayer(W, H) : null;
    if (F) {
      const x0 = icx - F.hw;
      for (let r = 0; r < F.rows; r++) for (let i = 0; i < F.hw * 2; i++) { const c = F.ear[r][i]; if (c) buf.set(x0 + i, headTop + r, c); }
      if (ant) {
        rackInfo = drawRack(ant, WT.unpackRack(deer.rack), deer.style, { cx, top: skullY + F.pedY, ppi, squash: down ? 0.5 : 1 });
        for (let i = 0; i < W * H; i++) if (ant.c[i]) buf.c[i] = ant.c[i];
      }
      for (let r = 0; r < F.rows; r++) for (let i = 0; i < F.hw * 2; i++) { const c = F.face[r][i]; if (c) buf.set(x0 + i, headTop + r, c); }
      if (L.button && lod === 0) { buf.set(icx - 5, skullY, K.TUFT); buf.set(icx + 4, skullY, K.TUFT); }
    } else {
      // tiny head: a blob with ear flecks
      const hw = Math.max(1, Math.round(3 * ppi)), hh = Math.max(1, px(8));
      if (ant) {
        rackInfo = drawRack(ant, WT.unpackRack(deer.rack), deer.style, { cx, top: skullY, ppi, squash: down ? 0.5 : 1 });
        for (let i = 0; i < W * H; i++) if (ant.c[i]) buf.c[i] = lod >= 4 ? K.AM : ant.c[i];
      }
      buf.rect(icx - hw, skullY, icx + hw - 1, skullY + hh, K.HL);
      if (lod === 3) { buf.set(icx - hw - 1, skullY, K.HD); buf.set(icx + hw, skullY, K.HD); buf.set(icx - hw - 2, skullY - 1, K.LINE); buf.set(icx + hw + 1, skullY - 1, K.LINE); buf.rect(icx - 1, skullY + hh, icx, skullY + hh, K.NOSE); }
    }
    // fawn spots early in the season
    if (L.kind === 'fawn' && (opts.day ?? 30) < 25 && lod <= 2 && !bust) {
      for (let y = chestCy - Math.round(ry * 0.6); y < chestCy; y += 2) for (let x = Math.round(cx - rx * 0.6); x < cx + rx * 0.6; x += 3) if (WT.hash2(x, y, deer.id | 0) < 0.5 && buf.get(x, y) === K.HM) buf.set(x, y, K.SPOT);
    }
    // bust: cut off below the neck with rounded corners
    if (bust) {
      const cut = Math.min(H - 1, skullY + Math.round(36 / Math.pow(2, lod)));
      for (let y = cut + 1; y < H; y++) for (let x = 0; x < W; x++) buf.c[y * W + x] = 0;
      for (const [dy, n] of [[0, 2], [1, 1]]) { let k = 0; for (let x = 0; x < W && k < n; x++) if (buf.get(x, cut - dy)) { buf.set(x, cut - dy, 0); k++; } k = 0; for (let x = W - 1; x >= 0 && k < n; x--) if (buf.get(x, cut - dy)) { buf.set(x, cut - dy, 0); k++; } }
    }
    // to RGBA
    const mode = opts.mode || 'day';
    const data = new Uint8ClampedArray(W * H * 4);
    let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
    for (let i = 0; i < W * H; i++) {
      const c = buf.c[i]; if (!c) continue;
      const x = i % W, y = (i / W) | 0;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      let [r, g, b] = RGB[c];
      if (mode === 'ir') { let l = r * 0.3 + g * 0.55 + b * 0.15; l = c === K.EYE ? 255 : isAntler(c) || c === K.CREAM || c === K.EARW ? Math.min(255, l * 1.2 + 25) : l * 0.9 + 6; r = g = b = l; }
      else if (mode === 'low') { const l = (r + g + b) / 3; r = (r * 0.6 + l * 0.4) * 0.62; g = (g * 0.6 + l * 0.4) * 0.62; b = (b * 0.6 + l * 0.4) * 0.68; }
      const o = i * 4; data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
    }
    return { data, W, H, bounds: bx1 >= 0 ? { x0: bx0, y0: by0, x1: bx1, y1: by1 } : null, anchor: bust ? { x: icx, y: skullY } : { x: icx, y: groundY }, rack: rackInfo, ant, lod, ppi };
  };

  // Nearest-neighbour blow-up (binoculars showing a small LOD, galleries)
  WT.scaleSprite = function (img, k) {
    const W = img.W * k, H = img.H * k, out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = ((Math.floor(y / k)) * img.W + Math.floor(x / k)) * 4, o = (y * W + x) * 4; out[o] = img.data[s]; out[o + 1] = img.data[s + 1]; out[o + 2] = img.data[s + 2]; out[o + 3] = img.data[s + 3]; }
    return { data: out, W, H };
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
