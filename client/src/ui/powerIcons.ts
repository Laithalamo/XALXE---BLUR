import { POWERS, POWER_KINDS, type PowerKind } from '@shared/race/powerups';

/**
 * Power-up badges drawn with canvas paths (no image files): coloured ring,
 * dark disc and a white glyph. Used by the HUD slots and the 3D pickups.
 */
function glyph(g: CanvasRenderingContext2D, kind: PowerKind, s: number) {
  g.save();
  g.translate(s / 2, s / 2);
  g.scale(s / 100, s / 100);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  switch (kind) {
    case 'pulse': // orb with two shock rings
      g.beginPath();
      g.arc(0, 0, 11, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 6;
      for (const r of [21, 31]) {
        g.beginPath();
        g.arc(0, 0, r, -Math.PI * 0.8, -Math.PI * 0.2);
        g.stroke();
        g.beginPath();
        g.arc(0, 0, r, Math.PI * 0.2, Math.PI * 0.8);
        g.stroke();
      }
      break;
    case 'arc': // three bolts forward
      for (const x of [-18, 0, 18]) {
        g.beginPath();
        g.moveTo(x, -30);
        g.lineTo(x + 8, -14);
        g.lineTo(x + 3, -14);
        g.lineTo(x + 7, 26);
        g.lineTo(x - 7, 2);
        g.lineTo(x - 2, 2);
        g.lineTo(x - 6, -30);
        g.closePath();
        g.fill();
      }
      break;
    case 'surge': // double chevron up + flame tail
      g.lineWidth = 9;
      for (const y of [-6, 14]) {
        g.beginPath();
        g.moveTo(-22, y + 12);
        g.lineTo(0, y - 12);
        g.lineTo(22, y + 12);
        g.stroke();
      }
      g.beginPath();
      g.moveTo(0, -36);
      g.lineTo(9, -24);
      g.lineTo(-9, -24);
      g.closePath();
      g.fill();
      break;
    case 'trap': // spiked mine
      g.beginPath();
      g.arc(0, 0, 17, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 7;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * 17, Math.sin(a) * 17);
        g.lineTo(Math.cos(a) * 31, Math.sin(a) * 31);
        g.stroke();
      }
      g.fillStyle = '#000000';
      g.beginPath();
      g.arc(0, 0, 6, 0, Math.PI * 2);
      g.fill();
      break;
    case 'barrier': // shield
      g.beginPath();
      g.moveTo(0, -32);
      g.lineTo(27, -21);
      g.quadraticCurveTo(26, 16, 0, 33);
      g.quadraticCurveTo(-26, 16, -27, -21);
      g.closePath();
      g.fill();
      g.fillStyle = '#000000';
      g.beginPath();
      g.moveTo(0, -20);
      g.lineTo(16, -13);
      g.quadraticCurveTo(15, 9, 0, 20);
      g.closePath();
      g.globalAlpha = 0.35;
      g.fill();
      break;
    case 'patch': // plus / repair cross
      g.beginPath();
      g.roundRect(-9, -30, 18, 60, 4);
      g.roundRect(-30, -9, 60, 18, 4);
      g.fill();
      break;
    case 'storm': // lightning bolt
      g.beginPath();
      g.moveTo(8, -36);
      g.lineTo(-18, 4);
      g.lineTo(-2, 4);
      g.lineTo(-10, 36);
      g.lineTo(20, -8);
      g.lineTo(3, -8);
      g.lineTo(12, -36);
      g.closePath();
      g.fill();
      break;
  }
  g.restore();
}

/** one badge (transparent background) into a canvas at (ox, 0) */
function badge(g: CanvasRenderingContext2D, kind: PowerKind, ox: number, s: number) {
  g.save();
  g.translate(ox, 0);
  const col = POWERS[kind].color;
  const r = s / 2;
  // soft outer glow
  const grd = g.createRadialGradient(r, r, r * 0.55, r, r, r);
  grd.addColorStop(0, col + 'cc');
  grd.addColorStop(1, col + '00');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.fill();
  // disc + ring
  g.fillStyle = 'rgba(10,11,16,0.85)';
  g.beginPath();
  g.arc(r, r, r * 0.66, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = s * 0.07;
  g.strokeStyle = col;
  g.beginPath();
  g.arc(r, r, r * 0.66, 0, Math.PI * 2);
  g.stroke();
  // glyph
  g.translate(r * 0.3, r * 0.3);
  glyph(g, kind, s * 0.7);
  g.restore();
}

let atlas: HTMLCanvasElement | null = null;
const urls = new Map<string, string>();

/** 8 cells in a row (7 used), 128 px each */
export function powerAtlas() {
  if (atlas) return atlas;
  atlas = document.createElement('canvas');
  atlas.width = 128 * 8;
  atlas.height = 128;
  const g = atlas.getContext('2d')!;
  POWER_KINDS.forEach((k, i) => badge(g, k, i * 128, 128));
  return atlas;
}

/** HUD icon (data URL) */
export function powerIconUrl(kind: PowerKind, size = 96) {
  const key = `${kind}:${size}`;
  let u = urls.get(key);
  if (!u) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    badge(c.getContext('2d')!, kind, 0, size);
    u = c.toDataURL();
    urls.set(key, u);
  }
  return u;
}
