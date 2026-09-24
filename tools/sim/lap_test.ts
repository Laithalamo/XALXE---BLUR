// Headless lap: a simple autopilot drives the whole circuit; reports lap time,
// top speed, wall hits and flips. Run: npx tsx tools/sim/lap_test.ts
import RAPIER from '@dimforge/rapier3d-compat';
import { TRACKS } from '../../shared/src/track/trackDefs';
import { buildCenterline } from '../../shared/src/track/centerline';
import { createTrackWorld, spawnAt, PHYSICS_HZ } from '../../shared/src/physics/trackPhysics';
import { Vehicle, emptyInput } from '../../shared/src/physics/vehicle';
import { CARS, DEFAULT_CAR } from '../../shared/src/cars';

await RAPIER.init();
const def = TRACKS.midtown;
const cl = buildCenterline(def);
const world = createTrackWorld(def, cl);
const sp = spawnAt(cl, -18, 0);
const car = new Vehicle(world, CARS[process.env.CAR ?? DEFAULT_CAR], sp.pos, sp.yaw);
const dt = 1 / PHYSICS_HZ;
const grip = Number(process.argv[2] ?? 1.35);
let t = 0, hint = 0, lastS = -18, travelled = 0, top = 0, hits = 0, maxLat = 0;
let prevV = { x: 0, y: 0, z: 0 };
for (let i = 0; i < PHYSICS_HZ * 240; i++) {
  const p = car.body.translation();
  const pr = cl.project(p.x, p.z, hint); hint = pr.index;
  let ds = pr.s - lastS; if (ds < -cl.length / 2) ds += cl.length; if (ds > cl.length / 2) ds -= cl.length;
  travelled += ds; lastS = pr.s;
  if (travelled >= cl.length + 18) break;
  const speed = car.speed;
  let maxK = 0;
  for (let a = 5; a < 40 + speed * 1.6; a += 4) maxK = Math.max(maxK, Math.abs(cl.at(pr.s + a).k));
  const target = maxK > 0 ? Math.min(90, Math.sqrt((grip * 9.81) / maxK)) : 90;
  const aim = cl.at(pr.s + 10 + Math.max(0, speed) * 0.55);
  const q = car.body.rotation();
  const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const tx = aim.x - p.x, tz = aim.z - p.z, tl = Math.hypot(tx, tz);
  const cross = (fx * tz - fz * tx) / tl;
  const inp = emptyInput();
  inp.steer = Math.max(-1, Math.min(1, cross * 2.4));
  if (speed < target - 1) inp.throttle = 1; else if (speed > target + 2) inp.brake = Math.min(1, (speed - target) / 8);
  car.step(dt, inp); world.step(); t += dt;
  top = Math.max(top, speed);
  maxLat = Math.max(maxLat, Math.abs(pr.lateral));
  const v = car.body.linvel();
  const dv = Math.hypot(v.x - prevV.x, v.y - prevV.y, v.z - prevV.z);
  if (dv > 4 * dt * 60 && dv > 1.2) hits++;
  prevV = { x: v.x, y: v.y, z: v.z };
  if (car.isUpsideDown()) { console.log('FLIPPED at s', pr.s.toFixed(0)); break; }
}
console.log(`lap ${travelled >= cl.length ? 'complete' : 'INCOMPLETE'} in ${t.toFixed(1)} s | length ${cl.length.toFixed(0)} m | top ${(top * 3.6).toFixed(0)} km/h | avg ${(cl.length / t * 3.6).toFixed(0)} km/h | wall hits ${hits} | max lateral ${maxLat.toFixed(1)} m`);
