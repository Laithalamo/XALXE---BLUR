import RAPIER from '@dimforge/rapier3d-compat';
import { TRACKS } from '../../shared/src/track/trackDefs';
import { buildCenterline } from '../../shared/src/track/centerline';
import { buildRacingLine } from '../../shared/src/track/racingLine';
import { createTrackWorld, spawnAt, PHYSICS_HZ } from '../../shared/src/physics/trackPhysics';
import { Vehicle } from '../../shared/src/physics/vehicle';
import { CARS, DEFAULT_CAR } from '../../shared/src/cars';
import { AIDriver } from '../../shared/src/ai/driver';
await RAPIER.init();
const def = TRACKS.midtown; const cl = buildCenterline(def); const line = buildRacingLine(cl, def.roadWidth);
const world = createTrackWorld(def, cl);
const sp = spawnAt(cl, -18, 0);
const v = new Vehicle(world, CARS[DEFAULT_CAR], sp.pos, sp.yaw);
const ai = new AIDriver(cl, line, def.roadWidth, 'hard', 1);
let s = cl.length - 18, hint = -1, lat = 0, t = 0, prevV = { x: 0, z: 0 };
for (let i = 0; i < PHYSICS_HZ * 90; i++) {
  const p = v.body.translation(), q = v.body.rotation();
  const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y)); const fl = Math.hypot(fx, fz);
  const inp = ai.update(1 / PHYSICS_HZ, { x: p.x, z: p.z, fx: fx / fl, fz: fz / fl, speed: v.speed, s, lateral: lat }, [], t);
  v.step(1 / PHYSICS_HZ, inp); world.step(); t += 1 / PHYSICS_HZ;
  const pr = cl.project(p.x, p.z, hint); hint = pr.index; s = pr.s; lat = pr.lateral;
  const lv = v.body.linvel(); const dv = Math.hypot(lv.x - prevV.x, lv.z - prevV.z); prevV = { x: lv.x, z: lv.z };
  if (dv > 0.5) console.log(`HIT t=${t.toFixed(2)} s=${s.toFixed(0)} lat=${lat.toFixed(1)} dv=${dv.toFixed(1)} v=${(v.speed*3.6).toFixed(0)}`);
  if (i % (PHYSICS_HZ / 2) === 0) console.log(`t=${t.toFixed(1)} s=${s.toFixed(0)} v=${(v.speed * 3.6).toFixed(0)} tgt=${(line.speedAt(s) * 3.6).toFixed(0)} lat=${lat.toFixed(1)} line=${line.latAt(s).toFixed(1)} steer=${inp.steer.toFixed(2)} thr=${inp.throttle.toFixed(2)} brk=${inp.brake.toFixed(2)} drift=${v.drift.toFixed(2)} beta=${(v.slipAngle * 57.3).toFixed(0)}`);
}
