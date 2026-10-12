/* Whitetail Country: deer anatomy and antlers (deer-anatomy-and-antlers-spec).
   One source of truth: every rack is stored as Boone & Crockett components, built into 3D tubes,
   and the score is MEASURED from that geometry. Bodies are built from real-world inches.
   Units are inches. Axes: x = lateral (deer's right is +), y = up, z = forward (toward the nose). */
(function (root) {
  const WT = (root.WT = root.WT || {});
  const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
  const r8 = (v) => Math.round(v * 8) / 8;

  const LIMITS = {
    beam: 31, spread: 27, G1: 10, G2: 15, G3: 12, G4: 9, G5: 5, G6: 4, H1: 7, typicalPointsPerSide: 7,
    abn: { drop: [2, 12], sticker: [1, 5], kicker: [1, 6], split: [1, 5], burr: [1, 3], extra: [1, 6] },
  };
  WT.ANTLER_LIMITS = LIMITS;

  // Frame proportions by typical frame score (from the spec's reference racks, extended down to spikes).
  const FRAME_TABLE = [
    // frame, beam, spread, mass per side (H1..H4 total)
    [12, 5.5, 4.5, 5.5],
    [30, 9, 7, 7.5],
    [50, 12.5, 9.5, 9],
    [80, 15.5, 12.5, 11],
    [104, 18, 14, 13],
    [129, 22, 17, 15],
    [150, 23.5, 18, 16.3],
    [172, 26, 19, 18.8],
    [200, 28, 20.5, 20.5],
    [230, 30, 22, 22.5],
  ];
  const lerpT = (x, col) => WT.lerpTable(FRAME_TABLE, x, col);

  /* ---------------------------------------------------------------- genes */
  WT.rollRackStyle = function (rng, mom) {
    const n = (sd) => clamp(rng.normal(1, sd), 1 - 2.5 * sd, 1 + 2.5 * sd);
    const inherit = (k, v) => (mom && mom[k] !== undefined ? v * 0.7 + mom[k] * 0.3 : v);
    const s = {
      beam: inherit('beam', n(0.06)), spread: inherit('spread', n(0.09)), tine: inherit('tine', n(0.08)), mass: inherit('mass', n(0.07)),
      brow: n(0.18), ptGene: rng.next(), ntGene: rng.next(), curl: rng.range(0.55, 1), lean: rng.range(-1, 1),
      fwd: rng.range(0.85, 1.15), tall: rng.range(0.85, 1.15), asym: rng.range(0, 1), seed: rng.int(1, 2e9),
      quirk: null, quirkSide: rng.chance(0.5) ? 1 : -1,
    };
    if (rng.chance(0.07)) s.quirk = rng.pick(['splitG2', 'splitBrow', 'drop', 'kicker', 'sticker', 'burr']);
    return s;
  };
  WT.rollBodyGene = (rng) => clamp(rng.normal(0, 1), -2.2, 2.2);

  /* ---------------------------------------------------------------- components from a target score */
  function sidePoints(frame, style, age) {
    // side points include the beam tip. 1 = spike, 2 = fork, 3 = 6pt side, 4 = 8pt side, 5 = 10pt side, 6 = 12pt side
    const g = style.ptGene;
    if (frame < 22) return 1;
    if (frame < 40) return g < 0.45 ? 1 : 2;
    if (frame < 62) return g < 0.25 ? 2 : g < 0.85 ? 3 : 4;
    if (frame < 95) return g < 0.15 ? 3 : g < 0.85 ? 4 : 5;
    if (frame < 125) return g < 0.6 ? 4 : 5;
    if (frame < 150) return g < 0.45 ? 4 : g < 0.93 ? 5 : 6;
    let p = g < 0.3 ? 4 : g < 0.85 ? 5 : 6;
    if (frame > 175 && p < 5) p = 5;
    if (frame > 200 && p < 6 && g > 0.5) p = 6;
    if (age >= 8.5 && p > 4) p--;
    return p;
  }

  // Tine weights by name; G2 is usually the longest.
  const TINE_W = { G1: 0.5, G2: 1, G3: 0.84, G4: 0.5, G5: 0.28, G6: 0.18 };
  const TINE_POS = { G1: null, G2: 0.36, G3: 0.6, G4: 0.79, G5: 0.9, G6: 0.95 };

  function tineNames(sidePts) {
    switch (sidePts) {
      case 1: return [];
      case 2: return ['G2'];
      case 3: return ['G1', 'G2'];
      case 4: return ['G1', 'G2', 'G3'];
      case 5: return ['G1', 'G2', 'G3', 'G4'];
      case 6: return ['G1', 'G2', 'G3', 'G4', 'G5'];
      default: return ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'];
    }
  }

  /* Build a rack description (components) for a buck this year.
     targetGross includes abnormal inches. Returns { sides:[L,R], spread, abn:[...], target } */
  WT.genRackComponents = function (style, age, targetGross, rng) {
    let ntP = age < 4.5 ? 0.025 : age < 6.5 ? 0.07 : 0.15;
    ntP *= 0.25 + 1.5 * style.ntGene;
    const isNT = targetGross > 95 && rng.chance(ntP);
    let abnTarget = isNT ? targetGross * rng.range(0.08, targetGross > 170 ? 0.2 : 0.16) : 0;
    let frame = Math.max(10, targetGross - abnTarget);
    const pts = sidePoints(frame, style, age);
    const names = tineNames(pts);
    const ageF = age <= 1.5 ? 0.92 : age <= 2.5 ? 0.97 : 1;
    let beam = lerpT(frame, 1) * style.beam * ageF;
    let spread = lerpT(frame, 2) * style.spread * (age <= 2.5 ? 0.93 : age >= 4.5 ? 1.03 : 1);
    let mass = lerpT(frame, 3) * style.mass * (age >= 5.5 ? 1.05 : 1) * (age <= 1.5 ? 0.92 : 1);
    beam = Math.min(beam, LIMITS.beam); spread = Math.min(spread, LIMITS.spread, beam * 0.98);
    // tine budget per side
    let budget = (frame - spread) / 2 - beam - mass;
    if (!names.length || budget < names.length * 1.2) {
      // too small for real tines: shrink beam and mass, drop to fewer tines
      const fixed = (frame - spread) / 2;
      const want = beam + mass + (names.length ? names.length * 1.5 : 0);
      const f = clamp(fixed / want, 0.35, 1);
      beam *= f; mass *= f; spread = Math.min(spread, beam * 0.98);
      budget = (frame - spread) / 2 - beam - mass;
    }
    const wsum = names.reduce((a, n) => a + TINE_W[n] * (n === 'G1' ? style.brow : 1), 0) || 1;
    const tines = {};
    let leftover = 0;
    for (const n of names) {
      let len = Math.max(0, budget) * (TINE_W[n] * (n === 'G1' ? style.brow : 1)) / wsum * style.tine;
      const cap = LIMITS[n] * (n === 'G1' && style.brow > 1.2 ? 1 : 0.85);
      if (len > cap) { leftover += len - cap; len = cap; }
      tines[n] = len;
    }
    // tine style changes the distribution, not the total: renormalize, then park overflow in beam/spread/mass
    const tsum = Object.values(tines).reduce((a, b) => a + b, 0);
    const need = Math.max(0, budget) - leftover;
    if (tsum > 0) for (const n of names) tines[n] = Math.min(LIMITS[n], tines[n] * (need / tsum));
    if (leftover > 0) {
      const addB = Math.min(leftover * 0.5, LIMITS.beam - beam); beam += addB; leftover -= addB;
      const addM = Math.min(leftover, 26 - mass); mass += addM; leftover -= addM;
      if (leftover > 0) abnTarget += leftover * 2;
    }
    // per-side asymmetry: small on typicals, consistent pattern per buck
    const pat = WT.makeRng(style.seed + 11);
    const asymAmt = 0.015 + style.asym * 0.04;
    const side = (sgn) => {
      const k = () => 1 + (pat.next() - 0.5) * 2 * asymAmt * (sgn > 0 ? 1 : -1) + rng.range(-0.012, 0.012);
      const s = { beam: Math.min(LIMITS.beam, beam * k()), tines: {}, H: [], names: names.slice() };
      for (const n of names) s.tines[n] = clamp(tines[n] * k(), 0, LIMITS[n]);
      const hw = [0.28, 0.255, 0.24, 0.225];
      const H1max = LIMITS.H1;
      for (let i = 0; i < 4; i++) s.H.push(Math.min(i === 0 ? H1max : H1max * 0.95, mass * hw[i] * k()));
      for (let i = 1; i < 4; i++) s.H[i] = Math.min(s.H[i], s.H[i - 1] - 0.05); // mass tapers out the beam
      // drop points shorter than 1": they don't count and shouldn't be drawn as points
      s.names = s.names.filter((n) => s.tines[n] >= 1.05);
      // a small chance of a broken tine on one side
      return s;
    };
    const L = side(-1), R = side(1);
    if (rng.chance(0.03) && L.names.length > 1) { const n = rng.pick(L.names); L.tines[n] = Math.max(1.1, L.tines[n] * rng.range(0.3, 0.6)); L.broken = n; }
    const comp = { sides: [L, R], spread, abn: [], target: targetGross, frame, age, isNT };
    // abnormal points
    const abn = [];
    const addAbn = (type, sideIdx, len, extra) => abn.push(Object.assign({ type, side: sideIdx, len: clamp(len, LIMITS.abn[type][0], LIMITS.abn[type][1]) }, extra || {}));
    if (style.quirk && age >= 2.5) {
      const si = style.quirkSide > 0 ? 1 : 0;
      const q = style.quirk, sz = clamp((frame - 90) / 80, 0.15, 1);
      if (q === 'splitG2' && comp.sides[si].names.includes('G2')) addAbn('split', si, 1 + sz * 3.5, { on: 'G2', at: 0.78 });
      else if (q === 'splitBrow' && comp.sides[si].names.includes('G1')) addAbn('split', si, 1 + sz * 2.5, { on: 'G1', at: 0.7 });
      else if (q === 'drop' && age >= 4.5) addAbn('drop', si, 2 + sz * 7, { u: 0.62 });
      else if (q === 'kicker' && comp.sides[si].names.includes('G2')) addAbn('kicker', si, 1 + sz * 4, { on: 'G2', at: 0.4 });
      else if (q === 'sticker') addAbn('sticker', si, 1 + sz * 2.5, { u: 0.3 });
      else if (q === 'burr') addAbn('burr', si, 1 + sz * 1.6, { ang: 0.6 });
    }
    if (isNT) {
      const kinds = age >= 5.5 ? ['drop', 'sticker', 'kicker', 'split', 'burr', 'extra', 'sticker', 'kicker'] : ['sticker', 'kicker', 'split', 'burr', 'extra', 'sticker'];
      let count = rng.int(2, 8);
      if (targetGross > 200 && rng.chance(0.3)) count += rng.int(2, 5);
      let have = abn.reduce((a, b) => a + b.len, 0);
      for (let k = 0; k < count && have < abnTarget; k++) {
        const t = rng.pick(kinds), si = rng.int(0, 1);
        const room = abnTarget - have;
        const [lo, hi] = LIMITS.abn[t];
        const len = clamp(rng.range(lo, hi) * (0.5 + rng.next()), lo, Math.max(lo, Math.min(hi, room)));
        const s = comp.sides[si];
        const tineFor = (pref) => pref.find((n) => s.names.includes(n));
        if (t === 'drop') addAbn('drop', si, len, { u: rng.range(0.45, 0.78) });
        else if (t === 'sticker') { const on = rng.chance(0.5) ? tineFor(['G2', 'G3', 'G1']) : null; addAbn('sticker', si, len, on ? { on, at: rng.range(0.25, 0.6) } : { u: rng.range(0.15, 0.85) }); }
        else if (t === 'kicker') { const on = tineFor(['G2', 'G3']); if (on) addAbn('kicker', si, len, { on, at: rng.range(0.25, 0.55) }); else addAbn('sticker', si, Math.min(len, 5), { u: rng.range(0.3, 0.7) }); }
        else if (t === 'split') { const on = tineFor(['G2', 'G1', 'G3']); if (on && !abn.some((a) => a.type === 'split' && a.on === on && a.side === si)) addAbn('split', si, len, { on, at: rng.range(0.65, 0.85) }); }
        else if (t === 'burr') addAbn('burr', si, len, { ang: rng.range(0, Math.PI * 2) });
        else if (t === 'extra') addAbn('extra', si, len, { u: rng.range(0.47, 0.72) });
        have = abn.reduce((a, b) => a + b.len, 0);
      }
    }
    comp.abn = abn;
    return comp;
  };

  /* ---------------------------------------------------------------- 3D geometry */
  const v3 = (x, y, z) => [x, y, z];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len3 = (a) => Math.sqrt(dot(a, a));
  const norm = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  WT.v3 = { add, sub, mul, dot, len3, norm, cross };

  const BEAM_N = 40;
  // The main beam: up and back off the skull, sweeping out, then forward with tips curling in.
  function beamCurve(sgn, L, halfW, style, s) {
    const x0 = 1.45, curlIn = 0.12 + 0.2 * style.curl;
    const pts = [];
    const Hy = 0.42 * L * style.tall * s, Fz = 0.36 * L * style.fwd * s, Bz = 0.3 * L * s;
    for (let i = 0; i <= BEAM_N; i++) {
      const u = i / BEAM_N;
      let a;
      if (u <= 0.6) a = Math.sin((u / 0.6) * Math.PI / 2);
      else a = 1 - curlIn * Math.pow((u - 0.6) / 0.4, 1.5);
      const x = sgn * (x0 + (halfW - x0) * a);
      const y = Hy * (1 - Math.pow(1 - u, 2.3)) + 0.4 * Math.sin(u * Math.PI) * (style.tall - 0.85) * 4;
      const z = Fz * u * u - Bz * u * (1 - u) * 2.4;
      pts.push(v3(x, y, z));
    }
    return pts;
  }
  function polyLen(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += len3(sub(pts[i], pts[i - 1])); return l; }
  // arc-length position along a polyline
  function along(pts, frac) {
    const total = polyLen(pts), want = total * clamp(frac);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const seg = len3(sub(pts[i], pts[i - 1]));
      if (acc + seg >= want) { const t = (want - acc) / (seg || 1); return { p: add(pts[i - 1], mul(sub(pts[i], pts[i - 1]), t)), tan: norm(sub(pts[i], pts[i - 1])), i, t }; }
      acc += seg;
    }
    return { p: pts[pts.length - 1], tan: norm(sub(pts[pts.length - 1], pts[pts.length - 2])), i: pts.length - 1, t: 1 };
  }

  // A curved tine (or abnormal point) of exact arc length.
  function tinePolyline(base, dir0, bend, L, n = 10) {
    const pts = [base];
    let p = base;
    const step = L / n;
    for (let k = 0; k < n; k++) {
      const d = norm(add(dir0, mul(bend, (k + 0.5) / n)));
      p = add(p, mul(d, step));
      pts.push(p);
    }
    return pts;
  }

  function topNormal(tan) {
    const up = [0, 1, 0];
    const n = sub(up, mul(tan, dot(up, tan)));
    return len3(n) < 1e-3 ? [0, 0, 1] : norm(n);
  }

  /* Build tubes from components. Returns { beams:[{pts, r:[]}], tines:[...], abn:[...], comp } */
  WT.buildRack = function (comp, style) {
    const out = { sides: [], comp };
    for (let si = 0; si < 2; si++) {
      const sgn = si === 0 ? -1 : 1;
      const S = comp.sides[si];
      const L = S.beam;
      // radius profile from circumferences
      const Hr = S.H.map((c) => c / (2 * Math.PI));
      // inside spread target: half-width of beam centerline at its widest = spread/2 + radius there
      const halfW = comp.spread / 2 + Hr[2] * 0.9;
      // solve scale on height/forward so arc length == L
      let lo = 0.05, hi = 3, pts = null;
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        pts = beamCurve(sgn, L, halfW, style, mid);
        if (polyLen(pts) > L) hi = mid; else lo = mid;
      }
      pts = beamCurve(sgn, L, halfW, style, (lo + hi) / 2);
      // exact length: rescale last segment
      const curLen = polyLen(pts);
      const lastSeg = sub(pts[BEAM_N], pts[BEAM_N - 1]);
      const fix = len3(lastSeg) + (L - curLen);
      pts[BEAM_N] = add(pts[BEAM_N - 1], mul(norm(lastSeg), Math.max(0.05, fix)));
      // tine positions along the beam (fractions of length)
      const pos = {};
      const g1Dist = 1.4 + clamp(style.brow - 0.7, 0, 0.8) * 1.5;
      for (const n of S.names) pos[n] = n === 'G1' ? g1Dist / L : TINE_POS[n] + (S.names.length <= 2 && n === 'G2' ? -0.02 : 0);
      // circumference stations: between burr and G1, G1-G2, G2-G3, G3-G4 (or halfway G3 to tip)
      const seq = ['G1', 'G2', 'G3', 'G4'].map((n) => pos[n]);
      const st = [];
      const prev = [0, seq[0], seq[1], seq[2]];
      const defaults = [0.06, 0.25, 0.47, 0.7];
      for (let k = 0; k < 4; k++) {
        const a = prev[k] ?? null, b = seq[k] ?? null;
        if (k === 0) st.push(b != null ? b / 2 : defaults[0]);
        else if (a != null && b != null) st.push((a + b) / 2);
        else if (a != null) st.push((a + 1) / 2);
        else st.push(defaults[k]);
      }
      for (let k = 1; k < 4; k++) if (st[k] <= st[k - 1] + 3 / BEAM_N) st[k] = Math.min(0.9, st[k - 1] + 3 / BEAM_N);
      for (let k = 0; k < 4; k++) st[k] = Math.round(st[k] * BEAM_N) / BEAM_N;
      // flat for one sample either side of each station, so the tube radius there is exactly H/(2*pi)
      const win = 1 / BEAM_N + 1e-6;
      const radiusAt = (f) => {
        for (let k = 0; k < 4; k++) if (Math.abs(f - st[k]) <= win) return Hr[k];
        if (f < st[0]) return Hr[0] * (1 + (st[0] - win - f) / Math.max(st[0], 0.01) * 0.25);
        for (let k = 1; k < 4; k++) if (f < st[k]) { const a = st[k - 1] + win, b = st[k] - win; const t = clamp((f - a) / Math.max(1e-6, b - a)); return Hr[k - 1] + (Hr[k] - Hr[k - 1]) * t; }
        const t = clamp((f - st[3] - win) / Math.max(1e-6, 1 - st[3] - win));
        return Hr[3] + (0.12 - Hr[3]) * Math.pow(t, 1.3);
      };
      const radii = pts.map((_, i) => radiusAt(i / BEAM_N));
      const side = { sgn, beam: { pts, r: radii }, stations: st, Hr, tines: [], abn: [] };
      // typical tines
      for (const n of S.names) {
        const a = along(pts, pos[n]);
        const rb = radiusAt(pos[n]);
        const top = topNormal(a.tan);
        const base = add(a.p, mul(top, rb * 0.85));
        const outward = [sgn, 0, 0];
        let dir0, bend;
        if (n === 'G1') { dir0 = norm(add(add(top, mul([0, 0, 1], 0.35)), mul(outward, 0.05))); bend = mul([0, 0, 1], 0.25); }
        else {
          const k = TINE_POS[n];
          dir0 = norm(add(add(add(mul(top, 0.35), [0, 1, 0]), mul(outward, 0.12 + style.lean * 0.08)), mul([0, 0, 1], 0.06 + k * 0.08)));
          bend = add(mul(outward, -0.14 * style.curl), mul([0, 0, 1], 0.1));
        }
        const tl = S.tines[n];
        const tp = tinePolyline(base, dir0, bend, tl, 10);
        const r0 = Math.min(rb * 0.72, 0.28 + tl * 0.055);
        side.tines.push({ name: n, pts: tp, r: tp.map((_, i) => r0 + (0.07 - r0) * Math.pow(i / 10, 1.15)), len: tl });
      }
      // abnormal points
      comp.abn.filter((ab) => ab.side === si).forEach((ab) => {
        let base, dir0, bend, r0;
        if (ab.on) {
          const t = side.tines.find((x) => x.name === ab.on);
          if (!t) return;
          const a = along(t.pts, ab.at);
          const tr = t.r[Math.min(10, Math.round(ab.at * 10))];
          if (ab.type === 'split') { dir0 = norm(add(a.tan, mul([0, 0, 1], 0.9))); bend = mul([sgn, 0, 0], 0.2); }
          else if (ab.type === 'kicker') { dir0 = norm(add(add(mul([sgn, 0, 0], 1), mul([0, 0, -1], 0.7)), mul([0, 1, 0], 0.2))); bend = mul([0, 1, 0], 0.3); }
          else { dir0 = norm(add(mul([sgn, 0, 0], 1), mul([0, 0, 1], 0.4))); bend = mul([0, 1, 0], 0.4); }
          base = add(a.p, mul(dir0, tr * 0.6));
          r0 = Math.min(tr * 0.8, 0.22 + ab.len * 0.04);
        } else if (ab.type === 'burr') {
          const a = along(pts, 0.02);
          dir0 = norm([sgn * Math.cos(ab.ang) * 0.8 + sgn * 0.5, 0.3 + Math.sin(ab.ang) * 0.5, Math.sin(ab.ang) * 0.6]);
          base = add(a.p, mul(dir0, radiusAt(0.02)));
          bend = [0, 0.2, 0];
          r0 = 0.25;
        } else {
          const a = along(pts, ab.u);
          const rb = radiusAt(ab.u);
          const top = topNormal(a.tan);
          if (ab.type === 'drop') { dir0 = norm(add(mul(top, -1), mul([sgn, 0, 0], 0.15))); bend = mul([0, 0, 1], 0.3); }
          else if (ab.type === 'extra') { dir0 = norm(add(top, mul([sgn, 0, 0], 0.25))); bend = mul([sgn, 0, 0], -0.2); }
          else { dir0 = norm(add(mul([sgn, 0, 0], 1), mul(top, 0.3))); bend = mul([0, 0, 1], 0.3); }
          base = add(a.p, mul(dir0, rb * 0.85));
          r0 = Math.min(rb * 0.75, 0.25 + ab.len * 0.05);
        }
        const tp = tinePolyline(base, dir0, bend, ab.len, 8);
        side.abn.push({ type: ab.type, pts: tp, r: tp.map((_, i) => r0 + (0.07 - r0) * (i / 8)), len: ab.len, on: ab.on });
      });
      out.sides.push(side);
    }
    return out;
  };

  /* ---------------------------------------------------------------- scoring from geometry (B&C style) */
  WT.measureRack = function (geom) {
    const sheet = { sides: [], spread: 0 };
    let innerMax = [0, 0];
    geom.sides.forEach((s, si) => {
      const beam = r8(polyLen(s.beam.pts));
      const tines = {};
      for (const t of s.tines) tines[t.name] = r8(polyLen(t.pts));
      // circumferences measured at the stations: 2*pi*r of the tube there
      const H = s.stations.map((f) => {
        const idx = f * BEAM_N, i0 = Math.floor(idx), i1 = Math.min(BEAM_N, i0 + 1), t = idx - i0;
        const r = s.beam.r[i0] + (s.beam.r[i1] - s.beam.r[i0]) * t;
        return r8(2 * Math.PI * r);
      });
      const abn = s.abn.map((a) => ({ type: a.type, len: r8(polyLen(a.pts)) })).filter((a) => a.len >= 1);
      const typicalPts = 1 + Object.values(tines).filter((l) => l >= 1).length;
      sheet.sides.push({ beam, tines, H, abn, typicalPts, points: typicalPts + abn.length });
      // inside edge of the beam: lateral distance from centerline minus tube radius
      for (let i = 0; i <= BEAM_N; i++) innerMax[si] = Math.max(innerMax[si], Math.abs(s.beam.pts[i][0]) - s.beam.r[i]);
    });
    const [L, R] = sheet.sides;
    sheet.insideSpread = r8(innerMax[0] + innerMax[1]);
    sheet.spreadCredit = Math.min(sheet.insideSpread, Math.max(L.beam, R.beam));
    const names = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'];
    const sideTotal = (s) => s.beam + names.reduce((a, n) => a + (s.tines[n] || 0), 0) + s.H.reduce((a, b) => a + b, 0);
    let diffs = Math.abs(L.beam - R.beam);
    for (const n of names) diffs += Math.abs((L.tines[n] || 0) - (R.tines[n] || 0));
    for (let k = 0; k < 4; k++) diffs += Math.abs(L.H[k] - R.H[k]);
    const abnormal = [...L.abn, ...R.abn].reduce((a, b) => a + b.len, 0);
    sheet.diffs = r8(diffs);
    sheet.abnormal = r8(abnormal);
    sheet.grossTypical = r8(sheet.spreadCredit + sideTotal(L) + sideTotal(R));
    sheet.gross = r8(sheet.grossTypical + abnormal);
    sheet.netTypical = r8(sheet.grossTypical - diffs - abnormal);
    sheet.netNonTypical = r8(sheet.grossTypical - diffs + abnormal);
    sheet.isNT = abnormal >= 10;
    sheet.net = sheet.isNT ? sheet.netNonTypical : sheet.netTypical;
    sheet.pointsL = L.points; sheet.pointsR = R.points;
    sheet.points = L.points + R.points;
    sheet.outsideSpread = r8(Math.max(...geom.sides.map((s) => Math.max(...s.beam.pts.map((p) => Math.abs(p[0]))))) * 2);
    return sheet;
  };

  /* Grow a rack that hits a target gross: build, measure, correct once. The measurement is the score. */
  WT.growRack = function (style, age, targetGross, rng) {
    let comp = WT.genRackComponents(style, age, targetGross, rng);
    let geom = WT.buildRack(comp, style);
    let sheet = WT.measureRack(geom);
    if (Math.abs(sheet.gross - targetGross) > 2 && sheet.gross > 0) {
      const f = targetGross / sheet.gross;
      for (const s of comp.sides) {
        s.beam = Math.min(LIMITS.beam, s.beam * f);
        for (const n of s.names) s.tines[n] = Math.min(LIMITS[n], s.tines[n] * f);
        s.H = s.H.map((h, i) => Math.min(i === 0 ? LIMITS.H1 : LIMITS.H1 * 0.95, h * f));
        for (let i = 1; i < 4; i++) s.H[i] = Math.min(s.H[i], s.H[i - 1] - 0.05);
      }
      comp.spread = Math.min(LIMITS.spread, comp.spread * f, Math.min(comp.sides[0].beam, comp.sides[1].beam) * 0.98);
      comp.abn.forEach((a) => { a.len = clamp(a.len * f, LIMITS.abn[a.type][0], LIMITS.abn[a.type][1]); });
      geom = WT.buildRack(comp, style);
      sheet = WT.measureRack(geom);
    }
    return { comp, sheet };
  };

  // Compact storage: components only (geometry is rebuilt on demand, deterministically).
  WT.packRack = (comp) => ({
    s: r8(comp.spread), t: Math.round(comp.target), a: comp.age,
    L: packSide(comp.sides[0]), R: packSide(comp.sides[1]),
    x: comp.abn.map((a) => [a.type, a.side, r8(a.len), a.on || 0, +(a.at || a.u || a.ang || 0).toFixed(3)]),
  });
  function packSide(s) { return [r8(s.beam), s.names.map((n) => [n, r8(s.tines[n])]), s.H.map(r8)]; }
  WT.unpackRack = (p) => {
    const side = (q) => { const t = {}; q[1].forEach(([n, l]) => { t[n] = l; }); return { beam: q[0], names: q[1].map((x) => x[0]), tines: t, H: q[2].slice() }; };
    return {
      spread: p.s, target: p.t, age: p.a, sides: [side(p.L), side(p.R)],
      abn: p.x.map(([type, side2, len, on, v]) => (on ? { type, side: side2, len, on, at: v } : type === 'burr' ? { type, side: side2, len, ang: v } : { type, side: side2, len, u: v })),
    };
  };

  /* ---------------------------------------------------------------- body (real-world inches) */
  const BODY = {
    fawn: { sh: [26, 30], len: [42, 50], girth: [26, 30], neck: [10, 12] },
    doe1: { sh: [32, 35], len: [54, 60], girth: [31, 34], neck: [13, 15] },
    doe2: { sh: [33, 37], len: [58, 66], girth: [33, 37], neck: [14, 16] },
    b15: { sh: [33, 36], len: [56, 62], girth: [33, 35], neck: [15, 17] },
    b25: { sh: [35, 38], len: [60, 66], girth: [35, 38], neck: [17, 20] },
    b35: { sh: [37, 40], len: [64, 70], girth: [38, 41], neck: [19, 23] },
    b45: { sh: [38, 42], len: [66, 76], girth: [40, 46], neck: [22, 30] },
    b75: { sh: [38, 42], len: [66, 76], girth: [40, 45], neck: [20, 26] },
  };
  WT.BODY_TABLE = BODY;
  function bodyClass(sex, age) {
    if (age < 1) return 'fawn';
    if (sex === 'd') return age < 2 ? 'doe1' : 'doe2';
    if (age < 2) return 'b15'; if (age < 3) return 'b25'; if (age < 4) return 'b35'; if (age < 7) return 'b45'; return 'b75';
  }
  // rut swelling of the neck: thin early season, full late Oct-Dec
  WT.rutNeck = (day) => (day == null ? 1 : day < 19 ? 0.86 : day < 31 ? 0.95 : day < 61 ? 1.0 : 0.97);

  WT.bodyDims = function (deer, day) {
    const cls = bodyClass(deer.sex, deer.age), b = BODY[cls];
    const g = deer.bodyGene ?? 0;
    const wt = WT.CONFIG.deer.weights[deer.sex === 'b' ? 'buck' : 'doe'];
    const wr = WT.ageTable(wt, deer.age);
    const wpct = clamp(((deer.lw || (wr[0] + wr[1]) / 2) - wr[0]) / (wr[1] - wr[0]), -0.3, 1.4);
    const pct = clamp(0.5 + g * 0.18 + (wpct - 0.5) * 0.35, 0, 1);
    const pick = (r, p) => r[0] + (r[1] - r[0]) * p;
    const mature = deer.sex === 'b' ? clamp((deer.age - 2.5) / 2.5) : clamp((deer.age - 1.5) / 2) * 0.3;
    const old = clamp((deer.age - 6.5) / 2);
    let neck = pick(b.neck, clamp(pct + (wpct - 0.5) * 0.3));
    if (deer.sex === 'b') neck *= WT.rutNeck(day);
    return {
      cls, sh: pick(b.sh, pct), len: pick(b.len, clamp(pct + 0.05 * g)), girth: pick(b.girth, clamp(wpct * 0.6 + pct * 0.4)), neck,
      legRatio: deer.age < 1 ? 0.62 : deer.age < 2 ? 0.6 - 0.02 * (deer.sex === 'd') : 0.56 - mature * 0.05,
      chestDepth: 0.5 + mature * 0.12, bellySag: (deer.sex === 'b' ? mature * 0.7 : 0.15) + old * 0.4, sway: old * 0.8,
      faceLong: deer.sex === 'd' ? 1.1 : deer.age < 1 ? 0.75 : 1, earScale: deer.age < 1 ? 0.92 : 1, mature, old,
      spots: deer.age < 1 && (day ?? 30) < 25 ? clamp(1 - (day ?? 0) / 25) : 0,
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
