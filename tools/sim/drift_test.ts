// Drift behaviour test on an open plane: handbrake entry, hold throttle, then exit.
// Run: npx tsx tools/sim/drift_test.ts
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle, emptyInput } from '../../shared/src/physics/vehicle';
import { CARS, DEFAULT_CAR } from '../../shared/src/cars';
import { PHYSICS_HZ } from '../../shared/src/physics/trackPhysics';

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / PHYSICS_HZ;
world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 1, 5000).setTranslation(0, -1, 0).setFriction(0.9));
const car = new Vehicle(world, CARS[process.env.CAR ?? DEFAULT_CAR], { x: 0, y: 0.25, z: 0 }, 0);
const dt = 1 / PHYSICS_HZ;
const inp = emptyInput();
let t = 0;
const deg = (r: number) => (r * 57.3).toFixed(0).padStart(4);
const row = (tag: string) => {
  const lv = car.body.linvel();
  console.log(`${tag.padEnd(10)} t=${t.toFixed(2)} v=${(Math.hypot(lv.x, lv.z) * 3.6).toFixed(0).padStart(4)}km/h beta=${deg(car.slipAngle)} drift=${car.drift.toFixed(2)} steer=${deg(car.wheelSteer)} yawRate=${(car.body.angvel().y * 57.3).toFixed(0).padStart(5)}deg/s`);
};
const run = (secs: number, tag: string, every = 0.25) => {
  let acc = 0;
  for (let i = 0; i < secs * PHYSICS_HZ; i++) {
    car.step(dt, inp); world.step(); t += dt; acc += dt;
    if (acc >= every - 1e-6) { acc = 0; row(tag); }
  }
};
const scenario = process.argv[2] ?? 'handbrake';
inp.throttle = 1; run(3.2, 'accel', 1);
if (scenario === 'handbrake') {
  inp.steer = -0.8; inp.handbrake = true; inp.throttle = 0.6; run(0.35, 'hb-entry', 0.1);
  inp.handbrake = false; inp.throttle = 0.85; inp.steer = -0.3; run(2.5, 'hold');
  inp.throttle = 1.0; inp.steer = -0.8; run(1.0, 'more');
  inp.throttle = 0.4; inp.steer = 0.4; run(1.5, 'exit');
  inp.throttle = 0.5; inp.steer = 0; run(1.0, 'straight');
} else if (scenario === 'grip') {
  // normal fast cornering without handbrake: should grip, not auto-drift
  inp.throttle = 0.6; inp.steer = -0.6; run(3, 'corner');
} else if (scenario === 'power') {
  // power-over at lower speed: full throttle + big steer
  inp.throttle = 0; inp.brake = 1; run(1.5, 'slow');
  inp.brake = 0; inp.throttle = 1; inp.steer = -1; run(3, 'power');
}
