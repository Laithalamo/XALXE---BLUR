import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** Cached loaders for textures and models. */
export class Assets {
  private tex = new THREE.TextureLoader();
  private gltf = new GLTFLoader();
  private cache = new Map<string, Promise<unknown>>();
  maxAnisotropy = 8;
  onProgress?: (loaded: number, total: number) => void;
  private total = 0;
  private done = 0;

  constructor() {
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
  }

  private track<T>(p: Promise<T>) {
    this.total++;
    this.onProgress?.(this.done, this.total);
    return p.finally(() => {
      this.done++;
      this.onProgress?.(this.done, this.total);
    });
  }

  texture(url: string, opts: { srgb?: boolean; repeat?: boolean; anisotropy?: number } = {}) {
    const key = `${url}|${opts.srgb}|${opts.repeat}`;
    if (!this.cache.has(key)) {
      this.cache.set(
        key,
        this.track(
          this.tex.loadAsync(url).then((t) => {
            t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            if (opts.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.anisotropy = opts.anisotropy ?? this.maxAnisotropy;
            return t;
          }),
        ),
      );
    }
    return this.cache.get(key) as Promise<THREE.Texture>;
  }

  /** albedo (sRGB) + normal + ORM (AO/rough/metal) texture set */
  async pbr(name: string) {
    const [map, normal, orm] = await Promise.all([
      this.texture(`textures/${name}_albedo.jpg`, { srgb: true }),
      this.texture(`textures/${name}_normal.jpg`),
      this.texture(`textures/${name}_orm.jpg`),
    ]);
    return { map, normal, orm };
  }

  model(url: string) {
    if (!this.cache.has(url)) this.cache.set(url, this.track(this.gltf.loadAsync(url)));
    return this.cache.get(url) as Promise<GLTF>;
  }
}
