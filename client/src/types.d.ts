declare module 'n8ao' {
  import type { Pass } from 'postprocessing';
  import type { Camera, Scene } from 'three';
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: Record<string, unknown> & {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      halfRes: boolean;
      gammaCorrection: boolean;
    };
    setQualityMode(mode: string): void;
    setDisplayMode(mode: string): void;
  }
}
