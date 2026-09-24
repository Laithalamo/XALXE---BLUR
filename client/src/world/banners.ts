import * as THREE from 'three';

/** Fictional sponsors only (no real brands). One banner per atlas row. */
const BANNERS: { text: string; sub?: string; bg: string; fg: string; accent?: string }[] = [
  { text: 'XALXE', sub: 'MIDTOWN CIRCUIT', bg: '#0b0c10', fg: '#ffffff', accent: '#e8202a' },
  { text: 'NOVA COLA', bg: '#c3121c', fg: '#ffffff' },
  { text: 'VOLTEX', sub: 'ENERGY', bg: '#ffd21f', fg: '#111111' },
  { text: 'KAIRO TYRES', bg: '#141414', fg: '#ffcc00' },
  { text: 'SKYLINE BANK', bg: '#0d3d91', fg: '#ffffff' },
  { text: 'AERO FUEL', bg: '#0f7a3c', fg: '#ffffff' },
  { text: 'ORBIT MOBILE', bg: '#5b2a9e', fg: '#ffffff' },
  { text: 'GRAND PRIX', sub: 'CITY SERIES', bg: '#f2f2f2', fg: '#c3121c', accent: '#111111' },
];
export const BANNER_COUNT = BANNERS.length;

export function makeBannerAtlas() {
  const W = 1024, H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H * BANNERS.length;
  const g = c.getContext('2d')!;
  BANNERS.forEach((b, i) => {
    const y = i * H;
    g.fillStyle = b.bg;
    g.fillRect(0, y, W, H);
    if (b.accent) {
      g.fillStyle = b.accent;
      g.fillRect(0, y + H - 26, W, 26);
      g.fillRect(0, y, 40, H);
    }
    g.fillStyle = b.fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const size = b.sub ? 132 : 150;
    g.font = `900 ${size}px "Arial Black", Impact, "DejaVu Sans", sans-serif`;
    const tw = g.measureText(b.text).width;
    const scale = Math.min(1, (W * 0.86) / tw);
    g.save();
    g.translate(W / 2, y + (b.sub ? H * 0.42 : H / 2));
    g.scale(scale, 1);
    g.fillText(b.text, 0, 0);
    g.restore();
    if (b.sub) {
      g.font = `700 44px "Arial", "DejaVu Sans", sans-serif`;
      g.fillText(b.sub.split('').join(' '), W / 2, y + H * 0.8);
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
