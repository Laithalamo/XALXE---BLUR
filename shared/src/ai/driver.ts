import type { Centerline } from '../track/centerline';
import type { RacingLine } from '../track/racingLine';
import type { DriveInput } from '../physics/vehicle';
import { emptyInput } from '../physics/vehicle';
import { clamp, rng, type Rng } from '../math';

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTY: Record<Difficulty, { pace: number; wander: number; brakeLate: number }> = {
  easy: { pace: 0.84, wander: 1.4, brakeLate: 0.0 },
  medium: { pace: 0.92, wander: 0.9, brakeLate: 0.05 },
  hard: { pace: 0.99, wander: 0.5, brakeLate: 0.1 },
};

/** What the AI needs to know about the car it drives and the cars around it. */
export interface AICarState {
  x: number;
  z: number;
  /** unit forward vector (XZ) */
  fx: number;
  fz: number;
  speed: number;
  s: number; // distance along the lap
  lateral: number; // offset from the centre line (+ = left)
}

/**
 * Racing AI: follows the racing line with pure-pursuit steering and the line's
 * speed profile, overtakes/avoids cars ahead by shifting lanes, and adds a
 * little personality (pace, line wander) per driver.
 */
export class AIDriver {
  private r: Rng;
  private wanderPhase: number;
  private laneShift = 0;
  private stuck = 0;
  private reverseTime = 0;
  /** extra pace multiplier set by the race (rubber banding) */
  catchUp = 1;
  /** per-driver talent (+- a few percent) */
  readonly talent: number;

  constructor(private cl: Centerline, private line: RacingLine, private roadWidth: number, public difficulty: Difficulty, seed: number) {
    this.r = rng(seed);
    this.wanderPhase = this.r.range(0, Math.PI * 2);
    this.talent = this.r.range(0.97, 1.03);
  }

  update(dt: number, me: AICarState, others: AICarState[], t: number): DriveInput {
    const d = emptyInput();
    const diff = DIFFICULTY[this.difficulty];
    const v = Math.max(0, me.speed);
    const L = this.line.length;

    // --- traffic: pick a lane offset to get around cars just ahead
    let desiredShift = 0;
    let blocked = false;
    for (const o of others) {
      let ds = o.s - me.s;
      if (ds < -L / 2) ds += L;
      if (ds > L / 2) ds -= L;
      if (ds > 0 && ds < 16 + v * 0.35) {
        const dl = o.lateral - (me.lateral);
        if (Math.abs(dl) < 2.6) {
          blocked = ds < 7 && o.speed < me.speed - 1;
          const leftRoom = this.roadWidth / 2 - o.lateral;
          const rightRoom = this.roadWidth / 2 + o.lateral;
          desiredShift = leftRoom > rightRoom ? 3.0 : -3.0;
        }
      }
    }
    this.laneShift += (desiredShift - this.laneShift) * Math.min(1, dt * 1.8);

    // --- steering: pure pursuit on the racing line (plus lane shift and a gentle wander)
    const look = 4.5 + v * 0.34; // short look-ahead: long ones make pure pursuit cut the apex
    const sAim = me.s + look;
    const aim = this.cl.at(sAim);
    const wander = Math.sin(t * 0.37 + this.wanderPhase) * diff.wander * 0.6;
    const lim = this.roadWidth / 2 - 1.5;
    const latAim = clamp(this.line.latAt(sAim) + this.laneShift + wander, -lim, lim);
    const ax = aim.x + aim.tz * latAim, az = aim.z - aim.tx * latAim;
    const tx = ax - me.x, tz = az - me.z;
    const tl = Math.hypot(tx, tz) || 1;
    // cross < 0 => target is to the left of the heading (steer < 0 = left)
    const cross = me.fx * (tz / tl) - me.fz * (tx / tl);
    const dot = me.fx * (tx / tl) + me.fz * (tz / tl);
    const ang = Math.atan2(cross, dot);
    d.steer = clamp(ang * 2.6, -1, 1);

    // --- speed: follow the profile a bit ahead (so braking starts in time)
    const pace = diff.pace * this.talent * this.catchUp;
    const vt = Math.min(this.line.speedAt(me.s + v * (0.45 - diff.brakeLate)), this.line.speedAt(me.s + 4)) * pace;
    const err = vt - v;
    if (err > 0) d.throttle = clamp(err * 0.45 + 0.35, 0, 1);
    else d.brake = clamp(-err * 0.22, 0, 1);
    if (blocked) { d.throttle = Math.min(d.throttle, 0.3); }

    // --- stuck against a wall? back out
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      d.throttle = 0;
      d.brake = 1;
      d.steer = -d.steer;
      return d;
    }
    this.stuck = v < 1.5 && t > 1 ? this.stuck + dt : 0;
    if (this.stuck > 1.0) {
      this.stuck = 0;
      this.reverseTime = 1.2;
    }
    return d;
  }
}
