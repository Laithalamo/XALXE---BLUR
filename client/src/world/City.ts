import * as THREE from 'three';
import type { TrackDef } from '@shared/track/trackDefs';
import type { Centerline } from '@shared/track/centerline';
import { rng as makeRng, type Rng } from '@shared/math';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder } from './geom';
import type { WorldMaterials } from './materials';
import type { GraphicsPreset } from '../core/Settings';

/**
 * Procedural city around a street circuit (deterministic from the track seed).
 * Grid of blocks: streets 16 m wide, 5 m sidewalks on raised kerbs, buildings
 * with facade styles, parks, lamps, trees and traffic lights.
 */
export interface PropSpot {
  x: number;
  z: number;
  yaw: number; // for lamps: direction the arm points
  kind: 'lamp' | 'tree' | 'tlight' | 'bench' | 'bin';
  y: number;
}

export interface CityResult {
  group: THREE.Group;
  props: PropSpot[];
  /** distance from a point to the track centre line (coarse) */
  trackDist: (x: number, z: number) => number;
}

const STREET_HALF = 8;
const SIDEWALK = 5;
const KERB_H = 0.15;

type Style = 0 | 1 | 2 | 3;
const STYLE_INFO: Record<Style, { floorH: number; bay: number }> = {
  0: { floorH: 3.9, bay: 1.55 },
  1: { floorH: 3.7, bay: 3.0 },
  2: { floorH: 3.35, bay: 3.3 },
  3: { floorH: 3.2, bay: 3.5 },
};
const PLASTER = [0xf0e0bd, 0xd9a07e, 0xcfcdc6, 0xefd9a0, 0xe8b9a5, 0xbac7b3, 0xe6e1d3, 0xc4b59c];
const STONE = [0xd8d0c0, 0xa6a39d, 0xe0d8c6, 0xb9ad98, 0x8f9296];
const GLASS_TINT = [0x7fa3b8, 0x6f93a0, 0x8aa5a0, 0xa3a39a, 0x9fb3c7, 0x5f7f99, 0xb0a48e];

function srgbToLinear(hex: number) {
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

export function buildCity(def: TrackDef, cl: Centerline, mats: WorldMaterials, facade: THREE.Material, preset: GraphicsPreset): CityResult {
  const G = def.grid;
  const group = new THREE.Group();
  group.name = 'city';
  const props: PropSpot[] = [];

  // coarse spatial hash of the centre line for distance queries
  const pts = cl.samples.filter((_, i) => i % 4 === 0);
  const trackDist = (x: number, z: number) => {
    let best = Infinity;
    for (const p of pts) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };

  const ring = 3; // extra blocks around the listed city for the skyline
  const bx0 = def.city.minX - ring, bx1 = def.city.maxX + ring;
  const by0 = def.city.minY - ring, by1 = def.city.maxY + ring;
  const isPark = (i: number, j: number) => def.parks.some(([a, b]) => a === i && b === j);
  const downtown = new THREE.Vector2(((def.city.minX + def.city.maxX + 1) / 2) * G, ((def.city.minY + def.city.maxY + 1) / 2) * G);

  // ------------------------------------------------------------------ streets
  const streets = new GeoBuilder();
  const up = new THREE.Vector3(0, 1, 0);
  const flatQuad = (b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, uvs = 3) => {
    const a = b.vertex(new THREE.Vector3(x0, y, z1), up, x0 / uvs, z1 / uvs);
    const c = b.vertex(new THREE.Vector3(x1, y, z1), up, x1 / uvs, z1 / uvs);
    const d = b.vertex(new THREE.Vector3(x1, y, z0), up, x1 / uvs, z0 / uvs);
    const e = b.vertex(new THREE.Vector3(x0, y, z0), up, x0 / uvs, z0 / uvs);
    b.quad(a, c, d, e);
  };
  for (let i = bx0; i <= bx1 + 1; i++) {
    for (let j = by0; j <= by1 + 1; j++) {
      const x = i * G, z = j * G;
      flatQuad(streets, x - STREET_HALF, z - STREET_HALF, x + STREET_HALF, z + STREET_HALF, 0);
      if (j <= by1) flatQuad(streets, x - STREET_HALF, z + STREET_HALF, x + STREET_HALF, z + G - STREET_HALF, 0);
      if (i <= bx1) flatQuad(streets, x + STREET_HALF, z - STREET_HALF, x + G - STREET_HALF, z + STREET_HALF, 0);
    }
  }
  const streetMesh = new THREE.Mesh(streets.build(), mats.street);
  streetMesh.receiveShadow = true;
  group.add(streetMesh);

  // big ground plane under everything (beyond the city edge)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), mats.street);
  ground.position.set(downtown.x, -0.03, downtown.y);
  ground.receiveShadow = true;
  group.add(ground);

  // ---------------------------------------------------------- street markings
  const paint = new GeoBuilder({}, true);
  const white = new THREE.Color(0.78, 0.78, 0.76);
  const yellow = new THREE.Color(0.75, 0.52, 0.06);
  const stripe = (b: GeoBuilder, cx: number, cz: number, dx: number, dz: number, len: number, w: number, col: THREE.Color) => {
    // centred rectangle along direction (dx,dz)
    const nx = -dz, nz = dx;
    const hl = len / 2, hw = w / 2;
    const y = 0.004;
    const p = (a: number, c: number) => new THREE.Vector3(cx + dx * a + nx * c, y, cz + dz * a + nz * c);
    const v0 = b.vertex(p(-hl, -hw), up, 0, 0, {}, col);
    const v1 = b.vertex(p(hl, -hw), up, 1, 0, {}, col);
    const v2 = b.vertex(p(hl, hw), up, 1, 1, {}, col);
    const v3 = b.vertex(p(-hl, hw), up, 0, 1, {}, col);
    // make sure the quad faces up
    const e1 = p(hl, -hw).sub(p(-hl, -hw)), e2 = p(-hl, hw).sub(p(-hl, -hw));
    if (e1.cross(e2).y > 0) b.quad(v0, v1, v2, v3);
    else b.quad(v0, v3, v2, v1);
  };
  const onTrack = (x: number, z: number) => trackDist(x, z) < STREET_HALF + 1.5;
  for (let i = bx0; i <= bx1 + 1; i++) {
    for (let j = by0; j <= by1 + 1; j++) {
      const x = i * G, z = j * G;
      const near = Math.abs(i - (def.city.minX + def.city.maxX) / 2) < 9 && Math.abs(j - (def.city.minY + def.city.maxY) / 2) < 8;
      if (!near) continue;
      // N-S street segment below this intersection, E-W to the right
      for (const [dx, dz] of [[0, 1], [1, 0]] as const) {
        if ((dz && j > by1) || (dx && i > bx1)) continue;
        const sx = x + dx * STREET_HALF, sz = z + dz * STREET_HALF;
        const len = G - 2 * STREET_HALF;
        const mx = sx + dx * len / 2, mz = sz + dz * len / 2;
        if (onTrack(mx, mz)) continue;
        // double yellow centre line
        stripe(paint, mx + dz * 0.12, mz + dx * 0.12, dx, dz, len - 6, 0.1, yellow);
        stripe(paint, mx - dz * 0.12, mz - dx * 0.12, dx, dz, len - 6, 0.1, yellow);
        // dashed lane lines
        for (const off of [-4, 4]) {
          for (let d = 4; d < len - 4; d += 9) {
            stripe(paint, sx + dx * (d + 1.5) + dz * off, sz + dz * (d + 1.5) + dx * off, dx, dz, 3, 0.12, white);
          }
        }
        // zebra crossings at both ends
        for (const end of [2.2, len - 2.2]) {
          const ex = sx + dx * end, ez = sz + dz * end;
          for (let k = -7; k <= 7; k += 1.0) {
            stripe(paint, ex + dz * k, ez + dx * k, dx, dz, 3.0, 0.5, white);
          }
        }
        // stop lines
        stripe(paint, sx + dx * 4.2 - dz * 4, sz + dz * 4.2 - dx * 4, dz, dx, 8, 0.35, white);
      }
    }
  }
  if (paint.vertexCount) {
    const pm = new THREE.Mesh(paint.build(), mats.paint);
    pm.receiveShadow = true;
    group.add(pm);
  }

  // -------------------------------------------------------------- blocks
  const chunkSize = 2; // blocks per chunk edge (frustum culling granularity)
  const chunks = new Map<string, { facade: GeoBuilder; roof: GeoBuilder; pavers: GeoBuilder; curb: GeoBuilder; grass: GeoBuilder; roofProps: GeoBuilder; wood: GeoBuilder }>();
  const chunk = (i: number, j: number) => {
    const key = `${Math.floor(i / chunkSize)},${Math.floor(j / chunkSize)}`;
    let c = chunks.get(key);
    if (!c) {
      c = {
        facade: new GeoBuilder({ aStyle: 4, aWall: 4, aTint: 3 }),
        roof: new GeoBuilder(),
        pavers: new GeoBuilder(),
        curb: new GeoBuilder(),
        grass: new GeoBuilder(),
        roofProps: new GeoBuilder(),
        wood: new GeoBuilder(),
      };
      chunks.set(key, c);
    }
    return c;
  };

  for (let i = bx0; i <= bx1; i++) {
    for (let j = by0; j <= by1; j++) {
      const x0 = i * G + STREET_HALF, x1 = (i + 1) * G - STREET_HALF;
      const z0 = j * G + STREET_HALF, z1 = (j + 1) * G - STREET_HALF;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const td = trackDist(cx, cz);
      const detail = td < 160 ? 0 : td < 420 ? 1 : 2;
      const c = chunk(i, j);
      // separate random streams: buildings must not change with graphics quality
      const br = makeRng(def.seed ^ (i * 73856093) ^ (j * 19349663));
      const pr = makeRng((def.seed ^ (i * 83492791) ^ (j * 29765137)) + 0x9e3779b9);

      if (isPark(i, j)) {
        buildPark(c.grass, c.pavers, props, pr, x0, z0, x1, z1, trackDist, preset);
        continue;
      }
      // raised sidewalk platform + kerb ring
      flatQuad(c.pavers, x0 + 0.25, z0 + 0.25, x1 - 0.25, z1 - 0.25, KERB_H, 2);
      for (const [a0, b0, a1, b1] of [[x0, z0, x1, z0 + 0.25], [x0, z1 - 0.25, x1, z1], [x0, z0 + 0.25, x0 + 0.25, z1 - 0.25], [x1 - 0.25, z0 + 0.25, x1, z1 - 0.25]]) {
        c.curb.box(new THREE.Vector3(a0, 0, b0), new THREE.Vector3(a1, KERB_H + 0.01, b1), 0.5);
      }

      // street furniture on sidewalks of detailed blocks
      if (detail === 0 || (detail === 1 && pr.chance(0.6))) {
        addSidewalkProps(props, pr, x0, z0, x1, z1, detail, preset, trackDist);
      }

      // buildings
      const bx = x0 + SIDEWALK, bz = z0 + SIDEWALK, ex = x1 - SIDEWALK, ez = z1 - SIDEWALK;
      const dd = Math.hypot(cx - downtown.x, cz - downtown.y);
      const dtown = Math.exp(-dd / 330);
      const lots = subdivide({ x0: bx, z0: bz, x1: ex, z1: ez }, br, 16, 46);
      for (const lot of lots) {
        addBuilding(c, br, lot, dtown, detail, { bx, bz, ex, ez });
      }
    }
  }

  const addMerged = (parts: [GeoBuilder, number][], m: THREE.Material, cast: boolean, name: string) => {
    const geos = parts.filter(([b]) => b.vertexCount).map(([b, hex]) => {
      const g = b.build();
      const col = new THREE.Color(hex);
      const n = g.getAttribute('position').count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return g;
    });
    if (!geos.length) return;
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos);
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.name = name;
    group.add(mesh);
  };
  for (const [key, c] of chunks) {
    const add = (b: GeoBuilder, m: THREE.Material, cast: boolean, name: string) => {
      if (!b.vertexCount) return;
      const mesh = new THREE.Mesh(b.build(), m);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.name = `${name}-${key}`;
      group.add(mesh);
    };
    add(c.facade, facade, true, 'facade');
    // fewer draw calls: roofs + rooftop kit + water tanks share one mesh (tinted by vertex colour),
    // and so do sidewalk pavers + kerbs
    addMerged([[c.roof, 0x5e5c58], [c.roofProps, 0x7a7a78], [c.wood, 0x5a4331]], mats.roof, true, `roof-${key}`);
    addMerged([[c.pavers, 0xffffff], [c.curb, 0xe4e1da]], mats.pavers, false, `pavers-${key}`);
    add(c.grass, mats.grass, false, 'grass');
  }

  return { group, props, trackDist };
}

interface Rect { x0: number; z0: number; x1: number; z1: number }

function subdivide(r: Rect, R: Rng, minS: number, maxS: number): Rect[] {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  if (w <= maxS && d <= maxS && (R.chance(0.55) || (w < minS * 2 && d < minS * 2))) return [r];
  const splitX = w > d ? true : w < d ? false : R.chance(0.5);
  const len = splitX ? w : d;
  if (len < minS * 2) return [r];
  const t = R.range(0.35, 0.65);
  const cut = (splitX ? r.x0 : r.z0) + len * t;
  const a = splitX ? { ...r, x1: cut } : { ...r, z1: cut };
  const b = splitX ? { ...r, x0: cut } : { ...r, z0: cut };
  return [...subdivide(a, R, minS, maxS), ...subdivide(b, R, minS, maxS)];
}

function addBuilding(
  c: { facade: GeoBuilder; roof: GeoBuilder; roofProps: GeoBuilder; wood: GeoBuilder },
  R: Rng,
  lot: Rect,
  dtown: number,
  detail: number,
  block: { bx: number; bz: number; ex: number; ez: number },
) {
  // style mix: towers downtown, brick/plaster towards the edges
  const roll = R.next();
  const pTower = 0.55 * dtown * dtown + (detail === 2 ? 0.08 : 0.02);
  let style: Style;
  if (roll < pTower) style = 0;
  else if (roll < pTower + 0.28) style = 1;
  else style = R.chance(0.5) ? 2 : 3;
  let height: number;
  if (style === 0) height = R.range(50, 170) * (0.55 + dtown * 0.65);
  else if (style === 1) height = R.range(18, 58) * (0.8 + dtown * 0.4);
  else if (style === 2) height = R.range(12, 34);
  else height = R.range(10, 24);
  if (detail === 2) height *= R.range(0.8, 1.3);
  const info = STYLE_INFO[style];
  const groundH = 4.8;
  // snap height to whole floors
  const floors = Math.max(2, Math.round((height - groundH) / info.floorH));
  height = groundH + floors * info.floorH + 1.3;

  let tint: THREE.Color;
  if (style === 0) tint = srgbToLinear(R.pick(GLASS_TINT));
  else if (style === 1) tint = srgbToLinear(R.pick(STONE));
  else if (style === 2) tint = new THREE.Color(1, 1, 1).multiplyScalar(R.range(0.8, 1.1)).lerp(new THREE.Color(1, 0.85, 0.75), R.range(0, 0.4));
  else tint = srgbToLinear(R.pick(PLASTER));
  const seed = R.int(0, 997);
  const lit = R.range(0.25, 0.65);

  // setbacks from lot edges that face the street are zero; small gaps between neighbours
  const inset = (edge: number, outer: number) => (Math.abs(edge - outer) < 0.01 ? 0 : 0.4);
  const x0 = lot.x0 + inset(lot.x0, block.bx), x1 = lot.x1 - inset(lot.x1, block.ex);
  const z0 = lot.z0 + inset(lot.z0, block.bz), z1 = lot.z1 - inset(lot.z1, block.ez);

  const addBox = (bx0: number, bz0: number, bx1: number, bz1: number, yb: number, yt: number, gH: number) => {
    walls(c.facade, bx0, bz0, bx1, bz1, yb, yt, [style, info.floorH, info.bay, seed], gH, lit, tint);
    const n = new THREE.Vector3(0, 1, 0);
    const a = c.roof.vertex(new THREE.Vector3(bx0, yt, bz1), n, bx0 / 3, bz1 / 3);
    const b = c.roof.vertex(new THREE.Vector3(bx1, yt, bz1), n, bx1 / 3, bz1 / 3);
    const d = c.roof.vertex(new THREE.Vector3(bx1, yt, bz0), n, bx1 / 3, bz0 / 3);
    const e = c.roof.vertex(new THREE.Vector3(bx0, yt, bz0), n, bx0 / 3, bz0 / 3);
    c.roof.quad(a, b, d, e);
  };

  if (style === 0 && height > 70 && x1 - x0 > 24 && z1 - z0 > 24) {
    const podium = groundH + info.floorH * R.int(3, 6) + 1.3;
    addBox(x0, z0, x1, z1, 0, podium, groundH);
    const ins = R.range(3, 7);
    const tx0 = x0 + ins, tx1 = x1 - ins, tz0 = z0 + ins, tz1 = z1 - ins;
    if (height > 120 && R.chance(0.6)) {
      const mid = podium + (height - podium) * R.range(0.55, 0.75);
      addBox(tx0, tz0, tx1, tz1, podium, mid, -1);
      const ins2 = R.range(2.5, 5);
      addBox(tx0 + ins2, tz0 + ins2, tx1 - ins2, tz1 - ins2, mid, height, -1);
      roofStuff(c, R, tx0 + ins2, tz0 + ins2, tx1 - ins2, tz1 - ins2, height, style);
    } else {
      addBox(tx0, tz0, tx1, tz1, podium, height, -1);
      roofStuff(c, R, tx0, tz0, tx1, tz1, height, style);
    }
  } else {
    addBox(x0, z0, x1, z1, 0, height, groundH);
    roofStuff(c, R, x0, z0, x1, z1, height, style);
    if (style >= 1) {
      const out = style === 1 ? 0.18 : 0.42;
      const th = style === 1 ? 0.35 : 0.7;
      ledge(c.roofProps, x0, z0, x1, z1, height - th, height, out);
      if (style >= 2) ledge(c.roofProps, x0, z0, x1, z1, groundH - 0.05, groundH + 0.28, 0.16);
    }
  }
}

/** a protruding band around a building (cornice / belt course) */
function ledge(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, out: number) {
  b.box(new THREE.Vector3(x0 - out, y0, z0 - out), new THREE.Vector3(x1 + out, y1, z0 + 0.02), 1, {}, false);
  b.box(new THREE.Vector3(x0 - out, y0, z1 - 0.02), new THREE.Vector3(x1 + out, y1, z1 + out), 1, {}, false);
  b.box(new THREE.Vector3(x0 - out, y0, z0 + 0.02), new THREE.Vector3(x0 + 0.02, y1, z1 - 0.02), 1, {}, false);
  b.box(new THREE.Vector3(x1 - 0.02, y0, z0 + 0.02), new THREE.Vector3(x1 + out, y1, z1 - 0.02), 1, {}, false);
}

/** four facade walls of a box, with facade attributes */
function walls(
  b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number,
  style: number[], groundH: number, lit: number, tint: THREE.Color,
) {
  const faces: { n: THREE.Vector3; a: THREE.Vector3; b: THREE.Vector3 }[] = [
    { n: new THREE.Vector3(0, 0, 1), a: new THREE.Vector3(x0, 0, z1), b: new THREE.Vector3(x1, 0, z1) },
    { n: new THREE.Vector3(0, 0, -1), a: new THREE.Vector3(x1, 0, z0), b: new THREE.Vector3(x0, 0, z0) },
    { n: new THREE.Vector3(1, 0, 0), a: new THREE.Vector3(x1, 0, z1), b: new THREE.Vector3(x1, 0, z0) },
    { n: new THREE.Vector3(-1, 0, 0), a: new THREE.Vector3(x0, 0, z0), b: new THREE.Vector3(x0, 0, z1) },
  ];
  const tintArr = [tint.r, tint.g, tint.b];
  for (const f of faces) {
    const len = f.a.distanceTo(f.b);
    const ex = { aStyle: style, aWall: [len, y1, groundH, lit], aTint: tintArr };
    // u runs along T = (nz, 0, -nx), matching the shader's tangent
    const v0 = b.vertex(new THREE.Vector3(f.a.x, y0, f.a.z), f.n, 0, y0, ex);
    const v1 = b.vertex(new THREE.Vector3(f.b.x, y0, f.b.z), f.n, len, y0, ex);
    const v2 = b.vertex(new THREE.Vector3(f.b.x, y1, f.b.z), f.n, len, y1, ex);
    const v3 = b.vertex(new THREE.Vector3(f.a.x, y1, f.a.z), f.n, 0, y1, ex);
    b.quad(v0, v1, v2, v3);
  }
}

function roofStuff(c: { roofProps: GeoBuilder; wood: GeoBuilder }, R: Rng, x0: number, z0: number, x1: number, z1: number, h: number, style: number) {
  const w = x1 - x0, d = z1 - z0;
  const n = R.int(1, 4);
  for (let k = 0; k < n; k++) {
    const sx = R.range(2, Math.min(9, w * 0.4)), sz = R.range(2, Math.min(9, d * 0.4)), sy = R.range(1.4, 4.5);
    const px = R.range(x0 + 1.5, x1 - 1.5 - sx), pz = R.range(z0 + 1.5, z1 - 1.5 - sz);
    c.roofProps.box(new THREE.Vector3(px, h, pz), new THREE.Vector3(px + sx, h + sy, pz + sz), 2);
  }
  if (style >= 2 && R.chance(0.35) && w > 12 && d > 12) {
    // classic wooden water tank on legs
    const tx = R.range(x0 + 4, x1 - 4), tz = R.range(z0 + 4, z1 - 4);
    const legH = 3.2, r = 2.1, th = 3.8;
    for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      c.wood.box(new THREE.Vector3(tx + ox * 1.4 - 0.12, h, tz + oz * 1.4 - 0.12), new THREE.Vector3(tx + ox * 1.4 + 0.12, h + legH, tz + oz * 1.4 + 0.12), 1);
    }
    cylinder(c.wood, tx, h + legH, tz, r, th, 14);
    cone(c.wood, tx, h + legH + th, tz, r + 0.15, 1.3, 14);
  }
}

function cylinder(b: GeoBuilder, x: number, y: number, z: number, r: number, h: number, seg: number) {
  const base = b.vertexCount;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const n = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    b.vertex(new THREE.Vector3(x + n.x * r, y, z + n.z * r), n, i / seg * 4, 0);
    b.vertex(new THREE.Vector3(x + n.x * r, y + h, z + n.z * r), n, i / seg * 4, h);
  }
  for (let i = 0; i < seg; i++) {
    const a = base + i * 2;
    b.quad(a, a + 2, a + 3, a + 1);
  }
}

function cone(b: GeoBuilder, x: number, y: number, z: number, r: number, h: number, seg: number) {
  const tip = b.vertex(new THREE.Vector3(x, y + h, z), new THREE.Vector3(0, 1, 0), 0.5, 1);
  const base = b.vertexCount;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const n = new THREE.Vector3(Math.cos(a), r / h, Math.sin(a)).normalize();
    b.vertex(new THREE.Vector3(x + Math.cos(a) * r, y, z + Math.sin(a) * r), n, i / seg, 0);
  }
  for (let i = 0; i < seg; i++) b.tri(base + i, tip, base + i + 1);
}

function addSidewalkProps(
  props: PropSpot[], R: Rng, x0: number, z0: number, x1: number, z1: number, detail: number,
  preset: GraphicsPreset, trackDist: (x: number, z: number) => number,
) {
  const y = KERB_H;
  // each side: start/end points along the kerb, inward normal, street direction (arm points to street)
  const sides = [
    { ax: x0, az: z0, bx: x1, bz: z0, nx: 0, nz: 1 },
    { ax: x1, az: z1, bx: x0, bz: z1, nx: 0, nz: -1 },
    { ax: x0, az: z1, bx: x0, bz: z0, nx: 1, nz: 0 },
    { ax: x1, az: z0, bx: x1, bz: z1, nx: -1, nz: 0 },
  ];
  for (const s of sides) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    const dx = (s.bx - s.ax) / len, dz = (s.bz - s.az) / len;
    const armYaw = Math.atan2(-s.nx, -s.nz); // towards the street
    const trackSide = trackDist(s.ax + dx * len / 2 - s.nx * 8, s.az + dz * len / 2 - s.nz * 8) < 6;
    // lamps
    const lampStep = trackSide ? 26 : 32;
    for (let d = 10; d < len - 6; d += lampStep) {
      if (!R.chance(preset.propDensity)) continue;
      props.push({ x: s.ax + dx * d + s.nx * 0.7, z: s.az + dz * d + s.nz * 0.7, yaw: armYaw, kind: 'lamp', y });
    }
    // trees in pits (only on streets near the circuit)
    if (detail === 0 && R.chance(0.8)) {
      const step = R.range(15, 19);
      for (let d = 6 + step / 2; d < len - 6; d += step) {
        if (!R.chance(preset.treeDensity)) continue;
        props.push({ x: s.ax + dx * d + s.nx * 1.9, z: s.az + dz * d + s.nz * 1.9, yaw: R.range(0, Math.PI * 2), kind: 'tree', y });
      }
    }
    // benches & bins
    if (detail === 0 && R.chance(0.5 * preset.propDensity)) {
      const d = R.range(15, len - 15);
      props.push({ x: s.ax + dx * d + s.nx * 3.6, z: s.az + dz * d + s.nz * 3.6, yaw: armYaw + Math.PI, kind: 'bench', y });
      props.push({ x: s.ax + dx * (d + 2.2) + s.nx * 0.8, z: s.az + dz * (d + 2.2) + s.nz * 0.8, yaw: 0, kind: 'bin', y });
    }
  }
  // traffic lights at corners
  if (detail === 0) {
    for (const [cx, cz, yaw] of [[x0, z0, Math.PI * 1.25], [x1, z0, Math.PI * 0.75], [x0, z1, -Math.PI * 0.25], [x1, z1, Math.PI * 0.25]]) {
      if (R.chance(0.45 * preset.propDensity)) {
        const ix = cx + (cx === x0 ? 0.9 : -0.9), iz = cz + (cz === z0 ? 0.9 : -0.9);
        props.push({ x: ix, z: iz, yaw, kind: 'tlight', y });
      }
    }
  }
}

function buildPark(
  grass: GeoBuilder, pavers: GeoBuilder, props: PropSpot[], R: Rng,
  x0: number, z0: number, x1: number, z1: number,
  trackDist: (x: number, z: number) => number, preset: GraphicsPreset,
) {
  const up = new THREE.Vector3(0, 1, 0);
  const q = (b: GeoBuilder, a0: number, b0: number, a1: number, b1: number, y: number, s: number) => {
    const v0 = b.vertex(new THREE.Vector3(a0, y, b1), up, a0 / s, b1 / s);
    const v1 = b.vertex(new THREE.Vector3(a1, y, b1), up, a1 / s, b1 / s);
    const v2 = b.vertex(new THREE.Vector3(a1, y, b0), up, a1 / s, b0 / s);
    const v3 = b.vertex(new THREE.Vector3(a0, y, b0), up, a0 / s, b0 / s);
    b.quad(v0, v1, v2, v3);
  };
  // flat park at street level: paved border + grass
  const bw = 4;
  q(pavers, x0, z0, x1, z0 + bw, 0.004, 2);
  q(pavers, x0, z1 - bw, x1, z1, 0.004, 2);
  q(pavers, x0, z0 + bw, x0 + bw, z1 - bw, 0.004, 2);
  q(pavers, x1 - bw, z0 + bw, x1, z1 - bw, 0.004, 2);
  q(grass, x0 + bw, z0 + bw, x1 - bw, z1 - bw, 0.002, 6);
  // trees scattered on the lawn, clear of the circuit
  const n = Math.round(42 * preset.treeDensity);
  for (let k = 0; k < n; k++) {
    const x = R.range(x0 + 7, x1 - 7), z = R.range(z0 + 7, z1 - 7);
    if (trackDist(x, z) < 15) continue;
    props.push({ x, z, yaw: R.range(0, Math.PI * 2), kind: 'tree', y: 0 });
  }
  for (let d = 8; d < x1 - x0 - 4; d += 24) {
    for (const [px, pz] of [[x0 + d, z0 + 2], [x0 + d, z1 - 2]]) {
      if (trackDist(px, pz) > 11) props.push({ x: px, z: pz, yaw: 0, kind: 'lamp', y: 0 });
    }
  }
}
