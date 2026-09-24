import type { Centerline } from '@shared/track/centerline';

export interface MapBlip {
  x: number;
  z: number;
  color: string;
  kind: 'car' | 'pickup';
}

/**
 * Rotating circular mini map (forward = up): track ribbon, start line,
 * opponents as coloured dots, power-ups as small diamonds, the player as an arrow.
 * The track is pre-rendered once to an offscreen canvas; each frame just
 * draws it rotated, which is very cheap.
 */
export class Minimap {
  readonly el: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private track: HTMLCanvasElement;
  private minX = 0;
  private minZ = 0;
  private readonly pxPerM = 1; // offscreen resolution
  private readonly zoom = 0.34; // screen px per metre
  private size: number;
  private dpr: number;

  constructor(cl: Centerline, roadWidth: number, size = 210) {
    this.size = size;
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.el = document.createElement('canvas');
    this.el.className = 'hud-map';
    this.el.width = size * this.dpr;
    this.el.height = size * this.dpr;
    this.el.style.width = `${size}px`;
    this.el.style.height = `${size}px`;
    this.g = this.el.getContext('2d')!;

    // offscreen track picture in world metres
    let maxX = -Infinity, maxZ = -Infinity;
    this.minX = Infinity;
    this.minZ = Infinity;
    for (const s of cl.samples) {
      this.minX = Math.min(this.minX, s.x); maxX = Math.max(maxX, s.x);
      this.minZ = Math.min(this.minZ, s.z); maxZ = Math.max(maxZ, s.z);
    }
    const pad = 40;
    this.minX -= pad; this.minZ -= pad;
    const w = Math.ceil(maxX + pad - this.minX), h = Math.ceil(maxZ + pad - this.minZ);
    this.track = document.createElement('canvas');
    this.track.width = w * this.pxPerM;
    this.track.height = h * this.pxPerM;
    const t = this.track.getContext('2d')!;
    t.lineCap = 'round';
    t.lineJoin = 'round';
    const path = () => {
      t.beginPath();
      cl.samples.forEach((s, i) => {
        const x = (s.x - this.minX) * this.pxPerM, y = (s.z - this.minZ) * this.pxPerM;
        if (i % 3 === 0) i === 0 ? t.moveTo(x, y) : t.lineTo(x, y);
      });
      t.closePath();
    };
    // dark outline + light road: readable over the dark map background
    path();
    t.strokeStyle = 'rgba(0,0,0,0.55)';
    t.lineWidth = (roadWidth + 16) * this.pxPerM;
    t.stroke();
    path();
    t.strokeStyle = 'rgba(226,230,238,0.9)';
    t.lineWidth = (roadWidth + 4) * this.pxPerM;
    t.stroke();
    // start / finish
    const s0 = cl.samples[0];
    const nx = s0.tz, nz = -s0.tx;
    t.strokeStyle = '#e8202a';
    t.lineWidth = 7;
    t.lineCap = 'butt';
    t.beginPath();
    t.moveTo((s0.x + nx * 11 - this.minX) * this.pxPerM, (s0.z + nz * 11 - this.minZ) * this.pxPerM);
    t.lineTo((s0.x - nx * 11 - this.minX) * this.pxPerM, (s0.z - nz * 11 - this.minZ) * this.pxPerM);
    t.stroke();
  }

  /** yaw: car heading (radians, three.js yaw around +Y; forward = -Z at yaw 0) */
  draw(px: number, pz: number, yaw: number, blips: MapBlip[]) {
    const g = this.g, S = this.size, r = S / 2;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(r, r, r - 2, 0, Math.PI * 2);
    g.fillStyle = 'rgba(8,9,12,0.55)';
    g.fill();
    g.clip();
    // world -> map: translate player to centre, rotate so the car's forward points up
    g.translate(r, r * 1.18);
    g.rotate(yaw);
    g.scale(this.zoom, this.zoom);
    g.translate(-px, -pz);
    g.drawImage(this.track, this.minX, this.minZ, this.track.width / this.pxPerM, this.track.height / this.pxPerM);
    for (const b of blips) {
      if (b.kind === 'pickup') {
        g.save();
        g.translate(b.x, b.z);
        g.rotate(Math.PI / 4 - yaw);
        g.fillStyle = b.color;
        g.fillRect(-7, -7, 14, 14);
        g.restore();
      }
    }
    for (const b of blips) {
      if (b.kind !== 'car') continue;
      g.beginPath();
      g.arc(b.x, b.z, 13, 0, Math.PI * 2);
      g.fillStyle = b.color;
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = '#000';
      g.stroke();
    }
    g.restore();
    // player arrow (screen space)
    g.save();
    g.translate(r, r * 1.18);
    g.beginPath();
    g.moveTo(0, -11);
    g.lineTo(8, 9);
    g.lineTo(0, 5);
    g.lineTo(-8, 9);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = '#e8202a';
    g.stroke();
    g.restore();
    // ring
    g.beginPath();
    g.arc(r, r, r - 2, 0, Math.PI * 2);
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.stroke();
  }
}
