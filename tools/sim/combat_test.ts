// Headless combat race: 8 AI cars with power-ups for 3 laps. Reports hits, wrecks, pickups, finish.
// Run: npx tsx tools/sim/combat_test.ts [difficulty]
import RAPIER from '@dimforge/rapier3d-compat';
import { TRACKS } from '../../shared/src/track/trackDefs';
import { buildCenterline } from '../../shared/src/track/centerline';
import { buildRacingLine } from '../../shared/src/track/racingLine';
import { findCorners, nextCorner } from '../../shared/src/track/corners';
import { createTrackWorld, spawnAt, PHYSICS_HZ } from '../../shared/src/physics/trackPhysics';
import { Vehicle, emptyInput } from '../../shared/src/physics/vehicle';
import { CARS, DEFAULT_CAR } from '../../shared/src/cars';
import { AIDriver, type AICarState, type Difficulty } from '../../shared/src/ai/driver';
import { Race, gridSlot } from '../../shared/src/race/race';
import { Combat } from '../../shared/src/race/powerups';

await RAPIER.init();
const diff = (process.argv[2] ?? 'medium') as Difficulty;
const def = TRACKS.midtown;
const cl = buildCenterline(def);
const line = buildRacingLine(cl, def.roadWidth);
const corners = findCorners(cl);
const world = createTrackWorld(def, cl);
const N = 8;
const race = new Race(cl, 3, N, 4);
const spec = CARS[DEFAULT_CAR];
const cars = Array.from({ length: N }, (_, g) => {
  const sl = gridSlot(g);
  const sp = spawnAt(cl, sl.s, sl.lateral);
  const v = new Vehicle(world, spec, sp.pos, sp.yaw);
  race.place(g, sp.pos.x, sp.pos.z, true);
  return { v, ai: new AIDriver(cl, line, def.roadWidth, diff, 100 + g), think: 1 + g * 0.1 };
});
const vehicles = cars.map((c) => c.v);
const combat = new Combat(cl, def.roadWidth, corners, N, spec.maxHealth);
const counts: Record<string, number> = {};
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
const respawn = (i: number) => {
  const r = race.racers[i];
  const sp = spawnAt(cl, r.s, line.latAt(r.s));
  vehicles[i].reset(sp.pos, sp.yaw);
  race.track(i, sp.pos.x, sp.pos.z);
};
let flips = 0;
const stuck = new Array(N).fill(0);
while (race.time < 400 && race.finishOrder.length < N) {
  const states = cars.map((_, i) => state(i));
  cars.forEach((c, i) => {
    const cc = combat.cars[i];
    const inp = race.started && cc.wreck <= 0 ? { ...c.ai.update(dt, states[i], states, race.time) } : { ...hold };
    inp.boost = cc.surge > 0;
    c.v.step(dt, inp);
  });
  world.step();
  cars.forEach((c, i) => {
    const p = c.v.body.translation();
    race.track(i, p.x, p.z);
  });
  if (race.started) {
    combat.step(dt, vehicles, race.racers);
    cars.forEach((c, i) => {
      c.think -= dt;
      if (c.think <= 0) {
        c.think = 0.9;
        const pk = combat.cars[i].slots.length < 3 ? combat.pickupAhead(race.racers[i].s, cl.length) : null;
        c.ai.seek = pk ? { s: pk.s, lateral: pk.lateral } : null;
        const nc = nextCorner(corners, cl.length, race.racers[i].s);
        combat.aiUse(i, vehicles, race.racers, race.standings(), cl.length, nc ? nc.distance : 999);
      }
      // flipped (not wrecked) -> respawn after 1.5 s
      if (combat.alive(i) && c.v.isUpsideDown()) { stuck[i] += dt; if (stuck[i] > 1.5) { flips++; stuck[i] = 0; respawn(i); } } else stuck[i] = 0;
    });
    for (const e of combat.events.splice(0)) {
      const key = e.t === 'hit' || e.t === 'boom' ? `${e.t}:${e.kind}` : e.t === 'pickup' || e.t === 'fire' ? `${e.t}:${e.kind}` : e.t;
      counts[key] = (counts[key] ?? 0) + 1;
      if (e.t === 'respawn') respawn(e.car);
    }
  }
  race.step(dt);
}
console.log('events', JSON.stringify(Object.fromEntries(Object.entries(counts).sort())));
for (const i of race.standings()) {
  const r = race.racers[i], c = combat.cars[i];
  console.log(`car${i} ${r.finished ? 'finish ' + r.finishTime.toFixed(1) : 'DNF lap ' + r.lap} best ${r.bestLap?.toFixed(1)} hits ${c.stats.hits} wrecks ${c.stats.wrecks} kills ${c.stats.kills} dmg ${c.stats.damage.toFixed(0)}`);
}
console.log('flip respawns', flips, 'finished', race.finishOrder.length, '/', N);
