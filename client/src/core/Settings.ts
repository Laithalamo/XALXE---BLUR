/** Graphics quality presets. Saved per browser in localStorage. */
export type Quality = 'low' | 'medium' | 'high';

export interface GraphicsPreset {
  pixelRatio: number; // cap of devicePixelRatio (screens with more real pixels: up to pixelBudget)
  pixelBudget: number; // megapixels rendered at most on screens with several real pixels per CSS pixel
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
    pixelRatio: 1, pixelBudget: 2.1, renderScale: 0.85, shadowMapSize: 1024, shadowDistance: 80, msaa: 0, smaa: true,
    ao: false, aoHalfRes: true, aoQuality: 'Performance', bloom: true, motionBlur: false, dynamicReflections: false,
    treeDensity: 0.4, treeDistance: 240, treeShadows: false, propDensity: 0.5, drawDistance: 1300, particles: 200,
    facadeDetail: 'low',
  },
  medium: {
    pixelRatio: 1, pixelBudget: 2.1, renderScale: 1, shadowMapSize: 2048, shadowDistance: 120, msaa: 0, smaa: true,
    ao: true, aoHalfRes: true, aoQuality: 'Low', bloom: true, motionBlur: true, dynamicReflections: false,
    treeDensity: 0.7, treeDistance: 380, treeShadows: true, propDensity: 0.8, drawDistance: 2000, particles: 400,
    facadeDetail: 'high',
  },
  high: {
    pixelRatio: 1.25, pixelBudget: 3.7, renderScale: 1, shadowMapSize: 2048, shadowDistance: 160, msaa: 2, smaa: true,
    ao: true, aoHalfRes: true, aoQuality: 'Medium', bloom: true, motionBlur: true, dynamicReflections: true,
    treeDensity: 1, treeDistance: 520, treeShadows: true, propDensity: 1, drawDistance: 2800, particles: 700,
    facadeDetail: 'high',
  },
};

const KEY = 'xalxe.quality';
const AUTO_RES_KEY = 'xalxe.autores';

let gpu: string | null = null;

/** the graphics card the browser draws with ('' if it won't say) */
export function gpuName() {
  if (gpu === null) {
    gpu = '';
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      gpu = ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      /* ignore */
    }
  }
  return gpu;
}

/** the browser draws on the CPU (hardware acceleration off, or no working graphics driver) */
export function softwareRendering() {
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpuName());
}

/** Integrated / mobile GPUs start on Low, everything else on Medium. */
function detectQuality(): Quality {
  if (/intel|uhd|iris|mali|adreno|powervr|apple m\d|radeon\(tm\) graphics|vega \d+ graphics|swiftshader|llvmpipe|software|basic render/i.test(gpuName())) return 'low';
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

/** the auto resolution scale that last held steady, per quality (next race starts there) */
const RES_SCALE_KEY = 'xalxe.resscale.';

export function loadResScale(q: Quality) {
  try {
    const v = Number(localStorage.getItem(RES_SCALE_KEY + q));
    return v >= 0.55 && v <= 1 ? v : 1;
  } catch {
    return 1;
  }
}

export function saveResScale(q: Quality, scale: number) {
  try {
    localStorage.setItem(RES_SCALE_KEY + q, String(scale));
  } catch {
    /* storage blocked */
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

const CAR_KEY = 'xalxe.car';

/** the player's car id (?car= in the address wins) */
export function loadCar(valid: string[], fallback: string): string {
  const url = new URLSearchParams(location.search).get('car');
  if (url && valid.includes(url)) return url;
  try {
    const v = localStorage.getItem(CAR_KEY);
    if (v && valid.includes(v)) return v;
  } catch {
    /* storage blocked */
  }
  return fallback;
}

export function saveCar(id: string) {
  try {
    localStorage.setItem(CAR_KEY, id);
  } catch {
    /* storage blocked */
  }
}

const NAME_KEY = 'xalxe.name';

/** player name for online rooms (?name= overrides) */
export function loadName(): string {
  const url = new URLSearchParams(location.search).get('name');
  if (url) return url;
  try {
    const v = localStorage.getItem(NAME_KEY);
    if (v) return v;
  } catch {
    /* storage blocked */
  }
  return '';
}

export function saveName(n: string) {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* storage blocked */
  }
}
