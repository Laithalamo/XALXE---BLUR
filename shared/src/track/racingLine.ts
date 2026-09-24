import type { Centerline } from './centerline';

/**
 * A racing line for the AI: a smooth path that uses the road width
 * (outside-apex-outside through corners) plus a target speed at every metre,
 * derived from the line's curvature, braking and acceleration limits.
 */
export interface RacingLine {
  length: number;
  /** lateral offset from the centre line (m, + = left) per centre-line sample */
  lateral: Float32Array;
  /** target speed (m/s) per sample */
  speed: Float32Array;
  /** interpolated lateral offset / speed at distance s */
  latAt(s: number): number;
  speedAt(s: number): number;
}

export interface LineOptions {
  margin: number; // distance kept from the barrier face (m)
  grip: number; // usable lateral acceleration in g
  brake: number; // m/s^2
  accel: number; // m/s^2
  vmax: number; // m/s
}

export function buildRacingLine(cl: Centerline, roadWidth: number, opt: Partial<LineOptions> = {}): RacingLine {
  const o: LineOptions = { margin: 2.7, grip: 1.3, brake: 8.5, accel: 6.0, vmax: 82, ...opt };
  const S = cl.samples;
  const N = S.length;
  const lim = roadWidth / 2 - o.margin;
  const lat = new Float32Array(N);
  const px = new Float64Array(N), pz = new Float64Array(N);
  const place = () => {
    for (let i = 0; i < N; i++) {
      px[i] = S[i].x + S[i].tz * lat[i];
      pz[i] = S[i].z - S[i].tx * lat[i];
    }
  };
  // elastic-band smoothing: every point moves towards the middle of its neighbours,
  // constrained to its own cross-section of the road -> minimum-curvature-ish line
  const span = 6;
  for (let it = 0; it < 900; it++) {
    place();
    for (let i = 0; i < N; i++) {
      const a = (i - span + N) % N, b = (i + span) % N;
      const mx = (px[a] + px[b]) / 2, mz = (pz[a] + pz[b]) / 2;
      const want = (mx - S[i].x) * S[i].tz - (mz - S[i].z) * S[i].tx;
      const next = lat[i] + (want - lat[i]) * 0.5;
      lat[i] = Math.max(-lim, Math.min(lim, next));
    }
  }
  // light smoothing of the result
  const tmp = new Float32Array(N);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let k = -4; k <= 4; k++) sum += lat[(i + k + N) % N];
      tmp[i] = sum / 9;
    }
    lat.set(tmp);
  }
  place();

  // curvature of the line (Menger curvature over +-4 samples) -> corner speed
  const speed = new Float32Array(N);
  const g = 9.81;
  for (let i = 0; i < N; i++) {
    const a = (i - 4 + N) % N, b = (i + 4) % N;
    const ax = px[a], az = pz[a], bx = px[i], bz = pz[i], cx = px[b], cz = pz[b];
    const ab = Math.hypot(bx - ax, bz - az), bc = Math.hypot(cx - bx, cz - bz), ca = Math.hypot(ax - cx, az - cz);
    const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
    const k = ab * bc * ca > 1e-6 ? (2 * area2) / (ab * bc * ca) : 0;
    speed[i] = k > 1e-5 ? Math.min(o.vmax, Math.sqrt((o.grip * g) / k)) : o.vmax;
  }
  // braking (backwards) and acceleration (forwards) limits, twice around for the wrap
  const ds = cl.length / N;
  for (let rep = 0; rep < 2; rep++) {
    for (let j = N - 1; j >= 0; j--) {
      const nxt = speed[(j + 1) % N];
      speed[j] = Math.min(speed[j], Math.sqrt(nxt * nxt + 2 * o.brake * ds));
    }
    for (let j = 0; j < N; j++) {
      const prv = speed[(j - 1 + N) % N];
      speed[j] = Math.min(speed[j], Math.sqrt(prv * prv + 2 * o.accel * ds));
    }
  }

  const idx = (s: number) => {
    const L = cl.length;
    const t = ((((s % L) + L) % L) / L) * N;
    const i0 = Math.floor(t) % N;
    return { i0, i1: (i0 + 1) % N, f: t - Math.floor(t) };
  };
  return {
    length: cl.length,
    lateral: lat,
    speed,
    latAt(s) {
      const { i0, i1, f } = idx(s);
      return lat[i0] + (lat[i1] - lat[i0]) * f;
    },
    speedAt(s) {
      const { i0, i1, f } = idx(s);
      return speed[i0] + (speed[i1] - speed[i0]) * f;
    },
  };
}
