import type { TrackDef } from './trackDefs';

/** One sample of the track centre line (XZ plane, Y up). */
export interface CenterSample {
  x: number;
  z: number;
  /** unit tangent (driving direction) */
  tx: number;
  tz: number;
  /** distance from the start of the polyline (m) */
  s: number;
  /** signed curvature (1/m, + = turning left) */
  k: number;
}

export interface Centerline {
  samples: CenterSample[];
  length: number;
  /** world position/tangent at distance s (wraps around) */
  at(s: number): CenterSample;
  /** nearest point on the centre line: distance along it and lateral offset (+ = left) */
  project(x: number, z: number, hint?: number): { s: number; lateral: number; index: number };
}

/**
 * Build the centre line: straight runs between corners, joined by circular
 * fillets of the requested radius. Sampled every `step` metres.
 */
export function buildCenterline(def: TrackDef, step = 1): Centerline {
  const g = def.grid;
  const P = def.points.map((p) => ({ x: p.x * g, z: p.y * g, r: p.r }));
  const n = P.length;

  type Seg =
    | { kind: 'line'; ax: number; az: number; bx: number; bz: number }
    | { kind: 'arc'; cx: number; cz: number; r: number; a0: number; da: number };
  const segs: Seg[] = [];

  // Fillet each corner: tangent points A (entry) / B (exit)
  const corners = P.map((p, i) => {
    const prev = P[(i - 1 + n) % n];
    const next = P[(i + 1) % n];
    let dinx = p.x - prev.x, dinz = p.z - prev.z;
    let doutx = next.x - p.x, doutz = next.z - p.z;
    const li = Math.hypot(dinx, dinz), lo = Math.hypot(doutx, doutz);
    dinx /= li; dinz /= li; doutx /= lo; doutz /= lo;
    const cross = dinx * doutz - dinz * doutx; // >0 = turning right (x east, z south)
    const dot = Math.max(-1, Math.min(1, dinx * doutx + dinz * doutz));
    const theta = Math.acos(dot);
    const T = p.r * Math.tan(theta / 2);
    const ax = p.x - dinx * T, az = p.z - dinz * T;
    const bx = p.x + doutx * T, bz = p.z + doutz * T;
    // centre is on the inside of the turn
    const side = cross > 0 ? 1 : -1; // right turn -> centre to the right of travel
    const rx = -dinz * side, rz = dinx * side; // right-hand normal when side=1
    const cx = ax + rx * p.r, cz = az + rz * p.r;
    const a0 = Math.atan2(az - cz, ax - cx);
    const a1 = Math.atan2(bz - cz, bx - cx);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    return { ax, az, bx, bz, cx, cz, r: p.r, a0, da };
  });

  for (let i = 0; i < n; i++) {
    const c = corners[i];
    const nx = corners[(i + 1) % n];
    segs.push({ kind: 'arc', cx: c.cx, cz: c.cz, r: c.r, a0: c.a0, da: c.da });
    segs.push({ kind: 'line', ax: c.bx, az: c.bz, bx: nx.ax, bz: nx.az });
  }

  const samples: CenterSample[] = [];
  let s = 0;
  for (const seg of segs) {
    if (seg.kind === 'line') {
      const len = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az);
      const cnt = Math.max(1, Math.round(len / step));
      const tx = (seg.bx - seg.ax) / len, tz = (seg.bz - seg.az) / len;
      for (let j = 0; j < cnt; j++) {
        const t = j / cnt;
        samples.push({ x: seg.ax + (seg.bx - seg.ax) * t, z: seg.az + (seg.bz - seg.az) * t, tx, tz, s: s + len * t, k: 0 });
      }
      s += len;
    } else {
      const len = Math.abs(seg.da) * seg.r;
      const cnt = Math.max(2, Math.round(len / step));
      const dir = Math.sign(seg.da);
      for (let j = 0; j < cnt; j++) {
        const t = j / cnt;
        const a = seg.a0 + seg.da * t;
        const x = seg.cx + Math.cos(a) * seg.r, z = seg.cz + Math.sin(a) * seg.r;
        // tangent = derivative of the circle in the direction of travel
        const tx = -Math.sin(a) * dir, tz = Math.cos(a) * dir;
        // da>0 in x-east/z-south space is a right-hand (clockwise seen from above) turn
        samples.push({ x, z, tx, tz, s: s + len * t, k: -dir / seg.r });
      }
      s += len;
    }
  }
  const length = s;

  // rotate the sample list so s=0 is the start/finish line
  const off = ((def.startOffset % length) + length) % length;
  let startIdx = 0;
  while (startIdx < samples.length - 1 && samples[startIdx + 1].s <= off) startIdx++;
  const rotated = samples.slice(startIdx).concat(samples.slice(0, startIdx));
  const base = rotated[0].s;
  for (const smp of rotated) smp.s = (smp.s - base + length) % length;

  const at = (d: number): CenterSample => {
    const L = length;
    d = ((d % L) + L) % L;
    // binary search
    let lo = 0, hi = rotated.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rotated[mid].s <= d) lo = mid; else hi = mid - 1;
    }
    const a = rotated[lo], b = rotated[(lo + 1) % rotated.length];
    const segLen = ((b.s - a.s + L) % L) || step;
    const t = Math.min(1, (d - a.s) / segLen);
    const tx = a.tx + (b.tx - a.tx) * t, tz = a.tz + (b.tz - a.tz) * t;
    const tl = Math.hypot(tx, tz) || 1;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: tx / tl, tz: tz / tl, s: d, k: a.k };
  };

  const project = (x: number, z: number, hint?: number) => {
    const N = rotated.length;
    let best = -1, bestD = Infinity;
    const scan = (i0: number, i1: number) => {
      for (let i = i0; i < i1; i++) {
        const smp = rotated[((i % N) + N) % N];
        const d = (smp.x - x) ** 2 + (smp.z - z) ** 2;
        if (d < bestD) { bestD = d; best = ((i % N) + N) % N; }
      }
    };
    if (hint !== undefined && hint >= 0) scan(hint - 60, hint + 60);
    if (best < 0 || bestD > 40 * 40) { bestD = Infinity; scan(0, N); }
    const a = rotated[best];
    const dx = x - a.x, dz = z - a.z;
    const along = dx * a.tx + dz * a.tz;
    // left normal = (tz, -tx)
    const lateral = dx * a.tz - dz * a.tx;
    return { s: (a.s + along + length) % length, lateral, index: best };
  };

  return { samples: rotated, length, at, project };
}
