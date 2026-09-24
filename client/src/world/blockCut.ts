import * as THREE from 'three';
import type { GeoBuilder } from './geom';

/**
 * Rounded track corners cut into the square city blocks on their inside.
 * These helpers trim a block's sidewalk outline along the road edge and build
 * the raised platform + kerb for any (non-convex) outline.
 */
export interface P2 {
  x: number;
  z: number;
}

/** one side of the road: edge points and their outward (away from the road) directions */
export interface RoadEdge {
  pts: P2[];
  out: P2[];
}

export function pointInPoly(p: P2, poly: P2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** first crossing of segment a->b with the polygon boundary (closest to a): point + boundary position (edge + t) */
function crossing(poly: P2[], a: P2, b: P2) {
  let best: { p: P2; pos: number; u: number } | null = null;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const c = poly[i], d = poly[(i + 1) % n];
    const rx = b.x - a.x, rz = b.z - a.z, sx = d.x - c.x, sz = d.z - c.z;
    const den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-12) continue;
    const u = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den; // along a->b
    const t = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den; // along c->d
    if (u < -1e-9 || u > 1 + 1e-9 || t < -1e-9 || t > 1 + 1e-9) continue;
    if (!best || u < best.u) best = { p: { x: a.x + rx * u, z: a.z + rz * u }, pos: i + Math.min(t, 0.999999), u };
  }
  return best;
}

/** polygon vertex indices strictly between boundary positions `from` and `to`, walking forwards */
function walk(from: number, to: number, n: number) {
  const out: number[] = [];
  const span = (((to - from) % n) + n) % n;
  for (let k = Math.floor(from) + 1; k - from < span; k++) out.push(((k % n) + n) % n);
  return out;
}

/**
 * Block rectangle minus the road. Returns null when the road doesn't reach into the
 * block (the usual case: the block edge lies exactly on the road edge).
 */
export function cutBlock(x0: number, z0: number, x1: number, z1: number, edges: RoadEdge[]): P2[] | null {
  let poly: P2[] = [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
  const eps = 0.05;
  const deep = (p: P2) => p.x > x0 + eps && p.x < x1 - eps && p.z > z0 + eps && p.z < z1 - eps;
  const within = (p: P2) => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1;
  let cut = false;
  for (const e of edges) {
    const N = e.pts.length;
    const ins = e.pts.map(deep);
    if (!ins.some(Boolean) || ins.every(Boolean)) continue;
    const start = ins.indexOf(false);
    for (let k = 0; k < N; k++) {
      const i0 = (start + k) % N;
      if (!ins[i0] || ins[(i0 - 1 + N) % N]) continue;
      // a run of edge points reaching into the block; widen it to the points just outside
      let a = i0, steps = 0;
      while (within(e.pts[(a - 1 + N) % N]) && steps++ < 80) a = (a - 1 + N) % N;
      let b = i0;
      while (ins[(b + 1) % N]) b = (b + 1) % N;
      steps = 0;
      while (within(e.pts[(b + 1) % N]) && steps++ < 80) b = (b + 1) % N;
      const run: number[] = [];
      for (let j = a; ; j = (j + 1) % N) {
        run.push(j);
        if (j === b) break;
      }
      const E = crossing(poly, e.pts[a], e.pts[(a - 1 + N) % N]);
      const X = crossing(poly, e.pts[b], e.pts[(b + 1) % N]);
      if (!E || !X) continue;
      const pts = run.map((j) => e.pts[j]);
      const n = poly.length;
      const A = [E.p, ...pts, X.p, ...walk(X.pos, E.pos, n).map((j) => poly[j])];
      const B = [X.p, ...[...pts].reverse(), E.p, ...walk(E.pos, X.pos, n).map((j) => poly[j])];
      // keep the part on the far side of the road edge
      const mid = run[Math.floor(run.length / 2)];
      const test = { x: e.pts[mid].x + e.out[mid].x * 0.3, z: e.pts[mid].z + e.out[mid].z * 0.3 };
      poly = pointInPoly(test, A) ? A : B;
      cut = true;
    }
  }
  return cut ? simplifyPoly(poly) : null;
}

/** drop near-duplicate points (edge samples are 1 m apart; the kerb doesn't need more) */
function simplifyPoly(poly: P2[]) {
  const out: P2[] = [];
  for (const p of poly) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.z - q.z) > 0.35) out.push(p);
  }
  if (out.length > 3 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].z - out[out.length - 1].z) < 0.35) out.pop();
  return out;
}

const UP = new THREE.Vector3(0, 1, 0);

/** quad whose winding is fixed from the intended normal */
function quadFacing(b: GeoBuilder, p: THREE.Vector3[], n: THREE.Vector3, uv: [number, number][]) {
  const ids = p.map((v, i) => b.vertex(v, n, uv[i][0], uv[i][1]));
  const e1 = p[1].clone().sub(p[0]), e2 = p[2].clone().sub(p[0]);
  if (e1.cross(e2).dot(n) >= 0) b.quad(ids[0], ids[1], ids[2], ids[3]);
  else b.quad(ids[0], ids[3], ids[2], ids[1]);
}

/**
 * Raised sidewalk platform over any outline: paved top at `y`, plus a 25 cm kerb
 * (outer face + top strip) all the way round.
 */
export function addPlatform(pavers: GeoBuilder, curb: GeoBuilder, poly: P2[], y: number) {
  const n = poly.length;
  // paved top
  const tris = THREE.ShapeUtils.triangulateShape(poly.map((p) => new THREE.Vector2(p.x, p.z)), []);
  const base = pavers.vertexCount;
  for (const p of poly) pavers.vertex(new THREE.Vector3(p.x, y, p.z), UP, p.x / 2, p.z / 2);
  for (const [a, b, c] of tris) {
    const pa = poly[a], pb = poly[b], pc = poly[c];
    const cy = (pb.z - pa.z) * (pc.x - pa.x) - (pb.x - pa.x) * (pc.z - pa.z);
    if (cy > 0) pavers.tri(base + a, base + b, base + c);
    else pavers.tri(base + a, base + c, base + b);
  }
  // orientation: positive area -> interior on the left of each edge
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    area += a.x * b.z - b.x * a.z;
  }
  const s = area > 0 ? 1 : -1;
  const inward = (i: number) => {
    const a = poly[i], b = poly[(i + 1) % n];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (-(b.z - a.z) / l) * s, z: ((b.x - a.x) / l) * s };
  };
  // inner edge of the kerb strip (mitred, limited at sharp corners)
  const inner = poly.map((p, i) => {
    const n0 = inward((i - 1 + n) % n), n1 = inward(i);
    let mx = n0.x + n1.x, mz = n0.z + n1.z;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const cos = Math.max(0.35, mx * n1.x + mz * n1.z);
    return { x: p.x + (mx * 0.25) / cos, z: p.z + (mz * 0.25) / cos };
  });
  const top = y + 0.01;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = poly[i], b = poly[j];
    const w = inward(i);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    quadFacing(curb, [
      new THREE.Vector3(a.x, 0, a.z), new THREE.Vector3(b.x, 0, b.z), new THREE.Vector3(b.x, top, b.z), new THREE.Vector3(a.x, top, a.z),
    ], new THREE.Vector3(-w.x, 0, -w.z), [[0, 0], [len / 0.5, 0], [len / 0.5, top / 0.5], [0, top / 0.5]]);
    const ai = inner[i], bi = inner[j];
    quadFacing(curb, [
      new THREE.Vector3(a.x, top, a.z), new THREE.Vector3(b.x, top, b.z), new THREE.Vector3(bi.x, top, bi.z), new THREE.Vector3(ai.x, top, ai.z),
    ], UP, [[a.x / 0.5, a.z / 0.5], [b.x / 0.5, b.z / 0.5], [bi.x / 0.5, bi.z / 0.5], [ai.x / 0.5, ai.z / 0.5]]);
  }
}
