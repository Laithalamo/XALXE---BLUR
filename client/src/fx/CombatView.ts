import * as THREE from 'three';
import { POWERS, POWER_KINDS, type Combat, type CombatEvent, type PowerKind } from '@shared/race/powerups';
import { powerAtlas } from '../ui/powerIcons';
import type { Effects } from './Effects';

/**
 * Visuals for the combat layer: pickup badges, projectiles, mines, shields,
 * nitro flames, explosions and lightning. Almost everything is drawn by two
 * instanced billboard batches (icons, additive glows), so it costs ~4 draw calls.
 */
const hdr = (hex: string, k: number) => {
  const c = new THREE.Color(hex);
  return new THREE.Color(c.r * k, c.g * k, c.b * k);
};
const KIND_COL: Record<PowerKind, THREE.Color> = Object.fromEntries(POWER_KINDS.map((k) => [k, hdr(POWERS[k].color, 1)])) as Record<PowerKind, THREE.Color>;

const GLOW_VERT = /* glsl */ `
  attribute vec3 aPos; attribute vec4 aAxis; attribute vec4 aCol;
  varying vec2 vUv; varying vec3 vCol; varying float vStreak;
  #include <fog_pars_vertex>
  void main() {
    vec3 wp;
    float al = dot(aAxis.xyz, aAxis.xyz);
    if (al > 1e-6) {
      // streak between aPos - axis and aPos + axis, aAxis.w wide, facing the camera
      vec3 view = normalize(aPos - cameraPosition);
      vec3 side = normalize(cross(aAxis.xyz, view)) * aAxis.w;
      wp = aPos + aAxis.xyz * (position.x * 2.0) + side * position.y;
      vStreak = 1.0;
    } else {
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      wp = aPos + (right * position.x + up * position.y) * aCol.w;
      vStreak = 0.0;
    }
    vUv = uv; vCol = aCol.rgb;
    vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const GLOW_FRAG = /* glsl */ `
  varying vec2 vUv; varying vec3 vCol; varying float vStreak;
  #include <fog_pars_fragment>
  void main() {
    vec2 d = vUv - 0.5;
    float a;
    if (vStreak > 0.5) a = exp(-d.y * d.y * 36.0) * smoothstep(0.5, 0.3, abs(d.x));
    else a = exp(-dot(d, d) * 22.0);
    gl_FragColor = vec4(vCol * a, 1.0);
    // additive: fog fades the glow out instead of tinting it
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      gl_FragColor.rgb *= 1.0 - fogFactor;
    #endif
  }`;

/** additive glow dots and streaks, rebuilt every frame */
class Glows {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private pos: Float32Array;
  private axis: Float32Array;
  private col: Float32Array;
  private n = 0;

  constructor(private max: number) {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    this.pos = new Float32Array(max * 3);
    this.axis = new Float32Array(max * 4);
    this.col = new Float32Array(max * 4);
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAxis', new THREE.InstancedBufferAttribute(this.axis, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
  }

  begin() {
    this.n = 0;
  }

  dot(x: number, y: number, z: number, size: number, c: THREE.Color, k = 1) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos.set([x, y, z], i * 3);
    this.axis.set([0, 0, 0, 0], i * 4);
    this.col.set([c.r * k, c.g * k, c.b * k, size], i * 4);
  }

  streak(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, c: THREE.Color, k = 1) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos.set([(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2], i * 3);
    this.axis.set([(bx - ax) / 2, (by - ay) / 2, (bz - az) / 2, width], i * 4);
    this.col.set([c.r * k, c.g * k, c.b * k, 0], i * 4);
  }

  end() {
    this.geo.instanceCount = this.n;
    for (const name of ['aPos', 'aAxis', 'aCol']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** pickup badges (icon atlas billboards) */
class Badges {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private pos: Float32Array;
  private data: Float32Array;
  private n = 0;

  constructor(private max: number, atlas: THREE.Texture) {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    this.pos = new Float32Array(max * 3);
    this.data = new Float32Array(max * 3);
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aData', new THREE.InstancedBufferAttribute(this.data, 3).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null } }]),
      vertexShader: /* glsl */ `
        attribute vec3 aPos; attribute vec3 aData;
        varying vec2 vUv; varying float vIcon; varying float vA;
        #include <fog_pars_vertex>
        void main() {
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 wp = aPos + (right * position.x + up * position.y) * aData.x;
          vUv = uv; vIcon = aData.y; vA = aData.z;
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv; varying float vIcon; varying float vA;
        #include <fog_pars_fragment>
        void main() {
          vec4 t = texture2D(uMap, vec2((vIcon + vUv.x) / 8.0, vUv.y));
          if (t.a < 0.02) discard;
          // bright enough to bloom a little
          gl_FragColor = vec4(t.rgb * 2.2, t.a * vA);
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    mat.uniforms.uMap.value = atlas;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  begin() {
    this.n = 0;
  }

  add(x: number, y: number, z: number, size: number, icon: number, alpha: number) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos.set([x, y, z], i * 3);
    this.data.set([size, icon, alpha], i * 3);
  }

  end() {
    this.geo.instanceCount = this.n;
    (this.geo.getAttribute('aPos') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aData') as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface Flash {
  x: number;
  y: number;
  z: number;
  age: number;
  life: number;
  size: number;
  col: THREE.Color;
}

interface Bolt {
  pts: THREE.Vector3[];
  age: number;
  life: number;
}

export interface CarVisual {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

const WHITE = new THREE.Color(1, 1, 1);
const FIRE = new THREE.Color(4.0, 1.5, 0.35);
const NITRO = new THREE.Color(0.9, 1.6, 5.0);
const PULSE = hdr(POWERS.pulse.color, 5);
const ARC = hdr(POWERS.arc.color, 6);
const TRAP = hdr(POWERS.trap.color, 5);
const STORM = hdr(POWERS.storm.color, 4);
const SHIELD = new THREE.Color(POWERS.barrier.color);

export class CombatView {
  private glows = new Glows(700);
  private badges: Badges;
  private shields: THREE.Mesh[] = [];
  private shieldMat: THREE.ShaderMaterial;
  private flashes: Flash[] = [];
  private bolts: Bolt[] = [];
  private trails = new Map<number, THREE.Vector3[]>();
  private warnUntil = new Map<number, number>();
  private time = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(scene: THREE.Scene, private fx: Effects, cars: number) {
    const tex = new THREE.CanvasTexture(powerAtlas());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.badges = new Badges(64, tex);
    scene.add(this.glows.mesh, this.badges.mesh);
    this.shieldMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: SHIELD }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mv.xyz);
          vP = position;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uTime;
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
          float bands = 0.5 + 0.5 * sin(vP.y * 9.0 - uTime * 6.0);
          gl_FragColor = vec4(uColor * (0.012 + f * (0.9 + bands * 0.5)), 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sphere = new THREE.SphereGeometry(1, 32, 16);
    for (let i = 0; i < cars; i++) {
      const m = new THREE.Mesh(sphere, this.shieldMat);
      m.scale.set(1.55, 1.05, 2.9);
      m.visible = false;
      m.renderOrder = 8;
      scene.add(m);
      this.shields.push(m);
    }
  }

  setLayer(layer: number) {
    this.glows.mesh.layers.set(layer);
    this.badges.mesh.layers.set(layer);
  }

  /** one-off visuals for combat events */
  onEvent(e: CombatEvent, cars: CarVisual[]) {
    switch (e.t) {
      case 'hit': {
        const col = e.kind === 'pulse' ? PULSE : e.kind === 'arc' ? ARC : e.kind === 'trap' ? TRAP : e.kind === 'storm' ? STORM : FIRE;
        if (e.kind === 'crash') break;
        this.flash(e.x, e.y, e.z, e.kind === 'arc' ? 3.5 : 7, 0.35, col);
        this.fx.impact(this.tmp.set(e.x, e.y - 0.5, e.z), this.tmp2.set(0, 2, 0), e.kind === 'arc' ? 5 : 12);
        break;
      }
      case 'block':
        this.flash(e.x, e.y, e.z, 5, 0.3, hdr(POWERS.barrier.color, 5));
        break;
      case 'boom':
        this.flash(e.x, e.y, e.z, e.kind === 'arc' ? 2.5 : 5, 0.3, e.kind === 'pulse' ? PULSE : e.kind === 'arc' ? ARC : TRAP);
        if (e.kind !== 'arc') this.fx.impact(this.tmp.set(e.x, e.y - 0.5, e.z), this.tmp2.set(0, 1, 0), 6);
        break;
      case 'pickup': {
        const c = cars[e.car];
        this.flash(c.pos.x, c.pos.y + 1.2, c.pos.z, 4, 0.35, hdr(POWERS[e.kind].color, 4));
        break;
      }
      case 'warn':
        this.warnUntil.set(e.car, this.time + 0.9);
        break;
      case 'strike':
        this.lightning(e.x, e.y, e.z);
        break;
      case 'wreck': {
        const c = cars[e.car];
        this.flash(c.pos.x, c.pos.y + 0.8, c.pos.z, 12, 0.6, FIRE);
        this.fx.impact(c.pos, this.tmp2.set(0, 4, 0), 30);
        break;
      }
      default:
        break;
    }
  }

  private flash(x: number, y: number, z: number, size: number, life: number, col: THREE.Color) {
    this.flashes.push({ x, y, z, age: 0, life, size, col });
  }

  private lightning(x: number, y: number, z: number) {
    const pts: THREE.Vector3[] = [];
    const top = 70;
    let px = x + (Math.random() - 0.5) * 16, pz = z + (Math.random() - 0.5) * 16;
    const n = 14;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const jitter = (1 - t) * 4.5 + 0.4;
      pts.push(new THREE.Vector3(px + (x - px) * t + (Math.random() - 0.5) * jitter, top + (y + 0.6 - top) * t, pz + (z - pz) * t + (Math.random() - 0.5) * jitter));
    }
    this.bolts.push({ pts, age: 0, life: 0.45 });
    // a side branch
    const b0 = pts[5];
    const branch = [b0.clone()];
    for (let k = 1; k <= 5; k++) branch.push(b0.clone().add(new THREE.Vector3((Math.random() - 0.3) * 4 * k, -4 * k, (Math.random() - 0.5) * 4 * k)));
    this.bolts.push({ pts: branch, age: 0, life: 0.3 });
    this.flash(x, y + 1, z, 8, 0.4, STORM);
  }

  update(dt: number, combat: Combat, cars: CarVisual[], wreckedSmoke: (i: number) => void) {
    this.time += dt;
    const t = this.time;
    const g = this.glows;
    g.begin();
    this.badges.begin();
    this.shieldMat.uniforms.uTime.value = t;

    // pickups: floating badge + light beam
    for (const p of combat.pickups) {
      if (p.cooldown > 0) continue;
      const bob = Math.sin(t * 2.2 + p.id) * 0.12;
      const icon = POWER_KINDS.indexOf(p.kind);
      this.badges.add(p.x, 1.35 + bob, p.z, 1.7, icon, 1);
      const col = KIND_COL[p.kind];
      g.streak(p.x, 0.05, p.z, p.x, 3.4, p.z, 1.1, col, 0.55);
      g.dot(p.x, 0.25, p.z, 2.4, col, 0.6);
    }

    // projectiles
    const live = new Set<number>();
    for (const s of combat.shots) {
      live.add(s.id);
      let trail = this.trails.get(s.id);
      if (!trail) {
        trail = [];
        this.trails.set(s.id, trail);
      }
      trail.unshift(new THREE.Vector3(s.x, s.y, s.z));
      if (trail.length > 12) trail.pop();
      if (s.kind === 'pulse') {
        g.dot(s.x, s.y, s.z, 1.8 + Math.sin(t * 30) * 0.2, PULSE, 1);
        g.dot(s.x, s.y, s.z, 0.6, WHITE, 3);
        for (let k = 1; k < trail.length; k++) {
          const a = trail[k - 1], b = trail[k];
          g.streak(a.x, a.y, a.z, b.x, b.y, b.z, 0.9 * (1 - k / trail.length), PULSE, 0.5 * (1 - k / trail.length));
        }
      } else {
        g.streak(s.x - s.dx * 5, s.y, s.z - s.dz * 5, s.x, s.y, s.z, 0.35, ARC, 1.2);
        g.dot(s.x, s.y, s.z, 0.9, ARC, 0.8);
      }
    }
    for (const id of this.trails.keys()) if (!live.has(id)) this.trails.delete(id);

    // mines: blinking core
    for (const m of combat.mines) {
      const armed = m.arm <= 0;
      const blink = armed ? (Math.sin(t * 10 + m.id) > 0 ? 1 : 0.35) : 0.5;
      g.dot(m.x, m.y + 0.15, m.z, 1.3, TRAP, blink);
      g.dot(m.x, m.y + 0.15, m.z, 0.35, WHITE, 2 * blink);
    }

    // storm warnings above the targets
    for (const [car, until] of this.warnUntil) {
      if (t > until) {
        this.warnUntil.delete(car);
        continue;
      }
      const c = cars[car];
      g.dot(c.pos.x, c.pos.y + 3.2, c.pos.z, 2.2 + Math.sin(t * 25) * 0.4, STORM, 0.8);
    }

    // per car: shield, nitro flames, wreck fire
    cars.forEach((c, i) => {
      const cc = combat.cars[i];
      const sh = this.shields[i];
      sh.visible = cc.shield > 0 && (cc.shield > 1.2 || Math.sin(t * 30) > 0);
      if (sh.visible) {
        sh.position.copy(c.pos).add(this.tmp.set(0, 0.55, 0));
        sh.quaternion.copy(c.quat);
      }
      if (cc.surge > 0) {
        for (const x of [-0.32, 0.32]) {
          const a = this.tmp.set(x, 0.42, 2.25).applyQuaternion(c.quat).add(c.pos);
          const len = 1.4 + Math.random() * 1.1;
          const b = this.tmp2.set(x, 0.42, 2.25 + len).applyQuaternion(c.quat).add(c.pos);
          g.streak(a.x, a.y, a.z, b.x, b.y, b.z, 0.45, NITRO, 1);
          g.dot(a.x, a.y, a.z, 0.7, WHITE, 1.5);
        }
      }
      if (cc.wreck > 0) {
        const f = 0.7 + Math.random() * 0.6;
        g.dot(c.pos.x + (Math.random() - 0.5) * 0.8, c.pos.y + 0.9 + Math.random() * 0.6, c.pos.z + (Math.random() - 0.5) * 1.6, 1.8 * f, FIRE, 0.9);
        wreckedSmoke(i);
      }
    });

    // flashes and lightning
    for (let k = this.flashes.length - 1; k >= 0; k--) {
      const f = this.flashes[k];
      f.age += dt;
      if (f.age >= f.life) {
        this.flashes.splice(k, 1);
        continue;
      }
      const u = f.age / f.life;
      g.dot(f.x, f.y, f.z, f.size * (0.6 + u * 0.8), f.col, (1 - u) * (1 - u) * 1.6);
    }
    for (let k = this.bolts.length - 1; k >= 0; k--) {
      const b = this.bolts[k];
      b.age += dt;
      if (b.age >= b.life) {
        this.bolts.splice(k, 1);
        continue;
      }
      const flicker = Math.random() > 0.25 ? 1 : 0.3;
      const fade = (1 - b.age / b.life) * flicker;
      for (let j = 1; j < b.pts.length; j++) {
        const a = b.pts[j - 1], c = b.pts[j];
        g.streak(a.x, a.y, a.z, c.x, c.y, c.z, 0.8, STORM, 0.35 * fade);
        g.streak(a.x, a.y, a.z, c.x, c.y, c.z, 0.18, WHITE, 2.2 * fade);
      }
    }
    g.end();
    this.badges.end();
  }

  clear() {
    this.flashes.length = 0;
    this.bolts.length = 0;
    this.trails.clear();
    this.warnUntil.clear();
  }
}
