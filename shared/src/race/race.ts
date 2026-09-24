import type { Centerline } from '../track/centerline';

/**
 * Race rules shared by the client (solo) and the LAN server (later):
 * countdown, lap counting on the start/finish line, lap times, positions.
 * Cars start on the grid behind the line; crossing it the first time starts lap 1.
 */
export interface RacerProgress {
  /** distance along the lap from the start line [0, length) */
  s: number;
  lateral: number;
  /** projection hint (centre-line sample index) */
  hint: number;
  /** times crossed the line forwards; 0 = still behind it on the grid */
  lap: number;
  /** highest lap reached (crossing back and forth doesn't count twice) */
  maxLap: number;
  lapStart: number;
  lastLap: number | null;
  bestLap: number | null;
  finished: boolean;
  finishTime: number;
}

export interface GridSlot {
  s: number;
  lateral: number;
}

/** grid box g (0 = pole): two staggered columns behind the line; matches the painted boxes */
export function gridSlot(g: number): GridSlot {
  return { s: -10 - g * 9 - (g % 2) * 4.5 - 2.4, lateral: g % 2 === 0 ? 3.6 : -3.6 };
}

export class Race {
  /** race clock: negative during the countdown, 0 = GO */
  time: number;
  readonly racers: RacerProgress[] = [];
  readonly finishOrder: number[] = [];
  private order: number[] = [];
  onLap: ((i: number, lap: number, lapTime: number | null) => void) | null = null;
  onFinish: ((i: number, place: number) => void) | null = null;

  constructor(private cl: Centerline, readonly laps: number, count: number, readonly countdown = 4) {
    this.time = -countdown;
    for (let i = 0; i < count; i++) {
      this.racers.push({ s: 0, lateral: 0, hint: -1, lap: 0, maxLap: 0, lapStart: 0, lastLap: null, bestLap: null, finished: false, finishTime: 0 });
      this.order.push(i);
    }
  }

  get started() {
    return this.time >= 0;
  }

  restart() {
    this.time = -this.countdown;
    this.finishOrder.length = 0;
  }

  /** put racer i at a position (grid or respawn) without counting a line crossing */
  place(i: number, x: number, z: number, resetLaps: boolean) {
    const r = this.racers[i];
    const pr = this.cl.project(x, z);
    r.s = pr.s;
    r.lateral = pr.lateral;
    r.hint = pr.index;
    if (resetLaps) {
      r.lap = pr.s > this.cl.length / 2 ? 0 : 1;
      r.maxLap = r.lap;
      r.lapStart = 0;
      r.lastLap = null;
      r.bestLap = null;
      r.finished = false;
      r.finishTime = 0;
    }
  }

  /** after each physics step: follow the car along the track and count laps */
  track(i: number, x: number, z: number) {
    const r = this.racers[i];
    const L = this.cl.length;
    const pr = this.cl.project(x, z, r.hint);
    const ds = pr.s - r.s;
    r.s = pr.s;
    r.lateral = pr.lateral;
    r.hint = pr.index;
    if (ds < -L / 2) {
      r.lap++;
      if (r.lap > r.maxLap) {
        r.maxLap = r.lap;
        let lapTime: number | null = null;
        if (r.lap >= 2 && this.started) {
          lapTime = this.time - r.lapStart;
          r.lastLap = lapTime;
          r.bestLap = r.bestLap === null ? lapTime : Math.min(r.bestLap, lapTime);
        }
        // lap 1 is timed from GO (includes the run up from the grid), so the laps add up to the race time
        if (r.lap >= 2) r.lapStart = this.time;
        if (r.lap > this.laps && !r.finished && this.started) {
          r.finished = true;
          r.finishTime = this.time;
          this.finishOrder.push(i);
          this.onFinish?.(i, this.finishOrder.length);
        } else this.onLap?.(i, r.lap, lapTime);
      }
    } else if (ds > L / 2) r.lap--;
  }

  step(dt: number) {
    this.time += dt;
    this.updateOrder();
  }

  /** total distance covered (m); finished racers rank by finishing order */
  progress(i: number) {
    const r = this.racers[i];
    if (r.finished) return 1e9 - this.finishOrder.indexOf(i);
    return r.lap * this.cl.length + r.s;
  }

  private updateOrder() {
    const p = this.racers.map((_, i) => this.progress(i));
    this.order.sort((a, b) => p[b] - p[a]);
  }

  /** racer indices in race order (leader first) */
  standings(): readonly number[] {
    return this.order;
  }

  position(i: number) {
    return this.order.indexOf(i) + 1;
  }

  /** current lap for display (1-based, capped at the lap count) */
  displayLap(i: number) {
    return Math.min(this.laps, Math.max(1, this.racers[i].lap));
  }

  lapTime(i: number) {
    const r = this.racers[i];
    if (!this.started) return 0;
    return r.finished ? r.lastLap ?? 0 : this.time - r.lapStart;
  }
}
