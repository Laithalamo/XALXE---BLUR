import * as THREE from 'three';
import type { Assets } from '../core/Assets';

/**
 * Small helper to extend three.js built-in PBR materials with extra GLSL,
 * so every surface keeps full lighting, shadows, fog and IBL.
 */
export interface Patch {
  uniforms?: Record<string, THREE.IUniform>;
  vertexHead?: string;
  vertexBody?: string; // runs after <worldpos_vertex>
  fragmentHead?: string;
  replace?: [string, string][]; // [chunk include, code inserted AFTER it]
}

export const WORLD_POS_VERT = /* glsl */ `
  vec4 xWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  xWorld = instanceMatrix * xWorld;
  #endif
  xWorld = modelMatrix * xWorld;
  vWPos = xWorld.xyz;
`;

export function patch<T extends THREE.Material>(mat: T, p: Patch, key: string): T {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, p.uniforms ?? {});
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${p.vertexHead ?? ''}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${WORLD_POS_VERT}\n${p.vertexBody ?? ''}`);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\nvarying vec3 vWPos;\n${p.fragmentHead ?? ''}`,
    );
    for (const [chunk, code] of p.replace ?? []) {
      if (!shader.fragmentShader.includes(chunk)) console.warn('patch: missing chunk', chunk, key);
      shader.fragmentShader = shader.fragmentShader.replace(chunk, `${chunk}\n${code}`);
    }
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

export interface WorldMaterials {
  asphalt: THREE.MeshStandardMaterial; // track ribbon (lane wear)
  street: THREE.MeshStandardMaterial; // other streets
  concrete: THREE.MeshStandardMaterial;
  barrier: THREE.MeshStandardMaterial;
  pavers: THREE.MeshStandardMaterial;
  curb: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  fence: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  lampGlow: THREE.MeshStandardMaterial;
  noise: THREE.Texture;
}

const NOISE_HEAD = /* glsl */ `
uniform sampler2D uNoise;
float n4(vec2 p, int c) { vec4 t = texture2D(uNoise, p); return c == 0 ? t.r : c == 1 ? t.g : c == 2 ? t.b : t.a; }
`;

export async function createWorldMaterials(assets: Assets): Promise<WorldMaterials> {
  const [asph, conc, pav, noise, chain, grassTex] = await Promise.all([
    assets.pbr('asphalt'),
    assets.pbr('concrete'),
    assets.pbr('pavers'),
    assets.texture('textures/noise_rgba.png'),
    assets.texture('textures/chainlink.png', { srgb: true }),
    assets.texture('textures/grass_albedo.jpg', { srgb: true }),
  ]);
  const uNoise = { value: noise };

  // --- asphalt (track ribbon): world-space detail + lane wheel tracks, oil, edge grime
  const asphalt = new THREE.MeshStandardMaterial({
    color: new THREE.Color(1.75, 1.75, 1.75),
    map: asph.map, normalMap: asph.normal, roughnessMap: asph.orm, aoMap: asph.orm, aoMapIntensity: 0.6,
    normalScale: new THREE.Vector2(0.9, 0.9), roughness: 1, metalness: 0,
  });
  patch(asphalt, {
    uniforms: { uNoise, uHalfW: { value: 8 } },
    vertexHead: 'attribute vec2 aRoad; varying vec2 vRoad;',
    vertexBody: 'vRoad = aRoad;',
    fragmentHead: NOISE_HEAD + 'uniform float uHalfW; varying vec2 vRoad; float gWear; float gOil;',
    replace: [
      ['#include <map_fragment>', /* glsl */ `
        vec2 wp = vWPos.xz;
        float macro = 0.78 + 0.42 * n4(wp / 131.0, 0) + 0.2 * (n4(wp / 29.0, 1) - 0.5);
        float lp = mod(vRoad.x + uHalfW, 4.0);
        gWear = exp(-pow((lp - 1.05) / 0.38, 2.0)) + exp(-pow((lp - 2.95) / 0.38, 2.0));
        gOil = exp(-pow((lp - 2.0) / 0.32, 2.0)) * smoothstep(0.35, 0.75, n4(wp / 5.3, 2)) ;
        float patchN = n4(floor(wp / vec2(7.0, 4.0)) / 97.0 + 0.21, 3);
        float repair = step(0.8, patchN) * step(0.5, n4(wp / 61.0, 1));
        float edge = smoothstep(uHalfW - 1.4, uHalfW - 0.15, abs(vRoad.x));
        diffuseColor.rgb *= macro * (1.0 - 0.22 * gWear - 0.35 * gOil) * (1.0 - 0.32 * repair);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.35 + vec3(0.012, 0.011, 0.009), edge * 0.7);
      `],
      ['#include <roughnessmap_fragment>', 'roughnessFactor *= 1.0 - 0.14 * gWear - 0.3 * gOil;'],
    ],
  }, 'asphalt-track');

  // --- plain streets (no lanes, but same detail)
  const street = new THREE.MeshStandardMaterial({
    color: new THREE.Color(1.75, 1.75, 1.75),
    map: asph.map, normalMap: asph.normal, roughnessMap: asph.orm, aoMap: asph.orm, aoMapIntensity: 0.6,
    normalScale: new THREE.Vector2(0.9, 0.9), roughness: 1, metalness: 0,
  });
  patch(street, {
    uniforms: { uNoise },
    fragmentHead: NOISE_HEAD,
    replace: [['#include <map_fragment>', /* glsl */ `
      vec2 wp = vWPos.xz;
      diffuseColor.rgb *= 0.9 + 0.3 * n4(wp / 131.0, 0) + 0.12 * (n4(wp / 29.0, 1) - 0.5);
    `]],
  }, 'asphalt-street');

  const concrete = new THREE.MeshStandardMaterial({
    map: conc.map, normalMap: conc.normal, roughnessMap: conc.orm, aoMap: conc.orm, roughness: 1, metalness: 0,
  });

  // jersey barriers: concrete + precast joints every 4 m + tyre scuffs near the bottom
  const barrier = new THREE.MeshStandardMaterial({
    map: conc.map, normalMap: conc.normal, roughnessMap: conc.orm, roughness: 1, metalness: 0,
  });
  patch(barrier, {
    uniforms: { uNoise },
    vertexHead: 'attribute vec2 aBar; varying vec2 vBar;',
    vertexBody: 'vBar = aBar;',
    fragmentHead: NOISE_HEAD + 'varying vec2 vBar;',
    replace: [['#include <map_fragment>', /* glsl */ `
      float seam = smoothstep(0.03, 0.0, abs(fract(vBar.x / 4.0 + 0.5) - 0.5) * 4.0);
      float scuff = smoothstep(0.45, 0.05, vBar.y) * smoothstep(0.4, 0.8, n4(vWPos.xz / 9.0, 2)) * vBar.y * 2.0;
      float grime = smoothstep(0.35, 0.0, vBar.y) * 0.35;
      diffuseColor.rgb *= (1.0 - 0.55 * seam) * (1.0 - 0.6 * scuff) * (1.0 - grime) * (0.92 + 0.16 * n4(vWPos.xz / 23.0, 0));
    `]],
  }, 'barrier');

  const pavers = new THREE.MeshStandardMaterial({
    map: pav.map, normalMap: pav.normal, roughnessMap: pav.orm, aoMap: pav.orm, roughness: 1, metalness: 0,
  });
  patch(pavers, {
    uniforms: { uNoise },
    fragmentHead: NOISE_HEAD,
    replace: [['#include <map_fragment>', 'diffuseColor.rgb *= 0.88 + 0.24 * n4(vWPos.xz / 47.0, 0);']],
  }, 'pavers');

  const curb = new THREE.MeshStandardMaterial({ map: conc.map, normalMap: conc.normal, color: 0xc9c6bf, roughness: 0.8 });

  const grass = new THREE.MeshStandardMaterial({ map: grassTex, color: 0xffffff, roughness: 0.95, metalness: 0 });
  patch(grass, {
    uniforms: { uNoise },
    fragmentHead: NOISE_HEAD,
    replace: [['#include <map_fragment>', /* glsl */ `
      float gn = n4(vWPos.xz / 37.0, 0);
      diffuseColor.rgb *= mix(vec3(0.85, 0.8, 0.6), vec3(1.05, 1.08, 0.95), gn) * (0.85 + 0.3 * n4(vWPos.xz / 7.0, 1));
    `]],
  }, 'grass');

  // road paint: vertex colours, worn by noise, picks up the asphalt bumps
  const paint = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.62, metalness: 0, normalMap: asph.normal, normalScale: new THREE.Vector2(0.6, 0.6),
    transparent: false, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  patch(paint, {
    uniforms: { uNoise },
    fragmentHead: NOISE_HEAD,
    replace: [['#include <map_fragment>', /* glsl */ `
      float wear = n4(vWPos.xz / 3.1, 2) * 0.6 + n4(vWPos.xz / 0.9, 1) * 0.4;
      diffuseColor.a = step(0.26, wear + 0.1);
      diffuseColor.rgb *= 0.82 + 0.25 * wear;
    `]],
  }, 'paint');

  const fence = new THREE.MeshStandardMaterial({
    map: chain, alphaTest: 0.45, side: THREE.DoubleSide, metalness: 0.7, roughness: 0.45, color: 0xb8bcc2,
  });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a8d91, metalness: 0.85, roughness: 0.38 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x24272b, metalness: 0.6, roughness: 0.5 });
  const roof = new THREE.MeshStandardMaterial({
    map: conc.map, normalMap: conc.normal, color: 0x5e5c58, roughness: 0.95, metalness: 0,
  });
  const lampGlow = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 0.4, roughness: 0.3 });

  return { asphalt, street, concrete, barrier, pavers, curb, grass, paint, fence, metal, darkMetal, roof, lampGlow, noise };
}
