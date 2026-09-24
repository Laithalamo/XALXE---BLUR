/** Graphics quality presets. Saved per browser in localStorage. */
export type Quality = 'low' | 'medium' | 'high';

export interface GraphicsPreset {
  pixelRatio: number; // cap of devicePixelRatio
  renderScale: number; // extra resolution scale
  shadowMapSize: number;
  shadowDistance: number; // metres covered by the sun shadow map
  msaa: number;
  smaa: boolean;
  ao: boolean;
  aoHalfRes: boolean;
  bloom: boolean;
  motionBlur: boolean;
  dynamicReflections: boolean;
  treeDensity: number; // 0..1
  propDensity: number; // 0..1
  drawDistance: number; // camera far plane
  particles: number; // max smoke particles
}

export const PRESETS: Record<Quality, GraphicsPreset> = {
  low: {
    pixelRatio: 1, renderScale: 0.85, shadowMapSize: 1024, shadowDistance: 90, msaa: 0, smaa: true,
    ao: false, aoHalfRes: true, bloom: true, motionBlur: false, dynamicReflections: false,
    treeDensity: 0.4, propDensity: 0.5, drawDistance: 1400, particles: 250,
  },
  medium: {
    pixelRatio: 1, renderScale: 1, shadowMapSize: 2048, shadowDistance: 140, msaa: 0, smaa: true,
    ao: true, aoHalfRes: true, bloom: true, motionBlur: true, dynamicReflections: false,
    treeDensity: 0.75, propDensity: 0.8, drawDistance: 2200, particles: 500,
  },
  high: {
    pixelRatio: 1.5, renderScale: 1, shadowMapSize: 4096, shadowDistance: 180, msaa: 4, smaa: true,
    ao: true, aoHalfRes: false, bloom: true, motionBlur: true, dynamicReflections: true,
    treeDensity: 1, propDensity: 1, drawDistance: 3000, particles: 900,
  },
};

const KEY = 'xalxe.quality';

export function loadQuality(): Quality {
  const url = new URLSearchParams(location.search).get('quality');
  if (url === 'low' || url === 'medium' || url === 'high') return url;
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'low' || v === 'medium' || v === 'high') return v;
  } catch {
    /* storage blocked */
  }
  return 'high';
}

export function saveQuality(q: Quality) {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    /* storage blocked */
  }
}
