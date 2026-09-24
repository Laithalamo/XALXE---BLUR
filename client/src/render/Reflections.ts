import * as THREE from 'three';

/** Layer for small props/particles that the reflection probe skips (cheaper). */
export const DETAIL_LAYER = 1;

/**
 * Real-time reflection probe that follows the player car (High quality).
 * Renders two cube faces per frame (full refresh every 3 frames) without the
 * car itself and without re-rendering shadows, then feeds the cube to the
 * car's materials so the paint reflects the actual street around it.
 */
export class CarReflections {
  readonly target: THREE.WebGLCubeRenderTarget;
  private cube: THREE.CubeCamera;
  private face = 0;

  constructor(size = 256) {
    this.target = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cube = new THREE.CubeCamera(0.4, 700, this.target);
  }

  get texture() {
    return this.target.texture;
  }

  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, car: THREE.Object3D, pos: THREE.Vector3, facesPerFrame = 2) {
    const cube = this.cube;
    cube.position.set(pos.x, pos.y + 0.9, pos.z);
    cube.updateMatrixWorld(true);
    if (cube.coordinateSystem !== renderer.coordinateSystem) {
      cube.coordinateSystem = renderer.coordinateSystem;
      cube.updateCoordinateSystem();
    }
    const cams = cube.children as THREE.PerspectiveCamera[];
    const prevTarget = renderer.getRenderTarget();
    const prevFace = renderer.getActiveCubeFace();
    const prevMip = renderer.getActiveMipmapLevel();
    const autoShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    const wasVisible = car.visible;
    car.visible = false;
    for (let k = 0; k < facesPerFrame; k++) {
      renderer.setRenderTarget(this.target, this.face);
      renderer.render(scene, cams[this.face]);
      this.face = (this.face + 1) % 6;
    }
    car.visible = wasVisible;
    renderer.shadowMap.autoUpdate = autoShadow;
    renderer.setRenderTarget(prevTarget, prevFace, prevMip);
    this.target.texture.needsPMREMUpdate = true;
  }

  /** fill all six faces at once (e.g. after a respawn) */
  prime(renderer: THREE.WebGLRenderer, scene: THREE.Scene, car: THREE.Object3D, pos: THREE.Vector3) {
    this.update(renderer, scene, car, pos, 6);
  }

  dispose() {
    this.target.dispose();
  }
}
