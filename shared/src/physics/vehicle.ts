import RAPIER from '@dimforge/rapier3d-compat';
import type { CarSpec, WheelSpec } from '../cars';
import { clamp, lerp, moveTowards } from '../math';
import * as V from './vec';
import type { V3 } from './vec';

/**
 * Arcade-realistic raycast vehicle on top of a Rapier rigid body.
 * Every wheel is a ray (suspension spring + damper) and a tyre model
 * (slip-angle lateral force, drive/brake longitudinal force, friction circle).
 * Shared by client and (later) the authoritative LAN server.
 */
export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1 (also reverse when stopped)
  steer: number; // -1 (left) .. 1 (right)
  handbrake: boolean;
  boost: boolean;
}
export const emptyInput = (): DriveInput => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false });

export interface WheelSim {
  spec: WheelSpec;
  hardpoint: V3; // model space (top of the suspension)
  inContact: boolean;
  compression: number;
  /** hardpoint -> wheel centre distance, for rendering */
  suspLength: number;
  steer: number;
  spin: number;
  spinSpeed: number;
  load: number;
  /** sideways sliding speed at the contact patch (m/s) */
  slipLat: number;
  /** wheelspin / lock-up speed difference (m/s) */
  slipLong: number;
  contact: V3;
  normal: V3;
}

const UP = V.v3(0, 1, 0);
const FWD = V.v3(0, 0, -1);
const RIGHT = V.v3(1, 0, 0);
const GEAR_TOP = [0.2, 0.33, 0.46, 0.59, 0.72, 0.86, 1.02];
const IDLE_RPM = 1000;
const REDLINE = 8800;

/** Pacejka-like lateral curve: peaks at x = 1, settles to ~0.89 when sliding. */
function tyreCurve(x: number) {
  const s = Math.sign(x);
  return s * Math.sin(1.3 * Math.atan(2.62 * Math.abs(x)));
}

export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly wheels: WheelSim[];
  readonly spec: CarSpec;
  /** forward speed, m/s (negative when reversing) */
  speed = 0;
  steerAngle = 0;
  rpm = IDLE_RPM;
  gear = 1;
  throttle = 0;
  braking = false;
  reversing = false;
  airborne = false;
  /** 0..1 how hard the car is sliding (for smoke / sound) */
  slide = 0;

  private tmp = { a: V.v3(), b: V.v3(), c: V.v3(), d: V.v3(), e: V.v3() };
  private up = V.v3();
  private fwd = V.v3();
  private right = V.v3();
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  constructor(private world: RAPIER.World, spec: CarSpec, pos: V3, yaw: number) {
    this.spec = spec;
    const p = spec.physics;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation(V.quatFromYaw(yaw))
      .setLinearDamping(0.02)
      .setAngularDamping(0.35)
      .setCanSleep(false)
      .setCcdEnabled(true);
    this.body = world.createRigidBody(desc);
    const b = p.box;
    const chassis = RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
      .setTranslation(0, b.cy, b.cz)
      .setDensity(0)
      .setFriction(0.25)
      .setRestitution(0.15);
    world.createCollider(chassis, this.body);
    const cabin = RAPIER.ColliderDesc.cuboid(b.hx * 0.72, 0.2, b.hz * 0.42)
      .setTranslation(0, b.cy + b.hy + 0.18, 0.15)
      .setDensity(0)
      .setFriction(0.25)
      .setRestitution(0.15);
    world.createCollider(cabin, this.body);
    // explicit mass properties: box inertia of a car-sized block
    const m = p.mass, w = 1.9, h = 1.15, l = 4.5;
    this.body.setAdditionalMassProperties(
      m,
      { x: p.com[0], y: p.com[1], z: p.com[2] },
      { x: (m / 12) * (h * h + l * l), y: (m / 12) * (w * w + l * l) * 1.1, z: (m / 12) * (w * w + h * h) },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );

    const s = p.suspension;
    const staticComp = (m * 9.81) / 4 / s.stiffness;
    this.wheels = spec.wheels.map((ws) => ({
      spec: ws,
      hardpoint: V.v3(ws.x, ws.y + s.rest - staticComp, ws.z),
      inContact: false,
      compression: staticComp,
      suspLength: s.rest - staticComp,
      steer: 0,
      spin: 0,
      spinSpeed: 0,
      load: 0,
      slipLat: 0,
      slipLong: 0,
      contact: V.v3(),
      normal: V.v3(0, 1, 0),
    }));
  }

  /** Teleport (respawn / grid placement). */
  reset(pos: V3, yaw: number) {
    this.body.setTranslation(pos, true);
    this.body.setRotation(V.quatFromYaw(yaw), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    for (const w of this.wheels) { w.spinSpeed = 0; w.compression = 0; }
  }

  /** Apply suspension + tyre + aero forces. Call once per fixed physics step, before world.step(). */
  step(dt: number, input: DriveInput) {
    const p = this.spec.physics;
    const s = p.suspension;
    const body = this.body;
    const { a, b, c, d, e } = this.tmp;
    const q = body.rotation();
    const t = body.translation();
    const lv = body.linvel();
    const av = body.angvel();
    const com = body.worldCom();
    const up = V.rotate(this.up, q, UP);
    const fwd = V.rotate(this.fwd, q, FWD);
    const right = V.rotate(this.right, q, RIGHT);

    const vFwd = V.dot(lv, fwd);
    const speedAbs = Math.abs(vFwd);
    this.speed = vFwd;
    const vtop = p.topSpeed * (input.boost ? 1.18 : 1);

    // ---- steering (speed sensitive, rate limited) --------------------------
    const hs = Math.pow(clamp(speedAbs / p.topSpeed, 0, 1), 0.65);
    const steerLimit = lerp(p.maxSteer, p.highSpeedSteer, hs);
    const target = clamp(input.steer, -1, 1) * steerLimit;
    const returning = Math.abs(target) < Math.abs(this.steerAngle);
    this.steerAngle = moveTowards(this.steerAngle, target, (returning ? 4.5 : 2.6) * dt);

    // ---- powertrain -----------------------------------------------------------
    let drive = 0;
    let brake = 0;
    this.reversing = false;
    const power = p.enginePower * (input.boost ? 1.55 : 1);
    const engineForce = (v: number) => Math.min(p.maxDriveForce * (input.boost ? 1.25 : 1), power / Math.max(v, 0.5));
    if (input.throttle > 0.01) {
      if (vFwd > -1.5) drive = engineForce(Math.max(vFwd, 0)) * input.throttle;
      else brake = input.throttle;
    }
    if (input.brake > 0.01) {
      if (vFwd > 1.5) brake = Math.max(brake, input.brake);
      else if (input.throttle < 0.01) {
        this.reversing = true;
        drive = vFwd > -14 ? -p.maxDriveForce * 0.45 * input.brake : 0;
      }
    }
    this.throttle = input.throttle;
    this.braking = brake > 0.05;

    // ---- suspension rays ---------------------------------------------------------
    const maxLen = s.rest + 0.0;
    let contacts = 0;
    for (const w of this.wheels) {
      const r = w.spec.radius;
      V.rotate(a, q, w.hardpoint);
      V.add(a, a, t); // hardpoint world
      this.ray.origin = a;
      this.ray.dir = { x: -up.x, y: -up.y, z: -up.z };
      const hit = this.world.castRayAndGetNormal(
        this.ray, maxLen + r, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, body,
      );
      const prev = w.compression;
      if (hit) {
        const dist = hit.timeOfImpact;
        w.inContact = true;
        w.compression = maxLen + r - dist;
        w.suspLength = dist - r;
        V.addScaled(w.contact, a, up, -dist);
        V.set(w.normal, hit.normal.x, hit.normal.y, hit.normal.z);
        const compVel = (w.compression - prev) / dt;
        let f = s.stiffness * w.compression + s.damping * compVel;
        if (w.compression > s.travel) f += (w.compression - s.travel) * s.stiffness * 8;
        w.load = Math.max(0, f);
        contacts++;
      } else {
        w.inContact = false;
        w.compression = 0;
        w.suspLength = maxLen;
        w.load = 0;
      }
    }
    this.airborne = contacts === 0;

    // anti-roll bars
    for (const [l, rr] of [[0, 1], [2, 3]] as const) {
      const wl = this.wheels[l], wr = this.wheels[rr];
      if (wl.inContact && wr.inContact) {
        const f = (wl.compression - wr.compression) * p.antiRoll;
        wl.load = Math.max(0, wl.load + f);
        wr.load = Math.max(0, wr.load - f);
      }
    }

    // ---- tyre forces ------------------------------------------------------------------
    const downforce = p.downforce * vFwd * vFwd;
    const rearDriven = p.driven === 'rear';
    let slideSum = 0;
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      const front = w.spec.front;
      w.steer = front ? this.steerAngle : 0;
      if (!w.inContact) {
        w.slipLat = 0;
        w.slipLong = 0;
        const driven = rearDriven ? !front : true;
        w.spinSpeed = driven && input.throttle > 0.1 ? Math.min(w.spinSpeed + 60 * dt, 120) : w.spinSpeed * 0.985;
        w.spin += w.spinSpeed * dt;
        continue;
      }
      const n = w.normal;
      // wheel heading
      const cs = Math.cos(w.steer), sn = Math.sin(w.steer);
      V.set(b, fwd.x * cs + right.x * sn, fwd.y * cs + right.y * sn, fwd.z * cs + right.z * sn);
      V.addScaled(b, b, n, -V.dot(b, n));
      V.normalize(b, b); // f
      V.cross(c, b, n); // r (points right)
      // contact velocity
      V.sub(d, w.contact, com);
      V.cross(e, av, d);
      V.add(e, e, lv);
      const vl = V.dot(e, b);
      const vs = V.dot(e, c);

      const N = w.load + downforce * 0.25;
      const mu = p.grip * (front ? 1 : p.rearGripBias);
      const muN = mu * N;
      const driven = rearDriven ? !front : true;

      // longitudinal
      let fx = 0;
      if (driven && drive !== 0) {
        const share = rearDriven ? 0.5 : front ? 0.2 : 0.3;
        fx += drive * share;
        // open diff + traction control: both wheels on an axle get the same force,
        // limited by the less loaded one, keeping lateral grip in reserve
        const mate = this.wheels[i ^ 1];
        const axleMuN = mate.inContact ? Math.min(muN, mu * (mate.load + downforce * 0.25)) : muN;
        const tc = input.handbrake ? 1.0 : 0.9;
        fx = clamp(fx, -axleMuN * tc, axleMuN * tc);
      }
      if (brake > 0) {
        const bias = front ? 0.3 : 0.2;
        fx -= p.brakeForce * bias * brake * clamp(vl / 0.6, -1, 1);
      }
      let latGrip = 1;
      if (input.handbrake && !front) {
        fx -= p.brakeForce * 0.22 * clamp(vl / 0.6, -1, 1);
        latGrip = p.driftGrip;
      }
      fx -= vl * 12; // rolling resistance

      // lateral (slip angle)
      const vRef = Math.max(Math.abs(vl), 3.5);
      const alpha = Math.atan2(vs, vRef);
      let fy = -muN * latGrip * tyreCurve(alpha / 0.13);
      if (Math.abs(vl) < 2.5) {
        // low speed: behave like static friction so the car doesn't creep sideways
        const stick = clamp((-vs * p.mass * 0.25) / dt * 0.35, -muN, muN);
        fy = lerp(stick, fy, Math.abs(vl) / 2.5);
      }
      // friction circle, longitudinal priority
      fx = clamp(fx, -muN, muN);
      const fyMax = Math.sqrt(Math.max(0, muN * muN - fx * fx));
      fy = clamp(fy, -fyMax, fyMax);

      w.slipLat = vs;
      // visual wheel spin
      const wantSpin = driven && drive > 0 && input.handbrake;
      let spin = vl / w.spec.radius;
      let slipLong = 0;
      if (input.handbrake && !front) { spin = 0; slipLong = Math.abs(vl); }
      else if (wantSpin || (driven && drive > muN * 0.95 && speedAbs < 12)) {
        const extra = 18 * input.throttle;
        spin += extra;
        slipLong = extra * w.spec.radius;
      }
      w.spinSpeed = spin;
      w.spin += spin * dt;
      w.slipLong = slipLong;
      slideSum += Math.min(1, Math.max(0, (Math.abs(vs) - 2.5) / 6) + slipLong / 8);

      // apply: longitudinal at the contact, lateral lifted toward the CoM (less body roll)
      V.set(a, b.x * fx + c.x * fy, b.y * fx + c.y * fy, b.z * fx + c.z * fy);
      V.addScaled(d, w.contact, up, 0.25);
      body.applyImpulseAtPoint({ x: a.x * dt, y: a.y * dt, z: a.z * dt }, d, true);
      // suspension (along the chassis up axis, at the hardpoint)
      V.rotate(d, q, w.hardpoint);
      V.add(d, d, t);
      const sf = w.load * dt;
      body.applyImpulseAtPoint({ x: up.x * sf, y: up.y * sf, z: up.z * sf }, d, true);
    }
    this.slide = slideSum / 4;

    // ---- aero -----------------------------------------------------------------------------
    const spd = Math.hypot(lv.x, lv.y, lv.z);
    const dragK = power / (vtop * vtop * vtop);
    const drag = dragK * spd;
    body.applyImpulse({ x: -lv.x * drag * dt, y: -lv.y * drag * dt, z: -lv.z * drag * dt }, true);
    if (contacts > 0) {
      const df = downforce * dt;
      body.applyImpulse({ x: -up.x * df, y: -up.y * df, z: -up.z * df }, true);
    }

    // ---- arcade assists ----------------------------------------------------------------
    const I = p.mass * 3.0;
    if (contacts === 0) {
      // in the air: gently level the car and calm spins
      const lx = -up.z, lz = up.x; // up x worldUp: torque axis that rotates 'up' toward world up
      body.applyTorqueImpulse({ x: (lx * 4 - av.x * 1.5) * I * dt, y: -av.y * 0.5 * I * dt, z: (lz * 4 - av.z * 1.5) * I * dt }, true);
    } else if (Math.abs(input.steer) < 0.1 && !input.handbrake) {
      // straight-line stability: damp yaw when the player lets go of the wheel
      const yawRate = V.dot(av, up);
      const k = -yawRate * I * 1.2 * dt * clamp(speedAbs / 10, 0, 1);
      body.applyTorqueImpulse({ x: up.x * k, y: up.y * k, z: up.z * k }, true);
    }

    // ---- gearbox (for sound / HUD) ------------------------------------------------------------
    const v = Math.max(0, vFwd);
    const gtop = GEAR_TOP.map((g) => g * p.topSpeed);
    if (this.reversing || vFwd < -0.5) this.gear = 0;
    else {
      if (this.gear < 1) this.gear = 1;
      while (this.gear < gtop.length && v > gtop[this.gear - 1] * 0.96) this.gear++;
      while (this.gear > 1 && v < gtop[this.gear - 2] * 0.62) this.gear--;
    }
    const gi = Math.max(1, this.gear);
    const lo = gi > 1 ? gtop[gi - 2] * 0.55 : 0;
    const ratio = clamp((v - lo) / (gtop[gi - 1] - lo), 0, 1);
    let targetRpm = IDLE_RPM + (REDLINE - IDLE_RPM) * (0.25 + 0.75 * ratio);
    if (v < 1 && input.throttle < 0.05) targetRpm = IDLE_RPM;
    if (this.wheels.some((w) => w.slipLong > 1)) targetRpm = Math.max(targetRpm, 7000 + 1500 * input.throttle);
    if (contacts === 0 && input.throttle > 0.1) targetRpm = REDLINE * 0.95;
    this.rpm = lerp(this.rpm, targetRpm, 1 - Math.exp(-12 * dt));
  }

  /** true when the roof points more down than up */
  isUpsideDown() {
    const q = this.body.rotation();
    V.rotate(this.tmp.a, q, UP);
    return this.tmp.a.y < 0.2;
  }
}
