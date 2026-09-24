import type { Vehicle } from '../physics/vehicle';
import type { Centerline } from '../track/centerline';
import type { Corner } from '../track/corners';
import type { RacerProgress } from './race';
import { clamp, rng, type Rng } from '../math';

/**
 * Combat rules shared by the client (solo) and the LAN server (later): pickups on the
 * track, the seven power-ups, projectiles, mines, lightning, shields, health and wrecks.
 * Runs in the fixed physics step; visuals read the state and the event list.
 */
export type PowerKind = 'pulse' | 'arc' | 'surge' | 'trap' | 'barrier' | 'patch' | 'storm';
export const POWER_KINDS: readonly PowerKind[] = ['pulse', 'arc', 'surge', 'trap', 'barrier', 'patch', 'storm'];

export const POWERS: Record<PowerKind, { name: string; color: string; hint: string; weight: number }> = {
  pulse: { name: 'PULSE', color: '#b04dff', hint: 'homing shot at the car ahead', weight: 18 },
  arc: { name: 'ARC', color: '#22d3ff', hint: '3 fast shots forward', weight: 18 },
  surge: { name: 'SURGE', color: '#3f7dff', hint: 'nitro boost', weight: 16 },
  trap: { name: 'TRAP', color: '#ff9a1f', hint: 'mine behind you', weight: 14 },
  barrier: { name: 'BARRIER', color: '#36e05a', hint: 'shield', weight: 14 },
  patch: { name: 'PATCH', color: '#ff3b6b', hint: 'repair', weight: 11 },
  storm: { name: 'STORM', color: '#f7e03a', hint: 'lightning on the leaders', weight: 6 },
};

export const TUNING = {
  maxSlots: 3,
  pickupRadius: 2.6,
  pickupRespawn: 7,
  pulse: { damage: 34, speed: 80, catchUp: 30, life: 10, lock: 32, radius: 2.0 },
  arc: { damage: 11, speed: 160, life: 1.0, shots: 3, gap: 0.13, radius: 1.7 },
  trap: { damage: 30, arm: 0.45, life: 45, radius: 2.5 },
  storm: { damage: 24, delay: 0.85, targets: 3 },
  surge: { time: 3.0, accel: 7.5 },
  barrier: { time: 8, hits: 2 },
  patch: { heal: 55 },
  crash: { threshold: 6.5, perMs: 2.2, max: 24 },
  wreckTime: 2.6,
  spawnShield: 2.5,
};

export type HitKind = 'pulse' | 'arc' | 'trap' | 'storm' | 'crash';

export interface CombatCar {
  health: number;
  maxHealth: number;
  slots: PowerKind[];
  sel: number;
  shield: number;
  shieldHits: number;
  surge: number;
  /** seconds until respawn after a wreck; 0 = driving */
  wreck: number;
  arcLeft: number;
  arcTimer: number;
  lastHitBy: number;
  lastHitTime: number;
  /** skip crash detection for a few steps after scripted impulses */
  noCrash: number;
  lastVx: number;
  lastVz: number;
  stats: { hits: number; wrecks: number; kills: number; damage: number };
}

export interface Pickup {
  id: number;
  x: number;
  z: number;
  s: number;
  lateral: number;
  kind: PowerKind;
  /** > 0 while waiting to reappear */
  cooldown: number;
}

export interface Shot {
  id: number;
  kind: 'pulse' | 'arc';
  owner: number;
  target: number;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  speed: number;
  life: number;
  /** track progress / lateral (pulse path), projection hint */
  s: number;
  lat: number;
  hint: number;
}

export interface Mine {
  id: number;
  owner: number;
  x: number;
  y: number;
  z: number;
  arm: number;
  life: number;
  age: number;
}

export interface Strike {
  id: number;
  owner: number;
  target: number;
  delay: number;
}

export type CombatEvent =
  | { t: 'pickup'; car: number; kind: PowerKind }
  | { t: 'full'; car: number }
  | { t: 'fire'; car: number; kind: PowerKind }
  | { t: 'hit'; car: number; by: number; kind: HitKind; damage: number; x: number; y: number; z: number }
  | { t: 'block'; car: number; by: number; x: number; y: number; z: number }
  | { t: 'boom'; kind: HitKind; x: number; y: number; z: number }
  | { t: 'warn'; car: number; by: number }
  | { t: 'strike'; car: number; by: number; x: number; y: number; z: number }
  | { t: 'wreck'; car: number; by: number }
  | { t: 'respawn'; car: number };

const hypot3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);

export class Combat {
  readonly cars: CombatCar[] = [];
  readonly pickups: Pickup[] = [];
  readonly shots: Shot[] = [];
  readonly mines: Mine[] = [];
  readonly strikes: Strike[] = [];
  /** filled by step()/use(); the owner of the game loop drains it */
  readonly events: CombatEvent[] = [];
  time = 0;
  private nextId = 1;
  private r: Rng;
  private hw: number;

  constructor(private cl: Centerline, roadWidth: number, private corners: Corner[], count: number, maxHealth: number, seed = 4242) {
    this.r = rng(seed);
    this.hw = roadWidth / 2;
    for (let i = 0; i < count; i++) {
      this.cars.push({
        health: maxHealth, maxHealth, slots: [], sel: 0, shield: 0, shieldHits: 0, surge: 0, wreck: 0, arcLeft: 0, arcTimer: 0,
        lastHitBy: -1, lastHitTime: -99, noCrash: 0, lastVx: 0, lastVz: 0, stats: { hits: 0, wrecks: 0, kills: 0, damage: 0 },
      });
    }
    this.placePickups();
  }

  /** new race: full health, empty slots, fresh pickups */
  reset() {
    for (const c of this.cars) {
      Object.assign(c, { health: c.maxHealth, slots: [], sel: 0, shield: 0, shieldHits: 0, surge: 0, wreck: 0, arcLeft: 0, lastHitBy: -1, lastHitTime: -99, noCrash: 30 });
      c.stats = { hits: 0, wrecks: 0, kills: 0, damage: 0 };
    }
    this.shots.length = 0;
    this.mines.length = 0;
    this.strikes.length = 0;
    this.events.length = 0;
    for (const p of this.pickups) {
      p.cooldown = 0;
      p.kind = this.randomKind();
    }
  }

  /** 6 gates of 3 pickups, on straights, spread over the lap */
  private placePickups() {
    const L = this.cl.length;
    const gates = 6;
    for (let g = 0; g < gates; g++) {
      let s = 170 + (g * L) / gates;
      for (let k = 0; k < 40 && this.corners.some((c) => s > c.s0 - 45 && s < c.s1 + 20); k++) s += 10;
      const kinds = this.shuffledKinds();
      [-4.6, 0, 4.6].forEach((lat, k) => {
        const p = this.cl.at(s);
        this.pickups.push({ id: this.nextId++, x: p.x + p.tz * lat, z: p.z - p.tx * lat, s: ((s % L) + L) % L, lateral: lat, kind: kinds[k], cooldown: 0 });
      });
    }
  }

  private randomKind(): PowerKind {
    let total = 0;
    for (const k of POWER_KINDS) total += POWERS[k].weight;
    let x = this.r.next() * total;
    for (const k of POWER_KINDS) {
      x -= POWERS[k].weight;
      if (x <= 0) return k;
    }
    return 'arc';
  }

  private shuffledKinds() {
    const out: PowerKind[] = [];
    while (out.length < 3) {
      const k = this.randomKind();
      if (!out.includes(k)) out.push(k);
    }
    return out;
  }

  alive(i: number) {
    return this.cars[i].wreck <= 0;
  }

  /** select the next held power-up */
  cycle(i: number) {
    const c = this.cars[i];
    if (c.slots.length > 1) c.sel = (c.sel + 1) % c.slots.length;
  }

  /** nearest available pickup 5..maxAhead m ahead of track distance s (for the AI to aim at) */
  pickupAhead(s: number, L: number, maxAhead = 90) {
    let best: Pickup | null = null, bestD = maxAhead;
    for (const p of this.pickups) {
      if (p.cooldown > 0) continue;
      let d = p.s - s;
      if (d < 0) d += L;
      if (d > 5 && d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** a shot is flying at car i */
  incoming(i: number) {
    return this.shots.some((s) => s.kind === 'pulse' && s.target === i);
  }

  /**
   * Fire the selected power-up of car i. `order` = race order (leader first).
   * Returns false if it can't be used right now (nothing held, nobody to hit, no damage to fix).
   */
  use(i: number, vehicles: Vehicle[], prog: RacerProgress[], order: readonly number[]): boolean {
    const c = this.cars[i];
    if (c.wreck > 0 || !c.slots.length) return false;
    const kind = c.slots[c.sel];
    const v = vehicles[i];
    const t = v.body.translation();
    const q = v.body.rotation();
    let fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    const pos = order.indexOf(i);
    switch (kind) {
      case 'pulse': {
        const target = pos > 0 ? order[pos - 1] : -1;
        this.shots.push({
          id: this.nextId++, kind: 'pulse', owner: i, target, x: t.x + fx * 2.8, y: t.y + 0.9, z: t.z + fz * 2.8, dx: fx, dy: 0, dz: fz,
          speed: Math.max(TUNING.pulse.speed, v.speed + TUNING.pulse.catchUp), life: TUNING.pulse.life, s: prog[i].s + 2.8, lat: prog[i].lateral, hint: prog[i].hint,
        });
        break;
      }
      case 'arc':
        c.arcLeft = TUNING.arc.shots;
        c.arcTimer = 0;
        break;
      case 'surge':
        c.surge = TUNING.surge.time;
        break;
      case 'trap':
        this.mines.push({ id: this.nextId++, owner: i, x: t.x - fx * 3.4, y: 0.12, z: t.z - fz * 3.4, arm: TUNING.trap.arm, life: TUNING.trap.life, age: 0 });
        break;
      case 'barrier':
        c.shield = TUNING.barrier.time;
        c.shieldHits = TUNING.barrier.hits;
        break;
      case 'patch':
        if (c.health >= c.maxHealth - 0.5) return false;
        c.health = Math.min(c.maxHealth, c.health + TUNING.patch.heal);
        break;
      case 'storm': {
        const leaders = order.slice(0, Math.max(0, pos)).filter((j) => this.alive(j)).slice(0, TUNING.storm.targets);
        if (!leaders.length) return false;
        for (const j of leaders) {
          this.strikes.push({ id: this.nextId++, owner: i, target: j, delay: TUNING.storm.delay });
          this.events.push({ t: 'warn', car: j, by: i });
        }
        break;
      }
    }
    c.slots.splice(c.sel, 1);
    if (c.sel >= c.slots.length) c.sel = Math.max(0, c.slots.length - 1);
    this.events.push({ t: 'fire', car: i, kind });
    return true;
  }

  /** one fixed step of everything combat related */
  step(dt: number, vehicles: Vehicle[], prog: RacerProgress[]) {
    this.time += dt;
    const n = this.cars.length;
    for (let i = 0; i < n; i++) this.stepCar(i, dt, vehicles, prog);
    this.stepPickups(dt, vehicles);
    this.stepShots(dt, vehicles, prog);
    this.stepMines(dt, vehicles);
    this.stepStrikes(dt, vehicles);
  }

  private stepCar(i: number, dt: number, vehicles: Vehicle[], prog: RacerProgress[]) {
    const c = this.cars[i];
    const v = vehicles[i];
    const body = v.body;
    if (c.shield > 0) {
      c.shield = Math.max(0, c.shield - dt);
      if (c.shield === 0) c.shieldHits = 0;
    }
    if (c.wreck > 0) {
      c.wreck -= dt;
      if (c.wreck <= 0) {
        c.wreck = 0;
        c.health = c.maxHealth;
        c.shield = TUNING.spawnShield;
        c.shieldHits = 99;
        c.noCrash = 60;
        this.events.push({ t: 'respawn', car: i });
      }
      return;
    }
    // crash damage from sudden sideways/forward velocity changes (walls, other cars)
    const lv = body.linvel();
    if (c.noCrash > 0) c.noCrash--;
    else {
      const dv = Math.hypot(lv.x - c.lastVx, lv.z - c.lastVz);
      if (dv > TUNING.crash.threshold) {
        const dmg = Math.min(TUNING.crash.max, (dv - TUNING.crash.threshold) * TUNING.crash.perMs);
        const t = body.translation();
        const recent = this.time - c.lastHitTime < 4 ? c.lastHitBy : -1;
        this.damage(i, recent, 'crash', dmg, vehicles, t.x, t.y, t.z);
        c.noCrash = 12;
      }
    }
    c.lastVx = lv.x;
    c.lastVz = lv.z;
    if (c.wreck > 0) return;
    // nitro: extra push along the car while on the ground
    if (c.surge > 0) {
      c.surge = Math.max(0, c.surge - dt);
      if (!v.airborne && v.speed > -1) {
        const q = body.rotation();
        const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
        const k = v.spec.physics.mass * TUNING.surge.accel * dt;
        body.applyImpulse({ x: fx * k, y: 0, z: fz * k }, true);
      }
    }
    // queued arc shots
    if (c.arcLeft > 0) {
      c.arcTimer -= dt;
      if (c.arcTimer <= 0) {
        c.arcLeft--;
        c.arcTimer = TUNING.arc.gap;
        this.fireArc(i, vehicles, prog);
      }
    }
  }

  private fireArc(i: number, vehicles: Vehicle[], prog: RacerProgress[]) {
    const v = vehicles[i];
    const t = v.body.translation();
    const q = v.body.rotation();
    let fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    // gentle aim assist: bend towards a car roughly straight ahead
    let dx = fx, dz = fz, best = Math.cos((9 * Math.PI) / 180);
    for (let j = 0; j < vehicles.length; j++) {
      if (j === i || !this.alive(j)) continue;
      const o = vehicles[j].body.translation();
      const ox = o.x - t.x, oz = o.z - t.z;
      const d = Math.hypot(ox, oz);
      if (d < 4 || d > 95) continue;
      const cos = (ox * fx + oz * fz) / d;
      if (cos > best) {
        best = cos;
        dx = ox / d;
        dz = oz / d;
      }
    }
    this.shots.push({
      id: this.nextId++, kind: 'arc', owner: i, target: -1, x: t.x + fx * 2.6, y: t.y + 0.55, z: t.z + fz * 2.6, dx, dy: 0, dz,
      speed: TUNING.arc.speed + Math.max(0, v.speed), life: TUNING.arc.life, s: prog[i].s, lat: prog[i].lateral, hint: prog[i].hint,
    });
  }

  private stepPickups(dt: number, vehicles: Vehicle[]) {
    const R2 = TUNING.pickupRadius * TUNING.pickupRadius;
    for (const p of this.pickups) {
      if (p.cooldown > 0) {
        p.cooldown -= dt;
        if (p.cooldown <= 0) {
          p.cooldown = 0;
          p.kind = this.randomKind();
        }
        continue;
      }
      for (let i = 0; i < vehicles.length; i++) {
        const c = this.cars[i];
        if (c.wreck > 0) continue;
        const t = vehicles[i].body.translation();
        if ((t.x - p.x) ** 2 + (t.z - p.z) ** 2 > R2) continue;
        if (c.slots.length >= TUNING.maxSlots) {
          this.events.push({ t: 'full', car: i });
          continue;
        }
        c.slots.push(p.kind);
        p.cooldown = TUNING.pickupRespawn;
        this.events.push({ t: 'pickup', car: i, kind: p.kind });
        break;
      }
    }
  }

  private stepShots(dt: number, vehicles: Vehicle[], prog: RacerProgress[]) {
    const P = TUNING.pulse;
    for (let k = this.shots.length - 1; k >= 0; k--) {
      const s = this.shots[k];
      s.life -= dt;
      const ox = s.x, oy = s.y, oz = s.z;
      if (s.kind === 'pulse') {
        const tv = s.target >= 0 && this.alive(s.target) ? vehicles[s.target] : null;
        const tp = tv ? tv.body.translation() : null;
        if (tv) s.speed = Math.max(P.speed, tv.speed + P.catchUp);
        if (tp && hypot3(tp.x - s.x, tp.y + 0.55 - s.y, tp.z - s.z) < P.lock) {
          // close: home straight in
          const dx = tp.x - s.x, dy = tp.y + 0.55 - s.y, dz = tp.z - s.z;
          const d = hypot3(dx, dy, dz) || 1;
          s.dx = dx / d;
          s.dy = dy / d;
          s.dz = dz / d;
          s.x += s.dx * s.speed * dt;
          s.y += s.dy * s.speed * dt;
          s.z += s.dz * s.speed * dt;
        } else {
          // far: fly along the track, drifting to the target's side of the road
          s.s += s.speed * dt;
          const want = tv ? prog[s.target].lateral : s.lat;
          s.lat += (clamp(want, -this.hw + 1.5, this.hw - 1.5) - s.lat) * Math.min(1, dt * 2.5);
          const c = this.cl.at(s.s);
          const nx = c.x + c.tz * s.lat, nz = c.z - c.tx * s.lat;
          const ny = s.y + (1.0 - s.y) * Math.min(1, dt * 4);
          const d = hypot3(nx - s.x, ny - s.y, nz - s.z) || 1;
          s.dx = (nx - s.x) / d;
          s.dy = (ny - s.y) / d;
          s.dz = (nz - s.z) / d;
          s.x = nx;
          s.y = ny;
          s.z = nz;
        }
      } else {
        s.x += s.dx * s.speed * dt;
        s.z += s.dz * s.speed * dt;
      }
      // hit a car? (swept test along the step for the fast arc bolts)
      const radius = s.kind === 'pulse' ? P.radius : TUNING.arc.radius;
      let hitCar = -1;
      for (let i = 0; i < vehicles.length; i++) {
        if (i === s.owner || !this.alive(i)) continue;
        const t = vehicles[i].body.translation();
        const cx = t.x, cy = t.y + 0.5, cz = t.z;
        const sx = s.x - ox, sy = s.y - oy, sz = s.z - oz;
        const L2 = sx * sx + sy * sy + sz * sz || 1;
        const u = clamp(((cx - ox) * sx + (cy - oy) * sy + (cz - oz) * sz) / L2, 0, 1);
        const px = ox + sx * u - cx, py = oy + sy * u - cy, pz = oz + sz * u - cz;
        if (px * px + py * py + pz * pz < radius * radius) {
          hitCar = i;
          break;
        }
      }
      if (hitCar >= 0) {
        const kind = s.kind;
        const dmg = kind === 'pulse' ? P.damage : TUNING.arc.damage;
        this.damage(hitCar, s.owner, kind, dmg, vehicles, s.x, s.y, s.z, s.dx, s.dz);
        this.shots.splice(k, 1);
        continue;
      }
      // walls: arc bolts burst on the barrier; everything expires eventually
      let dead = s.life <= 0;
      if (!dead && s.kind === 'arc') {
        const pr = this.cl.project(s.x, s.z, s.hint);
        s.hint = pr.index;
        dead = Math.abs(pr.lateral) > this.hw + 0.3;
      }
      if (dead) {
        this.events.push({ t: 'boom', kind: s.kind, x: s.x, y: s.y, z: s.z });
        this.shots.splice(k, 1);
      }
    }
  }

  private stepMines(dt: number, vehicles: Vehicle[]) {
    const R2 = TUNING.trap.radius * TUNING.trap.radius;
    for (let k = this.mines.length - 1; k >= 0; k--) {
      const m = this.mines[k];
      m.arm -= dt;
      m.life -= dt;
      m.age += dt;
      if (m.life <= 0) {
        this.events.push({ t: 'boom', kind: 'trap', x: m.x, y: m.y, z: m.z });
        this.mines.splice(k, 1);
        continue;
      }
      if (m.arm > 0) continue;
      for (let i = 0; i < vehicles.length; i++) {
        if (!this.alive(i) || (i === m.owner && m.age < 4)) continue;
        const t = vehicles[i].body.translation();
        if ((t.x - m.x) ** 2 + (t.z - m.z) ** 2 < R2 && t.y < 2.5) {
          this.damage(i, m.owner, 'trap', TUNING.trap.damage, vehicles, m.x, m.y + 0.4, m.z);
          this.mines.splice(k, 1);
          break;
        }
      }
    }
  }

  private stepStrikes(dt: number, vehicles: Vehicle[]) {
    for (let k = this.strikes.length - 1; k >= 0; k--) {
      const st = this.strikes[k];
      st.delay -= dt;
      if (st.delay > 0) continue;
      this.strikes.splice(k, 1);
      if (!this.alive(st.target)) continue;
      const t = vehicles[st.target].body.translation();
      this.events.push({ t: 'strike', car: st.target, by: st.owner, x: t.x, y: t.y, z: t.z });
      this.damage(st.target, st.owner, 'storm', TUNING.storm.damage, vehicles, t.x, t.y + 0.5, t.z);
    }
  }

  /** apply damage + the matching knock to car i (shields block everything) */
  damage(i: number, by: number, kind: HitKind, amount: number, vehicles: Vehicle[], x: number, y: number, z: number, dirX = 0, dirZ = 0) {
    const c = this.cars[i];
    if (c.wreck > 0) return;
    if (c.shield > 0) {
      if (kind === 'crash') return;
      c.shieldHits--;
      if (c.shieldHits <= 0) c.shield = 0;
      this.events.push({ t: 'block', car: i, by, x, y, z });
      return;
    }
    c.health -= amount;
    if (by >= 0 && by !== i) {
      c.lastHitBy = by;
      c.lastHitTime = this.time;
      this.cars[by].stats.hits++;
    }
    c.stats.damage += amount;
    this.events.push({ t: 'hit', car: i, by, kind, damage: amount, x, y, z });
    const body = vehicles[i].body;
    const lv = body.linvel(), av = body.angvel();
    const rs = () => this.r.range(-1, 1);
    let dv = { x: 0, y: 0, z: 0 }, dw = { x: 0, y: 0, z: 0 }, keep = 1;
    if (kind === 'pulse') {
      dv = { x: dirX * 3.5, y: 5.2, z: dirZ * 3.5 };
      dw = { x: rs() * 1.6, y: rs() * 2.6, z: rs() * 1.6 };
      keep = 0.8;
    } else if (kind === 'arc') {
      dv = { x: dirX * 2.2, y: 0.9, z: dirZ * 2.2 };
      dw = { x: 0, y: rs() * 1.3, z: 0 };
    } else if (kind === 'trap') {
      dv = { x: rs() * 1.2, y: 7.2, z: rs() * 1.2 };
      dw = { x: rs() * 2.4, y: rs() * 1.6, z: rs() * 2.4 };
      keep = 0.75;
    } else if (kind === 'storm') {
      dv = { x: 0, y: 3.2, z: 0 };
      dw = { x: rs() * 0.8, y: rs() * 1.2, z: rs() * 0.8 };
      keep = 0.5;
    }
    if (kind !== 'crash') {
      body.setLinvel({ x: lv.x * keep + dv.x, y: Math.max(lv.y, 0) + dv.y, z: lv.z * keep + dv.z }, true);
      body.setAngvel({ x: av.x + dw.x, y: av.y + dw.y, z: av.z + dw.z }, true);
      c.noCrash = 30;
    }
    if (c.health <= 0) this.wreck(i, by, vehicles);
  }

  private wreck(i: number, by: number, vehicles: Vehicle[]) {
    const c = this.cars[i];
    c.health = 0;
    c.wreck = TUNING.wreckTime;
    c.slots.length = 0;
    c.sel = 0;
    c.surge = 0;
    c.shield = 0;
    c.arcLeft = 0;
    c.stats.wrecks++;
    const killer = by >= 0 && by !== i ? by : this.time - c.lastHitTime < 4 ? c.lastHitBy : -1;
    if (killer >= 0) this.cars[killer].stats.kills++;
    const body = vehicles[i].body;
    const lv = body.linvel(), av = body.angvel();
    const rs = () => this.r.range(-1, 1);
    body.setLinvel({ x: lv.x * 0.6, y: Math.max(lv.y, 0) + 8.5, z: lv.z * 0.6 }, true);
    body.setAngvel({ x: av.x + rs() * 3, y: av.y + rs() * 2.5, z: av.z + rs() * 3 }, true);
    this.events.push({ t: 'wreck', car: i, by: killer });
  }

  /**
   * AI: decide whether to use a held power-up now (picks the slot that fits the situation).
   * `order` = race order, `nextCornerDist` = metres to the next corner for this car.
   */
  aiUse(i: number, vehicles: Vehicle[], prog: RacerProgress[], order: readonly number[], L: number, nextCornerDist: number): boolean {
    const c = this.cars[i];
    if (c.wreck > 0 || !c.slots.length || c.arcLeft > 0) return false;
    const pos = order.indexOf(i);
    const me = prog[i];
    const v = vehicles[i];
    const gap = (j: number) => {
      let d = prog[j].s - me.s;
      if (d > L / 2) d -= L;
      if (d < -L / 2) d += L;
      return d; // + = ahead
    };
    const t = v.body.translation();
    const q = v.body.rotation();
    const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    // with all slots full the AI gets less picky, so it keeps collecting
    const full = c.slots.length >= TUNING.maxSlots;
    const behind = (m: number) => order.some((j) => j !== i && this.alive(j) && gap(j) < -5 && gap(j) > -m);
    const want = (k: PowerKind): boolean => {
      switch (k) {
        case 'patch':
          return c.health < c.maxHealth * (full ? 0.9 : 0.6);
        case 'barrier':
          return this.incoming(i) || full || (c.health < c.maxHealth * 0.5 && behind(40));
        case 'pulse':
          return pos > 0 && this.alive(order[pos - 1]) && gap(order[pos - 1]) < (full ? 500 : 320);
        case 'arc':
          return vehicles.some((o, j) => {
            if (j === i || !this.alive(j)) return false;
            const p = o.body.translation();
            const dx = p.x - t.x, dz = p.z - t.z, d = Math.hypot(dx, dz);
            return d > 5 && d < (full ? 120 : 85) && (dx * fx + dz * fz) / d > (full ? 0.95 : 0.975);
          });
        case 'trap':
          return behind(full ? 90 : 55);
        case 'surge':
          return nextCornerDist > (full ? 90 : 120) && v.speed > 20;
        case 'storm':
          return pos > 0 && gap(order[0]) > 8;
      }
    };
    for (let k = 0; k < c.slots.length; k++) {
      if (want(c.slots[k])) {
        c.sel = k;
        return this.use(i, vehicles, prog, order);
      }
    }
    return false;
  }
}
