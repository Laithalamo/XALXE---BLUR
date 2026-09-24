import * as THREE from 'three';
import { emptyInput, type DriveInput, type Vehicle } from '@shared/physics/vehicle';
import type { AIDriver, AICarState } from '@shared/ai/driver';
import type { RacerProgress } from '@shared/race/race';
import type { CarView } from '../vehicle/CarView';

export interface RacerInfo {
  name: string;
  paint: number;
  /** colour of the dot on the mini map / standings */
  mapColor: string;
}

/** One car in the race: physics body, visual, optional AI, and render interpolation. */
export class Racer {
  readonly prevPos = new THREE.Vector3();
  readonly prevQuat = new THREE.Quaternion();
  readonly curPos = new THREE.Vector3();
  readonly curQuat = new THREE.Quaternion();
  /** interpolated render transform */
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly vel = new THREE.Vector3();
  readonly lastVel = new THREE.Vector3();
  input: DriveInput = emptyInput();
  /** seconds flipped / off the road / not making progress */
  stuckTime = 0;
  noProgress = 0;
  lastProgress = 0;
  /** AI reaction time at the start */
  reaction = 0;

  constructor(
    readonly index: number,
    readonly info: RacerInfo,
    readonly vehicle: Vehicle,
    readonly view: CarView,
    public ai: AIDriver | null,
    readonly isPlayer: boolean,
    /** grid box at the start (0 = pole) */
    readonly gridSlot: number,
  ) {
    this.sync();
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
  }

  savePrev() {
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
  }

  sync() {
    const t = this.vehicle.body.translation();
    const q = this.vehicle.body.rotation();
    this.curPos.set(t.x, t.y, t.z);
    this.curQuat.set(q.x, q.y, q.z, q.w);
  }

  interpolate(alpha: number) {
    this.pos.lerpVectors(this.prevPos, this.curPos, alpha);
    this.quat.slerpQuaternions(this.prevQuat, this.curQuat, alpha);
  }

  /** teleport (grid / respawn) without interpolating across the jump */
  teleport(pos: { x: number; y: number; z: number }, yaw: number) {
    this.vehicle.reset(pos, yaw);
    this.sync();
    this.savePrev();
    this.pos.copy(this.curPos);
    this.quat.copy(this.curQuat);
    this.stuckTime = 0;
    this.noProgress = 0;
    this.lastVel.set(0, 0, 0);
  }

  aiState(p: RacerProgress): AICarState {
    const q = this.curQuat;
    const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const fl = Math.hypot(fx, fz) || 1;
    return { x: this.curPos.x, z: this.curPos.z, fx: fx / fl, fz: fz / fl, speed: this.vehicle.speed, s: p.s, lateral: p.lateral };
  }
}
