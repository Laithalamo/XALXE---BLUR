import type { Vehicle } from '@shared/physics/vehicle';
import type { Quality } from '../core/Settings';

/** Minimal in-race HUD for the visual gate: speed, gear, rev bar, FPS, controls. */
export class Hud {
  private speed: HTMLElement;
  private gear: HTMLElement;
  private rpm: HTMLElement;
  private top: HTMLElement;
  private toastEl: HTMLElement;
  private help: HTMLElement;
  private toastTimer = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  fps = 0;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="hud-top"></div>
      <div class="hud-toast"></div>
      <div class="hud-help">
        <div><kbd>W</kbd><kbd>S</kbd> throttle / brake-reverse</div>
        <div><kbd>A</kbd><kbd>D</kbd> steer &nbsp; <kbd>Space</kbd> handbrake</div>
        <div><kbd>Shift</kbd> test boost &nbsp; <kbd>R</kbd> reset car</div>
        <div><kbd>C</kbd> camera &nbsp; <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> graphics &nbsp; <kbd>F</kbd> auto-res &nbsp; <kbd>H</kbd> hide help</div>
      </div>
      <div class="hud-speed">
        <div class="v">0</div><div class="u">KM/H</div>
        <div class="g">GEAR <b>1</b></div>
        <div class="hud-rpm"><div></div></div>
      </div>`;
    this.speed = root.querySelector('.hud-speed .v')!;
    this.gear = root.querySelector('.hud-speed .g b')!;
    this.rpm = root.querySelector('.hud-rpm > div')!;
    this.top = root.querySelector('.hud-top')!;
    this.toastEl = root.querySelector('.hud-toast')!;
    this.help = root.querySelector('.hud-help')!;
  }

  toggleHelp() {
    this.help.style.display = this.help.style.display === 'none' ? '' : 'none';
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = 1.6;
  }

  update(dt: number, v: Vehicle, quality: Quality, trackName: string, drawCalls: number, scale = 1, autoRes = true) {
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
      const ms = (1000 / Math.max(1, this.fps)).toFixed(1);
      const res = `${Math.round(scale * 100)}%${autoRes ? ' AUTO' : ''}`;
      this.top.innerHTML = `<b>${trackName.toUpperCase()}</b> &nbsp;·&nbsp; <b>${Math.round(this.fps)} FPS</b> (${ms} ms) &nbsp;·&nbsp; ${quality.toUpperCase()} &nbsp;·&nbsp; RES ${res} &nbsp;·&nbsp; ${drawCalls} draws`;
    }
    this.speed.textContent = String(Math.round(Math.abs(v.speed) * 3.6));
    this.gear.textContent = v.gear === 0 ? 'R' : String(v.gear);
    this.rpm.style.width = `${Math.min(100, (v.rpm / 8800) * 100)}%`;
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }
}
