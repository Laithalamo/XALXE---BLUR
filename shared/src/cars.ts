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
  driven: 'front' | 'rear' | 'all';
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
  kestrel: {
    id: 'kestrel',
    name: 'Kestrel C',
    model: 'models/cars/kestrel_c.glb',
    lodModels: ['models/cars/kestrel_c_lod.glb', 'models/cars/kestrel_c_lod2.glb'],
    unlockLevel: 1,
    stats: { speed: 7, acceleration: 9, handling: 8, health: 7 },
    maxHealth: 115,
    paint: 0x1f5fd6,
    // all-wheel drive concept: quicker off the line and more grip, a little less top speed
    wheels: [
      { x: -0.976, y: 0.384, z: -1.485, radius: 0.384, width: 0.28, front: true },
      { x: 0.976, y: 0.384, z: -1.485, radius: 0.384, width: 0.28, front: true },
      { x: -0.9825, y: 0.384, z: 1.314, radius: 0.384, width: 0.28, front: false },
      { x: 0.9825, y: 0.384, z: 1.314, radius: 0.384, width: 0.28, front: false },
    ],
    physics: {
      mass: 1560,
      com: [0, 0.44, 0.02],
      box: { hx: 1.02, hy: 0.33, hz: 2.15, cy: 0.62, cz: -0.24 },
      enginePower: 405000,
      maxDriveForce: 16000,
      topSpeed: 85,
      brakeForce: 23500,
      maxSteer: 0.58,
      highSpeedSteer: 0.12,
      grip: 1.62,
      rearGripBias: 0.98,
      driftGrip: 0.24,
      suspension: { rest: 0.32, stiffness: 56000, damping: 5500, travel: 0.22 },
      antiRoll: 18000,
      downforce: 1.8,
      driven: 'all',
    },
  },
  bavra_gtr: {
    id: 'bavra_gtr',
    name: 'Bavra R3 GTR',
    model: 'models/cars/bavra_gtr.glb',
    lodModels: ['models/cars/bavra_gtr_lod.glb', 'models/cars/bavra_gtr_lod2.glb'],
    unlockLevel: 1,
    stats: { speed: 8, acceleration: 9, handling: 9, health: 5 },
    maxHealth: 95,
    paint: 0xd8dde3,
    // stripped-out race car: light, lots of downforce, fragile
    wheels: [
      { x: -0.8087, y: 0.3304, z: -1.3656, radius: 0.33, width: 0.293, front: true },
      { x: 0.8087, y: 0.3304, z: -1.3656, radius: 0.33, width: 0.293, front: true },
      { x: -0.8087, y: 0.3352, z: 1.3656, radius: 0.33, width: 0.293, front: false },
      { x: 0.8087, y: 0.3352, z: 1.3656, radius: 0.33, width: 0.293, front: false },
    ],
    physics: {
      mass: 1250,
      com: [0, 0.4, 0.05],
      box: { hx: 0.95, hy: 0.33, hz: 2.25, cy: 0.62, cz: 0.13 },
      enginePower: 400000,
      maxDriveForce: 14500,
      topSpeed: 86,
      brakeForce: 24000,
      maxSteer: 0.6,
      highSpeedSteer: 0.12,
      grip: 1.65,
      rearGripBias: 0.97,
      driftGrip: 0.22,
      suspension: { rest: 0.3, stiffness: 50000, damping: 5200, travel: 0.2 },
      antiRoll: 18000,
      downforce: 2.4,
      driven: 'rear',
    },
  },
  bavra_r3: {
    id: 'bavra_r3',
    name: 'Bavra R3 Coupe',
    model: 'models/cars/bavra_r3.glb',
    lodModels: ['models/cars/bavra_r3_lod.glb', 'models/cars/bavra_r3_lod2.glb'],
    unlockLevel: 1,
    stats: { speed: 7, acceleration: 7, handling: 7, health: 7 },
    maxHealth: 115,
    paint: 0x3a3d42,
    wheels: [
      { x: -0.7711, y: 0.31, z: -1.3804, radius: 0.31, width: 0.245, front: true },
      { x: 0.7711, y: 0.31, z: -1.3804, radius: 0.31, width: 0.245, front: true },
      { x: -0.7611, y: 0.31, z: 1.3804, radius: 0.31, width: 0.286, front: false },
      { x: 0.7611, y: 0.31, z: 1.3804, radius: 0.31, width: 0.286, front: false },
    ],
    physics: {
      mass: 1600,
      com: [0, 0.45, 0.05],
      box: { hx: 0.93, hy: 0.33, hz: 2.25, cy: 0.62, cz: 0.1 },
      enginePower: 340000,
      maxDriveForce: 13000,
      topSpeed: 80,
      brakeForce: 22000,
      maxSteer: 0.6,
      highSpeedSteer: 0.12,
      grip: 1.52,
      rearGripBias: 0.96,
      driftGrip: 0.22,
      suspension: { rest: 0.3, stiffness: 54000, damping: 5400, travel: 0.22 },
      antiRoll: 16000,
      downforce: 1.2,
      driven: 'rear',
    },
  },
  mercator190: {
    id: 'mercator190',
    name: 'Mercator 190E',
    model: 'models/cars/mercator190.glb',
    lodModels: ['models/cars/mercator190_lod.glb', 'models/cars/mercator190_lod2.glb'],
    unlockLevel: 1,
    stats: { speed: 6, acceleration: 6, handling: 7, health: 7 },
    maxHealth: 120,
    paint: 0x1b2a44,
    // 80s sports saloon: tall sidewalls, soft springs, easy to slide
    wheels: [
      { x: -0.7223, y: 0.3046, z: -1.3175, radius: 0.2835, width: 0.228, front: true },
      { x: 0.7223, y: 0.3046, z: -1.3175, radius: 0.2835, width: 0.228, front: true },
      { x: -0.7147, y: 0.2829, z: 1.3175, radius: 0.2826, width: 0.223, front: false },
      { x: 0.7147, y: 0.2829, z: 1.3175, radius: 0.2826, width: 0.223, front: false },
    ],
    physics: {
      mass: 1300,
      com: [0, 0.45, 0.1],
      box: { hx: 0.88, hy: 0.35, hz: 2.15, cy: 0.65, cz: 0.14 },
      enginePower: 230000,
      maxDriveForce: 10500,
      topSpeed: 72,
      brakeForce: 19000,
      maxSteer: 0.6,
      highSpeedSteer: 0.13,
      grip: 1.45,
      rearGripBias: 0.96,
      driftGrip: 0.22,
      suspension: { rest: 0.3, stiffness: 42000, damping: 4400, travel: 0.22 },
      antiRoll: 13000,
      downforce: 0.9,
      driven: 'rear',
    },
  },
  renova_clyo: {
    id: 'renova_clyo',
    name: 'Renova Clyo RS',
    model: 'models/cars/renova_clyo.glb',
    lodModels: ['models/cars/renova_clyo_lod.glb', 'models/cars/renova_clyo_lod2.glb'],
    unlockLevel: 1,
    stats: { speed: 5, acceleration: 6, handling: 8, health: 6 },
    maxHealth: 105,
    paint: 0xe8b90c,
    // hot hatch: front-wheel drive, short and nimble
    wheels: [
      { x: -0.7374, y: 0.3164, z: -1.2928, radius: 0.3164, width: 0.214, front: true },
      { x: 0.7374, y: 0.3164, z: -1.2928, radius: 0.3164, width: 0.214, front: true },
      { x: -0.7374, y: 0.3173, z: 1.2928, radius: 0.3164, width: 0.214, front: false },
      { x: 0.7374, y: 0.3173, z: 1.2928, radius: 0.3164, width: 0.214, front: false },
    ],
    physics: {
      mass: 1200,
      com: [0, 0.45, -0.2],
      box: { hx: 0.88, hy: 0.36, hz: 2.0, cy: 0.66, cz: -0.11 },
      enginePower: 175000,
      maxDriveForce: 9800,
      topSpeed: 68,
      brakeForce: 18000,
      maxSteer: 0.62,
      highSpeedSteer: 0.14,
      grip: 1.5,
      rearGripBias: 0.98,
      driftGrip: 0.24,
      suspension: { rest: 0.3, stiffness: 42000, damping: 4300, travel: 0.22 },
      antiRoll: 14000,
      downforce: 0.8,
      driven: 'front',
    },
  },
  dacor_logen: {
    id: 'dacor_logen',
    name: 'Dacor Logen',
    model: 'models/cars/dacor_logen.glb',
    lodModels: ['models/cars/dacor_logen_lod.glb', 'models/cars/dacor_logen_lod2.glb'],
    unlockLevel: 1,
    stats: { speed: 4, acceleration: 4, handling: 5, health: 9 },
    maxHealth: 140,
    paint: 0xe9e9e6,
    // the everyday saloon: slow, soft, and very hard to kill
    wheels: [
      { x: -0.7495, y: 0.3123, z: -1.3188, radius: 0.3123, width: 0.196, front: true },
      { x: 0.7495, y: 0.3123, z: -1.3188, radius: 0.3123, width: 0.196, front: true },
      { x: -0.745, y: 0.3123, z: 1.3188, radius: 0.3123, width: 0.196, front: false },
      { x: 0.745, y: 0.3123, z: 1.3188, radius: 0.3123, width: 0.196, front: false },
    ],
    physics: {
      mass: 1150,
      com: [0, 0.55, -0.1],
      box: { hx: 0.87, hy: 0.42, hz: 2.1, cy: 0.78, cz: 0.03 },
      enginePower: 140000,
      maxDriveForce: 8800,
      topSpeed: 60,
      brakeForce: 16500,
      maxSteer: 0.62,
      highSpeedSteer: 0.15,
      grip: 1.4,
      rearGripBias: 0.98,
      driftGrip: 0.24,
      suspension: { rest: 0.32, stiffness: 38000, damping: 4000, travel: 0.25 },
      antiRoll: 11000,
      downforce: 0.5,
      driven: 'front',
    },
  },
  tugra_t10: {
    id: 'tugra_t10',
    name: 'Tugra T10',
    model: 'models/cars/tugra_t10.glb',
    lodModels: ['models/cars/tugra_t10_lod.glb', 'models/cars/tugra_t10_lod2.glb'],
    unlockLevel: 1,
    stats: { speed: 6, acceleration: 8, handling: 5, health: 10 },
    maxHealth: 150,
    // the body colour is baked into its texture (not repaintable)
    paint: 0x3d6b7c,
    // electric SUV: heavy, instant torque, all-wheel drive, tall
    wheels: [
      { x: -0.8602, y: 0.4, z: -1.403, radius: 0.37, width: 0.28, front: true },
      { x: 0.8602, y: 0.4, z: -1.403, radius: 0.37, width: 0.28, front: true },
      { x: -0.8602, y: 0.382, z: 1.403, radius: 0.382, width: 0.28, front: false },
      { x: 0.8602, y: 0.382, z: 1.403, radius: 0.382, width: 0.28, front: false },
    ],
    physics: {
      mass: 2050,
      com: [0, 0.62, 0],
      box: { hx: 1.0, hy: 0.45, hz: 2.25, cy: 0.85, cz: -0.03 },
      enginePower: 320000,
      maxDriveForce: 17000,
      topSpeed: 72,
      brakeForce: 26000,
      maxSteer: 0.58,
      highSpeedSteer: 0.12,
      grip: 1.45,
      rearGripBias: 0.98,
      driftGrip: 0.26,
      suspension: { rest: 0.34, stiffness: 68000, damping: 7000, travel: 0.26 },
      antiRoll: 22000,
      downforce: 0.7,
      driven: 'all',
    },
  },
};

export const DEFAULT_CAR = 'ferrano458';
export const CAR_IDS = Object.keys(CARS);
