import type { DriveInput } from '@shared/physics/vehicle';
import { moveTowards } from '@shared/math';

/** Keyboard + gamepad input mapped to a DriveInput. */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  readonly drive: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
  enabled = true;
  private padStart = false;
  private padUse = false;
  private padNext = false;

  constructor() {
    addEventListener('keydown', (e) => {
      // typing in a text field (name, room code) is not driving
      if (e.repeat || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  /** true once per key press (consumed) */
  wasPressed(code: string) {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  update(dt: number) {
    const k = this.keys;
    let throttle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    let brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    let steerTarget = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let handbrake = k.has('Space');
    // nitro only comes from the Surge power-up (the game sets it)
    let boost = false;

    let analogSteer: number | null = null;
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad || !pad.connected) continue;
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.12) analogSteer = Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88) ** 1.4;
      throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0);
      brake = Math.max(brake, pad.buttons[6]?.value ?? 0);
      handbrake ||= !!pad.buttons[0]?.pressed || !!pad.buttons[5]?.pressed;
      if (pad.buttons[3]?.pressed) this.pressed.add('KeyR');
      // B = use power-up, X / LB = next power-up (edge-triggered)
      const use = !!pad.buttons[1]?.pressed, next = !!pad.buttons[2]?.pressed || !!pad.buttons[4]?.pressed;
      if (use && !this.padUse) this.pressed.add('KeyE');
      if (next && !this.padNext) this.pressed.add('KeyQ');
      this.padUse = use;
      this.padNext = next;
      // Start: menu / race again (edge-triggered: held buttons don't repeat)
      const start = !!pad.buttons[9]?.pressed;
      if (start && !this.padStart) this.pressed.add('PadStart');
      this.padStart = start;
    }

    if (!this.enabled) { throttle = 0; brake = 0; steerTarget = 0; handbrake = false; boost = false; analogSteer = null; }

    const d = this.drive;
    if (analogSteer !== null) d.steer = analogSteer;
    else {
      // keyboard: ramp so taps are gentle and holds are full lock
      const rate = steerTarget === 0 ? 7 : Math.sign(steerTarget) !== Math.sign(d.steer) ? 9 : 4.5;
      d.steer = moveTowards(d.steer, steerTarget, rate * dt);
    }
    d.throttle = moveTowards(d.throttle, throttle, 8 * dt);
    d.brake = moveTowards(d.brake, brake, 10 * dt);
    d.handbrake = handbrake;
    d.boost = boost;
  }
}
