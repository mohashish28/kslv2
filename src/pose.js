// Shapes for the presets. A shape is a set of straight creases plus curl,
// twist, wave or a tube (rolled up tight). Everything on the far side of a crease (away from the
// paper centre) turns around it over a narrow band; creases never cross, so
// their far sides nest and each part of the sheet gets one combined
// transform. The physical paper is pulled into these shapes, then let go.

const BAND = 3; // half width of a crease, mm
const TUBE_R0 = 14, TUBE_GAP = 3.6; // core radius and layer pitch of a rolled-up receipt, mm
const sinc = t => (Math.abs(t) < 1e-4 ? 1 - (t * t) / 6 : Math.sin(t) / t);
const cosc = t => (Math.abs(t) < 1e-4 ? t / 2 : (1 - Math.cos(t)) / t);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// line through (px,py) along (dx,dy), clipped to the sheet → [x0,y0,x1,y1]
function clipLine(px, py, dx, dy, W, L) {
  let s0 = -Infinity, s1 = Infinity;
  const clip = (p, d, lo, hi) => {
    if (Math.abs(d) < 1e-9) return p >= lo && p <= hi;
    let a = (lo - p) / d, b = (hi - p) / d;
    if (a > b) [a, b] = [b, a];
    s0 = Math.max(s0, a); s1 = Math.min(s1, b);
    return true;
  };
  if (!clip(px, dx, 0, W) || !clip(py, dy, 0, L) || s0 >= s1) return null;
  return [px + dx * s0, py + dy * s0, px + dx * s1, py + dy * s1];
}
function ptSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, t = clamp(((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
}
function segsCross(a, b) {
  const o = (ax, ay, bx, by, cx, cy) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  return o(a[0], a[1], a[2], a[3], b[0], b[1]) !== o(a[0], a[1], a[2], a[3], b[2], b[3]) &&
    o(b[0], b[1], b[2], b[3], a[0], a[1]) !== o(b[0], b[1], b[2], b[3], a[2], a[3]);
}
function segDist(a, b) {
  if (segsCross(a, b)) return 0;
  return Math.min(ptSeg(a[0], a[1], ...b), ptSeg(a[2], a[3], ...b), ptSeg(b[0], b[1], ...a), ptSeg(b[2], b[3], ...a));
}

function foldMatrix(k) {
  const { cx, cy, tx, ty, nx, ny, b, th } = k, c = Math.cos(th), s = Math.sin(th);
  const offN = -b * c - b + 2 * b * sinc(th), offZ = -b * s + 2 * b * cosc(th);
  const m00 = tx * tx + c * nx * nx, m01 = tx * ty + c * nx * ny, m02 = -s * nx;
  const m10 = ty * tx + c * ny * nx, m11 = ty * ty + c * ny * ny, m12 = -s * ny;
  const m20 = s * nx, m21 = s * ny, m22 = c;
  return [
    m00, m01, m02, cx + nx * offN - (m00 * cx + m01 * cy),
    m10, m11, m12, cy + ny * offN - (m10 * cx + m11 * cy),
    m20, m21, m22, offZ - (m20 * cx + m21 * cy),
  ];
}
function mul(A, B) {
  const r = new Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r[i * 4 + j] = A[i * 4] * B[j] + A[i * 4 + 1] * B[4 + j] + A[i * 4 + 2] * B[8 + j];
    r[i * 4 + 3] = A[i * 4] * B[3] + A[i * 4 + 1] * B[7] + A[i * 4 + 2] * B[11] + A[i * 4 + 3];
  }
  return r;
}

// (x, y) on the sheet in mm (y down from the top) → [X, Y, Z] in mm,
// centred on the sheet, Y up, front facing +Z.
function makePose(W, L, creases = [], mods = {}) {
  const ax = 0, ay = 0.013;
  const cs = creases.map(c => {
    const x0 = c.x0 - W / 2, y0 = L / 2 - c.y0, x1 = c.x1 - W / 2, y1 = L / 2 - c.y1;
    let tx = x1 - x0, ty = y1 - y0;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    let nx = ty, ny = -tx;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if ((ax - cx) * nx + (ay - cy) * ny > 0) { nx = -nx; ny = -ny; }
    return { cx, cy, tx, ty, nx, ny, b: c.band || BAND, th: (c.angle * Math.PI) / 180, depth: 0, parent: -1, C: null };
  });
  const inside = cs.map(k => {
    const qx = k.cx + k.nx * (k.b + 0.6), qy = k.cy + k.ny * (k.b + 0.6);
    return cs.map(j => j !== k && (qx - j.cx) * j.nx + (qy - j.cy) * j.ny > j.b);
  });
  cs.forEach((k, i) => { k.depth = inside[i].filter(Boolean).length; });
  cs.forEach((k, i) => {
    let best = -1;
    inside[i].forEach((v, j) => { if (v && (best < 0 || cs[j].depth > cs[best].depth)) best = j; });
    k.parent = best;
  });
  [...cs.keys()].sort((a, b) => cs[a].depth - cs[b].depth).forEach(i => {
    const k = cs[i], F = foldMatrix(k);
    k.C = k.parent >= 0 ? mul(cs[k.parent].C, F) : F;
  });
  const { curl = 0, twist = 0, wave = 0, tube = 0 } = mods;

  // Rolled up from the bottom end into a tight scroll, print outside: the
  // bend of an Archimedean spiral (core TUBE_R0, layers TUBE_GAP apart),
  // traced down the sheet from the top end, which stays the outer edge.
  // While it rolls (tube 0…1) only the bottom share is rolled and the rest
  // lies flat, like a carpet: the roll grows and travels up the sheet, its
  // layers turning together instead of sliding through each other.
  let roll = null;
  const ds = 0.5;
  if (tube) {
    const g = TUBE_GAP / (2 * Math.PI), N = Math.ceil(L / ds);
    roll = new Float32Array((N + 2) * 2);
    let ry = L / 2, rz = 0, phi = 0;
    roll[0] = ry; roll[1] = rz;
    for (let i = 0; i <= N; i++) {
      const s = Math.max(0, L - (i + 0.5) * ds); // length from the inner end
      const k = s < tube * L ? 1 / Math.sqrt(TUBE_R0 * TUBE_R0 + 2 * g * s) : 0, mid = phi + (k * ds) / 2;
      ry -= Math.cos(mid) * ds; rz -= Math.sin(mid) * ds; phi += k * ds;
      roll[2 * i + 2] = ry; roll[2 * i + 3] = rz;
    }
  }

  return (x, y, o) => {
    const X = x - W / 2, Y = L / 2 - y, Z = 0;
    let deep = -1, dd = -1, band = -1, bd = 0;
    for (let k = 0; k < cs.length; k++) {
      const c = cs[k], d = (X - c.cx) * c.nx + (Y - c.cy) * c.ny;
      if (d > c.b) { if (c.depth > dd) { dd = c.depth; deep = k; } }
      else if (d >= -c.b) { band = k; bd = d; }
    }
    let px = X, py = Y, pz = Z, M = null;
    if (band >= 0) {
      const c = cs[band], s = (X - c.cx) * c.tx + (Y - c.cy) * c.ty, u = bd + c.b, ph = (c.th * u) / (2 * c.b);
      const dn = -c.b + u * sinc(ph), dz = u * cosc(ph);
      px = c.cx + s * c.tx + dn * c.nx; py = c.cy + s * c.ty + dn * c.ny; pz = dz;
      if (c.parent >= 0) M = cs[c.parent].C;
    } else if (deep >= 0) M = cs[deep].C;
    if (M) {
      o[0] = M[0] * px + M[1] * py + M[2] * pz + M[3];
      o[1] = M[4] * px + M[5] * py + M[6] * pz + M[7];
      o[2] = M[8] * px + M[9] * py + M[10] * pz + M[11];
    } else { o[0] = px; o[1] = py; o[2] = pz; }
    if (twist) {
      const a = (twist * Math.PI * o[1]) / L, ca = Math.cos(a), sa = Math.sin(a), qx = o[0], qz = o[2];
      o[0] = qx * ca + qz * sa; o[2] = -qx * sa + qz * ca;
    }
    if (wave) o[2] += wave * 6 * Math.sin(o[1] / 12);
    if (roll) {
      const f = clamp((L / 2 - o[1]) / ds, 0, roll.length / 2 - 1.001), i = Math.floor(f), t = f - i;
      o[1] = roll[2 * i] + (roll[2 * i + 2] - roll[2 * i]) * t;
      o[2] = roll[2 * i + 1] + (roll[2 * i + 3] - roll[2 * i + 1]) * t;
    }
    if (curl) {
      const t = ((curl * Math.PI * 1.25) / L) * o[1], qy = o[1], qz = o[2];
      o[1] = qy * sinc(t) - qz * Math.sin(t);
      o[2] = qy * cosc(t) + qz * Math.cos(t);
    }
    return o;
  };
}

// the crease that folds sheet point (uc, vc) onto (uj, vj): the line halfway
// between them, square to the segment joining them
function foldLine(W, L, uc, vc, uj, vj) {
  const seg = clipLine((uc + uj) / 2, (vc + vj) / 2, vc - vj, uj - uc, W, L);
  return seg && { x0: seg[0], y0: seg[1], x1: seg[2], y1: seg[3], band: BAND };
}

const crease = (W, L, px, py, deg, angle) => {
  const a = (deg * Math.PI) / 180;
  const seg = clipLine(px, py, Math.cos(a), Math.sin(a), W, L);
  return seg && { x0: seg[0], y0: seg[1], x1: seg[2], y1: seg[3], angle, band: BAND };
};

function randomCreases(W, L, want, rnd, maxTilt, angleFn) {
  const cs = [];
  for (let t = 0; t < 400 && cs.length < want; t++) {
    const c = crease(W, L, rnd() * W, L * (0.06 + rnd() * 0.88), (rnd() - 0.5) * 2 * maxTilt, angleFn());
    if (!c) continue;
    const seg = [c.x0, c.y0, c.x1, c.y1];
    if (Math.hypot(seg[2] - seg[0], seg[3] - seg[1]) < 20) continue;
    if (cs.every(o => segDist(seg, [o.x0, o.y0, o.x1, o.y1]) > 4 * BAND + 4)) cs.push(c);
  }
  return cs;
}

// Random creases (angles as sizes) given their directions so the sheet
// zigzags out from the middle both ways: each crease folds back against the
// way the panels before it have turned, so the turns never add up past
// flat-on-top and no panel swings round through the others; the two ends
// start off to opposite faces of the middle (first: which way the lower one
// goes), so they never land on the same face and cross each other there.
function zigzag(cs, L, first) {
  for (const side of [1, -1]) {
    const mid = c => ((c.y0 + c.y1) / 2 - L / 2) * side;
    let turn = 0;
    for (const c of cs.filter(c => mid(c) > 0).sort((a, b) => mid(a) - mid(b))) {
      c.angle *= turn ? -Math.sign(turn) : first * side;
      turn += c.angle;
    }
  }
  return cs;
}

const PRESETS = ['flat', 'curl', 'roll', 'accordion', 'fan', 'half', 'thirds', 'corners', 'twist', 'wave', 'crumple', 'tube', 'random'];

// name → { creases, mods }
function presetShape(name, W, L, rnd = Math.random) {
  const cs = [], mods = {};
  const n = clamp(Math.round(L / 42), 3, 14);
  const s = () => (rnd() < 0.5 ? 1 : -1);
  const across = (y, a, tilt = 0) => cs.push(crease(W, L, W / 2, y, tilt, a));
  switch (name) {
    case 'flat': break;
    case 'soft': mods.curl = 0.16; break;
    case 'curl': mods.curl = 0.55; break;
    case 'roll': mods.curl = 1.5; break;
    case 'accordion': for (let i = 1; i < n; i++) across((L * i) / n, i % 2 ? 118 : -118); break;
    case 'fan': for (let i = 1; i < n; i++) across((L * i) / n, i % 2 ? 110 : -110, i % 2 ? 7 : -7); break;
    case 'half': across(L / 2 + 0.6, 170); break;
    case 'thirds': across(L / 3, 165); across((2 * L) / 3, -165); break;
    case 'corners': {
      const k = Math.min(26, W * 0.4);
      cs.push(crease(W, L, W - k, 0, 45, 172), crease(W, L, 0, L - k, 45, -172));
      mods.curl = 0.1;
      break;
    }
    case 'twist': mods.twist = 0.75; break;
    case 'wave': mods.wave = 1; mods.curl = 0.1; break;
    // crumpled paper is many sharp creases every which way, not a squashed
    // sheet: the more and the deeper, the tighter the wad
    case 'crumple':
      cs.push(...zigzag(randomCreases(W, L, Math.round(L / 30), rnd, 58, () => 95 + rnd() * 70), L, s()));
      mods.twist = (rnd() - 0.5) * 0.5;
      break;
    case 'tube': mods.tube = 1; break;
    default: { // random
      cs.push(...zigzag(randomCreases(W, L, 2 + Math.floor(rnd() * 5), rnd, 35, () => 60 + rnd() * 110), L, s()));
      if (rnd() < 0.35) mods.twist = (rnd() - 0.5) * 0.9;
      if (rnd() < 0.45) mods.curl = (rnd() - 0.3) * 0.7;
    }
  }
  return { creases: cs.filter(Boolean), mods };
}
export {makePose,presetShape,randomCreases,zigzag};
