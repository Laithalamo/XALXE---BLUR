/**
 * Car catalogue. Stats are 1..10 for the menus; the physics block drives the
 * simulation. Geometry numbers come from the processed model (metres, forward = -Z).
 */
export interface WheelSpec {
  /** wheel centre at static ride height, model space */
  x: number;
  y: number;
  z: number;
  radius: number;
  width: number;
  front: boolean;
}

export interface CarPhysics {
  mass: number; // kg
  /** centre of mass, model space */
  com: [number, number, number];
  /** chassis collider half extents + centre */
  box: { hx: number; hy: number; hz: number; cy: number; cz: number };
  enginePower: number; // W (peak)
  maxDriveForce: number; // N (traction-limited launch force)
  topSpeed: number; // m/s (reached through drag)
  brakeForce: number; // N total
  maxSteer: number; // rad at standstill
  highSpeedSteer: number; // rad at top speed
  grip: number; // tyre friction coefficient
  rearGripBias: number; // <1 = looser rear
  driftGrip: number; // rear lateral grip while handbraking
  suspension: { rest: number; stiffness: number; damping: number; travel: number };
  antiRoll: number; // N/m
  downforce: number; // N per (m/s)^2
  driven: 'rear' | 'all';
}

export interface CarSpec {
  id: string;
  name: string;
  model: string;
  /** lighter models for AI opponents: [near, far] */
  lodModels?: string[];
  unlockLevel: number;
  stats: { speed: number; acceleration: number; handling: number; health: number };
  maxHealth: number;
  paint: number; // default paint colour (hex)
  wheels: WheelSpec[];
  physics: CarPhysics;
}

export const CARS: Record<string, CarSpec> = {
  ferrano458: {
    id: 'ferrano458',
    name: 'Ferrano 458',
    model: 'models/cars/ferrano_458.glb',
    lodModels: ['models/cars/ferrano_458_lod.glb', 'models/cars/ferrano_458_lod2.glb'],
    unlockLevel: 1,
    stats: { speed: 8, acceleration: 8, handling: 7, health: 5 },
    maxHealth: 100,
    paint: 0xa3000a,
    wheels: [
      { x: -0.831, y: 0.358, z: -1.155, radius: 0.358, width: 0.247, front: true },
      { x: 0.831, y: 0.358, z: -1.155, radius: 0.358, width: 0.247, front: true },
      { x: -0.8175, y: 0.358, z: 1.4957, radius: 0.358, width: 0.272, front: false },
      { x: 0.8175, y: 0.358, z: 1.4957, radius: 0.358, width: 0.272, front: false },
    ],
    physics: {
      mass: 1480,
      com: [0, 0.42, 0.18],
      box: { hx: 0.93, hy: 0.33, hz: 2.2, cy: 0.62, cz: 0 },
      enginePower: 420000,
      maxDriveForce: 13500,
      topSpeed: 88,
      brakeForce: 22000,
      maxSteer: 0.6,
      highSpeedSteer: 0.12,
      grip: 1.55,
      rearGripBias: 0.97,
      driftGrip: 0.22,
      suspension: { rest: 0.32, stiffness: 52000, damping: 5200, travel: 0.22 },
      antiRoll: 16000,
      downforce: 1.6,
      driven: 'rear',
    },
  },
};

export const DEFAULT_CAR = 'ferrano458';
