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

/** Fictional shop signs for building ground floors (2 columns x 8 rows, 8:1 cells). */
const SHOPS: { t: string; bg: string; fg: string; font?: string }[] = [
  { t: 'CAFÉ LUNA', bg: '#1d2b24', fg: '#f3e6c4', font: 'italic 700' },
  { t: 'PHARMACY +', bg: '#0f7a4c', fg: '#ffffff' },
  { t: 'BAKERY & CO', bg: '#6b3b1f', fg: '#ffe7b8', font: 'italic 700' },
  { t: 'BOOKS', bg: '#132447', fg: '#f1d58a' },
  { t: 'PIZZA NAPOLI', bg: '#a8141b', fg: '#ffffff' },
  { t: 'CITY BANK', bg: '#0c3f86', fg: '#ffffff' },
  { t: 'HOTEL ASTOR', bg: '#111111', fg: '#d9b86a', font: '700' },
  { t: 'FRESH MARKET', bg: '#2f6d1d', fg: '#ffffff' },
  { t: 'DELI 24', bg: '#e8c21a', fg: '#1b1b1b' },
  { t: 'SHOES', bg: '#f0ece4', fg: '#222222' },
  { t: 'SUSHI BAR', bg: '#1b1b1b', fg: '#ff4a3a' },
  { t: 'OPTICS', bg: '#dfe6ea', fg: '#0d4f8a' },
  { t: 'FLOWERS', bg: '#f2c9d4', fg: '#7a1f3d', font: 'italic 700' },
  { t: 'ELECTRONICS', bg: '#20242b', fg: '#39c6ff' },
  { t: 'BURGER JOINT', bg: '#d4581c', fg: '#fff3dc' },
  { t: 'GALLERY', bg: '#ffffff', fg: '#111111', font: '300' },
];

export function makeShopSignAtlas() {
  const cw = 1024, ch = 128, cols = 2, rows = 8;
  const c = document.createElement('canvas');
  c.width = cw * cols;
  c.height = ch * rows;
  const g = c.getContext('2d')!;
  SHOPS.forEach((s, i) => {
    const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
    g.fillStyle = s.bg;
    g.fillRect(x, y, cw, ch);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(x, y, cw, 6);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x, y + ch - 8, cw, 8);
    g.fillStyle = s.fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `${s.font ?? '700'} 74px "Arial", "DejaVu Sans", sans-serif`;
    const tw = g.measureText(s.t).width;
    const k = Math.min(1, (cw * 0.62) / tw);
    g.save();
    g.translate(x + cw / 2, y + ch / 2 + 2);
    g.scale(k, 1);
    g.fillText(s.t, 0, 0);
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  return t;
}
export const SHOP_COUNT = 16;
