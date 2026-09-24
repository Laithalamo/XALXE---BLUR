import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  ChromaticAberrationEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { GraphicsPreset } from '../core/Settings';
import { ColorGradeEffect, MotionBlurEffect, type GradeParams } from './effects';

export interface LookParams {
  exposure: number;
  bloomIntensity: number;
  bloomThreshold: number;
  grade: GradeParams;
  toneMapping: 'agx' | 'aces' | 'neutral';
}

// three r18x rotates its 5-tap PCF kernel with per-pixel noise (meant for TAA).
// Without TAA that shows up as speckle in soft/dappled shadows, so use a fixed
// rotation and a slightly wider kernel instead.
THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.replaceAll(
  'float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;',
  'float phi = 0.785;',
);

/** Renderer + post-processing chain: AO -> motion blur -> bloom/tonemap/grade -> SMAA. */
export class Pipeline {
  readonly renderer: THREE.WebGLRenderer;
  composer!: EffectComposer;
  motionBlur!: MotionBlurEffect;
  grade!: ColorGradeEffect;
  ao?: N8AOPostPass;
  bloom!: BloomEffect;
  private chroma!: ChromaticAberrationEffect;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private preset!: GraphicsPreset;
  private look!: LookParams;
  speedFx = 0; // 0..1, drives chromatic aberration at speed

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: new URLSearchParams(location.search).has('shot'),
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;
  }

  build(scene: THREE.Scene, camera: THREE.PerspectiveCamera, preset: GraphicsPreset, look: LookParams) {
    this.scene = scene;
    this.camera = camera;
    this.preset = preset;
    this.look = look;
    this.composer?.dispose();
    const r = this.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio, preset.pixelRatio) * preset.renderScale);
    r.toneMappingExposure = look.exposure;

    const composer = new EffectComposer(r, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: preset.msaa,
    });
    composer.addPass(new RenderPass(scene, camera));

    this.ao = undefined;
    if (preset.ao) {
      const w = r.domElement.width, h = r.domElement.height;
      const ao = new N8AOPostPass(scene, camera, w, h);
      ao.configuration.aoRadius = 1.6;
      ao.configuration.distanceFalloff = 0.6;
      ao.configuration.intensity = 2.2;
      ao.configuration.halfRes = preset.aoHalfRes;
      ao.configuration.gammaCorrection = false;
      ao.setQualityMode(preset.aoHalfRes ? 'Medium' : 'High');
      composer.addPass(ao);
      this.ao = ao;
    }

    this.motionBlur = new MotionBlurEffect();
    if (preset.motionBlur) composer.addPass(new EffectPass(camera, this.motionBlur));

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      intensity: look.bloomIntensity,
      luminanceThreshold: look.bloomThreshold,
      luminanceSmoothing: 0.35,
      radius: 0.72,
    });
    const tmMode = look.toneMapping === 'agx' ? ToneMappingMode.AGX : look.toneMapping === 'neutral' ? ToneMappingMode.NEUTRAL : ToneMappingMode.ACES_FILMIC;
    const tone = new ToneMappingEffect({ mode: tmMode });
    this.grade = new ColorGradeEffect(look.grade);
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: true, modulationOffset: 0.35 });
    const effects = preset.bloom ? [this.chroma, this.bloom, tone, this.grade] : [this.chroma, tone, this.grade];
    composer.addPass(new EffectPass(camera, ...effects));
    if (preset.smaa) composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    this.composer = composer;
    this.resize();
  }

  resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth || innerWidth, h = c.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number, blurStrength: number) {
    this.renderer.info.reset();
    if (this.preset.motionBlur) this.motionBlur.prepare(this.camera, blurStrength);
    const ca = 0.0012 * this.speedFx;
    this.chroma.offset.set(ca, ca * 0.6);
    this.composer.render(dt);
  }
}
