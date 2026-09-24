import type { Vehicle } from '@shared/physics/vehicle';
import { CS, type CarState } from '@shared/net/protocol';
import { clamp } from '@shared/math';

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** this browser's car -> network state (see CS in protocol.ts) */
export function packCar(v: Vehicle): CarState {
  const b = v.body;
  const t = b.translation(), q = b.rotation(), lv = b.linvel(), av = b.angvel();
  let flags = (v.braking ? 1 : 0) | (v.reversing ? 2 : 0) | (v.airborne ? 4 : 0);
  v.wheels.forEach((w, k) => { if (w.inContact) flags |= 8 << k; });
  return [
    r3(t.x), r3(t.y), r3(t.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w),
    r2(lv.x), r2(lv.y), r2(lv.z), r2(av.x), r2(av.y), r2(av.z),
    r3(v.wheelSteer), flags,
    ...v.wheels.map((w) => r3(w.suspLength)),
    ...v.wheels.map((w) => Math.round(w.slipLat * 10) / 10),
    ...v.wheels.map((w) => Math.round(w.slipLong * 10) / 10),
    r2(v.drift),
  ];
}

/**
 * Another player's car (or, for the other players, the host's AI cars): a kinematic body that
 * follows the latest network state, predicted forward by its age (dead reckoning) and eased
 * onto it, so it drives smoothly, pushes the local car when they touch, and needs no physics
 * of its own. Wheels, lights and tyre smoke are posed from the state.
 */
export class RemoteCar {
  private st: CarState | null = null;
  private ts = 0;
  /** seconds since the last state arrived (car gone quiet = player left) */
  quiet = 0;

  constructor(readonly v: Vehicle) {
    v.setProxy(true);
  }

  push(st: CarState, ts: number) {
    if (st.length < CS.LEN || ts < this.ts) return;
    this.st = st;
    this.ts = ts;
    this.quiet = 0;
  }

  /** one fixed physics step; now = server clock (ms) */
  step(dt: number, now: number) {
    const st = this.st;
    const v = this.v;
    const b = v.body;
    this.quiet += dt;
    if (!st) return;
    const age = clamp((now - this.ts) / 1000, 0, 0.3);
    // predicted pose
    const px = st[CS.P] + st[CS.V] * age, py = st[CS.P + 1] + st[CS.V + 1] * age, pz = st[CS.P + 2] + st[CS.V + 2] * age;
    let qx = st[CS.Q], qy = st[CS.Q + 1], qz = st[CS.Q + 2], qw = st[CS.Q + 3];
    const wx = st[CS.W], wy = st[CS.W + 1], wz = st[CS.W + 2];
    {
      // q += 0.5 * (w, 0) * q * age
      const h = 0.5 * age;
      const nx = qx + h * (wx * qw + wy * qz - wz * qy);
      const ny = qy + h * (wy * qw + wz * qx - wx * qz);
      const nz = qz + h * (wz * qw + wx * qy - wy * qx);
      const nw = qw - h * (wx * qx + wy * qy + wz * qz);
      const l = Math.hypot(nx, ny, nz, nw) || 1;
      qx = nx / l; qy = ny / l; qz = nz / l; qw = nw / l;
    }
    const t = b.translation();
    const ex = px - t.x, ey = py - t.y, ez = pz - t.z;
    if (ex * ex + ey * ey + ez * ez > 36) {
      // too far off (respawn, first state, big lag spike): jump
      b.setTranslation({ x: px, y: py, z: pz }, true);
      b.setRotation({ x: qx, y: qy, z: qz, w: qw }, true);
      b.setLinvel({ x: st[CS.V], y: st[CS.V + 1], z: st[CS.V + 2] }, true);
      b.setAngvel({ x: wx, y: wy, z: wz }, true);
    } else {
      // ease onto the prediction within ~0.1 s, moving with the car's own velocity meanwhile
      const K = 10;
      b.setLinvel({ x: st[CS.V] + ex * K, y: st[CS.V + 1] + ey * K, z: st[CS.V + 2] + ez * K }, true);
      const q = b.rotation();
      // rotation error: target * conj(current) as a rotation vector
      let dx = qw * -q.x + qx * q.w + qy * -q.z - qz * -q.y;
      let dy = qw * -q.y - qx * -q.z + qy * q.w + qz * -q.x;
      let dz = qw * -q.z + qx * -q.y - qy * -q.x + qz * q.w;
      const dw = qw * q.w - qx * -q.x - qy * -q.y - qz * -q.z;
      if (dw < 0) { dx = -dx; dy = -dy; dz = -dz; }
      const s = Math.hypot(dx, dy, dz);
      const ang = 2 * Math.atan2(s, Math.abs(dw));
      const k = s > 1e-6 ? (ang / s) * K : 0;
      b.setAngvel({ x: wx + dx * k, y: wy + dy * k, z: wz + dz * k }, true);
    }
    // what the renderer / effects read
    const fx = -2 * (qx * qz + qw * qy), fz = -(1 - 2 * (qx * qx + qy * qy));
    v.speed = st[CS.V] * fx + st[CS.V + 2] * fz;
    const flags = st[CS.FLAGS];
    v.braking = (flags & 1) !== 0;
    v.reversing = (flags & 2) !== 0;
    v.airborne = (flags & 4) !== 0;
    v.drift = st[CS.DRIFT];
    v.wheelSteer = st[CS.STEER];
    // wheel contact points for skid marks: under each wheel along the car's down axis
    const ux = 2 * (qx * qy - qw * qz), uy = 1 - 2 * (qx * qx + qz * qz), uz = 2 * (qy * qz + qw * qx);
    const tt = b.translation();
    v.wheels.forEach((w, k) => {
      w.steer = w.spec.front ? v.wheelSteer : 0;
      w.suspLength = st[CS.SUSP + k];
      w.inContact = (flags & (8 << k)) !== 0;
      w.slipLat = st[CS.SLIP_LAT + k];
      w.slipLong = st[CS.SLIP_LONG + k];
      w.spinSpeed = w.slipLong > 0.5 && !w.spec.front ? w.spinSpeed : v.speed / w.spec.radius;
      w.spin += w.spinSpeed * dt;
      // hardpoint in world space, then down to the road
      const h = w.hardpoint;
      const hx = 2 * ((0.5 - qy * qy - qz * qz) * h.x + (qx * qy - qw * qz) * h.y + (qx * qz + qw * qy) * h.z);
      const hy = 2 * ((qx * qy + qw * qz) * h.x + (0.5 - qx * qx - qz * qz) * h.y + (qy * qz - qw * qx) * h.z);
      const hz = 2 * ((qx * qz - qw * qy) * h.x + (qy * qz + qw * qx) * h.y + (0.5 - qx * qx - qy * qy) * h.z);
      const d = w.suspLength + w.spec.radius;
      w.contact.x = tt.x + hx - ux * d;
      w.contact.y = tt.y + hy - uy * d;
      w.contact.z = tt.z + hz - uz * d;
    });
  }

  /** park out of the way (player left the race) */
  park() {
    this.st = null;
    this.v.body.setTranslation({ x: 0, y: -200, z: 0 }, true);
    this.v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}
