/* Whitetail Country: 3D deer model + pixel-art renderer.
   Every image of a deer (hunt view, binoculars, trail cam, trophy views) comes from here,
   from the same body measurements and the same antler geometry that the score is measured from.
   Pure JS: outputs RGBA buffers, so it runs in the browser and in Node (gallery tests). */
(function (root) {
  const WT = (root.WT = root.WT || {});
  const { add, sub, mul, dot, norm, cross } = WT.v3;
  const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

  /* ---------------------------------------------------------------- palettes */
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  // Art style spec: one limited palette, short ramps (dark -> light), banded toon shading lit from the upper left.
  const M = { COAT: 1, DARK: 2, WHITE: 3, BLACK: 4, ANTLER: 5, TIP: 6, EYE: 7, HOOF: 8, SPOT: 9, CROWN: 10, EARIN: 11, EYERING: 12, MUZZLE: 13, NOSE: 14, THROAT: 15, BURR: 16, EAR: 17 };
  WT.MAT = M;
  const PAL = {};
  PAL[M.COAT] = ['#7E6656', '#A38A73', '#BFA58C'].map(hex);
  PAL[M.EAR] = ['#7E6656', '#A38A73'].map(hex);
  PAL[M.DARK] = ['#6f5849', '#7E6656'].map(hex);
  PAL[M.CROWN] = ['#4E1E14'].map(hex);
  PAL[M.WHITE] = ['#d8ccbb', '#EFE3D3'].map(hex);
  PAL[M.THROAT] = ['#EFE3D3'].map(hex);
  PAL[M.SPOT] = ['#EFE3D3'].map(hex);
  PAL[M.EARIN] = ['#E8E6E6'].map(hex);
  PAL[M.EYERING] = ['#EEDFC8'].map(hex);
  PAL[M.EYE] = ['#1A1414'].map(hex);
  PAL[M.BLACK] = PAL[M.EYE];
  PAL[M.MUZZLE] = ['#B8B4C8'].map(hex);
  PAL[M.NOSE] = ['#2E2E3E'].map(hex);
  PAL[M.ANTLER] = ['#8C6E55', '#C4A688'].map(hex);
  PAL[M.TIP] = ['#C4A688'].map(hex);
  PAL[M.BURR] = ['#3E2418'].map(hex);
  PAL[M.HOOF] = ['#3a2a20'].map(hex);
  const OUTLINE = hex('#3A1E10');
  WT.PALETTE = PAL;

  /* ---------------------------------------------------------------- primitives */
  // Ellipsoid: center c, axes ax (3 unit vectors), radii r, material (number or fn(hit, n) -> number)
  const ell = (c, ax, r, mat, tag) => ({ k: 'e', c, ax, r, mat, tag });
  const cap = (a, b, ra, rb, mat, tag) => ({ k: 'c', a, b, ra, rb, mat, tag });
  const basis = (fwd, upHint) => {
    const f = norm(fwd);
    let s = cross(upHint || [0, 1, 0], f);
    if (Math.hypot(...s) < 1e-4) s = [1, 0, 0];
    s = norm(s);
    const u = norm(cross(f, s));
    return [s, u, f]; // x(side), y(up), z(forward)
  };
  const rotY = (p, a) => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];

  /* ---------------------------------------------------------------- the deer model */
  const rackCache = new Map();
  function rackGeom(deer) {
    if (!deer.rack || !deer.style) return null;
    const key = deer.id + ':' + deer.age + ':' + deer.rack.t + ':' + deer.rack.s;
    if (rackCache.has(key)) return rackCache.get(key);
    const g = WT.buildRack(WT.unpackRack(deer.rack), deer.style);
    if (rackCache.size > 300) rackCache.clear();
    rackCache.set(key, g);
    return g;
  }
  WT.rackGeom = rackGeom;

  /* pose: { head: 'alert' | 'up' | 'walk' | 'down', step: 0..1, earsBack } */
  WT.deerModel = function (deer, pose, day) {
    pose = pose || {};
    const D = WT.bodyDims(deer, day);
    const prims = [];
    const sz = D.sh / 40; // scale for parts not in the table
    const dv = (D.girth / Math.PI) * 1.3 * (1 + D.mature * 0.06); // hair and hide add depth over the tape girth
    const dw = (D.girth / Math.PI) * 0.8;
    const legs = D.sh - dv - 1.5;
    const torsoLen = D.len * 0.66;
    const yc = D.sh - 1.5 - dv / 2 - D.sway * 0.6;
    const isBuck = deer.sex === 'b';
    const spotsOn = D.spots > 0;
    const bodyMat = (hit, n) => {
      if (n[1] < -0.6) return M.WHITE;
      if (spotsOn && n[1] > 0.1 && Math.abs(hit[0]) < dw * 0.45) {
        const h = WT.hash2(Math.round(hit[2] / 2.2), Math.round(hit[0] / 2.2 + hit[1] / 3), deer.id);
        if (h < 0.18 * D.spots) return M.SPOT;
      }
      if (n[1] > 0.85) return M.DARK;
      return M.COAT;
    };
    // torso pieces: a straight back, deep chest, belly that drops with age, heavy hams
    const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    prims.push(ell([0, yc, -1], I3, [dw / 2, dv / 2 * 0.97, torsoLen / 2 * 0.93], bodyMat, 'body'));
    prims.push(ell([0, yc - dv * 0.02, torsoLen * 0.25], I3, [dw / 2 * 1.02, dv / 2 * (1.0 + D.mature * 0.07), torsoLen * 0.25], bodyMat, 'chest'));
    const tuck = isBuck ? 1 - D.mature : 0.6;
    prims.push(ell([0, yc - dv * 0.06 - D.bellySag * dv * 0.14, -torsoLen * 0.05], I3, [dw / 2 * 0.97, dv / 2 * (0.82 + D.bellySag * 0.16), torsoLen * (0.28 - tuck * 0.04)], bodyMat, 'belly'));
    prims.push(ell([0, yc + dv * 0.03 + D.sway * 0.8, -torsoLen * 0.33], I3, [dw / 2 * (0.98 - D.old * 0.08), dv / 2 * 0.97, torsoLen * 0.22], bodyMat, 'hips'));
    // legs (walking moves feet)
    const step = pose.step || 0;
    const fz = torsoLen * 0.3, hz = -torsoLen * 0.37;
    const legR = (D.cls === 'fawn' ? 0.82 : 1) * sz;
    const legPair = (front) => {
      for (const sgn of [-1, 1]) {
        const ph = Math.sin((step + (sgn > 0 ? 0.5 : 0) + (front ? 0 : 0.25)) * Math.PI * 2) * (pose.head === 'walk' ? 4 * sz : 0);
        const x = sgn * dw * 0.27;
        if (front) {
          prims.push(ell([x, yc - dv * 0.3, fz], I3, [2.4 * legR + dw * 0.03, dv * 0.34, 3.8 * sz], bodyMat, 'body'));
          const top = [x, yc - dv * 0.55, fz];
          const knee = [x, legs * 0.42, fz + ph * 0.4 + 0.3];
          const fet = [x, 2.4 * sz, fz + ph];
          prims.push(cap(top, knee, 1.9 * legR, 1.2 * legR, M.COAT, 'leg'));
          prims.push(cap(knee, fet, 1.05 * legR, 0.85 * legR, M.COAT, 'leg'));
          prims.push(cap(fet, [x, 0.35, fz + ph + 1.1], 0.85 * legR, 0.8 * legR, M.HOOF, 'leg'));
        } else {
          prims.push(ell([x, yc - dv * 0.2, hz + 1], I3, [dw * 0.21 + 1.2 * legR, dv * 0.44, 6.6 * sz], bodyMat, 'thigh'));
          const hock = [x, legs * 0.5, hz - 3.6 * sz + ph * 0.4];
          const fet = [x, 2.4 * sz, hz - 1.8 * sz + ph];
          prims.push(cap([x, yc - dv * 0.55, hz + 0.5], hock, 2.1 * legR, 1.2 * legR, M.COAT, 'leg'));
          prims.push(cap(hock, fet, 1.0 * legR, 0.85 * legR, M.COAT, 'leg'));
          prims.push(cap(fet, [x, 0.35, hz - 1.2 * sz + ph], 0.85 * legR, 0.8 * legR, M.HOOF, 'leg'));
        }
      }
    };
    legPair(true); legPair(false);
    // tail
    prims.push(ell([0, yc + dv * 0.26, -torsoLen / 2 - 1.2 * sz], basis([0, -0.75, -0.65]), [2.1 * sz, 1.3 * sz, 4 * sz], (h, n) => (n[1] < 0 || n[2] < -0.75 ? M.WHITE : M.DARK), 'tail'));
    // neck + head
    const neckR = D.neck / (2 * Math.PI);
    const nb = [0, yc + dv * 0.16, torsoLen * 0.37];
    let hb, hd;
    const H = pose.head || 'alert';
    if (H === 'down') { hb = add(nb, [0, -(yc + dv * 0.22) + 9 * sz, 12 * sz]); hd = norm([0, -0.95, 0.3]); }
    else if (H === 'walk') { hb = add(nb, [0, 7 * sz, 11 * sz]); hd = norm([0, -0.45, 1]); }
    else if (H === 'up') { hb = add(nb, [0, 10.5 * sz, 9.5 * sz]); hd = norm([0, -0.55, 1]); }
    else if (H === 'mount') { hb = add(nb, [0, 12.5 * sz, 5 * sz]); hd = norm([0, -0.85, 0.55]); }
    else { hb = add(nb, [0, 12 * sz, 8.5 * sz]); hd = norm([0, -0.4, 1]); }
    if (pose.turn) hd = norm(rotY(hd, pose.turn));
    const baseR = neckR * (1.12 + D.mature * 0.22);
    const neckMat = (hit, n) => {
      const t = clamp(dot(sub(hit, nb), norm(sub(hb, nb))) / Math.hypot(...sub(hb, nb)));
      if ((t > 0.62 && n[1] < -0.15) || (t > 0.42 && t < 0.86 && n[2] > 0.45)) return M.THROAT; // cream throat patch
      return n[1] > 0.8 ? M.DARK : M.COAT;
    };
    prims.push(cap(nb, hb, baseR, neckR * 0.85, neckMat, 'neck'));
    prims.push(cap(add(nb, [0, -dv * 0.12, 1.5]), add(nb, [0, dv * 0.05, -3]), baseR * 0.95, baseR * 0.85, bodyMat, 'chest'));
    const [hs, hu, hf] = basis(hd, [0, 1, 0]);
    const at = (p) => add(add(add(hb, mul(hs, p[0])), mul(hu, p[1])), mul(hf, p[2]));
    const hsz = sz * (D.cls === 'fawn' ? 0.82 : 1);
    const fl = D.faceLong;
    // dark rutty crown between the antlers on bucks; plain on does
    const crownOn = isBuck && deer.age >= 1.5;
    const crownAt = at([0, 3.1 * sz, 0.6 * sz]);
    const headMat = (hit, n) => {
      const d = Math.hypot(...sub(hit, crownAt));
      if (d < (crownOn ? 2.1 + D.mature * 0.5 : 1.6) * sz && dot(n, hu) > 0.2) return crownOn ? M.CROWN : M.DARK;
      return dot(n, hu) > 0.75 ? M.DARK : M.COAT;
    };
    prims.push(ell(at([0, 1.2 * hsz, 2.2 * hsz]), [hs, hu, hf], [3.1 * hsz, 2.9 * hsz, 3.7 * hsz], headMat, 'head'));
    prims.push(ell(at([0, 0.4 * hsz, 4.4 * hsz]), [hs, hu, hf], [2.3 * hsz, 2.2 * hsz, 2.6 * hsz], headMat, 'head'));
    prims.push(ell(at([0, 0.3 * hsz, 6.4 * hsz * fl]), [hs, hu, hf], [1.55 * hsz, 1.75 * hsz, 3.3 * hsz * fl], (hit, n) => (dot(sub(hit, at([0, 0, 9.2 * hsz * fl])), hf) > -2.0 ? M.MUZZLE : dot(n, hu) > 0.7 ? M.DARK : M.COAT), 'snout'));
    prims.push(ell(at([0, 0.45 * hsz, 9.5 * hsz * fl]), [hs, hu, hf], [0.95 * hsz, 0.8 * hsz, 0.6 * hsz], M.NOSE, 'nose'));
    for (const sgn of [-1, 1]) {
      prims.push(ell(at([sgn * 2.5 * hsz, 1.65 * hsz, 3.3 * hsz]), [hs, hu, hf], [0.5 * hsz, 0.55 * hsz, 0.7 * hsz], M.EYE, 'eye'));
      // white eye ring
      prims.push(ell(at([sgn * 2.4 * hsz, 1.65 * hsz, 3.2 * hsz]), [hs, hu, hf], [0.6 * hsz, 0.95 * hsz, 1.1 * hsz], M.EYERING, 'eyering'));
    }
    // ears: the judging ruler. ~6.5" tall, ~17" tip to tip when alert. Constant size on adults.
    const ear = D.earScale;
    const earAng = (pose.earsBack ? 72 : H === 'down' ? 50 : H === 'mount' ? 70 : 60) * Math.PI / 180;
    for (const sgn of [-1, 1]) {
      const base = at([sgn * 2.1 * hsz, 2.7 * hsz, 0.3 * hsz]);
      const axis = norm(add(add(mul(hs, sgn * Math.sin(earAng)), mul([0, 1, 0], Math.cos(earAng))), mul(hf, -0.15)));
      const opening = norm(add(hf, [0, 0, H === 'mount' || H === 'down' ? 1.2 : 0.3])); // ears cup forward
      const flat = norm(sub(opening, mul(axis, dot(opening, axis))));
      const ax = basis(axis, flat);
      prims.push(ell(add(base, mul(axis, 3.25 * ear)), [ax[1], ax[2], ax[0]].map((v, i) => (i === 0 ? flat : i === 1 ? axis : norm(cross(flat, axis)))), [0.55, 3.25 * ear, 1.65 * ear], (hit, n) => (Math.abs(dot(n, flat)) > 0.45 && dot(n, hf) > -0.1 ? M.EARIN : M.EAR), 'ear'));
    }
    // antlers
    const g = isBuck && deer.age >= 1.5 ? rackGeom(deer) : null;
    if (g) {
      const rb = at([0, 2.9 * hsz, 1.3 * hsz]);
      // rack frame: x side, y skull-up (tilted back a touch), z forward
      const ry = norm(add(add(hu, mul(hf, -0.25)), mul([0, 1, 0], H === 'mount' || H === 'down' ? 0.9 : 0))), rz = norm(cross(hs, ry));
      const toW = (p) => add(add(add(rb, mul(hs, p[0])), mul(ry, p[1])), mul(rz, p[2]));
      for (const s of g.sides) {
        // pedicle
        prims.push(cap(toW([s.sgn * 1.2, -1.2, 0]), toW(s.beam.pts[0]), s.beam.r[0] * 1.05, s.beam.r[0] * 1.15, M.BURR, 'antler'));
        const tube = (pts, rr, tipFrom, burrTo) => {
          for (let i = 1; i < pts.length; i++) {
            const f = i / (pts.length - 1);
            prims.push(cap(toW(pts[i - 1]), toW(pts[i]), rr[i - 1], rr[i], f > tipFrom ? M.TIP : f <= (burrTo || 0) ? M.BURR : M.ANTLER, 'antler'));
          }
        };
        tube(s.beam.pts, s.beam.r, 0.85, 0.1);
        s.tines.forEach((t) => tube(t.pts, t.r, 0.6));
        s.abn.forEach((t) => tube(t.pts, t.r, 0.65));
      }
    }
    const headTop = at([0, 3 * hsz, 1.5 * hsz]);
    return { prims, face: { eyes: [-1, 1].map((sg) => at([sg * 2.7 * hsz, 1.65 * hsz, 3.3 * hsz])), fwd: hf, side: hs }, anchors: { head: at([0, 2, 3]), headTop, chest: [0, yc, torsoLen * 0.3], body: [0, yc, 0], ground: [0, 0, 0], nose: at([0, 0, 9 * hsz]) }, dims: D, torsoLen };
  };

  /* ---------------------------------------------------------------- ray caster */
  /* view: { W, H, scale (px per inch), yaw (deg: 0 = deer faces camera, 90 = broadside), elev (deg), center: [x,y,z],
             outline, mode: 'day' | 'low' | 'ir', bg: [r,g,b] | null, skip: Set of tags } */
  WT.renderModel = function (model, view) {
    const W = view.W | 0, H = view.H | 0, scale = view.scale;
    const yaw = (view.yaw || 0) * Math.PI / 180, el = (view.elev || 0) * Math.PI / 180;
    const toCam = [Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el)];
    const f = mul(toCam, -1);
    let right = cross(f, [0, 1, 0]);
    if (Math.hypot(...right) < 1e-4) right = rotY([1, 0, 0], yaw);
    right = norm(right);
    const up = norm(cross(right, f));
    const C = view.center || model.anchors.body;
    const light = norm(add(add(mul(right, -0.6), mul(up, 0.75)), mul(toCam, 0.45)));
    const zb = new Float32Array(W * H).fill(Infinity);
    const mat = new Uint8Array(W * H);
    const shade = new Float32Array(W * H);
    const tagBuf = view.wantTags ? new Uint8Array(W * H) : null;
    const tagIds = { antler: 1, head: 2, ear: 3, body: 4 };
    const proj = (p) => { const d = sub(p, C); return [W / 2 + dot(d, right) * scale, H / 2 - dot(d, up) * scale, -dot(d, toCam)]; };
    const put = (i, depth, m, n, tag) => {
      if (depth >= zb[i]) return;
      zb[i] = depth; mat[i] = m;
      shade[i] = 0.32 + 0.78 * Math.max(0, dot(n, light)) + 0.12 * Math.max(0, dot(n, toCam));
      if (tagBuf) tagBuf[i] = tagIds[tag] || 4;
    };
    const skip = view.skip;
    for (const pr of model.prims) {
      if (skip && pr.tag && skip.has(pr.tag)) continue;
      if (pr.k === 'e') {
        const [sx, sy] = proj(pr.c);
        const rmax = Math.max(pr.r[0], pr.r[1], pr.r[2]) * scale + 1;
        const x0 = Math.max(0, Math.floor(sx - rmax)), x1 = Math.min(W - 1, Math.ceil(sx + rmax));
        const y0 = Math.max(0, Math.floor(sy - rmax)), y1 = Math.min(H - 1, Math.ceil(sy + rmax));
        if (x0 > x1 || y0 > y1) continue;
        const [a0, a1, a2] = pr.ax;
        const dl = [dot(f, a0) / pr.r[0], dot(f, a1) / pr.r[1], dot(f, a2) / pr.r[2]];
        const A = dl[0] * dl[0] + dl[1] * dl[1] + dl[2] * dl[2];
        for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
          const ox = (px + 0.5 - W / 2) / scale, oy = (H / 2 - py - 0.5) / scale;
          const P = add(add(add(C, mul(right, ox)), mul(up, oy)), mul(toCam, 500));
          const d = sub(P, pr.c);
          const q = [dot(d, a0) / pr.r[0], dot(d, a1) / pr.r[1], dot(d, a2) / pr.r[2]];
          const B = q[0] * dl[0] + q[1] * dl[1] + q[2] * dl[2];
          const Cq = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] - 1;
          const disc = B * B - A * Cq;
          if (disc < 0) continue;
          const t = (-B - Math.sqrt(disc)) / A;
          const i = py * W + px;
          if (t >= zb[i]) continue;
          const qh = [(q[0] + t * dl[0]) / pr.r[0], (q[1] + t * dl[1]) / pr.r[1], (q[2] + t * dl[2]) / pr.r[2]];
          const n = norm(add(add(mul(a0, qh[0]), mul(a1, qh[1])), mul(a2, qh[2])));
          const hit = add(P, mul(f, t));
          put(i, t, typeof pr.mat === 'function' ? pr.mat(hit, n) : pr.mat, n, pr.tag);
        }
      } else {
        const A = proj(pr.a), B = proj(pr.b);
        const rmax = Math.max(pr.ra, pr.rb) * scale + 1;
        // keep hair-thin points visible as single pixels
        const minR = 0.5 / scale;
        const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0]) - rmax)), x1 = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0]) + rmax));
        const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1]) - rmax)), y1 = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1]) + rmax));
        if (x0 > x1 || y0 > y1) continue;
        const ex = B[0] - A[0], ey = B[1] - A[1], L2 = ex * ex + ey * ey;
        for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
          const cx = px + 0.5, cy = py + 0.5;
          let t = L2 > 1e-9 ? ((cx - A[0]) * ex + (cy - A[1]) * ey) / L2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = A[0] + ex * t, qy = A[1] + ey * t;
          const dx = (cx - qx) / scale, dy = (cy - qy) / scale;
          const dd = Math.sqrt(dx * dx + dy * dy);
          const r = Math.max(minR, pr.ra + (pr.rb - pr.ra) * t);
          if (dd > r) continue;
          const zc = A[2] + (B[2] - A[2]) * t;
          const h = Math.sqrt(Math.max(0, r * r - dd * dd));
          const depth = 500 + zc - h;
          const i = py * W + px;
          if (depth >= zb[i]) continue;
          const n = norm(add(add(mul(right, dx / r), mul(up, -dy / r)), mul(toCam, h / r)));
          const hit = add(add(pr.a, mul(sub(pr.b, pr.a), t)), mul(toCam, h));
          put(i, depth, typeof pr.mat === 'function' ? pr.mat(hit, n) : pr.mat, n, pr.tag);
        }
      }
    }
    // shade -> fixed palette ramp (toon bands), ear outline, cleanup, modes
    const isAnt = (m) => m === M.ANTLER || m === M.TIP || m === M.BURR;
    const isEar = (m) => m === M.EARIN || m === M.EAR;
    const ci = new Int16Array(W * H).fill(-1); // chosen ramp index
    for (let i = 0; i < W * H; i++) {
      const m = mat[i]; if (!m) continue;
      const ramp = PAL[m];
      ci[i] = Math.min(ramp.length - 1, Math.max(0, Math.floor(clamp((shade[i] - 0.3) / 0.95) * ramp.length)));
    }
    // cleanup: an isolated body pixel takes the color its 4 neighbours agree on
    const key = (i) => mat[i] * 8 + ci[i];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, m = mat[i];
      if (!m || isAnt(m) || m === M.EYE || m === M.NOSE || m === M.EYERING) continue;
      const nb = [i - 1, i + 1, i - W, i + W];
      if (nb.some((k) => !mat[k])) continue;
      const k0 = key(nb[0]);
      if (nb.every((k) => key(k) === k0) && k0 !== key(i)) { mat[i] = mat[nb[0]]; ci[i] = ci[nb[0]]; }
    }
    // simplify: each body pixel takes the most common color among itself and its 8 neighbours (2 passes)
    for (let pass = 0; pass < 2; pass++) {
      const nm = mat.slice(), nc = ci.slice();
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x, m = mat[i];
        if (!m || isAnt(m) || m === M.EYE || m === M.NOSE || m === M.EYERING || isEar(m)) continue;
        const cnt = new Map();
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const k = i + dy * W + dx; const mm = mat[k];
          if (!mm || isAnt(mm) || mm === M.EYE || mm === M.NOSE || mm === M.EYERING || isEar(mm)) continue;
          const kk = key(k); cnt.set(kk, (cnt.get(kk) || 0) + 1);
        }
        let best = key(i), bn = cnt.get(best) || 0;
        for (const [kk, n] of cnt) if (n > bn + 1) { best = kk; bn = n; }
        nm[i] = best >> 3; nc[i] = best & 7;
      }
      mat.set(nm); ci.set(nc);
    }
    // stray single pixels floating in empty space (not antler tips)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!mat[i] || isAnt(mat[i])) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && mat[yy * W + xx]) n++; }
      if (n === 0) mat[i] = 0;
    }
    const out = new Uint8ClampedArray(W * H * 4);
    const bg = view.bg;
    const mode = view.mode || 'day';
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let i = 0; i < W * H; i++) {
      const m = mat[i];
      const o = i * 4;
      if (!m) { if (bg) { out[o] = bg[0]; out[o + 1] = bg[1]; out[o + 2] = bg[2]; out[o + 3] = 255; } continue; }
      const x = i % W, y = (i / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      let c = PAL[m][ci[i]];
      if (isEar(m)) {
        const edge = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1].some((k) => k < 0 || !mat[k]); // outer edge only
        if (edge) c = OUTLINE;
      } else if (view.outline && !isAnt(m)) {
        const edge = (x > 0 && !mat[i - 1]) || (x < W - 1 && !mat[i + 1]) || (y > 0 && !mat[i - W]) || (y < H - 1 && !mat[i + W]);
        if (edge) c = PAL[M.COAT][0];
      }
      if (mode === 'ir') {
        let l = (c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15);
        l = m === M.EYE ? 255 : isAnt(m) || m === M.WHITE || m === M.THROAT || m === M.EARIN ? l * 1.15 + 20 : l * 0.9 + 8;
        out[o] = l; out[o + 1] = l; out[o + 2] = l;
      } else if (mode === 'low') {
        const l = (c[0] + c[1] + c[2]) / 3;
        out[o] = (c[0] * 0.45 + l * 0.35) * 0.8; out[o + 1] = (c[1] * 0.45 + l * 0.35) * 0.82; out[o + 2] = (c[2] * 0.5 + l * 0.4) * 0.95;
      } else { out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; }
      out[o + 3] = 255;
    }
    // hand-crafted eye sprites on top of the 3D render (art spec 5.5): cream ring, dark eye
    if (model.face && view.face !== false && scale >= 1.2 && mode !== 'ir') {
      const facing = dot(model.face.fwd, toCam);
      for (const e of model.face.eyes) {
        const side = dot(sub(e, model.anchors.head), toCam);
        if (facing < -0.35 || side < -0.6) continue;
        const [ex, ey, ez] = proj(e);
        const px = Math.round(ex - 0.5), py = Math.round(ey - 0.5);
        if (px < 1 || py < 1 || px >= W - 2 || py >= H - 2) continue;
        const zi = zb[py * W + px];
        if (!(zi < Infinity) || 500 + ez > zi + 2.2) continue;
        const ring = PAL[M.EYERING][0], eye = PAL[M.EYE][0];
        const big = scale >= 3.0;
        const paint = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H || !mat[y * W + x]) return; const o = (y * W + x) * 4; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255; };
        const r = big ? 2 : 1;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.abs(dx) + Math.abs(dy) <= r + (big ? 1 : 0)) paint(px + dx, py + dy, ring);
        paint(px, py, eye); if (big) { paint(px + (dot(e, model.face.side) > 0 ? 1 : -1), py, eye); }
      }
    }
    return { data: out, W, H, bounds: x1 >= 0 ? { x0, y0, x1, y1 } : null, tags: tagBuf, proj };
  };

  // Convenience: render a deer
  WT.renderDeer = function (deer, view) {
    const model = WT.deerModel(deer, view.pose, view.day);
    let center = view.center;
    if (typeof center === 'string') center = model.anchors[center];
    return WT.renderModel(model, Object.assign({}, view, { center }));
  };

  /* Low-resolution render scaled up with hard pixels: this is how distance and optics limit detail.
     resPpi = how many inches per pixel your eyes/optics can resolve; dispPpi = how big it's drawn. */
  WT.renderDeerLimited = function (deer, view, resPpi, dispPpi) {
    const k = clamp(resPpi / dispPpi, 0.02, 1);
    if (k >= 0.999) return WT.renderDeer(deer, Object.assign({}, view, { scale: dispPpi }));
    const sw = Math.max(1, Math.round(view.W * k)), sh = Math.max(1, Math.round(view.H * k));
    const small = WT.renderDeer(deer, Object.assign({}, view, { W: sw, H: sh, scale: dispPpi * (sw / view.W), outline: view.outline && k > 0.5 }));
    const out = new Uint8ClampedArray(view.W * view.H * 4);
    for (let y = 0; y < view.H; y++) {
      const sy = Math.min(sh - 1, Math.floor(y * sh / view.H));
      for (let x = 0; x < view.W; x++) {
        const sx = Math.min(sw - 1, Math.floor(x * sw / view.W));
        const si = (sy * sw + sx) * 4, o = (y * view.W + x) * 4;
        out[o] = small.data[si]; out[o + 1] = small.data[si + 1]; out[o + 2] = small.data[si + 2]; out[o + 3] = small.data[si + 3];
      }
    }
    return { data: out, W: view.W, H: view.H, bounds: small.bounds && { x0: small.bounds.x0 / k, y0: small.bounds.y0 / k, x1: (small.bounds.x1 + 1) / k, y1: (small.bounds.y1 + 1) / k } };
  };

  /* Trophy views at a fixed real-world scale: front, 45, side, top. */
  WT.TROPHY_VIEWS = [
    { id: 'front', name: 'Front', yaw: 0, elev: 6 },
    { id: 'q45', name: '45°', yaw: 45, elev: 10 },
    { id: 'side', name: 'Side', yaw: 90, elev: 4 },
    { id: 'top', name: 'Top-down', yaw: 0, elev: 89.5 },
  ];
  // Shoulder mount: front-facing head and rack at the reference scale (~60 x 80 px for a big buck).
  WT.MOUNT_PPI = 1.6;
  WT.renderMount = function (deer, W, H, ppi, yaw) {
    const model = WT.deerModel(deer, { head: 'mount' }, 40);
    const center = add(model.anchors.head, [0, 6, 0]);
    return WT.renderModel(model, { W, H, scale: ppi || WT.MOUNT_PPI, yaw: yaw || 0, elev: 12, center, skip: new Set(['body', 'chest', 'belly', 'hips', 'thigh', 'tail', 'leg']) });
  };
  WT.renderTrophy = function (deer, viewId, W, H, ppi, day) {
    const v = WT.TROPHY_VIEWS.find((x) => x.id === viewId);
    const model = WT.deerModel(deer, { head: 'up' }, day ?? 40);
    const top = viewId === 'top';
    const center = top ? add(model.anchors.headTop, [0, 0, 4]) : [0, 36, 5];
    return WT.renderModel(model, { W, H, scale: ppi, yaw: top ? 180 : v.yaw, elev: v.elev, center, skip: top ? new Set(['body', 'chest', 'belly', 'hips', 'thigh', 'tail', 'neck']) : null });
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
