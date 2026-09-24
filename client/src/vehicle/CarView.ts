import * as THREE from 'three';
import type { CarSpec } from '@shared/cars';
import type { Vehicle } from '@shared/physics/vehicle';
import type { Assets } from '../core/Assets';

/**
 * Visual car: loads the processed GLB, swaps in high quality PBR materials
 * (clearcoat metallic paint with flakes, glass, chrome, rubber, emissive
 * lights) and animates wheels / lights from the physics state.
 */
export interface CarMaterials {
  paint: THREE.MeshPhysicalMaterial;
  tail: THREE.MeshPhysicalMaterial;
  brake: THREE.MeshPhysicalMaterial;
  head: THREE.MeshStandardMaterial;
  drl: THREE.MeshStandardMaterial;
  disc: THREE.MeshStandardMaterial;
}

let flakeTex: THREE.Texture | null = null;

function makeMaterials(paintColor: number, flakes: THREE.Texture): Record<string, THREE.Material> & CarMaterials {
  const paint = new THREE.MeshPhysicalMaterial({
    color: paintColor,
    metalness: 0.62,
    roughness: 0.34,
    clearcoat: 1,
    clearcoatRoughness: 0.025,
    envMapIntensity: 1.1,
  });
  // metallic flakes: object-space triplanar normal noise on the base layer only
  paint.onBeforeCompile = (sh) => {
    sh.uniforms.uFlakes = { value: flakes };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos; varying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position; vObjN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uFlakes; varying vec3 vObjPos; varying vec3 vObjN;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 w = pow(abs(normalize(vObjN)), vec3(4.0)); w /= (w.x + w.y + w.z);
          vec3 p = vObjPos * 6.0;
          vec3 f = (texture2D(uFlakes, p.yz).xyz * w.x + texture2D(uFlakes, p.xz).xyz * w.y + texture2D(uFlakes, p.xy).xyz * w.z) * 2.0 - 1.0;
          normal = normalize(normal + (viewMatrix * vec4(f.x, f.y, 0.0, 0.0)).xyz * 0.35);
        }`,
      );
  };
  paint.customProgramCacheKey = () => 'car-paint';

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    roughness: 0.02,
    metalness: 0,
    transparent: true,
    opacity: 0.55,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: 1.2,
  });
  const tail = new THREE.MeshPhysicalMaterial({ color: 0x6a0303, emissive: 0xff1208, emissiveIntensity: 0.35, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03 });
  const brake = new THREE.MeshPhysicalMaterial({ color: 0x4a0202, emissive: 0xff1a0a, emissiveIntensity: 0.1, roughness: 0.2, clearcoat: 1 });
  const head = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, emissive: 0xe8f0ff, emissiveIntensity: 0.6, roughness: 0.08, metalness: 0.3 });
  const drl = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4f8ff, emissiveIntensity: 3.5, roughness: 0.2 });
  const disc = new THREE.MeshStandardMaterial({ color: 0x6f7072, metalness: 0.9, roughness: 0.42, emissive: 0xff3300, emissiveIntensity: 0 });
  return {
    paint, glass, tail, brake, head, drl, disc,
    chrome: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.06 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x55585d, metalness: 0.85, roughness: 0.35 }),
    metal_dark: new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0.7, roughness: 0.35 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x9da1a8, metalness: 1, roughness: 0.2 }),
    brake_disc: disc,
    tire: new THREE.MeshStandardMaterial({ color: 0x121212, metalness: 0, roughness: 0.86 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0.1, roughness: 0.55 }),
    black_plastic: new THREE.MeshStandardMaterial({ color: 0x0a0a0b, metalness: 0.1, roughness: 0.6 }),
    carbon: new THREE.MeshPhysicalMaterial({ color: 0x0f1012, metalness: 0.3, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.05 }),
    light_tail: tail,
    light_brake: brake,
    light_head: head,
    light_drl: drl,
    interior_dark: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.75 }),
    interior_mid: new THREE.MeshStandardMaterial({ color: 0x3b3c3e, roughness: 0.5, metalness: 0.4 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.55 }),
    leather_accent: new THREE.MeshStandardMaterial({ color: 0x6a1111, roughness: 0.5 }),
    carpet: new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 1 }),
  };
}

interface WheelRig {
  steer: THREE.Object3D;
  spin: THREE.Object3D;
  baseY: number;
}

export class CarView {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  mats!: ReturnType<typeof makeMaterials>;
  private wheels: WheelRig[] = [];
  readonly headLights: THREE.SpotLight[] = [];
  /** local bounding half-extents (for motion blur masks etc.) */
  readonly half = new THREE.Vector3(1.15, 0.72, 2.4);
  private shadowBlob!: THREE.Mesh;

  constructor(readonly spec: CarSpec) {}

  async load(assets: Assets, paintColor = this.spec.paint, withHeadlights = false) {
    flakeTex ??= await assets.texture('textures/flakes_normal.png');
    const gltf = await assets.model(this.spec.model);
    const scene = gltf.scene.clone(true);
    this.mats = makeMaterials(paintColor, flakeTex);
    for (const mat of Object.values(this.mats)) (mat as THREE.Material).side = THREE.DoubleSide;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const slot = (m.material as THREE.Material).name;
      const mat = this.mats[slot];
      if (mat) m.material = mat;
      else console.warn('car: no material for slot', slot);
      m.castShadow = slot !== 'glass';
      m.receiveShadow = true;
    });
    // wheel rigs: steer pivot -> spin node (the GLB wheel node)
    const names = ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'];
    for (let i = 0; i < 4; i++) {
      const node = scene.getObjectByName(names[i]);
      if (!node) throw new Error('missing ' + names[i]);
      const ws = this.spec.wheels[i];
      const steer = new THREE.Object3D();
      steer.position.set(ws.x, ws.y, ws.z);
      node.position.set(0, 0, 0);
      node.parent!.remove(node);
      steer.add(node);
      this.body.add(steer);
      this.wheels.push({ steer, spin: node, baseY: ws.y });
    }
    this.body.add(scene);
    this.root.add(this.body);

    // soft contact shadow under the car (ambient occlusion blob)
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      map: aoBlobTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.75,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
    }));
    blob.position.y = 0.02;
    blob.renderOrder = 1;
    this.shadowBlob = blob;
    this.root.add(blob);

    if (withHeadlights) {
      for (const x of [-0.62, 0.62]) {
        const l = new THREE.SpotLight(0xf2f6ff, 60, 70, 0.42, 0.45, 1.6);
        l.position.set(x, 0.68, -1.95);
        l.target.position.set(x * 1.4, 0.0, -14);
        l.castShadow = false;
        this.body.add(l, l.target);
        this.headLights.push(l);
      }
    }
    return this;
  }

  setPaint(color: number) {
    this.mats.paint.color.setHex(color);
  }

  /** sync from physics (already interpolated transform passed in) */
  update(v: Vehicle, pos: THREE.Vector3, quat: THREE.Quaternion, night: boolean) {
    this.root.position.copy(pos);
    this.root.quaternion.copy(quat);
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i];
      const rig = this.wheels[i];
      rig.steer.position.y = w.hardpoint.y - w.suspLength;
      rig.steer.rotation.y = -w.steer;
      rig.spin.rotation.x = -w.spin;
    }
    // blob stays on the ground plane under the car
    this.shadowBlob.position.set(0, 0.02 - pos.y + 0.0, 0);
    const braking = v.braking || (v.reversing && v.speed < -0.5);
    this.mats.brake.emissiveIntensity = braking ? 6 : night ? 0.6 : 0.05;
    this.mats.tail.emissiveIntensity = braking ? 2.2 : night ? 1.4 : 0.35;
    this.mats.head.emissiveIntensity = night ? 6 : 0.6;
    const heat = Math.min(1, Math.max(0, (v.braking ? Math.abs(v.speed) / 60 : 0)));
    this.mats.disc.emissiveIntensity += (heat * 0.8 - this.mats.disc.emissiveIntensity) * 0.02;
  }
}

let _blob: THREE.Texture | null = null;
function aoBlobTexture() {
  if (_blob) return _blob;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  const img = g.createImageData(128, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 128; x++) {
      // rounded-rectangle distance falloff
      const dx = Math.max(0, Math.abs(x - 63.5) - 30) / 34;
      const dy = Math.max(0, Math.abs(y - 127.5) - 86) / 42;
      const d = Math.min(1, Math.hypot(dx, dy));
      const a = Math.pow(1 - d, 2.2);
      const i = (y * 128 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  _blob = new THREE.CanvasTexture(c);
  return _blob;
}
