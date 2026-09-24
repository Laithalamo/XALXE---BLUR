import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import type { TrackTheme } from '@shared/track/trackDefs';
import type { LookParams } from './Pipeline';

/** Lighting / sky / look settings per track theme. */
export interface ThemeDef {
  hdri: string;
  /** clamp HDRI pixels (removes the photographed sun; the real-time sun replaces it) */
  hdriClamp: number;
  /** 0..1 saturation of the HDRI (tames strongly coloured photo surroundings) */
  hdriSaturation: number;
  /** neutral ground colour replacing the photo below the horizon (linear) */
  hdriGround: [number, number, number];
  envIntensity: number;
  sunAzimuth: number; // radians, atan2(x, z) of the direction TO the sun
  sunElevation?: number; // override the HDRI's sun elevation
  sunColor: number;
  sunIntensity: number;
  zenith: number;
  horizon: number;
  ground: number;
  fogDensity: number;
  cloudCover: number;
  cloudBrightness: number;
  look: LookParams;
}

export const THEMES: Record<TrackTheme, ThemeDef> = {
  day: {
    hdri: 'hdri/san_giuseppe_bridge_2k.hdr',
    hdriClamp: 18,
    hdriSaturation: 0.55,
    hdriGround: [0.16, 0.16, 0.165],
    envIntensity: 0.8,
    sunAzimuth: -1.18,
    sunElevation: 0.8,
    sunColor: 0xfff0dc,
    sunIntensity: 5.2,
    zenith: 0x2f69c4,
    horizon: 0xb4cbe3,
    ground: 0x6f7378,
    fogDensity: 0.00055,
    cloudCover: 0.5,
    cloudBrightness: 1.9,
    look: {
      exposure: 0.95,
      bloomIntensity: 0.55,
      bloomThreshold: 1.1,
      toneMapping: 'aces',
      grade: {
        lift: [0.012, 0.012, 0.02],
        gamma: [1.0, 1.0, 1.02],
        gain: [1.03, 1.0, 0.97],
        saturation: 1.08,
        contrast: 1.06,
        vignette: 0.28,
        grain: 0.012,
      },
    },
  },
  sunset: {
    hdri: 'hdri/venice_sunset_1k.hdr',
    hdriClamp: 30,
    hdriSaturation: 0.85,
    hdriGround: [0.12, 0.1, 0.09],
    envIntensity: 1.0,
    sunAzimuth: 1.2,
    sunColor: 0xffa060,
    sunIntensity: 3.0,
    zenith: 0x2a4a8a,
    horizon: 0xf0a070,
    ground: 0x504040,
    fogDensity: 0.0009,
    cloudCover: 0.45,
    cloudBrightness: 1.6,
    look: {
      exposure: 1.0,
      bloomIntensity: 0.7,
      bloomThreshold: 1.0,
      toneMapping: 'aces',
      grade: { lift: [0.02, 0.01, 0.02], gamma: [1, 1, 1], gain: [1.06, 0.98, 0.92], saturation: 1.1, contrast: 1.05, vignette: 0.32, grain: 0.015 },
    },
  },
  night: {
    hdri: 'hdri/potsdamer_platz_1k.hdr',
    hdriClamp: 4,
    hdriSaturation: 0.5,
    hdriGround: [0.01, 0.01, 0.012],
    envIntensity: 0.08,
    sunAzimuth: 0.6,
    sunElevation: 0.9,
    sunColor: 0x8fa8ff,
    sunIntensity: 0.12,
    zenith: 0x02040a,
    horizon: 0x0e1422,
    ground: 0x050507,
    fogDensity: 0.0012,
    cloudCover: 0.6,
    cloudBrightness: 0.05,
    look: {
      exposure: 1.2,
      bloomIntensity: 1.1,
      bloomThreshold: 0.6,
      toneMapping: 'aces',
      grade: { lift: [0.0, 0.005, 0.02], gamma: [1, 1, 1.03], gain: [1.0, 1.0, 1.05], saturation: 1.1, contrast: 1.08, vignette: 0.35, grain: 0.02 },
    },
  },
};

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform float uCloudCover;
uniform float uCloudBright;
uniform float uTime;
uniform sampler2D uNoise;
varying vec3 vDir;

float fbm(vec2 p) {
  float a = 0.0, w = 0.55;
  for (int i = 0; i < 5; i++) {
    a += w * texture2D(uNoise, p).g;
    p = p * 2.03 + vec2(0.17, 0.31);
    w *= 0.5;
  }
  return a;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float mu = dot(d, uSunDir);
  float t = pow(clamp(h, 0.0, 1.0), 0.42);
  vec3 sky = mix(uHorizon, uZenith, t);
  // bright band close to the horizon + sun-side brightening (cheap Mie)
  sky += uHorizon * 0.25 * exp(-max(h, 0.0) * 18.0);
  sky += uSunColor * (0.09 * pow(max(mu, 0.0), 5.0) + 0.35 * pow(max(mu, 0.0), 80.0));
  if (h < 0.0) sky = mix(uHorizon * 1.05, uGround, clamp(-h * 5.0, 0.0, 1.0));
  // clouds on a virtual plane
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.06) * 0.045 + uTime * vec2(0.0009, 0.0004);
    float n = fbm(uv);
    float detail = texture2D(uNoise, uv * 7.0).b;
    float cov = smoothstep(uCloudCover, uCloudCover + 0.28, n + (detail - 0.5) * 0.12);
    float thick = smoothstep(uCloudCover, uCloudCover + 0.55, n);
    float sunside = pow(max(mu, 0.0), 3.0);
    vec3 lit = uSunColor * (0.55 + 0.45 * sunside) + uZenith * 0.25;
    vec3 shade = mix(uHorizon, uZenith, 0.45) * 0.65;
    vec3 cloudCol = mix(lit, shade, thick * 0.65) * uCloudBright;
    // silver lining near the sun
    cloudCol += uSunColor * pow(max(mu, 0.0), 24.0) * (1.0 - thick) * 1.5;
    float fade = smoothstep(0.0, 0.22, h);
    sky = mix(sky, cloudCol, cov * fade * 0.92);
  }
  // sun disk
  float disk = smoothstep(0.99985, 0.99993, mu);
  sky += uSunColor * disk * 40.0 * smoothstep(-0.02, 0.02, h);
  gl_FragColor = vec4(sky, 1.0);
}`;

export class Environment {
  readonly sun: THREE.DirectionalLight;
  readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly sunDir = new THREE.Vector3(0.5, 0.7, 0.3).normalize();
  private shadowDistance = 150;
  theme!: ThemeDef;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, noise: THREE.Texture) {
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
    scene.add(this.sun, this.sun.target);

    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uSunDir: { value: this.sunDir },
        uSunColor: { value: new THREE.Color() },
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uCloudCover: { value: 0.5 },
        uCloudBright: { value: 1.5 },
        uTime: { value: 0 },
        uNoise: { value: noise },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);
  }

  async load(theme: ThemeDef, shadowMapSize: number, shadowDistance: number) {
    this.theme = theme;
    const hdr = await new HDRLoader().setDataType(THREE.FloatType).loadAsync(theme.hdri);
    // locate the photographed sun, then clamp it away
    const img = hdr.image as { data: Float32Array; width: number; height: number };
    const { data, width, height } = img;
    let best = 0, bi = 0;
    for (let i = 0; i < width * height; i++) {
      const l = data[i * 4] * 0.2126 + data[i * 4 + 1] * 0.7152 + data[i * 4 + 2] * 0.0722;
      if (l > best) { best = l; bi = i; }
    }
    const row = Math.floor(bi / width), col = bi % width;
    const phi = ((col + 0.5) / width - 0.5) * Math.PI * 2;
    // HDRLoader data is top row first and the texture is flipped, so row 0 = up
    const theta = (0.5 - (row + 0.5) / height) * Math.PI;
    const s0 = new THREE.Vector3(Math.cos(phi) * Math.cos(theta), Math.sin(theta), Math.sin(phi) * Math.cos(theta));
    const [gr, gg, gb] = theme.hdriGround;
    const sat = theme.hdriSaturation;
    for (let y = 0; y < height; y++) {
      const dy = Math.sin((0.5 - (y + 0.5) / height) * Math.PI); // direction.y of this row
      const ground = THREE.MathUtils.smoothstep(-dy, -0.01, 0.12); // 0 above horizon .. 1 below
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        let r = data[i], g = data[i + 1], b = data[i + 2];
        const m = Math.max(r, g, b);
        if (m > theme.hdriClamp) {
          const k = theme.hdriClamp / m;
          r *= k; g *= k; b *= k;
        }
        const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
        r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
        data[i] = r + (gr - r) * ground;
        data[i + 1] = g + (gg - g) * ground;
        data[i + 2] = b + (gb - b) * ground;
      }
    }
    hdr.needsUpdate = true;
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envRT = pmrem.fromEquirectangular(hdr);
    pmrem.dispose();
    hdr.dispose();

    const elev = theme.sunElevation ?? Math.asin(THREE.MathUtils.clamp(s0.y, 0.05, 0.99));
    const az0 = Math.atan2(s0.x, s0.z);
    const rot = theme.sunAzimuth - az0;
    this.scene.environment = envRT.texture;
    this.scene.environmentIntensity = theme.envIntensity;
    this.scene.environmentRotation.set(0, rot, 0);
    this.sunDir.set(Math.sin(theme.sunAzimuth) * Math.cos(elev), Math.sin(elev), Math.cos(theme.sunAzimuth) * Math.cos(elev));

    const u = this.sky.material.uniforms;
    (u.uSunColor.value as THREE.Color).set(theme.sunColor);
    (u.uZenith.value as THREE.Color).set(theme.zenith).multiplyScalar(1.6);
    (u.uHorizon.value as THREE.Color).set(theme.horizon).multiplyScalar(1.5);
    (u.uGround.value as THREE.Color).set(theme.ground);
    u.uCloudCover.value = theme.cloudCover;
    u.uCloudBright.value = theme.cloudBrightness;

    this.sun.color.set(theme.sunColor);
    this.sun.intensity = theme.sunIntensity;
    this.scene.fog = new THREE.FogExp2(new THREE.Color(theme.horizon).multiplyScalar(1.15), theme.fogDensity);
    this.setShadowQuality(shadowMapSize, shadowDistance);
  }

  setShadowQuality(size: number, distance: number) {
    const s = this.sun.shadow;
    this.shadowDistance = distance;
    s.mapSize.set(size, size);
    s.map?.dispose();
    s.map = null as unknown as THREE.WebGLRenderTarget;
    const cam = s.camera;
    cam.left = -distance / 2; cam.right = distance / 2;
    cam.top = distance / 2; cam.bottom = -distance / 2;
    cam.near = 1; cam.far = 900;
    cam.updateProjectionMatrix();
  }

  /** keep the sun's shadow map centred just ahead of the camera, snapped to texels */
  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera) {
    this.sky.position.copy(camera.position);
    this.sky.material.uniforms.uTime.value += dt;
    const texel = this.shadowDistance / this.sun.shadow.mapSize.x;
    const center = focus.clone();
    // light-space snapping
    const lightRot = new THREE.Matrix4().lookAt(new THREE.Vector3(), this.sunDir.clone().negate(), new THREE.Vector3(0, 1, 0));
    const inv = lightRot.clone().invert();
    center.applyMatrix4(inv);
    center.x = Math.round(center.x / texel) * texel;
    center.y = Math.round(center.y / texel) * texel;
    center.applyMatrix4(lightRot);
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(this.sunDir, 450);
    this.sun.target.updateMatrixWorld();
  }
}
