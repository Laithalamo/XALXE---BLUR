import * as THREE from 'three';

/**
 * Tiny growable geometry builder: push quads/triangles with arbitrary extra
 * attributes, then produce one merged BufferGeometry (fewer draw calls).
 */
export class GeoBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  extra: Record<string, { size: number; data: number[] }> = {};
  color?: number[];

  constructor(extras: Record<string, number> = {}, withColor = false) {
    for (const [k, size] of Object.entries(extras)) this.extra[k] = { size, data: [] };
    if (withColor) this.color = [];
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  vertex(p: THREE.Vector3Like, n: THREE.Vector3Like, u: number, v: number, ex: Record<string, number[]> = {}, c?: THREE.Color) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    for (const [k, a] of Object.entries(this.extra)) {
      const vals = ex[k];
      for (let i = 0; i < a.size; i++) a.data.push(vals ? vals[i] : 0);
    }
    if (this.color) {
      const cc = c ?? new THREE.Color(1, 1, 1);
      this.color.push(cc.r, cc.g, cc.b);
    }
    return this.vertexCount - 1;
  }

  /** quad a-b-c-d counter-clockwise when seen from the normal side */
  quad(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d);
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }

  /** axis-aligned box (min/max), optional per-face uv scale in metres, skip bottom by default */
  box(min: THREE.Vector3, max: THREE.Vector3, uvScale = 1, ex: Record<string, number[]> = {}, skipBottom = true) {
    const faces: [THREE.Vector3, THREE.Vector3[]][] = [];
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const { x: x0, y: y0, z: z0 } = min, { x: x1, y: y1, z: z1 } = max;
    faces.push([v(0, 1, 0), [v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0), v(x0, y1, z0)]]);
    faces.push([v(0, 0, 1), [v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)]]);
    faces.push([v(0, 0, -1), [v(x1, y0, z0), v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0)]]);
    faces.push([v(1, 0, 0), [v(x1, y0, z1), v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1)]]);
    faces.push([v(-1, 0, 0), [v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0)]]);
    if (!skipBottom) faces.push([v(0, -1, 0), [v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1)]]);
    for (const [n, q] of faces) {
      const ids = q.map((p) => {
        // planar uv from the two axes orthogonal to the normal
        const u = Math.abs(n.x) > 0.5 ? p.z : p.x;
        const w = Math.abs(n.y) > 0.5 ? p.z : p.y;
        return this.vertex(p, n, u / uvScale, w / uvScale, ex);
      });
      this.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    for (const [k, a] of Object.entries(this.extra)) g.setAttribute(k, new THREE.Float32BufferAttribute(a.data, a.size));
    if (this.color) g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
