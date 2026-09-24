import RAPIER from '@dimforge/rapier3d-compat';
import type { TrackDef } from '../track/trackDefs';
import type { Centerline } from '../track/centerline';

export const PHYSICS_HZ = 120;

/** Offset polyline of the barrier face on one side of the track (+1 = left, -1 = right). */
export function edgeLine(cl: Centerline, offset: number, side: 1 | -1) {
  return cl.samples.map((s) => ({ x: s.x + s.tz * offset * side, z: s.z - s.tx * offset * side }));
}

/** Douglas-Peucker simplification of a closed loop (first point repeated at the end). */
export function simplifyLoop(pts: { x: number; z: number }[], tol: number) {
  // split at the point farthest from the start so neither half is degenerate
  let m = 1, md = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].z - pts[0].z) ** 2;
    if (d > md) { md = d; m = i; }
  }
  const a = simplify(pts.slice(0, m + 1), tol);
  const b = simplify(pts.slice(m), tol);
  return a.concat(b.slice(1));
}

/** Douglas-Peucker simplification of an open polyline (keeps both ends). */
export function simplify(pts: { x: number; z: number }[], tol: number) {
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    const a = pts[i0], b = pts[i1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const L = Math.hypot(dx, dz) || 1;
    let worst = -1, wd = 0;
    for (let i = i0 + 1; i < i1; i++) {
      const p = pts[i];
      const d = Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / L;
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst > 0 && wd > tol) {
      keep[worst] = 1;
      stack.push([i0, worst], [worst, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Physics for a track: flat ground + barrier walls following both road edges.
 * Barriers are thick, tall boxes so fast cars can't tunnel or jump over them.
 */
export function createTrackWorld(def: TrackDef, cl: Centerline) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / PHYSICS_HZ;

  const g = def.grid;
  const cx = ((def.city.minX + def.city.maxX + 1) / 2) * g;
  const cz = ((def.city.minY + def.city.maxY + 1) / 2) * g;
  world.createCollider(RAPIER.ColliderDesc.cuboid(3000, 1, 3000).setTranslation(cx, -1, cz).setFriction(0.9));

  const half = def.roadWidth / 2;
  const thick = 0.6;
  for (const side of [1, -1] as const) {
    const line = edgeLine(cl, half + thick / 2, side);
    line.push(line[0]);
    const pts = simplifyLoop(line, 0.04);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const yaw = Math.atan2(dx, dz);
      const desc = RAPIER.ColliderDesc.cuboid(thick / 2, 2.5, len / 2 + 0.35)
        .setTranslation((a.x + b.x) / 2, 1.5, (a.z + b.z) / 2)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setFriction(0.15)
        .setRestitution(0.2);
      world.createCollider(desc);
    }
  }
  return world;
}

/** Spawn transform on the centre line: position + yaw (car forward = -Z). */
export function spawnAt(cl: Centerline, s: number, lateral = 0) {
  const p = cl.at(s);
  return {
    pos: { x: p.x + p.tz * lateral, y: 0.25, z: p.z - p.tx * lateral },
    yaw: Math.atan2(-p.tx, -p.tz),
  };
}
