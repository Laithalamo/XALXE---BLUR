// Headless race with the shared Race rules: 8 AI cars, grid start, countdown, 3 laps.
// Checks lap counting, finish order, and that lap times add up to the race time.
// Run: npx tsx tools/sim/race_test.ts [difficulty]
import RAPIER from '@dimforge/rapier3d-compat';
import { TRACKS } from '../../shared/src/track/trackDefs';
import { buildCenterline } from '../../shared/src/track/centerline';
import { buildRacingLine } from '../../shared/src/track/racingLine';
import { createTrackWorld, spawnAt, PHYSICS_HZ } from '../../shared/src/physics/trackPhysics';
import { Vehicle, emptyInput } from '../../shared/src/physics/vehicle';
import { CARS, DEFAULT_CAR } from '../../shared/src/cars';
import { AIDriver, type AICarState, type Difficulty } from '../../shared/src/ai/driver';
import { Race, gridSlot } from '../../shared/src/race/race';

await RAPIER.init();
const diff = (process.argv[2] ?? 'medium') as Difficulty;
const def = TRACKS.midtown;
const cl = buildCenterline(def);
const line = buildRacingLine(cl, def.roadWidth);
const world = createTrackWorld(def, cl);
const N = 8;
const race = new Race(cl, 3, N, 4);
const cars = Array.from({ length: N }, (_, g) => {
  const sl = gridSlot(g);
  const sp = spawnAt(cl, sl.s, sl.lateral);
  const v = new Vehicle(world, CARS[process.env.CAR ?? DEFAULT_CAR], sp.pos, sp.yaw);
  race.place(g, sp.pos.x, sp.pos.z, true);
  return { v, ai: new AIDriver(cl, line, def.roadWidth, diff, 100 + g) };
});
const events: string[] = [];
race.onLap = (i, lap, t) => { if (t !== null) events.push(`car${i} lap ${lap - 1} ${t.toFixed(2)}`); };
race.onFinish = (i, place) => {
  events.push(`car${i} lap 3 ${race.racers[i].lastLap!.toFixed(2)}`);
  events.push(`car${i} FINISH P${place} at ${race.time.toFixed(2)}`);
};
const dt = 1 / PHYSICS_HZ;
const hold = emptyInput();
const state = (i: number): AICarState => {
  const c = cars[i];
  const p = c.v.body.translation(), q = c.v.body.rotation();
  const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const fl = Math.hypot(fx, fz) || 1;
  const r = race.racers[i];
  return { x: p.x, z: p.z, fx: fx / fl, fz: fz / fl, speed: c.v.speed, s: r.s, lateral: r.lateral };
};
let respawns = 0;
while (race.time < 320 && race.finishOrder.length < N) {
  const states = cars.map((_, i) => state(i));
  cars.forEach((c, i) => c.v.step(dt, race.started ? c.ai.update(dt, states[i], states, race.time) : hold));
  world.step();
  cars.forEach((c, i) => {
    const p = c.v.body.translation();
    race.track(i, p.x, p.z);
    if (c.v.isUpsideDown()) {
      respawns++;
      const r = race.racers[i];
      const sp = spawnAt(cl, r.s, line.latAt(r.s));
      c.v.reset(sp.pos, sp.yaw);
      race.track(i, sp.pos.x, sp.pos.z);
    }
  });
  race.step(dt);
}
for (const e of events.filter((e) => e.includes('FINISH'))) console.log(e);
let ok = true;
for (let i = 0; i < N; i++) {
  const r = race.racers[i];
  const laps = events.filter((e) => e.startsWith(`car${i} lap`)).map((e) => Number(e.split(' ')[3]));
  const sum = laps.reduce((a, b) => a + b, 0);
  const good = r.finished && laps.length === 3 && Math.abs(sum - r.finishTime) < 0.05;
  if (!good) ok = false;
  console.log(`car${i}: laps ${laps.map((l) => l.toFixed(1)).join(' / ')} sum ${sum.toFixed(2)} finish ${r.finishTime.toFixed(2)} best ${r.bestLap?.toFixed(2)} ${good ? 'OK' : 'BAD'}`);
}
console.log('standings', race.standings().join(','), 'order', race.finishOrder.join(','), 'respawns', respawns, ok ? 'ALL OK' : 'PROBLEM');
