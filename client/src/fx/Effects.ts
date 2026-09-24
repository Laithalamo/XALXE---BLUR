import * as THREE from 'three';
import type { Vehicle } from '@shared/physics/vehicle';
import type { Assets } from '../core/Assets';

/**
 * Driving effects: skid marks (ring buffer of ground quads), tyre smoke
 * (lit soft billboards) and impact sparks (additive HDR streaks for bloom).
 */
const MAX_SKID = 8000;
/** skid trail slots: 4 wheels x up to 8 cars */
const SKID_SLOTS = 32;

class SkidMarks {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private alpha: Float32Array;
  private uvs: Float32Array;
  private next = 0;
  private last: (THREE.Vector3 | null)[] = new Array(SKID_SLOTS).fill(null);
  private lastSide: THREE.Vector3[] = Array.from({ length: SKID_SLOTS }, () => new THREE.Vector3());
  private along: number[] = new Array(SKID_SLOTS).fill(0);

  constructor(scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX_SKID * 4 * 3);
    this.alpha = new Float32Array(MAX_SKID * 4);
    this.uvs = new Float32Array(MAX_SKID * 4 * 2);
    const idx = new Uint32Array(MAX_SKID * 6);
    for (let i = 0; i < MAX_SKID; i++) {
      const v = i * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -6,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: /* glsl */ `
        attribute float aAlpha; varying float vA; varying vec2 vUv;
        #include <fog_pars_vertex>
        void main() { vA = aAlpha; vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying float vA; varying vec2 vUv;
        #include <fog_pars_fragment>
        void main() {
          float tread = 0.75 + 0.25 * step(0.5, fract(vUv.x * 5.0));
          float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
          gl_FragColor = vec4(vec3(0.012), vA * 0.8 * tread * edge);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  add(wheel: number, p: THREE.Vector3, side: THREE.Vector3, width: number, intensity: number) {
    const last = this.last[wheel];
    if (!last) {
      this.last[wheel] = p.clone();
      this.lastSide[wheel].copy(side);
      return;
    }
    const d = last.distanceTo(p);
    if (d < 0.22) return;
    if (d > 3) {
      this.last[wheel] = p.clone();
      return;
    }
    const i = this.next;
    this.next = (this.next + 1) % MAX_SKID;
    const hw = width / 2;
    const ls = this.lastSide[wheel];
    const y = 0.02;
    const verts = [
      [last.x - ls.x * hw, last.y + y, last.z - ls.z * hw],
      [last.x + ls.x * hw, last.y + y, last.z + ls.z * hw],
      [p.x - side.x * hw, p.y + y, p.z - side.z * hw],
      [p.x + side.x * hw, p.y + y, p.z + side.z * hw],
    ];
    verts.forEach((v, k) => this.pos.set(v, (i * 4 + k) * 3));
    const a = Math.min(1, intensity);
    this.alpha.set([a, a, a, a], i * 4);
    this.along[wheel] += d;
    this.uvs.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
    // upload only this quad (the whole ring buffer is ~450 KB)
    const g = this.mesh.geometry;
    for (const [name, size] of [['position', 3], ['aAlpha', 1], ['uv', 2]] as const) {
      const attr = g.getAttribute(name) as THREE.BufferAttribute;
      attr.addUpdateRange(i * 4 * size, 4 * size);
      attr.needsUpdate = true;
    }
    last.copy(p);
    ls.copy(side);
  }

  lift(wheel: number) {
    this.last[wheel] = null;
  }

  clear() {
    this.alpha.fill(0);
    const a = this.mesh.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
    a.clearUpdateRanges();
    a.needsUpdate = true;
    this.last.fill(null);
  }
}

interface Particle {
  alive: boolean;
  p: THREE.Vector3;
  v: THREE.Vector3;
  age: number;
  life: number;
  size0: number;
  size1: number;
  rot: number;
  spin: number;
  frame: number;
  alpha: number;
}

class Billboards {
  readonly mesh: THREE.Mesh;
  private parts: Particle[] = [];
  private aPos: Float32Array;
  private aData: Float32Array; // size, alpha, rot, frame
  private geo: THREE.InstancedBufferGeometry;

  constructor(scene: THREE.Scene, private max: number, material: THREE.ShaderMaterial) {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    this.aPos = new Float32Array(max * 3);
    this.aData = new Float32Array(max * 4);
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.aPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aData', new THREE.InstancedBufferAttribute(this.aData, 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < max; i++) {
      this.parts.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, life: 1, size0: 1, size1: 1, rot: 0, spin: 0, frame: 0, alpha: 1 });
    }
    scene.add(this.mesh);
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, life: number, size0: number, size1: number, alpha: number) {
    const q = this.parts.find((x) => !x.alive);
    if (!q) return;
    q.alive = true;
    q.p.copy(p);
    q.v.copy(v);
    q.age = 0;
    q.life = life;
    q.size0 = size0;
    q.size1 = size1;
    q.rot = Math.random() * Math.PI * 2;
    q.spin = (Math.random() - 0.5) * 1.2;
    q.frame = Math.floor(Math.random() * 4);
    q.alpha = alpha;
  }

  update(dt: number, drag: number, gravity: number) {
    let n = 0;
    for (const q of this.parts) {
      if (!q.alive) continue;
      q.age += dt;
      if (q.age >= q.life) { q.alive = false; continue; }
      q.v.multiplyScalar(Math.exp(-drag * dt));
      q.v.y += gravity * dt;
      q.p.addScaledVector(q.v, dt);
      if (q.p.y < 0.05) { q.p.y = 0.05; q.v.y = Math.abs(q.v.y) * 0.3; }
      q.rot += q.spin * dt;
      const t = q.age / q.life;
      const size = q.size0 + (q.size1 - q.size0) * Math.sqrt(t);
      const a = q.alpha * Math.min(1, t * 8) * (1 - t) * (1 - t);
      this.aPos.set([q.p.x, q.p.y, q.p.z], n * 3);
      this.aData.set([size, a, q.rot, q.frame], n * 4);
      n++;
    }
    this.geo.instanceCount = n;
    (this.geo.getAttribute('aPos') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aData') as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    for (const q of this.parts) q.alive = false;
  }
}

const BILLBOARD_VERT = /* glsl */ `
  attribute vec3 aPos; attribute vec4 aData;
  varying vec2 vUv; varying float vA; varying float vFrame; varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    float c = cos(aData.z), s = sin(aData.z);
    vec2 q = mat2(c, -s, s, c) * position.xy * aData.x;
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 wp = aPos + right * q.x + up * q.y;
    vWorld = wp;
    vUv = uv; vA = aData.y; vFrame = aData.w;
    vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

export class Effects {
  private skids: SkidMarks;
  private smoke!: Billboards;
  private sparks!: Billboards;
  private smokeMat!: THREE.ShaderMaterial;
  private emitAcc: number[] = new Array(SKID_SLOTS).fill(0);
  private tmp = new THREE.Vector3();
  private tmpV = new THREE.Vector3();
  private right = new THREE.Vector3();
  private contact = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private assets: Assets, private maxParticles: number) {
    this.skids = new SkidMarks(scene);
  }

  async init() {
    const atlas = await this.assets.texture('textures/smoke_atlas.png', { srgb: false, repeat: false });
    this.smokeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uMap: { value: null }, uLight: { value: new THREE.Color(1.25, 1.22, 1.18) }, uShade: { value: new THREE.Color(0.55, 0.6, 0.68) } },
      ]),
      vertexShader: BILLBOARD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform vec3 uLight; uniform vec3 uShade;
        varying vec2 vUv; varying float vA; varying float vFrame; varying vec3 vWorld;
        #include <fog_pars_fragment>
        void main() {
          vec2 cell = vec2(mod(vFrame, 2.0), floor(vFrame / 2.0));
          vec4 t = texture2D(uMap, (vUv + cell) * 0.5);
          // fake lighting: top of puffs catch the sun, bottom in shade
          vec3 col = mix(uShade, uLight, clamp(vUv.y * 0.8 + t.r * 0.4, 0.0, 1.0));
          gl_FragColor = vec4(col, t.a * vA);
          #include <fog_fragment>
        }`,
    });
    this.smokeMat.uniforms.uMap.value = atlas;
    this.smoke = new Billboards(this.scene, this.maxParticles, this.smokeMat);
    this.smoke.mesh.renderOrder = 5;

    const sparkMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      fog: true,
      vertexShader: BILLBOARD_VERT,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying float vA; varying float vFrame; varying vec3 vWorld;
        #include <fog_pars_fragment>
        void main() {
          vec2 d = vUv - 0.5;
          float core = exp(-dot(d, d) * 60.0);
          gl_FragColor = vec4(vec3(9.0, 4.2, 1.2) * core * vA, 1.0);
          #include <fog_fragment>
        }`,
    });
    this.sparks = new Billboards(this.scene, 300, sparkMat);
    this.sparks.mesh.renderOrder = 6;
  }

  /**
   * Tyre effects for one car (call for every car each frame). `slot` = car index 0..7;
   * `smoke` = car is close enough to the camera for smoke to be worth drawing.
   */
  car(dt: number, slot: number, car: Vehicle, quat: THREE.Quaternion, smoke: boolean) {
    const right = this.right.set(1, 0, 0).applyQuaternion(quat);
    const lv = car.body.linvel();
    for (let i = 0; i < 4; i++) {
      const k = slot * 4 + i;
      const w = car.wheels[i];
      const slip = Math.max(0, Math.abs(w.slipLat) - 2.2) / 5 + w.slipLong / 6;
      if (w.inContact && slip > 0.12) {
        this.contact.set(w.contact.x, w.contact.y, w.contact.z);
        this.skids.add(k, this.contact, right, w.spec.width, Math.min(1, slip * 1.2));
        if (!smoke) { this.emitAcc[k] = 0; continue; }
        // smoke rate grows with slip
        this.emitAcc[k] += dt * Math.min(22, slip * 18) * (w.spec.front ? 0.35 : 1);
        while (this.emitAcc[k] > 1) {
          this.emitAcc[k] -= 1;
          const p = this.tmp.set(w.contact.x, w.contact.y + 0.2, w.contact.z);
          const v = this.tmpV.set(lv.x * 0.35 + (Math.random() - 0.5) * 1.2, 0.35 + Math.random() * 0.6, lv.z * 0.35 + (Math.random() - 0.5) * 1.2);
          this.smoke.spawn(p, v, 1.4 + Math.random() * 1.2, 0.5, 2.6 + Math.random() * 1.6, Math.min(0.3, 0.1 + slip * 0.12));
        }
      } else {
        this.skids.lift(k);
        this.emitAcc[k] = 0;
      }
    }
  }

  /** advance particles; once per frame after all car() calls */
  update(dt: number) {
    this.smoke.update(dt, 1.4, 0.25);
    this.sparks.update(dt, 0.8, -9.8);
  }

  impact(at: THREE.Vector3, vel: THREE.Vector3, strength: number) {
    const n = Math.min(40, Math.floor(strength * 4));
    for (let k = 0; k < n; k++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 10, Math.random() * 6 + 1, (Math.random() - 0.5) * 10).addScaledVector(vel, 0.4);
      this.sparks.spawn(at.clone().add(new THREE.Vector3(0, 0.5, 0)), v, 0.35 + Math.random() * 0.5, 0.07, 0.03, 1);
    }
    for (let k = 0; k < Math.min(8, n / 4); k++) {
      this.smoke.spawn(at.clone().add(new THREE.Vector3(0, 0.6, 0)), new THREE.Vector3((Math.random() - 0.5) * 3, 1, (Math.random() - 0.5) * 3), 1.5, 1, 3.5, 0.35);
    }
  }

  /** one smoke puff (wrecks, exhaust...) */
  puff(p: THREE.Vector3, v: THREE.Vector3, life: number, size0: number, size1: number, alpha: number) {
    this.smoke.spawn(p, v, life, size0, size1, alpha);
  }

  setLayer(layer: number) {
    for (const m of [this.skids.mesh, this.smoke.mesh, this.sparks.mesh]) m.layers.set(layer);
  }

  /** stop the trails of one car (respawn) */
  liftCar(slot: number) {
    for (let i = 0; i < 4; i++) this.skids.lift(slot * 4 + i);
  }

  /** new race: wipe skid marks and smoke */
  clearAll() {
    this.skids.clear();
    this.smoke.clear();
    this.sparks.clear();
  }
}
