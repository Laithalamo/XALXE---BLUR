import type { Centerline } from './centerline';

export type CornerSeverity = 'kink' | 'fast' | 'medium' | 'sharp' | 'hairpin';

export interface Corner {
  s0: number;
  s1: number;
  /** +1 = left turn, -1 = right turn */
  dir: 1 | -1;
  /** total turn angle (rad) */
  angle: number;
  /** tightest radius (m) */
  radius: number;
  /** distance along the track of the corner's middle */
  apex: number;
  severity: CornerSeverity;
}

/** Curved sections of the centre line, with how hard each one is. */
export function findCorners(cl: Centerline): Corner[] {
  const out: Corner[] = [];
  let cur: { s0: number; s1: number; dir: number; angle: number; kmax: number } | null = null;
  const step = cl.samples.length > 1 ? cl.length / cl.samples.length : 1;
  const close = () => {
    if (cur && cur.s1 - cur.s0 > 5) {
      const radius = 1 / cur.kmax;
      const deg = (cur.angle * 180) / Math.PI;
      const severity: CornerSeverity =
        deg < 55 && radius > 45 ? 'kink' : radius > 35 ? 'fast' : radius > 20 ? 'medium' : radius > 12 ? 'sharp' : 'hairpin';
      out.push({ s0: cur.s0, s1: cur.s1, dir: cur.dir > 0 ? 1 : -1, angle: cur.angle, radius, apex: (cur.s0 + cur.s1) / 2, severity });
    }
    cur = null;
  };
  for (const s of cl.samples) {
    if (Math.abs(s.k) > 1 / 200) {
      const dir = Math.sign(s.k);
      if (!cur || cur.dir !== dir) {
        close();
        cur = { s0: s.s, s1: s.s, dir, angle: 0, kmax: 0 };
      }
      cur.s1 = s.s;
      cur.angle += Math.abs(s.k) * step;
      cur.kmax = Math.max(cur.kmax, Math.abs(s.k));
    } else close();
  }
  close();
  return out;
}

/** next corner ahead of distance s (wraps around the lap); returns it and the distance to its start */
export function nextCorner(corners: Corner[], length: number, s: number) {
  let best: Corner | null = null;
  let bestD = Infinity;
  for (const c of corners) {
    let d = c.s0 - s;
    if (d < -(c.s1 - c.s0)) d += length; // already past this one
    if (d > -(c.s1 - c.s0) && d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best ? { corner: best, distance: bestD } : null;
}
