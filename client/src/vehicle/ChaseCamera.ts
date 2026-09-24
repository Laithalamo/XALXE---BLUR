import * as THREE from 'three';
import { clamp, damp } from '@shared/math';

export type CamMode = 'chase' | 'far' | 'hood' | 'bumper';
const MODES: CamMode[] = ['chase', 'far', 'hood', 'bumper'];

/**
 * Smooth third-person racing camera: lags behind the car's travel direction,
 * widens FOV with speed, adds light high-speed shake. Also hood / bumper views.
 */
export class ChaseCamera {
  mode: CamMode = 'chase';
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private dir = new THREE.Vector3(0, 0, -1);
  private first = true;
  private t = 0;
  shake = 0; // impulse shake (collisions)
  lookBack = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  cycle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.first = true;
  }

  snap() {
    this.first = true;
  }

  update(dt: number, carPos: THREE.Vector3, carQuat: THREE.Quaternion, vel: THREE.Vector3, speed: number) {
    this.t += dt;
    const cam = this.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(carQuat);
    const up = new THREE.Vector3(0, 1, 0);
    const kmh = Math.abs(speed) * 3.6;

    if (this.mode === 'hood' || this.mode === 'bumper') {
      const local = this.mode === 'hood' ? new THREE.Vector3(0, 1.12, -0.35) : new THREE.Vector3(0, 0.55, -2.3);
      cam.position.copy(local).applyQuaternion(carQuat).add(carPos);
      const target = cam.position.clone().addScaledVector(fwd, this.lookBack ? -10 : 10);
      cam.up.set(0, 1, 0).applyQuaternion(carQuat);
      cam.lookAt(target);
      cam.fov = 72 + clamp(kmh / 300, 0, 1) * 10;
      cam.updateProjectionMatrix();
      this.first = true;
      return;
    }
    cam.up.set(0, 1, 0);
    // follow a blend of heading and velocity direction (shows drift angle)
    const flatFwd = fwd.clone().setY(0).normalize();
    const flatVel = vel.clone().setY(0);
    const target = flatFwd.clone();
    if (flatVel.length() > 4 && speed > 0) target.lerp(flatVel.normalize(), 0.35).normalize();
    if (this.lookBack) target.negate();
    if (this.first) this.dir.copy(target);
    this.dir.lerp(target, damp(4.5, dt)).normalize();

    const far = this.mode === 'far';
    const dist = (far ? 8.4 : 6.1) + clamp(kmh / 300, 0, 1) * 1.1;
    const height = far ? 2.6 : 1.85;
    const desired = carPos.clone().addScaledVector(this.dir, -dist).addScaledVector(up, height);
    const lookAt = carPos.clone().addScaledVector(up, 1.0).addScaledVector(this.dir, 2.5);
    if (this.first) {
      this.pos.copy(desired);
      this.look.copy(lookAt);
      this.first = false;
    }
    this.pos.lerp(desired, damp(11, dt));
    this.pos.y = THREE.MathUtils.lerp(this.pos.y, desired.y, damp(6, dt));
    this.look.lerp(lookAt, damp(18, dt));

    // shake: engine/road at speed + impacts
    const s = clamp(kmh / 280, 0, 1) * 0.018 + this.shake;
    const sx = (Math.sin(this.t * 37.1) + Math.sin(this.t * 23.3)) * 0.5 * s;
    const sy = (Math.sin(this.t * 41.7) + Math.sin(this.t * 17.9)) * 0.5 * s;
    this.shake = Math.max(0, this.shake - dt * 0.6);

    cam.position.copy(this.pos);
    cam.position.y = Math.max(cam.position.y, 0.4);
    cam.lookAt(this.look.x + sx, this.look.y + sy, this.look.z);
    cam.fov = 60 + clamp(kmh / 300, 0, 1) * 16;
    cam.updateProjectionMatrix();
  }
}
