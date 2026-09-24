// Headless race: 8 AI cars, 3 laps on the real circuit. Reports lap times, finish order, stuck events.
// Run: npx tsx tools/sim/ai_race.ts [difficulty]
import RAPIER from '@dimforge/rapier3d-compat';
import { TRACKS } from '../../shared/src/track/trackDefs';
import { buildCenterline } from '../../shared/src/track/centerline';
import { buildRacingLine } from '../../shared/src/track/racingLine';
import { createTrackWorld, spawnAt, PHYSICS_HZ } from '../../shared/src/physics/trackPhysics';
import { Vehicle } from '../../shared/src/physics/vehicle';
import { CARS, DEFAULT_CAR } from '../../shared/src/cars';
import { AIDriver, type AICarState, type Difficulty } from '../../shared/src/ai/driver';

await RAPIER.init();
const diff = (process.argv[2] ?? 'hard') as Difficulty;
const def = TRACKS.midtown;
const cl = buildCenterline(def);
const t0 = performance.now();
const line = buildRacingLine(cl, def.roadWidth);
console.log('racing line built in', (performance.now() - t0).toFixed(0), 'ms; min corner speed', (Math.min(...line.speed) * 3.6).toFixed(0), 'km/h; max |lat|', Math.max(...Array.from(line.lateral).map(Math.abs)).toFixed(2));
const world = createTrackWorld(def, cl);
const N_CARS = Number(process.argv[3] ?? 8);
const cars = Array.from({ length: N_CARS }, (_, g) => {
  const s = -10 - g * 9 - (g % 2) * 4.5 - 2.4;
  const sp = spawnAt(cl, s, g % 2 === 0 ? 3.6 : -3.6);
  const v = new Vehicle(world, CARS[process.env.CAR ?? DEFAULT_CAR], sp.pos, sp.yaw);
  return { v, ai: new AIDriver(cl, line, def.roadWidth, diff, 100 + g), s: ((s % cl.length) + cl.length) % cl.length, lap: 0, hint: -1, laps: [] as number[], lapStart: 0, finished: -1, lateral: 0, stuckEvents: 0 };
});
const dt = 1 / PHYSICS_HZ;
let t = 0;
const state = (c: (typeof cars)[number]): AICarState => {
  const p = c.v.body.translation(), q = c.v.body.rotation();
  const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const fl = Math.hypot(fx, fz) || 1;
  return { x: p.x, z: p.z, fx: fx / fl, fz: fz / fl, speed: c.v.speed, s: c.s, lateral: c.lateral };
};
const LAPS = 3;
let order: number[] = [];
while (t < 400 && order.length < cars.length) {
  const states = cars.map(state);
  const inputs = cars.map((c, i) => c.ai.update(dt, states[i], states.filter((_, j) => j !== i), t));
  cars.forEach((c, i) => c.v.step(dt, inputs[i]));
  world.step();
  t += dt;
  for (const [i, c] of cars.entries()) {
    const p = c.v.body.translation();
    const pr = cl.project(p.x, p.z, c.hint);
    c.hint = pr.index;
    let ds = pr.s - c.s;
    if (ds < -cl.length / 2) { c.lap++; if (c.lap > 1) c.laps.push(t - c.lapStart); c.lapStart = t; }
    if (ds > cl.length / 2) c.lap--;
    c.s = pr.s;
    c.lateral = pr.lateral;
    if (c.lap > LAPS && c.finished < 0) { c.finished = t; order.push(i); }
    if (c.v.isUpsideDown()) { console.log('car', i, 'flipped at s', pr.s.toFixed(0)); }
  }
}
for (const [pos, i] of order.entries()) {
  const c = cars[i];
  console.log(`P${pos + 1} car${i} finish ${c.finished.toFixed(1)}s laps ${c.laps.map((l) => l.toFixed(1)).join(' / ')}`);
}
const dnf = cars.map((c, i) => [c, i] as const).filter(([c]) => c.finished < 0);
for (const [c, i] of dnf) console.log(`DNF car${i} lap ${c.lap} s ${c.s.toFixed(0)} speed ${(c.v.speed * 3.6).toFixed(0)}`);
