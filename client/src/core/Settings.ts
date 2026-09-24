/** Graphics quality presets. Saved per browser in localStorage. */
export type Quality = 'low' | 'medium' | 'high';

export interface GraphicsPreset {
  pixelRatio: number; // cap of devicePixelRatio
  renderScale: number; // starting resolution scale (auto resolution may lower it)
  shadowMapSize: number;
  shadowDistance: number; // metres covered by the sun shadow map
  msaa: number;
  smaa: boolean;
  ao: boolean;
  aoHalfRes: boolean;
  aoQuality: 'Performance' | 'Low' | 'Medium' | 'High';
  bloom: boolean;
  motionBlur: boolean;
  dynamicReflections: boolean;
  treeDensity: number; // 0..1
  treeDistance: number; // metres; tree groups further away are hidden
  treeShadows: boolean;
  propDensity: number; // 0..1
  drawDistance: number; // camera far plane
  particles: number; // max smoke particles
  facadeDetail: 'low' | 'high'; // 'low' = no fake room interiors behind windows
}

export const PRESETS: Record<Quality, GraphicsPreset> = {
  low: {
    pixelRatio: 1, renderScale: 0.85, shadowMapSize: 1024, shadowDistance: 80, msaa: 0, smaa: true,
    ao: false, aoHalfRes: true, aoQuality: 'Performance', bloom: true, motionBlur: false, dynamicReflections: false,
    treeDensity: 0.4, treeDistance: 240, treeShadows: false, propDensity: 0.5, drawDistance: 1300, particles: 200,
    facadeDetail: 'low',
  },
  medium: {
    pixelRatio: 1, renderScale: 1, shadowMapSize: 2048, shadowDistance: 120, msaa: 0, smaa: true,
    ao: true, aoHalfRes: true, aoQuality: 'Low', bloom: true, motionBlur: true, dynamicReflections: false,
    treeDensity: 0.7, treeDistance: 380, treeShadows: true, propDensity: 0.8, drawDistance: 2000, particles: 400,
    facadeDetail: 'high',
  },
  high: {
    pixelRatio: 1.25, renderScale: 1, shadowMapSize: 2048, shadowDistance: 160, msaa: 2, smaa: true,
    ao: true, aoHalfRes: true, aoQuality: 'Medium', bloom: true, motionBlur: true, dynamicReflections: true,
    treeDensity: 1, treeDistance: 520, treeShadows: true, propDensity: 1, drawDistance: 2800, particles: 700,
    facadeDetail: 'high',
  },
};

const KEY = 'xalxe.quality';
const AUTO_RES_KEY = 'xalxe.autores';

/** Integrated / mobile GPUs start on Low, everything else on Medium. */
function detectQuality(): Quality {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/intel|uhd|iris|mali|adreno|powervr|apple m\d|radeon\(tm\) graphics|vega \d+ graphics|swiftshader/i.test(name)) return 'low';
  } catch {
    /* ignore */
  }
  return 'medium';
}

export function loadQuality(): Quality {
  const url = new URLSearchParams(location.search).get('quality');
  if (url === 'low' || url === 'medium' || url === 'high') return url;
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'low' || v === 'medium' || v === 'high') return v;
  } catch {
    /* storage blocked */
  }
  return detectQuality();
}

export function saveQuality(q: Quality) {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    /* storage blocked */
  }
}

export function loadAutoRes() {
  if (new URLSearchParams(location.search).has('shot')) return false;
  try {
    return localStorage.getItem(AUTO_RES_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveAutoRes(on: boolean) {
  try {
    localStorage.setItem(AUTO_RES_KEY, on ? 'on' : 'off');
  } catch {
    /* storage blocked */
  }
}

const AI_KEY = 'xalxe.ai';
export type AIDifficulty = 'easy' | 'medium' | 'hard';

export function loadDifficulty(): AIDifficulty {
  const url = new URLSearchParams(location.search).get('diff');
  if (url === 'easy' || url === 'medium' || url === 'hard') return url;
  try {
    const v = localStorage.getItem(AI_KEY);
    if (v === 'easy' || v === 'medium' || v === 'hard') return v;
  } catch {
    /* storage blocked */
  }
  return 'medium';
}

export function saveDifficulty(d: AIDifficulty) {
  try {
    localStorage.setItem(AI_KEY, d);
  } catch {
    /* storage blocked */
  }
}
