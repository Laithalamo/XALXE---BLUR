import * as THREE from 'three';
import type { TrackDef } from '@shared/track/trackDefs';
import type { Centerline } from '@shared/track/centerline';
import { GeoBuilder } from './geom';
import type { WorldMaterials } from './materials';
import { makeBannerAtlas, BANNER_COUNT } from './banners';

/**
 * Visual track: asphalt ribbon with lane data, race markings (start grid,
 * finish line, kerb paint, crossings), concrete jersey barriers, debris
 * fences on the outside of corners, sponsor boards and the start gantry.
 */
const ROAD_Y = 0.012;

// New-Jersey barrier profile: (outward offset from the road edge, height)
const JERSEY: [number, number][] = [
  [0.0, 0.0], [0.0, 0.08], [0.17, 0.33], [0.215, 0.81], [0.385, 0.81], [0.43, 0.33], [0.6, 0.08], [0.6, 0.0],
];

export function buildTrackView(def: TrackDef, cl: Centerline, mats: WorldMaterials) {
  const group = new THREE.Group();
  group.name = 'track';
  const hw = def.roadWidth / 2;
  const S = cl.samples;
  const N = S.length;
  const up = new THREE.Vector3(0, 1, 0);

  // ---------------------------------------------------------------- ribbon
  const road = new GeoBuilder({ aRoad: 2 });
  const cols = 5;
  for (let i = 0; i <= N; i++) {
    const s = S[i % N];
    const along = i === N ? cl.length : s.s;
    for (let c = 0; c < cols; c++) {
      const lat = hw - (2 * hw * c) / (cols - 1); // + left .. - right
      const x = s.x + s.tz * lat, z = s.z - s.tx * lat;
      road.vertex(new THREE.Vector3(x, ROAD_Y, z), up, x / 3, z / 3, { aRoad: [lat, along] });
    }
  }
  for (let i = 0; i < N; i++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = i * cols + c, b = a + 1, d = a + cols, e = d + 1;
      // left->right across, forward along: make the face point up
      road.quad(a, d, e, b);
    }
  }
  const roadGeo = road.build();
  fixUpFacing(roadGeo);
  const roadMesh = new THREE.Mesh(roadGeo, mats.asphalt);
  roadMesh.receiveShadow = true;
  roadMesh.name = 'road';
  (mats.asphalt as THREE.MeshStandardMaterial).polygonOffset = true;
  (mats.asphalt as THREE.MeshStandardMaterial).polygonOffsetFactor = -1;
  (mats.asphalt as THREE.MeshStandardMaterial).polygonOffsetUnits = -2;
  group.add(roadMesh);

  // --------------------------------------------------------------- markings
  const paint = new GeoBuilder({}, true);
  const white = new THREE.Color(0.8, 0.8, 0.78);
  const yellow = new THREE.Color(0.75, 0.52, 0.06);
  const red = new THREE.Color(0.55, 0.03, 0.02);
  const black = new THREE.Color(0.02, 0.02, 0.02);
  /** paint a quad in track space: s from s0..s1, lateral l0..l1 */
  const band = (s0: number, s1: number, l0: number, l1: number, col: THREE.Color, step = 1.0) => {
    const n = Math.max(1, Math.ceil((s1 - s0) / step));
    let prevA = -1, prevB = -1;
    for (let k = 0; k <= n; k++) {
      const s = s0 + ((s1 - s0) * k) / n;
      const p = cl.at(s);
      const y = ROAD_Y + 0.004;
      const a = paint.vertex(new THREE.Vector3(p.x + p.tz * l0, y, p.z - p.tx * l0), up, 0, 0, {}, col);
      const b = paint.vertex(new THREE.Vector3(p.x + p.tz * l1, y, p.z - p.tx * l1), up, 1, 0, {}, col);
      if (k > 0) paint.quad(prevA, a, b, prevB);
      prevA = a; prevB = b;
    }
  };
  const L = cl.length;
  // edge lines, lane dashes, double yellow centre
  band(0, L, hw - 0.35, hw - 0.5, white, 2);
  band(0, L, -hw + 0.5, -hw + 0.35, white, 2);
  band(0, L, 0.2, 0.1, yellow, 2);
  band(0, L, -0.1, -0.2, yellow, 2);
  for (let s = 0; s < L - 6; s += 9) {
    band(s, s + 3, 4.06, 3.94, white);
    band(s, s + 3, -3.94, -4.06, white);
  }
  // chequered start/finish line
  const sq = 0.8;
  for (let r = 0; r < 2; r++) {
    for (let l = -hw + 0.5, k = 0; l < hw - 0.5 - 1e-6; l += sq, k++) {
      band(-sq + r * sq, r * sq, Math.min(l + sq, hw - 0.5), l, (k + r) % 2 ? black : white, sq);
    }
  }
  // starting grid boxes (2 columns, staggered)
  for (let g = 0; g < 8; g++) {
    const s = -10 - g * 9;
    const lat = g % 2 === 0 ? 3.6 : -3.6;
    const sBox = s - (g % 2) * 4.5;
    band(sBox - 0.15, sBox, lat + 1.3, lat - 1.3, white);
    band(sBox - 1.2, sBox, lat + 1.3, lat + 1.15, white);
    band(sBox - 1.2, sBox, lat - 1.15, lat - 1.3, white);
  }
  // kerb paint on the inside of every corner, and crossings on the straights
  const corners = findCorners(cl);
  for (const c of corners) {
    const inside = c.dir > 0 ? 1 : -1; // +1 = left side is inside
    const l0 = inside > 0 ? hw - 0.05 : -hw + 1.25;
    const l1 = inside > 0 ? hw - 1.25 : -hw + 0.05;
    for (let s = c.s0 - 6, k = 0; s < c.s1 + 6; s += 1.2, k++) {
      band(s, s + 1.2, l0, l1, k % 2 ? white : red, 1.2);
    }
  }
  // zebra crossings where the circuit runs straight through a city intersection
  const G = def.grid;
  for (let gx = def.city.minX; gx <= def.city.maxX + 1; gx++) {
    for (let gy = def.city.minY; gy <= def.city.maxY + 1; gy++) {
      const pr = cl.project(gx * G, gy * G);
      if (Math.abs(pr.lateral) > 0.8) continue;
      if (corners.some((c) => pr.s > c.s0 - 25 && pr.s < c.s1 + 25)) continue;
      if (Math.abs(pr.s) < 30 || Math.abs(pr.s - L) < 30) continue; // keep the grid area clean
      for (const off of [-10.4, 10.4]) {
        for (let l = -hw + 1.0; l <= hw - 1.4; l += 1.0) band(pr.s + off - 1.5, pr.s + off + 1.5, l + 0.5, l, white, 3);
      }
    }
  }
  const paintMesh = new THREE.Mesh(paint.build(), mats.paint);
  fixUpFacing(paintMesh.geometry);
  paintMesh.receiveShadow = true;
  paintMesh.name = 'markings';
  group.add(paintMesh);

  // ---------------------------------------------------------------- barriers
  const bar = new GeoBuilder({ aBar: 2 });
  for (const side of [1, -1] as const) {
    for (let seg = 0; seg < JERSEY.length - 1; seg++) {
      const [o0, h0] = JERSEY[seg], [o1, h1] = JERSEY[seg + 1];
      // profile normal in (outward, up) space
      const pnx = -(h1 - h0), pny = o1 - o0;
      const pl = Math.hypot(pnx, pny) || 1;
      const nOut = pnx / pl, nUp = pny / pl; // nOut < 0 means facing the road
      const base = bar.vertexCount;
      for (let i = 0; i <= N; i++) {
        const s = S[i % N];
        const along = i === N ? L : s.s;
        const ox = s.tz * side, oz = -s.tx * side; // outward direction for this side
        const n = new THREE.Vector3(ox * nOut, nUp, oz * nOut).normalize();
        for (const [o, h] of [[o0, h0], [o1, h1]]) {
          const x = s.x + ox * (hw + o), z = s.z + oz * (hw + o);
          bar.vertex(new THREE.Vector3(x, h, z), n, along / 2, (o + h) / 2, { aBar: [along, h] });
        }
      }
      for (let i = 0; i < N; i++) {
        const a = base + i * 2;
        bar.quad(a, a + 2, a + 3, a + 1);
      }
    }
  }
  const barGeo = bar.build();
  fixFacingByNormal(barGeo);
  const barMesh = new THREE.Mesh(barGeo, mats.barrier);
  barMesh.castShadow = true;
  barMesh.receiveShadow = true;
  barMesh.name = 'barriers';
  group.add(barMesh);

  // -------------------------------------------- debris fences outside corners
  const fence = new GeoBuilder();
  const posts: THREE.Matrix4[] = [];
  const fenceTop = 3.9;
  for (const c of corners) {
    const outside = c.dir > 0 ? -1 : 1;
    const s0 = c.s0 - 55, s1 = c.s1 + 35;
    let prev: [number, number] | null = null;
    for (let s = s0; s <= s1 + 0.01; s += 2) {
      const p = cl.at(s);
      const ox = p.tz * outside, oz = -p.tx * outside;
      const x = p.x + ox * (hw + 0.3), z = p.z + oz * (hw + 0.3);
      const n = new THREE.Vector3(-ox, 0, -oz);
      const a = fence.vertex(new THREE.Vector3(x, 0.8, z), n, s / 0.5, 0.8 / 0.5);
      const b = fence.vertex(new THREE.Vector3(x - ox * 0.35, fenceTop, z - oz * 0.35), n, s / 0.5, fenceTop / 0.5);
      if (prev) fence.quad(prev[0], a, b, prev[1]);
      prev = [a, b];
      if (Math.round(s - s0) % 4 === 0) {
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x - ox * 0.17, 0.8 + (fenceTop - 0.8) / 2, z - oz * 0.17),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(oz, 0, -ox).normalize(), Math.atan2(0.35, fenceTop - 0.8) * -1),
          new THREE.Vector3(1, 1, 1),
        );
        posts.push(m);
      }
    }
  }
  if (fence.vertexCount) {
    const fm = new THREE.Mesh(fence.build(), mats.fence);
    fm.castShadow = true;
    fm.name = 'fences';
    group.add(fm);
    const postGeo = new THREE.CylinderGeometry(0.05, 0.05, fenceTop - 0.8 + 0.1, 8);
    const pm = new THREE.InstancedMesh(postGeo, mats.metal, posts.length);
    posts.forEach((m, i) => pm.setMatrixAt(i, m));
    pm.castShadow = true;
    pm.name = 'fence-posts';
    group.add(pm);
  }

  // ------------------------------------------------------- sponsor boards
  const atlas = makeBannerAtlas();
  const boardMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.55, metalness: 0.0 });
  const boards = new GeoBuilder();
  let bi = 0;
  const boardLen = 6.4;
  for (let s = 20; s < L - 20; s += 32) {
    if (corners.some((c) => s > c.s0 - 10 && s < c.s1 + 10)) continue;
    for (const side of [1, -1] as const) {
      const which = bi++ % BANNER_COUNT;
      const v0 = 1 - (which + 1) / BANNER_COUNT, v1 = 1 - which / BANNER_COUNT;
      let prev: [number, number] | null = null;
      for (let k = 0; k <= 4; k++) {
        const ss = s + (boardLen * k) / 4;
        const p = cl.at(ss);
        const ox = p.tz * side, oz = -p.tx * side;
        const n = new THREE.Vector3(-ox, 0.08, -oz).normalize();
        const u = side > 0 ? 1 - k / 4 : k / 4;
        const a = boards.vertex(new THREE.Vector3(p.x + ox * (hw + 0.155), 0.34, p.z + oz * (hw + 0.155)), n, u, v0);
        const b = boards.vertex(new THREE.Vector3(p.x + ox * (hw + 0.2), 0.8, p.z + oz * (hw + 0.2)), n, u, v1);
        if (prev) boards.quad(prev[0], a, b, prev[1]);
        prev = [a, b];
      }
    }
  }
  const boardGeo = boards.build();
  fixFacingByNormal(boardGeo);
  const boardMesh = new THREE.Mesh(boardGeo, boardMat);
  boardMesh.receiveShadow = true;
  boardMesh.name = 'boards';
  group.add(boardMesh);

  group.add(buildGantry(cl, hw, mats, atlas));
  group.add(manholes(cl, hw));
  return { group, corners };
}

/** find corners (curved sections) from curvature: returns s-range and turn direction (+1 = left) */
export function findCorners(cl: Centerline) {
  const out: { s0: number; s1: number; dir: number }[] = [];
  let cur: { s0: number; s1: number; dir: number } | null = null;
  for (const s of cl.samples) {
    if (Math.abs(s.k) > 1 / 200) {
      const dir = Math.sign(s.k);
      if (!cur) cur = { s0: s.s, s1: s.s, dir };
      cur.s1 = s.s;
    } else if (cur) {
      if (cur.s1 - cur.s0 > 5) out.push(cur);
      cur = null;
    }
  }
  if (cur && cur.s1 - cur.s0 > 5) out.push(cur);
  return out;
}

function buildGantry(cl: Centerline, hw: number, mats: WorldMaterials, atlas: THREE.Texture) {
  const g = new THREE.Group();
  g.name = 'gantry';
  const p = cl.at(6);
  const yaw = Math.atan2(p.tx, p.tz);
  g.position.set(p.x, 0, p.z);
  g.rotation.y = yaw;
  const span = hw * 2 + 3;
  const truss = new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.8, roughness: 0.35 });
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 8.4, 0.9), truss);
    leg.position.set((sx * span) / 2, 4.2, 0);
    leg.castShadow = true;
    g.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 0.9, 1.6, 1.0), truss);
  beam.position.set(0, 8.0, 0);
  beam.castShadow = true;
  g.add(beam);
  // banner faces (front + back) use the first atlas row (XALXE)
  const bannerMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.4, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0.25 });
  const bg = new THREE.PlaneGeometry(span - 0.6, 1.35);
  const uv = bg.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - 1 / BANNER_COUNT + uv.getY(i) / BANNER_COUNT);
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(bg, bannerMat);
    m.position.set(0, 8.0, side * 0.51);
    if (side < 0) m.rotation.y = Math.PI;
    g.add(m);
  }
  // start lights
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a0a, emissiveIntensity: 0.0, roughness: 0.3 });
  for (let k = 0; k < 5; k++) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 16).rotateX(Math.PI / 2), lightMat);
    l.position.set(-1.2 + k * 0.6, 6.85, -0.25);
    g.add(l);
  }
  const housing = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.7, 0.4), truss);
  housing.position.set(0, 6.85, 0.0);
  g.add(housing);
  g.userData.startLights = lightMat;
  return g;
}

/** ensure all triangles of a flat (upward) mesh face +Y */
function fixUpFacing(g: THREE.BufferGeometry) {
  const idx = g.getIndex()!;
  const pos = g.getAttribute('position');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    const ny = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (ny > 0) {
      const t = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, t);
    }
  }
  idx.needsUpdate = true;
}

/** flip triangles whose winding disagrees with their vertex normals */
function fixFacingByNormal(g: THREE.BufferGeometry) {
  const idx = g.getIndex()!;
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    n.fromBufferAttribute(nrm, idx.getX(i));
    const fn = b.sub(a).cross(c.sub(a));
    if (fn.dot(n) < 0) {
      const t = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, t);
    }
  }
  idx.needsUpdate = true;
}

/** cast-iron manhole covers and drain grates scattered on the circuit */
function manholes(cl: Centerline, hw: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#9a9a9a';
  g.beginPath(); g.arc(128, 128, 122, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#5a5a5a';
  g.lineWidth = 7;
  for (let r = 30; r < 120; r += 22) { g.beginPath(); g.arc(128, 128, r, 0, Math.PI * 2); g.stroke(); }
  for (let a = 0; a < 12; a++) {
    g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a * 0.5236) * 118, 128 + Math.sin(a * 0.5236) * 118); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3a3632, roughness: 0.55, metalness: 0.75, bumpMap: tex, bumpScale: 1.2,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const geo = new THREE.CircleGeometry(0.34, 24).rotateX(-Math.PI / 2);
  const spots: THREE.Matrix4[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let s = 25; s < cl.length; s += 35 + rnd() * 40) {
    const p = cl.at(s);
    const lat = (rnd() - 0.5) * (hw * 2 - 3);
    spots.push(new THREE.Matrix4().makeTranslation(p.x + p.tz * lat, ROAD_Y + 0.006, p.z - p.tx * lat));
  }
  const m = new THREE.InstancedMesh(geo, mat, spots.length);
  spots.forEach((mm, i) => m.setMatrixAt(i, mm));
  m.receiveShadow = true;
  m.name = 'manholes';
  return m;
}
