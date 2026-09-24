/** Minimal allocation-light 3D vector / quaternion helpers (no three.js on the server). */
export interface V3 { x: number; y: number; z: number }
export interface Q4 { x: number; y: number; z: number; w: number }

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const set = (o: V3, x: number, y: number, z: number) => { o.x = x; o.y = y; o.z = z; return o; };
export const copy = (o: V3, a: V3) => { o.x = a.x; o.y = a.y; o.z = a.z; return o; };
export const add = (o: V3, a: V3, b: V3) => set(o, a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (o: V3, a: V3, b: V3) => set(o, a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (o: V3, a: V3, s: number) => set(o, a.x * s, a.y * s, a.z * s);
export const addScaled = (o: V3, a: V3, b: V3, s: number) => set(o, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
export const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (o: V3, a: V3, b: V3) =>
  set(o, a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const len = (a: V3) => Math.hypot(a.x, a.y, a.z);
export const normalize = (o: V3, a: V3) => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return set(o, a.x / l, a.y / l, a.z / l);
};

/** rotate vector v by unit quaternion q */
export function rotate(o: V3, q: Q4, v: V3): V3 {
  const { x, y, z } = v;
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return set(
    o,
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  );
}

export const quatFromYaw = (yaw: number): Q4 => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
