// Headless physics sanity test: drive the default car down the main straight.
import RAPIER from '@dimforge/rapier3d-compat';
import { TRACKS } from '../../shared/src/track/trackDefs';
import { buildCenterline } from '../../shared/src/track/centerline';
import { createTrackWorld, spawnAt, PHYSICS_HZ } from '../../shared/src/physics/trackPhysics';
import { Vehicle, emptyInput } from '../../shared/src/physics/vehicle';
import { CARS, DEFAULT_CAR } from '../../shared/src/cars';

await RAPIER.init();
const def = TRACKS.midtown;
const cl = buildCenterline(def);
let maxGap = 0, maxAng = 0;
for (let i = 0; i < cl.samples.length; i++) {
  const a = cl.samples[i], b = cl.samples[(i + 1) % cl.samples.length];
  const gap = Math.hypot(b.x - a.x, b.z - a.z); maxGap = Math.max(maxGap, gap);
  const dx = (b.x - a.x) / gap, dz = (b.z - a.z) / gap;
  maxAng = Math.max(maxAng, Math.acos(Math.min(1, dx * a.tx + dz * a.tz)));
}
console.log('length', cl.length.toFixed(1), 'samples', cl.samples.length, 'maxGap', maxGap.toFixed(3), 'maxTangentErr(rad)', maxAng.toFixed(3));
const world = createTrackWorld(def, cl);
const sp = spawnAt(cl, 0);
const car = new Vehicle(world, CARS[DEFAULT_CAR], sp.pos, sp.yaw);
const input = emptyInput();
const dt = 1 / PHYSICS_HZ;
let t = 0; let hint = 0;
const log = (label: string) => {
  const p = car.body.translation(); const q = car.body.rotation(); const yaw = Math.atan2(2*(q.w*q.y + q.x*q.z), 1 - 2*(q.y*q.y + q.x*q.x));
  const pr = cl.project(p.x, p.z, hint); hint = pr.index;
  console.log(label, 't', t.toFixed(2), 'v(km/h)', (car.speed * 3.6).toFixed(1), 'gear', car.gear, 'rpm', car.rpm.toFixed(0), 'y', p.y.toFixed(3), 's', pr.s.toFixed(1), 'lat', pr.lateral.toFixed(2), 'yaw', (yaw*57.3).toFixed(2), 'contacts', car.wheels.filter(w => w.inContact).length, 'comp', car.wheels.map(w => w.compression.toFixed(3)).join(','));
};
for (let i = 0; i < PHYSICS_HZ * 1; i++) { car.step(dt, input); world.step(); t += dt; }
log('settled');
input.throttle = 1;
let hit100 = -1;
for (let i = 0; i < PHYSICS_HZ * 12; i++) {
  car.step(dt, input); world.step(); t += dt;
  if (hit100 < 0 && car.speed * 3.6 >= 100) hit100 = t - 1;
  if (i % PHYSICS_HZ === 0) log('accel');
}
console.log('0-100 km/h in', hit100.toFixed(2), 's');
input.throttle = 0; input.brake = 1;
for (let i = 0; i < PHYSICS_HZ * 4; i++) { car.step(dt, input); world.step(); t += dt; if (i % 60 === 0) log('brake'); }
// cornering test: steady speed + steer
input.brake = 0; input.throttle = 0.6; input.steer = 0.5;
for (let i = 0; i < PHYSICS_HZ * 4; i++) { car.step(dt, input); world.step(); t += dt; if (i % 60 === 0) log('corner'); }
