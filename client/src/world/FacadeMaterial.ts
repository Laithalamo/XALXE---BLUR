import * as THREE from 'three';
import type { Assets } from '../core/Assets';
import { patch } from './materials';

/**
 * Building facade shader (extends MeshStandardMaterial, so it keeps real
 * lighting, shadows, fog and HDRI reflections).
 *
 * Per-vertex data:
 *   uv       = (metres along the wall, metres above ground)
 *   aStyle   = (style id, floor height, bay width, seed)
 *   aWall    = (wall length, building height, ground floor height, lit ratio)
 *   aTint    = wall colour (linear)
 *
 * Windows use "interior mapping": each window gets a fake 3D room behind the
 * glass (floor, ceiling light, walls, furniture) computed per pixel.
 *
 * Styles: 0 glass curtain wall, 1 stone office (ribbon windows),
 *         2 brick (punched windows), 3 painted plaster (punched windows)
 */
const HEAD = /* glsl */ `
uniform sampler2D uNoise;
uniform sampler2D uBrick;
uniform sampler2D uBrickN;
uniform sampler2D uPlaster;
uniform sampler2D uPlasterN;
uniform sampler2D uConc;
uniform sampler2D uConcN;
uniform float uNight;
uniform sampler2D uSigns;
varying vec2 vFac;
flat varying vec4 vStyle;
flat varying vec4 vWall;
flat varying vec3 vTint;
varying vec3 vWNormal;

float fGlass;      // 1 = glass pixel
float fFrame;      // 1 = window frame / mullion
float fRecess;     // shadowing inside the window reveal
vec3 fInterior;    // interior-mapped room colour (emissive-ish)
vec3 fWallN;       // tangent-space normal of the wall material
float fWallRough;
float fStyle;
float fSign;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// anti-aliased box mask
float boxMask(vec2 p, vec2 lo, vec2 hi, vec2 fw) {
  vec2 a = smoothstep(lo - fw, lo + fw, p);
  vec2 b = 1.0 - smoothstep(hi - fw, hi + fw, p);
  return a.x * a.y * b.x * b.y;
}

vec3 roomColor(vec2 cellPos, vec2 cellSize, vec2 cellId, float seed, vec3 Tw, vec3 Nw) {
  vec3 V = normalize(vWPos - cameraPosition);
  vec3 rd = vec3(dot(V, Tw), V.y, -dot(V, Nw));
  rd.z = max(rd.z, 0.02);
  float depth = 5.5 + 3.0 * hash12(cellId + seed);
  vec3 size = vec3(cellSize, depth);
  vec3 ro = vec3(cellPos, 0.0);
  vec3 tv = (step(vec3(0.0), rd) * size - ro) / rd;
  float t = min(tv.x, min(tv.y, tv.z));
  vec3 hp = ro + rd * t;
  float r = hash12(cellId * 1.37 + seed * 3.1);
  float r2 = hash12(cellId * 2.11 + seed * 7.7);
  vec3 wallC = mix(vec3(0.38, 0.35, 0.31), vec3(0.7, 0.68, 0.64), r);
  if (r2 > 0.82) wallC = vec3(0.32, 0.4, 0.48);
  if (r2 < 0.12) wallC = vec3(0.55, 0.42, 0.3);
  vec3 col;
  if (t == tv.z) {
    col = wallC * 0.85;
    // furniture / shelves silhouettes on the back wall
    float fx = fract(hp.x / 1.7 + r * 3.0);
    if (hp.y < 0.95 && fx < 0.6 && r2 > 0.3) col = vec3(0.12, 0.1, 0.09);
    if (hp.y > 1.3 && hp.y < 2.0 && fract(hp.x / 2.3 + r2) < 0.35) col = mix(col, vec3(0.3, 0.35, 0.4), 0.6);
  } else if (t == tv.x) {
    col = wallC * 0.7;
  } else if (rd.y < 0.0) {
    col = mix(vec3(0.16, 0.12, 0.09), vec3(0.3, 0.3, 0.32), r2) * (0.8 + 0.4 * fract(hp.z * 0.7));
  } else {
    col = vec3(0.82);
    // ceiling light panels
    vec2 lp = vec2(fract(hp.x / 2.4) - 0.5, fract(hp.z / 3.0) - 0.5);
    float litC = step(r, vWall.w);
    if (abs(lp.x) < 0.22 && abs(lp.y) < 0.28) col = mix(vec3(0.9), vec3(4.0), litC);
  }
  col *= exp(-t * 0.09);
  float lit = step(r, vWall.w);
  float dayLevel = 0.1 + 0.1 * lit;
  float nightLevel = lit * (0.9 + 0.8 * r2);
  if (cellId.y < -0.5) {
    // ground-floor shops: always lit, warm, with colourful merchandise
    vec3 goods = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + r2 * 3.0 + floor(hp.x / 0.8) * 0.13));
    if (t == tv.z && hp.y > 0.4 && hp.y < 2.2) col = mix(col, goods * 0.6, 0.55 * step(0.35, fract(hp.x / 0.8)));
    return col * vec3(1.0, 0.92, 0.8) * mix(0.55, 1.6, uNight);
  }
  return col * mix(dayLevel, nightLevel, uNight);
}
`;

const MAP = /* glsl */ `
  fGlass = 0.0; fFrame = 0.0; fRecess = 0.0; fInterior = vec3(0.0); fWallRough = 0.85; fSign = 0.0;
  vec3 Nw = normalize(vWNormal);
  vec3 Tw = normalize(vec3(Nw.z, 0.0, -Nw.x));
  float style = floor(vStyle.x + 0.5);
  fStyle = style;
  float floorH = vStyle.y;
  float seed = floor(vStyle.w + 0.5);
  float wallLen = vWall.x;
  float height = vWall.y;
  float groundH = vWall.z;
  vec2 f = vFac;
  bool isWall = Nw.y < 0.5;
  vec2 fw = max(fwidth(f), vec2(0.0005)) * 0.75;
  vec2 dfx = dFdx(f), dfy = dFdy(f); // taken in uniform control flow for textureGrad below

  // wall material
  vec3 wallAlb;
  vec3 wn = vec3(0.0, 0.0, 1.0);
  if (style < 0.5) {
    vec4 c = texture2D(uConc, f / 3.0);
    wallAlb = c.rgb * vec3(0.75, 0.76, 0.78);
    wn = texture2D(uConcN, f / 3.0).xyz * 2.0 - 1.0;
    fWallRough = 0.55;
  } else if (style < 1.5) {
    wallAlb = texture2D(uConc, f / 2.5).rgb * vTint * 1.35;
    wn = texture2D(uConcN, f / 2.5).xyz * 2.0 - 1.0;
    fWallRough = 0.8;
  } else if (style < 2.5) {
    wallAlb = texture2D(uBrick, f / 1.6).rgb * vTint;
    wn = texture2D(uBrickN, f / 1.6).xyz * 2.0 - 1.0;
    fWallRough = 0.9;
  } else {
    wallAlb = texture2D(uPlaster, f / 3.0).rgb * vTint * 1.25;
    wn = texture2D(uPlasterN, f / 3.0).xyz * 2.0 - 1.0;
    fWallRough = 0.88;
  }
  // weathering: rain streaks, grime near the ground
  float streak = texture2D(uNoise, vec2(f.x / 7.0 + seed, f.y / 90.0)).r;
  wallAlb *= 1.0 - 0.18 * smoothstep(0.55, 0.85, streak);
  wallAlb *= 1.0 - 0.25 * smoothstep(1.6, 0.0, f.y);
  wallAlb *= 0.9 + 0.2 * texture2D(uNoise, vWPos.xz / 53.0 + f / 41.0).g;
  fWallN = wn;
  vec3 albedo = wallAlb;

  if (isWall) {
    bool ground = f.y < groundH;
    float bayTarget = ground ? max(vStyle.z * 1.6, 4.2) : vStyle.z;
    float nBays = max(1.0, floor(wallLen / bayTarget + 0.5));
    float bay = wallLen / nBays;
    float fl = ground ? groundH : floorH;
    float yBase = ground ? 0.0 : groundH;
    float floorIdx = ground ? -1.0 : floor((f.y - groundH) / floorH);
    float cy = ground ? f.y : mod(f.y - groundH, floorH);
    float bx = floor(f.x / bay);
    float cx = f.x - bx * bay;
    vec2 cell = vec2(cx, cy);
    vec2 lo, hi;
    if (ground) {
      lo = vec2(0.35, 0.45); hi = vec2(bay - 0.35, groundH - 1.15);
    } else if (style < 0.5) {
      lo = vec2(0.035, 0.75); hi = vec2(bay - 0.035, floorH - 0.04);
    } else if (style < 1.5) {
      lo = vec2(0.12, 0.95); hi = vec2(bay - 0.12, floorH - 0.5);
    } else {
      float ww = min(1.45, bay * 0.45);
      lo = vec2(bay * 0.5 - ww * 0.5, 0.9); hi = vec2(bay * 0.5 + ww * 0.5, min(floorH - 0.55, 2.75));
    }
    bool top = f.y > height - 1.3;
    bool edge = f.x < 0.3 || f.x > wallLen - 0.3;
    float inWin = boxMask(cell, lo, hi, fw);
    float frameW = style < 0.5 && !ground ? 0.035 : 0.07;
    float inGlass = boxMask(cell, lo + frameW, hi - frameW, fw);
    if (top || edge) { inWin = 0.0; inGlass = 0.0; }

    // spandrel glass on curtain walls
    if (style < 0.5 && !ground && !top && !edge) {
      float sp = 1.0 - inWin;
      albedo = mix(albedo, vTint * 0.35, sp * 0.9);
      fWallRough = mix(fWallRough, 0.12, sp);
    }
    // shop sign band (fictional shop names from the sign atlas)
    fSign = 0.0;
    if (ground && !edge && cy > groundH - 1.0 && cy < groundH - 0.25) {
      float sh = floor(hash12(vec2(bx, seed * 13.0)) * 16.0);
      vec2 cellUv = vec2(clamp((cx - 0.1) / (bay - 0.2), 0.0, 1.0), (cy - (groundH - 1.0)) / 0.75);
      vec2 suv = vec2((mod(sh, 2.0) + cellUv.x) / 2.0, 1.0 - (floor(sh / 2.0) + 1.0 - cellUv.y) / 8.0);
      vec2 sScale = vec2((bay - 0.2) * 2.0, 0.75 * 8.0);
      albedo = textureGrad(uSigns, suv, dfx / sScale, dfy / sScale).rgb;
      fWallRough = 0.35;
      fSign = 1.0;
    }
    // stone sill under punched windows
    if (style > 1.5 && !ground && !top && !edge) {
      float sill = boxMask(cell, vec2(lo.x - 0.08, lo.y - 0.12), vec2(hi.x + 0.08, lo.y), fw);
      albedo = mix(albedo, vec3(0.55, 0.53, 0.5), sill);
    }

    fFrame = clamp(inWin - inGlass, 0.0, 1.0);
    fGlass = inGlass;
    // reveal shadow: top and one side of the opening
    float dTop = hi.y - cy, dSide = cx - lo.x;
    fRecess = inWin * (0.55 * smoothstep(0.35, 0.0, dTop) + 0.25 * smoothstep(0.2, 0.0, dSide));
    if (inGlass > 0.001) {
      vec2 csz = ground ? vec2(bay, groundH) : vec2(bay, floorH);
      fInterior = roomColor(vec2(cx, cy), csz, vec2(bx, floorIdx) + seed * 11.0, seed, Tw, Nw);
      // blinds on some windows
      float bl = hash12(vec2(bx * 3.1, floorIdx * 7.3) + seed);
      if (!ground && bl > 0.9) {
        float level = hi.y - (hi.y - lo.y) * (0.25 + 0.6 * fract(bl * 13.0));
        if (cy > level) {
          // anti-aliased slats: fade to the average when they get smaller than a pixel
          float slatAA = clamp((fw.y - 0.004) * 90.0, 0.0, 1.0);
          float slat = mix(0.75 + 0.25 * smoothstep(0.35, 0.65, fract(cy / 0.06)), 0.87, slatAA);
          fInterior = vec3(0.0);
          vec3 blindC = mix(vec3(0.38, 0.37, 0.35), vec3(0.55, 0.52, 0.47), fract(bl * 31.0));
          albedo = mix(albedo, blindC * slat, inGlass);
          fGlass *= 0.15;
        }
      }
    }
    vec3 frameC = style < 0.5 ? vec3(0.18, 0.2, 0.22) : style < 1.5 ? vec3(0.1, 0.1, 0.11) : vec3(0.75, 0.74, 0.7);
    albedo = mix(albedo, frameC, fFrame);
    vec3 glassC = style < 0.5 ? vTint * 0.55 : vec3(0.05, 0.065, 0.075);
    albedo = mix(albedo, glassC, fGlass);
    albedo *= 1.0 - fRecess;
  }
  diffuseColor.rgb = albedo;
`;

const ROUGH = /* glsl */ `
  roughnessFactor = mix(fWallRough, 0.35, fFrame);
  roughnessFactor = mix(roughnessFactor, 0.04, fGlass);
`;
const METAL = /* glsl */ `
  metalnessFactor = mix(fStyle < 0.5 ? 0.35 : 0.0, 0.6, fFrame);
  metalnessFactor = mix(metalnessFactor, fStyle < 0.5 ? 0.62 : 0.3, fGlass);
`;
const NORMAL = /* glsl */ `
  {
    vec3 Nw2 = normalize(vWNormal);
    if (Nw2.y < 0.5) {
      vec3 Tw2 = normalize(vec3(Nw2.z, 0.0, -Nw2.x));
      vec3 n = fWallN;
      // no bumps on glass/frames/signs; fade bumps with distance to avoid sparkle
      vec2 fwN = fwidth(vFac);
      n.xy *= (1.0 - fGlass) * (1.0 - fFrame) * (1.0 - fSign) * 0.9 * clamp(1.0 - max(fwN.x, fwN.y) * 12.0, 0.15, 1.0);
      vec3 nWorld = normalize(Tw2 * n.x + vec3(0.0, 1.0, 0.0) * n.y + Nw2 * n.z);
      normal = normalize((viewMatrix * vec4(nWorld, 0.0)).xyz);
    }
  }
`;
const EMISSIVE = /* glsl */ `
  {
    vec3 V2 = normalize(cameraPosition - vWPos);
    float ndv = clamp(dot(normalize(vWNormal), V2), 0.0, 1.0);
    float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
    float see = fStyle < 0.5 ? 0.45 : 1.0;
    totalEmissiveRadiance += fInterior * fGlass * (1.0 - fres) * see * (1.0 - fRecess * 0.5);
    totalEmissiveRadiance += diffuseColor.rgb * fSign * mix(0.15, 1.8, uNight);
  }
`;

export async function createFacadeMaterial(assets: Assets, noise: THREE.Texture, signs: THREE.Texture) {
  const [brick, plaster, conc] = await Promise.all([assets.pbr('bricks'), Promise.all([
    assets.texture('textures/plaster_albedo.jpg', { srgb: true }),
    assets.texture('textures/plaster_normal.jpg'),
  ]), assets.pbr('concrete')]);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  const uniforms = {
    uNoise: { value: noise },
    uBrick: { value: brick.map },
    uBrickN: { value: brick.normal },
    uPlaster: { value: plaster[0] },
    uPlasterN: { value: plaster[1] },
    uConc: { value: conc.map },
    uConcN: { value: conc.normal },
    uNight: { value: 0 },
    uSigns: { value: signs },
  };
  patch(mat, {
    uniforms,
    vertexHead: /* glsl */ `
      attribute vec4 aStyle; attribute vec4 aWall; attribute vec3 aTint;
      varying vec2 vFac; flat varying vec4 vStyle; flat varying vec4 vWall; flat varying vec3 vTint; varying vec3 vWNormal;`,
    vertexBody: 'vFac = uv; vStyle = aStyle; vWall = aWall; vTint = aTint; vWNormal = normalize(mat3(modelMatrix) * objectNormal);',
    fragmentHead: HEAD,
    replace: [
      ['#include <map_fragment>', MAP],
      ['#include <roughnessmap_fragment>', ROUGH],
      ['#include <metalnessmap_fragment>', METAL],
      ['#include <normal_fragment_maps>', NORMAL],
      ['#include <emissivemap_fragment>', EMISSIVE],
    ],
  }, 'facade');
  // uv attribute must be declared even without a map
  mat.defines = { ...(mat.defines ?? {}), USE_UV: '' };
  return { material: mat, uniforms };
}
