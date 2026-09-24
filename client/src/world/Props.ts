import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Tree } from '@dgreenheck/ez-tree';
import type { PropSpot } from './City';
import type { WorldMaterials } from './materials';

/** Instanced street furniture: lamps, traffic lights, benches, bins and trees. */
export interface TreeCell {
  center: THREE.Vector3;
  meshes: THREE.InstancedMesh[];
}

export interface PropsResult {
  group: THREE.Group;
  lampHeads: THREE.Vector3[]; // world positions of lamp bulbs (for night lighting)
  trees: THREE.InstancedMesh[];
  treeCells: TreeCell[];
}

/** hide far tree groups and keep shadows only for the ones near the car */
export function updateTreeLod(cells: TreeCell[], cam: THREE.Vector3, shadowFocus: THREE.Vector3, maxDist: number, shadowDist: number, shadows: boolean) {
  for (const c of cells) {
    const d = Math.hypot(c.center.x - cam.x, c.center.z - cam.z);
    const visible = d < maxDist + 110;
    const ds = Math.hypot(c.center.x - shadowFocus.x, c.center.z - shadowFocus.z);
    const cast = shadows && ds < shadowDist * 0.5 + 115;
    for (const m of c.meshes) {
      m.visible = visible;
      m.castShadow = cast;
    }
  }
}

function cyl(r0: number, r1: number, h: number, seg = 10) {
  return new THREE.CylinderGeometry(r1, r0, h, seg, 1);
}

function lampGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(cyl(0.2, 0.18, 0.7, 12).translate(0, 0.35, 0));
  parts.push(cyl(0.1, 0.065, 8.6, 10).translate(0, 4.3, 0));
  // curved arm from pole top out over the street (+Z)
  const arm = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 8.3, 0), new THREE.Vector3(0, 8.85, 0.5), new THREE.Vector3(0, 9.0, 1.4), new THREE.Vector3(0, 8.95, 2.3),
  ]);
  parts.push(new THREE.TubeGeometry(arm, 12, 0.05, 6, false));
  parts.push(new THREE.BoxGeometry(0.34, 0.16, 0.8).translate(0, 8.9, 2.55));
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  g.computeVertexNormals();
  return g;
}

function trafficLightGeometry() {
  const pole: THREE.BufferGeometry[] = [];
  pole.push(cyl(0.13, 0.11, 6.2, 10).translate(0, 3.1, 0));
  pole.push(cyl(0.07, 0.06, 5.2, 8).rotateX(Math.PI / 2).translate(0, 5.9, 2.6));
  const head: THREE.BufferGeometry[] = [];
  head.push(new THREE.BoxGeometry(0.42, 1.2, 0.3).translate(0, 5.35, 4.9));
  head.push(new THREE.BoxGeometry(0.34, 0.95, 0.25).translate(0, 2.9, 0.22));
  const lens: THREE.BufferGeometry[] = [];
  const colors: number[] = [];
  const cols = [new THREE.Color(0.25, 0.01, 0.01), new THREE.Color(0.25, 0.14, 0.0), new THREE.Color(0.1, 2.5, 0.8)];
  for (const [y0, z] of [[5.35, 4.9 - 0.16], [2.9, 0.22 - 0.13]] as const) {
    for (let k = 0; k < 3; k++) {
      const disc = new THREE.CircleGeometry(0.11, 12).rotateY(Math.PI).translate(0, y0 + 0.36 - k * 0.36 * (y0 > 4 ? 1 : 0.8), z - 0.001);
      const c = cols[k];
      for (let i = 0; i < disc.getAttribute('position').count; i++) colors.push(c.r, c.g, c.b);
      lens.push(disc);
    }
  }
  const lensGeo = mergeGeometries(lens);
  lensGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return {
    pole: mergeGeometries(pole.map((p) => p.toNonIndexed())),
    head: mergeGeometries(head.map((p) => p.toNonIndexed())),
    lens: lensGeo,
  };
}

function benchGeometry() {
  const wood: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) wood.push(new THREE.BoxGeometry(1.8, 0.04, 0.12).translate(0, 0.45, -0.16 + k * 0.16));
  for (let k = 0; k < 2; k++) wood.push(new THREE.BoxGeometry(1.8, 0.1, 0.035).rotateX(-0.2).translate(0, 0.62 + k * 0.14, -0.27));
  const metal: THREE.BufferGeometry[] = [];
  for (const x of [-0.75, 0.75]) {
    metal.push(new THREE.BoxGeometry(0.06, 0.45, 0.5).translate(x, 0.225, -0.05));
    metal.push(new THREE.BoxGeometry(0.06, 0.4, 0.05).translate(x, 0.65, -0.28));
  }
  return { wood: mergeGeometries(wood.map((g) => g.toNonIndexed())), metal: mergeGeometries(metal.map((g) => g.toNonIndexed())) };
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, spots: PropSpot[], cast = true, scale = 1) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, spots.length));
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(scale, scale, scale);
  spots.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
    m.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), q, s));
  });
  m.count = spots.length;
  m.castShadow = cast;
  m.receiveShadow = true;
  m.computeBoundingSphere();
  return m;
}

/** Build a few tree variants with ez-tree, normalised to real-world size. */
function treeVariants() {
  const presets: [string, number, number][] = [
    ['Ash Medium', 11, 3101],
    ['Oak Medium', 10, 777],
    ['Aspen Medium', 12, 4242],
    ['Ash Small', 8, 99],
  ];
  const barkMats = new Map<string, THREE.MeshStandardMaterial>();
  const leafMats = new Map<string, THREE.MeshStandardMaterial>();
  return presets.map(([name, height, seed]) => {
    const tree = new Tree();
    tree.loadPreset(name);
    // game-ready detail: fewer branch rings/sides and fewer, larger leaf cards
    const o = tree.options;
    const sections = o.branch.sections as Record<string, number>;
    const segments = o.branch.segments as Record<string, number>;
    for (const k of Object.keys(sections)) sections[k] = Math.max(2, Math.round(sections[k] * 0.45));
    for (const k of Object.keys(segments)) segments[k] = Math.max(3, Math.round(segments[k] * 0.5));
    o.leaves.count = Math.max(4, Math.round(o.leaves.count * 0.36));
    if (o.leaves.type === 'aspen') o.leaves.type = 'ash' as typeof o.leaves.type; // summer: green leaves only
    o.leaves.size *= 1.55;
    o.seed = seed;
    tree.generate();
    const bb = new THREE.Box3().setFromObject(tree);
    const k = height / (bb.max.y - bb.min.y);
    const branches = tree.branchesMesh.geometry.clone().scale(k, k, k).translate(0, -bb.min.y * k, 0);
    const leaves = tree.leavesMesh.geometry.clone().scale(k, k, k).translate(0, -bb.min.y * k, 0);
    const bm = tree.branchesMesh.material as THREE.MeshPhongMaterial;
    const lm = tree.leavesMesh.material as THREE.MeshPhongMaterial;
    const bKey = bm.map?.uuid ?? name;
    if (!barkMats.has(bKey)) {
      barkMats.set(bKey, new THREE.MeshStandardMaterial({
        map: bm.map, normalMap: bm.normalMap, roughnessMap: (bm as unknown as { roughnessMap: THREE.Texture | null }).roughnessMap, aoMap: bm.aoMap, color: bm.color, roughness: 1,
      }));
    }
    const lKey = lm.map?.uuid ?? name;
    if (!leafMats.has(lKey)) {
      if (lm.map) lm.map.colorSpace = THREE.SRGBColorSpace;
      const leaf = new THREE.MeshStandardMaterial({
        map: lm.map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75, color: new THREE.Color(0.8, 0.85, 0.75),
      });
      // keep alpha-tested leaves from vanishing in distant mip levels
      leaf.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', `
          #ifdef USE_MAP
          { vec2 tsz = vec2(textureSize(map, 0));
            float lod = log2(max(max(length(dFdx(vMapUv * tsz)), length(dFdy(vMapUv * tsz))), 1.0));
            diffuseColor.a *= 1.0 + lod * 0.28; }
          #endif
          #include <alphatest_fragment>`);
      };
      leaf.customProgramCacheKey = () => 'leaf-coverage';
      leafMats.set(lKey, leaf);
    }
    tree.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    return { branches, leaves, bark: barkMats.get(bKey)!, leaf: leafMats.get(lKey)! };
  });
}

export function buildProps(spots: PropSpot[], mats: WorldMaterials): PropsResult {
  const group = new THREE.Group();
  group.name = 'props';
  const lampHeads: THREE.Vector3[] = [];
  const by = (k: PropSpot['kind']) => spots.filter((s) => s.kind === k);

  // lamps
  const lamps = by('lamp');
  const pole = new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.7, roughness: 0.45 });
  group.add(instanced(lampGeometry(), pole, lamps));
  const glassGeo = new THREE.PlaneGeometry(0.28, 0.7).rotateX(Math.PI / 2).translate(0, 8.81, 2.55);
  group.add(instanced(glassGeo, mats.lampGlow, lamps, false));
  for (const l of lamps) {
    lampHeads.push(new THREE.Vector3(l.x + Math.sin(l.yaw) * 2.55, l.y + 8.75, l.z + Math.cos(l.yaw) * 2.55));
  }

  // traffic lights
  const tl = by('tlight');
  const tg = trafficLightGeometry();
  const black = new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.4, roughness: 0.55 });
  group.add(instanced(tg.pole, pole, tl));
  group.add(instanced(tg.head, black, tl, false));
  const lensMat = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 1, color: 0x000000, roughness: 0.2 });
  // emissive colour comes from vertex colours through a small patch
  lensMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor.rgb;');
  };
  group.add(instanced(tg.lens, lensMat, tl, false));

  // benches & bins
  const bench = benchGeometry();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.85 });
  const benches = by('bench');
  group.add(instanced(bench.wood, wood, benches, false));
  group.add(instanced(bench.metal, black, benches, false));
  const binGeo = cyl(0.26, 0.28, 0.95, 14).translate(0, 0.475, 0);
  const binMat = new THREE.MeshStandardMaterial({ color: 0x1f3b2c, metalness: 0.5, roughness: 0.5 });
  group.add(instanced(binGeo, binMat, by('bin'), false));

  // trees: split spots across variants and 160 m spatial cells, so frustum
  // culling (camera + sun shadow) and the distance cut-off can skip them
  const treeSpots = by('tree');
  const variants = treeVariants();
  const cells = new Map<string, PropSpot[][]>();
  treeSpots.forEach((s, i) => {
    const key = `${Math.floor(s.x / 160)},${Math.floor(s.z / 160)}`;
    let c = cells.get(key);
    if (!c) { c = variants.map(() => []); cells.set(key, c); }
    c[(((i * 7 + Math.floor(s.x)) % variants.length) + variants.length) % variants.length].push(s);
  });
  const trees: THREE.InstancedMesh[] = [];
  const treeCells: TreeCell[] = [];
  const depthMats = variants.map((v) => new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: v.leaf.map, alphaTest: 0.5 }));
  for (const [key, buckets] of cells) {
    const [cx, cz] = key.split(',').map(Number);
    const cell: TreeCell = { center: new THREE.Vector3((cx + 0.5) * 160, 0, (cz + 0.5) * 160), meshes: [] };
    variants.forEach((v, i) => {
      if (!buckets[i].length) return;
      const b = instanced(v.branches, v.bark, buckets[i], true);
      const l = instanced(v.leaves, v.leaf, buckets[i], true);
      l.customDepthMaterial = depthMats[i];
      group.add(b, l);
      trees.push(b, l);
      cell.meshes.push(b, l);
    });
    treeCells.push(cell);
  }
  if (new URLSearchParams(location.search).has('stats')) {
    console.log('tree variants tris', variants.map((v) => [v.branches.index!.count / 3, v.leaves.index!.count / 3]), 'trees', treeSpots.length, 'cells', cells.size);
  }
  // tree pits (dark soil squares) under street trees
  const pitGeo = new THREE.PlaneGeometry(1.4, 1.4).rotateX(-Math.PI / 2).translate(0, 0.004, 0);
  const soil = new THREE.MeshStandardMaterial({ color: 0x2a2119, roughness: 1 });
  group.add(instanced(pitGeo, soil, treeSpots.filter((s) => s.y > 0.1), false));

  return { group, lampHeads, trees, treeCells };
}
