import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

/**
 * Per-pixel motion blur by depth reprojection. Static world pixels are
 * reprojected with last frame's camera; pixels inside the tracked car boxes
 * are reprojected with that car's previous transform, so the car you follow
 * stays sharp while the city streaks past.
 */
const MB_FRAG = /* glsl */ `
uniform mat4 uInvViewProj;
uniform mat4 uPrevViewProj;
uniform mat4 uCarInv[4];
uniform mat4 uCarPrev[4];
uniform vec3 uCarHalf[4];
uniform int uCarCount;
uniform float uStrength;
uniform float uMaxBlur;

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float d = min(depth, 0.99999);
  vec4 ndc = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 wp = uInvViewProj * ndc;
  vec3 world = wp.xyz / wp.w;
  vec3 prevWorld = world;
  for (int i = 0; i < 4; i++) {
    if (i >= uCarCount) break;
    vec3 lp = (uCarInv[i] * vec4(world, 1.0)).xyz;
    if (all(lessThan(abs(lp - vec3(0.0, uCarHalf[i].y, 0.0)), uCarHalf[i]))) {
      prevWorld = (uCarPrev[i] * vec4(lp, 1.0)).xyz;
      break;
    }
  }
  vec4 pc = uPrevViewProj * vec4(prevWorld, 1.0);
  vec2 prevUv = pc.xy / pc.w * 0.5 + 0.5;
  vec2 vel = (uv - prevUv) * uStrength;
  float l = length(vel);
  // !(l < 10.0) also catches NaN (points behind last frame's camera)
  if (l < 0.0008 || !(l < 10.0) || pc.w <= 0.0) { outputColor = inputColor; return; }
  if (l > uMaxBlur) vel *= uMaxBlur / l;
  vec3 acc = inputColor.rgb;
  float w = 1.0;
  const int N = 12;
  // interleaved gradient noise: low-discrepancy per-pixel offset (less visible grain than a hash)
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5 + jitter * 0.5) / float(N) - 0.5;
    acc += texture2D(inputBuffer, clamp(uv + vel * t, vec2(0.001), vec2(0.999))).rgb;
    w += 1.0;
  }
  outputColor = vec4(acc / w, inputColor.a);
}
`;

export class MotionBlurEffect extends Effect {
  private prevViewProj = new THREE.Matrix4();
  private hasPrev = false;
  cars: { object: THREE.Object3D; half: THREE.Vector3; prev: THREE.Matrix4; has: boolean }[] = [];

  constructor() {
    super('MotionBlurEffect', MB_FRAG, {
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uInvViewProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uPrevViewProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uCarInv', new THREE.Uniform([0, 1, 2, 3].map(() => new THREE.Matrix4()))],
        ['uCarPrev', new THREE.Uniform([0, 1, 2, 3].map(() => new THREE.Matrix4()))],
        ['uCarHalf', new THREE.Uniform([0, 1, 2, 3].map(() => new THREE.Vector3()))],
        ['uCarCount', new THREE.Uniform(0)],
        ['uStrength', new THREE.Uniform(0.5)],
        ['uMaxBlur', new THREE.Uniform(0.05)],
      ]),
    });
  }

  track(object: THREE.Object3D, half: THREE.Vector3) {
    this.cars.push({ object, half, prev: new THREE.Matrix4(), has: false });
  }

  /** call once per frame before composer.render(); strength ~ shutter fraction (0..1) */
  prepare(camera: THREE.PerspectiveCamera, strength: number) {
    const u = this.uniforms;
    camera.updateMatrixWorld();
    const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    (u.get('uInvViewProj')!.value as THREE.Matrix4).copy(vp).invert();
    (u.get('uPrevViewProj')!.value as THREE.Matrix4).copy(this.hasPrev ? this.prevViewProj : vp);
    u.get('uStrength')!.value = strength;
    const inv = u.get('uCarInv')!.value as THREE.Matrix4[];
    const prev = u.get('uCarPrev')!.value as THREE.Matrix4[];
    const half = u.get('uCarHalf')!.value as THREE.Vector3[];
    // the shader handles 4 cars: the ones nearest the camera (the first tracked car, the
    // player, always comes first); every car's history is kept so any of them can join later
    const cam = camera.position;
    const cand = this.cars.filter((c) => c.object.visible);
    for (const c of cand) c.object.updateMatrixWorld();
    const dist = (c: (typeof cand)[number]) => (c === this.cars[0] ? -1 : c.object.position.distanceToSquared(cam));
    cand.sort((a, b) => dist(a) - dist(b));
    let n = 0;
    for (const c of cand) {
      if (n >= 4) break;
      inv[n].copy(c.object.matrixWorld).invert();
      prev[n].copy(c.has ? c.prev : c.object.matrixWorld);
      half[n].copy(c.half);
      n++;
    }
    for (const c of this.cars) {
      c.prev.copy(c.object.matrixWorld);
      c.has = true;
    }
    u.get('uCarCount')!.value = n;
    this.prevViewProj.copy(vp);
    this.hasPrev = true;
  }

  resetHistory() {
    this.hasPrev = false;
    for (const c of this.cars) c.has = false;
  }

  /** forget one car's previous transform (it teleported) */
  resetCar(object: THREE.Object3D) {
    for (const c of this.cars) if (c.object === object) c.has = false;
  }
}

/** Film-style grade after tone mapping: lift/gamma/gain, saturation, contrast, vignette, grain. */
const GRADE_FRAG = /* glsl */ `
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uSaturation;
uniform float uContrast;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;

vec3 toSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
vec3 toLin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = toSrgb(inputColor.rgb);
  c = (c - 0.5) * uContrast + 0.5;
  c = uGain * (c + uLift * (1.0 - c));
  c = pow(max(c, 0.0), 1.0 / uGamma);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  vec2 p = uv - 0.5;
  float v = 1.0 - uVignette * dot(p, p) * 2.2;
  c *= v;
  float n = fract(sin(dot(uv * (uTime + 1.7), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  c += n * uGrain;
  outputColor = vec4(toLin(clamp(c, 0.0, 1.0)), inputColor.a);
}
`;

export interface GradeParams {
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  saturation: number;
  contrast: number;
  vignette: number;
  grain: number;
}

export class ColorGradeEffect extends Effect {
  constructor(p: GradeParams) {
    super('ColorGradeEffect', GRADE_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uLift', new THREE.Uniform(new THREE.Vector3(...p.lift))],
        ['uGamma', new THREE.Uniform(new THREE.Vector3(...p.gamma))],
        ['uGain', new THREE.Uniform(new THREE.Vector3(...p.gain))],
        ['uSaturation', new THREE.Uniform(p.saturation)],
        ['uContrast', new THREE.Uniform(p.contrast)],
        ['uVignette', new THREE.Uniform(p.vignette)],
        ['uGrain', new THREE.Uniform(p.grain)],
        ['uTime', new THREE.Uniform(0)],
      ]),
    });
  }
  set(p: Partial<GradeParams>) {
    const u = this.uniforms;
    if (p.lift) (u.get('uLift')!.value as THREE.Vector3).set(...p.lift);
    if (p.gamma) (u.get('uGamma')!.value as THREE.Vector3).set(...p.gamma);
    if (p.gain) (u.get('uGain')!.value as THREE.Vector3).set(...p.gain);
    if (p.saturation !== undefined) u.get('uSaturation')!.value = p.saturation;
    if (p.contrast !== undefined) u.get('uContrast')!.value = p.contrast;
    if (p.vignette !== undefined) u.get('uVignette')!.value = p.vignette;
    if (p.grain !== undefined) u.get('uGrain')!.value = p.grain;
  }
  override update(_r: THREE.WebGLRenderer, _i: THREE.WebGLRenderTarget, dt?: number) {
    const t = this.uniforms.get('uTime')!;
    t.value = (t.value + (dt ?? 0.016)) % 100;
  }
}
