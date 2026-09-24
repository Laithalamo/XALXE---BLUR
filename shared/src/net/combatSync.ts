import { POWER_KINDS, type Combat, type PowerKind } from '../race/powerups';
import type { Race } from '../race/race';
import { KIND_LETTER, type CombatSnap, type RaceSnap } from './protocol';

/**
 * Host -> other players: the power-up and race state as compact snapshots. The other browsers
 * keep a Combat / Race of their own that is never stepped for other cars, only overwritten here
 * (their visuals and HUD read it exactly as in a solo race).
 */
const LETTER_KIND = Object.fromEntries(POWER_KINDS.map((k) => [KIND_LETTER[k], k])) as Record<string, PowerKind>;
const r2 = (x: number) => Math.round(x * 100) / 100;

export function combatSnapshot(c: Combat): CombatSnap {
  return {
    c: c.cars.map((k) => [
      Math.round(k.health * 10) / 10, r2(k.shield), k.shieldHits, r2(k.surge), r2(k.wreck), k.sel,
      k.slots.map((s) => KIND_LETTER[s]).join(''), k.arcLeft, k.stats.hits, k.stats.kills,
    ]),
    p: c.pickups.map((p) => (p.cooldown > 0 ? '-' : KIND_LETTER[p.kind])).join(''),
    sh: c.shots.map((s) => [s.id, s.kind === 'pulse' ? 0 : 1, s.target, r2(s.x), r2(s.y), r2(s.z), r2(s.dx), r2(s.dy), r2(s.dz), r2(s.speed)]),
    m: c.mines.map((m) => [m.id, m.owner, r2(m.x), r2(m.y), r2(m.z), r2(m.arm)]),
  };
}

export function applyCombatSnapshot(c: Combat, s: CombatSnap) {
  s.c.forEach((v, i) => {
    const k = c.cars[i];
    if (!k) return;
    k.health = Number(v[0]);
    k.shield = Number(v[1]);
    k.shieldHits = Number(v[2]);
    k.surge = Number(v[3]);
    k.wreck = Number(v[4]);
    k.sel = Number(v[5]);
    k.slots = [...String(v[6])].map((l) => LETTER_KIND[l]).filter(Boolean);
    k.arcLeft = Number(v[7]);
    k.stats.hits = Number(v[8]);
    k.stats.kills = Number(v[9]);
  });
  [...s.p].forEach((l, i) => {
    const p = c.pickups[i];
    if (!p) return;
    if (l === '-') p.cooldown = Math.max(p.cooldown, 1);
    else {
      p.cooldown = 0;
      p.kind = LETTER_KIND[l] ?? p.kind;
    }
  });
  c.shots.length = 0;
  for (const a of s.sh) {
    c.shots.push({ id: a[0], kind: a[1] === 0 ? 'pulse' : 'arc', owner: -1, target: a[2], x: a[3], y: a[4], z: a[5], dx: a[6], dy: a[7], dz: a[8], speed: a[9], life: 1, s: 0, lat: 0, hint: -1 });
  }
  c.mines.length = 0;
  for (const a of s.m) c.mines.push({ id: a[0], owner: a[1], x: a[2], y: a[3], z: a[4], arm: a[5], life: 1, age: 1 });
}

/** between snapshots: move the shots on so they don't stutter at 10 Hz */
export function advanceMirror(c: Combat, dt: number) {
  c.time += dt;
  for (const s of c.shots) {
    s.x += s.dx * s.speed * dt;
    s.y += s.dy * s.speed * dt;
    s.z += s.dz * s.speed * dt;
  }
  for (const m of c.mines) m.arm -= dt;
  for (const k of c.cars) {
    if (k.surge > 0) k.surge = Math.max(0, k.surge - dt);
    if (k.shield > 0) k.shield = Math.max(0, k.shield - dt);
    if (k.wreck > 0) k.wreck = Math.max(0, k.wreck - dt);
  }
}

export function raceSnapshot(r: Race): RaceSnap {
  return {
    l: r.racers.map((p) => [p.lap, p.maxLap, p.finished ? 1 : 0, r2(p.finishTime), p.bestLap === null ? -1 : r2(p.bestLap)]),
    o: [...r.finishOrder],
  };
}

/** the host's laps and finishing order win (a player's own lap counter is kept while racing) */
export function applyRaceSnapshot(r: Race, s: RaceSnap, own: number) {
  s.l.forEach((v, i) => {
    const p = r.racers[i];
    if (!p) return;
    const fin = v[2] === 1;
    if (i !== own || fin) {
      p.lap = v[0];
      p.maxLap = Math.max(p.maxLap, v[1]);
    }
    if (fin && !p.finished) {
      p.finished = true;
      p.finishTime = v[3];
    }
    if (v[4] >= 0) p.bestLap = v[4];
  });
  r.finishOrder.length = 0;
  r.finishOrder.push(...s.o);
}
